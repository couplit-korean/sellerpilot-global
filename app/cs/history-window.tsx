"use client";

import { useEffect, useRef, useState } from "react";

type SmartstoreResumePayload = {
  message?: string;
  acceptedNotCompleted?: boolean;
  historyBackfill?: unknown;
  checkpointBeforeEnqueue?: { nextWindow?: { fromDate?: string; throughDate?: string } | null };
};
type SmartstoreAccount = { credentialId: string; label: string };
type SmartstoreAccountPayload = {
  contract?: string;
  accounts?: SmartstoreAccount[];
  message?: string;
};

export function CsHistoryWindow({ authenticatedFetch, onBackfill, disabled }: {
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onBackfill: (channel: "coupang" | "elevenst", endDate?: string) => Promise<void>;
  disabled: boolean;
}) {
  const [today] = useState(() => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(today);
  const [floorDate, setFloorDate] = useState("2022-11-30");
  const [smartstoreBusy, setSmartstoreBusy] = useState(false);
  const [smartstoreMessage, setSmartstoreMessage] = useState<string | null>(null);
  const [smartstoreAccounts, setSmartstoreAccounts] = useState<SmartstoreAccount[]>([]);
  const [smartstoreCredentialId, setSmartstoreCredentialId] = useState("");
  const [smartstoreAccountsLoading, setSmartstoreAccountsLoading] = useState(true);
  const accountLoadAbort = useRef<AbortController | null>(null);
  const resumeAbort = useRef<AbortController | null>(null);
  const resumeGeneration = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    accountLoadAbort.current = controller;
    void (async () => {
      try {
        const response = await authenticatedFetch(
          "/api/admin/cs/channels/smartstore/history-resume-v5?accounts=1",
          { signal: controller.signal },
        );
        const payload = await response.json().catch(() => null) as SmartstoreAccountPayload | null;
        if (!response.ok) throw new Error(payload?.message ?? "스마트스토어 계정 목록을 읽지 못했습니다.");
        const accounts = payload?.contract === "sellerpilot-smartstore-history-account-list/1"
          && Array.isArray(payload.accounts)
          ? payload.accounts.filter(account => account
              && typeof account.credentialId === "string"
              && typeof account.label === "string")
          : [];
        if (controller.signal.aborted) return;
        setSmartstoreAccounts(accounts);
        setSmartstoreCredentialId(current => accounts.some(account => account.credentialId === current)
          ? current
          : accounts[0]?.credentialId ?? "");
        setSmartstoreMessage(accounts.length ? null : "활성 스마트스토어 운영 계정이 없습니다.");
      } catch (error) {
        if (controller.signal.aborted) return;
        setSmartstoreMessage(error instanceof Error ? error.message : "스마트스토어 계정 목록을 읽지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setSmartstoreAccountsLoading(false);
      }
    })();
    return () => {
      controller.abort();
      resumeGeneration.current += 1;
      resumeAbort.current?.abort();
    };
  }, [authenticatedFetch]);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    && endDate >= "2000-01-30" && endDate <= today
    && Number.isFinite(Date.parse(`${endDate}T00:00:00Z`))
    && new Date(`${endDate}T00:00:00Z`).toISOString().slice(0, 10) === endDate;
  const startDate = valid ? new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10) : "";
  const smartstoreValid = valid && /^\d{4}-\d{2}-\d{2}$/.test(floorDate) && floorDate >= "2000-01-01" && floorDate <= endDate
    && Number.isFinite(Date.parse(`${floorDate}T00:00:00Z`))
    && new Date(`${floorDate}T00:00:00Z`).toISOString().slice(0, 10) === floorDate;
  const resumeSmartstore = async () => {
    if (!smartstoreValid || !smartstoreCredentialId || smartstoreBusy) return;
    resumeAbort.current?.abort();
    const controller = new AbortController();
    resumeAbort.current = controller;
    const generation = resumeGeneration.current + 1;
    resumeGeneration.current = generation;
    setSmartstoreBusy(true);
    setSmartstoreMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/cs/channels/smartstore/history-resume-v5", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ floorDate, throughDate: endDate, credentialId: smartstoreCredentialId }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as SmartstoreResumePayload | null;
      if (controller.signal.aborted || generation !== resumeGeneration.current) return;
      if (!response.ok) throw new Error(payload?.message ?? "스마트스토어 이력 작업을 접수하지 못했습니다.");
      if (response.status === 202 && payload?.acceptedNotCompleted === true) {
        const window = payload.checkpointBeforeEnqueue?.nextWindow;
        const range = window?.fromDate && window.throughDate ? `${window.fromDate}~${window.throughDate} ` : "";
        setSmartstoreMessage(`${range}읽기 작업이 접수됐습니다. 접수는 완료가 아니며 다음 조회에서 상태를 확인합니다.`);
      } else if (payload?.historyBackfill === null) {
        setSmartstoreMessage("선택 종료일까지 상품문의·고객문의 이력 대조가 모두 완료됐습니다.");
      } else {
        setSmartstoreMessage("스마트스토어 이력 체크포인트를 확인했습니다.");
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== resumeGeneration.current) return;
      setSmartstoreMessage(error instanceof Error ? error.message : "스마트스토어 이력 작업을 접수하지 못했습니다.");
    } finally {
      if (!controller.signal.aborted && generation === resumeGeneration.current) {
        setSmartstoreBusy(false);
      }
    }
  };
  return <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} disabled={disabled}>
    <legend className="sr-only">이전 기간의 문의 가져오기</legend>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label>스마트스토어 시작일 <input type="date" min="2000-01-01" max={endDate} value={floorDate} disabled={smartstoreBusy} onChange={event => setFloorDate(event.target.value)} /></label>
      <label>스마트스토어 계정 <select aria-label="스마트스토어 계정" value={smartstoreCredentialId}
        disabled={smartstoreBusy || smartstoreAccountsLoading || !smartstoreAccounts.length}
        onChange={event => {
          resumeGeneration.current += 1;
          resumeAbort.current?.abort();
          setSmartstoreBusy(false);
          setSmartstoreMessage(null);
          setSmartstoreCredentialId(event.target.value);
        }}>
        {smartstoreAccountsLoading ? <option value="">계정 확인 중</option> : null}
        {!smartstoreAccountsLoading && !smartstoreAccounts.length ? <option value="">활성 계정 없음</option> : null}
        {smartstoreAccounts.map(account => <option key={account.credentialId} value={account.credentialId}>{account.label}</option>)}
      </select></label>
      <label>이력 종료일 <input disabled={smartstoreBusy} aria-label="과거 문의 종료일" type="date" min="2000-01-30" max={today} value={endDate} onChange={(event) => setEndDate(event.target.value)} onInput={(event) => setEndDate(event.currentTarget.value)} /></label>
      <button className="filter-button" type="button" disabled={!smartstoreValid || !smartstoreCredentialId || smartstoreBusy || smartstoreAccountsLoading} onClick={() => void resumeSmartstore()}>{smartstoreBusy ? "스마트스토어 접수 중" : "스마트스토어 다음 구간"}</button>
      <button className="filter-button" type="button" disabled={!valid} onClick={() => void onBackfill("coupang", endDate)}>쿠팡 30일</button>
      <button className="filter-button" type="button" disabled={!valid} onClick={() => void onBackfill("elevenst", endDate)}>11번가 Q&A 30일</button>
    </div>
    <small>{valid ? `${startDate}~${endDate} · 채널에서 조회 가능한 이력만 가져옵니다.` : "종료일을 선택해 주세요."}</small>
    {smartstoreMessage ? <small role="status" aria-live="polite">{smartstoreMessage}</small> : null}
  </fieldset>;
}
