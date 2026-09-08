"use client";

import { useEffect, useRef, useState } from "react";
import { readEbayCaseDisputeUiResponse, type EbayCaseDisputeAccounts, type EbayCaseDisputeAuthenticatedFetch } from "../../../../lib/cs/channels/ebay/cases-disputes";
import {
  readEbayCaseDisputeHistoryUiResponse,
  syncEbayCaseDisputeHistoryUiResponse,
  type EbayCaseDisputeHistoryPage,
  type EbayCaseDisputeHistoryResourceKind,
  type EbayCaseDisputeHistorySyncResponse,
} from "../../../../lib/cs/channels/ebay/case-dispute-history";
import styles from "./cases-disputes.module.css";

const date = (value: string | null) => value
  ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
  : "없음";

export function EbayCaseDisputeHistory({ authenticatedFetch }: { authenticatedFetch: EbayCaseDisputeAuthenticatedFetch }) {
  const [accounts, setAccounts] = useState<EbayCaseDisputeAccounts | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [resourceKind, setResourceKind] = useState<EbayCaseDisputeHistoryResourceKind>("resolution_case");
  const [page, setPage] = useState<EbayCaseDisputeHistoryPage | null>(null);
  const [syncReceipt, setSyncReceipt] = useState<EbayCaseDisputeHistorySyncResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  function resetPage() {
    controller.current?.abort();
    generation.current += 1;
    setPage(null);
    setSyncReceipt(null);
    setError("");
    setLoading(false);
  }

  async function loadAccounts() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const run = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await readEbayCaseDisputeUiResponse({ authenticatedFetch, view: "accounts", signal: abort.signal });
      if (abort.signal.aborted || run !== generation.current) return;
      if (!("accounts" in result)) throw new Error("eBay 계정 응답 형식을 확인하지 못했습니다.");
      setAccounts(result.accounts);
      setCredentialId(result.accounts.length === 1 ? result.accounts[0].id : "");
      setPage(null);
    } catch (caught) {
      if (!abort.signal.aborted && run === generation.current) {
        setError(caught instanceof Error ? caught.message : "eBay 계정을 불러오지 못했습니다.");
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }

  async function readHistory(cursor?: { observedAt: string; id: string }) {
    if (!credentialId) { setError("조회할 eBay 계정을 선택해 주세요."); return; }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const run = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await readEbayCaseDisputeHistoryUiResponse({
        authenticatedFetch,
        credentialId,
        resourceKind,
        ...(cursor ? { beforeObservedAt: cursor.observedAt, beforeId: cursor.id } : {}),
        signal: abort.signal,
      });
      if (abort.signal.aborted || run !== generation.current) return;
      if (result.credentialId !== credentialId || result.resourceKind !== resourceKind) {
        throw new Error("eBay 이력 계정·종류가 일치하지 않습니다.");
      }
      setPage(result);
    } catch (caught) {
      if (!abort.signal.aborted && run === generation.current) {
        setError(caught instanceof Error && caught.name !== "ZodError"
          ? caught.message : "eBay 케이스·분쟁 이력 응답을 확인하지 못했습니다.");
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }

  async function syncHistory() {
    if (!credentialId) { setError("수집할 eBay 계정을 선택해 주세요."); return; }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const run = ++generation.current;
    setLoading(true);
    setError("");
    setSyncReceipt(null);
    try {
      const now = Date.now();
      const receipt = await syncEbayCaseDisputeHistoryUiResponse({
        authenticatedFetch,
        credentialId,
        resourceKind,
        ...(resourceKind === "resolution_case" ? {
          startTime: new Date(now - 30 * 86_400_000).toISOString(),
          endTime: new Date(now).toISOString(),
        } : {}),
        signal: abort.signal,
      });
      if (abort.signal.aborted || run !== generation.current) return;
      setSyncReceipt(receipt);
      if (receipt.availability === "readable") {
        const history = await readEbayCaseDisputeHistoryUiResponse({
          authenticatedFetch, credentialId, resourceKind, signal: abort.signal,
        });
        if (abort.signal.aborted || run !== generation.current) return;
        setPage(history);
      }
    } catch (caught) {
      if (!abort.signal.aborted && run === generation.current) {
        setError(caught instanceof Error && caught.name !== "ZodError"
          ? caught.message : "eBay 케이스·분쟁 이력 수집 응답을 확인하지 못했습니다.");
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }

  return <details className={`panel ${styles.viewer}`}>
    <summary>eBay 케이스·결제분쟁 · 저장 이력</summary>
    <p className={styles.notice}>eBay에서 가져온 케이스와 결제분쟁의 상태 변경을 확인합니다.</p>
    <div className={styles.filters}>
      <button type="button" className="filter-button" disabled={loading} onClick={() => void loadAccounts()}>연결 계정 불러오기</button>
      {accounts ? <>
        <label>eBay 계정<select value={credentialId} disabled={loading} onChange={event => { resetPage(); setCredentialId(event.target.value); }}>
          <option value="">계정 선택</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.label} · {account.environment === "production" ? "운영" : "테스트"}</option>)}
        </select></label>
        <label>이력 종류<select value={resourceKind} disabled={loading} onChange={event => { resetPage(); setResourceKind(event.target.value as EbayCaseDisputeHistoryResourceKind); }}>
          <option value="resolution_case">eBay MBG 케이스</option>
          <option value="payment_dispute">결제분쟁</option>
        </select></label>
        <button type="button" className="filter-button" disabled={loading || !credentialId} onClick={() => void readHistory()}>최근 이력</button>
        <button type="button" className="filter-button" disabled={loading || !credentialId} onClick={() => void syncHistory()}>최신 내역 가져와 저장</button>
      </> : null}
    </div>
    {accounts?.length === 0 ? <p>운영 공간에 연결된 활성 eBay 키가 없습니다.</p> : null}
    {loading ? <p role="status">eBay 케이스·분쟁 이력을 조회하고 있습니다…</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {syncReceipt ? <p role="status">수집 상태 {syncReceipt.availability} · {syncReceipt.total === null ? "전체 건수 미확인" : `전체 ${syncReceipt.total}개`} · {syncReceipt.observedCount === null ? "저장 안 함" : `관측 ${syncReceipt.observedCount}개·신규 이력 ${syncReceipt.insertedCount}개`}</p> : null}
    {page ? <>
      <p role="status">저장 이력 {page.events.length}개 · 건별 상태 변경 기록</p>
      <ul className={styles.entries}>
        {page.events.map(event => <li key={event.eventId}>
          <header><strong>{event.providerStatus}</strong><time dateTime={event.observedAt}>{date(event.observedAt)}</time></header>
          {event.resourceKind === "resolution_case" && "caseId" in event.normalized ? <>
            <span>{event.normalized.claimAmount.value} {event.normalized.claimAmount.currency} · 응답 기한 {date(event.normalized.respondByDate)}</span>
            <small>케이스 {event.providerNativeId} · 상품 {event.normalized.itemId} · 거래 {event.normalized.transactionId}</small>
          </> : event.resourceKind === "payment_dispute" && "paymentDisputeId" in event.normalized ? <>
            <span>{event.normalized.reason} · {event.normalized.amount.value} {event.normalized.amount.currency}</span>
            <small>분쟁 {event.providerNativeId} · 주문 {event.normalized.orderId}</small>
          </> : null}
          <span>eBay 변경 시각 {date(event.providerUpdatedAt)}</span>
        </li>)}
      </ul>
      <nav className={styles.pagination} aria-label="eBay 케이스·분쟁 저장 이력 페이지">
        <button type="button" className="filter-button" disabled={loading} onClick={() => void readHistory()}>처음</button>
        <button type="button" className="filter-button" disabled={loading || page.nextBeforeObservedAt === null || page.nextBeforeId === null}
          onClick={() => page.nextBeforeObservedAt && page.nextBeforeId && void readHistory({ observedAt: page.nextBeforeObservedAt, id: page.nextBeforeId })}>다음</button>
      </nav>
    </> : null}
  </details>;
}
