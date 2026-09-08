"use client";

import { useEffect, useRef, useState } from "react";
import { quarantinePageSchema, type QuarantinePage } from "../../lib/cs/lazada-quarantine";
import styles from "./lazada-quarantine.module.css";

type FetchOriginals = (input: string, init?: RequestInit) => Promise<Response>;
const formatTime = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

export function LazadaQuarantine({ authenticatedFetch }: { authenticatedFetch: FetchOriginals }) {
  const [page, setPage] = useState<QuarantinePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!page) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [page]);

  const load = async (next = false) => {
    const cursor = next ? page?.nextCursor : null;
    if (next && !cursor) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const run = ++generation.current;
    setPage(null); setError(""); setLoading(true);
    try {
      const query = cursor ? `?${new URLSearchParams({ cursor: JSON.stringify(cursor) })}` : "";
      const response = await authenticatedFetch(`/api/admin/cs/lazada-quarantine${query}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) throw new Error("quarantine unavailable");
      const result = quarantinePageSchema.parse(await response.json());
      if (abort.signal.aborted || run !== generation.current) return;
      setNow(Date.now()); setPage(result);
    } catch {
      if (!abort.signal.aborted && run === generation.current) setError("원문을 조회하지 못했습니다. 잠시 후 다시 조회해 주세요.");
    } finally {
      if (run === generation.current) setLoading(false);
    }
  };
  const visible = page?.messages.filter(message => Date.parse(message.expiresAt) > now) ?? [];
  return <details className={`panel ${styles.panel}`} onToggle={event => {
    if (event.currentTarget.open) return;
    controller.current?.abort(); generation.current++;
    setPage(null); setError(""); setLoading(false);
  }}>
    <summary>Lazada 확인 필요 원문</summary>
    <p>발송 시각·전달 여부가 미확정이거나 같은 메시지 ID의 내용이 충돌한 원문입니다. 일반 문의와 답변 완료 건에 합산하지 않습니다.</p>
    <p>수집 후 7일간 임시 보관합니다. 아래 시각은 발송 시각이 아닌 수집 시각이며, 모두 한국 시간입니다. 재조회해도 보관기한은 늘어나지 않습니다.</p>
    <button type="button" className="filter-button" disabled={loading} onClick={() => void load()}>{loading ? "조회 중…" : "확인 필요 원문 조회"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {page ? <p role="status">{visible.length ? `현재 페이지 ${visible.length}건` : "현재 페이지에 보관 중인 원문이 없습니다."}{page.nextCursor ? " · 다음 페이지가 있습니다." : " · 조회 끝"}</p> : null}
    <div className={styles.messages}>{visible.map(message => <article key={message.key}>
      <header><strong>{message.senderRole === "customer" ? "고객 원문" : "판매자 원문"}</strong><span>{message.reason === "conflict" ? "메시지 ID 충돌 · 확인 필요" : "시각·전달 확인 필요"}</span></header>
      <dl><div><dt>대화 ID</dt><dd>{message.sessionId}</dd></div><div><dt>메시지 ID</dt><dd>{message.messageId}</dd></div>
        <div><dt>수집 시각</dt><dd>{formatTime(message.observedAt)}</dd></div><div><dt>보관기한</dt><dd>{formatTime(message.expiresAt)}</dd></div></dl>
      <pre>{message.body}</pre>
    </article>)}</div>
    {page?.nextCursor ? <button type="button" className="filter-button" disabled={loading} onClick={() => void load(true)}>다음 원문 25건</button> : null}
  </details>;
}
