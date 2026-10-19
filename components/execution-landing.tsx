"use client";

import { useEffect, useState } from "react";
import { executionOf } from "@/lib/execution-state";
import { admissionsTaskOf } from "@/lib/admissions-tasks";
import { academicTaskOf, hasPendingReview, packageProgress, type ProgressPackage } from "@/lib/task-progress";
import type { CourseMaterial, CourseMaterialList } from "@/lib/course-materials";
import styles from "./execution-landing.module.css";
import { WorkConversationAction } from "./work-conversation-action";
import { conversationForWork, conversationUrl as workConversationUrl } from "@/lib/work-launch";

type Source = { id: string; title?: string; document_title?: string; label?: string; path?: string; url?: string; source_url?: string; locator?: string; detail?: string; limitations?: string };
type LegacyField = { id: string; question?: string; candidate?: unknown; display_zh?: string; source_locator?: string };
type LegacyRecord = { id: string; label: string; text: string; saved_at?: string };
type LocalDraft = { key: string; text: string };
export type ExecutionEvent = { id: string; package_id: string | null; kind: string; raw_text: string; created_at: string };
export type ExecutionPackage = ProgressPackage & {
  revision: number;
  conversation_binding?: unknown;
  thread_sources?: unknown;
  content: ProgressPackage["content"] & { title: string; deliverable?: string; next_action?: string; description?: string; project_key?: string; due?: { at?: string | null; kind?: string }; fields?: LegacyField[]; sources?: Source[]; thread_sources?: unknown; related_threads?: unknown; guide_steps?: { id: string; title: string; body?: string; prompt?: string }[] };
  work?: { status?: string; answers?: Record<string, unknown>; finish_summary?: string; finished_at?: string; finish_event_id?: string; finish_history?: { summary?: string; event_id?: string; finished_at?: string }[] };
};

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function plain(value: unknown): string { return typeof value === "string" ? value : value === undefined ? "未记录" : JSON.stringify(value, null, 2); }
function clock(value?: string | null): string { const date = new Date(value || ""); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "时间未记录"; }
function safeUrl(value?: string): string | null { try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /token|secret|cookie|password|signature/i.test(key)) ? url.href : null; } catch { return null; } }
function safePath(value?: string): string | null { return value?.startsWith("/") && !value.startsWith("//") && !/[\u0000-\u001f]/.test(value) && !value.split("/").includes("..") ? value : null; }

/** Only a supplied conversation URL can be opened. IDs alone never fabricate
 * a ChatGPT URL, and an unrelated URL must not become the primary action. */
