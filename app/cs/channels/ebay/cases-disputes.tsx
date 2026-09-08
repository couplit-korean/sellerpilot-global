"use client";

import { useEffect, useRef, useState } from "react";
import {
  ebayCaseDisputePageSize,
  readEbayCaseDisputeUiResponse,
  type EbayCaseDisputeAccounts,
  type EbayCaseDisputeAuthenticatedFetch,
  type EbayPaymentDisputePageResponse,
  type EbayResolutionCasePageResponse,
} from "../../../../lib/cs/channels/ebay/cases-disputes";
import styles from "./cases-disputes.module.css";

type View = "payment_disputes" | "resolution_cases";
type Page = EbayPaymentDisputePageResponse | EbayResolutionCasePageResponse;

const availabilityLabels = {
  readable: "조회 완료",
  authorization_required: "권한 확인 필요",
  not_available_or_not_found: "계정 가용성 또는 리소스 확인 필요",
  rate_limited: "조회 한도 도달",
  provider_unverified: "공급자 응답 확인 필요",
  sandbox_unsupported: "Sandbox 미지원",
};

const date = (value: string | null) => value
  ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
  : "없음";

function recentCaseRange(now = Date.now()) {
  return {
    startTime: new Date(now - 30 * 86_400_000).toISOString(),
    endTime: new Date(now).toISOString(),
  };
}

export function EbayCasesDisputes({ authenticatedFetch }: { authenticatedFetch: EbayCaseDisputeAuthenticatedFetch }) {
  const [accounts, setAccounts] = useState<EbayCaseDisputeAccounts | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [view, setView] = useState<View>("payment_disputes");
  const [page, setPage] = useState<Page | null>(null);
  const [caseRange, setCaseRange] = useState<ReturnType<typeof recentCaseRange> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  function clear() {
    controller.current?.abort();
    generation.current += 1;
    setPage(null);
    setCaseRange(null);
    setError("");
    setLoading(false);
  }

  async function read(nextView: "accounts" | View, offset = 0, fixedRange = caseRange) {
    if (nextView !== "accounts" && !credentialId) {
      setError("조회할 eBay 계정을 선택해 주세요.");
      return;
    }
    const range = nextView === "resolution_cases" ? fixedRange ?? recentCaseRange() : null;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const run = ++generation.current;
    setLoading(true);
    setError("");
    setPage(null);
    try {
      const next = await readEbayCaseDisputeUiResponse({
        authenticatedFetch,
        view: nextView,
        ...(nextView === "accounts" ? {} : { credentialId, offset }),
        ...(range ? { startTime: range.startTime, endTime: range.endTime } : {}),
        signal: abort.signal,
      });
      if (abort.signal.aborted || run !== generation.current) return;
      if (nextView === "accounts") {
        if (!("accounts" in next)) throw new Error("eBay 계정 응답 형식을 확인하지 못했습니다.");
        setAccounts(next.accounts);
        setCredentialId(next.accounts.length === 1 ? next.accounts[0].id : "");
        return;
      }
      if ("accounts" in next || next.kind !== nextView) throw new Error("조회 종류가 일치하지 않습니다.");
      if (next.credentialId !== credentialId || next.offset !== offset) {
        throw new Error("조회 계정·페이지가 일치하지 않습니다.");
      }
      if (nextView === "resolution_cases") setCaseRange(range);
      setPage(next);
    } catch (caught) {
      if (!abort.signal.aborted && run === generation.current) {
        setError(caught instanceof Error && caught.name !== "ZodError"
          ? caught.message
          : "eBay 케이스·분쟁 응답 형식을 확인하지 못했습니다.");
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }

  return <details className={`panel ${styles.viewer}`}>
    <summary>eBay 케이스·결제분쟁 · 읽기 전용</summary>
    <p className={styles.notice}>결제분쟁과 eBay Money Back Guarantee 케이스를 상담 메시지와 분리해 조회합니다. 수락·이의제기·환불·종결 기능은 제공하지 않습니다.</p>
    <div className={styles.filters}>
      <button type="button" className="filter-button" disabled={loading} onClick={() => void read("accounts")}>연결 계정 불러오기</button>
      {accounts ? <>
        <label>eBay 계정<select value={credentialId} disabled={loading} onChange={event => { clear(); setCredentialId(event.target.value); }}>
          <option value="">계정 선택</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.label} · {account.environment === "production" ? "운영" : "테스트"}</option>)}
        </select></label>
        <label>자료 종류<select value={view} disabled={loading} onChange={event => { clear(); setView(event.target.value as View); }}>
          <option value="payment_disputes">결제분쟁</option>
          <option value="resolution_cases">eBay MBG 케이스 · 최근 31일</option>
        </select></label>
        <button type="button" className="filter-button" disabled={loading || !credentialId} onClick={() => void read(view)}>조회</button>
      </> : null}
    </div>
    {accounts?.length === 0 ? <p>운영 공간에 연결된 활성 eBay 키가 없습니다.</p> : null}
    {loading ? <p role="status">eBay 케이스·분쟁을 조회하고 있습니다…</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {page ? <>
      <p role="status">{availabilityLabels[page.availability]} · {page.total === null ? "전체 건수 미제공" : `전체 ${page.total}개`} · 이 페이지 {page.entries.length}개</p>
      {page.kind === "resolution_cases" ? <p className={styles.notice}>범위 {date(page.startTime)}부터 {date(page.endTime)}까지 · seller 식별자는 표시하지 않습니다.</p> : null}
      <ul className={styles.entries}>
        {page.kind === "payment_disputes" ? page.entries.map(entry => <li key={entry.paymentDisputeId}>
          <header><strong>{entry.status}</strong><time dateTime={entry.openDate}>{date(entry.openDate)}</time></header>
          <span>{entry.reason} · {entry.amount.value} {entry.amount.currency}</span>
          <small>분쟁 {entry.paymentDisputeId} · 주문 {entry.orderId}</small>
          <span>응답 기한 {date(entry.respondByDate)} · 종결 {date(entry.closedDate)}</span>
        </li>) : page.entries.map(entry => <li key={entry.caseId}>
          <header><strong>{entry.status}</strong><time dateTime={entry.lastModifiedDate}>{date(entry.lastModifiedDate)}</time></header>
          <span>{entry.claimAmount.value} {entry.claimAmount.currency} · 응답 기한 {date(entry.respondByDate)}</span>
          <small>케이스 {entry.caseId} · 상품 {entry.itemId} · 거래 {entry.transactionId}</small>
          <span>생성 {date(entry.creationDate)} · 판매자 결속 {entry.sellerBinding === "matched" ? "확인" : entry.sellerBinding === "redacted" ? "공급자 마스킹" : "미확인"}</span>
        </li>)}
      </ul>
      <nav className={styles.pagination} aria-label="eBay 케이스·분쟁 페이지">
        <button type="button" className="filter-button" disabled={loading || page.offset === 0}
          onClick={() => void read(page.kind, page.offset - ebayCaseDisputePageSize, page.kind === "resolution_cases" ? { startTime: page.startTime, endTime: page.endTime } : null)}>이전</button>
        <span>{page.offset / ebayCaseDisputePageSize + 1}페이지</span>
        <button type="button" className="filter-button" disabled={loading || page.nextOffset === null}
          onClick={() => page.nextOffset !== null && void read(page.kind, page.nextOffset, page.kind === "resolution_cases" ? { startTime: page.startTime, endTime: page.endTime } : null)}>다음</button>
      </nav>
    </> : null}
  </details>;
}
