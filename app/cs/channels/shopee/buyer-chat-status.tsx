"use client";

import { useEffect, useRef, useState } from "react";
import {
  createShopeeBuyerChatView,
  mergeShopeeBuyerChatStatusPage,
  shopeeBuyerChatApiSchema,
  type ShopeeBuyerChatView,
} from "../../../../lib/cs/channels/shopee/buyer-chat-contract";
import styles from "../../lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const reasonLabel = {
  contract_permission_unverified: "공식 SellerChat 계약 확인 대기",
  app_approval_unverified: "현재 앱의 Buyer Chat 승인 확인 대기",
  webhook_permission_unverified: "현재 앱의 Buyer Chat webhook 승인 확인 대기",
  credential_unavailable: "저장 이력만 확인 가능 · 현재 인증 정보 재승인 필요",
  approved_page_evidence: "승인된 페이지 이력 저장 증거 확인",
} as const;

export function ShopeeBuyerChatStatusContent({ data, loading, loadingScopeKey, error,
  onLoad, onLoadMore }: {
  data: ShopeeBuyerChatView | null;
  loading: boolean;
  loadingScopeKey: string;
  error: string;
  onLoad: () => void;
  onLoadMore: (credentialId: string, shopId: string, cursor: string) => void;
}) {
  return <>
    <summary>Buyer Chat · {data?.shops.some(shop => shop.push.verifiedReceipt)
      ? "검증된 수신 기록 있음 · 현재 연결 미검증" : data?.storedHistory
      ? "저장된 페이지 이력" : data?.ledgerPermissionState === "page_evidence_approved"
        ? "페이지 저장 증거 확인 · 검증된 수신 기록 0건" : "권한 확인 대기"}</summary>
    <p>서명을 확인하는 Buyer Chat 수신 처리가 구현되어 있습니다. 구현 상태와 과거 검증된 수신 기록만으로 현재 연결 또는 운영 수신 완료를 추정하지 않습니다.</p>
    <p>자동 이력 조회와 Buyer Chat 답변 전송은 지원하지 않습니다. 이 화면은 저장된 메시지와 비밀값을 제외한 검증된 수신 기록만 읽습니다.</p>
    {data?.transport ? <p role="status">현재 연결 검증: 미확인 · 자동 이력 조회: 미지원 · 답변 전송: 미지원</p> : null}
    <button type="button" className="filter-button" disabled={loading} onClick={onLoad}>
      {loading && !loadingScopeKey ? "상태 확인 중…" : "Buyer Chat 상태·저장 이력 새로고침"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
    {data ? <p role="status">{reasonLabel[data.ledgerPermissionReason]}</p> : null}
    <div className={styles.messages}>{data?.shops.map(shop => {
      const scopeKey = `${shop.credentialId}:${shop.shopId}`;
      return <article key={scopeKey}>
        <header><strong>shop {shop.shopId}</strong><span>{shop.push.verifiedReceipt
          ? shop.push.entitlementCurrent
            ? "검증된 수신 기록 있음 · 현재 수신 권한 유효 · 연결 미검증"
            : "과거 검증된 수신 기록 · 현재 수신 권한 없음"
          : shop.push.entitlementCurrent
            ? "현재 수신 권한 유효 · 검증된 수신 기록 0건"
            : "검증된 수신 기록 0건 · 현재 수신 권한 없음"}</span></header>
        <p>수신 처리 구현됨 · 인증 정보 {shop.push.credentialCurrent ? "현재 유효" : "현재 무효"}
          · 수신 권한 {shop.push.entitlementCurrent ? "현재 유효" : "현재 무효"}
          · 현재 연결 미검증</p>
        {shop.push.lastVerifiedReceivedAt ? <p>마지막 검증된 수신: <time
          dateTime={shop.push.lastVerifiedReceivedAt}>{shop.push.lastVerifiedReceivedAt}</time></p> : null}
        <p>대화 {shop.conversationCount.toLocaleString("ko-KR")}개 · 메시지 {shop.messages.length.toLocaleString("ko-KR")}개</p>
        {shop.messages.map(message => <div key={message.identityDigest}
          data-conversation-id={message.conversationId} data-message-id={message.messageId}
          data-sender-role={message.senderRole}>
          <strong>{message.senderRole}</strong> · <time dateTime={message.sentAt}>{message.sentAt}</time>
          <p>{message.body}</p>
          {message.media ? <aside aria-label="Shopee Buyer Chat 첨부 정보">
            {message.media.type === "image" ? <>
              <p>이미지 첨부 · {message.media.thumbnailWidth}×{message.media.thumbnailHeight}</p>
              <a href={message.media.imageUrl} target="_blank" rel="noreferrer">Shopee 원본 이미지 열기</a>
              <p>미리보기 참조값과 파일 서버 식별자를 원문 그대로 보존했습니다. 원격 파일은 서버에서 자동으로 내려받지 않습니다.</p>
            </> : message.media.type === "video" ? <>
              <p>동영상 첨부 · {message.media.durationSeconds}초 · {message.media.thumbnailWidth}×{message.media.thumbnailHeight}</p>
              <p>영상 및 미리보기 참조값을 원문 그대로 보존했습니다. 공식 값이 URL이 아닐 수 있어 자동 열기나 다운로드를 하지 않습니다.</p>
            </> : <>
              <p>상품 정보 · 상품 shop {message.media.itemShopId} · item {message.media.itemId}</p>
              <p>원본 상품 식별자 {message.media.sourceItemId}도 별도로 보존했습니다.</p>
            </>}
          </aside> : null}
        </div>)}
        {shop.memoryLimitReached ? <p role="status">
          브라우저에는 조회 중인 이력 중 최대 500개를 표시합니다. 추가 이력을 계속 불러올 수 있으며, 처음 조회한 이력은 새로고침으로 다시 볼 수 있습니다.
        </p> : null}
        {shop.nextCursor ? <button type="button" className="filter-button" disabled={loading}
          onClick={() => onLoadMore(shop.credentialId, shop.shopId, shop.nextCursor!)}>
          {loadingScopeKey === scopeKey ? "추가 이력 조회 중…" : "이 shop 추가 이력 불러오기"}
        </button> : null}
      </article>;
    })}</div>
  </>;
}

type BuyerChatSessionState = {
  authenticatedFetch: AuthenticatedFetch;
  data: ShopeeBuyerChatView | null;
  loading: boolean;
  loadingScopeKey: string;
  error: string;
};

function emptySessionState(authenticatedFetch: AuthenticatedFetch): BuyerChatSessionState {
  return { authenticatedFetch, data: null, loading: false, loadingScopeKey: "", error: "" };
}

export function ShopeeBuyerChatStatus({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [sessionState, setSessionState] = useState<BuyerChatSessionState>(
    () => emptySessionState(authenticatedFetch),
  );
  if (sessionState.authenticatedFetch !== authenticatedFetch) {
    setSessionState(emptySessionState(authenticatedFetch));
  }
  const requestController = useRef<{
    authenticatedFetch: AuthenticatedFetch;
    controller: AbortController;
  } | null>(null);
  const requestSequence = useRef(0);
  const visibleState = sessionState.authenticatedFetch === authenticatedFetch
    ? sessionState : emptySessionState(authenticatedFetch);
  const { data, loading, loadingScopeKey, error } = visibleState;

  useEffect(() => () => {
    const active = requestController.current;
    if (active?.authenticatedFetch === authenticatedFetch) {
      requestSequence.current += 1;
      active.controller.abort();
      requestController.current = null;
    }
  }, [authenticatedFetch]);

  const isCurrentRequest = (sessionFetch: AuthenticatedFetch, sequence: number,
    abort: AbortController) => (
    !abort.signal.aborted
    && requestSequence.current === sequence
    && requestController.current?.authenticatedFetch === sessionFetch
    && requestController.current.controller === abort
  );

  const load = async () => {
    requestController.current?.controller.abort();
    const sequence = ++requestSequence.current;
    const sessionFetch = authenticatedFetch;
    const abort = new AbortController();
    requestController.current = { authenticatedFetch: sessionFetch, controller: abort };
    setSessionState({ ...emptySessionState(sessionFetch), loading: true });
    try {
      const response = await sessionFetch("/api/admin/cs/channels/shopee/buyer-chat?limit=100", {
        method: "GET", cache: "no-store", signal: abort.signal,
      });
      if (!response.ok) throw new Error("Shopee Buyer Chat unavailable");
      const result = shopeeBuyerChatApiSchema.parse(await response.json());
      if (isCurrentRequest(sessionFetch, sequence, abort)) {
        setSessionState((current) => current.authenticatedFetch === sessionFetch
          ? { ...current, data: createShopeeBuyerChatView(result) } : current);
      }
    } catch {
      if (isCurrentRequest(sessionFetch, sequence, abort)) {
        setSessionState((current) => current.authenticatedFetch === sessionFetch
          ? { ...current, data: null,
            error: "Shopee Buyer Chat 권한 상태를 조회하지 못했습니다." } : current);
      }
    } finally {
      if (isCurrentRequest(sessionFetch, sequence, abort)) {
        setSessionState((current) => current.authenticatedFetch === sessionFetch
          ? { ...current, loading: false } : current);
        requestController.current = null;
      }
    }
  };

  const loadMore = async (credentialId: string, shopId: string, cursor: string) => {
    requestController.current?.controller.abort();
    const sequence = ++requestSequence.current;
    const sessionFetch = authenticatedFetch;
    const currentData = data;
    const abort = new AbortController();
    requestController.current = { authenticatedFetch: sessionFetch, controller: abort };
    const scopeKey = `${credentialId}:${shopId}`;
    setSessionState((current) => current.authenticatedFetch === sessionFetch
      ? { ...current, loading: true, loadingScopeKey: scopeKey, error: "" }
      : { ...emptySessionState(sessionFetch), loading: true, loadingScopeKey: scopeKey });
    try {
      const query = new URLSearchParams({ credentialId, shopId, cursor, limit: "100" });
      const response = await sessionFetch(
        `/api/admin/cs/channels/shopee/buyer-chat?${query.toString()}`,
        { method: "GET", cache: "no-store", signal: abort.signal },
      );
      if (!response.ok) throw new Error("Shopee Buyer Chat continuation unavailable");
      const result = shopeeBuyerChatApiSchema.parse(await response.json());
      if (!isCurrentRequest(sessionFetch, sequence, abort)) return;
      if (!currentData) throw new Error("Shopee Buyer Chat current page unavailable");
      const merged = mergeShopeeBuyerChatStatusPage(
        currentData, result, { credentialId, shopId },
      );
      setSessionState((current) => current.authenticatedFetch === sessionFetch
        ? { ...current, data: merged } : current);
    } catch {
      if (isCurrentRequest(sessionFetch, sequence, abort)) {
        setSessionState((current) => current.authenticatedFetch === sessionFetch
          ? { ...current, data: null,
            error: "Shopee Buyer Chat 추가 이력을 조회하지 못했습니다. 이전 결과를 폐기했습니다." }
          : current);
      }
    } finally {
      if (isCurrentRequest(sessionFetch, sequence, abort)) {
        setSessionState((current) => current.authenticatedFetch === sessionFetch
          ? { ...current, loading: false, loadingScopeKey: "" } : current);
        requestController.current = null;
      }
    }
  };

  return <details className={`panel ${styles.panel}`} onToggle={event => {
    if (event.currentTarget.open) return;
    requestSequence.current += 1;
    requestController.current?.controller.abort(); requestController.current = null;
    setSessionState(emptySessionState(authenticatedFetch));
  }}>
    <ShopeeBuyerChatStatusContent data={data} loading={loading}
      loadingScopeKey={loadingScopeKey} error={error}
      onLoad={() => void load()} onLoadMore={(credentialId, shopId, cursor) => {
        void loadMore(credentialId, shopId, cursor);
      }} />
  </details>;
}
