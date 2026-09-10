"use client";

import { useEffect, useRef, useState } from "react";
import {
  lazadaRawInboxHealthSchema,
  lazadaRawInboxPageSchema,
  type LazadaRawInboxHealth,
  type LazadaRawInboxPage,
} from "../../lib/cs/lazada-raw-inbox";
import styles from "./lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
const formatTime = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
const statusLabel = {
  pending: "재처리 대기",
  normalized: "CS 원장 반영",
  unsupported: "지원 형식 확인 필요",
  failed: "자동 재처리 실패",
} as const;

export function LazadaRawInbox({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [page, setPage] = useState<LazadaRawInboxPage | null>(null);
  const [health, setHealth] = useState<LazadaRawInboxHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  const load = async (more = false) => {
    const cursor = more ? page?.nextCursor : null;
    if (more && !cursor) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const run = ++generation.current;
    setLoading(true); setError("");
    if (!more) setPage(null);
    try {
      const query = cursor ? `?${new URLSearchParams({ cursor: JSON.stringify(cursor) })}` : "";
      const [response, healthResponse] = await Promise.all([
        authenticatedFetch(`/api/admin/cs/lazada-raw-inbox${query}`, { cache: "no-store", signal: abort.signal }),
        authenticatedFetch("/api/admin/cs/lazada-raw-inbox/health", { cache: "no-store", signal: abort.signal }),
      ]);
      if (!response.ok || !healthResponse.ok) throw new Error("raw inbox unavailable");
      const [next, nextHealth] = await Promise.all([
        response.json().then(value => lazadaRawInboxPageSchema.parse(value)),
        healthResponse.json().then(value => lazadaRawInboxHealthSchema.parse(value)),
      ]);
      if (abort.signal.aborted || run !== generation.current) return;
      setPage(current => more && current ? { ...next, events: [...current.events, ...next.events] } : next);
      setHealth(nextHealth);
    } catch {
      if (!abort.signal.aborted && run === generation.current) { setPage(null); setHealth(null); setError("Lazada 원문 이벤트를 조회하지 못했습니다."); }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  };

  const reprocess = async () => {
    setReprocessing(true); setError(""); setNotice("");
    try {
      const response = await authenticatedFetch("/api/admin/cs/lazada-raw-inbox/reprocess", {
        method: "POST",
        cache: "no-store",
      });
      const result = await response.json().catch(() => null) as { message?: unknown } | null;
      if (!response.ok && response.status !== 207) throw new Error("raw reprocess unavailable");
      setNotice(typeof result?.message === "string" ? result.message : "재처리 결과를 확인했습니다.");
      await load();
    } catch {
      setError("Lazada 원문 재처리를 실행하지 못했습니다. 원문은 보존됩니다.");
    } finally {
      setReprocessing(false);
    }
  };

  return <details className={`panel ${styles.panel}`} onToggle={event => {
    if (event.currentTarget.open) return;
    controller.current?.abort(); generation.current++;
    setPage(null); setHealth(null); setError(""); setNotice(""); setLoading(false);
  }}>
    <summary>Lazada 원문 이벤트 보관함</summary>
    <p>서명과 판매자 계정이 확인된 이미지·카드·회수·시스템 이벤트를 CS 변환 전에 원문 그대로 보관합니다. 원문 저장이 실패하면 Lazada에 성공 응답을 보내지 않습니다.</p>
    <p>30일 보관하며, 재처리 대기는 일반 문의나 답변 완료 건수에 합산하지 않습니다. 표시 시각은 한국 시간 기준 수집 시각입니다.</p>
    <div className="row"><button type="button" className="filter-button" disabled={loading || reprocessing} onClick={() => void load()}>{loading ? "조회 중…" : "원문 이벤트 조회"}</button>
      <button type="button" className="filter-button" disabled={loading || reprocessing} onClick={() => void reprocess()}>{reprocessing ? "재처리 중…" : "대기 원문 재처리"}</button></div>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {health ? <p role="status">전체 보관 {health.retained.toLocaleString("ko-KR")}건 ({health.retainedBytes.toLocaleString("ko-KR")}바이트) · 운영자별 최대 {health.maximumOwnerRetained.toLocaleString("ko-KR")} / {health.capacity.toLocaleString("ko-KR")}건 · 재처리 대기 {health.pending.toLocaleString("ko-KR")}건 · 자동 재처리 실패 {health.failed.toLocaleString("ko-KR")}건 · 24시간 안에 만료 {health.expiringWithin24Hours.toLocaleString("ko-KR")}건</p> : null}
    {page ? <p role="status">{page.events.length ? `${page.events.length}건 표시` : "보관 중인 원문 이벤트가 없습니다."}{page.nextCursor ? " · 다음 페이지가 있습니다." : " · 조회 끝"}</p> : null}
    <div className={styles.messages}>{page?.events.map(event => <article key={event.id}>
      <header><strong>{statusLabel[event.processingStatus]}</strong><span>{event.sourceKind === "webhook" ? "실시간 Push 원문" : "과거 조회 페이지 원문"}</span></header>
      <dl><div><dt>수집 시각</dt><dd>{formatTime(event.observedAt)}</dd></div><div><dt>보관기한</dt><dd>{formatTime(event.expiresAt)}</dd></div>
        {event.processedAt ? <div><dt>처리 시각</dt><dd>{formatTime(event.processedAt)}</dd></div> : null}</dl>
      <pre>{event.rawBody}</pre>
    </article>)}</div>
    {page?.nextCursor ? <button type="button" className="filter-button" disabled={loading} onClick={() => void load(true)}>원문 이벤트 더 보기</button> : null}
  </details>;
}
