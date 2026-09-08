"use client";

import { useEffect, useRef, useState } from "react";
import {
  elevenstReadStateSchema,
  type ElevenstLimitedAccessSurface,
  type ElevenstReadState,
  type ElevenstReadSurface,
} from "../../../../lib/cs/channels/elevenst/read-state-contract";
import styles from "../../lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const providerStateLabels: Record<ElevenstReadSurface["providerState"], string> = {
  ready: "원격 행 확인",
  empty: "원격 0건 확인",
  business_error: "공급자 업무 오류",
  authorization_error: "인증·허용 IP 확인 필요",
  provider_unavailable: "공급자 응답 없음",
  unverified_failure: "원격 결과 미검증",
};

const accessModeLabels: Record<ElevenstLimitedAccessSurface["accessMode"], string> = {
  seller_office_session_only: "Seller Office 세션 전용",
  seller_office_export_only: "Seller Office 내보내기 전용",
};

function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "저장 행 없음";
}

export async function fetchElevenstReadState(
  authenticatedFetch: AuthenticatedFetch,
  signal?: AbortSignal,
) {
  const response = await authenticatedFetch("/api/admin/cs/channels/elevenst/read-state", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`ELEVENST_READ_STATE_HTTP_${response.status}`);
  return elevenstReadStateSchema.parse(await response.json());
}

function SurfaceState({ label, value }: { label: string; value: ElevenstReadSurface }) {
  return <article>
    <header><strong>{label}</strong><span>{providerStateLabels[value.providerState]}</span></header>
    <dl>
      <div><dt>원격 건수</dt><dd>{value.remoteCount === null ? "미확정" : `${value.remoteCount.toLocaleString("ko-KR")}건`}</dd></div>
      <div><dt>통합 CS 원장</dt><dd>{value.storedCount.toLocaleString("ko-KR")}건</dd></div>
      <div><dt>원격 확인 시각</dt><dd>{formatTime(value.checkedAt)}</dd></div>
      <div><dt>최근 저장 문의</dt><dd>{formatTime(value.latestStoredReceivedAt)}</dd></div>
      <div><dt>저장값 해석</dt><dd>{value.storedHistoryState === "current" ? "현재 원격 결과와 함께 표시" : "기존 원장 보존·원격 미확정"}</dd></div>
      <div><dt>답변</dt><dd>읽기 전용 · 자동 답변 비활성</dd></div>
    </dl>
    <p>{value.message}</p>
  </article>;
}

function LimitedAccessState({
  label,
  value,
}: {
  label: string;
  value: ElevenstLimitedAccessSurface;
}) {
  return <article>
    <header><strong>{label}</strong><span>공식 API 계약 미확인</span></header>
    <dl>
      <div><dt>접근 경로</dt><dd>{accessModeLabels[value.accessMode]}</dd></div>
      <div><dt>원격 건수</dt><dd>미확정</dd></div>
      <div><dt>통합 CS 원장</dt><dd>미연결</dd></div>
      <div><dt>자동 수신</dt><dd>비활성</dd></div>
      <div><dt>자동 답변</dt><dd>비활성</dd></div>
      <div><dt>보존기간</dt><dd>{value.retention === null
        ? "공식 확인 필요"
        : `최대 ${value.retention.maximum}개월 · 정확한 일수 미확정`}</dd></div>
    </dl>
    <p>{value.message}</p>
  </article>;
}

export function ElevenstReadStateSummary({ state }: { state: ElevenstReadState }) {
  return <>
    <p role="status">판매자 {state.sellerId} · {state.sellerName} · 저장 원장과 원격 관측을 분리해 표시합니다.</p>
    <div className={styles.messages}>
      <SurfaceState label="상품 Q&A" value={state.productQna} />
      <SurfaceState label="긴급알리미" value={state.urgentAlimi} />
      <LimitedAccessState label="셀러톡" value={state.sellerTalk} />
      <LimitedAccessState label="리뷰·댓글" value={state.review} />
    </div>
  </>;
}

export function ElevenstReadStatePanel({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [state, setState] = useState<ElevenstReadState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const load = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    try {
      const next = await fetchElevenstReadState(authenticatedFetch, abort.signal);
      if (!abort.signal.aborted) setState(next);
    } catch {
      if (!abort.signal.aborted) {
        setState(null);
        setError("11번가 읽기 관측과 통합 CS 원장을 조회하지 못했습니다.");
      }
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  };

  return <details className={`panel ${styles.panel}`} onToggle={(event) => {
    if (event.currentTarget.open) return;
    controller.current?.abort();
    setState(null);
    setError("");
    setLoading(false);
  }}>
    <summary>11번가 상품 Q&A·긴급알리미·셀러톡·리뷰 읽기 상태</summary>
    <p>공식 API 관측과 제한된 Seller Office 접근을 분리합니다. API 오류·수동 화면의 0건을 과거 전체 0건으로 바꾸지 않습니다.</p>
    <button type="button" className="filter-button" disabled={loading} onClick={() => void load()}>
      {loading ? "조회 중…" : "11번가 저장·원격 상태 조회"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
    {state ? <ElevenstReadStateSummary state={state} /> : null}
  </details>;
}
