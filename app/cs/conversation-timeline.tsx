"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./conversation-timeline.module.css";
import { conversationPageSchema, deliveryLabels, mergeConversationMessages, type ConversationMessage, type ConversationPage } from "../../lib/cs/conversation";
import { conversationMediaLinks } from "../../lib/cs/conversation-media";

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
      if (!requestController.signal.aborted && requestGeneration === generation.current) {
        setMessages([]); setCursor(null); setError("대화 이력을 불러오지 못했습니다. 다시 시도해 주세요.");
      }
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
      {messages.map((message) => { const media=conversationMediaLinks(message.nativeMedia); return <li key={message.key} className={`${styles.message} ${message.role === "seller" ? styles.seller : ""}`}>
        <div><small className={styles.meta}>{message.role === "customer" ? "고객" : message.role === "seller" ? "판매자" : "시스템"} · <time dateTime={message.occurredAt}>{new Date(message.occurredAt).toLocaleString("ko-KR")}</time></small>
          <p className={styles.body}>{message.body ?? "답변 본문 보관 여부를 확인해 주세요."}</p>
          {message.messageState==="recalled"?<small className={styles.meta}>발신자가 회수한 메시지 · 저장 원문과 첨부는 대화 화면에 표시하지 않음</small>
            :message.messageState==="conflict_review_required"?<small className={styles.meta}>같은 메시지 ID의 본문·첨부 변경 감지 · 기존 투영 유지 · 원문/격리함 검토 필요</small>
            :null}
          {message.nativeMedia?<aside className={styles.attachments} aria-label="채널 첨부"><small className={styles.meta}>채널 첨부 메타데이터 보존됨</small>
            {media.length?<ul>{media.map(item=><li key={item.url}>{item.availability==="expired"
              ? <span>{item.kind==="image"?"이미지":item.kind==="video"?"영상":item.kind==="file"?"파일":"첨부"} · 링크 만료 · 채널 이력을 다시 조회해 복구 여부를 확인하세요.</span>
              : <><a href={item.url} target="_blank" rel="noreferrer">{item.kind==="image"?"이미지":item.kind==="video"?"영상":item.kind==="file"?"파일":"첨부"} 열기 · {item.label}</a>{item.availability==="expiry_unknown"?<small className={styles.meta}> · 채널 URL 보관 · 만료 시각 미제공</small>:item.expiresAt?<small className={styles.meta}> · {new Date(item.expiresAt).toLocaleString("ko-KR")}까지</small>:null}</>}</li>)}</ul>:<p>안전하게 열 수 있는 HTTPS 주소가 없어 원본 메타데이터만 보관했습니다.</p>}
          </aside>:null}
          {message.unsequencedAnswers.map((answer, index) => <aside key={index} aria-label="등록 시각 미확인 판매자 답변">
            <small className={styles.meta}>판매자 답변 · 채널에서 등록 시각을 제공하지 않아 대화 순서 미확정</small>
            <p className={styles.body}>{answer.body}</p>
          </aside>)}
          <span className={styles.state}>{deliveryLabels[message.deliveryStatus]}</span>
        </div>
      </li>;})}
    </ol>
  </section>;
}
