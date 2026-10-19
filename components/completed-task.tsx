"use client";

import { useEffect, useState, type ReactNode } from "react";
import styles from "./completed-task.module.css";

type Destination = { id: string; title: string; domain: string; question?: string };
export function CompletedTask({ receipt, note, next, alternative, busy, hasDraft = false, onActivate, onReopen, children }: {
  receipt: string; note?: string; next?: Destination; alternative?: Destination; busy: boolean; hasDraft?: boolean;
  onActivate: (id: string) => void; onReopen?: () => void; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(hasDraft);
  useEffect(() => { if (hasDraft) setExpanded(true); }, [hasDraft]);
  return <section className={styles.done} aria-label="完成记录与下一项">
    <div className={styles.receipt}><span aria-hidden="true">✓</span><p>{receipt}</p></div>
    {note && <p className={styles.note}>{note}</p>}
    {next ? <button className={styles.next} type="button" disabled={busy} onClick={() => onActivate(next.id)} aria-label={`接着做：${next.title}`}><div><span className={styles.kicker}>{next.domain} · 下一项</span><strong>{next.title}</strong>{next.question && <p>{next.question}</p>}<span className={styles.start}>接着做这一项</span></div><span className={styles.arrow} aria-hidden="true">↗</span></button> : <div className={styles.allDone}><strong>眼前已备的工作都处理过了。</strong><p>可以先收工，材料和记录留在这里。</p></div>}
    {alternative && alternative.id !== next?.id && <button className={styles.alternative} type="button" disabled={busy} onClick={() => onActivate(alternative.id)}>也可以接今天的建议：{alternative.title} →</button>}
    <details className={styles.archive} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>回看完整材料与已保存内容<span aria-hidden="true">⌄</span></summary>{expanded && <div className={styles.archiveBody}>{onReopen && <button className={styles.reopen} type="button" disabled={busy} onClick={onReopen}>需要继续做，重新打开</button>}{children}</div>}</details>
  </section>;
}
