"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GuideSource = { id: string; title?: string; document_title?: string; label?: string; path?: string; url?: string; source_url?: string; locator?: string; detail?: string; limitations?: string };
export type GuideStep = { id: string; title: string; body: string; prompt?: string; source_refs?: string[] };
export type WorkAnswer = { text: string; event_id: string; saved_at: string };
export type GuidedWorkPackage = {
  id: string; revision: number;
  content: { kind: "guided_work"; revision?: number; domain: string; project_key?: string; title: string; description?: string; estimated_user_minutes?: number | { min?: number; max?: number }; deliverable?: string; working_question?: string; guide_steps: GuideStep[]; sources?: GuideSource[]; source_refs?: string[]; fields: unknown[]; related_threads?: { title: string; thread_id: string }[] };
  work?: { status: "ready" | "in_progress" | "session_complete"; current_step_id?: string; answers?: Record<string, WorkAnswer>; finish_summary?: string; finish_event_id?: string; finished_at?: string; finish_history?: { summary?: string; event_id?: string; finished_at?: string }[] };
};
export type WorkEvent = { id: string; package_id: string | null; kind: string; raw_text: string; created_at: string; result: { outcome?: string; error?: string; step_id?: string | null; milestone_id?: string } };
export type WorkActionResult = { ok: boolean; event?: WorkEvent; error?: string; conflict?: boolean; uncertain?: boolean; rawPreserved?: boolean };
export type WorkActionValues = { event_id: string; expected_revision: number; package_id: string; step_id?: string; text?: string };
type WorkDraft = { packageId: string; contentKey: string; stepId: string; text: string; baseRevision: number; baseAnswerId: string | null; eventId?: string; updatedAt: number; originalKeys?: string[] };
type Mode = "gentle" | "quiet" | "focus";

function version(pkg: GuidedWorkPackage): string {
  if (Number.isSafeInteger(pkg.content.revision)) return String(pkg.content.revision);
  let hash = 2166136261;
  for (const char of JSON.stringify(pkg.content.guide_steps)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return String(hash >>> 0);
}
function keyFor(pkgId: string, contentKey: string, stepId: string): string { return `progress:guided-draft:${pkgId}:${contentKey}:${stepId}`; }
function isDraft(value: unknown): value is WorkDraft { if (!value || typeof value !== "object") return false; const row = value as Record<string, unknown>; return typeof row.packageId === "string" && typeof row.contentKey === "string" && typeof row.stepId === "string" && typeof row.text === "string" && typeof row.baseRevision === "number" && (row.eventId === undefined || typeof row.eventId === "string"); }
function readDraft(pkg: GuidedWorkPackage, stepId: string, revision: number, answerId: string | null): WorkDraft {
  const empty: WorkDraft = { packageId: pkg.id, contentKey: version(pkg), stepId, text: "", baseRevision: revision, baseAnswerId: answerId, updatedAt: 0 };
  try {
    const exact = localStorage.getItem(keyFor(pkg.id, empty.contentKey, stepId));
    if (exact) { const parsed: unknown = JSON.parse(exact); if (isDraft(parsed) && parsed.packageId === pkg.id && parsed.stepId === stepId && parsed.text) return parsed; }
    const older: WorkDraft[] = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (!key?.startsWith(`progress:guided-draft:${pkg.id}:`)) continue; const raw = localStorage.getItem(key); if (raw) { const parsed: unknown = JSON.parse(raw); if (isDraft(parsed) && parsed.packageId === pkg.id && parsed.stepId === stepId && parsed.text) older.push(parsed); } }
    older.sort((a, b) => b.updatedAt - a.updatedAt);
    return older[0] || empty;
  } catch { return empty; }
}
function clock(value?: string): string { if (!value) return "时间未记录"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? "时间待核对" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
function safeUrl(value?: string): string | null { if (!value) return null; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; } }
function nextEventId(): string { let device = localStorage.getItem("progress:device-id"); if (!device) { device = crypto.randomUUID(); localStorage.setItem("progress:device-id", device); } return `${device}.${crypto.randomUUID()}`; }

