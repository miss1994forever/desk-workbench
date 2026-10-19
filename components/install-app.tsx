"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./install-app.module.css";

type InstallPrompt = Event & { prompt: () => Promise<unknown>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const APP_URL = "/";

export function InstallAppButton() {
  const pending = useRef<InstallPrompt | null>(null);
  const [available, setAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const panel = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const isInstalled = () => setInstalled(media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    isInstalled();
    const before = (event: Event) => { event.preventDefault(); pending.current = event as InstallPrompt; setAvailable(true); };
    const done = () => { pending.current = null; setAvailable(false); setInstalled(true); setOpen(false); };
    window.addEventListener("beforeinstallprompt", before); window.addEventListener("appinstalled", done); media.addEventListener("change", isInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", before); window.removeEventListener("appinstalled", done); media.removeEventListener("change", isInstalled); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]");
      if (!nodes?.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [open]);
  async function install() {
    const event = pending.current;
    if (!event) { setOpen(true); return; }
    setBusy(true); setStatus("");
    try {
      // This stays inside a real click gesture; never open an unsolicited prompt.
      await event.prompt();
      const choice = await event.userChoice;
      setStatus(choice.outcome === "accepted" ? "请按浏览器提示完成安装。" : "这次没有安装，随时可以再来。");
    } catch { setOpen(true); setStatus("浏览器暂时没有打开安装窗口，可以按下面的方式添加。"); }
    finally { pending.current = null; setAvailable(false); setBusy(false); }
  }
  if (installed) return null;
  return <>
    <button type="button" className={styles.trigger} onClick={() => { setOpen(true); setStatus(""); }} aria-label="安装应用" aria-haspopup="dialog"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg><span>安装<span className={styles.fullLabel}>应用</span></span></button>
    {open && createPortal(<div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}><section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="install-app-title" ref={panel}>
      <button type="button" className={styles.close} aria-label="关闭安装说明" ref={close} onClick={() => setOpen(false)}>×</button>
      <header className={styles.app}><img src="/icons/apple-touch-icon.png" width="72" height="72" alt="工作台应用图标" /><div><h2 id="install-app-title">工作台</h2><p>放在桌面，点开就能继续。</p></div></header>
      {available && <button className={styles.install} type="button" disabled={busy} onClick={() => void install()}>{busy ? "正在打开安装窗口…" : "安装工作台"}</button>}
      <div className={styles.instructions}>
        <h3>在 Chrome 中安装</h3><ol><li>用 Chrome 打开这个网址并登录。</li><li>右上角“⋮” →“投放、保存和分享” →“将网页安装为应用”。也可以点地址栏的安装图标。</li><li>名称保留“工作台”，点“安装”。</li></ol><p>用 Safari 时：菜单“文件” →“添加到程序坞”。</p><a href="https://support.google.com/chrome/answer/9658361?hl=zh-Hans" target="_blank" rel="noopener noreferrer">Chrome 官方说明 ↗</a>
      </div>
      <div className={styles.copy}><span>在普通浏览器中打开这个网址</span><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(APP_URL); setStatus("网址已复制，可以粘贴到浏览器。"); } catch { setStatus(APP_URL); } }}>复制网址</button></div>
      {status && <p className={styles.status} role="status">{status}</p>}
      <p className={styles.note}>已保存的进度仍是同一份。读取和保存需要联网；首次打开可能需要登录同一个账号。</p>
    </section></div>, document.body)}
  </>;
}
