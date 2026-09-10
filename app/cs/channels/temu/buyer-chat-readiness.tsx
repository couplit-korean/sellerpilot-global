"use client";

import { useEffect, useRef, useState } from "react";
import { temuBuyerChatReadinessViewSchema, type TemuBuyerChatReadinessView } from "../../../../lib/channels/cs/temu/runtime-readiness";
import { temuHistoryAccountsSchema, type TemuHistoryAccounts } from "../../../../lib/cs/channels/temu/history-resume";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const blockerLabels: Record<string, string> = {
  TEMU_BUYER_CHAT_RUNTIME_CONTEXT_UNVERIFIED: "서버 실행 문맥 확인 대기",
  TEMU_BUYER_CHAT_RUNTIME_CONTEXT_INVALID: "서버 실행 문맥 불일치",
  TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE: "현재 서버 권한 증거 없음",
  TEMU_BUYER_CHAT_EVIDENCE_INVALID: "서버 권한 증거 형식 불일치",
  TEMU_BUYER_CHAT_CREDENTIAL_MISMATCH: "선택 credential 불일치",
  TEMU_BUYER_CHAT_SELLER_ACCOUNT_MISMATCH: "판매자 계정 결속 불일치",
  TEMU_BUYER_CHAT_ENVIRONMENT_MISMATCH: "운영 환경 불일치",
  TEMU_BUYER_CHAT_EVIDENCE_TIME_INVALID: "증거 유효기간 계약 불일치",
  TEMU_BUYER_CHAT_EVIDENCE_EXPIRED: "권한 증거 만료",
  TEMU_APP_REGION_MISMATCH: "Partner 앱 region 불일치",
  TEMU_APP_INACTIVE: "Partner 앱 활성화 대기",
  TEMU_COMPLIANCE_NOT_APPROVED: "Compliance 승인 대기",
  TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED: "Security questionnaire 승인 대기",
  TEMU_SELLER_AUTHORIZATION_NOT_APPROVED: "판매자 Buyer Chat 승인 대기",
  TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED: "공식 Buyer Chat 계약 확인 대기",
  TEMU_BUYER_CHAT_CONTRACT_UNKNOWN: "검토되지 않은 계약 revision",
  TEMU_BUYER_CHAT_CONTRACT_REVISION_MISMATCH: "공식 계약 revision 불일치",
  TEMU_BUYER_CHAT_PERMISSION_MISSING: "정확한 Buyer Chat permission package 미승인",
};

