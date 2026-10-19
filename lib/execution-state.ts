export type WorkConversation = { surface: "chatgpt" | "codex"; thread_id: string; title: string; url?: string };
export type ExecutionEvidence = { kind: "file" | "url" | "conversation" | "owner_statement" | "submission_receipt"; title: string; locator: string; observed_at: string; quote?: string };
export type ExecutionCompletionBasis = { kind: "owner_explicit" | "verified_result"; detail: string; evidence_indices: number[] };
export type ExecutionStatus = "ready" | "in_progress" | "blocked" | "waiting" | "completed" | "submitted";
export type ExecutionUpdate = { event_id: string; package_id: string; expected_execution_revision: number; expected_content_revision: number; expected_source_revision?: number; status: ExecutionStatus; summary: string; next_action: string | null; evidence: ExecutionEvidence[]; conversation?: WorkConversation; completion_basis?: ExecutionCompletionBasis; milestone_id?: string };
export type ExecutionState = { revision: number; event_id: string; updated_at: string; status: ExecutionStatus; summary: string; next_action: string | null; evidence: ExecutionEvidence[]; conversation?: WorkConversation; completion_basis?: ExecutionCompletionBasis; reported_by: "agent_report"; content_revision: number; academic_source_revision?: number; academic_goal_key?: string };
export class ExecutionValidationError extends Error {}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && !!value.trim() && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const id = (value: unknown): value is string => text(value, 200) && !/[\r\n\t]/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
function fail(code: string): never { throw new ExecutionValidationError(code); }
function keys(value: Record<string, any>, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) fail("unsupported_execution_field"); }
function at(value: unknown, now?: Date): value is string { return typeof value === "string" && value.length <= 80 && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && (!now || Date.parse(value) <= now.valueOf() + 300000); }
function path(value: unknown): value is string { return text(value, 4000) && value.startsWith("/") && !value.startsWith("//") && !/[\r\n\t]/.test(value) && !value.split("/").some(part => part === "." || part === ".."); }
function https(value: unknown): value is string {
  if (!text(value, 4000) || /[\r\n\t]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /token|auth|secret|password|cookie|signature|api.?key/i.test(key)); } catch { return false; }
}

/** Validates references, not whether a server has read the conversation. */
export function validateWorkConversation(value: unknown): asserts value is WorkConversation {
  if (!object(value)) fail("invalid_work_conversation");
  keys(value, ["surface", "thread_id", "title", "url"]);
  if (!["chatgpt", "codex"].includes(value.surface) || !id(value.thread_id) || !text(value.title, 500)) fail("invalid_work_conversation");
  if (value.url !== undefined) {
    if (!text(value.url, 4000)) fail("invalid_work_conversation_url");
    try {
      const url = new URL(value.url);
      if (url.username || url.password || url.hash) fail("invalid_work_conversation_url");
      const pathname = decodeURIComponent(url.pathname).replace(/\/$/, "");
      if (value.surface === "chatgpt") {
        if (!https(value.url) || url.hostname !== "chatgpt.com" || !pathname.endsWith(`/c/${value.thread_id}`)) fail("invalid_work_conversation_url");
      } else if (url.protocol !== "codex:" || url.hostname !== "threads" || pathname !== `/${value.thread_id}` || url.search) fail("invalid_work_conversation_url");
    } catch (error) { if (error instanceof ExecutionValidationError) throw error; fail("invalid_work_conversation_url"); }
  }
}

export function hasResultEvidence(evidence: ExecutionEvidence[]): boolean {
  return evidence.some(item => ["file", "url", "submission_receipt", "owner_statement"].includes(item.kind) && text(item.quote, 6000));
}

/** The caller reports observed work. These checks never imply that the storage
 * server opened a file, assessed mastery, submitted anything or read a message. */
