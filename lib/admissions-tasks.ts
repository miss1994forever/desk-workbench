/** Bounded projection of the already-authorized Feishu table. Source status is
 * never the owner's execution status, and source dates are planning dates. */
export const ADMISSIONS_SOURCE = { app_token: "ExampleFeishuBase", table_id: "tblExampleTasks" } as const;
export const ADMISSIONS_SOURCE_URL = `https://my.feishu.cn/base/${ADMISSIONS_SOURCE.app_token}?table=${ADMISSIONS_SOURCE.table_id}`;
export type AdmissionsSourceStatus = "Not Started" | "In Progress" | "Waiting" | "Blocked" | "Done";
export type AdmissionsTask = {
  record_id: string; title: string; source_status: AdmissionsSourceStatus; category: string; priority: string;
  next_action: string; internal_due_date: string | null; due: { at: string | null; kind: "source_plan" };
  source_url: string; source_modified_at: string | number | null; source_revision: number; observed_at: string;
  source_present: boolean; represented_by_package_id?: string;
};
type Package = { id: string; content: Record<string, any>; facts?: unknown[]; admissions_task?: unknown; [key: string]: any };
type Document = { packages: Package[]; source_context?: Record<string, any>; [key: string]: any };
type SourceRecord = Omit<AdmissionsTask, "source_revision" | "observed_at" | "source_present" | "represented_by_package_id">;
export class AdmissionsSourceError extends Error {}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && value.length <= max && (empty || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const recordId = (value: unknown): value is string => typeof value === "string" && /^rec[A-Za-z0-9]{4,100}$/.test(value);
const at = (value: unknown): value is string => typeof value === "string" && value.length <= 80 && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const statuses = ["Not Started", "In Progress", "Waiting", "Blocked", "Done"];
function fail(code: string): never { throw new AdmissionsSourceError(code); }
function sourceUrl(value: unknown): value is string {
  if (!text(value, 2000)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "my.feishu.cn" && !url.username && !url.password && !url.port && !url.hash && url.pathname === `/base/${ADMISSIONS_SOURCE.app_token}` && url.searchParams.getAll("table").length === 1 && url.searchParams.get("table") === ADMISSIONS_SOURCE.table_id && [...url.searchParams.keys()].every(key => key === "table"); } catch { return false; }
}
function validSource(value: unknown): boolean {
  if (!object(value) || !recordId(value.record_id) || !text(value.title, 300) || !statuses.includes(value.source_status) || !text(value.category, 100) || !text(value.priority, 40, true) || !text(value.next_action, 12000, true) || !sourceUrl(value.source_url) || (value.internal_due_date !== null && !date(value.internal_due_date))) return false;
  const modified = value.source_modified_at;
  return (modified === null || typeof modified === "number" && Number.isSafeInteger(modified) && modified >= 0 || at(modified)) && object(value.due) && value.due.kind === "source_plan" && value.due.at === value.internal_due_date;
}

export function admissionsTaskOf(pkg: { content?: unknown; admissions_task?: unknown }): AdmissionsTask | null {
  const task = pkg.admissions_task;
  if (!object(pkg.content) || pkg.content.kind !== "admissions_work" || pkg.content.domain !== "admissions" || !object(task) || !validSource(task) || !Number.isSafeInteger(task.source_revision) || task.source_revision < 1 || !at(task.observed_at) || typeof task.source_present !== "boolean" || (task.represented_by_package_id !== undefined && !text(task.represented_by_package_id, 160))) return null;
  return task as AdmissionsTask;
}

/** Whether a source task can be suggested, independently of owner completion. */
export function admissionsSourceAvailability(task: AdmissionsTask): "actionable" | "waiting" | "source_done" | "source_missing" | "represented" {
  if (task.represented_by_package_id || task.category === "Research") return "represented";
  if (!task.source_present) return "source_missing";
  if (task.source_status === "Done") return "source_done";
  if (task.source_status === "Waiting") return "waiting";
  return "actionable";
}

export function admissionsPackageId(record_id: string): string {
  if (!recordId(record_id)) fail("invalid_admissions_record_id");
  return `admissions-${record_id}`;
}

function readSource(context: Record<string, any>, now: string): { records: SourceRecord[]; observed_at: string } {
  if (!Array.isArray(context.tasks) || context.tasks.length > 500) fail("admissions_source_tasks_required");
  const observed_at = context.observed_at ?? context.last_synced_at;
  if (!at(observed_at) || Date.parse(observed_at) > Date.parse(now) + 300000) fail("invalid_admissions_source_time");
  const seen = new Set<string>();
  const records = context.tasks.map((input: unknown) => {
    if (!object(input)) fail("invalid_admissions_source_task");
    const task: SourceRecord = { record_id: input.id, title: input.title, source_status: input.status, category: input.category, priority: input.priority ?? "", next_action: input.next_action ?? "", internal_due_date: input.internal_due_date ?? null,
      due: { at: input.internal_due_date ?? null, kind: "source_plan" }, source_url: input.source_url, source_modified_at: input.source_modified_at ?? null };
    if (!validSource(task) || seen.has(task.record_id)) fail("invalid_admissions_source_task");
    if (input.domain !== undefined && !["research", "admissions"].includes(input.domain)) fail("invalid_admissions_source_domain");
    if (input.domain === "research" && input.category !== "Research") fail("ambiguous_admissions_source_domain");
    seen.add(task.record_id);
    return task;
  });
  return { records, observed_at };
}

// These are actual pre-existing research/source associations from the reviewed
// project intake, not title similarity or an inferred completion relationship.
const RESEARCH_RECORDS: Record<string, string> = {
  "sample-research": "recvvuCT16DIXF", "research_topic": "reczz28NjjzFafWJ",
};
function domain(pkg: Package): string { return pkg.content.domain || "admissions"; }
function sourceData(task: AdmissionsTask): string {
  const { source_revision, observed_at, ...data } = task;
  return JSON.stringify(data);
}

/** Mutates only source metadata, support links and newly-created references.
 * Existing answers, evidence, confirmations, selection and rewards are opaque. */
export function reconcileAdmissionsSource(document: Document, now = new Date().toISOString()): { registered_package_ids: string[]; updated_package_ids: string[]; represented_record_ids: string[]; source_task_count: number; unfinished_source_task_count: number } {
  if (!object(document.source_context)) fail("admissions_source_tasks_required");
  const { records, observed_at } = readSource(document.source_context, now);
  const represented = new Map<string, string>();
  for (const pkg of document.packages) {
    const rid = pkg.content.task_record_id;
    const material = (pkg.facts?.length ?? 0) > 0 && pkg.content.kind !== "guided_work";
    if (material && recordId(rid)) pkg.supports_task_record_id = rid;
    if (!material && pkg.content.kind !== "admissions_work" && recordId(rid)) represented.set(rid, pkg.id);
    const explicit = domain(pkg) === "research" ? RESEARCH_RECORDS[pkg.content.project_key] : undefined;
    if (explicit) represented.set(explicit, pkg.id);
  }
  const registered_package_ids: string[] = [], updated_package_ids: string[] = [];
  const sourceIds = new Set(records.map(task => task.record_id));
  for (const source of records) {
    const matches = document.packages.filter(pkg => admissionsTaskOf(pkg)?.record_id === source.record_id);
    if (matches.length > 1) fail("duplicate_admissions_source_binding");
    let pkg = matches[0];
    const other = represented.get(source.record_id);
    if (!pkg && (source.category === "Research" || source.source_status === "Done" || other)) continue;
    if (!pkg) {
      const id = admissionsPackageId(source.record_id);
      if (document.packages.some(item => item.id === id)) fail("admissions_package_id_collision");
      pkg = { id, revision: 1, content: { kind: "admissions_work", domain: "admissions", revision: 1, title: source.title, fields: [] }, facts: [] };
      document.packages.push(pkg); registered_package_ids.push(id);
    }
    const prior = admissionsTaskOf(pkg);
    const task: AdmissionsTask = { ...source, source_revision: prior?.source_revision ?? 1, observed_at, source_present: true, ...(other ? { represented_by_package_id: other } : {}) };
    if (prior && sourceData(prior) !== sourceData(task)) {
      task.source_revision += 1;
      pkg.admissions_source_history = [...(pkg.admissions_source_history ?? []), structuredClone(prior)].slice(-30);
      updated_package_ids.push(pkg.id);
    }
    // The source title is displayed via admissionsTaskOf; stable content stays
    // intact so a source refresh never invalidates or overwrites owner work.
    pkg.admissions_task = task;
  }
  for (const pkg of document.packages) {
    const prior = admissionsTaskOf(pkg);
    if (prior && !sourceIds.has(prior.record_id) && prior.source_present) {
      pkg.admissions_source_history = [...(pkg.admissions_source_history ?? []), structuredClone(prior)].slice(-30);
      pkg.admissions_task = { ...prior, source_present: false, source_revision: prior.source_revision + 1, observed_at };
      updated_package_ids.push(pkg.id);
    }
  }
  return { registered_package_ids, updated_package_ids, represented_record_ids: records.filter(task => represented.has(task.record_id)).map(task => task.record_id), source_task_count: records.filter(task => task.category !== "Research").length, unfinished_source_task_count: records.filter(task => task.category !== "Research" && task.source_status !== "Done").length };
}

/** An import may carry source references, never pretend to carry owner work. */
export function validateAdmissionsReference(value: unknown): void {
  if (!object(value) || !object(value.content) || Object.keys(value).some(key => !["id", "revision", "content", "facts", "admissions_task"].includes(key)) || Object.keys(value.content).some(key => !["kind", "domain", "revision", "title", "fields"].includes(key)) || value.id !== admissionsPackageId(value.admissions_task?.record_id) || value.revision !== 1 || value.content.revision !== 1 || !text(value.content.title, 300) || !Array.isArray(value.content.fields) || value.content.fields.length || !Array.isArray(value.facts) || value.facts.length || !admissionsTaskOf(value)) fail("invalid_admissions_reference");
}
