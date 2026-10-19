"use client";

import { useRef, useState } from "react";
import { conversationForWork, planWorkLaunch, type LaunchPackage, type WorkLaunch } from "@/lib/work-launch";
import styles from "./execution-landing.module.css";

export function WorkConversationAction({ pkg }: { pkg: LaunchPackage }) {
  const initial = planWorkLaunch(pkg), conversation = conversationForWork(pkg);
  const [opening, setOpening] = useState(false), [opened, setOpened] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<string | null>(null);
  const pending = useRef(false);
  async function start() {
    if (pending.current) return;
    pending.current = true; setOpening(true); setMessage(""); setRetry(null);
    try {
      // A binding may have arrived from another tab since this page was read.
      const response = await fetch(`/api/work/launch?package_id=${encodeURIComponent(pkg.id)}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("launch_read_failed");
      const latest: WorkLaunch = await response.json();
      if (latest.kind === "unavailable") {
        setMessage(latest.reason === "bound_without_link" ? "已有工作对话，请在 Codex 中打开原对话。" : latest.reason === "task_completed" ? "这项已完成，请选择下一项。" : latest.reason === "paused" ? "工作台已暂停。" : "暂未确认合适的本机目录，请在 GPT 中继续。");
        return;
      }
      const parsed = new URL(latest.href);
      const local = parsed.protocol === "codex:" && ["new", "threads"].includes(parsed.hostname);
      const chat = latest.kind === "existing" && parsed.protocol === "https:" && parsed.hostname === "chatgpt.com" && /^\/c\/[a-zA-Z0-9-]+$/.test(parsed.pathname) && !parsed.search;
      if ((!local && !chat) || parsed.username || parsed.password || parsed.hash || parsed.port) throw new Error("invalid_launch_link");
      setOpened(true); setRetry(latest.href);
      setMessage(latest.kind === "new" ? "在 Codex 发送已填好的第一条消息，即可开始并关联；不用复制材料。" : "已请求打开原对话。");
      window.location.assign(latest.href);
    } catch { setMessage("暂时无法准备对话，请稍后重试。现有记录没有改动。"); }
    finally { pending.current = false; setOpening(false); }
  }
  return <section className={styles.continue} aria-label={initial.kind === "new" ? "新建工作对话" : "继续原对话"}>
    {initial.kind === "existing" ? <a className="primary" href={initial.href} target={conversation?.surface === "chatgpt" ? "_blank" : undefined} rel="noopener noreferrer">在原 {conversation?.surface === "codex" ? "Codex" : "GPT"} 对话继续 <span aria-hidden="true">↗</span></a> : initial.kind === "new" ? <button type="button" className="primary" disabled={opening || opened} onClick={() => void start()}>{opening ? "正在准备…" : opened ? "请在 Codex 中继续" : "新建工作对话"}<span aria-hidden="true"> ↗</span></button> : <strong>{conversation ? "在原对话继续" : "在 GPT 中继续"}</strong>}
    <div>{conversation ? <p>{conversation.title}</p> : initial.kind === "new" ? <p>在对应的本机目录打开 Codex，开场消息已准备好。</p> : <p>{initial.kind === "unavailable" && initial.reason === "task_completed" ? "这项已完成，记录已保留。" : "这项尚未配置可直接打开的工作目录。"}</p>}<small>{initial.kind === "new" ? "首次发送后自动关联，以后直接回到同一对话。" : conversation ? "继续原来的讨论即可，不用回网页填写进度。" : "可以直接在 GPT 中开始，不需要填写网页进度。"}</small>{message && <p className={styles.launchMessage} role="status">{message}</p>}{retry && <a className={styles.launchRetry} href={retry}>Codex 没有打开？再试一次 ↗</a>}{!opened && initial.kind === "new" && message && <button type="button" className="text-button" onClick={() => void start()} disabled={opening}>重试</button>}</div>
  </section>;
}
