"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FILM_CHAPTERS, FILM_DAYS, FILM_SEASON, beijingDay, filmForDay, filmImageForCard, type FilmDailyCard } from "@/lib/film-season";
import { movieRewardBank, type MovieReward } from "@/lib/movie-rewards";
import type { MilestoneRecord } from "@/lib/progress-milestones";
import type { EarnedCinemaCard } from "@/lib/cinema-progress";
import styles from "./film-lounge.module.css";

export type CinemaCollection = { anchor_date?: string; milestones?: MilestoneRecord[]; earned_cards?: EarnedCinemaCard[]; earned_total?: number; collection_capacity?: number };
type Panel = "today" | "season" | "collection";
type ReadableCard = MovieReward & Partial<Pick<FilmDailyCard, "date" | "kind" | "chapter_id" | "film_title" | "topic" | "post_note">>;
function shortDate(value: string) { return value.slice(5).replace("-", "."); }
function sourceLink(value: string) { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }

/** Opening a discovery is free. Collection receipts are recorded by the server; achievement is owner-reported. */
export function FilmLounge({ cinema, supplemental, compact = false }: { cinema?: CinemaCollection; supplemental?: unknown; compact?: boolean }) {
  const [day, setDay] = useState(() => beijingDay());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selected, setSelected] = useState<ReadableCard | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const daily = filmForDay(day);
  const earned = Array.isArray(cinema?.earned_cards) ? cinema.earned_cards : [];
  const cards = new Map<string, ReadableCard>([...movieRewardBank(supplemental), ...FILM_DAYS].map(card => [card.id, card]));
  const opened = selected || daily?.card || null;
  const chapter = opened?.chapter_id ? FILM_CHAPTERS.find(item => item.id === opened.chapter_id) : undefined;
  const image = opened?.chapter_id && opened.date ? filmImageForCard({ chapter_id: opened.chapter_id, date: opened.date }) : null;
  const open = (value: Panel) => { setSelected(null); setPanel(value); };
  useEffect(() => { const tick = window.setInterval(() => setDay(beijingDay()), 60000); return () => clearInterval(tick); }, []);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
      if (event.key !== "Tab") return;
      const nodes = modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]");
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [!!panel]);
  return <>
    {compact ? <button type="button" className="academic-film-button" onClick={() => open(daily ? "today" : "season")}><span aria-hidden="true">✦</span> 电影小卡{earned.length > 0 && <small>{earned.length}</small>}</button> : <section className={styles.corner} aria-label="电影小发现">
      <div className={styles.cornerTop}><span>电影角落</span><span>{shortDate(day)}</span></div>
      <div className={styles.miniTicket} aria-hidden="true"><span>AFTER HOURS</span><i>✦</i></div>
      <h3>{daily ? "今日电影彩蛋" : "电影收藏"}</h3>
      <p>{daily ? `${daily.card.film_title || daily.chapter.media_title} · ${daily.card.topic || "幕后故事"}` : "幕后故事、制作细节与电影片单。"}</p>
      <button type="button" className={styles.openToday} onClick={() => open(daily ? "today" : "season")}>{daily ? "查看今日彩蛋" : "浏览片单"}<span aria-hidden="true">↗</span></button>
      <div className={styles.cornerBottom}><button type="button" onClick={() => open("collection")}>我的收藏 <b>{earned.length}</b></button><button type="button" onClick={() => open("season")}>全部片单 →</button></div>
    </section>}
    {panel && createPortal(<div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) setPanel(null); }}>
      <section className={styles.lounge} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="film-room-title">
        <header className={styles.header}><div><span className={styles.kicker}>YOUR LITTLE FILM CLUB</span><h2 id="film-room-title">电影角落</h2></div><button type="button" ref={closeRef} onClick={() => setPanel(null)} aria-label="关闭电影小发现">×</button></header>
        <div className={styles.tabs} role="tablist" aria-label="电影内容"><button type="button" role="tab" aria-selected={panel === "today"} onClick={() => open("today")}>今日彩蛋</button><button type="button" role="tab" aria-selected={panel === "season"} onClick={() => open("season")}>全部片单</button><button type="button" role="tab" aria-selected={panel === "collection"} onClick={() => open("collection")}>我的收藏 · {earned.length}</button></div>
        <div className={styles.body} role="tabpanel">
          {panel === "season" ? <><div className={styles.seasonIntro}><h3>电影、剧集与幕后故事</h3><p>{shortDate(FILM_SEASON.from)}—{shortDate(FILM_SEASON.through)} · 9 个专题 · 59 则制作故事，随时可以翻看。</p></div><div className={styles.shelf}>{FILM_CHAPTERS.map((item, index) => <button type="button" className={styles.book} key={item.id} onClick={() => { const card = FILM_DAYS.find(day => day.chapter_id === item.id); if (card) { setSelected(card); setPanel("today"); } }} style={{ "--cover": item.accent } as React.CSSProperties}><span className={styles.cover}><span className={styles.coverFallback}><small>{item.media_type}</small><strong>{item.media_title}</strong><i aria-hidden="true">✦</i></span>{item.poster_url && <img src={item.poster_url} alt={`${item.media_title} 官方封面`} loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}<span className={styles.bookNumber}>{String(index + 1).padStart(2, "0")}</span></span><strong>{item.title}</strong><small>{shortDate(item.from)}—{shortDate(item.to)}</small></button>)}</div><p className={styles.note}>日期对应专题的更新安排。</p></> : panel === "collection" ? <>
            <div className={styles.seasonIntro}><h3>{earned.length ? "阶段成果纪念卡" : "还没有收藏"}</h3><p>{earned.length ? "每张纪念卡对应一项阶段成果，之前的收藏仍然保留。" : "完成阶段成果后，可以获得电影纪念卡。每日彩蛋随时可看。"}</p></div>
            {earned.length ? <div className={styles.collection}>{[...earned].reverse().map(item => { const card = cards.get(item.card_id); return <button key={item.event_id} type="button" onClick={() => { if (card) { setSelected(card); setPanel("today"); } }} disabled={!card}><span aria-hidden="true">✦</span><small>{shortDate(item.earned_day)}</small><strong>{card?.title || "往期电影小卡"}</strong><small>{item.basis === "meaningful_milestone" ? item.milestone_title || "阶段成果纪念卡" : "早期收藏 · 保留原记录"}</small></button>; })}</div> : <button type="button" className={styles.emptyCollection} onClick={() => open("season")}><span aria-hidden="true">✦</span><strong>浏览电影片单</strong><small>查看全部主题 →</small></button>}
          </> : opened ? <>
            <div className={styles.discovery}>
              <div className={styles.discoveryArt} style={{ "--cover": chapter?.accent || "#3158e8" } as React.CSSProperties}><div className={styles.coverFallback}><small>{chapter?.media_type || "幕后小卡"}</small><strong>{opened.film_title || chapter?.media_title || "FILM NOTES"}</strong><i aria-hidden="true">✦</i></div>{image && <img key={image.url} src={image.url} alt={`${opened.film_title || chapter?.media_title || "电影"} 官方图片`} referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}</div>
              <div className={styles.discoveryText}><div className={styles.discoveryMeta}><span>{opened.date ? shortDate(opened.date) : "收藏回看"}</span><span>{opened.kind === "watch_prompt" ? "原创观看角度" : opened.kind === "on_this_day" ? "这一天的电影记忆" : opened.topic || "制作故事"}</span></div><p className={styles.filmTitle}>{opened.film_title || chapter?.media_title}</p><h3>{opened.title}</h3><p>{opened.text}</p>{opened.post_note && <details key={opened.id} className={styles.craftNote}><summary>再了解一点制作方法</summary><p>{opened.post_note}</p></details>}{sourceLink(opened.source_url) && <a href={sourceLink(opened.source_url)} target="_blank" rel="noopener noreferrer">{opened.source_label} ↗</a>}{image && <a href={image.source_url} target="_blank" rel="noopener noreferrer">官方图片来源 ↗</a>}<small className={styles.freeRead}>来源为制作公司记录或创作者访谈。</small>{(() => { const receipt = earned.find(item => item.card_id === opened.id && item.basis === "meaningful_milestone"); const milestone = receipt && cinema?.milestones?.find(item => item.event_id === receipt.event_id); return milestone ? <div className={styles.progressReceipt}><strong>对应的阶段成果</strong><p>{milestone.title}</p><p>{milestone.evidence}</p><small>{milestone.basis === "agent_report" ? "原工作对话记录的阶段成果" : "本人记录的阶段成果"}</small></div> : null; })()}</div>
            </div>
            {chapter && <div className={styles.dayStrip} aria-label="这个主题的日卡">{FILM_DAYS.filter(item => item.chapter_id === chapter.id).map(item => <button key={item.id} type="button" className={opened.id === item.id ? styles.selectedDay : ""} onClick={() => setSelected(item)}><small>{shortDate(item.date)}</small><strong>{item.title}</strong></button>)}</div>}
          </> : <div className={styles.seasonIntro}><h3>本期内容已更新完毕</h3><p>仍可浏览全部片单与收藏。</p><button type="button" className={styles.openToday} onClick={() => open("season")}>看看全部片单 →</button></div>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
