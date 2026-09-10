"use client";

import { useEffect, useRef, useState } from "react";
import {
  temuBuyerChatSourceStatusSchema,
  type TemuBuyerChatSourceStatus,
} from "../../../../lib/channels/cs/temu/buyer-chat-source-contract";
import {
  temuHistoryAccountsSchema,
  type TemuHistoryAccounts,
} from "../../../../lib/cs/channels/temu/history-resume";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const blockerLabels: Record<string, string> = {
  TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE: "provider 인증 권한 증거 없음",
  TEMU_APP_INACTIVE: "Partner 앱 활성화 대기",
  TEMU_COMPLIANCE_NOT_APPROVED: "Compliance 승인 대기",
  TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED: "Security questionnaire 승인 대기",
  TEMU_SELLER_AUTHORIZATION_NOT_APPROVED: "판매자 승인 대기",
  TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED: "공식 Buyer Chat 계약 확인 대기",
  TEMU_BUYER_CHAT_CONTRACT_UNKNOWN: "검토되지 않은 계약 revision",
  TEMU_BUYER_CHAT_PERMISSION_MISSING: "Buyer Chat permission package 미승인",
  TEMU_BUYER_CHAT_VERIFIED_SOURCE_RECEIPT_REQUIRED: "검증된 provider source receipt 없음",
  TEMU_BUYER_CHAT_OFFICIAL_API_CONTRACT_UNAVAILABLE: "공식 source payload 계약 미제공",
  TEMU_BUYER_CHAT_SOURCE_UNSUPPORTED: "현재 provider source 미지원",
};

export function TemuBuyerChatSourceStatusPanel({
  authenticatedFetch,
}: {
  authenticatedFetch: AuthenticatedFetch;
}) {
  const [accountsState, setAccountsState] = useState<{
    fetcher: AuthenticatedFetch;
    value: TemuHistoryAccounts["accounts"];
  } | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [statusState, setStatusState] = useState<{
    fetcher: AuthenticatedFetch;
    value: TemuBuyerChatSourceStatus;
  } | null>(null);
  const [busyState, setBusyState] = useState<{
    fetcher: AuthenticatedFetch;
    generation: number;
    busy: boolean;
    error: string;
  } | null>(null);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const begin = () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    return { controller, generation: ++generation.current };
  };
  const current = (requestGeneration: number, controller: AbortController) =>
    generation.current === requestGeneration && !controller.signal.aborted;

  useEffect(() => () => {
    generation.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, [authenticatedFetch]);

  const finish = (requestGeneration: number, controller: AbortController) => {
    if (!current(requestGeneration, controller)) return;
    activeRequest.current = null;
    setBusyState(value => value?.fetcher === authenticatedFetch
      && value.generation === requestGeneration ? { ...value, busy: false } : value);
  };

  const loadAccounts = async () => {
    const request = begin();
    setBusyState({ fetcher: authenticatedFetch, generation: request.generation, busy: true, error: "" });
    setStatusState(null);
    try {
      const response = await authenticatedFetch(
        "/api/admin/cs/channels/temu/history-resume?view=accounts",
        { method: "GET", cache: "no-store", signal: request.controller.signal },
      );
      if (!response.ok) throw new Error("accounts unavailable");
      const accounts = temuHistoryAccountsSchema.parse(await response.json()).accounts;
      if (!current(request.generation, request.controller)) return;
      setAccountsState({ fetcher: authenticatedFetch, value: accounts });
      setCredentialId(accounts.length === 1 ? accounts[0]!.credentialId : "");
    } catch {
      if (!current(request.generation, request.controller)) return;
      setAccountsState(null);
      setCredentialId("");
      setBusyState({ fetcher: authenticatedFetch, generation: request.generation,
        busy: false, error: "Temu 운영 계정 목록을 읽지 못했습니다." });
    } finally {
      finish(request.generation, request.controller);
    }
  };

  const loadSourceStatus = async () => {
    if (!credentialId || accountsState?.fetcher !== authenticatedFetch) {
      setBusyState({ fetcher: authenticatedFetch, generation: generation.current,
        busy: false, error: "현재 로그인 세션에서 Temu 운영 계정을 선택해 주세요." });
      return;
    }
    const selectedCredentialId = credentialId;
    const request = begin();
    setBusyState({ fetcher: authenticatedFetch, generation: request.generation, busy: true, error: "" });
    setStatusState(null);
    try {
      const query = new URLSearchParams({ credentialId: selectedCredentialId });
      const response = await authenticatedFetch(
        `/api/admin/cs/channels/temu/buyer-chat-source-status?${query}`,
        { method: "GET", cache: "no-store", signal: request.controller.signal },
      );
      if (!response.ok) throw new Error("source status unavailable");
      const status = temuBuyerChatSourceStatusSchema.parse(await response.json());
      if (status.credentialId !== selectedCredentialId
          || status.providerFetchPerformed !== false
          || status.canonicalPromotionPerformed !== false) {
        throw new Error("source status binding mismatch");
      }
      if (!current(request.generation, request.controller)) return;
      setStatusState({ fetcher: authenticatedFetch, value: status });
    } catch {
      if (!current(request.generation, request.controller)) return;
      setBusyState({ fetcher: authenticatedFetch, generation: request.generation,
        busy: false, error: "Buyer Chat source 경계를 확인하지 못했습니다. provider 호출과 canonical 저장은 실행되지 않았습니다." });
    } finally {
      finish(request.generation, request.controller);
    }
  };

  const accounts = accountsState?.fetcher === authenticatedFetch ? accountsState.value : null;
  const status = statusState?.fetcher === authenticatedFetch ? statusState.value : null;
  const request = busyState?.fetcher === authenticatedFetch ? busyState : null;
  const busy = request?.busy ?? false;

  return <details className="panel">
    <summary>Temu Buyer Chat source adapter</summary>
    <p>로컬 adapter는 구현돼 있지만 공식 source 계약과 검증 receipt가 없으므로 provider 원문을 문의로 승격하지 않습니다.</p>
    <div className="cs-history-filter-grid">
      <button type="button" className="filter-button" disabled={busy} onClick={() => void loadAccounts()}>
        {busy ? "확인 중…" : "Temu 계정 불러오기"}
      </button>
      {accounts ? <label>Temu 운영 계정<select value={credentialId} disabled={busy} onChange={event => {
        activeRequest.current?.abort(); activeRequest.current = null; generation.current += 1;
        setCredentialId(event.target.value); setStatusState(null);
      }}>
        <option value="">계정 선택</option>
        {accounts.map(account => <option key={account.credentialId} value={account.credentialId}>
          {account.label}
        </option>)}
      </select></label> : null}
      <button type="button" className="filter-button" disabled={busy || !credentialId || !accounts}
        onClick={() => void loadSourceStatus()}>source adapter 상태 확인</button>
    </div>
    {request?.error ? <p role="alert">{request.error}</p> : null}
    {status ? <section role="status" aria-live="polite">
      <b>로컬 fail-closed adapter 구현 완료 · provider source 미지원</b>
      <p>provider fetch: 실행 안 함 · raw 수락: 차단 · canonical 문의 승격: 차단</p>
      <p>수신 차단 · 이력 차단 · 답변 차단 · 원격 재조회 차단</p>
      <ul>{status.sourceBlockers.map(code => <li key={code}>{blockerLabels[code] ?? code}</li>)}</ul>
    </section> : null}
  </details>;
}
