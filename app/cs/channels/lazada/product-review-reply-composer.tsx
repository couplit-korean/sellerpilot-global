"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LazadaSupplementalStoredEvent } from "../../../../lib/cs/channels/lazada/supplemental-contract";
import {
  createLazadaProductReviewReplyMemoryStore,
  createLazadaProductReviewReplySessionStore,
  createLazadaProductReviewReplyUiWorkflow,
  fetchLazadaProductReviewReplyCapability,
  lazadaProductReviewReplyUiSelectionSchema,
  type LazadaProductReviewReplyCapability,
  type LazadaProductReviewReplyPending,
  type LazadaProductReviewReplyUiSelection,
} from "../../../../lib/cs/channels/lazada/product-review-reply-ui";
import styles from "../../lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
const authenticatedFetchSessionIds = new WeakMap<AuthenticatedFetch, number>();
let nextAuthenticatedFetchSessionId = 1;

function authenticatedFetchSessionId(authenticatedFetch: AuthenticatedFetch) {
  const existing = authenticatedFetchSessionIds.get(authenticatedFetch);
  if (existing) return existing;
  const created = nextAuthenticatedFetchSessionId++;
  authenticatedFetchSessionIds.set(authenticatedFetch, created);
  return created;
}

export function lazadaProductReviewReplySelectionFromEvent(
  event: LazadaSupplementalStoredEvent,
): LazadaProductReviewReplyUiSelection | null {
  const observedAt = Date.parse(event.observedAt);
  const reviewId = event.providerContext.reviewId ?? event.resourceKey;
  const parsed = lazadaProductReviewReplyUiSelectionSchema.safeParse({
    credentialId: event.credentialId,
    country: event.country,
    reviewId,
    generation: Number.isFinite(observedAt) ? Math.max(1, Math.floor(observedAt)) : 0,
    eventKey: event.eventKey,
  });
  return event.surface === "product_review" && parsed.success ? parsed.data : null;
}

function statusMessage(pending: LazadaProductReviewReplyPending | null) {
  if (!pending) return "아직 답글을 접수하지 않았습니다.";
  if (pending.outcomeUnknown && !pending.deliveryId) {
    return "접수 응답을 받지 못했습니다. 본문은 잠겼으며 동일 본문으로만 결과를 다시 확인할 수 있습니다.";
  }
  if (pending.outcomeUnknown) return "저장된 처리 기록의 최신 상태를 확인하지 못했습니다.";
  switch (pending.status) {
    case "prepared": return "답글 처리 기록이 준비되었습니다. 상태를 새로고침해 주세요.";
    case "queued": return "제공자 전송 작업이 대기 중입니다. 전송 완료로 표시하지 않습니다.";
    case "running": return "제공자 전송 작업이 실행 중입니다. 전송 완료로 표시하지 않습니다.";
    case "readback_required": return "전송 응답이 불확실합니다. 재전송 없이 외부 반영 확인이 필요합니다.";
    case "verified": return "Lazada 외부 조회로 답글 반영이 확인되었습니다.";
    case "failed": return "답글 작업이 실패했습니다. 자동 재전송은 차단되어 있습니다.";
    default: return "답글 접수 상태를 확인해 주세요.";
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("PERMISSION_REQUIRED")) return "현재 계정·국가에는 답글 권한이 없습니다.";
  if (message.includes("PENDING_BODY_CONFLICT")) return "응답 유실 건은 기존과 완전히 같은 본문으로만 다시 확인할 수 있습니다.";
  if (message.includes("CONFLICT")) return "리뷰가 변경되었거나 이미 답글 처리 중입니다. 저장된 리뷰를 새로 동기화해 주세요.";
  if (message.includes("BINDING_MISMATCH")) return "선택한 리뷰와 서버 처리 기록의 계정·국가·리뷰 버전이 일치하지 않습니다.";
  return "요청 결과를 확인하지 못했습니다. 자동 재전송은 하지 않습니다.";
}

