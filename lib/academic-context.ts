import type { GuideSource } from "../components/guided-work-card";
import { academicTaskOf, type ProgressNote } from "./task-progress";

export type AcademicPackage = {
  id: string; revision: number; academic_task?: unknown; progress_notes?: ProgressNote[];
  content: { kind?: string; domain?: string; title: string; description?: string; deliverable?: string; fields?: unknown[]; guide_steps?: {id: string; title: string}[]; sources?: GuideSource[]; due?: {at?: string | null; kind?: string} };
  work?: { answers?: Record<string, unknown>; finish_history?: { summary?: string; event_id?: string; finished_at?: string }[]; finish_summary?: string; finish_event_id?: string; finished_at?: string };
};
export type AcademicHistory = { id: string; text: string; saved_at: string; label: string };

export function academicHistory(pkg: AcademicPackage): AcademicHistory[] {
  const rows: AcademicHistory[] = (pkg.progress_notes || []).map(note => ({ id: note.event_id, text: note.text, saved_at: note.saved_at, label: note.milestone_id ? "进度与阶段成果" : "进度记录" }));
  for (const [step, answer] of Object.entries(pkg.work?.answers || {})) {
    if (!answer || typeof answer !== "object") continue;
    const value = answer as { text?: string; event_id?: string; saved_at?: string };
    if (typeof value.text === "string" && value.text.trim()) rows.push({ id: value.event_id || `legacy-${step}`, text: value.text, saved_at: value.saved_at || "", label: `此前记录 · ${pkg.content.guide_steps?.find(item => item.id === step)?.title || "原话"}` });
  }
  for (const [index, summary] of (pkg.work?.finish_history || []).entries()) { if (summary.summary?.trim()) rows.push({ id: summary.event_id || `legacy-history-${index}`, text: summary.summary, saved_at: summary.finished_at || "", label: "此前的小结" }); }
  if (pkg.work?.finish_summary) rows.push({ id: pkg.work.finish_event_id || "legacy-summary", text: pkg.work.finish_summary, saved_at: pkg.work.finished_at || "", label: "此前的小结" });
  const ids = new Set<string>();
  return rows.sort((a, b) => (Date.parse(b.saved_at) || 0) - (Date.parse(a.saved_at) || 0)).filter(row => { if (ids.has(row.id)) return false; ids.add(row.id); return true; });
}

export function academicDeadline(pkg: AcademicPackage): string {
  const task = academicTaskOf(pkg), due = task ? task.due : pkg.content.due;
  const raw = due?.at;
  if (task?.kind === "study") return "课程学习 · 未设置硬截止";
  if (!raw || !/(Z|[+-]\d{2}:\d{2})$/.test(raw) || due?.kind !== "platform_deadline") return "截止时间尚未核验";
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return "截止时间尚未核验";
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = (value: Date) => Object.fromEntries(formatter.formatToParts(value).map(part => [part.type, part.value]));
  const when = parts(date), label = `${when.month}月${when.day}日 ${when.weekday} ${when.hour}:${when.minute}`;
  if (label.endsWith("00:00")) {
    const previous = parts(new Date(date.valueOf() - 60000));
    return `${label}（${previous.month}月${previous.day}日${previous.weekday}夜里，北京时间）`;
  }
  return `${label}（北京时间）`;
}