export function parseExecutionUpdate(value: unknown, now = new Date()): ExecutionUpdate {
  if (!object(value)) fail("invalid_execution_update");
  keys(value, ["event_id", "package_id", "expected_execution_revision", "expected_content_revision", "expected_source_revision", "status", "summary", "next_action", "evidence", "conversation", "completion_basis", "milestone_id"]);
  if (!id(value.event_id) || !id(value.package_id) || !Number.isSafeInteger(value.expected_execution_revision) || value.expected_execution_revision < 0 || !Number.isSafeInteger(value.expected_content_revision) || value.expected_content_revision < 1 ||
    (value.expected_source_revision !== undefined && (!Number.isSafeInteger(value.expected_source_revision) || value.expected_source_revision < 1)) ||
    !["ready", "in_progress", "blocked", "waiting", "completed", "submitted"].includes(value.status) || !text(value.summary, 12000) ||
    (value.next_action !== null && !text(value.next_action, 4000)) || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 20 ||
    (value.milestone_id !== undefined && !id(value.milestone_id))) fail("invalid_execution_update");
  if (["ready", "in_progress", "blocked", "waiting"].includes(value.status) && !text(value.next_action, 4000)) fail("execution_next_action_required");
  for (const item of value.evidence) {
    if (!object(item)) fail("invalid_execution_evidence");
    keys(item, ["kind", "title", "locator", "observed_at", "quote"]);
    if (!["file", "url", "conversation", "owner_statement", "submission_receipt"].includes(item.kind) || !text(item.title, 500) || !text(item.locator, 4000) || !at(item.observed_at, now) || (item.quote !== undefined && !text(item.quote, 6000))) fail("invalid_execution_evidence");
    if (item.kind === "file" && !path(item.locator)) fail("invalid_execution_evidence");
    if (item.kind === "url" && !https(item.locator)) fail("invalid_execution_evidence");
    if (item.kind === "submission_receipt" && ((!https(item.locator) && !path(item.locator)) || !text(item.quote, 6000))) fail("invalid_submission_receipt");
    if (item.kind === "owner_statement" && !text(item.quote, 6000)) fail("owner_statement_quote_required");
  }
  if (value.conversation !== undefined) validateWorkConversation(value.conversation);
  if (value.completion_basis !== undefined) {
    const basis = value.completion_basis;
    if (!object(basis)) fail("invalid_execution_completion_basis");
    keys(basis, ["kind", "detail", "evidence_indices"]);
    if (!["owner_explicit", "verified_result"].includes(basis.kind) || !text(basis.detail, 6000) || !Array.isArray(basis.evidence_indices) || !basis.evidence_indices.length || new Set(basis.evidence_indices).size !== basis.evidence_indices.length || basis.evidence_indices.some((index: unknown) => !Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= value.evidence.length)) fail("invalid_execution_completion_basis");
    const referenced: ExecutionEvidence[] = basis.evidence_indices.map((index: number) => value.evidence[index]);
    if (basis.kind === "owner_explicit" && !referenced.some(item => item.kind === "owner_statement" && text(item.quote, 6000))) fail("execution_owner_confirmation_required");
    if (basis.kind === "verified_result" && !referenced.some(item => ["file", "url"].includes(item.kind) && text(item.quote, 6000))) fail("execution_result_evidence_required");
  }
  if (["completed", "submitted"].includes(value.status) && !value.completion_basis) fail("execution_completion_basis_required");
  if (value.status === "submitted" && !value.evidence.some((item: ExecutionEvidence) => item.kind === "submission_receipt")) fail("execution_submission_receipt_required");
  if (value.milestone_id !== undefined && !hasResultEvidence(value.evidence)) fail("execution_milestone_evidence_required");
  return structuredClone(value) as ExecutionUpdate;
}

export function academicGoalKey(task: Record<string, any>): string {
  return JSON.stringify([task.id, task.kind, task.deliverables]);
}
export function executionOf(pkg: { execution?: unknown; content?: unknown; revision?: number; academic_task?: unknown; academic_source_history?: unknown; facts?: unknown; pending_review?: unknown }): ExecutionState | null {
  const value = pkg.execution;
  if (!object(value) || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.reported_by !== "agent_report" || !at(value.updated_at)) return null;
  const { revision, updated_at, reported_by, content_revision, academic_source_revision, academic_goal_key, ...report } = value;
  try {
    parseExecutionUpdate({ ...report, package_id: "stored-execution", expected_execution_revision: revision - 1, expected_content_revision: content_revision, ...(academic_source_revision !== undefined ? { expected_source_revision: academic_source_revision } : {}) });
    const currentContent = (object(pkg.content) && pkg.content.revision) || pkg.revision;
    if (currentContent !== undefined && currentContent !== content_revision) return null;
    const currentSource = object(pkg.academic_task) ? pkg.academic_task.source_revision : undefined;
    if (currentSource !== undefined && currentSource !== academic_source_revision) {
      const old = Array.isArray(pkg.academic_source_history) ? pkg.academic_source_history.find(task => object(task) && task.source_revision === academic_source_revision) : null;
      const goal = typeof academic_goal_key === 'string' ? academic_goal_key : old && academicGoalKey(old);
      if (!goal || !object(pkg.academic_task) || goal !== academicGoalKey(pkg.academic_task)) return null;
    }
    const material = object(pkg.content) && !["guided_work", "academic_work"].includes(pkg.content.kind) && Array.isArray(pkg.facts) && pkg.facts.length > 0;
    if (material && (value.status === "submitted" || value.status === "completed" && (pkg.pending_review === true || (pkg.facts as unknown[]).some(fact => !object(fact) || fact.status !== "confirmed")))) return null;
    return value as ExecutionState;
  } catch { return null; }
}
