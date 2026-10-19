/** Single owner-private workspace. No mail, Feishu, model calls, or GET writes. */
import { earnCinemaCard, CINEMA_COLLECTION_CAPACITY } from "./cinema-progress";
import { academicTaskOf, hasPendingReview, nextIncompleteInDomain, normalizedPackageDomain, type ProgressPackage } from "./task-progress";
import { milestonesForPackage, milestoneKey, milestoneStatus, type MilestonePackage, type MilestoneRecord } from "./progress-milestones";
import { executionOf, parseExecutionUpdate, validateWorkConversation, academicGoalKey, ExecutionValidationError, type ExecutionState } from "./execution-state";
import { AdmissionsSourceError, reconcileAdmissionsSource, validateAdmissionsReference } from "./admissions-tasks";
import { reconcileLmsTasks } from "./lms-tasks";
export type JsonObject = { [key: string]: any };
export type StudioDocument = JsonObject & {
  schema_version: 1;
  current_package_id: string | null;
  paused: boolean;
  mode: string;
  packages: JsonObject[];
};
export type StudioAction = {
  event_id: string;
  expected_revision: number;
  kind: "reply" | "confirm" | "activate" | "pause" | "mode" | "work_reply" | "work_step" | "work_finish" | "task_complete" | "task_reopen" | "milestone_complete" | "progress_note";
  package_id: string | null;
  text?: string;
  paused?: boolean;
  mode?: string;
  step_id?: string;
  milestone_id?: string;
};
type DocumentRow = { id: string; body: string; revision: number; updated_at: string };
type EventRow = { id: string; package_id: string | null; kind: string; raw_text: string; base_revision: number; created_at: string; result: string };

export class StudioError extends Error {
  status: number;
  details: JsonObject;
  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.status = status;
    this.details = details;
  }
}

function reconcileAdmissions(document: StudioDocument): JsonObject {
  // StudioDocument keeps legacy package shapes open; stored packages were
  // validated before this narrowly source-only projection.
  try { return reconcileAdmissionsSource(document as unknown as Parameters<typeof reconcileAdmissionsSource>[0]); }
  catch (error) { if (error instanceof AdmissionsSourceError) throw new StudioError(error.message, 409); throw error; }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => (value as JsonObject)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonObject)[key])}`).join(",")}}`;
  }
  const text = JSON.stringify(value);
  if (text === undefined) throw new StudioError("invalid_json_value");
  return text;
}

export async function checksum(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new StudioError("timestamp_requires_timezone");
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new StudioError("invalid_timestamp");
  return millis;
}
function eventView(row: EventRow): JsonObject {
  const result = JSON.parse(row.result);
  delete result.request_hash;
  delete result.claim;
  return { ...row, result };
}

function reviewableReply(row: EventRow): boolean {
  return !!row.raw_text.trim() && (row.kind === "reply" || row.kind === "conflict:reply" ||
    (row.kind === "mail" && JSON.parse(row.result).outcome === "mail_reply_pending_review"));
}

function sourceRefs(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 &&
    value.every((ref) => typeof ref === "string" && ref.trim().length > 0 && ref.length <= 2000 && !/[\u0000-\u001f]/.test(ref));
}

function encodeCursor(value: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
}
function decodeCursor(value: string): JsonObject {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0))));
}

const WORK_DOMAINS = ["academics", "research", "admissions", "collaboration", "intake"];
const SOURCE_NAMES = ["academics", "collaboration", "research", "intake"];
const SOURCE_STATUSES = ["synced", "partial", "needs_connection", "not_connected", "unavailable", "manual", "pending", "error", "not_checked"];
function stepIdentifier(value: unknown): value is string {
  return identifier(value) && !["__proto__", "prototype", "constructor"].includes(value);
}
function calendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function nonempty(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function academicKeys(value: JsonObject, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new StudioError("unsupported_academic_task_field");
}
function academicAbsolutePath(value: unknown): value is string {
  return nonempty(value, 4000) && value.startsWith("/") && !value.startsWith("//") && !/[\u0000-\u001f]/.test(value) && !value.split("/").some((part) => part === "." || part === "..");
}
function academicSourceUrl(value: unknown): value is string {
  if (!nonempty(value, 4000)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && ![...url.searchParams.keys()].some((key) => /token|auth|secret|password|cookie|signature|api.?key/i.test(key)); } catch { return false; }
}
function validateAcademicTask(value: unknown): asserts value is JsonObject {
  if (!object(value)) throw new StudioError("invalid_academic_task");
  academicKeys(value, ["id", "kind", "title", "course_name", "deliverables", "sources", "source_refs", "due", "workspace_path", "scope_note"]);
  if (!stepIdentifier(value.id) || !["assignment", "study", "assignment_candidate"].includes(value.kind) || !nonempty(value.title, 300) || !nonempty(value.course_name, 300) ||
    !Array.isArray(value.deliverables) || value.deliverables.length < 1 || value.deliverables.length > 6 || value.deliverables.some((item: unknown) => !nonempty(item, 3000)) ||
    !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 40 || !sourceRefs(value.source_refs) ||
    (value.workspace_path !== undefined && !academicAbsolutePath(value.workspace_path)) || (value.scope_note !== undefined && !nonempty(value.scope_note, 6000))) throw new StudioError("invalid_academic_task");
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (!object(source)) throw new StudioError("invalid_academic_task_source");
    academicKeys(source, ["id", "title", "url", "path", "detail"]);
    if (!stepIdentifier(source.id) || ids.has(source.id) || !nonempty(source.title, 500) || (source.url === undefined && source.path === undefined) ||
      (source.url !== undefined && !academicSourceUrl(source.url)) || (source.path !== undefined && !academicAbsolutePath(source.path)) ||
      (source.detail !== undefined && !nonempty(source.detail, 4000))) throw new StudioError("invalid_academic_task_source");
    ids.add(source.id);
  }
  if (new Set(value.source_refs).size !== value.source_refs.length || value.source_refs.some((id: string) => !ids.has(id))) throw new StudioError("unknown_academic_source_reference");
  if (value.due !== undefined) {
    if (!object(value.due)) throw new StudioError("invalid_academic_task_due");
    academicKeys(value.due, ["at", "kind", "source_id"]);
    const due = value.due;
    if (!["platform_deadline", "none_verified"].includes(due.kind) || (due.source_id !== undefined && (!stepIdentifier(due.source_id) || !ids.has(due.source_id) || !value.source_refs.includes(due.source_id)))) throw new StudioError("invalid_academic_task_due");
    if (due.kind === "none_verified") {
      if (due.at !== null) throw new StudioError("invalid_academic_task_due");
    } else {
      const source = value.sources.find((item: JsonObject) => item.id === due.source_id);
      if (!source || !academicSourceUrl(source.url) || !nonempty(due.at, 80)) throw new StudioError("invalid_academic_task_due");
      try { timestamp(due.at); } catch { throw new StudioError("invalid_academic_task_due"); }
    }
  }
}

function formalAcademicReferenceTask(task: JsonObject): boolean {
  const source = task.sources.find((item: JsonObject) => item.id === task.due?.source_id);
  if (task.kind !== "assignment" || task.due?.kind !== "platform_deadline" || !source || !academicSourceUrl(source.url)) return false;
  const host = new URL(source.url).hostname;
  return host === "example.edu" || host.endsWith(".example.edu");
}
function validateAcademicReference(value: JsonObject): void {
  academicKeys(value, ["id", "revision", "content", "facts", "academic_task", "academic_source_history"]);
  academicKeys(value.content, ["kind", "domain", "title", "fields"]);
  if (value.content.domain !== "academics" || !nonempty(value.content.title, 300) || !Array.isArray(value.content.fields) || value.content.fields.length || !Array.isArray(value.facts) || value.facts.length || !academicTaskOf(value as ProgressPackage)) throw new StudioError("invalid_academic_reference");
  if (value.academic_source_history !== undefined && (!Array.isArray(value.academic_source_history) || value.academic_source_history.length > 30)) throw new StudioError("invalid_academic_source_history");
  const versions = [value.academic_task, ...(value.academic_source_history ?? [])];
  for (const version of versions) {
    if (!object(version)) throw new StudioError("invalid_saved_academic_task");
    const { source_revision, sourced_at, ...task } = version;
    if (!Number.isSafeInteger(source_revision) || source_revision < 1) throw new StudioError("invalid_saved_academic_task");
    timestamp(sourced_at);
    validateAcademicTask(task);
  }
  let previousRevision = 0;
  for (const version of value.academic_source_history ?? []) {
    if (version.source_revision <= previousRevision || version.source_revision >= value.academic_task.source_revision) throw new StudioError("invalid_academic_source_history");
    previousRevision = version.source_revision;
  }
}

export function validateGuidedPackage(value: unknown): asserts value is JsonObject {
  if (!object(value) || !identifier(value.id) || value.revision !== 1 || !object(value.content)) throw new StudioError("invalid_guided_package");
  const content = value.content;
  if (content.kind !== "guided_work" || content.package_id !== value.id || content.revision !== 1 ||
    !WORK_DOMAINS.includes(content.domain) || !identifier(content.project_key) || !nonempty(content.title, 300) ||
    !nonempty(content.description, 10000) || !nonempty(content.deliverable, 3000) || !nonempty(content.working_question, 4000) ||
    !Number.isSafeInteger(content.estimated_user_minutes) || content.estimated_user_minutes < 1 || content.estimated_user_minutes > 480 ||
    !Array.isArray(content.fields) || content.fields.length !== 0 || !Array.isArray(value.facts) || value.facts.length !== 0 ||
    !Array.isArray(content.guide_steps) || content.guide_steps.length < 1 || content.guide_steps.length > 30 ||
    !Array.isArray(content.sources) || content.sources.length < 1 || content.sources.length > 100 || !sourceRefs(content.source_refs)) throw new StudioError("invalid_guided_content");
  const sources = new Set<string>();
  for (const source of content.sources) {
    if (!object(source) || !identifier(source.id) || sources.has(source.id) ||
      ![source.path, source.url, source.document_title, source.locator, source.thread_id, source.message_id].some((item) => nonempty(item, 4000))) throw new StudioError("invalid_guided_source");
    sources.add(source.id);
  }
  if (content.source_refs.some((id: string) => !sources.has(id))) throw new StudioError("unknown_guided_source_reference");
  const steps = new Set<string>();
  for (const step of content.guide_steps) {
    if (!object(step) || !stepIdentifier(step.id) || steps.has(step.id) || !nonempty(step.title, 300) || !nonempty(step.body, 16000) ||
      (step.prompt !== undefined && !nonempty(step.prompt, 4000)) ||
      (step.source_refs !== undefined && (!sourceRefs(step.source_refs) || step.source_refs.some((id: string) => !sources.has(id))))) throw new StudioError("invalid_guided_step");
    steps.add(step.id);
  }
  if (value.work !== undefined && (!object(value.work) || value.work.status !== "ready" || !object(value.work.answers) || Object.keys(value.work.answers).length !== 0 ||
    (value.work.current_step_id !== undefined && !steps.has(value.work.current_step_id)) ||
    Object.keys(value.work).some((key) => !["status", "current_step_id", "answers"].includes(key)))) throw new StudioError("new_work_cannot_contain_user_progress");
  if (Object.keys(value).some((key) => !["id", "revision", "content", "facts", "work"].includes(key))) throw new StudioError("new_work_cannot_contain_user_progress");
}

