import { academicTaskOf, type ProgressPackage } from "./task-progress";
import { admissionsTaskOf } from "./admissions-tasks";
type NamedWork = ProgressPackage & { content: ProgressPackage["content"] & { title: string; description?: string } };
export function taskTitle(pkg?: NamedWork | null): string { return pkg ? academicTaskOf(pkg)?.title || admissionsTaskOf(pkg)?.title || pkg.content.title : ""; }
export function academicKindLabel(pkg: ProgressPackage): string {
  const kind = academicTaskOf(pkg)?.kind;
  return kind === "assignment" ? "课程作业" : kind === "study" ? "课程学习" : kind === "assignment_candidate" ? "课件中的作业线索" : "课程资料";
}
export function taskDescription(pkg: NamedWork): string { return academicTaskOf(pkg)?.deliverables.join("；") || pkg.content.description || ""; }

export function academicListDeadline(pkg: ProgressPackage): string {
  const due = academicTaskOf(pkg)?.due;
  if (!due?.at || due.kind !== "platform_deadline" || !/(Z|[+-]\d{2}:\d{2})$/.test(due.at)) return "";
  const date = new Date(due.at); if (!Number.isFinite(date.valueOf())) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
  const parts = (value: Date) => Object.fromEntries(formatter.formatToParts(value).map(item => [item.type,item.value]));
  const when = parts(date);
  if (when.hour === "00" && when.minute === "00") { const before = parts(new Date(date.valueOf()-60000)); return `${before.month}/${before.day} 夜里截止`; }
  return `${when.month}/${when.day} ${when.hour}:${when.minute} 截止`;
}