export function GuidedWorkCard({ pkg, documentRevision, events, mode, busy, onAction, onDraftStatus }: {
  pkg: GuidedWorkPackage; documentRevision: number; events: WorkEvent[]; mode: Mode; busy: boolean;
  onAction: (kind: "work_reply" | "work_step" | "work_finish", values: WorkActionValues) => Promise<WorkActionResult | undefined>;
  onDraftStatus: (dirty: boolean) => void;
}) {
  const steps = pkg.content.guide_steps;
  const selected = steps.find(step => step.id === pkg.work?.current_step_id) || steps[0];
  const answers = pkg.work?.answers || {};
  const answer = selected ? answers[selected.id] : undefined;
  const [draft, setDraft] = useState<WorkDraft | null>(null);
  const [finish, setFinish] = useState<WorkDraft | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [finishReview, setFinishReview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [otherDrafts, setOtherDrafts] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const draftRef = useRef<WorkDraft | null>(null), finishRef = useRef<WorkDraft | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const materialKey = `${pkg.id}:${version(pkg)}:${selected?.id || "none"}`;

  const refreshLocalMarkers = useCallback(() => {
    try { const ids: string[] = []; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (!key?.startsWith(`progress:guided-draft:${pkg.id}:`)) continue; const raw = localStorage.getItem(key); if (raw) { const saved: unknown = JSON.parse(raw); if (isDraft(saved) && saved.text && saved.stepId !== "__finish__") ids.push(saved.stepId); } } setOtherDrafts([...new Set(ids)]); } catch { setStorageFailed(true); }
  }, [pkg.id]);

  const persist = useCallback((value: WorkDraft, summary = false) => {
    if (summary) { finishRef.current = value; setFinish(value); } else { draftRef.current = value; setDraft(value); }
    try { const key = keyFor(value.packageId, value.contentKey, value.stepId); if (value.text) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { setStorageFailed(true); }
    refreshLocalMarkers();
  }, [refreshLocalMarkers]);

  const clearSaved = useCallback((saved: WorkDraft, summary = false) => {
    try {
      for (const key of [keyFor(saved.packageId, saved.contentKey, saved.stepId), ...(saved.originalKeys || [])]) {
        if (!key.startsWith(`progress:guided-draft:${saved.packageId}:`)) continue;
        const raw = localStorage.getItem(key); if (!raw) continue;
        const row: unknown = JSON.parse(raw); if (isDraft(row) && row.text === saved.text) localStorage.removeItem(key);
      }
    } catch { setStorageFailed(true); }
    const empty = { ...saved, text: "", eventId: undefined, originalKeys: [] };
    if (summary) { finishRef.current = empty; setFinish(empty); } else { draftRef.current = empty; setDraft(empty); }
    refreshLocalMarkers();
  }, [refreshLocalMarkers]);

  useEffect(() => {
    if (!selected) return;
    const restored = readDraft(pkg, selected.id, documentRevision, answer?.event_id || null);
    draftRef.current = restored; setDraft(restored);
    setNeedsReview(!!restored.text && (restored.contentKey !== version(pkg) || (!restored.eventId && restored.baseAnswerId !== (answer?.event_id || null))));
    const summary = readDraft(pkg, "__finish__", documentRevision, pkg.work?.finish_event_id || null);
    finishRef.current = summary; setFinish(summary);
    setFinishReview(!!summary.text && summary.contentKey !== version(pkg));
    setMessage(restored.text ? "上次未同步的这一句已接回；它仍只在当前设备。" : null);
    refreshLocalMarkers();
    // Only a material/step change loads another draft; cloud saves never erase local input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialKey, refreshLocalMarkers]);

  useEffect(() => { onDraftStatus(!!draft?.text || !!finish?.text); return () => onDraftStatus(false); }, [draft?.text, finish?.text, onDraftStatus]);

  useEffect(() => {
    for (const [saved, summary] of [[draftRef.current, false], [finishRef.current, true]] as const) {
      if (!saved?.eventId || !saved.text) continue;
      const outcome = summary ? "work_session_finished_self_report" : "work_answer_saved";
      const actual = events.find(event => event.id === saved.eventId && event.raw_text === saved.text && event.result.outcome === outcome && !event.result.error && event.package_id === saved.packageId && (summary || event.result.step_id === saved.stepId));
      if (actual) { clearSaved(saved, summary); setMessage(summary ? "已找回本轮小结的云端记录。" : "上次原话已经保存在云端，已接回真实记录。"); }
    }
  }, [events, clearSaved]);

  if (!selected) return <div className="guided-empty">这份工作包还缺少已准备的步骤。先保留材料，不用填写空白问卷。</div>;
  const currentDraft = draft?.stepId === selected.id && draft.packageId === pkg.id ? draft : null;
  const savedCount = Object.values(answers).filter(item => typeof item.text === "string" && !!item.text.trim()).length;
  const stepIndex = steps.findIndex(step => step.id === selected.id);
  const prompt = selected.prompt || pkg.content.working_question || "读到这里，你能用自己的话说清哪一部分？不确定的地方可以留下。";

  const change = (value: string, summary = false) => {
    const previous = summary ? finishRef.current : draftRef.current;
    const baseline = summary ? pkg.work?.finish_event_id || null : answer?.event_id || null;
    const fresh: WorkDraft = { packageId: pkg.id, contentKey: version(pkg), stepId: summary ? "__finish__" : selected.id, text: "", baseRevision: documentRevision, baseAnswerId: baseline, updatedAt: Date.now() };
    persist({ ...(previous?.text ? previous : fresh), text: value, eventId: undefined, updatedAt: Date.now() }, summary);
  };

  const rebase = (summary = false) => {
    const saved = summary ? finishRef.current : draftRef.current; if (!saved) return;
    const oldKey = keyFor(saved.packageId, saved.contentKey, saved.stepId), nextKey = keyFor(pkg.id, version(pkg), saved.stepId);
    persist({ ...saved, contentKey: version(pkg), baseRevision: documentRevision, baseAnswerId: summary ? pkg.work?.finish_event_id || null : answer?.event_id || null, eventId: undefined, originalKeys: [...new Set([...(saved.originalKeys || []), ...(oldKey !== nextKey ? [oldKey] : [])])] }, summary);
    if (summary) setFinishReview(false); else setNeedsReview(false);
    setMessage("已接回当前内容；仍需点击保存才会同步。");
  };

  const save = async (summary = false) => {
    const saved = summary ? finishRef.current : draftRef.current;
    if (!saved?.text.trim() || busy || (summary && !savedCount)) return;
    const baseline = summary ? pkg.work?.finish_event_id || null : answer?.event_id || null;
    const safeCurrent = !saved.eventId && saved.contentKey === version(pkg) && saved.baseAnswerId === baseline && !(summary ? finishReview : needsReview);
    const revision = safeCurrent ? documentRevision : saved.baseRevision;
    let eventId: string;
    try { eventId = saved.eventId || nextEventId(); } catch { eventId = saved.eventId || crypto.randomUUID(); setStorageFailed(true); }
    const submitted = { ...saved, eventId, baseRevision: revision }; persist(submitted, summary);
    const result = await onAction(summary ? "work_finish" : "work_reply", { event_id: eventId, expected_revision: revision, package_id: pkg.id, ...(summary ? {} : { step_id: saved.stepId }), text: saved.text });
    const outcome = summary ? "work_session_finished_self_report" : "work_answer_saved";
    if (result?.ok && result.event?.id === eventId && result.event.result.outcome === outcome) {
      clearSaved(submitted, summary); if (summary) setFinishReview(false); else setNeedsReview(false);
      setMessage(summary ? "本轮小结已保存。这是你对本轮产物的记录，不代表已掌握或正式任务完成。" : "这一句已保存，可以在上次记录里接着改。普通保存不算整项完成。");
    } else if (result?.conflict) { if (summary) setFinishReview(true); else setNeedsReview(true); setMessage(result.rawPreserved ? "另一处更新了记录。原话已保留在云端冲突记录，本机草稿也还在。先看看新内容，再决定如何继续。" : "版本有变化。原话仍保留在本机，没有自动应用到新步骤。"); }
    else if (result?.uncertain) setMessage("没有收到确定结果。原话仍保留，再点保存会用同一编号核对上次提交。");
  };

  const selectStep = async (step: GuideStep) => {
    if (busy || step.id === selected.id) return;
    let eventId: string; try { eventId = nextEventId(); } catch { eventId = crypto.randomUUID(); }
    const result = await onAction("work_step", { event_id: eventId, expected_revision: documentRevision, package_id: pkg.id, step_id: step.id });
    if (result?.ok && draftRef.current?.text) setMessage("上一步的未同步草稿仍留在当前设备，切回那一步就能接上。");
  };

  const copyContext = async () => {
    const rows = [pkg.content.title, pkg.content.description || "", `当前步骤：${selected.title}`, selected.body, `现在的问题：${prompt}`, ...Object.entries(answers).map(([id, value]) => `已保存原话｜${steps.find(step => step.id === id)?.title || id}\n${value.text}`), ...(pkg.content.related_threads || []).map(thread => `相关对话：${thread.title}（ID：${thread.thread_id}）`)];
    try { await navigator.clipboard.writeText(rows.filter(Boolean).join("\n\n")); setCopied(true); } catch { setMessage("复制没有完成。可以直接选中材料和已保存原话复制。"); }
  };

  return <div className={`guided-work-area${mode === "gentle" ? " oral-first" : ""}`}>
    <div className="guide-session-boundary"><span>这轮想留下</span><strong>{pkg.content.deliverable || "一段可以继续使用的理解、判断或草稿"}</strong></div>
    <nav className="guide-step-nav" aria-label="已准备的步骤">{steps.map((step, index) => <button key={step.id} type="button" aria-current={step.id === selected.id ? "step" : undefined} className={`${step.id === selected.id ? "current" : ""}${answers[step.id]?.text ? " step-saved" : ""}`} disabled={busy} onClick={() => void selectStep(step)}><span>{answers[step.id]?.text ? "✓" : index + 1}</span>{step.title}<small>{otherDrafts.includes(step.id) ? "本机草稿" : answers[step.id]?.text ? "已保存" : "待开始"}</small></button>)}</nav>
    <div className="guide-saved-progress"><span>已留下 {savedCount}/{steps.length} 步记录</span><div role="progressbar" aria-label="已保存步骤" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={savedCount}><i style={{ width: `${savedCount / steps.length * 100}%` }} /></div></div>
    <header className="guide-current-title"><p>眼前这一步 · {stepIndex + 1}/{steps.length}</p><h3>{selected.title}</h3></header>
    {mode === "gentle" ? <details className="guide-reading"><summary>展开这一步已经备好的材料</summary><GuideReading step={selected} sources={pkg.content.sources || []} /></details> : <GuideReading step={selected} sources={pkg.content.sources || []} />}
    {answer?.text && <section className="previous-answer"><div><strong>接上次这一句</strong><time>{clock(answer.saved_at)} · 已同步</time></div><p>{answer.text}</p><button type="button" className="text-button" disabled={busy || !!currentDraft?.text} onClick={() => { change(answer.text); editorRef.current?.focus(); }}>接着改这段原话</button></section>}
    <section className="guided-question"><p className="eyebrow">现在只说清这个问题</p><p>{prompt}</p><small>这里保存原话；实时 AI 对话请继续使用原有工作会话。</small></section>
    <div className="reply-editor"><label htmlFor="guided-reply">留下你的理解、判断，或还不确定的地方</label><textarea id="guided-reply" ref={editorRef} value={currentDraft?.text || ""} maxLength={12000} disabled={busy} placeholder="不必说完整，先留下一句能继续用的话。" onChange={event => change(event.target.value)} /><div className="editor-actions"><button type="button" className="secondary" disabled={busy || !currentDraft?.text.trim() || (needsReview && !currentDraft.eventId)} onClick={() => void save(false)}>{currentDraft?.eventId ? "核对上次保存结果" : "保存这一句"}</button><span>{storageFailed ? "本机草稿保存不可用，离开前请复制。" : currentDraft?.text ? "还只是当前设备的草稿" : "输入会先留在当前设备"}<br />保存后才同步到其他设备。</span></div></div>
    {needsReview && <div className="draft-conflict"><strong>这一步的内容或答案有更新。</strong><p>原话仍保留。核对后再按当前内容保存，或先查回上次提交。</p><button className="text-button" type="button" disabled={busy} onClick={() => rebase(false)}>看过当前内容，接回这段原话</button></div>}
    {message && <p className="guided-message" role="status">{message}</p>}
    {otherDrafts.some(id => id !== selected.id) && <p className="other-step-drafts">其他步骤还有本机草稿，切回标有“本机草稿”的步骤可接着写。</p>}
    <details className={`work-finish${pkg.work?.status === "session_complete" && !finish?.text ? " session-closed" : ""}`} open={pkg.work?.status === "session_complete" || !!finish?.text}><summary>这轮先到这里，留个小结</summary><p>{pkg.work?.status === "session_complete" ? "这一轮已经收好，可以直接休息。以后保存新的步骤原话时，再继续下一轮。" : "至少保存过一句原话后，写清这轮留下了什么。只记录本轮产物，不判定学会或整项完成。"}</p>{pkg.work?.finish_summary && <div className="saved-session-summary"><strong>上次本人记录的小结</strong><p>{pkg.work.finish_summary}</p><time>{clock(pkg.work.finished_at)}</time></div>}<label htmlFor="work-summary">这轮留下了什么？</label><textarea id="work-summary" value={finish?.text || ""} maxLength={12000} disabled={busy} placeholder="例如：写下了一个判断，留下一个还没想清的问题。" onChange={event => change(event.target.value, true)} /><div className="editor-actions"><button type="button" className="primary" disabled={busy || pkg.work?.status === "session_complete" || !savedCount || !finish?.text.trim() || (finishReview && !finish.eventId)} onClick={() => void save(true)}>保存小结，结束本轮</button><span>{savedCount ? "这是本人本轮产物记录" : "先保存当前步骤的一句原话"}<br />不会标记父任务完成。</span></div>{finishReview && <button type="button" className="text-button" onClick={() => rebase(true)} disabled={busy}>已看过更新，接回本轮小结</button>}</details>
    <div className="research-context-copy"><button className="text-button" type="button" onClick={() => void copyContext()}>{copied ? "已复制当前材料与原话" : "复制任务上下文"}</button>{pkg.content.related_threads?.map(thread => <small key={thread.thread_id}>相关对话：{thread.title}</small>)}</div>
  </div>;
}

function GuideReading({ step, sources }: { step: GuideStep; sources: GuideSource[] }) {
  const refs = (step.source_refs || []).map(id => sources.find(source => source.id === id)).filter((source): source is GuideSource => !!source);
  return <div className="guide-reading-body"><div className="prepared-reading-text">{step.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>{!!refs.length && <details className="evidence-detail"><summary>这段材料的来源与限制</summary>{refs.map(source => { const href = safeUrl(source.url || source.source_url); return <section key={source.id}><strong>{source.title || source.document_title || source.label || source.id}</strong>{source.locator && <p>{source.locator}</p>}{source.detail && <p>{source.detail}</p>}{source.path && <code>{source.path}</code>}{source.limitations && <p>{source.limitations}</p>}{href && <a href={href} target="_blank" rel="noopener noreferrer">查看来源 ↗</a>}</section>; })}</details>}</div>;
}