function validateSuggestedPlan(value: unknown, packageIds: Set<string>): JsonObject {
  if (!object(value) || !calendarDate(value.date) || !Array.isArray(value.items) || value.items.length > 120) throw new StudioError("invalid_suggested_plan");
  if ((value.capacity_note !== undefined && !nonempty(value.capacity_note, 4000)) ||
    (value.constraints !== undefined && (!Array.isArray(value.constraints) || value.constraints.length > 40 || value.constraints.some((item: unknown) => !nonempty(item, 3000)))) ||
    (value.hard_deadlines_complete !== undefined && typeof value.hard_deadlines_complete !== "boolean")) throw new StudioError("invalid_plan_context");
  const ids = new Set<string>();
  const items = value.items.map((item: unknown) => {
    if (!object(item) || !identifier(item.id) || ids.has(item.id) || !packageIds.has(item.package_id) || !calendarDate(item.date) || item.kind !== "suggested" ||
      !Number.isSafeInteger(item.duration_minutes) || item.duration_minutes < 1 || item.duration_minutes > 480 || !nonempty(item.reason, 3000) || !sourceRefs(item.evidence_refs)) throw new StudioError("invalid_suggested_plan_item");
    ids.add(item.id);
    const time = (input: unknown): number | null => {
      if (input === undefined) return null;
      if (typeof input === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input)) return Date.parse(`${item.date}T${input}:00+08:00`);
      return timestamp(input);
    };
    const start = time(item.start), end = time(item.end);
    if (start !== null && end !== null && end <= start) throw new StudioError("invalid_suggested_time_range");
    return { id: item.id, package_id: item.package_id, date: item.date,
      ...(item.start !== undefined ? { start: item.start } : {}), ...(item.end !== undefined ? { end: item.end } : {}),
      duration_minutes: item.duration_minutes, kind: "suggested", reason: item.reason, evidence_refs: [...item.evidence_refs] };
  });
  return { date: value.date, items, kind: "suggested",
    ...(value.capacity_note !== undefined ? { capacity_note: value.capacity_note } : {}),
    ...(value.constraints !== undefined ? { constraints: [...value.constraints] } : {}),
    ...(value.hard_deadlines_complete !== undefined ? { hard_deadlines_complete: value.hard_deadlines_complete } : {}) };
}

function mergeSourceUpdates(previous: unknown, updates: unknown): JsonObject {
  if (!object(updates) || Object.keys(updates).some((key) => !SOURCE_NAMES.includes(key))) throw new StudioError("invalid_named_source_updates");
  const result = object(previous) ? structuredClone(previous) : {};
  for (const [name, input] of Object.entries(updates)) {
    if (!object(input) || !SOURCE_STATUSES.includes(input.status)) throw new StudioError("invalid_named_source");
    const checked = timestamp(input.checked_at);
    if (checked > Date.now() + 5 * 60 * 1000) throw new StudioError("source_timestamp_is_in_future");
    if (input.items !== undefined && (!Array.isArray(input.items) || input.items.length > 500 || input.items.some((item: unknown) => !object(item) || !identifier(item.id)) || new Set(input.items.map((item: JsonObject) => item.id)).size !== input.items.length)) throw new StudioError("invalid_named_source_items");
    const prior = object(result[name]) ? result[name] : {};
    if (prior.checked_at && timestamp(prior.checked_at) > checked) throw new StudioError("named_source_update_is_older", 409);
    if (input.last_success_at !== undefined && (timestamp(input.last_success_at) > checked ||
      (prior.last_success_at && timestamp(input.last_success_at) < timestamp(prior.last_success_at)))) throw new StudioError("named_source_success_is_older_or_future", 409);
    if (input.status === "synced") {
      const proof = input.provenance;
      let validUrl = false;
      try { const url = new URL(proof?.source_url); validUrl = url.protocol === "https:" && !url.username && !url.password; } catch { /* Invalid provenance remains unverified. */ }
      if (!input.last_success_at || !object(proof) || proof.read_status !== "success" || proof.authenticated_read !== true || !validUrl ||
        (name === "academics" && proof.kind !== "lms") || input.connection_status === "not_connected" || input.lms_connected === false) throw new StudioError("synced_requires_verified_connected_source");
    }
    const merged = { ...prior, ...structuredClone(input) };
    if (["needs_connection", "not_connected", "unavailable", "pending", "error", "not_checked"].includes(input.status)) {
      if (prior.items !== undefined) merged.items = structuredClone(prior.items);
      if (prior.last_success_at !== undefined) merged.last_success_at = prior.last_success_at;
    } else if (input.status !== "synced" && Array.isArray(prior.items) && Array.isArray(input.items)) {
      const items = new Map(prior.items.map((item: JsonObject) => [item.id, item]));
      for (const item of input.items) items.set(item.id, structuredClone(item));
      merged.items = [...items.values()];
    }
    if (prior.checked_at && timestamp(prior.checked_at) === checked && canonicalJson(prior) !== canonicalJson(merged)) throw new StudioError("named_source_same_time_conflict", 409);
    result[name] = merged;
  }
  return result;
}

export function validateDocument(value: unknown): asserts value is StudioDocument {
  if (!object(value) || value.schema_version !== 1 || typeof value.paused !== "boolean" || typeof value.mode !== "string" || !Array.isArray(value.packages)) {
    throw new StudioError("invalid_document_shape");
  }
  const ids = new Set<string>();
  for (const pkg of value.packages) {
    if (!object(pkg) || !identifier(pkg.id) || ids.has(pkg.id) || !object(pkg.content) || !Number.isSafeInteger(pkg.revision) || pkg.revision < 1) throw new StudioError("invalid_package_shape");
    if (["progress_notes", "execution", "execution_history", "fact_review_history"].some(key => pkg[key] !== undefined)) throw new StudioError("new_work_cannot_contain_user_progress");
    ids.add(pkg.id);
    if (pkg.content.kind === "guided_work") validateGuidedPackage(pkg);
    if (pkg.content.kind === "academic_work") validateAcademicReference(pkg);
    if (pkg.content.kind === "work_item") {
      if (Object.keys(pkg).some(key => !['id','revision','content','facts','work_registration'].includes(key)) || !['research','collaboration'].includes(pkg.content.domain) || !nonempty(pkg.content.deliverable,3000) || !nonempty(pkg.content.next_action,4000) || !object(pkg.work_registration) || !identifier(pkg.work_registration.source_key) || !nonempty(pkg.work_registration.owner_quote,4000) || !Array.isArray(pkg.content.fields) || pkg.content.fields.length || !Array.isArray(pkg.facts) || pkg.facts.length) throw new StudioError('invalid_work_item_reference');
    }
    if (pkg.content.kind === "admissions_work") {
      try { validateAdmissionsReference(pkg); }
      catch (error) { if (error instanceof AdmissionsSourceError) throw new StudioError(error.message); throw error; }
    }
    if (pkg.facts !== undefined && (!Array.isArray(pkg.facts) || pkg.facts.some((fact: unknown) => !object(fact) || !identifier(fact.id)))) throw new StudioError("invalid_facts_shape");
  }
  if (value.current_package_id !== null && !ids.has(value.current_package_id)) throw new StudioError("invalid_current_package");
}

export function validateAction(value: unknown): asserts value is StudioAction {
  if (!object(value) || !identifier(value.event_id) || !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1 || !["reply", "confirm", "activate", "pause", "mode", "work_reply", "work_step", "work_finish", "task_complete", "task_reopen", "milestone_complete", "progress_note"].includes(value.kind)) throw new StudioError("invalid_action");
  if (value.package_id !== null && !identifier(value.package_id)) throw new StudioError("package_id_required");
  if (value.text !== undefined && (typeof value.text !== "string" || value.text.length > 12000)) throw new StudioError("invalid_reply_text");
  if (value.kind === "reply" && !value.text?.trim()) throw new StudioError("reply_text_required");
  if (["work_reply", "work_finish"].includes(value.kind) && !value.text?.trim()) throw new StudioError("work_text_required");
  if (value.kind === "task_complete" && !nonempty(value.text, 3000)) throw new StudioError("completion_note_required");
  if (value.kind === "milestone_complete" && (!stepIdentifier(value.milestone_id) || !nonempty(value.text, 3000))) throw new StudioError("milestone_evidence_required");
  if (value.kind === "progress_note" && !nonempty(value.text, 3000)) throw new StudioError("progress_note_text_required");
  if (value.kind === "progress_note" && value.milestone_id !== undefined && !stepIdentifier(value.milestone_id)) throw new StudioError("invalid_progress_milestone_id");
  if (["work_reply", "work_step"].includes(value.kind) && !stepIdentifier(value.step_id)) throw new StudioError("work_step_id_required");
  if (value.kind === "pause" && typeof value.paused !== "boolean") throw new StudioError("paused_boolean_required");
  if (value.kind === "mode" && !["gentle", "focus", "rest", "quiet"].includes(value.mode)) throw new StudioError("invalid_mode");
}

