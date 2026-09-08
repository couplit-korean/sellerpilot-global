"use client";

import { useEffect, useRef, useState } from "react";
import {
  shopeeHistoryReadSchema,
  shopeeHistoryStartSchema,
  type ShopeeHistoryRead,
} from "../../../../lib/cs/channels/shopee/history-events";
import styles from "../../lazada-quarantine.module.css";
import formStyles from "./history-progress.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
const kindLabel = { product_review: "상품 후기", return_refund: "Returns" } as const;
const statusLabel = {
  pending: "미시작", partial: "중단 지점부터 재개 필요", complete: "범위 대조 완료",
  failed: "수집 실패", authorization_required: "shop 권한·token 확인 필요",
} as const;

export function ShopeeHistoryProgress({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [data, setData] = useState<ShopeeHistoryRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [startMessage, setStartMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const pendingStart = useRef<{ range: string; requestKey: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const load = async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(""); setData(null);
    try {
      const response = await authenticatedFetch("/api/admin/cs/channels/shopee/history-progress", {
        cache: "no-store", signal: abort.signal,
      });
      if (!response.ok) throw new Error("Shopee history unavailable");
      const next = shopeeHistoryReadSchema.parse(await response.json());
      if (!abort.signal.aborted) setData(next);
    } catch {
      if (!abort.signal.aborted) setError("Shopee shop별 과거수집 범위를 조회하지 못했습니다.");
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  };

  const start = async () => {
    if (!fromDate || !toDate) {
      setError("Returns 과거수집의 시작일과 종료일을 선택해 주세요.");
      return;
    }
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(""); setStartMessage("");
    try {
      const range = `${fromDate}:${toDate}`;
      if (pendingStart.current?.range !== range) {
        pendingStart.current = { range, requestKey: crypto.randomUUID() };
      }
      const response = await authenticatedFetch("/api/admin/cs/channels/shopee/history-progress", {
        method: "POST", cache: "no-store", signal: abort.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestKey: pendingStart.current.requestKey, fromDate, toDate }),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error("Shopee history start unavailable");
      const started = shopeeHistoryStartSchema.parse(raw);
      if (!abort.signal.aborted) {
        pendingStart.current = null;
        setStartMessage(started.status === "queued"
          ? `${started.shopCount}개 검증 shop에 후기 ${started.reviewScopeCount}개·Returns ${started.returnScopeCount}개 범위를 접수했습니다.`
          : "동일 요청 범위가 이미 원장에 있어 중복 접수하지 않았습니다.");
        await load();
      }
    } catch {
      if (!abort.signal.aborted) setError("Shopee 연결 shop·권한 또는 과거수집 원장을 확인해 주세요.");
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  };

  return <details className={`panel ${styles.panel}`} onToggle={event => {
    if (event.currentTarget.open) return;
    controller.current?.abort(); setData(null); setError(""); setLoading(false);
  }}>
    <summary>Shopee shop별 후기·Returns 과거수집</summary>
    <p>후기는 Shopee가 제공하는 조회 가능 범위를 끝까지 읽습니다. 공급자가 전체 건수나 날짜 기준을 제공하지 않으면 임의로 만들지 않습니다. Returns는 선택 기간을 15일 이하 조회 구간으로 나누고 상세 잔량을 별도로 표시합니다.</p>
    <div className={formStyles.filters}>
      <label>Returns 시작일<input type="date" disabled={loading} value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
      <label>Returns 종료일<input type="date" disabled={loading} value={toDate} onChange={event => setToDate(event.target.value)} /></label>
      <button type="button" className="filter-button" disabled={loading} onClick={() => void start()}>검증된 shop별 과거수집 접수</button>
    </div>
    <button type="button" className="filter-button" disabled={loading} onClick={() => void load()}>{loading ? "조회 중…" : "Shopee 범위 조회"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {startMessage ? <p role="status">{startMessage}</p> : null}
    {data ? <p role="status">{data.historyRunId ? `수집 작업 ID ${data.historyRunId}` : "아직 계획된 Shopee 과거수집 작업이 없습니다."}</p> : null}
    <div className={styles.messages}>{data?.progress.shopKinds.map(group => <article key={`${group.shopId}:${group.kind}`}>
      <header><strong>{group.country} · {group.shopId} · {kindLabel[group.kind]}</strong><span>{statusLabel[group.status]}</span></header>
      <dl>
        <div><dt>범위</dt><dd>완료 {group.completedScopeCount.toLocaleString("ko-KR")}/{group.plannedScopeCount.toLocaleString("ko-KR")} · 남음 {group.remainingScopeKeys.length.toLocaleString("ko-KR")}</dd></div>
        <div><dt>원격/정상</dt><dd>{group.remoteUniqueCount.toLocaleString("ko-KR")} / {group.normalizedUniqueCount.toLocaleString("ko-KR")}</dd></div>
        <div><dt>중복/격리/제외/미처리</dt><dd>{group.duplicateRemoteCount.toLocaleString("ko-KR")} / {group.isolatedUniqueCount.toLocaleString("ko-KR")} / {group.excludedUniqueCount.toLocaleString("ko-KR")} / {group.unprocessedUniqueCount.toLocaleString("ko-KR")}</dd></div>
        <div><dt>재개</dt><dd>재개 지점 {group.activeCheckpointDigests.length.toLocaleString("ko-KR")}개 · 알려진 상세 잔량 {group.knownPendingDetailCount.toLocaleString("ko-KR")}</dd></div>
        <div><dt>공급자 남은 범위</dt><dd>{group.providerRemainderUnknown ? "미공개·추가 페이지 확인 필요" : "현재 원장에서 확인된 잔량 없음"}</dd></div>
      </dl>
    </article>)}</div>
  </details>;
}
