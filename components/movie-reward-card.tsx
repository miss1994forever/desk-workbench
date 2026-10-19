"use client";

import { useEffect, useRef, useState } from "react";
import { MOVIE_REWARDS, type MovieReward } from "@/lib/movie-rewards";

const FLAVOURS = [
  { id: "vfx", icon: "✧", label: "特效机关" },
  { id: "sound", icon: "♫", label: "配乐一口" },
  { id: "performance", icon: "◒", label: "角色背后" },
] as const;
const HISTORY_KEY = "progress:movie-cards-opened:v1";
function flavour(card: MovieReward): string {
  return "category" in card && typeof card.category === "string" ? card.category : card.id.startsWith("soul-") ? "sound" : card.id.includes("hulk") ? "performance" : "vfx";
}

export function MovieRewardCard({ card, onClose, contextLabel = "阶段成果已留下", progressNote, cards = MOVIE_REWARDS, earned = false }: { card: MovieReward; onClose: () => void; contextLabel?: string; progressNote?: string; cards?: MovieReward[]; earned?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [opened, setOpened] = useState<Record<string, MovieReward>>(() => earned ? { [flavour(card)]: card } : {});
  const [choice, setChoice] = useState<string | null>(() => earned ? flavour(card) : null);
  const current = choice ? opened[choice] : null;
  function reveal(category: string) {
    if (opened[category]) { setChoice(category); return; }
    let seen: string[] = [];
    try { const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); if (Array.isArray(saved)) seen = saved.filter(id => typeof id === "string"); } catch { /* Cosmetic preference only. */ }
    const pool = cards.filter(item => flavour(item) === category);
    const unused = pool.filter(item => !seen.includes(item.id));
    const candidates = unused.length ? unused : pool;
    const selected = candidates[(Array.from(card.id).reduce((sum, character) => sum + character.charCodeAt(0), 0) + seen.length) % (candidates.length || 1)] || card;
    setOpened(value => ({ ...value, [category]: selected })); setChoice(category);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify([...seen.filter(id => id !== selected.id), selected.id].slice(-100))); } catch { /* Never changes shared work. */ }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>("button,a[href]");
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose]);
  let url: string | null = null;
  try { if (current) { const parsed = new URL(current.source_url); if (parsed.protocol === "https:") url = parsed.href; } } catch { /* Invalid reward links stay noninteractive. */ }
  return <div className="reward-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section className="movie-reward" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="reward-title"><div className="reward-top"><span>{contextLabel} · 电影彩蛋</span><button type="button" ref={closeRef} onClick={onClose} aria-label="关闭电影彩蛋">×</button></div>{progressNote && <div className="reward-progress-receipt"><strong>对应的阶段成果</strong><p>{progressNote}</p></div>}<div className="reward-ticket" aria-hidden="true">✦ <span>AFTER THE CREDITS</span></div><div className="reward-flavours" role="group" aria-label="选一种电影彩蛋">{FLAVOURS.map(item => <button type="button" key={item.id} className={choice === item.id ? "selected" : ""} onClick={() => reveal(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}{opened[item.id] && <small> · 已拆</small>}</button>)}</div><div className="reward-reveal" aria-live="polite" key={current?.id || "sealed"}><h2 id="reward-title">{current?.title || "选择电影彩蛋"}</h2><p>{current?.text || "选一个喜欢的角度，看看电影里的小发现。随时可以关掉。"}</p>{current && url && <a href={url} target="_blank" rel="noopener noreferrer">{current.source_label} ↗</a>}</div><button type="button" className="primary" onClick={onClose}>{current ? "返回工作台" : "关闭"}</button><small>{earned ? "这张卡已保存在收藏，之后可随时回看。切换类别只浏览，不重复发卡。" : "可以随时关闭。已拆记录只帮助这个浏览器少重复，不影响已同步的工作进度。"}</small></section></div>;
}
