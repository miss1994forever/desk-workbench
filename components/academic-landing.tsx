"use client";

import { useEffect, useState } from "react";
import { academicTaskOf, type AcademicTaskSource } from "@/lib/task-progress";
import { academicHistory, academicDeadline, type AcademicPackage } from "@/lib/academic-context";
import { FilmLounge, type CinemaCollection } from "./film-lounge";

type LocalDraft = { key: string; text: string };
function safeUrl(value?: string): string | null { try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /token|secret|cookie|password|signature/i.test(key)) ? url.href : null; } catch { return null; } }
function safePath(value?: string): string | null { return value?.startsWith("/") && !value.startsWith("//") && !/[\u0000-\u001f]/.test(value) && !value.split("/").includes("..") ? value : null; }

export function AcademicLanding({ pkg, cinema, supplemental, onDraftStatus }: { pkg: AcademicPackage; cinema?: CinemaCollection; supplemental?: unknown; onDraftStatus: (dirty: boolean) => void }) {
  const task = academicTaskOf(pkg), history = academicHistory(pkg);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]), [deferred, setDeferred] = useState(false);
  const [copied, setCopied] = useState("");
  const [fallback, setFallback] = useState<{ value: string; label: string } | null>(null);
  useEffect(() => {
    const rows: LocalDraft[] = [];
    try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key === `progress:academic-note:${pkg.id}` || key?.startsWith(`progress:guided-draft:${pkg.id}:`)) { try { const value = JSON.parse(localStorage.getItem(key!) || "null"); if (typeof value?.text === "string" && value.text) rows.push({ key: key!, text: value.text }); } catch { /* A damaged entry must not hide other drafts. */ } } } } catch { /* Reading sources does not depend on local storage. */ }
    setDrafts(rows); setDeferred(false); setCopied(""); setFallback(null);
  }, [pkg.id]);
  useEffect(() => { onDraftStatus(!!drafts.length && !deferred); return () => onDraftStatus(false); }, [drafts.length, deferred, onDraftStatus]);
  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); setCopied(value); setFallback(null); } catch { setFallback({ value, label }); } }
  const sources: AcademicTaskSource[] = task?.sources || (pkg.content.sources || []).map(item => ({ id: item.id, title: item.document_title || item.title || item.label || item.id, url: item.url || item.source_url, path: item.path, detail: item.limitations }));
  const primary = sources.find(item => task?.source_refs.includes(item.id) && safeUrl(item.url));
  const workspace = safePath(task?.workspace_path);

  return <section className="academic-launch" id="academic-task-body" aria-label="课程工作入口">
    <div className="academic-launch-top"><p className="academic-deadline"><span aria-hidden="true">◷</span>{academicDeadline(pkg)}</p><FilmLounge compact cinema={cinema} supplemental={supplemental} /></div>
    {task ? <>
      <section className="academic-deliverables"><h3>{task.kind === "study" ? "这次学习的目标" : "需要完成"}</h3><ul>{task.deliverables.map(item => <li key={item}>{item}</li>)}</ul></section>
      {task.scope_note && <p className="academic-scope-note">{task.scope_note}</p>}
      {(primary || workspace) && <div className="academic-execution">{primary && <a className="primary" href={safeUrl(primary.url)!} target="_blank" rel="noopener noreferrer">{task.kind === "assignment" ? new URL(primary.url!).pathname === "/user/index" ? "打开学校作业列表" : "打开学校作业页面" : "查看原始要求"}<span aria-hidden="true">↗</span></a>}{workspace && <div><span>本地工作目录</span><strong>{workspace.split("/").filter(Boolean).slice(-2).join(" / ")}</strong><button type="button" className="text-button" onClick={() => void copy(workspace, "Mac 工作目录")}>{copied === workspace ? "位置已复制 ✓" : "复制目录位置"}</button>{copied === workspace && <small role="status">在访达“前往文件夹”中粘贴，或让当前 Codex 会话直接读取这个目录。</small>}</div>}</div>}
    </> : <p className="academic-scope-note">课程工作入口正在整理，原文件与来源保留在下方。</p>}
    {!!sources.length && <details className="academic-originals"><summary>原文件与来源 <span>{sources.length}</span></summary><ul>{sources.map(source => { const url = safeUrl(source.url), path = safePath(source.path); return <li key={source.id}><strong>{source.title}</strong><div>{url && source.id !== primary?.id && <a href={url} target="_blank" rel="noopener noreferrer">打开来源 ↗</a>}{path && <button type="button" className="text-button" onClick={() => void copy(path, source.title)}>{copied === path ? "文件位置已复制 ✓" : "复制原文件位置"}</button>}</div>{copied === path && path && <small role="status">在 Mac 访达“前往文件夹”中粘贴即可。</small>}{source.detail && <small>{source.detail}</small>}</li>; })}</ul></details>}
    {fallback && <section className="academic-copy-fallback"><label htmlFor="academic-location-copy">{fallback.label} · 可手动复制</label><textarea id="academic-location-copy" value={fallback.value} readOnly /></section>}
    {!!drafts.length && <section className="academic-legacy"><h4>旧版界面留下的本机草稿</h4><p>原话仍保留，可以复制使用。之后不必在网页填写进度。</p>{drafts.map((item, index) => <details key={item.key}><summary>查看草稿 {index + 1}</summary><p>{item.text}</p><button type="button" className="text-button" onClick={() => void copy(item.text, "旧草稿")}>{copied === item.text ? "原话已复制 ✓" : "复制原话"}</button></details>)}{!deferred && <button type="button" className="text-button" onClick={() => setDeferred(true)}>保留旧草稿，继续使用</button>}</section>}
    {!!history.length && <details className="academic-previous-records"><summary>此前留下的记录</summary><p>保留旧版记录，未据此判定当前作业完成。</p>{history.slice(0, 10).map(item => <details key={item.id}><summary>{item.label}</summary><p>{item.text}</p></details>)}</details>}
  </section>;
}