export function TemuBuyerChatReadiness({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [accountsState, setAccountsState] = useState<{
    fetcher: AuthenticatedFetch;
    value: TemuHistoryAccounts["accounts"];
  } | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [readinessState, setReadinessState] = useState<{
    fetcher: AuthenticatedFetch;
    value: TemuBuyerChatReadinessView;
  } | null>(null);
  const [requestState, setRequestState] = useState<{
    fetcher: AuthenticatedFetch;
    generation: number;
    busy: boolean;
    error: string;
  } | null>(null);
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const beginRequest = () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const generation = ++requestGeneration.current;
    return { controller, generation };
  };
  const isCurrentRequest = (generation: number, controller: AbortController) =>
    requestGeneration.current === generation && !controller.signal.aborted;

  useEffect(() => {
    return () => {
      requestGeneration.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [authenticatedFetch]);

  const loadAccounts = async () => {
    const { controller, generation } = beginRequest();
    setRequestState({ fetcher: authenticatedFetch, generation, busy: true, error: "" });
    setReadinessState(null);
    try {
      const response = await authenticatedFetch(
        "/api/admin/cs/channels/temu/history-resume?view=accounts",
        { method: "GET", cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error("accounts unavailable");
      const next = temuHistoryAccountsSchema.parse(await response.json()).accounts;
      if (!isCurrentRequest(generation, controller)) return;
      setAccountsState({ fetcher: authenticatedFetch, value: next });
      setCredentialId(next.length === 1 ? next[0]!.credentialId : "");
    } catch {
      if (!isCurrentRequest(generation, controller)) return;
      setAccountsState(null); setCredentialId("");
      setRequestState({
        fetcher: authenticatedFetch,
        generation,
        busy: false,
        error: "Temu 운영 계정 목록을 읽지 못했습니다.",
      });
    } finally {
      if (isCurrentRequest(generation, controller)) {
        activeRequest.current = null;
        setRequestState(current => current?.fetcher === authenticatedFetch
          && current.generation === generation
          ? { ...current, busy: false }
          : current);
      }
    }
  };

  const loadReadiness = async () => {
    if (!credentialId) {
      setRequestState({ fetcher: authenticatedFetch, generation: requestGeneration.current,
        busy: false, error: "확인할 Temu 운영 계정을 선택해 주세요." });
      return;
    }
    if (accountsState?.fetcher !== authenticatedFetch) {
      setRequestState({ fetcher: authenticatedFetch, generation: requestGeneration.current,
        busy: false, error: "현재 로그인 세션에서 Temu 운영 계정을 다시 불러와 주세요." });
      return;
    }
    const selectedCredentialId = credentialId;
    const { controller, generation } = beginRequest();
    setRequestState({ fetcher: authenticatedFetch, generation, busy: true, error: "" });
    setReadinessState(null);
    try {
      const query = new URLSearchParams({ credentialId: selectedCredentialId });
      const response = await authenticatedFetch(
        `/api/admin/cs/channels/temu/buyer-chat-readiness?${query}`,
        { method: "GET", cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error("readiness unavailable");
      const next = temuBuyerChatReadinessViewSchema.parse(await response.json());
      if (next.credentialId !== selectedCredentialId || next.providerFetchPerformed !== false) {
        throw new Error("readiness account mismatch");
      }
      if (!isCurrentRequest(generation, controller)) return;
      setReadinessState({ fetcher: authenticatedFetch, value: next });
    } catch {
      if (!isCurrentRequest(generation, controller)) return;
      setRequestState({
        fetcher: authenticatedFetch,
        generation,
        busy: false,
        error: "Temu Buyer Chat 권한 경계를 확인하지 못했습니다. 원격 호출은 실행되지 않았습니다.",
      });
    } finally {
      if (isCurrentRequest(generation, controller)) {
        activeRequest.current = null;
        setRequestState(current => current?.fetcher === authenticatedFetch
          && current.generation === generation
          ? { ...current, busy: false }
          : current);
      }
    }
  };

  const visibleAccounts = accountsState?.fetcher === authenticatedFetch ? accountsState.value : null;
  const visibleReadiness = readinessState?.fetcher === authenticatedFetch ? readinessState.value : null;
  const visibleRequest = requestState?.fetcher === authenticatedFetch ? requestState : null;
  const busy = visibleRequest?.busy ?? false;
  const error = visibleRequest?.error ?? "";

  return <details className="panel">
    <summary>Temu Buyer Chat 권한 경계</summary>
    <p>서버 원장의 현재 앱·계정·region·계약 revision만 확인합니다. 이 화면은 provider 조회나 답변 전송을 실행하지 않습니다.</p>
    <div className="cs-history-filter-grid">
      <button type="button" className="filter-button" disabled={busy} onClick={() => void loadAccounts()}>
        {busy ? "확인 중…" : "Temu 계정 불러오기"}
      </button>
      {visibleAccounts ? <label>Temu 운영 계정<select value={credentialId} disabled={busy} onChange={event => {
        activeRequest.current?.abort(); activeRequest.current = null; requestGeneration.current += 1;
        setCredentialId(event.target.value); setReadinessState(null);
        setRequestState({ fetcher: authenticatedFetch, generation: requestGeneration.current,
          busy: false, error: "" });
      }}>
        <option value="">계정 선택</option>
        {visibleAccounts.map(account => <option key={account.credentialId} value={account.credentialId}>
          {account.label}
        </option>)}
      </select></label> : null}
      <button type="button" className="filter-button" disabled={busy || !credentialId || !visibleAccounts} onClick={() => void loadReadiness()}>
        Buyer Chat 권한 경계 확인
      </button>
    </div>
    {visibleAccounts?.length === 0 ? <p>활성·provider-certified Temu 운영 계정이 없습니다.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {visibleReadiness ? <section role="status" aria-live="polite">
      <b>{visibleReadiness.ready ? "서버 권한 경계 통과" : "Buyer Chat permission_pending"}</b>
      <p>수신 {visibleReadiness.receive ? "허용" : "차단"} · 이력 {visibleReadiness.history ? "허용" : "차단"} · 답변 {visibleReadiness.reply ? "허용" : "차단"} · 원격 재조회 {visibleReadiness.readback ? "허용" : "차단"}</p>
      <ul>{visibleReadiness.blockers.map(blocker => <li key={blocker}>{blockerLabels[blocker] ?? blocker}</li>)}</ul>
      <p>provider fetch: 실행 안 함 · 등록된 API 키나 임의 계약 문자열로 권한을 추정하지 않습니다.</p>
    </section> : null}
  </details>;
}
