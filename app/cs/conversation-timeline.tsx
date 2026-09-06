"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./conversation-timeline.module.css";
import { conversationPageSchema, deliveryLabels, mergeConversationMessages, type ConversationMessage, type ConversationPage } from "../../lib/cs/conversation";

type FetchConversation = (input: string, init?: RequestInit) => Promise<Response>;
export function ConversationTimeline({ ticketId, refreshKey, authenticatedFetch }: {
  ticketId: string; refreshKey: string; authenticatedFetch: FetchConversation;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [cursor, setCursor] = useState<ConversationPage["nextCursor"]>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (next: ConversationPage["nextCursor"] = null) => {
    controller.current?.abort();
    const requestController = new AbortController(); controller.current = requestController;
    const requestGeneration = ++generation.current;
    setLoading(true); setError("");
    try {
      const query = next ? `?cursor=${encodeURIComponent(JSON.stringify(next))}` : "";
      const response = await authenticatedFetch(`/api/admin/cs/tickets/${encodeURIComponent(ticketId)}/messages${query}`, {
        cache: "no-store", signal: requestController.signal,
      });
      if (!response.ok) throw new Error("대화 이력을 불러오지 못했습니다.");
      const page = conversationPageSchema.parse(await response.json());
      if (page.ticketId !== ticketId) throw new Error("대화 이력의 문의를 확인하지 못했습니다.");
      if (requestController.signal.aborted || requestGeneration !== generation.current) return;
      setMessages((current) => mergeConversationMessages(next ? current : [], page.messages));
      setCursor(page.nextCursor);
    } catch {
      if (!requestController.signal.aborted && requestGeneration === generation.current) setError("대화 이력을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [authenticatedFetch, ticketId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); controller.current?.abort(); };
  }, [load, refreshKey]);
  return <section className={styles.timeline} aria-label="전체 대화 이력" aria-busy={loading}>
    <div className={styles.heading}><span>저장된 전체 대화</span><button type="button" className="filter-button" onClick={() => void load()} disabled={loading}>대화 새로고침</button></div>
    {cursor ? <button type="button" className="filter-button" onClick={() => void load(cursor)} disabled={loading}>이전 대화 더 보기</button> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => void load(cursor)}>다시 시도</button></div> : null}
    {loading ? <p role="status">대화를 불러오는 중입니다.</p> : null}
    {!loading && !error && messages.length === 0 ? <p>저장된 대화가 없습니다.</p> : null}
    <ol className={styles.messages}>
      {messages.map((message) => <li key={message.key} className={`${styles.message} ${message.role === "seller" ? styles.seller : ""}`}>
        <div><small className={styles.meta}>{message.role === "customer" ? "고객" : message.role === "seller" ? "판매자" : "시스템"} · <time dateTime={message.occurredAt}>{new Date(message.occurredAt).toLocaleString("ko-KR")}</time></small>
          <p className={styles.body}>{message.body ?? "답변 본문 보관 여부를 확인해 주세요."}</p>
          <span className={styles.state}>{deliveryLabels[message.deliveryStatus]}</span>
        </div>
      </li>)}
    </ol>
  </section>;
}
