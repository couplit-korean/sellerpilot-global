"use client";

import { useEffect, useRef, useState } from "react";
import {
  qoo10ReviewChatAccountsSchema,
  qoo10ReviewChatAccountSchema,
  qoo10ReviewChatStatusSchema,
  type Qoo10ReviewChatAccount,
  type Qoo10ReviewChatStatus,
} from "../../../../lib/cs/channels/qoo10/review-chat-contract";
import styles from "../../lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const evidenceLabels: Record<Qoo10ReviewChatStatus["review"]["evidenceState"], string> = {
  no_evidence: "선택 계정 관측 없음",
  missing_source: "이력 원본 접근 필요",
  current: "현재 계정 증거 확인",
  expired: "증거 유효기간 만료",
  identity_unverified: "판매자 계정 결속 미확인",
  credential_unavailable: "연결 계정 사용 불가",
  contract_unverified: "공식 계약 미확인",
  unsupported: "자동 수신 미지원",
};

const ordinaryInquiryEvidenceLabels: Record<
  Qoo10ReviewChatStatus["ordinaryInquiry"]["evidenceState"],
  string
> = {
  canonical_rows: "canonical 저장 확인",
  verified_zero: "완료된 QAPI 구간에서 0건 확인",
  not_observed: "완료된 수신 구간 없음",
  incomplete_coverage: "수신 구간 미완료",
  persistence_mismatch: "provider 행과 canonical 저장 불일치",
  identity_unverified: "판매자 계정 결속 미확인",
  credential_unavailable: "연결 계정 사용 불가",
};

const accountEvidenceLabels: Record<Qoo10ReviewChatStatus["accountEvidenceState"], string> = {
  current: "선택 계정의 판매자·환경 결속 확인",
  identity_unverified: "판매자 계정 결속 미확인",
  credential_unavailable: "연결 계정 사용 불가",
};

const historyLabels: Record<Qoo10ReviewChatStatus["review"]["historyState"], string> = {
  unknown: "미확인",
  verified_zero: "원격 0건 확인",
  imported_reconciled: "가져오기·대조 완료",
};

function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "유효기간 미확정";
}

export async function fetchQoo10ReviewChatAccounts(
  authenticatedFetch: AuthenticatedFetch,
  signal?: AbortSignal,
) {
  const response = await authenticatedFetch(
    "/api/admin/cs/channels/qoo10/review-chat?view=accounts",
    { method: "GET", cache: "no-store", signal },
  );
  if (!response.ok) throw new Error(`QOO10_REVIEW_CHAT_ACCOUNTS_HTTP_${response.status}`);
  return qoo10ReviewChatAccountsSchema.parse(await response.json()).accounts;
}

export async function fetchQoo10ReviewChatStatus(
  authenticatedFetch: AuthenticatedFetch,
  credentialId: string,
  signal?: AbortSignal,
) {
  const parsedCredential = qoo10ReviewChatAccountSchema.shape.credentialId.parse(credentialId);
  const params = new URLSearchParams({ view: "status", credentialId: parsedCredential });
  const response = await authenticatedFetch(
    `/api/admin/cs/channels/qoo10/review-chat?${params}`,
    { method: "GET", cache: "no-store", signal },
  );
  if (!response.ok) throw new Error(`QOO10_REVIEW_CHAT_STATUS_HTTP_${response.status}`);
  const status = qoo10ReviewChatStatusSchema.parse(await response.json());
  if (status.account.credentialId !== parsedCredential) {
    throw new Error("QOO10_REVIEW_CHAT_ACCOUNT_MISMATCH");
  }
  return status;
}

function SurfaceState({ value }: { value: Qoo10ReviewChatStatus["review"] }) {
  return <article>
    <header><strong>{value.label}</strong><span>{evidenceLabels[value.evidenceState]} · {historyLabels[value.historyState]}</span></header>
    <dl>
      <div><dt>공식 QAPI Method</dt><dd>{value.officialQapiMethod ?? "확인되지 않음"}</dd></div>
      <div><dt>source 지원 상태</dt><dd>{value.supportState}</dd></div>
      <div><dt>미지원 사유</dt><dd><code>{value.unsupportedReason}</code></dd></div>
      <div><dt>원격 건수</dt><dd>{value.observedCount === null ? "미확정" : `${value.observedCount.toLocaleString("ko-KR")}건`}</dd></div>
      <div><dt>가져온 이력</dt><dd>{value.importedCount.toLocaleString("ko-KR")}건</dd></div>
      <div><dt>대조 완료</dt><dd>{value.reconciledCount.toLocaleString("ko-KR")}건</dd></div>
      <div><dt>부족한 원본</dt><dd>{value.missingSource ?? "현재 계정 증거 있음"}</dd></div>
      <div><dt>부족한 권한</dt><dd>{value.missingPermission ?? "현재 계정 권한 증거 있음"}</dd></div>
      <div><dt>자동 수신·가져오기·답변</dt><dd>모두 비활성</dd></div>
    </dl>
  </article>;
}