export function reduceAction(doc: StudioDocument, action: StudioAction, actor: string): { doc: StudioDocument; outcome: string } {
  const next = structuredClone(doc);
  const pkg = next.packages.find((item) => item.id === action.package_id);
  if (["reply", "confirm", "activate", "work_reply", "work_step", "work_finish", "task_complete", "task_reopen", "milestone_complete", "progress_note"].includes(action.kind) && !pkg) throw new StudioError("package_not_found", 404);
  if (["reply", "confirm", "work_reply", "work_step", "work_finish", "task_complete", "task_reopen", "milestone_complete", "progress_note"].includes(action.kind) && action.package_id !== doc.current_package_id) throw new StudioError("package_is_not_current", 409);
  if (pkg && academicTaskOf(pkg as ProgressPackage) && (["task_complete", "task_reopen", "work_reply", "work_finish", "progress_note", "milestone_complete"].includes(action.kind) || (pkg.content.kind === "academic_work" && ["reply", "confirm", "work_step"].includes(action.kind)))) throw new StudioError("academic_work_managed_in_execution", 409);
  if (pkg?.content.kind === "admissions_work" && !["activate", "pause", "mode"].includes(action.kind)) throw new StudioError("admissions_work_managed_in_execution", 409);
  if (pkg?.content.kind === "guided_work" && ["reply", "confirm"].includes(action.kind)) throw new StudioError("guided_work_requires_work_action");
  if (action.kind.startsWith("work_") && pkg?.content.kind !== "guided_work") throw new StudioError("package_is_not_guided_work");
  if (["task_complete", "task_reopen"].includes(action.kind) && pkg?.content.kind !== "guided_work") throw new StudioError("fact_material_requires_confirmation");
  if (action.kind === "milestone_complete" && pkg?.content.kind !== "guided_work") throw new StudioError("milestones_require_guided_work");
  if (action.kind === "progress_note" && (pkg?.content.kind !== "guided_work" || normalizedPackageDomain(pkg as ProgressPackage) !== "academics")) throw new StudioError("progress_notes_require_academic_work");
  if (["work_reply", "work_finish", "progress_note"].includes(action.kind) && pkg?.task_completion?.status === "completed") throw new StudioError("task_reopen_required", 409);
  if (action.kind === "progress_note") {
    if (pkg!.progress_notes !== undefined && !Array.isArray(pkg!.progress_notes)) throw new StudioError("invalid_saved_progress_notes", 409);
    if ((pkg!.progress_notes?.length ?? 0) >= 200) throw new StudioError("progress_note_history_limit_reached", 409);
  }
  if (action.kind === "pause") next.paused = action.paused!;
  if (action.kind === "mode") next.mode = action.mode!;
  if (action.kind === "activate") next.current_package_id = action.package_id;
  let outcome = "saved";
  if (action.kind === "milestone_complete" || (action.kind === "progress_note" && action.milestone_id !== undefined)) {
    const definition = milestonesForPackage(pkg! as MilestonePackage).find((milestone) => milestone.id === action.milestone_id);
    if (!definition) throw new StudioError("milestone_not_available", 404);
    if (!nonempty(action.text, 3000)) throw new StudioError("milestone_evidence_required");
    if (next.cinema?.milestones !== undefined && !Array.isArray(next.cinema.milestones)) throw new StudioError("invalid_saved_milestones", 409);
    if (milestoneStatus(next.cinema, pkg! as MilestonePackage, definition.id)) throw new StudioError("milestone_already_recorded", 409);
    if ((next.cinema?.milestones?.length ?? 0) >= CINEMA_COLLECTION_CAPACITY) throw new StudioError("milestone_history_limit_reached", 409);
    const now = new Date();
    const record: MilestoneRecord = { key: milestoneKey(definition.project_key, definition.id), milestone_id: definition.id, project_key: definition.project_key, package_id: pkg!.id, title: definition.title, criterion: definition.criterion, evidence: action.text, completed_at: now.toISOString(), completed_by: actor, basis: "owner_report", event_id: action.event_id };
    next.cinema = earnCinemaCard(next.cinema, action.event_id, "meaningful_milestone", now, next.source_updates?.intake?.movie_rewards, record).cinema;
    outcome = "meaningful_milestone_recorded";
  }
  if (action.kind === "progress_note") {
    pkg!.progress_notes = [...(pkg!.progress_notes ?? []), { event_id: action.event_id, text: action.text, saved_at: new Date().toISOString(), saved_by: actor, basis: "owner_report", ...(action.milestone_id !== undefined ? { milestone_id: action.milestone_id } : {}) }];
    pkg!.revision += 1;
    outcome = "progress_note_saved";
  }
  if (action.kind === "task_complete") {
    if (!nonempty(action.text, 3000)) throw new StudioError("completion_note_required");
    if (pkg!.task_completion?.status === "completed") throw new StudioError("task_already_completed", 409);
    if (pkg!.task_completion_history !== undefined && !Array.isArray(pkg!.task_completion_history)) throw new StudioError("invalid_task_completion_history", 409);
    pkg!.task_completion = { status: "completed", note: action.text, completed_at: new Date().toISOString(), completed_by: actor, basis: "owner_report", event_id: action.event_id };
    pkg!.revision += 1;
    outcome = "task_completed_owner_report";
    if (!hasPendingReview(pkg! as ProgressPackage)) next.current_package_id = nextIncompleteInDomain(next.packages as ProgressPackage[], pkg!.id)?.id ?? pkg!.id;
  }
  if (action.kind === "task_reopen") {
    if (pkg!.task_completion?.status !== "completed") throw new StudioError("task_is_not_completed", 409);
    if (pkg!.task_completion_history && (!Array.isArray(pkg!.task_completion_history) || pkg!.task_completion_history.length >= 100)) throw new StudioError("task_completion_history_limit_reached", 409);
    pkg!.task_completion_history = [...(pkg!.task_completion_history ?? []), { ...structuredClone(pkg!.task_completion), reopened_at: new Date().toISOString(), reopened_by: actor, reopen_event_id: action.event_id, ...(action.text ? { reopen_note: action.text } : {}) }];
    delete pkg!.task_completion;
    pkg!.revision += 1;
    outcome = "task_reopened";
  }
  if (action.kind.startsWith("work_")) {
    const steps = pkg!.content.guide_steps as JsonObject[];
    const work = pkg!.work;
    if (!object(work) || !object(work.answers) || !["ready", "in_progress", "session_complete"].includes(work.status)) throw new StudioError("invalid_saved_work_state", 409);
    if (["work_step", "work_reply"].includes(action.kind) && !steps.some((step) => step.id === action.step_id)) throw new StudioError("work_step_not_found", 404);
    if (action.kind === "work_step") {
      work.current_step_id = action.step_id;
      outcome = "work_step_changed";
    } else if (action.kind === "work_reply") {
      if (work.status === "session_complete") {
        work.finish_history = [...(work.finish_history ?? []), { summary: work.finish_summary, event_id: work.finish_event_id, finished_at: work.finished_at }];
        delete work.finish_summary; delete work.finish_event_id; delete work.finished_at; delete work.completion_basis;
      }
      work.answers = { ...work.answers, [action.step_id!]: { text: action.text, event_id: action.event_id, saved_at: new Date().toISOString() } };
      work.status = "in_progress";
      outcome = "work_answer_saved";
    } else {
      if (!Object.values(work.answers).some((answer) => object(answer) && nonempty(answer.text, 12000))) throw new StudioError("work_finish_requires_saved_answer");
      if (work.status === "session_complete") throw new StudioError("work_session_already_finished", 409);
      work.status = "session_complete";
      work.finish_summary = action.text;
      work.finish_event_id = action.event_id;
      work.finished_at = new Date().toISOString();
      work.completion_basis = "self_report";
      outcome = "work_session_finished_self_report";
    }
    pkg!.revision += 1;
  }
  if (action.kind === "reply") {
    pkg!.pending_review = true;
    pkg!.pending_reply_event_ids = [...new Set([...(pkg!.pending_reply_event_ids ?? []), action.event_id])];
    outcome = "reply_pending_review";
  }
  if (action.kind === "confirm") {
    const phrase = pkg!.content.confirm_phrase;
    if (typeof phrase !== "string" || !phrase || action.text !== phrase) {
      throw new StudioError("explicit_confirmation_phrase_required");
    }
    // Only an explicit, current-package button confirms a finite fact group.
    // Free-text replies never call this branch or mutate confirmed facts.
    if (!Array.isArray(pkg!.facts) || pkg!.facts.length === 0) throw new StudioError("no_facts_to_confirm");
    for (const fact of pkg!.facts) {
      if (fact.status !== "confirmed") {
        fact.status = "confirmed";
        fact.confirmed_by = actor;
      }
    }
    pkg!.revision += 1;
    outcome = "current_fact_group_confirmed";
    if (!hasPendingReview(pkg! as ProgressPackage)) next.current_package_id = nextIncompleteInDomain(next.packages as ProgressPackage[], pkg!.id)?.id ?? pkg!.id;
  }
  return { doc: next, outcome };
}

