"use client";

import { useEffect, useRef, useState } from "react";
import {
  ebayMessageAccountsSchema, ebayConversationPageSchema, ebayConversationMessagesSchema,
  type EbayMessageAccounts, type EbayConversationPage, type EbayConversationMessages,
} from "../../lib/cs/ebay-messages";
import styles from "./ebay-messages.module.css";

type FetchMessages = (input: string, init?: RequestInit) => Promise<Response>;
const roles = { customer: "고객", seller: "판매자", system: "eBay 안내", unverified: "발신자 구분 확인 필요" };
const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

export function EbayMessages({ authenticatedFetch }: { authenticatedFetch: FetchMessages }) {
  const [accounts, setAccounts] = useState<EbayMessageAccounts | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [type, setType] = useState<"FROM_MEMBERS" | "FROM_EBAY">("FROM_MEMBERS");
  const [page, setPage] = useState<EbayConversationPage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<EbayConversationMessages | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  function clear() {
    controller.current?.abort(); ++generation.current;
    setPage(null); setSelected(null); setMessages(null); setError(""); setLoading(false);
  }
  async function read(view: "accounts" | "conversations" | "messages", offset = 0, conversationId?: string) {
    if (view !== "accounts" && !credentialId) { setError("조회할 eBay 계정을 선택해 주세요."); return; }
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const run = ++generation.current;
    setLoading(true); setError(""); setMessages(null);
    if (view !== "messages") { setPage(null); setSelected(null); } else setSelected(conversationId ?? null);
    const params = new URLSearchParams({ view });
    if (view !== "accounts") { params.set("credentialId", credentialId); params.set("type", type); params.set("offset", String(offset)); }
    if (conversationId) params.set("conversationId", conversationId);
    try {
      const response = await authenticatedFetch(`/api/admin/cs/ebay-messages?${params}`, { cache: "no-store", signal: abort.signal });
      const data: unknown = await response.json();
      if (abort.signal.aborted || run !== generation.current) return;
      if (!response.ok) {
        const message = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "대화 조회에 실패했습니다.";
        throw new Error(message);
      }
      if (view === "accounts") {
        const next = ebayMessageAccountsSchema.parse(data).accounts;
        setAccounts(next); setCredentialId(next.length === 1 ? next[0].id : "");
      } else if (view === "conversations") {
        const next = ebayConversationPageSchema.parse(data);
        if (next.credentialId !== credentialId || next.offset !== offset || next.entries.some(row => row.type !== type)) throw new Error("조회 계정·대화 종류가 일치하지 않습니다.");
        setPage(next);
      } else {
        const next = ebayConversationMessagesSchema.parse(data);
        if (next.credentialId !== credentialId || next.conversationId !== conversationId || next.type !== type || next.offset !== offset) throw new Error("조회 대화가 일치하지 않습니다.");
        setMessages(next);
      }
    } catch (caught) {
      if (!abort.signal.aborted && run === generation.current) {
        setError(caught instanceof Error && caught.name !== "ZodError" ? caught.message : "eBay 대화 응답 형식을 확인하지 못했습니다.");
      }
    } finally { if (run === generation.current) setLoading(false); }
  }

  return <details className={`panel ${styles.viewer}`}>
    <summary>eBay 일반 대화 · 과거 메시지 열람</summary>
    <p>eBay가 제공하는 전체 기간의 대화를 페이지별로 조회합니다. 상품 문의(ASQ)와 별도이며, 열람한 대화는 아직 사이트에 보관되지 않습니다.</p>
    <div className={styles.filters}>
      <button type="button" className="filter-button" disabled={loading} onClick={() => void read("accounts")}>연결 계정 불러오기</button>
      {accounts ? <>
        <label>eBay 계정<select value={credentialId} disabled={loading} onChange={event => { clear(); setCredentialId(event.target.value); }}>
          <option value="">계정 선택</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.label} · {account.environment === "production" ? "운영" : "테스트"}</option>)}
        </select></label>
        <label>대화 종류<select value={type} disabled={loading} onChange={event => { clear(); setType(event.target.value as typeof type); }}>
          <option value="FROM_MEMBERS">회원 간 대화</option><option value="FROM_EBAY">eBay 안내</option>
        </select></label>
        <button type="button" className="filter-button" disabled={loading || !credentialId} onClick={() => void read("conversations")}>대화 조회</button>
      </> : null}
    </div>
    {accounts?.length === 0 ? <p>본인 계정으로 연결된 활성 eBay 키가 없습니다. 채널 연결 관리에서 확인해 주세요.</p> : null}
    {loading ? <p role="status">eBay 대화를 조회하고 있습니다…</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {page ? <>
      <p role="status">eBay 조회 결과 {page.total}개 대화 · 이 페이지 {page.entries.length}개{page.total === 0 ? " · 선택한 계정과 대화 종류의 조회 결과입니다." : ""}</p>
      <div className={styles.conversations}>{page.entries.map(row => <button key={row.conversationId} type="button" disabled={loading}
        aria-pressed={selected === row.conversationId} onClick={() => void read("messages", 0, row.conversationId)}>
        <strong>{row.title || "제목 없는 대화"}</strong><span>{roles[row.latestMessage.role]} · {date(row.latestMessage.createdAt)}</span>
        <p>{row.latestMessage.body || `첨부 ${row.latestMessage.media.length}개`}</p>
        <small>대화 {row.conversationId}{row.referenceId ? ` · 상품 ${row.referenceId}` : ""}</small>
      </button>)}</div>
      <nav className={styles.pages} aria-label="eBay 대화 목록 페이지">
        <button type="button" className="filter-button" disabled={loading || page.offset === 0} onClick={() => void read("conversations", page.offset - 25)}>이전 대화 목록</button>
        <span>{page.offset / 25 + 1}페이지</span>
        <button type="button" className="filter-button" disabled={loading || page.nextOffset === null} onClick={() => page.nextOffset !== null && void read("conversations", page.nextOffset)}>다음 대화 목록</button>
      </nav>
    </> : null}
    {messages ? <section className={styles.detail} aria-label="eBay 일반 대화 내용">
      <h3>{messages.title || "제목 없는 대화"}</h3>
      <p>전체 {messages.total}개 메시지 · 이 페이지 {messages.entries.length}개 · 시간은 한국 시간입니다.</p>
      {messages.entries.map(message => <article key={message.messageId} className={styles.message}>
        <header><strong>{roles[message.role]}</strong><time dateTime={message.createdAt} title={message.createdAt}>{date(message.createdAt)}</time></header>
        <small>{message.senderUsername} → {message.recipientUsername}</small>
        {message.subject ? <h4>{message.subject}</h4> : null}
        {message.body ? <p>{message.body}</p> : null}
        {message.media.length ? <ul aria-label="첨부 파일">{message.media.map((media, index) => <li key={`${message.messageId}:${index}`}>
          <a href={media.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{media.name || `${media.type} 첨부 ${index + 1}`}</a>
        </li>)}</ul> : null}
      </article>)}
      <nav className={styles.pages} aria-label="eBay 메시지 페이지">
        <button type="button" className="filter-button" disabled={loading || messages.offset === 0} onClick={() => void read("messages", messages.offset - 25, messages.conversationId)}>이전 메시지</button>
        <span>{messages.offset / 25 + 1}페이지</span>
        <button type="button" className="filter-button" disabled={loading || messages.nextOffset === null} onClick={() => messages.nextOffset !== null && void read("messages", messages.nextOffset, messages.conversationId)}>다음 메시지</button>
      </nav>
    </section> : null}
  </details>;
}
