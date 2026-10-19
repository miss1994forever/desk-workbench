/** Shared display and navigation rules. A finished work session is never a
 * completed task, and unresolved corrections keep material in the queue. */
import { executionOf } from "./execution-state";
import { admissionsTaskOf, admissionsSourceAvailability } from "./admissions-tasks";
export type ProgressNote = { event_id: string; text: string; saved_at: string; saved_by: string; basis: "owner_report"; milestone_id?: string };
export type AcademicTaskSource = { id: string; title: string; url?: string; path?: string; detail?: string };
export type AcademicTask = {
  id: string; kind: "assignment" | "study" | "assignment_candidate"; title: string; course_name: string; deliverables: string[];
  sources: AcademicTaskSource[]; source_refs: string[]; due?: { at: string | null; kind: "platform_deadline" | "none_verified"; source_id?: string };
  workspace_path?: string; scope_note?: string; source_revision: number; sourced_at: string;
};
export type ProgressPackage = {
  id: string;
  content: { kind?: string; domain?: string; revision?: number };
  facts?: { status?: string }[];
  pending_review?: unknown;
  pending_reply_event_ids?: string[];
  reviewed_reply_event_ids?: string[];
  work?: { status?: string; answers?: Record<string, unknown> };
  task_completion?: { status?: string; [key: string]: unknown };
  progress_notes?: ProgressNote[];
  academic_task?: unknown;
  academic_source_history?: unknown;
  execution?: unknown;
  admissions_task?: unknown;
  supports_task_record_id?: string;
};

export type PackageProgress = {
  status: "not_started" | "in_progress" | "blocked" | "waiting" | "submitted" | "session_paused" | "completed" | "confirmed_material" | "pending_review";
  label: string;
  complete: boolean;
};

export function normalizedPackageDomain(pkg: Pick<ProgressPackage, "content">): string {
  const domain = pkg.content.domain || "admissions";
  if (["academic", "coursework", "courses"].includes(domain)) return "academics";
  if (["application", "applications"].includes(domain)) return "admissions";
  return domain;
}

export function hasPendingReview(pkg: ProgressPackage): boolean {
  const reviewed = new Set(pkg.reviewed_reply_event_ids ?? []);
  return pkg.pending_review === true || !!pkg.pending_reply_event_ids?.some((id) => !reviewed.has(id));
}

/** Source descriptions never inherit completion of a legacy status-check goal. */
export function academicTaskOf(pkg: ProgressPackage): AcademicTask | null {
  if (!["guided_work", "academic_work"].includes(pkg.content.kind || "") || normalizedPackageDomain(pkg) !== "academics") return null;
  const task = pkg.academic_task as Partial<AcademicTask> | null;
  if (!task || typeof task !== "object" || Array.isArray(task) || typeof task.id !== "string" || !task.id ||
    !["assignment", "study", "assignment_candidate"].includes(task.kind || "") || typeof task.title !== "string" || !task.title.trim() ||
    typeof task.course_name !== "string" || !task.course_name.trim() || !Number.isSafeInteger(task.source_revision) || task.source_revision! < 1 ||
    typeof task.sourced_at !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(task.sourced_at) || !Number.isFinite(Date.parse(task.sourced_at)) ||
    !Array.isArray(task.deliverables) || !task.deliverables.length || task.deliverables.length > 6 || task.deliverables.some(item => typeof item !== "string" || !item.trim()) ||
    !Array.isArray(task.sources) || !task.sources.length || task.sources.some(source => !source || typeof source.id !== "string" || typeof source.title !== "string" || !source.title.trim()) ||
    !Array.isArray(task.source_refs) || !task.source_refs.length || task.source_refs.some(id => !task.sources!.some(source => source.id === id))) return null;
  return task as AcademicTask;
}