export class StudioStore {
  db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async row(): Promise<DocumentRow | null> {
    return this.db.prepare("SELECT id, body, revision, updated_at FROM documents WHERE id = 'workspace'").first<DocumentRow>();
  }
  async event(id: string): Promise<EventRow | null> {
    return this.db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  }
  /** Conflict-only ledger entries also change the view even when the document
   * revision stays put. Include their sequence in conditional-read validators. */
  async viewTag(): Promise<string> {
    const stamp = await this.db.prepare("SELECT COALESCE((SELECT revision FROM documents WHERE id = 'workspace'), 0) AS revision, COALESCE((SELECT MAX(rowid) FROM events), 0) AS sequence").first<{revision: number; sequence: number}>();
    return `"workspace-v1-${stamp?.revision ?? 0}-${stamp?.sequence ?? 0}"`;
  }
  /** Register an explicitly requested, sourced research/collaboration deliverable.
   * No execution state, inferred deadline, new conversation or external write. */
  async registerWorkItem(value: unknown): Promise<JsonObject> {
    if (!object(value) || Object.keys(value).some(key => !['event_id','expected_revision','domain','source_key','title','deliverable','next_action','owner_quote','source','project_key'].includes(key)) ||
      !identifier(value.event_id) || !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1 || !['research','collaboration'].includes(value.domain) ||
      !stepIdentifier(value.source_key) || !nonempty(value.title,300) || !nonempty(value.deliverable,3000) || !nonempty(value.next_action,4000) || !nonempty(value.owner_quote,4000) ||
      (value.project_key !== undefined && !stepIdentifier(value.project_key)) || !object(value.source) || !nonempty(value.source.quote,4000) || !['file','url','conversation','owner_statement'].includes(value.source.kind)) throw new StudioError('invalid_work_registration');
    try { parseExecutionUpdate({event_id:value.event_id,package_id:'source-validation',expected_execution_revision:0,expected_content_revision:1,status:'ready',summary:value.owner_quote,next_action:value.next_action,evidence:[value.source]}); }
    catch { throw new StudioError('invalid_work_registration_source'); }
    const hash = await checksum(value), duplicate = await this.duplicate(value.event_id,hash);
    if (duplicate) return duplicate;
    const row = await this.row();
    if (!row) throw new StudioError('not_initialized',409);
    if (row.revision !== value.expected_revision) throw new StudioError('revision_conflict',409);
    const document = JSON.parse(row.body) as StudioDocument;
    const packageId = `work-${value.domain}-${(await checksum({domain:value.domain,source_key:value.source_key})).slice(0,32)}`;
    const existing = document.packages.find(pkg => pkg.id === packageId);
    if (existing && (existing.content.kind !== 'work_item' || existing.work_registration?.source_key !== value.source_key)) throw new StudioError('work_registration_identity_conflict',409);
    if (!existing) {
      const source = value.source;
      document.packages.push({id:packageId,revision:1,content:{kind:'work_item',domain:value.domain,revision:1,title:value.title,deliverable:value.deliverable,next_action:value.next_action,fields:[],
        ...(value.project_key ? {project_key:value.project_key} : {}),
        sources:[{id:'task-origin',title:source.title,...(source.kind==='file'?{path:source.locator}:source.kind==='url'?{url:source.locator}:{locator:source.locator}),detail:source.quote}]},facts:[],
        work_registration:{source_key:value.source_key,owner_quote:value.owner_quote,source:structuredClone(source),registered_at:new Date().toISOString()}});
    }
    if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError('workspace_history_storage_limit_reached',409);
    if (!await this.cas(row,document,{id:value.event_id,package_id:packageId,kind:'work_registration',raw_text:value.owner_quote,request_hash:hash,outcome:'work_item_registered',metadata:{registered_package_id:packageId,created:!existing}})) {
      const retried = await this.duplicate(value.event_id,hash);
      if (retried) return retried;
      throw new StudioError('revision_conflict',409);
    }
    return {...await this.snapshot(),event:eventView((await this.event(value.event_id))!)};
  }
  private async withPendingReviews(document: StudioDocument): Promise<StudioDocument> {
    // This is also called before mutations: projecting ledger-only stale
    // corrections just for GET would let a later confirmation skip them.
    const pending = await this.db.prepare(`SELECT id, package_id FROM events WHERE package_id IS NOT NULL AND (
      (kind = 'conflict:reply' AND raw_text != '') OR
      json_extract(result, '$.outcome') IN ('reply_pending_review', 'mail_reply_pending_review'))`).all<{id: string; package_id: string}>();
    for (const pkg of document.packages) {
      const reviewed = new Set(pkg.reviewed_reply_event_ids ?? []);
      const ids = pending.results.filter((event) => event.package_id === pkg.id && !reviewed.has(event.id)).map((event) => event.id);
      const stored = (pkg.pending_reply_event_ids ?? []).filter((id: string) => !reviewed.has(id));
      const combined = [...new Set([...stored, ...ids])];
      if (combined.length || pkg.pending_reply_event_ids !== undefined) pkg.pending_reply_event_ids = combined;
      if (combined.length || pkg.pending_review !== undefined) pkg.pending_review = combined.length > 0;
    }
    return document;
  }
  async snapshot(): Promise<JsonObject> {
    const row = await this.row();
    if (!row) return { initialized: false, doc: null, revision: 0, saved_at: null, events: [] };
    const [recent, document] = await Promise.all([
      this.db.prepare("SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT 30").all<EventRow>(),
      this.withPendingReviews(JSON.parse(row.body)),
    ]);
    // Pending work is projected from the complete ledger, never just the last
    // 30 timeline entries. A stale reply cannot disappear behind source events.
    return { initialized: true, doc: document, revision: row.revision, saved_at: row.updated_at, events: recent.results.map(eventView) };
  }

  private async duplicate(id: string, requestHash: string): Promise<JsonObject | null> {
    const existing = await this.event(id);
    if (!existing) return null;
    if (JSON.parse(existing.result).request_hash !== requestHash) throw new StudioError("event_id_reused_with_different_content", 409);
    const event = eventView(existing);
    if (event.result.error) throw new StudioError(event.result.error, 409, { ...(await this.snapshot()), event, raw_preserved: true });
    return { ...(await this.snapshot()), event, idempotent: true };
  }

  private async serviceConflict(event: { id: string; package_id: string; kind: string; raw_text: string; base_revision: number }, hash: string, code: string, metadata: JsonObject = {}): Promise<JsonObject> {
    const result = JSON.stringify({ ...metadata, request_hash: hash, error: code, saved_at: new Date().toISOString() });
    await this.db.prepare("INSERT OR IGNORE INTO events (id, package_id, kind, raw_text, base_revision, created_at, result) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(event.id, event.package_id, `conflict:${event.kind}`, event.raw_text, event.base_revision, new Date().toISOString(), result).run();
    return (await this.duplicate(event.id, hash))!;
  }

  async recordExecution(value: unknown): Promise<JsonObject> {
    let input;
    try { input = parseExecutionUpdate(value); } catch (error) { if (error instanceof ExecutionValidationError) throw new StudioError(error.message); throw error; }
    const hash = await checksum(input);
    const existing = await this.duplicate(input.event_id, hash);
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.row();
      if (!row) throw new StudioError("not_initialized", 409);
      const document = await this.withPendingReviews(JSON.parse(row.body));
      const pkg = document.packages.find(item => item.id === input.package_id);
      if (!pkg) throw new StudioError("package_not_found", 404);
      if (!["academics", "research", "admissions", "collaboration"].includes(normalizedPackageDomain(pkg as ProgressPackage))) throw new StudioError("execution_package_not_supported");
      const previous = executionOf({ execution: pkg.execution });
      if (pkg.execution !== undefined && !previous) throw new StudioError("invalid_saved_execution", 409);
      if (pkg.execution_history !== undefined && !Array.isArray(pkg.execution_history)) throw new StudioError("invalid_execution_history", 409);
      const contentRevision = pkg.content.revision || pkg.revision;
      const sourceRevision = academicTaskOf(pkg as ProgressPackage)?.source_revision;
      if (sourceRevision !== undefined && input.expected_source_revision === undefined) throw new StudioError("execution_source_revision_required");
      const conflict = input.expected_content_revision !== contentRevision ? "execution_content_revision_conflict" : input.expected_execution_revision !== (previous?.revision ?? 0) ? "execution_revision_conflict" : input.expected_source_revision !== undefined && input.expected_source_revision !== sourceRevision ? "execution_source_revision_conflict" : null;
      if (conflict) return this.serviceConflict({ id: input.event_id, package_id: pkg.id, kind: "execution", raw_text: input.summary, base_revision: row.revision }, hash, conflict, { execution_revision: previous?.revision ?? 0, content_revision: contentRevision, academic_source_revision: sourceRevision ?? null, ...(input.milestone_id ? { milestone_id: input.milestone_id } : {}) });
      const factMaterial = !["guided_work", "academic_work"].includes(pkg.content.kind) && Array.isArray(pkg.facts) && pkg.facts.length > 0;
      if (factMaterial && input.status === "submitted") throw new StudioError("execution_material_submission_not_applicable");
      if (factMaterial && input.status === "completed" && (pkg.facts.some((fact: JsonObject) => fact.status !== "confirmed") || hasPendingReview(pkg as ProgressPackage))) throw new StudioError("execution_material_review_required", 409);
      const now = new Date();
      if (input.milestone_id) {
        const definition = milestonesForPackage(pkg as MilestonePackage).find(item => item.id === input.milestone_id);
        if (!definition) throw new StudioError("milestone_not_available", 404);
        if (document.cinema?.milestones !== undefined && !Array.isArray(document.cinema.milestones)) throw new StudioError("invalid_saved_milestones", 409);
        if (milestoneStatus(document.cinema, pkg as MilestonePackage, definition.id)) throw new StudioError("milestone_already_recorded", 409);
        if ((document.cinema?.milestones?.length ?? 0) >= CINEMA_COLLECTION_CAPACITY) throw new StudioError("milestone_history_limit_reached", 409);
        const evidence = [input.summary, ...input.evidence.map(item => `${item.title}｜${item.locator}${item.quote ? `\n${item.quote}` : ""}`)].join("\n\n");
        const milestone: MilestoneRecord = { key: milestoneKey(definition.project_key, definition.id), milestone_id: definition.id, project_key: definition.project_key, package_id: pkg.id, title: definition.title, criterion: definition.criterion, evidence, completed_at: now.toISOString(), completed_by: "execution:agent_report", basis: "agent_report", event_id: input.event_id };
        document.cinema = earnCinemaCard(document.cinema, input.event_id, "meaningful_milestone", now, document.source_updates?.intake?.movie_rewards, milestone).cinema;
      }
      const state: ExecutionState = { revision: (previous?.revision ?? 0) + 1, event_id: input.event_id, updated_at: now.toISOString(), status: input.status, summary: input.summary, next_action: input.next_action, evidence: input.evidence, ...(input.conversation ? { conversation: input.conversation } : {}), ...(input.completion_basis ? { completion_basis: input.completion_basis } : {}), reported_by: "agent_report", content_revision: contentRevision, ...(sourceRevision !== undefined ? { academic_source_revision: sourceRevision, academic_goal_key: academicGoalKey(academicTaskOf(pkg as any)!) } : {}) };
      if (previous) pkg.execution_history = [...(pkg.execution_history ?? []), structuredClone(previous)].slice(-50);
      pkg.execution = state;
      if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
      if (await this.cas(row, document, { id: input.event_id, package_id: pkg.id, kind: "execution", raw_text: input.summary, request_hash: hash, outcome: "execution_recorded", metadata: { execution: state, ...(input.milestone_id ? { milestone_id: input.milestone_id } : {}) } })) return { ...(await this.snapshot()), event: eventView((await this.event(input.event_id))!) };
      const retried = await this.duplicate(input.event_id, hash);
      if (retried) return retried;
    }
    throw new StudioError("execution_busy_retry_same_event", 409);
  }

