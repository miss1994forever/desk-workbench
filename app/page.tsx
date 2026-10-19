"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InstallAppButton } from "@/components/install-app";
import { ExecutionLanding, type ExecutionPackage } from "@/components/execution-landing";
import { FilmLounge, type CinemaCollection } from "@/components/film-lounge";
import { admissionsTaskOf } from "@/lib/admissions-tasks";
import { admissionsQueue } from "@/lib/admissions-queue";
import { executionOf } from "@/lib/execution-state";
import { taskTitle, academicListDeadline } from "@/lib/work-label";
import { academicTaskOf, packageProgress, isPackageComplete, nextIncompleteInDomain } from "@/lib/task-progress";
import { recommendNext, categoryTarget, todaysSlots, slotLabel } from "@/lib/next-action";
import { readWorkspaceCache, writeWorkspaceCache, clearWorkspaceCache } from "@/lib/workspace-cache";

type Field = { id: string; question?: string; candidate?: unknown; display_zh?: string; source_refs?: string[]; source_locator?: string };
type Fact = { id: string; content: Field; status: string; confirmed_by?: string | null };
type Package = ExecutionPackage & { content: ExecutionPackage["content"] & { fields: Field[]; revision?: number; task_record_id?: string }; facts: Fact[] };
type Domain = { id: string; label: string; state: string; detail?: string };
type LinkedTask = { id?: string; title: string; status: string; source_url?: string };
type SourceContext = { sync_state?: string; last_synced_at?: string | null; update_note?: string; domains?: Domain[]; tasks?: LinkedTask[]; linked_task?: LinkedTask | null };
type StudioEvent = { id: string; package_id: string | null; kind: string; raw_text: string; created_at: string; result: { error?: string; outcome?: string; step_id?: string | null; milestone_id?: string } };
type PlanItem = { id: string; package_id: string; date: string; start?: string; end?: string; duration_minutes?: number; kind: "suggested"; reason?: string; evidence_refs?: string[] };
type PlatformTodo = { id?: string; title: string; course_name?: string; deadline_local?: string; deadline_iso?: string; source_url?: string; submission_state?: "unknown" };
type SourceUpdate = { status?: string; checked_at?: string; last_success_at?: string | null; description?: string; note?: string; detail?: string; error?: string; coverage?: string; items?: PlatformTodo[]; movie_rewards?: unknown };
type StudioDoc = { current_package_id: string | null; paused: boolean; mode: string; packages: Package[]; source_context?: SourceContext; source_updates?: Record<string, SourceUpdate>; plan?: { date: string; items: PlanItem[]; capacity_note?: string; constraints?: string[]; hard_deadlines_complete?: boolean }; cinema?: CinemaCollection };
type Snapshot = { initialized: boolean; doc: StudioDoc | null; revision: number; saved_at: string | null; events: StudioEvent[] };
type Notice = { text: string; error?: boolean };
type SyncState = "loading" | "cached" | "saved" | "saving" | "offline" | "error";
const lines = [{ id: "academics", label: "学业" }, { id: "research", label: "科研" }, { id: "admissions", label: "申请" }, { id: "collaboration", label: "collaboration" }];
function text(value: unknown): string { return typeof value === "string" ? value : value === undefined ? "尚未准备候选" : JSON.stringify(value, null, 2); }

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

