"use client";

import { useEffect, useState } from "react";
import { milestonesForPackage, milestoneStatus, type MilestoneRecord } from "@/lib/progress-milestones";
import type { EarnedCinemaCard } from "@/lib/cinema-progress";
import type { WorkActionResult } from "./guided-work-card";
import styles from "./progress-milestones.module.css";

type Package = { id: string; content: { kind?: string; project_key?: string }; task_completion?: { note?: string }; work?: { finish_summary?: string; answers?: Record<string, { text?: string }> } };
type Cinema = { milestones?: MilestoneRecord[]; earned_cards?: EarnedCinemaCard[] };
type Draft = { text: string; eventId?: string; baseRevision?: number };

export function ProgressMilestones({ pkg, cinema, busy, hasDraft, documentRevision, onAction, onReveal }: {
  pkg: Package; cinema?: Cinema; busy: boolean; hasDraft: boolean; documentRevision: number;
  onAction: (kind: "milestone_complete", values: { milestone_id: string; text: string; event_id: string; expected_revision: number }) => Promise<WorkActionResult | undefined>;
  onReveal: (eventId: string, title: string) => void;
}) {
  const options = milestonesForPackage(pkg);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ text: "" });
  const [needsReview, setNeedsReview] = useState(false);
  const [message, setMessage] = useState("");
  const [recentEvent, setRecentEvent] = useState<string | null>(null);
  const choice = options.find(item => item.id === selected) || options.find(item => !milestoneStatus(cinema, pkg, item.id)) || options[0];
  const key = choice ? `progress:milestone:${choice.project_key}:${choice.id}` : "";
  const done = choice && milestoneStatus(cinema, pkg, choice.id);
  const saved = options.map(item => milestoneStatus(cinema, pkg, item.id)).filter((item): item is MilestoneRecord => !!item);
  useEffect(() => {
    setMessage(""); setNeedsReview(false); setDraft({ text: "" });
    if (!key) return;
    try { const value = JSON.parse(localStorage.getItem(key) || "null"); if (value && typeof value.text === "string") setDraft({ text: value.text, ...(typeof value.eventId === "string" ? { eventId: value.eventId } : {}), ...(Number.isSafeInteger(value.baseRevision) ? { baseRevision: value.baseRevision } : {}) }); } catch { /* Local draft is optional. */ }
  }, [key]);
  const persist = (value: Draft) => { setDraft(value); try { if (value.text) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { /* Keep visible input in memory. */ } };
  async function save() {
    if (!choice || done || !draft.text.trim() || busy || hasDraft) return;
    const candidate = { ...draft, text: draft.text.trim(), eventId: draft.eventId || crypto.randomUUID(), baseRevision: draft.baseRevision ?? documentRevision };
    persist(candidate);
    const result = await onAction("milestone_complete", { milestone_id: choice.id, text: candidate.text, event_id: candidate.eventId, expected_revision: candidate.baseRevision });
    if (result?.ok) { persist({ text: "" }); setRecentEvent(candidate.eventId); setOpen(false); setMessage("阶段成果已保存，留下的结果以后也能回看。"); }
    else { if (result?.conflict) { persist({ text: candidate.text }); setNeedsReview(true); } setMessage(result?.conflict ? "进度已有更新，成果说明仍保留。查看当前记录后再决定是否保存。" : "还没收到确定结果，说明仍保留。重试会核对同一条记录。"); }
  }
  if (!choice) return null;
  const previousText = pkg.task_completion?.note || pkg.work?.finish_summary || Object.values(pkg.work?.answers || {}).filter(item => item.text).at(-1)?.text;
  return <section className={styles.panel} id="milestone-target" aria-label="阶段成果与电影彩蛋">
    <header><span className={styles.mark} aria-hidden="true">✦</span><div><span className={styles.kicker}>让这一段进展，有迹可循</span><h3>做到这里，留一张片尾彩蛋。</h3></div></header>
    <p className={styles.intro}>具体成果留下来，再收一张电影纪念卡。保存一句、核对信息和任务收尾，照常记录进度。</p>
    <label htmlFor="milestone-select">这次想推进的阶段</label>
    <select id="milestone-select" value={choice.id} disabled={busy} onChange={event => { setSelected(event.target.value); setOpen(false); }}>{options.map(item => <option key={item.id} value={item.id}>{milestoneStatus(cinema, pkg, item.id) ? "✓ " : ""}{item.title}</option>)}</select>
    <p className={styles.criterion}>{choice.criterion}</p>
    {done ? <div className={styles.receipt}><strong>✓ 这段成果已记下</strong><p>{done.evidence}</p>{cinema?.earned_cards?.some(item => item.event_id === done.event_id) && <button type="button" onClick={() => onReveal(done.event_id, done.title)}>翻开这次的彩蛋 ↗</button>}</div> : <>
      <button className={styles.record} type="button" disabled={busy} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "先继续做" : "这段成果已经完成，记下来 ↗"}</button>
      {open && <div className={styles.form}><label htmlFor="milestone-evidence">留下成果内容，或文件位置与一句结果</label><textarea id="milestone-evidence" value={draft.text} maxLength={3000} disabled={busy} placeholder="例如：results/baseline.json，已保存配置、准确率和一张失败样本；下一步比较剪枝前后。" onChange={event => persist({ text: event.target.value })} />{previousText && !draft.text && <button className={styles.reuse} type="button" onClick={() => persist({ text: previousText.slice(0, 3000) })}>带入刚才保存的结果，再核对</button>}<p>由你确认实际成果；文件仍放原来的项目里。实验没有得到预期结果，也可以留下有用的诊断证据。</p>{hasDraft && <p role="status">先保存工作区里的输入，再记录这一阶段；原话仍在当前设备。</p>}<button className="primary" type="button" disabled={busy || hasDraft || !draft.text.trim()} onClick={() => void save()}>{draft.eventId ? "核对这次保存结果" : needsReview ? "已查看最新进度，保存阶段成果" : "保存这段成果 ✓"}</button></div>}
    </>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {recentEvent && saved.some(item => item.event_id === recentEvent) && cinema?.earned_cards?.some(item => item.event_id === recentEvent) && <button className={styles.record} type="button" onClick={() => onReveal(recentEvent, saved.find(item => item.event_id === recentEvent)!.title)}>这一段已收好，翻开片尾彩蛋 ✦</button>}
    {!!saved.length && <details className={styles.history}><summary>已经走过的阶段 · {saved.length}</summary>{saved.map(item => <div key={item.key}><strong>✓ {item.title}</strong><p>{item.evidence}</p>{cinema?.earned_cards?.some(card => card.event_id === item.event_id) && <button type="button" onClick={() => onReveal(item.event_id, item.title)}>看看这张电影卡 ↗</button>}</div>)}</details>}
    <small className={styles.note}>每个阶段留一张，随时回看。每日电影小发现照常开放，不要求连签。</small>
  </section>;
}