function OrdinaryInquiryState({
  value,
}: {
  value: Qoo10ReviewChatStatus["ordinaryInquiry"];
}) {
  return <article>
    <header><strong>{value.label}</strong><span>{value.supportState} · {
      ordinaryInquiryEvidenceLabels[value.evidenceState]
    }</span></header>
    <dl>
      <div><dt>수신 Method</dt><dd><code>{value.receiveMethod}</code></dd></div>
      <div><dt>답변 Method</dt><dd><code>{value.replyMethod}</code></dd></div>
      <div><dt>canonical 티켓</dt><dd>{value.canonical.ticketCount.toLocaleString("ko-KR")}건</dd></div>
      <div><dt>canonical 고객 메시지</dt><dd>{value.canonical.inboundMessageCount.toLocaleString("ko-KR")}건</dd></div>
      <div><dt>완료/전체 history 구간</dt><dd>{value.history.completeWindowCount.toLocaleString("ko-KR")} / {value.history.windowCount.toLocaleString("ko-KR")}</dd></div>
      <div><dt>gap 구간</dt><dd>{value.history.gapWindowCount.toLocaleString("ko-KR")}건</dd></div>
      <div><dt>마지막 고객 메시지</dt><dd>{formatTime(value.canonical.lastReceivedAt)}</dd></div>
      <div><dt>구현 경계</dt><dd>adapter → normalizer → canonical 저장</dd></div>
      <div><dt>이 패널의 답변 버튼</dt><dd>비활성</dd></div>
    </dl>
  </article>;
}

export function Qoo10ReviewChatStatusSummary({ status }: { status: Qoo10ReviewChatStatus }) {
  const evidence = status.lastEvidence;
  return <>
    <p role="status">
      {accountEvidenceLabels[status.accountEvidenceState]} · {evidence
        ? `마지막 관측 ${formatTime(evidence.observedAt)}`
        : "선택 계정에 결속된 관측 없음"}
    </p>
    <p>운영 환경 {status.account.environment} · 판매자 결속 {
      status.account.sellerAccountBinding
    } · credential {status.account.credentialState}</p>
    {evidence ? <dl>
      <div><dt>불변 revision</dt><dd>{evidence.sourceRevision}</dd></div>
      <div><dt>revision SHA-256</dt><dd><code>{evidence.sourceRevisionSha256}</code></dd></div>
      <div><dt>원본 식별자</dt><dd><code>{evidence.sourceArtifactId}</code></dd></div>
      <div><dt>원본 SHA-256</dt><dd><code>{evidence.sourceArtifactSha256}</code></dd></div>
      <div><dt>증거 유효기한</dt><dd>{formatTime(evidence.validUntil)}</dd></div>
      <div><dt>판매자 대시보드</dt><dd>{evidence.sellerDashboardVisible ? "확인" : "미확인"}</dd></div>
      <div><dt>문의 요약</dt><dd>{evidence.buyerInquirySummaryVisible ? "확인" : "미확인"}</dd></div>
      <div><dt>review 이력 화면</dt><dd>{evidence.reviewHistoryVisible ? "확인" : "미확인"}</dd></div>
      <div><dt>review 이동 결과</dt><dd>{evidence.reviewNavigationResult}</dd></div>
      <div><dt>Buyer Chat 이력 화면</dt><dd>{evidence.buyerChatHistoryVisible ? "확인" : "미확인"}</dd></div>
      <div><dt>Buyer Chat 이동 결과</dt><dd>{evidence.buyerChatNavigationResult}</dd></div>
    </dl> : <p>하드코딩된 과거 관측은 선택 계정의 현재 증거로 사용하지 않습니다.</p>}
    {evidence?.reviewNavigationResult === "redirected_to_login"
      ? <p>마지막 확인에서는 정확한 review 이력 화면으로 이동하지 못했습니다. 새로 인증된 QSM 이력 세션이 필요합니다.</p>
      : null}
    <p>공식 QAPI 일반 문의는 별도 canonical 경로로 표시하며, 그 성공은 review 또는 Buyer Chat 지원으로 승격되지 않습니다.</p>
    <div className={styles.messages}>
      <OrdinaryInquiryState value={status.ordinaryInquiry} />
      <SurfaceState value={status.review} />
      <SurfaceState value={status.buyerChat} />
    </div>
    <p>브라우저 기록 API 없음 · 서버 전용 불변 원장 · 관측으로 권한 부여 안 함</p>
    <p>고객 전송·댓글·채팅 답변 기능은 열려 있지 않습니다.</p>
  </>;
}