export const conversationUrl = workConversationUrl;
const boundConversation = conversationForWork;
function legacyRecords(pkg: ExecutionPackage, events: ExecutionEvent[]): LegacyRecord[] {
  const rows: LegacyRecord[] = (pkg.progress_notes || []).map(note => ({ id: note.event_id, label: "此前进度", text: note.text, saved_at: note.saved_at }));
  const earlier = academicTaskOf(pkg) && !executionOf(pkg) ? executionOf({execution:pkg.execution}) : null;
  if (earlier) rows.push({id:earlier.event_id,label:"要求更新前的成果",text:[earlier.summary,...earlier.evidence.map(item=>`${item.title}：${item.locator}`)].join('\n'),saved_at:earlier.updated_at});
  for (const [id, value] of Object.entries(pkg.work?.answers || {})) {
    if (record(value) && typeof value.text === "string" && value.text.trim()) rows.push({ id: typeof value.event_id === "string" ? value.event_id : `answer:${id}`, label: pkg.content.guide_steps?.find(step => step.id === id)?.title || "此前原话", text: value.text, saved_at: typeof value.saved_at === "string" ? value.saved_at : undefined });
  }
  for (const [index, value] of (pkg.work?.finish_history || []).entries()) if (value.summary?.trim()) rows.push({ id: value.event_id || `summary:${index}`, label: "此前小结", text: value.summary, saved_at: value.finished_at });
  if (pkg.work?.finish_summary) rows.push({ id: pkg.work.finish_event_id || "last-summary", label: "此前小结", text: pkg.work.finish_summary, saved_at: pkg.work.finished_at });
  if (typeof pkg.task_completion?.note === "string" && pkg.task_completion.note.trim()) rows.push({ id: "legacy-completion", label: "此前完成说明", text: pkg.task_completion.note, saved_at: typeof pkg.task_completion.completed_at === "string" ? pkg.task_completion.completed_at : undefined });
  for (const event of events) if (event.package_id === pkg.id && event.raw_text.trim()) rows.push({ id: event.id, label: "此前保存的原话", text: event.raw_text, saved_at: event.created_at });
  const seen = new Set<string>();
  return rows.sort((a, b) => (Date.parse(b.saved_at || "") || 0) - (Date.parse(a.saved_at || "") || 0)).filter(row => { const key = `${row.id}:${row.text}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function deadline(pkg: ExecutionPackage): string | null {
  const task = academicTaskOf(pkg), due = task ? task.due : pkg.content.due;
  if (!due?.at || !/^(platform_deadline|verified_deadline|hard_deadline)$/.test(due.kind || "") || !/(Z|[+-]\d{2}:\d{2})$/.test(due.at)) return null;
  const at = new Date(due.at);
  if (!Number.isFinite(at.valueOf())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at).map(part => [part.type, part.value]));
  if (parts.hour === "00" && parts.minute === "00") return `${clock(new Date(at.valueOf() - 60000).toISOString()).split(" ")[0]} 夜里截止（次日 00:00）`;
  return `${clock(due.at)} 截止 · 北京时间`;
}

export function ExecutionLanding({ pkg, events = [], next, busy = false, onActivate }: { pkg: ExecutionPackage; events?: ExecutionEvent[]; next?: { id: string; title: string }; busy?: boolean; onActivate: (id: string) => void }) {
  const execution = executionOf(pkg), state = packageProgress(pkg), task = academicTaskOf(pkg), admission = admissionsTaskOf(pkg);
  const conversation = boundConversation(pkg), href = conversationUrl(conversation);
  const history = legacyRecords(pkg, events), due = deadline(pkg);
  const currentSummary = state.status === "confirmed_material" ? `${pkg.facts?.length || 0} 项当前材料已核对，确认后的内容与出处保留在下方。` : execution?.summary;
  const [drafts, setDrafts] = useState<LocalDraft[]>([]), [copied, setCopied] = useState("");
  const [fallback, setFallback] = useState<{ value: string; label: string } | null>(null);
  useEffect(() => {
    const read = () => {
      const rows: LocalDraft[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !(key.startsWith(`progress:unsynced:${pkg.id}:`) || key.startsWith(`progress:guided-draft:${pkg.id}:`) || key === `progress:academic-note:${pkg.id}` || key === `progress:completion-note:${pkg.id}` || (pkg.content.project_key && key.startsWith(`progress:milestone:${pkg.content.project_key}:`)))) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          if (key === `progress:completion-note:${pkg.id}`) { rows.push({ key, text: raw }); continue; }
          try { const value: unknown = JSON.parse(raw); if (record(value) && typeof value.text === "string" && value.text.trim()) rows.push({ key, text: value.text }); } catch { /* Preserve damaged data unchanged; other drafts still load. */ }
        }
      } catch { /* Sources and conversation links work without local storage. */ }
      setDrafts(rows);
    };
    read(); setCopied(""); setFallback(null);
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [pkg.id, pkg.content.project_key]);
  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); setCopied(value); setFallback(null); } catch { setFallback({ value, label }); } }
  const sources: Source[] = task?.sources || (admission ? [{ id: admission.record_id, title: "飞书原事项", url: admission.source_url, detail: admission.internal_due_date ? `内部推进日期 ${admission.internal_due_date}；不是官方截止时间。` : undefined }] : pkg.content.sources || []);
  const goal = task?.deliverables || (pkg.content.deliverable?.trim() ? [pkg.content.deliverable] : []);
  const workspace = safePath(task?.workspace_path);
  const evidenceLabels: Record<string, string> = { file: "文件", url: "来源", conversation: "对话记录", owner_statement: "本人说明", submission_receipt: "提交回执" };

  return <section className={styles.landing} id="execution-task-body" aria-label="事项与原对话">
    <div className={styles.meta}><span className={`${styles.status} ${state.complete ? styles.complete : state.status === "blocked" || state.status === "pending_review" ? styles.attention : ""}`}>{state.complete ? "✓ " : ""}{state.label}</span>{due && <p><span aria-hidden="true">◷ </span>{due}</p>}{task && <span>{task.course_name}</span>}{admission && <span>{admission.category}</span>}</div>
    {!!goal.length && <section className={styles.goal}><h3>这件事要完成什么</h3>{goal.length === 1 ? <p>{goal[0]}</p> : <ul>{goal.map(item => <li key={item}>{item}</li>)}</ul>}</section>}
    <div className={styles.progress}>
      <section><div className={styles.sectionTitle}><h3>{state.complete ? "留下的成果" : "最近成果"}</h3>{execution && state.status !== "confirmed_material" && <time dateTime={execution.updated_at}>{clock(execution.updated_at)}</time>}</div><p className={!currentSummary ? styles.muted : undefined}>{currentSummary || (admission ? "成果会从工作对话同步，不用另填进度。" : "还没有从原对话同步新的成果记录。此前的原话和材料保留在下方。")}</p>
        {!!execution?.evidence.length && <ul className={styles.evidence}>{execution.evidence.map((item, index) => { const url = item.kind === "url" || item.kind === "submission_receipt" ? safeUrl(item.locator) : item.kind === "conversation" && conversation?.url === item.locator ? href : null; return <li key={`${item.kind}:${item.locator}:${index}`}><span>{evidenceLabels[item.kind] || "依据"}</span>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : <strong>{item.title}</strong>}<details><summary>查看依据</summary><p>{item.locator}</p>{item.quote && <blockquote>{item.quote}</blockquote>}<small>{clock(item.observed_at)}</small><button type="button" className="text-button" onClick={() => void copy(item.locator, item.title)}>{copied === item.locator ? "位置已复制 ✓" : "复制依据位置"}</button></details></li>; })}</ul>}
      </section>
      {!state.complete && <section className={styles.nextStep}><h3>接下来</h3><p className={!execution?.next_action && !admission?.next_action ? styles.muted : undefined}>{execution?.next_action || admission?.next_action || pkg.content.next_action || (task?.kind === "assignment" && execution?.status === "completed" ? "成果已备好，接下来在学校平台提交并保留回执。" : execution?.status === "waiting" ? "等待后续结果。" : conversation ? "在原对话中继续，下一步会同步到这里。" : "从下方打开工作对话，直接开始。")}</p></section>}
    </div>
    {hasPendingReview(pkg) && <p className={styles.review} role="status">还有补充原话待核对，当前不据此认定事项已经完成。</p>}
    <WorkConversationAction pkg={pkg} />
    {state.complete && <section className={styles.nextTask} aria-label="完成记录与下一项"><p>这项已完成，记录留在这里。</p>{next ? <button type="button" className="secondary" disabled={busy} onClick={() => onActivate(next.id)}>接下一项：{next.title}<span aria-hidden="true"> →</span></button> : <p className={styles.muted}>这个分类暂时没有其他未完成事项。</p>}</section>}
    {(!!sources.length || !!pkg.content.fields?.length || !!pkg.content.guide_steps?.length || workspace) && <details className={styles.fold}><summary>材料与原始来源 <span>{sources.length || "查看"}</span></summary>{workspace && <div className={styles.workspace}><strong>本地工作目录</strong><code>{workspace}</code><button type="button" className="text-button" onClick={() => void copy(workspace, "本地工作目录")}>{copied === workspace ? "目录已复制 ✓" : "复制目录位置"}</button></div>}{sources.map(source => { const url = safeUrl(source.url || source.source_url), path = safePath(source.path); return <section className={styles.source} key={source.id}><h4>{source.title || source.document_title || source.label || source.id}</h4><div>{url && <a href={url} target="_blank" rel="noopener noreferrer">打开来源 ↗</a>}{path && <button type="button" className="text-button" onClick={() => void copy(path, "原文件位置")}>{copied === path ? "文件位置已复制 ✓" : "复制原文件位置"}</button>}</div>{(source.detail || source.limitations || source.locator) && <p>{source.detail || source.limitations || source.locator}</p>}</section>; })}{!!pkg.content.fields?.length && <details className={styles.innerFold}><summary>已准备的材料摘录</summary>{pkg.content.fields.map(field => <section className={styles.source} key={field.id}><h4>{field.question || field.id}</h4><pre>{plain(field.candidate)}</pre>{field.display_zh && <p>{field.display_zh}</p>}{field.source_locator && <small>{field.source_locator}</small>}<button type="button" className="text-button" onClick={() => void copy(plain(field.candidate), "材料摘录")}>{copied === plain(field.candidate) ? "已复制 ✓" : "复制摘录"}</button></section>)}</details>}{!!pkg.content.guide_steps?.length && <details className={styles.innerFold}><summary>此前准备的思路与问题</summary><p>保留先前材料供回看；当前下一步以原对话同步的进展为准。</p>{pkg.content.guide_steps.map(step => <section className={styles.source} key={step.id}><h4>{step.title}</h4>{step.body && <pre>{step.body}</pre>}{step.prompt && <p>{step.prompt}</p>}</section>)}</details>}{task && <CourseExcerpts packageId={pkg.id} onCopy={copy} copied={copied} />}</details>}
    {(!!history.length || !!drafts.length) && <details className={styles.fold}><summary>此前原话与本机草稿 <span>{history.length} 条记录{drafts.length ? ` · ${drafts.length} 份草稿` : ""}</span></summary><p className={styles.archiveNote}>旧记录和未同步草稿原样保留。现在继续原对话即可，不用再填一遍。</p>{drafts.map((item, index) => <details className={styles.innerFold} key={item.key}><summary>本机未同步草稿 {index + 1}</summary><pre>{item.text}</pre><button type="button" className="text-button" onClick={() => void copy(item.text, "旧草稿")}>{copied === item.text ? "原话已复制 ✓" : "复制原话"}</button></details>)}{history.map(item => <details className={styles.innerFold} key={`${item.id}:${item.text}`}><summary>{item.label}{item.saved_at && <time>{clock(item.saved_at)}</time>}</summary><pre>{item.text}</pre><button type="button" className="text-button" onClick={() => void copy(item.text, item.label)}>{copied === item.text ? "原话已复制 ✓" : "复制原话"}</button></details>)}</details>}
    <details className={styles.settings}><summary>对话连接说明</summary><p>网页显示安排、材料入口与成果；讨论、写作和实验继续留在原来的 GPT / Codex 对话。</p><p>{conversation ? `已关联「${conversation.title}」。` : "尚未关联可直接打开的原对话。"}进展由原对话记录后同步，网页会定期读取。</p>{execution && <small>最近同步 {clock(execution.updated_at)} · {execution.status === "submitted" ? "提交情况以实际依据为准" : "成果及依据保留在本项记录中"}</small>}</details>
    {fallback && <section className={styles.fallback}><label htmlFor="execution-copy-fallback">{fallback.label} · 可选中复制</label><textarea id="execution-copy-fallback" value={fallback.value} readOnly /></section>}
  </section>;
}

function CourseExcerpts({ packageId, onCopy, copied }: { packageId: string; onCopy: (value: string, label: string) => Promise<void>; copied: string }) {
  const [list, setList] = useState<CourseMaterialList | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(false);
  async function read() { if (list || loading) return; setLoading(true); setError(false); try { const response = await fetch(`/api/study/materials?package_id=${encodeURIComponent(packageId)}`, { cache: "no-store", credentials: "same-origin" }); const value: unknown = await response.json(); if (!response.ok || !record(value) || !Array.isArray(value.materials)) throw new Error(); setList(value as CourseMaterialList); } catch { setError(true); } finally { setLoading(false); } }
  return <details className={styles.innerFold} onToggle={event => { if (event.currentTarget.open) void read(); }}><summary>网站已保存的课程摘录</summary>{loading && <p>正在读取课程摘录。</p>}{error && <p>暂时读不到摘录，原始来源仍在上方。<button type="button" className="text-button" onClick={() => void read()}>重新读取</button></p>}{list && (list.count ? <>{list.materials.map(material => <MaterialExcerpt key={material.id} material={material} onCopy={onCopy} copied={copied} />)}</> : <p>本项暂未导入课程摘录，可继续使用上方原文件。</p>)}</details>;
}
function MaterialExcerpt({ material, onCopy, copied }: { material: CourseMaterial; onCopy: (value: string, label: string) => Promise<void>; copied: string }) {
  const [index, setIndex] = useState(0), page = material.pages[index];
  const label = (value: CourseMaterial["pages"][number]) => value.page_number !== null ? `原第 ${value.page_number} 页` : value.section_number !== null ? `原第 ${value.section_number} 节` : "未分页原文";
  const value = page ? `${material.title}\n${label(page)}\n来源：${material.source_url || page.source_ref}\n\n${page.text}` : "";
  return <details className={styles.innerFold}><summary>{material.title}</summary><p>{material.is_excerpt ? "节选，保留原始页码。" : "来源文本。"}图表和排版请回看原文件。</p>{page && <><label className={styles.pagePicker}>查看位置<select value={index} onChange={event => setIndex(Number(event.target.value))}>{material.pages.map((item, i) => <option key={item.source_ref} value={i}>{label(item)}{item.title ? ` · ${item.title}` : ""}</option>)}</select></label><pre className={styles.excerpt}>{page.text}</pre><button type="button" className="text-button" onClick={() => void onCopy(value, "课件摘录")}>{copied === value ? "当前页已复制 ✓" : "复制当前页与来源"}</button></>}</details>;
}
