import { academicTaskOf, isPackageComplete, normalizedPackageDomain, packageProgress, type ProgressPackage } from "./task-progress";
import { admissionsCanStart, admissionsQueue } from "./admissions-queue";

export type NextPackage = ProgressPackage & { content: ProgressPackage["content"] & { title: string; due?: { at?: string | null; kind?: string } } };
export type SuggestedSlot = { id: string; package_id: string; date: string; start?: string; end?: string; duration_minutes?: number; kind: string; reason?: string };
export type SuggestedPlan = { date: string; items: SuggestedSlot[] };
export type Recommendation<T> = { pkg: T; kind: "current_slot" | "next_slot" | "deadline" | "today" | "resume" | "admissions" | "available"; label: string; timeLabel?: string; reason: string };

export function beijingDate(now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function localTime(date: string, value?: string): number | null {
  if (!value) return null;
  const input = /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? `${date}T${value}:00+08:00` : value;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(input)) return null;
  const millis = Date.parse(input);
  return Number.isFinite(millis) && beijingDate(new Date(millis)) === date ? millis : null;
}
export function slotLabel(slot: SuggestedSlot): string | undefined {
  const format = (value?: string) => {
    const millis = localTime(slot.date, value);
    return millis === null ? "" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(millis);
  };
  const start = format(slot.start), end = format(slot.end);
  return start ? `${start}${end ? `–${end}` : ""}` : undefined;
}
export function todaysSlots<T extends NextPackage>(packages: T[], plan: SuggestedPlan | undefined, now: Date): SuggestedSlot[] {
  const day = beijingDate(now);
  return (plan?.items ?? []).filter(slot => slot.kind === "suggested" && slot.date === day && packages.some(pkg => pkg.id === slot.package_id && !isPackageComplete(pkg) && (normalizedPackageDomain(pkg) !== "admissions" || admissionsCanStart(pkg))));
}

/** This is a suggestion, never a navigation command. Browsing/category/current
 * package are deliberately absent from the inputs, so reading old work cannot
 * replace the day's recommendation. Thresholds are product choices, not scores. */
export function recommendNext<T extends NextPackage>(packages: T[], plan: SuggestedPlan | undefined, now = new Date()): Recommendation<T> | null {
  const remaining = packages.filter(pkg => !isPackageComplete(pkg) && (normalizedPackageDomain(pkg) !== "admissions" || admissionsCanStart(pkg)));
  if (!remaining.length) return null;
  const slots = todaysSlots(remaining, plan, now);
  const instant = now.getTime();
  const timed = slots.map(slot => ({ slot, start: localTime(slot.date, slot.start), end: localTime(slot.date, slot.end) })).filter((item): item is {slot: SuggestedSlot; start: number; end: number | null} => item.start !== null).sort((a, b) => a.start - b.start);
  const fromSlot = (slot: SuggestedSlot, kind: "current_slot" | "next_slot" | "today", label: string): Recommendation<T> => ({ pkg: remaining.find(pkg => pkg.id === slot.package_id)!, kind, label, timeLabel: slotLabel(slot), reason: academicTaskOf(remaining.find(pkg => pkg.id === slot.package_id)!) ? "这一段用于推进课程工作，具体做到哪里以实际文件为准。" : slot.reason || "根据今日安排推荐，时间可以调整。" });
  const current = timed.find(item => item.start <= instant && item.end !== null && instant < item.end);
  if (current) return fromSlot(current.slot, "current_slot", "当前时段建议");
  const urgent = remaining.map(pkg => {
    const task = academicTaskOf(pkg), due = task ? task.due : pkg.content.due;
    const millis = due?.at && /^(platform_deadline|verified_deadline|hard_deadline)$/.test(due.kind || "") && /(Z|[+-]\d{2}:\d{2})$/.test(due.at) ? Date.parse(due.at) : NaN;
    return { pkg, millis };
  }).filter(item => Number.isFinite(item.millis) && item.millis <= instant + 24 * 60 * 60 * 1000).sort((a, b) => a.millis - b.millis)[0];
  if (urgent) return { pkg: urgent.pkg, kind: "deadline", label: urgent.millis <= instant ? "截止已过，先核实际状态" : "近期截止", reason: "按已核实的截止时间提醒；是否已交，仍以实际记录为准。" };
  const upcoming = timed.find(item => item.start > instant);
  if (upcoming) return fromSlot(upcoming.slot, "next_slot", "接下来的安排");
  const untimed = slots.find(slot => localTime(slot.date, slot.start) === null);
  if (untimed) return fromSlot(untimed, "today", "今日建议");
  const started = remaining.find(pkg => ["in_progress", "session_paused"].includes(packageProgress(pkg).status));
  if (started) return { pkg: started, kind: "resume", label: "继续未完成事项", reason: "已有进展和下一步可供继续。" };
  const admission = admissionsQueue(remaining.filter(pkg => normalizedPackageDomain(pkg) === "admissions")).active[0] || remaining.find(pkg => normalizedPackageDomain(pkg) === "admissions");
  if (admission) return { pkg: admission, kind: "admissions", label: "申请下一步", reason: "当前没有其他安排，推荐一项未完成的申请任务。" };
  const missed = timed.at(-1);
  if (missed) return fromSlot(missed.slot, "today", "今天还可以调整的一项");
  return { pkg: remaining[0], kind: "available", label: "推荐任务", reason: "从已备好材料的未完成工作中选择。" };
}

/** Category selection chooses work; it never changes the global suggestion. */
export function categoryTarget<T extends NextPackage>(packages: T[], domain: string, recommendationId?: string, rememberedId?: string): T | null {
  const group = packages.filter(pkg => normalizedPackageDomain(pkg) === domain);
  const unfinished = group.filter(pkg => !isPackageComplete(pkg));
  return unfinished.find(pkg => pkg.id === rememberedId) || unfinished.find(pkg => pkg.id === recommendationId) || (domain === "admissions" ? admissionsQueue(group).active[0] || admissionsQueue(group).waiting[0] : domain === "academics" ? unfinished.find(pkg => academicTaskOf(pkg)?.kind === "assignment") : null) || unfinished[0] || group.find(pkg => pkg.id === rememberedId) || group[0] || null;
}
