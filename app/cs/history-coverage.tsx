"use client";

import { useEffect, useRef, useState } from "react";
import { channelCatalog } from "../../lib/channels/catalog";
import { csHistoryCoverageSchema, type CsHistoryCoverage } from "../../lib/cs/history-coverage";
import styles from "./lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
const formatTime = (value: string | null) => value
  ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
  : "범위 미확정";
const statusLabel = {
  running: "수집 진행 중",
  completed: "페이지 종료·행 대조 완료",
  reconciliation_required: "추가 대조 필요",
  failed: "수집 실패",
} as const;

export function CsHistoryCoverage({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [coverage, setCoverage] = useState<CsHistoryCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const load = async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(""); setCoverage(null);
    try {
      const response = await authenticatedFetch("/api/admin/cs/history-coverage", {
        cache: "no-store", signal: abort.signal,
      });
      if (!response.ok) throw new Error("coverage unavailable");
      const next = csHistoryCoverageSchema.parse(await response.json());
      if (!abort.signal.aborted) setCoverage(next);
    } catch {
      if (!abort.signal.aborted) setError("과거 문의 수집 범위를 조회하지 못했습니다.");
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  };

  return <details className={`panel ${styles.panel}`} onToggle={event => {
    if (event.currentTarget.open) return;
    controller.current?.abort(); setCoverage(null); setError(""); setLoading(false);
  }}>
    <summary>채널별 과거 문의 수집 범위·누락 확인</summary>
    <p>페이지 종료, 공급자 원격 행, 정규화된 메시지 이벤트, 반복 관측을 따로 집계합니다. 행과 메시지가 일대일이 아닌 채널은 종료만으로 전량 완료 처리하지 않습니다.</p>
    <button type="button" className="filter-button" disabled={loading} onClick={() => void load()}>{loading ? "조회 중…" : "수집 범위 조회"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {coverage ? <p role="status">최근 수집 범위 {coverage.scans.length.toLocaleString("ko-KR")}건 · 미해결 실패 범위 {coverage.gaps.filter(gap => !gap.resolvedAt).length.toLocaleString("ko-KR")}건</p> : null}
    <div className={styles.messages}>{coverage?.gaps.filter(gap => !gap.resolvedAt).map(gap => <article key={gap.jobId}>
      <header><strong>{channelCatalog[gap.channel].name} · 수집 중단</strong><span>{gap.terminalStatus}</span></header>
      <dl><div><dt>범위</dt><dd>{gap.scopeKey}</dd></div><div><dt>감지 시각</dt><dd>{formatTime(gap.lastObservedAt)}</dd></div></dl>
    </article>)}</div>
    <div className={styles.messages}>{coverage?.scans.map(scan => <article key={scan.scanId}>
      <header><strong>{channelCatalog[scan.channel].name} · {statusLabel[scan.status]}</strong><span>{scan.ticketKind}</span></header>
      <dl>
        <div><dt>조회 범위</dt><dd>{formatTime(scan.rangeStartAt)} ~ {formatTime(scan.rangeEndAt)} ({scan.timezone})</dd></div>
        <div><dt>페이지</dt><dd>{scan.pageCount.toLocaleString("ko-KR")}개</dd></div>
        <div><dt>원격 행</dt><dd>{scan.providerRowCount.toLocaleString("ko-KR")}개</dd></div>
        <div><dt>메시지 이벤트</dt><dd>{scan.projectedEventCount.toLocaleString("ko-KR")}개 · 고유 {scan.observedUniqueCount.toLocaleString("ko-KR")}개 · 반복 {scan.repeatedObservationCount.toLocaleString("ko-KR")}개</dd></div>
        <div><dt>근거 있는 제외</dt><dd>{scan.excludedCount.toLocaleString("ko-KR")}개</dd></div>
        <div><dt>미처리</dt><dd>{scan.unprocessedCount === null ? "행-이벤트 대조 필요" : `${scan.unprocessedCount.toLocaleString("ko-KR")}개`}</dd></div>
        <div><dt>완료 시각</dt><dd>{formatTime(scan.scanCompletedAt)}</dd></div>
      </dl>
      {scan.missingRanges.length ? <pre>{JSON.stringify(scan.missingRanges, null, 2)}</pre> : null}
    </article>)}</div>
  </details>;
}