export function packageProgress(pkg: ProgressPackage): PackageProgress {
  if (hasPendingReview(pkg)) return { status: "pending_review", label: "有补充待核对", complete: false };
  const factMaterial = !["guided_work", "academic_work"].includes(pkg.content.kind || "") && !!pkg.facts?.length;
  // The explicit per-field confirmation remains authoritative for facts.
  // A previous agent progress report cannot reopen confirmed material, and
  // generic completion cannot silently confirm unreviewed candidate fields.
  if (factMaterial && pkg.facts!.every((fact) => fact.status === "confirmed")) return { status: "confirmed_material", label: "材料已核对", complete: true };
  const execution = executionOf(pkg);
  if (execution && !(factMaterial && ["completed", "submitted"].includes(execution.status))) {
    if (execution.status === "completed" && academicTaskOf(pkg)?.kind === "assignment") return { status: "waiting", label: "成果已备好 · 待提交", complete: false };
    if (execution.status === "completed") return { status: "completed", label: "已完成 · 成果已同步", complete: true };
    if (execution.status === "submitted") return { status: "submitted", label: "已提交 · 进度已同步", complete: true };
    if (execution.status === "in_progress") return { status: "in_progress", label: "进行中", complete: false };
    if (execution.status === "blocked") return { status: "blocked", label: "有阻碍待解决", complete: false };
    if (execution.status === "waiting") return { status: "waiting", label: "等待后续", complete: false };
    return { status: "not_started", label: "待推进", complete: false };
  }
  if (academicTaskOf(pkg)) return executionOf({ execution: pkg.execution }) ? { status: "pending_review", label: "要求已更新 · 原成果待核", complete: false } : { status: "not_started", label: "待完成", complete: false };
  const admissions = admissionsTaskOf(pkg);
  if (admissions) {
    if (!admissions.source_present) return { status: "waiting", label: "来源暂未找到", complete: false };
    if (admissions.source_status === "Waiting") return { status: "waiting", label: "飞书：等待后续", complete: false };
    if (admissions.source_status === "Blocked") return { status: "blocked", label: "飞书：有阻碍待解决", complete: false };
    if (admissions.source_status === "Done") return { status: "waiting", label: "飞书已完成 · 本站未核成果", complete: false };
    return { status: "not_started", label: "待推进", complete: false };
  }
  if (pkg.task_completion?.status === "completed") return { status: "completed", label: "已完成 · 你已确认", complete: true };
  if (pkg.content.kind !== "guided_work" && pkg.facts?.length && pkg.facts.every((fact) => fact.status === "confirmed")) {
    return { status: "confirmed_material", label: "材料已核对", complete: true };
  }
  if (pkg.progress_notes?.length) return { status: "in_progress", label: "进行中", complete: false };
  if (pkg.work?.status === "session_complete") return { status: "session_paused", label: "本轮已收尾 · 任务未完成", complete: false };
  if (pkg.work?.status === "in_progress" || Object.keys(pkg.work?.answers ?? {}).length || pkg.facts?.some((fact) => fact.status === "confirmed")) {
    return { status: "in_progress", label: "进行中", complete: false };
  }
  return { status: "not_started", label: "待开始", complete: false };
}

export function isPackageComplete(pkg: ProgressPackage): boolean {
  return packageProgress(pkg).complete;
}

/** Stable package order, starting after the current task and wrapping once.
 * null means the category has no other unfinished task; never loops to itself. */
export function nextIncompleteInDomain<T extends ProgressPackage>(packages: T[], currentId: string): T | null {
  const index = packages.findIndex((pkg) => pkg.id === currentId);
  if (index < 0) return null;
  const domain = normalizedPackageDomain(packages[index]);
  const candidates: T[] = [];
  for (let offset = 1; offset < packages.length; offset++) {
    const candidate = packages[(index + offset) % packages.length];
    if (normalizedPackageDomain(candidate) === domain && !isPackageComplete(candidate)) candidates.push(candidate);
  }
  if (domain !== "admissions") return candidates[0] ?? null;
  const available = candidates.filter(candidate => { const task = admissionsTaskOf(candidate); return !task || admissionsSourceAvailability(task) === "actionable" && packageProgress(candidate).status !== "waiting" || admissionsSourceAvailability(task) === "waiting" && ["in_progress", "blocked"].includes(executionOf(candidate)?.status || ""); });
  return available.find(candidate => { const task = admissionsTaskOf(candidate); return task && task.source_status !== "Waiting"; }) ??
    available.find(candidate => !candidate.supports_task_record_id && !admissionsTaskOf(candidate)) ??
    available.find(candidate => !candidate.supports_task_record_id) ?? available[0] ?? null;
}
