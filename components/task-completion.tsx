"use client";

import { useEffect, useState } from "react";
import { packageProgress, type ProgressPackage } from "@/lib/task-progress";
import type { WorkActionResult } from "./guided-work-card";

type Task = ProgressPackage & { task_completion?: { status?: string; note?: string; completed_at?: string; [key: string]: unknown } };

export function TaskCompletion({ pkg, nextTitle, busy, hasDraft, documentRevision, onAction, academic = false, latestNote }: {
  pkg: Task; nextTitle?: string; busy: boolean; hasDraft: boolean; documentRevision: number;
  onAction: (kind: "task_complete" | "task_reopen", values: { text?: string; event_id?: string; expected_revision?: number }) => Promise<WorkActionResult | undefined>;
  academic?: boolean; latestNote?: string;
}) {
  const progress = packageProgress(pkg);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [eventId, setEventId] = useState<string | undefined>();
  const [baseRevision, setBaseRevision] = useState<number | undefined>();
  const [needsReview, setNeedsReview] = useState(false);
  const [message, setMessage] = useState("");
  const key = `progress:completion-note:${pkg.id}`;
  useEffect(() => { try { setNote(localStorage.getItem(key) || ""); } catch { /* optional draft */ } }, [key]);
  const update = (value: string) => { setNote(value); setEventId(undefined); setBaseRevision(undefined); try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* preserved in state */ } };
  async function finish() {
    if (!note.trim() || busy || hasDraft) return;
    const id = eventId || crypto.randomUUID(); const revision = baseRevision ?? documentRevision; setEventId(id); setBaseRevision(revision);
    const result = await onAction("task_complete", { text: note.trim(), event_id: id, expected_revision: revision });
    if (result?.ok) { try { localStorage.removeItem(key); } catch { /* optional draft */ } setNote(""); setOpen(false); }
    else { if (result?.conflict) { setEventId(undefined); setBaseRevision(undefined); setNeedsReview(true); } setMessage(result?.conflict ? "进度有更新，完成说明仍保留。请先查看最新进度，再确认完成。" : "还没有收到完成记录，说明仍保留；可以用同一编号核对保存结果。"); }
  }
  return <section className={`task-state-panel task-state-${progress.status}`} aria-label="这项工作的状态">
    <div className="task-state-top"><div><span className="task-state-icon" aria-hidden="true">{progress.complete ? "✓" : progress.status === "not_started" ? "○" : "◉"}</span><strong>{progress.label}</strong></div>{pkg.content.kind === "guided_work" && !progress.complete && <button type="button" className="task-finish-toggle" disabled={busy} onClick={() => setOpen(!open)} aria-expanded={open}>{academic ? "本次目标已完成" : "这项工作已完成"} <span aria-hidden="true">↗</span></button>}</div>
    {progress.complete ? <div className="task-completed-receipt"><p>{pkg.task_completion?.note || "眼前这组材料已经核对，可以接着做下一项。"}</p>{pkg.task_completion?.completed_at && <small>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(pkg.task_completion.completed_at))} · 本人标记完成</small>}{pkg.content.kind === "guided_work" && <button className="text-button" type="button" disabled={busy} onClick={() => void onAction("task_reopen", {})}>需要继续做，重新打开</button>}</div> : <p className="task-state-explainer">{academic ? "进度记录会保留做到哪里。本次目标完成后，可以收起并接下一项。" : progress.status === "session_paused" ? "小结已保存，整项工作仍可以继续。真正做完时，再标记完成。" : progress.status === "pending_review" ? "你的补充已经留下，仍有内容等待核对。" : "保存想法会留下进度；做完这项工作后，标记完成并接上同分类下一项。"}</p>}
    {open && !progress.complete && <div className="task-completion-form">{academic && <p>只收起上方写明的“本次目标”。检查进度、读清要求或一次预习完成后，整份作业可能仍需继续。</p>}<label htmlFor="task-completion-note">已经完成了什么？</label><textarea id="task-completion-note" value={note} maxLength={3000} onChange={event => update(event.target.value)} placeholder="留一句结果、报告位置或提交回执，方便以后回看。" disabled={busy} />{academic && latestNote && !note && <button className="text-button" type="button" disabled={busy} onClick={() => update(latestNote.slice(0, 3000))}>使用刚保存的进度，核对后确认</button>}<p>{nextTitle ? `完成后接着做：${nextTitle}` : "同分类暂时没有其他待办，完成后就可以收尾。"}</p>{hasDraft && <p role="status">先保存当前输入框里的原话，再完成这项工作；草稿仍留在当前设备。</p>}<div><button type="button" className="primary" disabled={busy || !note.trim() || hasDraft} onClick={() => void finish()}>{eventId ? "核对完成记录" : needsReview ? "已查看最新进度，确认完成" : nextTitle ? "完成并接下一项 →" : "标记这项工作完成 ✓"}</button><button className="text-button" type="button" onClick={() => setOpen(false)}>先继续做</button></div><small>这是你的完成记录；不会代你提交作业、判定掌握或修改飞书父任务。</small>{message && <p role="status">{message}</p>}</div>}
  </section>;
}