function LazadaProductReviewReplyComposerSession({
  event,
  authenticatedFetch,
}: {
  event: LazadaSupplementalStoredEvent;
  authenticatedFetch: AuthenticatedFetch;
}) {
  const selection = useMemo(() => lazadaProductReviewReplySelectionFromEvent(event), [event]);
  type ReplyWorkflow = ReturnType<typeof createLazadaProductReviewReplyUiWorkflow>;
  const [workflow, setWorkflow] = useState<ReplyWorkflow | null>(null);
  const [capability, setCapability] = useState<LazadaProductReviewReplyCapability | null>(null);
  const [permissionLoading, setPermissionLoading] = useState(Boolean(selection));
  const [pending, setPending] = useState<LazadaProductReviewReplyPending | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const uiGeneration = useRef(0);
  const alreadyReplied = Boolean(event.providerContext.sellerReplyId || event.providerContext.sellerReply);

  useEffect(() => {
    const run = ++uiGeneration.current;
    let sessionWorkflow: ReplyWorkflow | null = null;
    if (!selection || alreadyReplied) {
      return () => { uiGeneration.current += 1; };
    }
    void fetchLazadaProductReviewReplyCapability(authenticatedFetch, {
      credentialId: selection.credentialId,
      country: selection.country,
    })
      .then((next) => {
        if (run !== uiGeneration.current) return;
        setCapability(next);
        if (next.permissionState !== "authorized") return;
        const store = typeof window === "undefined"
          ? createLazadaProductReviewReplyMemoryStore()
          : createLazadaProductReviewReplySessionStore(window.sessionStorage, next.viewerId);
        sessionWorkflow = createLazadaProductReviewReplyUiWorkflow(authenticatedFetch, store);
        sessionWorkflow.activate(selection);
        const recovered = sessionWorkflow.pending(selection);
        setWorkflow(sessionWorkflow);
        setPending(recovered);
        setReply(recovered?.reply ?? "");
      })
      .catch(() => {
        if (run === uiGeneration.current) {
          setPending(null);
          setReply("");
          setError("답글 권한을 확인하지 못했습니다. 답글 접수는 차단됩니다.");
        }
      })
      .finally(() => { if (run === uiGeneration.current) setPermissionLoading(false); });
    return () => { uiGeneration.current += 1; sessionWorkflow?.activate(null); };
  }, [alreadyReplied, authenticatedFetch, selection]);

  if (!selection) return null;
  if (alreadyReplied) {
    return <div className={styles.replyComposer} data-lazada-product-review-reply="already-replied">
      <p className={styles.allowed}>Lazada 저장 기록에 판매자 답글이 이미 포함되어 있어 새 답글을 접수하지 않습니다.</p>
    </div>;
  }

  const authorized = capability?.permissionState === "authorized";
  const bodyLocked = Boolean(pending?.outcomeUnknown && !pending.deliveryId);
  const canSubmit = authorized && !busy && reply.trim().length > 0 && reply.trim().length <= 500
    && !pending?.deliveryId && (!pending || pending.outcomeUnknown);

  const runAction = async (action: "submit" | "refresh" | "readback") => {
    if (!workflow) return;
    const run = uiGeneration.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = action === "submit"
        ? await workflow.submit(selection, reply)
        : action === "refresh"
          ? await workflow.refresh(selection)
          : await workflow.requestReadback(selection);
      if (run !== uiGeneration.current || result.status === "stale") return;
      setPending(result.pending);
      setReply(result.pending.reply);
      setMessage(action === "readback"
        ? "외부 반영 확인 작업을 한 번 접수했습니다. 결과는 상태 새로고침으로 별도 확인해 주세요."
        : "서버 처리 기록 상태를 확인했습니다.");
    } catch (caught) {
      if (run === uiGeneration.current) {
        setPending(workflow.pending(selection));
        setError(errorMessage(caught));
      }
    } finally {
      if (run === uiGeneration.current) setBusy(false);
    }
  };

  return <div className={styles.replyComposer} data-lazada-product-review-reply="composer">
    <p className={permissionLoading ? undefined : authorized ? styles.allowed : styles.blocked} role="status">
      {permissionLoading ? "정확한 계정·국가 답글 권한 확인 중…"
        : authorized ? "이 계정·국가의 Product Review 답글 권한이 확인되었습니다."
          : "답글 권한 미확인 · 접수 차단"}
    </p>
    <label>판매자 답글
      <textarea aria-label={`Lazada 리뷰 ${selection.reviewId} 판매자 답글`} rows={3} maxLength={500}
        value={reply} disabled={busy || bodyLocked || Boolean(pending?.deliveryId)}
        placeholder="답글을 입력한 뒤 아래 접수 버튼을 직접 누르세요."
        onChange={(change) => setReply(change.currentTarget.value)} />
    </label>
    <small>{reply.length}/500 · 자동 답글 및 자동 재전송 비활성</small>
    <p role="status">{statusMessage(pending)}</p>
    <div className={styles.actions}>
      {!pending?.deliveryId ? <button type="button" className="filter-button" disabled={!canSubmit}
        data-lazada-product-review-reply-submit="true" onClick={() => void runAction("submit")}>
        {busy ? "처리 중…" : bodyLocked ? "동일 본문으로 결과 확인" : "답글 접수"}
      </button> : null}
      {pending?.deliveryId ? <button type="button" className="filter-button" disabled={busy}
        data-lazada-product-review-reply-refresh="true" onClick={() => void runAction("refresh")}>
        {busy ? "처리 중…" : "처리 상태 새로고침"}
      </button> : null}
      {pending?.status === "readback_required" ? <button type="button" className="filter-button" disabled={busy}
        data-lazada-product-review-reply-readback="true" onClick={() => void runAction("readback")}>
        {busy ? "처리 중…" : "재전송 없이 외부 반영 확인"}
      </button> : null}
    </div>
    {error ? <p role="alert" className={styles.blocked}>{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}

export function LazadaProductReviewReplyComposer(props: {
  event: LazadaSupplementalStoredEvent;
  authenticatedFetch: AuthenticatedFetch;
}) {
  const selection = lazadaProductReviewReplySelectionFromEvent(props.event);
  const selectionKey = selection
    ? [selection.credentialId, selection.country, selection.reviewId, selection.generation, selection.eventKey].join(":")
    : `unavailable:${props.event.eventKey}`;
  return <LazadaProductReviewReplyComposerSession
    key={`${authenticatedFetchSessionId(props.authenticatedFetch)}:${selectionKey}`}
    {...props}
  />;
}