export function Qoo10ReviewChatStatusPanel({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [expanded, setExpanded] = useState(false);
  const [accounts, setAccounts] = useState<Qoo10ReviewChatAccount[]>([]);
  const [credentialId, setCredentialId] = useState("");
  const [status, setStatus] = useState<Qoo10ReviewChatStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stateSession, setStateSession] = useState<AuthenticatedFetch>(
    () => authenticatedFetch,
  );
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    controller.current?.abort();
    controller.current = null;
    void Promise.resolve().then(() => {
      if (generation.current !== requestGeneration) return;
      setStateSession(() => authenticatedFetch);
      setAccounts([]); setCredentialId(""); setStatus(null); setError("");
      setLoading(expanded);
    });
    if (!expanded) return () => {
      if (generation.current === requestGeneration) generation.current += 1;
    };

    const abort = new AbortController();
    controller.current = abort;
    void fetchQoo10ReviewChatAccounts(authenticatedFetch, abort.signal).then(
      (next) => {
        if (abort.signal.aborted || generation.current !== requestGeneration) return;
        setAccounts(next);
        setCredentialId(next[0]?.credentialId ?? "");
      },
      () => {
        if (!abort.signal.aborted && generation.current === requestGeneration) {
          setAccounts([]); setCredentialId("");
          setError("Qoo10 연결 계정 목록을 조회하지 못했습니다.");
        }
      },
    ).finally(() => {
      if (!abort.signal.aborted && generation.current === requestGeneration) {
        setLoading(false);
      }
    });
    return () => {
      generation.current += 1;
      controller.current?.abort();
      controller.current = null;
      abort.abort();
    };
  }, [authenticatedFetch, expanded]);

  const loadStatus = async () => {
    if (!credentialId) return;
    controller.current?.abort();
    const requestedCredentialId = credentialId;
    const requestGeneration = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true); setError(""); setStatus(null);
    try {
      const next = await fetchQoo10ReviewChatStatus(
        authenticatedFetch,
        requestedCredentialId,
        abort.signal,
      );
      if (!abort.signal.aborted && generation.current === requestGeneration
          && requestedCredentialId === credentialId) setStatus(next);
    } catch {
      if (!abort.signal.aborted && generation.current === requestGeneration) {
        setStatus(null); setError("Qoo10 review·Buyer Chat 증거 상태를 조회하지 못했습니다.");
      }
    } finally {
      if (!abort.signal.aborted && generation.current === requestGeneration) setLoading(false);
    }
  };

  const sessionCurrent = stateSession === authenticatedFetch;
  const visibleAccounts = sessionCurrent ? accounts : [];
  const visibleCredentialId = sessionCurrent ? credentialId : "";
  const visibleStatus = sessionCurrent ? status : null;
  const visibleLoading = sessionCurrent ? loading : false;
  const visibleError = sessionCurrent ? error : "";

  return <details className={`panel ${styles.panel}`} onToggle={(event) => {
    const nextExpanded = event.currentTarget.open;
    setExpanded(nextExpanded);
    if (nextExpanded) return;
    generation.current += 1; controller.current?.abort(); controller.current = null;
    setAccounts([]); setCredentialId(""); setStatus(null); setError(""); setLoading(false);
  }}>
    <summary>Qoo10 review·Buyer Chat 증거 상태</summary>
    <p>지원되는 일반 문의·클레임 이력과 QSM review export·Buyer Chat을 서로 다른 기능으로 확인합니다.</p>
    <label className={styles.accountSelector}>
      <span>연결 계정</span>
      <select value={visibleCredentialId} disabled={visibleLoading || !visibleAccounts.length} onChange={(event) => {
        generation.current += 1;
        controller.current?.abort();
        setCredentialId(event.currentTarget.value); setStatus(null); setError(""); setLoading(false);
      }}>
        {visibleAccounts.length
          ? visibleAccounts.map((account) => <option key={account.credentialId} value={account.credentialId}>
            {account.label} · {account.environment} · {account.credentialState}
          </option>)
          : <option value="">Qoo10 운영 계정 없음</option>}
      </select>
    </label>
    <button type="button" className="filter-button" disabled={visibleLoading || !visibleCredentialId}
      onClick={() => void loadStatus()}>{visibleLoading ? "조회 중…" : "review·Buyer Chat 증거 조회"}</button>
    {visibleError ? <p role="alert">{visibleError}</p> : null}
    {visibleStatus ? <Qoo10ReviewChatStatusSummary status={visibleStatus} /> : null}
  </details>;
}