  async bindWorkConversation(value: unknown): Promise<JsonObject> {
    if (!object(value) || Object.keys(value).some(key => !["event_id", "package_id", "expected_binding_revision", "conversation"].includes(key)) || !identifier(value.event_id) || !identifier(value.package_id) || !Number.isSafeInteger(value.expected_binding_revision) || value.expected_binding_revision < 0) throw new StudioError("invalid_conversation_binding");
    try { validateWorkConversation(value.conversation); } catch (error) { if (error instanceof ExecutionValidationError) throw new StudioError(error.message); throw error; }
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.row();
      if (!row) throw new StudioError("not_initialized", 409);
      const document = JSON.parse(row.body) as StudioDocument;
      const pkg = document.packages.find(item => item.id === value.package_id);
      if (!pkg) throw new StudioError("package_not_found", 404);
      const previous = pkg.conversation_binding;
      if (previous !== undefined && (!object(previous) || !Number.isSafeInteger(previous.revision) || previous.revision < 1)) throw new StudioError("invalid_saved_conversation_binding", 409);
      if ((previous?.revision ?? 0) !== value.expected_binding_revision) return this.serviceConflict({ id: value.event_id, package_id: pkg.id, kind: "conversation_binding", raw_text: "", base_revision: row.revision }, hash, "conversation_binding_revision_conflict", { binding_revision: previous?.revision ?? 0 });
      if (pkg.conversation_binding_history !== undefined && !Array.isArray(pkg.conversation_binding_history)) throw new StudioError("invalid_conversation_binding_history", 409);
      if (previous) pkg.conversation_binding_history = [...(pkg.conversation_binding_history ?? []), structuredClone(previous)].slice(-50);
      const binding = { revision: (previous?.revision ?? 0) + 1, conversation: structuredClone(value.conversation), updated_at: new Date().toISOString(), source: "existing_conversation" };
      pkg.conversation_binding = binding;
      if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
      if (await this.cas(row, document, { id: value.event_id, package_id: pkg.id, kind: "conversation_binding", raw_text: "", request_hash: hash, outcome: "work_conversation_bound", metadata: { conversation_binding: binding } })) return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
      const retry = await this.duplicate(value.event_id, hash);
      if (retry) return retry;
    }
    throw new StudioError("conversation_binding_busy_retry_same_event", 409);
  }

  async recordMaterialReview(value: unknown): Promise<JsonObject> {
    if (!object(value) || Object.keys(value).some(key => !["event_id", "package_id", "expected_content_revision", "expected_package_revision", "conversation", "owner_quote", "field_reviews", "reviewed_reply_event_ids"].includes(key)) || !identifier(value.event_id) || !identifier(value.package_id) || !Number.isSafeInteger(value.expected_content_revision) || value.expected_content_revision < 1 || !Number.isSafeInteger(value.expected_package_revision) || value.expected_package_revision < 1 || !nonempty(value.owner_quote, 6000) || !Array.isArray(value.field_reviews) || !value.field_reviews.length || value.field_reviews.length > 40) throw new StudioError("invalid_material_review");
    try { validateWorkConversation(value.conversation); } catch (error) { if (error instanceof ExecutionValidationError) throw new StudioError(error.message); throw error; }
    const fields = new Set<string>();
    for (const review of value.field_reviews) {
      if (!object(review) || Object.keys(review).some(key => !["field_id", "expected_candidate", "decision", "comment"].includes(key)) || !identifier(review.field_id) || fields.has(review.field_id) || !Object.hasOwn(review, "expected_candidate") || !["confirmed", "needs_revision"].includes(review.decision) || (review.comment !== undefined && !nonempty(review.comment, 3000))) throw new StudioError("invalid_material_field_review");
      if (new TextEncoder().encode(canonicalJson(review.expected_candidate)).length > 16000) throw new StudioError("invalid_material_field_review");
      fields.add(review.field_id);
    }
    const reviewedIds = value.reviewed_reply_event_ids ?? [];
    if (!Array.isArray(reviewedIds) || reviewedIds.length > 100 || reviewedIds.some(id => !identifier(id)) || new Set(reviewedIds).size !== reviewedIds.length) throw new StudioError("invalid_reviewed_reply_event");
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.row();
      if (!row) throw new StudioError("not_initialized", 409);
      const document = await this.withPendingReviews(JSON.parse(row.body));
      const pkg = document.packages.find(item => item.id === value.package_id);
      if (!pkg) throw new StudioError("package_not_found", 404);
      if (["guided_work", "academic_work"].includes(pkg.content.kind) || !Array.isArray(pkg.facts) || !pkg.facts.length) throw new StudioError("material_review_requires_fact_package");
      const contentRevision = pkg.content.revision || pkg.revision;
      const code = contentRevision !== value.expected_content_revision ? "material_review_content_revision_conflict" : pkg.revision !== value.expected_package_revision ? "material_review_package_revision_conflict" : null;
      if (code) return this.serviceConflict({ id: value.event_id, package_id: pkg.id, kind: "material_review", raw_text: value.owner_quote, base_revision: row.revision }, hash, code, { content_revision: contentRevision, package_revision: pkg.revision });
      if (pkg.fact_review_history !== undefined && !Array.isArray(pkg.fact_review_history)) throw new StudioError("invalid_fact_review_history", 409);
      for (const review of value.field_reviews) {
        const field = pkg.content.fields?.find((item: JsonObject) => item.id === review.field_id);
        const fact = pkg.facts.find((item: JsonObject) => item.id === review.field_id);
        if (!field || !fact || canonicalJson(field.candidate) !== canonicalJson(review.expected_candidate) || !object(fact.content) || canonicalJson(fact.content.candidate) !== canonicalJson(review.expected_candidate)) throw new StudioError("material_review_candidate_mismatch", 409);
      }
      const reviewedBefore = new Set<string>(pkg.reviewed_reply_event_ids ?? []);
      for (const id of reviewedIds) {
        const event = await this.event(id);
        if (!event || event.package_id !== pkg.id || !reviewableReply(event) || reviewedBefore.has(id)) throw new StudioError("invalid_reviewed_reply_event", 409);
      }
      const now = new Date().toISOString();
      const reviewHistory = { event_id: value.event_id, reviewed_at: now, owner_quote: value.owner_quote, conversation: structuredClone(value.conversation), content_revision: contentRevision, package_revision_before: pkg.revision, field_reviews: value.field_reviews.map((review: JsonObject) => ({ ...structuredClone(review), previous_status: pkg.facts.find((fact: JsonObject) => fact.id === review.field_id).status })), reviewed_reply_event_ids: [...reviewedIds], basis: "owner_explicit" };
      for (const review of value.field_reviews) {
        const fact = pkg.facts.find((item: JsonObject) => item.id === review.field_id);
        fact.status = review.decision === "confirmed" ? "confirmed" : "pending";
        fact.confirmed_by = review.decision === "confirmed" ? `conversation:${value.conversation.surface}:${value.conversation.thread_id}` : null;
        if (review.decision === "confirmed") fact.confirmed_at = now; else delete fact.confirmed_at;
        fact.review_note = { event_id: value.event_id, owner_quote: value.owner_quote, conversation: structuredClone(value.conversation), decision: review.decision, ...(review.comment ? { comment: review.comment } : {}), reviewed_at: now };
      }
      pkg.fact_review_history = [...(pkg.fact_review_history ?? []), reviewHistory].slice(-100);
      pkg.reviewed_reply_event_ids = [...new Set([...reviewedBefore, ...reviewedIds])];
      pkg.pending_reply_event_ids = (pkg.pending_reply_event_ids ?? []).filter((id: string) => !pkg.reviewed_reply_event_ids.includes(id));
      pkg.pending_review = pkg.pending_reply_event_ids.length > 0;
      pkg.revision += 1;
      if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
      if (await this.cas(row, document, { id: value.event_id, package_id: pkg.id, kind: "material_review", raw_text: value.owner_quote, request_hash: hash, outcome: "material_fields_reviewed", metadata: { material_review: reviewHistory } })) return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
      const retry = await this.duplicate(value.event_id, hash);
      if (retry) return retry;
    }
    throw new StudioError("material_review_busy_retry_same_event", 409);
  }

  async recordMaterialCorrection(value: unknown): Promise<JsonObject> {
    if (!object(value) || Object.keys(value).some(key => !["event_id", "package_id", "expected_content_revision", "expected_package_revision", "conversation", "owner_quote", "field_updates", "reviewed_reply_event_ids"].includes(key)) || !identifier(value.event_id) || !identifier(value.package_id) || !Number.isSafeInteger(value.expected_content_revision) || value.expected_content_revision < 1 || !Number.isSafeInteger(value.expected_package_revision) || value.expected_package_revision < 1 || !nonempty(value.owner_quote, 6000) || !Array.isArray(value.field_updates) || !value.field_updates.length || value.field_updates.length > 40) throw new StudioError("invalid_material_correction");
    try { validateWorkConversation(value.conversation); } catch (error) { if (error instanceof ExecutionValidationError) throw new StudioError(error.message); throw error; }
    const fieldIds = new Set<string>();
    for (const update of value.field_updates) {
      if (!object(update) || Object.keys(update).some(key => !["field_id", "expected_candidate", "candidate", "decision", "comment"].includes(key)) || !identifier(update.field_id) || fieldIds.has(update.field_id) || !Object.hasOwn(update, "expected_candidate") || !Object.hasOwn(update, "candidate") || !["confirmed", "proposed"].includes(update.decision) || (update.comment !== undefined && !nonempty(update.comment, 3000))) throw new StudioError("invalid_material_field_update");
      if ([update.expected_candidate, update.candidate].some(candidate => new TextEncoder().encode(canonicalJson(candidate)).length > 16000)) throw new StudioError("invalid_material_field_update");
      fieldIds.add(update.field_id);
    }
    const reviewedIds = value.reviewed_reply_event_ids ?? [];
    if (!Array.isArray(reviewedIds) || reviewedIds.length > 100 || reviewedIds.some(id => !identifier(id)) || new Set(reviewedIds).size !== reviewedIds.length) throw new StudioError("invalid_reviewed_reply_event");
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this.row();
      if (!row) throw new StudioError("not_initialized", 409);
      const document = await this.withPendingReviews(JSON.parse(row.body));
      const pkg = document.packages.find(item => item.id === value.package_id);
      if (!pkg) throw new StudioError("package_not_found", 404);
      if (["guided_work", "academic_work"].includes(pkg.content.kind) || !Array.isArray(pkg.facts) || !pkg.facts.length || !Array.isArray(pkg.content.fields)) throw new StudioError("material_correction_requires_fact_package");
      const contentRevision = pkg.content.revision || pkg.revision;
      const conflict = value.expected_content_revision !== contentRevision ? "material_correction_content_revision_conflict" : value.expected_package_revision !== pkg.revision ? "material_correction_package_revision_conflict" : null;
      if (conflict) return this.serviceConflict({ id: value.event_id, package_id: pkg.id, kind: "material_correction", raw_text: value.owner_quote, base_revision: row.revision }, hash, conflict, { content_revision: contentRevision, package_revision: pkg.revision });
      if (pkg.history !== undefined && (!Array.isArray(pkg.history) || pkg.history.length >= 100)) throw new StudioError("material_history_limit_reached", 409);
      if (pkg.fact_review_history !== undefined && !Array.isArray(pkg.fact_review_history)) throw new StudioError("invalid_fact_review_history", 409);
      for (const update of value.field_updates) {
        const field = pkg.content.fields.find((item: JsonObject) => item.id === update.field_id);
        const fact = pkg.facts.find((item: JsonObject) => item.id === update.field_id);
        if (!field || !fact || canonicalJson(field.candidate) !== canonicalJson(update.expected_candidate) || !object(fact.content) || canonicalJson(fact.content.candidate) !== canonicalJson(update.expected_candidate)) throw new StudioError("material_correction_candidate_mismatch", 409);
      }
      const reviewedBefore = new Set<string>(pkg.reviewed_reply_event_ids ?? []);
      for (const id of reviewedIds) {
        const event = await this.event(id);
        if (!event || event.package_id !== pkg.id || !reviewableReply(event) || reviewedBefore.has(id)) throw new StudioError("invalid_reviewed_reply_event", 409);
      }
      const now = new Date().toISOString();
      pkg.history = [...(pkg.history ?? []), { material_event_id: value.event_id, kind: "conversation_correction", content_revision: contentRevision, package_revision: pkg.revision, archived_at: now, content: structuredClone(pkg.content), facts: structuredClone(pkg.facts), reviewed_reply_event_ids: [...reviewedBefore] }];
      const source = `conversation:${value.conversation.surface}:${value.conversation.thread_id}`;
      const eventSource = `event:${value.event_id}`;
      const reviewHistory = { event_id: value.event_id, kind: "candidate_correction", reviewed_at: now, owner_quote: value.owner_quote, conversation: structuredClone(value.conversation), content_revision_before: contentRevision, content_revision_after: contentRevision + 1, package_revision_before: pkg.revision, field_updates: structuredClone(value.field_updates), reviewed_reply_event_ids: [...reviewedIds], reported_by: "agent_report" };
      for (const update of value.field_updates) {
        const field = pkg.content.fields.find((item: JsonObject) => item.id === update.field_id);
        const fact = pkg.facts.find((item: JsonObject) => item.id === update.field_id);
        field.candidate = structuredClone(update.candidate);
        field.source_refs = [...new Set([...(field.source_refs ?? []), source, eventSource])];
        field.status = update.decision === "confirmed" ? "confirmed" : "pending";
        field.user_confirmed_before = update.decision === "confirmed";
        field.confirmation_evidence = update.decision === "confirmed" ? { kind: "conversation_owner_quote", event_id: value.event_id, owner_quote: value.owner_quote, conversation: structuredClone(value.conversation), reported_by: "agent_report" } : null;
        if (update.decision === "confirmed") { field.confirmed_by = source; field.confirmed_at = now; } else { delete field.confirmed_by; delete field.confirmed_at; }
        fact.content = structuredClone(field);
        fact.status = field.status;
        fact.confirmed_by = update.decision === "confirmed" ? source : null;
        if (update.decision === "confirmed") fact.confirmed_at = now; else delete fact.confirmed_at;
        fact.updated_at = now;
        fact.review_note = { event_id: value.event_id, owner_quote: value.owner_quote, conversation: structuredClone(value.conversation), decision: update.decision, ...(update.comment ? { comment: update.comment } : {}), reviewed_at: now, reported_by: "agent_report" };
      }
      pkg.content.revision = contentRevision + 1;
      pkg.content.source_refs = [...new Set([...(pkg.content.source_refs ?? []), source, eventSource])];
      pkg.fact_review_history = [...(pkg.fact_review_history ?? []), reviewHistory].slice(-100);
      pkg.reviewed_reply_event_ids = [...new Set([...reviewedBefore, ...reviewedIds])];
      pkg.pending_reply_event_ids = (pkg.pending_reply_event_ids ?? []).filter((id: string) => !pkg.reviewed_reply_event_ids.includes(id));
      pkg.pending_review = pkg.pending_reply_event_ids.length > 0;
      pkg.revision += 1;
      if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
      if (await this.cas(row, document, { id: value.event_id, package_id: pkg.id, kind: "material_correction", raw_text: value.owner_quote, request_hash: hash, outcome: "material_fields_corrected", metadata: { material_correction: reviewHistory } })) return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
      const retry = await this.duplicate(value.event_id, hash);
      if (retry) return retry;
    }
    throw new StudioError("material_correction_busy_retry_same_event", 409);
  }

  private async cas(row: DocumentRow, next: StudioDocument, event: { id: string; package_id: string | null; kind: string; raw_text: string; request_hash: string; outcome: string; metadata?: JsonObject; require_clear_review_package_id?: string }): Promise<boolean> {
    const now = new Date().toISOString();
    const claim = crypto.randomUUID();
    const result = JSON.stringify({ ...event.metadata, request_hash: event.request_hash, claim, outcome: event.outcome, revision: row.revision + 1, saved_at: now });
    const clearReview = event.require_clear_review_package_id;
    const reviewGuard = clearReview ? ` AND NOT EXISTS (SELECT 1 FROM events AS pending WHERE pending.package_id = ? AND (
      (pending.kind = 'conflict:reply' AND pending.raw_text != '') OR
      json_extract(pending.result, '$.outcome') IN ('reply_pending_review', 'mail_reply_pending_review'))
      AND pending.id NOT IN (SELECT value FROM json_each(?)))` : "";
    const reviewed = clearReview ? next.packages.find((pkg) => pkg.id === clearReview)?.reviewed_reply_event_ids ?? [] : [];
    const statements = [
      this.db.prepare(`INSERT OR IGNORE INTO events (id, package_id, kind, raw_text, base_revision, created_at, result)
        SELECT ?, ?, ?, ?, ?, ?, ? FROM documents WHERE id = 'workspace' AND revision = ?${reviewGuard}`)
        .bind(event.id, event.package_id, event.kind, event.raw_text, row.revision, now, result, row.revision, ...(clearReview ? [clearReview, JSON.stringify(reviewed)] : [])),
      this.db.prepare(`UPDATE documents SET body = ?, revision = ?, updated_at = ?
        WHERE id = 'workspace' AND revision = ?
        AND EXISTS (SELECT 1 FROM events WHERE id = ? AND result = ?)`)
        .bind(JSON.stringify(next), row.revision + 1, now, row.revision, event.id, result),
    ];
    // D1 batch is a transaction. A stale revision inserts no success event.
    const results = await this.db.batch(statements);
    const inserted = results[0].meta.changes === 1;
    const updated = results[1].meta.changes === 1;
    if (inserted !== updated) throw new StudioError("atomic_write_invariant_failed", 503);
    return updated;
  }

  private async conflict(action: StudioAction, requestHash: string): Promise<JsonObject> {
    const snapshot = await this.snapshot();
    const result = JSON.stringify({ request_hash: requestHash, error: "revision_conflict", revision: snapshot.revision, saved_at: new Date().toISOString(), ...(action.step_id ? { step_id: action.step_id } : {}), ...(action.milestone_id ? { milestone_id: action.milestone_id } : {}) });
    await this.db.prepare(`INSERT OR IGNORE INTO events (id, package_id, kind, raw_text, base_revision, created_at, result)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(action.event_id, action.package_id, `conflict:${action.kind}`, action.text ?? "", action.expected_revision, new Date().toISOString(), result).run();
    // A same-ID concurrent request may have won; resolve its actual result.
    const duplicate = await this.duplicate(action.event_id, requestHash);
    if (duplicate) return duplicate;
    throw new StudioError("revision_conflict", 409, { ...snapshot, event_id: action.event_id, raw_preserved: true });
  }

  async apply(value: unknown, actor: string): Promise<JsonObject> {
    validateAction(value);
    const action = value;
    const requestHash = await checksum({ action, actor });
    const duplicate = await this.duplicate(action.event_id, requestHash);
    if (duplicate) return duplicate;
    const row = await this.row();
    if (!row) throw new StudioError("not_initialized", 409);
    if (row.revision !== action.expected_revision) return this.conflict(action, requestHash);
    const reduced = reduceAction(await this.withPendingReviews(JSON.parse(row.body)), action, actor);
    if (new TextEncoder().encode(JSON.stringify(reduced.doc)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
    const advanced = ["confirm", "task_complete"].includes(action.kind) && reduced.doc.current_package_id !== action.package_id;
    const metadata = action.kind === "progress_note" ? { completion_basis: "owner_report", ...(action.milestone_id !== undefined ? { milestone_id: action.milestone_id } : {}) } : action.kind === "milestone_complete" ? { milestone_id: action.milestone_id, completion_basis: "owner_report" } : action.kind.startsWith("work_") ? { step_id: action.step_id ?? null, self_reported: action.kind === "work_finish" } :
      ["confirm", "task_complete", "task_reopen"].includes(action.kind) ? { ...(action.kind === "task_complete" ? { completion_basis: "owner_report" } : {}), next_package_id: advanced ? reduced.doc.current_package_id : null } : undefined;
    if (!await this.cas(row, reduced.doc, { id: action.event_id, package_id: action.package_id, kind: action.kind, raw_text: action.text ?? "", request_hash: requestHash, outcome: reduced.outcome, metadata,
      ...(advanced ? { require_clear_review_package_id: action.package_id! } : {}) })) {
      const retry = await this.duplicate(action.event_id, requestHash);
      if (retry) return retry;
      return this.conflict(action, requestHash);
    }
    return { ...(await this.snapshot()), event: eventView((await this.event(action.event_id))!) };
  }

  async importDocument(value: unknown, expectedChecksum?: string): Promise<JsonObject> {
    validateDocument(value);
    const documentChecksum = await checksum(value);
    if (expectedChecksum !== undefined && expectedChecksum !== documentChecksum) throw new StudioError("checksum_mismatch");
    const now = new Date().toISOString();
    const document = structuredClone(value);
    for (const pkg of document.packages) {
      if (pkg.content.kind === "guided_work") pkg.work = { status: "ready", current_step_id: pkg.work?.current_step_id ?? pkg.content.guide_steps[0].id, answers: {} };
    }
    document.migration = { ...(object(document.migration) ? document.migration : {}), import_checksum: documentChecksum };
    await this.db.prepare("INSERT OR IGNORE INTO documents (id, body, revision, updated_at) VALUES ('workspace', ?, 1, ?)").bind(JSON.stringify(document), now).run();
    const row = (await this.row())!;
    if (JSON.parse(row.body).migration?.import_checksum !== documentChecksum) throw new StudioError("workspace_already_initialized_with_different_content", 409);
    return { ...(await this.snapshot()), import_checksum: documentChecksum };
  }

  async updateSource(value: unknown): Promise<JsonObject> {
    if (!object(value) || !identifier(value.event_id) || !object(value.source_context)) throw new StudioError("invalid_source_update");
    const observed = timestamp(value.observed_at);
    if (observed > Date.now() + 5 * 60 * 1000) throw new StudioError("source_timestamp_is_in_future");
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.row();
      if (!row) throw new StudioError("not_initialized", 409);
      const document = JSON.parse(row.body) as StudioDocument;
      const priorTime = document.source_context?.observed_at;
      if (priorTime && timestamp(priorTime) >= observed) throw new StudioError("source_update_is_not_newer", 409);
      document.source_context = { ...value.source_context, observed_at: value.observed_at };
      const admissions = Array.isArray(document.source_context.tasks) ? reconcileAdmissions(document) : null;
      if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
      if (await this.cas(row, document, { id: value.event_id, package_id: null, kind: "source", raw_text: "", request_hash: hash, outcome: "source_context_updated", ...(admissions ? { metadata: { admissions } } : {}) })) {
        return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
      }
      const retried = await this.duplicate(value.event_id, hash);
      if (retried) return retried;
    }
    throw new StudioError("source_update_busy_retry_same_event", 409);
  }

  /** One-time backfill for an existing snapshot; accepts no supplied tasks,
   * progress, content, or replacement document. Subsequent source refreshes
   * run the same projection inside their own transaction. */
  async registerAdmissionsTasks(value: unknown): Promise<JsonObject> {
    if (!object(value) || Object.keys(value).some(key => !["event_id", "expected_revision"].includes(key)) || !identifier(value.event_id) || !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1) throw new StudioError("invalid_admissions_registration");
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    const row = await this.row();
    if (!row) throw new StudioError("not_initialized", 409);
    if (row.revision !== value.expected_revision) throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    const document = JSON.parse(row.body) as StudioDocument;
    const admissions = reconcileAdmissions(document);
    if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
    if (!await this.cas(row, document, { id: value.event_id, package_id: null, kind: "admissions_source", raw_text: "", request_hash: hash, outcome: "admissions_tasks_registered", metadata: { admissions } })) {
      const retry = await this.duplicate(value.event_id, hash);
      if (retry) return retry;
      throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    }
    return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
  }

  async mergeMail(value: unknown): Promise<JsonObject> {
    if (!object(value) || !identifier(value.event_id) || !identifier(value.package_id) ||
      typeof value.raw_text !== "string" || !value.raw_text.trim() || value.raw_text.length > 12000 ||
      typeof value.source_message_id !== "string" || !/^<[^<>\s]+@[^<>\s]+>$/.test(value.source_message_id) ||
      value.from_address !== "owner@example.com") throw new StudioError("invalid_mail_event");
    const received = timestamp(value.received_at);
    if (received > Date.now() + 5 * 60 * 1000) throw new StudioError("mail_timestamp_is_in_future");
    if (value.package_revision !== undefined && (!Number.isSafeInteger(value.package_revision) || value.package_revision < 1)) throw new StudioError("invalid_mail_package_revision");
    if (value.confirmation_phrase !== undefined && typeof value.confirmation_phrase !== "string") throw new StudioError("invalid_mail_confirmation_phrase");
    const payload = {
      package_id: value.package_id, raw_text: value.raw_text, received_at: value.received_at,
      source_message_id: value.source_message_id, from_address: value.from_address,
      package_revision: value.package_revision ?? null, confirmation_phrase: value.confirmation_phrase ?? null,
    };
    const hash = await checksum(payload);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    for (let attempt = 0; attempt < 4; attempt++) {
      const bySource = await this.db.prepare("SELECT * FROM events WHERE json_extract(result, '$.source_message_id') = ? LIMIT 1").bind(value.source_message_id).first<EventRow>();
      if (bySource) {
        if (JSON.parse(bySource.result).request_hash !== hash) throw new StudioError("mail_message_id_reused_with_different_content", 409);
        return { ...(await this.snapshot()), event: eventView(bySource), idempotent: true };
      }
      const row = await this.row();
      if (!row) throw new StudioError("not_initialized", 409);
      const document = JSON.parse(row.body) as StudioDocument;
      const pkg = document.packages.find((item) => item.id === value.package_id);
      if (!pkg) throw new StudioError("package_not_found", 404);
      let outcome = "mail_reply_pending_review";
      const phrase = pkg.content.confirm_phrase;
      const sourceRevision = pkg.content.revision ?? pkg.revision;
      const explicitPause = ["暂停", "先暂停", "今天不处理", "今天先暂停", "今天先不处理"].includes(value.raw_text.trim());
      if (explicitPause) {
        document.paused = true;
        outcome = "mail_explicit_pause";
      } else if (pkg.content.kind !== "guided_work" && typeof phrase === "string" && phrase && value.confirmation_phrase === phrase &&
        value.raw_text.trim() === phrase && value.package_revision === sourceRevision &&
        document.current_package_id === pkg.id && Array.isArray(pkg.facts) && pkg.facts.length > 0) {
        for (const fact of pkg.facts) {
          if (fact.status !== "confirmed") {
            fact.status = "confirmed";
            fact.confirmed_by = `mail:${value.source_message_id}`;
          }
        }
        pkg.revision += 1;
        outcome = "mail_explicit_fact_group_confirmed";
      }
      if (outcome === "mail_reply_pending_review") {
        pkg.pending_review = true;
        pkg.pending_reply_event_ids = [...new Set([...(pkg.pending_reply_event_ids ?? []), value.event_id])];
      }
      if (await this.cas(row, document, {
        id: value.event_id, package_id: value.package_id, kind: "mail", raw_text: value.raw_text,
        request_hash: hash, outcome, metadata: { source_kind: "school-mail", source_message_id: value.source_message_id, received_at: value.received_at, from_address: value.from_address, package_revision: value.package_revision ?? null },
      })) return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
      const retried = await this.duplicate(value.event_id, hash);
      if (retried) return retried;
    }
    throw new StudioError("mail_merge_busy_retry_same_event", 409);
  }

  async listEvents(packageId: string, cursor: string | null = null, limit = 50): Promise<JsonObject> {
    if (!identifier(packageId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new StudioError("invalid_event_page");
    let after = 0;
    if (cursor !== null) {
      if (cursor.length > 2048) throw new StudioError("invalid_event_cursor");
      try {
        const parsed = decodeCursor(cursor);
        if (parsed.package_id !== packageId || !Number.isSafeInteger(parsed.after) || parsed.after < 0) throw new Error();
        after = parsed.after;
      } catch { throw new StudioError("invalid_event_cursor"); }
    }
    const row = await this.row();
    if (!row) throw new StudioError("not_initialized", 409);
    if (!(JSON.parse(row.body) as StudioDocument).packages.some((pkg) => pkg.id === packageId)) throw new StudioError("package_not_found", 404);
    // Immutable append-only event rows give stable pagination even if new
    // same-millisecond events arrive while the reader is paging old replies.
    const page = await this.db.prepare("SELECT rowid AS sequence, * FROM events WHERE package_id = ? AND rowid > ? ORDER BY rowid ASC LIMIT ?")
      .bind(packageId, after, limit + 1).all<EventRow & { sequence: number }>();
    const visible = page.results.slice(0, limit);
    const next = page.results.length > limit ? encodeCursor({ package_id: packageId, after: visible[visible.length - 1].sequence }) : null;
    return { package_id: packageId, events: visible.map((event) => { const output = eventView(event); delete output.sequence; return output; }), next_cursor: next, limit };
  }

  async updateWorkplan(value: unknown): Promise<JsonObject> {
    if (!object(value) || !identifier(value.event_id) || !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1 ||
      !Array.isArray(value.packages) || value.packages.length > 40 || !object(value.plan) || !object(value.source_updates)) throw new StudioError("invalid_workplan_update");
    const incomingIds = new Set<string>();
    for (const pkg of value.packages) {
      validateGuidedPackage(pkg);
      if (incomingIds.has(pkg.id)) throw new StudioError("duplicate_work_package_id");
      incomingIds.add(pkg.id);
    }
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    const row = await this.row();
    if (!row) throw new StudioError("not_initialized", 409);
    if (row.revision !== value.expected_revision) throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    const document = JSON.parse(row.body) as StudioDocument;
    const registered: string[] = [];
    for (const input of value.packages) {
      const existing = document.packages.find((pkg) => pkg.id === input.id);
      if (existing) {
        if (existing.content.kind !== "guided_work" || canonicalJson(existing.content) !== canonicalJson(input.content)) throw new StudioError("work_package_id_already_has_different_content", 409);
        // Comparing content only deliberately preserves every answer, finish,
        // revision and selected step on a repeated registration.
        continue;
      }
      const pkg = structuredClone(input);
      pkg.work = { status: "ready", current_step_id: input.work?.current_step_id ?? input.content.guide_steps[0].id, answers: {} };
      document.packages.push(pkg);
      registered.push(pkg.id);
    }
    document.plan = validateSuggestedPlan(value.plan, new Set(document.packages.map((pkg) => pkg.id)));
    document.source_updates = mergeSourceUpdates(document.source_updates, value.source_updates);
    let lms;
    if (value.source_updates.academics) {
      try { lms = reconcileLmsTasks(document as any, document.source_updates.academics); }
      catch { throw new StudioError("invalid_lms_task_reconciliation", 409); }
    }
    if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
    if (!await this.cas(row, document, { id: value.event_id, package_id: null, kind: "workplan", raw_text: "", request_hash: hash, outcome: "workplan_suggestions_updated", metadata: { registered_package_ids: registered, source_names: Object.keys(value.source_updates), plan_date: document.plan.date, ...(lms ? { lms } : {}) } })) {
      const retry = await this.duplicate(value.event_id, hash);
      if (retry) return retry;
      throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    }
    return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
  }

  async updateAcademicTasks(value: unknown): Promise<JsonObject> {
    if (!object(value)) throw new StudioError("invalid_academic_tasks_update");
    academicKeys(value, ["event_id", "expected_revision", "tasks"]);
    if (!identifier(value.event_id) || !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1 || !Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > 40) throw new StudioError("invalid_academic_tasks_update");
    const packageIds = new Set<string>();
    for (const update of value.tasks) {
      if (!object(update)) throw new StudioError("invalid_academic_tasks_update");
      academicKeys(update, ["package_id", "expected_source_revision", "task", "create_reference"]);
      if (!identifier(update.package_id) || packageIds.has(update.package_id) || !Number.isSafeInteger(update.expected_source_revision) || update.expected_source_revision < 0 || (update.create_reference !== undefined && typeof update.create_reference !== "boolean")) throw new StudioError("invalid_academic_tasks_update");
      packageIds.add(update.package_id);
      validateAcademicTask(update.task);
    }
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    const row = await this.row();
    if (!row) throw new StudioError("not_initialized", 409);
    if (row.revision !== value.expected_revision) throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    const document = JSON.parse(row.body) as StudioDocument;
    const now = new Date().toISOString();
    const revisions: { package_id: string; source_revision: number }[] = [];
    for (const update of value.tasks) {
      let pkg = document.packages.find((item) => item.id === update.package_id);
      if (!pkg) {
        if (update.create_reference !== true) throw new StudioError("package_not_found", 404);
        if (update.expected_source_revision !== 0) throw new StudioError("academic_source_revision_conflict", 409);
        if (!formalAcademicReferenceTask(update.task)) throw new StudioError("academic_reference_requires_verified_assignment");
        pkg = { id: update.package_id, revision: 1, content: { kind: "academic_work", domain: "academics", title: update.task.title, fields: [] }, facts: [] };
        document.packages.push(pkg);
      }
      if (!["guided_work", "academic_work"].includes(pkg.content.kind) || normalizedPackageDomain(pkg as ProgressPackage) !== "academics") throw new StudioError("academic_task_requires_academic_work");
      const previous = academicTaskOf(pkg as ProgressPackage);
      if (pkg.academic_task !== undefined && !previous) throw new StudioError("invalid_saved_academic_task", 409);
      const sourceRevision = previous?.source_revision ?? 0;
      if (sourceRevision !== update.expected_source_revision) throw new StudioError("academic_source_revision_conflict", 409);
      if (pkg.academic_source_history !== undefined && !Array.isArray(pkg.academic_source_history)) throw new StudioError("invalid_academic_source_history", 409);
      if (previous && (pkg.academic_source_history?.length ?? 0) >= 30) throw new StudioError("academic_source_history_limit_reached", 409);
      if (previous) pkg.academic_source_history = [...(pkg.academic_source_history ?? []), structuredClone(previous)];
      pkg.academic_task = { ...structuredClone(update.task), source_revision: sourceRevision + 1, sourced_at: now };
      revisions.push({ package_id: pkg.id, source_revision: sourceRevision + 1 });
    }
    if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
    if (!await this.cas(row, document, { id: value.event_id, package_id: null, kind: "academic_tasks", raw_text: "", request_hash: hash, outcome: "academic_tasks_sources_updated", metadata: { updated_package_ids: [...packageIds], source_revisions: revisions } })) {
      const retry = await this.duplicate(value.event_id, hash);
      if (retry) return retry;
      throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    }
    return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
  }

  async updateMaterial(value: unknown): Promise<JsonObject> {
    if (object(value) && value.content?.kind === "work_item") throw new StudioError("work_item_is_not_fact_material");
    if (object(value) && value.content?.kind === "admissions_work") throw new StudioError("admissions_work_is_not_fact_material");
    if (object(value) && value.content?.kind === "guided_work") throw new StudioError("guided_work_is_not_fact_material");
    if (object(value) && value.content?.kind === "academic_work") throw new StudioError("academic_work_is_not_fact_material");
    if (!object(value) || !identifier(value.event_id) || !identifier(value.package_id) ||
      !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1 ||
      !Number.isSafeInteger(value.expected_content_revision) || value.expected_content_revision < 1 ||
      !object(value.content) || typeof value.content.title !== "string" || !value.content.title.trim() || value.content.title.length > 300 ||
      !Array.isArray(value.content.fields) || value.content.fields.length < 1 || value.content.fields.length > 40 ||
      !sourceRefs(value.content.source_refs) || !Array.isArray(value.facts) || value.facts.length !== value.content.fields.length ||
      !Array.isArray(value.reviewed_reply_event_ids) || value.reviewed_reply_event_ids.length > 100 ||
      value.reviewed_reply_event_ids.some((id: unknown) => !identifier(id)) ||
      new Set(value.reviewed_reply_event_ids).size !== value.reviewed_reply_event_ids.length) throw new StudioError("invalid_material_update");
    const fields = value.content.fields as JsonObject[];
    const fieldIds = new Set<string>();
    for (const field of fields) {
      if (!object(field) || !identifier(field.id) || fieldIds.has(field.id) || typeof field.question !== "string" || !field.question.trim() || field.question.length > 2000 ||
        !("candidate" in field) || !sourceRefs(field.source_refs) || new TextEncoder().encode(canonicalJson(field.candidate)).length > 16000) throw new StudioError("invalid_material_field");
      fieldIds.add(field.id);
    }
    const factIds = new Set<string>();
    for (const fact of value.facts) {
      const field = object(fact) && fields.find((item) => item.id === fact.id);
      // Current clients use the full Field contract, as do seed facts and the
      // browser's snapshot validator. Accept old bare-candidate inputs only as
      // a compatibility path; storage always uses the normalized full Field.
      const matches = field && (object(fact.content)
        ? fact.content.id === field.id && canonicalJson(fact.content.candidate) === canonicalJson(field.candidate) &&
          canonicalJson(fact.content.source_refs) === canonicalJson(field.source_refs) &&
          (fact.content.question === undefined || fact.content.question === field.question)
        : canonicalJson(fact.content) === canonicalJson(field.candidate));
      if (!field || factIds.has(fact.id) || !matches ||
        (fact.status !== undefined && fact.status !== "pending") || (fact.confirmed_by !== undefined && fact.confirmed_by !== null)) throw new StudioError("new_material_facts_must_be_pending_and_match_fields");
      factIds.add(fact.id);
    }
    if (typeof value.content.confirm_phrase !== "string" || !value.content.confirm_phrase.trim() || value.content.confirm_phrase.length > 1000) throw new StudioError("material_confirmation_phrase_required");
    const hash = await checksum(value);
    const duplicate = await this.duplicate(value.event_id, hash);
    if (duplicate) return duplicate;
    const row = await this.row();
    if (!row) throw new StudioError("not_initialized", 409);
    if (row.revision !== value.expected_revision) throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    const document = JSON.parse(row.body) as StudioDocument;
    const pkg = document.packages.find((item) => item.id === value.package_id);
    if (!pkg) throw new StudioError("package_not_found", 404);
    if (pkg.content.kind === "guided_work") throw new StudioError("guided_work_is_not_fact_material");
    if (pkg.content.kind === "academic_work") throw new StudioError("academic_work_is_not_fact_material");
    if (pkg.content.kind === "work_item") throw new StudioError("work_item_is_not_fact_material");
    if (pkg.content.kind === "admissions_work") throw new StudioError("admissions_work_is_not_fact_material");
    const oldContentRevision = pkg.content.revision ?? pkg.revision;
    if (oldContentRevision !== value.expected_content_revision) throw new StudioError("content_revision_conflict", 409);
    if (pkg.history && (!Array.isArray(pkg.history) || pkg.history.length >= 100)) throw new StudioError("material_history_limit_reached", 409);
    const reviewedBefore = new Set<string>(pkg.reviewed_reply_event_ids ?? []);
    for (const id of value.reviewed_reply_event_ids) {
      const event = await this.event(id);
      if (!event || event.package_id !== pkg.id || !reviewableReply(event) || reviewedBefore.has(id)) throw new StudioError("invalid_reviewed_reply_event", 409);
      if (!value.content.source_refs.includes(id) && !value.content.source_refs.includes(`event:${id}`)) throw new StudioError("reviewed_reply_source_reference_required");
    }
    const now = new Date().toISOString();
    pkg.history = [...(pkg.history ?? []), {
      material_event_id: value.event_id, content_revision: oldContentRevision, package_revision: pkg.revision,
      archived_at: now, content: structuredClone(pkg.content), facts: structuredClone(pkg.facts ?? []),
      reviewed_reply_event_ids: [...reviewedBefore],
    }];
    pkg.content = structuredClone(value.content);
    pkg.content.revision = oldContentRevision + 1;
    pkg.content.package_id = pkg.id;
    pkg.content.status = "pending_user_review";
    pkg.content.fields = fields.map((field) => {
      const candidate = structuredClone(field);
      candidate.status = "pending";
      candidate.user_confirmed_before = false;
      candidate.confirmation_evidence = null;
      delete candidate.confirmed_by;
      delete candidate.confirmed_at;
      return candidate;
    });
    pkg.facts = pkg.content.fields.map((field: JsonObject) => ({ id: field.id, package_id: pkg.id, content: structuredClone(field), status: "pending", confirmed_by: null, updated_at: now }));
    pkg.revision += 1;
    pkg.reviewed_reply_event_ids = [...new Set([...reviewedBefore, ...value.reviewed_reply_event_ids])];
    pkg.pending_reply_event_ids = (pkg.pending_reply_event_ids ?? []).filter((id: string) => !pkg.reviewed_reply_event_ids.includes(id));
    pkg.pending_review = pkg.pending_reply_event_ids.length > 0;
    if (new TextEncoder().encode(JSON.stringify(document)).length > 1500000) throw new StudioError("workspace_history_storage_limit_reached", 409);
    if (!await this.cas(row, document, { id: value.event_id, package_id: pkg.id, kind: "material", raw_text: "", request_hash: hash, outcome: "material_ready_for_user_review", metadata: { content_revision: pkg.content.revision, reviewed_reply_event_ids: value.reviewed_reply_event_ids } })) {
      const retry = await this.duplicate(value.event_id, hash);
      if (retry) return retry;
      throw new StudioError("revision_conflict", 409, { ...(await this.snapshot()), retry_same_event_id: true });
    }
    return { ...(await this.snapshot()), event: eventView((await this.event(value.event_id))!) };
  }
}