function isEvent(value: unknown): value is StudioEvent { return record(value) && typeof value.id === "string" && (value.package_id === null || typeof value.package_id === "string") && typeof value.kind === "string" && typeof value.raw_text === "string" && typeof value.created_at === "string" && record(value.result); }
function isPackage(value: unknown): value is Package { return record(value) && typeof value.id === "string" && typeof value.revision === "number" && record(value.content) && typeof value.content.title === "string" && Array.isArray(value.content.fields) && value.content.fields.every(field => record(field) && typeof field.id === "string") && Array.isArray(value.facts) && value.facts.every(fact => record(fact) && typeof fact.id === "string" && typeof fact.status === "string" && record(fact.content)); }
function isSnapshot(value: unknown): value is Snapshot { return record(value) && typeof value.initialized === "boolean" && typeof value.revision === "number" && (value.saved_at === null || typeof value.saved_at === "string") && Array.isArray(value.events) && value.events.every(isEvent) && (value.doc === null || (record(value.doc) && typeof value.doc.paused === "boolean" && typeof value.doc.mode === "string" && (value.doc.current_package_id === null || typeof value.doc.current_package_id === "string") && Array.isArray(value.doc.packages) && value.doc.packages.every(isPackage))); }
function dateLabel(value?: string | null): string { if (!value) return "还未保存"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? "时间待核对" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
function domainOf(pkg: Package): string { const domain = pkg.content.domain || "admissions"; return ["academic", "coursework", "courses"].includes(domain) ? "academics" : ["application", "applications"].includes(domain) ? "admissions" : domain; }
function safeFeishu(url?: string): boolean { try { const parsed = new URL(url || ""); return parsed.protocol === "https:" && parsed.hostname === "my.feishu.cn" && !parsed.username && !parsed.password; } catch { return false; } }
function questionFor(pkg: Package): string { return executionOf(pkg)?.next_action || admissionsTaskOf(pkg)?.next_action || pkg.content.next_action || "在工作对话中推进，成果与下一步会同步到这里。"; }
function current(value: Snapshot | null, viewedId?: string | null): Package | undefined { return value?.doc?.packages.find(pkg => pkg.id === (viewedId || value.doc?.current_package_id)) || value?.doc?.packages[0]; }
function errorMessage(code?: string): string { return code === "sign_in_required" ? "请先以站点所有者身份登录，再读取你的事项。" : "这次没有读到最新记录，请稍后重试。原有材料和本机草稿仍保留。"; }

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sync, setSync] = useState<SyncState>("loading");
  const [authRequired, setAuthRequired] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [chosenLine, setChosenLine] = useState<string | null>(null);
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [lastCompleted, setLastCompleted] = useState<{ id: string; title: string } | null>(null);
  const viewedIdRef = useRef<string | null>(null), snapshotRef = useRef<Snapshot | null>(null);
  const inFlight = useRef(false), lastViewedByDomain = useRef<Record<string, string>>({});
  const ownerRef = useRef(""), etagRef = useRef<string | null>(null), verifiedRef = useRef(false);
  const pendingRead = useRef<Promise<void> | null>(null);
  const receive = useCallback((next: Snapshot, etag: string | null = null, confirmed = true) => {
    const before = snapshotRef.current;
    if (before && next.revision < before.revision) return;
    const previous = current(before, viewedIdRef.current);
    const selected = current(next, viewedIdRef.current);
    if (!viewedIdRef.current && selected) { viewedIdRef.current = selected.id; setViewedId(selected.id); }
    // Ordinary reports and other devices' selection never hijack this view.
    // The owner's completion preference applies only to a newly completed
    // task that is being read here, never to an already-complete archive.
    if (selected && selected.id === viewedIdRef.current) lastViewedByDomain.current[domainOf(selected)] = selected.id;
    const execution = selected && executionOf(selected), prior = previous && executionOf(previous);
    if (confirmed && verifiedRef.current && before && selected && previous && selected.id === previous.id && !isPackageComplete(previous) && isPackageComplete(selected)) {
      const following = nextIncompleteInDomain(next.doc?.packages || [], selected.id);
      setLastCompleted({ id: selected.id, title: taskTitle(selected) });
      if (following) { viewedIdRef.current = following.id; setViewedId(following.id); lastViewedByDomain.current[domainOf(following)] = following.id; setChosenLine(domainOf(following)); }
      setNotice({ text: following ? `✓ ${taskTitle(selected)} 已完成，已打开同分类「${taskTitle(following)}」。` : `✓ ${taskTitle(selected)} 已完成，这个分类暂时没有其他未完成事项。` });
    } else if (confirmed && verifiedRef.current && before && selected?.id === previous?.id && execution && execution.event_id !== prior?.event_id) setNotice({ text: "原对话的进展已同步。" });
    snapshotRef.current = next; setSnapshot(next); etagRef.current = etag;
    if (confirmed) {
      verifiedRef.current = true; setSync("saved");
      try { writeWorkspaceCache(localStorage, ownerRef.current, next, etag); } catch { /* Optional startup copy. */ }
    } else setSync("cached");
  }, []);
  const refresh = useCallback(async (silent = false) => {
    if (pendingRead.current) return pendingRead.current;
    if (inFlight.current) return;
    setReading(true);
    const run = (async () => { try {
      const response = await fetch("/api/studio", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(45000), headers: etagRef.current && snapshotRef.current ? { "If-None-Match": etagRef.current } : {} });
      if (response.status === 304 && snapshotRef.current) {
        verifiedRef.current = true; setSync("saved"); setAuthRequired(false);
        try { writeWorkspaceCache(localStorage, ownerRef.current, snapshotRef.current, etagRef.current); } catch { /* Optional startup copy. */ }
        return;
      }
      const value: unknown = await response.json();
      if (!response.ok) { setSync("error"); const code = record(value) && typeof value.error === "string" ? value.error : undefined; if (code === "sign_in_required") {
        try { clearWorkspaceCache(localStorage, ownerRef.current); } catch { /* Optional cache. */ }
        verifiedRef.current = false; etagRef.current = null; snapshotRef.current = null; viewedIdRef.current = null;
        setSnapshot(null); setViewedId(null); setLastCompleted(null); setAuthRequired(true);
      } if (!silent) setNotice({ text: errorMessage(code), error: true }); return; }
      if (!isSnapshot(value)) throw new Error("invalid_snapshot");
      const owner = response.headers.get("X-Workspace-Owner");
      if (owner) ownerRef.current = owner;
      setAuthRequired(false); receive(value, response.headers.get("ETag"));
    } catch { setSync("offline"); if (!silent) setNotice({ text: "现在暂时连接不上。原有材料与本机草稿仍保留，恢复连接后再读取。", error: true }); }
    finally { setReading(false); } })();
    pendingRead.current = run;
    try { await run; } finally { if (pendingRead.current === run) pendingRead.current = null; }
  }, [receive]);
  useEffect(() => {
    ownerRef.current = document.querySelector<HTMLMetaElement>('meta[name="workspace-owner"]')?.content || "";
    try { const cached = readWorkspaceCache(localStorage, ownerRef.current, isSnapshot); if (cached) receive(cached.snapshot, cached.etag, false); } catch { /* Online work remains available. */ }
    void refresh();
    const foreground = () => { if (document.visibilityState === "visible" && !inFlight.current) void refresh(true); };
    const offline = () => setSync("offline");
    window.addEventListener("online", foreground); window.addEventListener("offline", offline); window.addEventListener("focus", foreground); document.addEventListener("visibilitychange", foreground);
    const interval = window.setInterval(foreground, 20000);
    return () => { clearInterval(interval); window.removeEventListener("online", foreground); window.removeEventListener("offline", offline); window.removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, [refresh, receive]);
  async function openWork(id: string) {
    const before = snapshotRef.current, target = before?.doc?.packages.find(item => item.id === id);
    if (!before?.initialized || !target || inFlight.current) return;
    viewedIdRef.current = id; setViewedId(id); lastViewedByDomain.current[domainOf(target)] = id; setNotice(null);
    requestAnimationFrame(() => document.getElementById("work-panel")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    if (!verifiedRef.current) return;
    if (before.doc?.current_package_id === id) return;
    inFlight.current = true; setBusy(true); setSync("saving");
    try {
      const response = await fetch("/api/studio/action", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: `view.${crypto.randomUUID()}`, expected_revision: before.revision, kind: "activate", package_id: id }) });
      const value: unknown = await response.json();
      if (isSnapshot(value)) receive(value);
      if (!response.ok) { setSync(response.status >= 500 ? "offline" : "error"); setNotice({ text: "已打开这项工作，共享的浏览位置暂未同步；成果与草稿都没有改动。", error: true }); }
    } catch { setSync("offline"); setNotice({ text: "已打开这项工作，连接恢复后可读取最新成果。", error: true }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const doc = snapshot?.doc, pkg = current(snapshot, viewedId), now = new Date();
  const recommendation = doc ? recommendNext(doc.packages, doc.plan, now) : null;
  const progress = pkg ? packageProgress(pkg) : null;
  const nextInCategory = pkg && doc ? nextIncompleteInDomain(doc.packages, pkg.id) : null;
  const nextAfterComplete = nextInCategory || (recommendation?.pkg.id !== pkg?.id ? recommendation?.pkg : null);
  const syncLabel = sync === "loading" ? "正在读取" : sync === "cached" ? "上次记录 · 正在核对更新" : sync === "saving" ? "正在同步" : sync === "offline" ? "离线 · 显示上次记录" : sync === "error" ? "暂未读到最新" : `记录已更新 · ${dateLabel(snapshot?.saved_at)}`;
  async function chooseCategory(domain: string) {
    if (!doc || !pkg || busy) return;
    if (domain === domainOf(pkg)) { setChosenLine(chosenLine === domain ? null : domain); return; }
    const target = categoryTarget(doc.packages, domain, recommendation?.pkg.id, lastViewedByDomain.current[domain]);
    setChosenLine(domain);
    if (target) await openWork(target.id);
  }

  return <main className="work-shell execution-shell">
    <header className="app-top"><div className="app-brand"><span className="workspace-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>工作台</div><div className="app-toolbar"><div className={`sync-status ${sync}`} role="status"><i aria-hidden="true" />{syncLabel}<button onClick={() => void refresh()} disabled={busy || reading}>读取最新 ↻</button></div><InstallAppButton /></div></header>
    <section className="workspace-opening" aria-label="今天的下一步"><div className="opening-copy"><h1>今天<span>做什么？</span><svg viewBox="0 0 170 15" fill="none" aria-hidden="true"><path d="M3 9C40 1 96 2 164 8M18 13c53-5 98-4 132-1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></h1>{recommendation && !authRequired ? <div className="resume-preview" data-recommended-id={recommendation.pkg.id}><div className="recommendation-context"><span>{recommendation.label}</span>{recommendation.timeLabel && <time>{recommendation.timeLabel}</time>}</div><div className="resume-meta"><span>{lines.find(line => line.id === domainOf(recommendation.pkg))?.label || "当前事项"}</span><p>{taskTitle(recommendation.pkg)}</p></div><p className="resume-question">{questionFor(recommendation.pkg)}</p><button type="button" className="resume-button" disabled={busy} onClick={() => void openWork(recommendation.pkg.id)}>查看任务<span aria-hidden="true">↗</span></button><small>{recommendation.reason}</small></div> : <p className="opening-welcome">{doc && !recommendation ? (doc.packages.every(isPackageComplete) ? "当前事项已全部完成，可以回看成果和收藏。" : "目前没有可直接推进的建议，可以查看等待中的事项或选择其他分类。") : "查看安排、选择任务，然后在工作对话中推进。"}</p>}</div><WorkspaceArtwork /></section>
    {!authRequired && doc && <TodayPlan plan={doc.plan} packages={doc.packages} currentId={pkg?.id} recommendedId={recommendation?.pkg.id} now={now} disabled={busy} onActivate={id => void openWork(id)} />}
    {authRequired || !snapshot?.initialized || !pkg ? <section className="empty-work"><h2>{authRequired ? "登录后查看你的事项。" : sync === "loading" ? "正在读取你的工作。" : sync === "offline" ? "连接暂时中断。" : "工作记录暂时没有读到。"}</h2><p>{authRequired ? "这是你的私有工作页，登录后会读取同一份记录。" : sync === "loading" ? "正在读取已保存的材料与进展。" : "原有材料和本机草稿仍保留，连接恢复后可重新读取。"}</p>{authRequired ? <a className="primary sign-in-link" href="/signin-with-chatgpt?return_to=%2F" target="_top">登录并读取我的事项</a> : <button className="primary" onClick={() => void refresh()}>重新读取</button>}</section> : <div className="work-layout execution-layout">
      <aside className="domain-sidebar"><p className="eyebrow">任务分类</p><nav className="domain-lanes" aria-label="任务领域">{lines.map(line => { const group = doc!.packages.filter(item => domainOf(item) === line.id), done = group.filter(isPackageComplete).length; return <button className={`domain-lane${line.id === domainOf(pkg) ? " current" : ""}${chosenLine === line.id ? " expanded" : ""}`} key={line.id} disabled={busy} onClick={() => void chooseCategory(line.id)} aria-expanded={chosenLine === line.id}><span>{line.label}</span><small>{group.length ? (line.id === "admissions" ? `${admissionsQueue(group).active.length} 项可推进 · ${admissionsQueue(group).waiting.length} 项等待` : `${done}/${group.length} 完成`) : "待接入"}</small><span className="domain-chevron" aria-hidden="true">⌄</span></button>; })}</nav>{chosenLine && <div className="domain-detail"><strong>{lines.find(line => line.id === chosenLine)?.label}<button type="button" className="domain-close" onClick={() => setChosenLine(null)} aria-label="收起分类">×</button></strong><DomainTasks packages={doc!.packages} domain={chosenLine} currentId={pkg.id} busy={busy} onActivate={id => void openWork(id)} /></div>}</aside>
      <div className="current-work" id="work-panel">
        {notice && <div className={`work-notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}{lastCompleted && <button type="button" disabled={busy} onClick={() => void openWork(lastCompleted.id)}>回看「{lastCompleted.title}」的完成记录 ↗</button>}</div>}
        <article className={`material-card${progress?.complete ? " material-is-complete" : ""}`} aria-labelledby="material-title"><header className="material-header"><div><p className="eyebrow"><span className="material-dot" />{lines.find(line => line.id === domainOf(pkg))?.label || "当前事项"} · {progress?.complete ? "完成记录" : "待办事项"}</p><h2 id="material-title">{taskTitle(pkg)}</h2></div></header><ExecutionLanding key={pkg.id} pkg={pkg} events={snapshot.events} next={nextAfterComplete ? { id: nextAfterComplete.id, title: taskTitle(nextAfterComplete) } : undefined} busy={busy} onActivate={id => void openWork(id)} /></article>
        <details className="execution-source-details"><summary>来源与连接设置</summary><SourcePanel source={doc!.source_context} packageId={admissionsTaskOf(pkg)?.record_id || pkg.supports_task_record_id || pkg.content.task_record_id} guided={pkg.content.kind === "guided_work"} /><SourceUpdates sources={doc!.source_updates} /><p>原对话记录的进展会同步到这里。旧原话与本机草稿可在各事项下回看；后台更新不会切换当前页面。</p></details>
      </div>
      <aside className="progress-notes"><FilmLounge cinema={doc!.cinema} supplemental={doc!.source_updates?.intake?.movie_rewards} /></aside>
    </div>}
    <footer className="app-bottom"><details><summary>保存与来源说明</summary><p>已同步内容以保存记录为准。未同步旧草稿仍只留当前设备。原文件、代码和实验结果继续放在原来的位置。</p></details>{snapshot?.saved_at && <span>最近同步 {dateLabel(snapshot.saved_at)} · 北京时间</span>}</footer>
  </main>;
}

function DomainTasks({ packages, domain, currentId, busy, onActivate }: { packages: Package[]; domain: string; currentId: string; busy: boolean; onActivate: (id: string) => void }) {
  const group = packages.filter(item => domainOf(item) === domain);
  const card = (item: Package) => { const state = packageProgress(item), task = academicTaskOf(item); return <button type="button" key={item.id} className={`domain-task-card package-state-${state.status}`} disabled={busy || item.id === currentId} aria-current={item.id === currentId ? "page" : undefined} onClick={() => onActivate(item.id)}><strong><i aria-hidden="true">{state.complete ? "✓" : item.id === currentId ? "◉" : "○"}</i>{taskTitle(item)}</strong>{admissionsTaskOf(item) && <span>{admissionsTaskOf(item)!.category}</span>}{task && <span>{task.course_name}{academicListDeadline(item) && ` · ${academicListDeadline(item)}`}</span>}<span className={`task-status-pill status-${state.status}`}>{state.label}</span>{item.id === currentId && <small>正在查看</small>}</button>; };
  const fold = (label: string, items: Package[], className = "completed-task-list") => items.length ? <details className={className} key={`${domain}:${label}`}><summary>{label} · {items.length}</summary><div className="domain-task-group">{items.map(card)}</div></details> : null;
  if (domain === "admissions" && group.some(item => admissionsTaskOf(item))) {
    const queue = admissionsQueue(group), first = queue.active.slice(0, 3), rest = queue.active.slice(3);
    return <div className="domain-package-picker admissions-package-picker">
      <p className="queue-intro">{queue.active.length} 项可推进 · {queue.waiting.length} 项等待</p>
      {first.map(card)}
      {fold("其他申请事项", rest)}
      {fold("等待回复或材料", queue.waiting)}
      {fold("相关素材", queue.support)}
      {fold("已完成", queue.completed)}
      {fold("来源已归档或变更", queue.sourceArchive)}
    </div>;
  }
  const active = group.filter(item => !isPackageComplete(item)), completed = group.filter(isPackageComplete);
  const assignments = active.filter(item => academicTaskOf(item)?.kind === "assignment"), other = active.filter(item => academicTaskOf(item)?.kind !== "assignment");
  return <div className={`domain-package-picker${domain === "academics" ? " academic-package-picker" : ""}`}>{domain === "academics" ? <>{assignments.sort((a, b) => Date.parse(academicTaskOf(a)?.due?.at || "") - Date.parse(academicTaskOf(b)?.due?.at || "")).map(card)}{fold("课程学习与课件线索", other, "academic-learning-list")}</> : active.map(card)}{fold("已完成", completed)}{!group.length && <p>这个分类暂时没有已接入的事项。</p>}</div>;
}

function WorkspaceArtwork() {
  const [failed, setFailed] = useState(false);
  return <div className="workspace-artwork" aria-hidden="true"><div className="artwork-orbit" />{!failed ? <img src="/workspace-mood.png" alt="" fetchPriority="low" decoding="async" onError={() => setFailed(true)} /> : <svg className="workspace-native-art" viewBox="0 0 540 390" fill="none"><ellipse cx="276" cy="331" rx="207" ry="27" fill="#E4E5EB" /><path d="m66 238 276-89 132 107-276 87Z" fill="#F7C397" stroke="#283353" strokeWidth="2" /><path d="m93 231 248-76 113 91-256 78Z" fill="#FFE2BC" /><path d="m277 96 128 33-29 139-127-34Z" fill="#3158E8" stroke="#263454" strokeWidth="3" /><path d="m290 112 97 24-21 107-96-24Z" fill="#E6ECFF" /><path d="m303 138 62 16m-67 6 62 16m-67 5 39 10" stroke="#8397DB" strokeWidth="4" strokeLinecap="round" /><path d="m154 186 108 28-34 91-107-28Z" fill="#FFFDF8" stroke="#263454" strokeWidth="2" /><path d="m158 211 70 18m-75-1 53 14m-59 5 64 17" stroke="#A8B0C6" strokeWidth="3" strokeLinecap="round" /><circle cx="125" cy="140" r="45" fill="#FFAB75" /><circle cx="125" cy="140" r="13" fill="#F4F3EF" /><path d="M424 250v-77m0 20c-28-4-35-23-30-39 19 3 32 15 30 39Zm0-13c28-8 32-27 25-43-19 7-28 22-25 43Z" fill="#91AF9A" stroke="#263454" strokeWidth="2" /><path d="m404 235 39 2-5 35-30-1Z" fill="#FFAB75" stroke="#263454" strokeWidth="2" /><path d="M204 91c21-29 55-42 86-30M72 201c-18 12-23 22-16 35M387 91l7-12m4 20 16-1" stroke="#263454" strokeWidth="2" strokeLinecap="round" /><circle cx="221" cy="110" r="6" fill="#3158E8" /><circle cx="349" cy="306" r="5" fill="#3158E8" /></svg>}</div>;
}

function SourcePanel({ source, packageId, guided = false }: { source?: SourceContext; packageId?: string; guided?: boolean }) { const task = packageId ? source?.tasks?.find(item => item.id === packageId) || (source?.linked_task?.id === packageId ? source.linked_task : null) : source?.linked_task; return <details className="source-panel"><summary>数据来源与更新</summary><div>{task ? <p>对应飞书任务：{task.title} ｜ {task.status}{safeFeishu(task.source_url) && <> · <a href={task.source_url} target="_blank" rel="noopener noreferrer">查看来源</a></>}</p> : <p>{guided ? "这份工作未关联单个飞书任务，具体材料来源在步骤里。" : "对应任务：还未同步"}</p>}<p>上次成功同步：{source?.last_synced_at ? `${dateLabel(source.last_synced_at)}（北京时间）` : "还未同步"}{source?.sync_state === "stale" ? " · 缓存需更新" : ""}</p><p>{source?.update_note || "尚未接入实时任务来源，当前是已准备的材料。"}</p>{source?.domains?.map(domain => <section key={domain.id}><strong>{domain.label} · {domain.state}</strong><p>{domain.detail}</p></section>)}</div></details>; }

function TodayPlan({ plan, packages, currentId, recommendedId, now, disabled, onActivate }: { plan?: StudioDoc["plan"]; packages: Package[]; currentId?: string; recommendedId?: string; now: Date; disabled: boolean; onActivate: (id: string) => void }) {
  const items = todaysSlots(packages, plan, now).filter(item => item.package_id !== recommendedId);
  if (!items.length) return null;
  return <details className="today-plan today-plan-folded"><summary><span>今天的其他建议 <small>{items.length} 项</small></span><span aria-hidden="true">⌄</span></summary>{items.map(item => { const pkg = packages.find(value => value.id === item.package_id)!; const active = pkg.id === currentId; return <article className={`suggested-work${active ? " active" : ""}`} key={item.id}><div className="suggestion-time">{slotLabel(item) || (item.duration_minutes ? `预留 ${item.duration_minutes} 分钟` : "时间可调整")}</div><div><h3>{taskTitle(pkg)}</h3>{(academicTaskOf(pkg) || item.reason) && <p>{academicTaskOf(pkg) ? "这一段用于推进实际课程工作，时长可以调整。" : item.reason}</p>}</div><button type="button" disabled={disabled || active} onClick={() => onActivate(pkg.id)}>{active ? "正在查看" : "进入这项"}</button></article>; })}{plan?.capacity_note && <p className="plan-capacity">{plan.capacity_note}</p>}</details>;
}

function SourceUpdates({ sources }: { sources?: Record<string, SourceUpdate> }) {
  if (!sources) return null;
  const labels: Record<string, string> = { academics: "课业与课程平台", research: "四条研究线", collaboration: "collaboration", intake: "新消息与材料" };
  return <details className="source-panel"><summary>课程、研究和 collaboration 的来源状态</summary><div>{Object.entries(sources).filter(([key]) => key in labels).map(([key, source]) => <section key={key}><strong>{labels[key]} · {source.status === "synced" ? key === "academics" ? "待办已读取" : "最近读取成功" : source.status || "状态未记录"}</strong><p>{source.description || source.note || source.detail || "没有额外说明。"}</p>{source.last_success_at ? <p>最近成功读取：{dateLabel(source.last_success_at)}（北京时间）</p> : <p>尚无成功读取记录</p>}{source.checked_at && <p>最近检查：{dateLabel(source.checked_at)}</p>}{source.error && <p>当前限制：{source.error}</p>}{key === "academics" && <AcademicTodos source={source} />}</section>)}</div></details>;
}

function platformSource(value?: string): string | null { if (!value) return null; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; } }
function platformDeadline(todo: PlatformTodo): string {
  const raw = todo.deadline_iso || todo.deadline_local;
  if (!raw) return "截止时间尚未核验";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}（具体时刻待核验）`;
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw) ? raw.replace(" ", "T") + "+08:00" : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.valueOf())) return raw;
  const parts = (value: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(value).map(part => [part.type, part.value]));
  const when = parts(date), label = `${when.year}年${when.month}月${when.day}日 ${when.hour}:${when.minute}`;
  if (when.hour === "00" && when.minute === "00") { const before = parts(new Date(date.valueOf() - 60000)); return `${label}（${before.month}月${before.day}日夜里）`; }
  return label + "（北京时间）";
}
function AcademicTodos({ source }: { source?: SourceUpdate }) {
  if (!source?.items?.length) return null;
  return <details className="academic-todos"><summary>平台待办 · {source.items.length} 条，提交状态待核验</summary><p>{source.coverage || "这里只是最近读取的平台待办，不代表全部课程作业；也不代表已提交。"}</p><ol>{source.items.map((todo, index) => { const href = platformSource(todo.source_url); return <li key={todo.id || `${todo.title}-${index}`}><strong>{todo.title}</strong>{todo.course_name && <span>{todo.course_name}</span>}<p className="todo-deadline">{platformDeadline(todo)}</p><small>提交状态待核验</small>{href && <a href={href} target="_blank" rel="noopener noreferrer">去平台核对 ↗</a>}</li>; })}</ol></details>;
}
