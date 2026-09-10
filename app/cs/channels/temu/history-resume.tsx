"use client";

import { useRef, useState } from "react";
import {
  temuHistoryAccountStateSchema,
  temuHistoryAccountsSchema,
  temuHistoryCheckpointSchema,
  type TemuHistoryAccountState,
  type TemuHistoryAccounts,
  type TemuHistoryCheckpoint,
} from "../../../../lib/cs/channels/temu/history-resume";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const statusLabel: Record<TemuHistoryCheckpoint["status"], string> = {
  idle: "아직 시작하지 않음",
  running: "읽기 작업 처리 중",
  failed: "실패 지점에서 명시적 재개 필요",
  complete: "선택 범위의 읽기 페이지 완료",
  retry_exhausted: "재시도 상한 도달 · 수동 확인 필요",
};

export function TemuHistoryResume({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [accounts, setAccounts] = useState<TemuHistoryAccounts["accounts"] | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [checkpoint, setCheckpoint] = useState<TemuHistoryCheckpoint | null>(null);
  const [accountState, setAccountState] = useState<TemuHistoryAccountState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef("");

  const resetSelectedState = () => {
    setCheckpoint(null); setAccountState(null); setError(""); requestKey.current = "";
  };

  const loadAccounts = async () => {
    setBusy(true); setError("");
    try {
      const response = await authenticatedFetch(
        "/api/admin/cs/channels/temu/history-resume?view=accounts",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("accounts unavailable");
      const next = temuHistoryAccountsSchema.parse(await response.json()).accounts;
      setAccounts(next);
      setCredentialId(next.length === 1 ? next[0]!.credentialId : "");
      setCheckpoint(null); setAccountState(null); requestKey.current = "";
    } catch {
      setAccounts(null); setCredentialId("");
      setError("Temu 운영 계정 목록을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const load = async () => {
    if (!credentialId) {
      setError("조회할 Temu 계정을 선택해 주세요.");
      return;
    }
    if (!fromDate || !toDate) {
      setError("조회 시작일과 종료일을 선택해 주세요.");
      return;
    }
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({
        view: "checkpoint", credentialId, fromDate, toDate,
      });
      if (checkpoint?.runId) query.set("runId", checkpoint.runId);
      const response = await authenticatedFetch(`/api/admin/cs/channels/temu/history-resume?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("checkpoint unavailable");
      const next = temuHistoryCheckpointSchema.parse(await response.json());
      if (next.credentialId !== credentialId) throw new Error("account mismatch");
      setCheckpoint(next);
    } catch {
      setError("선택한 Temu 계정의 과거조회 체크포인트를 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const loadAccountState = async () => {
    if (!credentialId) {
      setError("상태를 조회할 Temu 계정을 선택해 주세요.");
      return;
    }
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ view: "metadata", credentialId });
      const response = await authenticatedFetch(`/api/admin/cs/channels/temu/history-resume?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("metadata unavailable");
      const next = temuHistoryAccountStateSchema.parse(await response.json());
      if (next.account.credentialId !== credentialId
          || next.coverage.credentialId !== credentialId
          || next.retry.credentialId !== credentialId) throw new Error("account mismatch");
      setAccountState(next);
    } catch {
      setAccountState(null);
      setError("선택한 Temu 계정의 수집·재시도 상태를 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const startOrResume = async () => {
    if (!credentialId) {
      setError("실행할 Temu 계정을 선택해 주세요.");
      return;
    }
    if (!fromDate || !toDate) {
      setError("조회 시작일과 종료일을 선택해 주세요.");
      return;
    }
    setBusy(true); setError("");
    try {
      const resumable = checkpoint?.runId && checkpoint.activeCursor
        && checkpoint.status === "failed" && checkpoint.canResume;
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      const historyRequest = resumable ? {
        action: "resume",
        runId: checkpoint.runId,
        expectedCursor: checkpoint.activeCursor,
        expectedRetryCount: checkpoint.retryCount,
      } : {
        action: "start",
        requestKey: requestKey.current,
        fromDate,
        toDate,
      };
      const response = await authenticatedFetch("/api/admin/cs/channels/temu/history-resume", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId, request: historyRequest }),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error("resume unavailable");
      const parsed = temuHistoryCheckpointSchema.parse(
        raw && typeof raw === "object" && "checkpoint" in raw ? raw.checkpoint : null,
      );
      if (parsed.credentialId !== credentialId) throw new Error("account mismatch");
      requestKey.current = "";
      setCheckpoint(parsed);
    } catch {
      setError("선택한 Temu 계정의 과거조회 접수 또는 재개 상태를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const retryBlocked = checkpoint?.status === "running"
    || checkpoint?.status === "complete"
    || checkpoint?.status === "retry_exhausted";

  return <details className="panel">
    <summary>Temu 반품·환불 이력 체크포인트</summary>
    <p>선택한 운영 계정과 KST 날짜·상태별 읽기 cursor만 조회·재개합니다. 완료된 페이지는 보존하며 답변·환불 변경은 실행하지 않습니다.</p>
    <div className="cs-history-filter-grid">
      <button type="button" className="filter-button" disabled={busy} onClick={() => void loadAccounts()}>
        {busy ? "확인 중…" : "Temu 계정 불러오기"}
      </button>
      {accounts ? <label>Temu 운영 계정<select value={credentialId} disabled={busy} onChange={event => {
        resetSelectedState(); setCredentialId(event.target.value);
      }}>
        <option value="">계정 선택</option>
        {accounts.map(account => <option key={account.credentialId} value={account.credentialId}>
          {account.label}
        </option>)}
      </select></label> : null}
      <label>시작일<input type="date" value={fromDate} disabled={busy} onChange={event => {
        setFromDate(event.target.value); setCheckpoint(null); requestKey.current = "";
      }} /></label>
      <label>종료일<input type="date" value={toDate} disabled={busy} onChange={event => {
        setToDate(event.target.value); setCheckpoint(null); requestKey.current = "";
      }} /></label>
      <button type="button" className="filter-button" disabled={busy || !credentialId} onClick={() => void loadAccountState()}>
        계정 수집·재시도 상태
      </button>
      <button type="button" className="filter-button" disabled={busy || !credentialId} onClick={() => void load()}>
        체크포인트 조회
      </button>
      <button type="button" className="filter-button" disabled={busy || !credentialId || Boolean(retryBlocked)} onClick={() => void startOrResume()}>
        {checkpoint?.status === "failed" ? "실패 cursor 재개" : "읽기 범위 시작"}
      </button>
    </div>
    {accounts?.length === 0 ? <p>활성·provider-certified Temu 운영 계정이 없습니다.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {accountState ? <section role="status" aria-live="polite">
      <b>{accountState.account.label} 결속 상태</b>
      <p>수집 범위 {accountState.coverage.coverage.scans.length.toLocaleString("ko-KR")}건 · 미해결 중단 {accountState.coverage.coverage.gaps.filter(gap => !gap.resolvedAt).length.toLocaleString("ko-KR")}건 · 상세 재시도 {accountState.retry.retries.length.toLocaleString("ko-KR")}건</p>
      <p>정확한 seller 결속 {accountState.coverage.bindingSummary.exactSellerRows.toLocaleString("ko-KR")}건 · legacy credential/owner 결속 {accountState.coverage.bindingSummary.legacyCredentialRows.toLocaleString("ko-KR")}건</p>
    </section> : null}
    {checkpoint ? <section role="status" aria-live="polite">
      <b>{statusLabel[checkpoint.status]}</b>
      <p>{checkpoint.fromDate}~{checkpoint.toDate} · 완료 페이지 {checkpoint.completedPageCount.toLocaleString("ko-KR")}개 · 재시도 {checkpoint.retryCount}/{checkpoint.retryCap}</p>
      <p>{checkpoint.activeCursor
        ? `현재 cursor ${checkpoint.activeCursor.date} · 상태 ${checkpoint.activeCursor.statusGroup} · ${checkpoint.activeCursor.pageNo}페이지`
        : "현재 cursor 없음"}</p>
      <p>공급자 보존기간 하한: 미확인 · 이 화면은 선택 범위의 지원 가능 여부를 보장하지 않습니다.</p>
      {checkpoint.status === "running" ? <p>접수됐지만 완료되지 않았습니다. 체크포인트를 다시 조회해 상태를 확인하세요.</p> : null}
      {checkpoint.status === "retry_exhausted" ? <p>자동·반복 재개를 중단했습니다. 선택 계정과 원격 조회 상태를 확인하세요.</p> : null}
    </section> : null}
  </details>;
}
