"use client";
import { type CsChannelFilter, type CsStatusFilter, csTicketMatchesFilter, csChannelFilterFromValue } from "../cs-navigation";
import { useState, useRef, useMemo, useEffect } from "react";
import { type CsReplyDrafts, selectedCsTicket, csReplyDraftValue, isRemoteCsReplyChannel, withCsReplyDraft, csChannelAttentionCount } from "../cs-release-state";
import { useModalInteraction } from "../use-modal-interaction";
import { activeChannelKeys } from "../../lib/channels/catalog";
import { Inbox, Clock3, BadgeCheck, Bot, ChevronDown, LoaderCircle, RefreshCw, CheckCircle2, AlertCircle, Search, MessageCircleMore, ArrowLeft, Package, AlertTriangle, Sparkles, Languages, FileText, Send, X } from "lucide-react";
import { channels } from "../channel-config";
import { CsHistoryWindow } from "./history-window";
import { ConversationTimeline } from "./conversation-timeline";
import type { DisplayTicket, ReplyQueueResult, SupportLocale, InquiryHistoryBackfill, OperationTicketDelivery, CsSyncStatus } from "./workspace-contracts";

const ticketChannelCodes: Record<string, string> = {
  Qoo10: "Q",
  Shopee: "S",
  Lazada: "L",
  쿠팡: "C",
  "11번가": "11",
  "네이버 스마트스토어": "N",
  eBay: "E",
  Temu: "T",
};


const supportLocaleLabels: Record<SupportLocale, string> = {
  "ko-KR": "한국어", "en-US": "영어", "ja-JP": "일본어", "zh-TW": "중국어(번체)", "th-TH": "태국어",
  "vi-VN": "베트남어", "id-ID": "인도네시아어", "ms-MY": "말레이어", "pt-BR": "포르투갈어", "es-MX": "스페인어",
};

const supportReplyTemplates = [
  { label: "주문 확인 안내", value: "문의해 주셔서 감사합니다. 주문 내역과 현재 처리 상태를 확인한 뒤 정확한 내용으로 다시 안내드리겠습니다." },
  { label: "배송 확인 안내", value: "배송으로 불편을 드려 죄송합니다. 판매채널에 등록된 배송 상태와 운송장 정보를 확인한 뒤 안내드리겠습니다." },
  { label: "교환·반품 확인", value: "교환·반품 요청 내용을 확인했습니다. 상품 상태와 판매채널 정책을 확인한 뒤 가능한 처리 방법을 안내드리겠습니다." },
];

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
}

function matchesSearch(searchable: string, query: string) {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const normalized = normalizeSearchText(searchable);
  return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
}

const replyDeliveryMeta = {
  queued: { label: "전송 대기", detail: "안전한 작업 대기열에 등록됐습니다.", tone: "queued" },
  running: { label: "판매채널 처리 중", detail: "작업자가 판매채널 응답을 확인하고 있습니다.", tone: "running" },
  succeeded: { label: "채널 접수", detail: "판매채널의 성공 응답을 받았습니다. 후속 조회에서 실제 답변을 다시 확인합니다.", tone: "succeeded" },
  failed: { label: "전달 실패", detail: "판매채널이 수락하지 않은 것으로 확인됐습니다. 오류를 확인한 뒤 수동으로 다시 시도하세요.", tone: "failed" },
  cancelled: { label: "전송 취소", detail: "답변이 판매채널에 전달되지 않았습니다.", tone: "failed" },
  reconciliation_required: { label: "전송 여부 확인 필요", detail: "판매채널이 답변을 받았을 가능성이 있어 자동 재전송을 차단했습니다.", tone: "reconciliation" },
} as const;

function replyDeliveryPresentation(delivery: OperationTicketDelivery) {
  if (delivery.channel === "qoo10" && delivery.qoo10S3StatusObserved) return {
    label: "Qoo10 S3 상태 확인",
    detail: "같은 문의번호와 순번이 S3 조회에 나타났습니다. 답변 본문 일치는 확인되지 않았습니다.",
    tone: "succeeded" as const,
  };
  if (delivery.channel === "qoo10"
      && (delivery.qoo10S3ReadbackState === "pending"
        || delivery.qoo10S3ReadbackState === "incomplete")) return {
    label: "채널 접수 · S3 상태 재확인 필요",
    detail: delivery.qoo10S3ReadbackState === "pending"
      ? "정확한 문의번호와 순번이 아직 S3 조회에 없습니다. 답변 본문은 확인하지 않았고 자동 재전송은 차단됩니다."
      : "S3 조회 증거가 불완전합니다. 답변 본문은 확인하지 않았고 자동 재전송은 차단됩니다.",
    tone: "reconciliation" as const,
  };
  if (delivery.verificationStatus === "remote_observed") return {
    label: "원격 반영 확인",
    detail: "후속 채널 조회에서 같은 문의·수신자·본문의 판매자 답변을 확인했습니다.",
    tone: "succeeded" as const,
  };
  if (delivery.verificationStatus === "provider_accepted") return {
    label: "채널 접수",
    detail: "판매채널의 성공 응답을 받았습니다. 후속 조회에서 실제 답변을 다시 확인합니다.",
    tone: "succeeded" as const,
  };
  return replyDeliveryMeta[delivery.status];
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function channelLiveCaption(channelKey: string, state: { status?: string | null; last_succeeded_at?: string | null; last_error?: string | null } | null) {
  if (channelKey === "lazada" && /permission/i.test(state?.last_error ?? "")) {
    return "Lazada IM Open API 권한이 없습니다. 셀러센터 Chat은 별도입니다.";
  }
  if (state?.status === "failed") {
    const detail = state.last_error?.replace(/\s+/g, " ").slice(0, 80);
    return detail ? `최근 조회 실패 · ${detail}` : "최근 조회 실패";
  }
  if (state?.status === "queued" || state?.status === "running") return "조회 중 · 화면이 열려 있으면 1분마다 자동 조회";
  if (state?.status === "unsupported") {
    return channelKey === "shopee"
      ? "채팅 API 없음 · 후기/반품과 상세 문의 양식을 사용합니다."
      : "이 채널 공개 수신 API가 없습니다.";
  }
  if (state?.status === "passed" && state.last_succeeded_at) {
    return `최근 조회 ${relativeTime(state.last_succeeded_at)} · 화면이 열려 있으면 1분마다 자동 조회`;
  }
  return "화면이 열려 있으면 1분마다 자동 조회합니다.";
}

function ChannelMark({ code, size = "md" }: { code: string; size?: "sm" | "md" | "lg" }) {
  const config = Object.values(channels).find(channel => channel.letter === code) ?? channels.qoo10;
  return <span className={`channel-mark ${size} ${config.mark.length > 2 ? "wide" : ""}`} title={config.name} aria-label={config.name} style={{ "--channel-color": config.color } as React.CSSProperties}>{config.mark}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("완료") || status === "판매중" || status === "정상" ? "success" : status.includes("주의") || status.includes("대기") || status === "처리 중" ? "warning" : status.includes("긴급") || status === "품절" || status.includes("실패") ? "danger" : "neutral";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}

export function CsPage({ authenticatedFetch, notify, displayTickets, onSend, onDeliveryStatus, onDraft, onStatus, onSync, onBackfill, syncing, syncStatus, historyBackfill, snapshotGeneratedAt, initialQuery = "", initialTicketId = null, initialChannel = "all", initialStatus = "open", onFilterChange }: {
  notify: (message: string) => void;
  displayTickets: DisplayTicket[];
  onSend: (ticket: DisplayTicket, reply: string) => Promise<ReplyQueueResult | null>;
  onDeliveryStatus: (ticketId: string, jobId: string) => Promise<OperationTicketDelivery | null>;
  onDraft: (ticket: DisplayTicket, targetLocale: SupportLocale) => Promise<string | null>;
  onStatus: (ticket: DisplayTicket, status: "waiting" | "in_progress" | "resolved") => Promise<boolean>;
  onSync: () => Promise<void>;
  onBackfill: (channel: "coupang" | "elevenst" | "smartstore", endDate?: string) => Promise<void>;
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  syncing: boolean;
  syncStatus: CsSyncStatus;
  historyBackfill: InquiryHistoryBackfill | null;
  snapshotGeneratedAt: string | null;
  initialQuery?: string;
  initialTicketId?: string | null;
  initialChannel?: CsChannelFilter;
  initialStatus?: CsStatusFilter;
  onFilterChange: (channel: CsChannelFilter, status: CsStatusFilter, ticketId?: string | null) => void;
}) {
  const initialTicket = displayTickets.find((ticket) => ticket.sourceId === initialTicketId) ?? null;
  const resolvedInitialStatus = initialTicket && !csTicketMatchesFilter(initialTicket, initialStatus)
    ? initialTicket.replyDeliveryStatus === "reconciliation_required"
      ? "reconciliation"
      : initialTicket.status === "처리 완료"
        ? "resolved"
        : initialTicket.status === "처리 중"
          ? "in_progress"
          : "waiting"
    : initialStatus;
  const [query, setQuery] = useState(initialQuery);
  const [replyDrafts, setReplyDrafts] = useState<CsReplyDrafts>({});
  const currentInboundByTicketRef = useRef(new Map<string, string | null>());
  const [targetLocale, setTargetLocale] = useState<SupportLocale>("ko-KR");
  const [drafting, setDrafting] = useState(false);
  const [sendingByTicket, setSendingByTicket] = useState<Record<string, boolean>>({});
  const [deliveryByTicket, setDeliveryByTicket] = useState<Record<string, OperationTicketDelivery>>(() => Object.fromEntries(
    displayTickets.filter((ticket) => ticket.delivery).map((ticket) => [ticket.sourceId, ticket.delivery as OperationTicketDelivery]),
  ));
  const [reviewReply, setReviewReply] = useState<{ ticket: DisplayTicket; reply: string } | null>(null);
  const reviewDialogRef = useRef<HTMLElement>(null);
  const reviewCloseButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(Boolean(initialTicketId));
  const effectiveDeliveryByTicket = useMemo(() => {
    const next = new Map<string, OperationTicketDelivery>();
    for (const ticket of displayTickets) {
      if (ticket.delivery && ticket.delivery.inboundKey === ticket.latestInboundKey) next.set(ticket.sourceId, ticket.delivery);
    }
    for (const [ticketId, localDelivery] of Object.entries(deliveryByTicket)) {
      const ticket = displayTickets.find((candidate) => candidate.sourceId === ticketId);
      if (!ticket || localDelivery.inboundKey !== ticket.latestInboundKey) continue;
      const snapshotDelivery = next.get(ticketId);
      if (!snapshotDelivery || Date.parse(localDelivery.updatedAt) >= Date.parse(snapshotDelivery.updatedAt)) {
        next.set(ticketId, localDelivery);
      }
    }
    return next;
  }, [deliveryByTicket, displayTickets]);
  useEffect(() => {
    currentInboundByTicketRef.current = new Map(displayTickets.map((ticket) => [ticket.sourceId, ticket.latestInboundKey]));
  }, [displayTickets]);
  const channelTickets = displayTickets.filter((ticket) => initialChannel === "all" || ticket.channelKey === initialChannel);
  const statusTickets = channelTickets.filter((ticket) => csTicketMatchesFilter(ticket, resolvedInitialStatus));
  const filteredTickets = statusTickets.filter((ticket) => !query.trim() || matchesSearch(`${ticket.id} ${ticket.customer} ${ticket.channel} ${ticket.subject} ${ticket.preview}`, query));
  const selected = selectedCsTicket(initialTicketId ? statusTickets : filteredTickets, initialTicketId ? initialTicket?.sourceId ?? "__missing_ticket__" : null);
  const selectedDraftTicket = selected ? { ...selected, sourceId: `${selected.sourceId}:${selected.latestInboundKey ?? "unbound"}:${selected.latestMessageState}` } : null;
  const reply = selected?.latestMessageState === "normal" ? csReplyDraftValue(replyDrafts, selectedDraftTicket) : "";
  const remoteReplyChannel = Boolean(selected
    && selected.remoteReplySupported
    && isRemoteCsReplyChannel(selected.channelKey));
  const providerConfirmed = selected?.providerStatus === "answered" || selected?.providerStatus === "closed";
  const providerReplyReady = selected?.providerStatus === "waiting"
    && Boolean(selected.latestInboundKey)
    && selected.latestMessageState === "normal"
    && selected.replyAllowed;
  const delivery = selected ? effectiveDeliveryByTicket.get(selected.sourceId) ?? null : null;
  const blockingDelivery = selected?.blockingDelivery ?? null;
  const sending = Boolean(selected && sendingByTicket[selected.sourceId]);
  const deliveryActive = delivery?.status === "queued" || delivery?.status === "running" || blockingDelivery?.status === "queued" || blockingDelivery?.status === "running";
  const deliveryReconciliation = delivery?.status === "reconciliation_required" || blockingDelivery?.status === "reconciliation_required";
  const completed = selected?.status === "처리 완료";
  const composerLocked = !selected || completed || !providerReplyReady || sending || deliveryActive || deliveryReconciliation || !remoteReplyChannel;
  const composerLockReason = completed
    ? "처리 완료된 문의는 수정하거나 재전송할 수 없습니다."
    : selected?.latestMessageState === "recalled"
      ? "최신 Lazada 고객 메시지가 회수되어 초안 생성과 답변 전송을 차단했습니다."
    : selected?.latestMessageState === "conflict_review_required"
      ? "같은 Lazada 메시지 ID에서 서로 다른 본문 또는 첨부가 관측됐습니다. 원문함에서 충돌을 검토해 주세요."
    : providerConfirmed
      ? "판매채널에서 이미 답변 또는 종료가 확인됐습니다. 채널 확인 후 처리 완료로 정리해 주세요."
    : blockingDelivery
      ? "이전 고객 메시지의 답변 작업 결과를 먼저 확인해야 합니다. 새 답변 전송을 차단했습니다."
    : !providerReplyReady
      ? "최신 고객 메시지 연결을 확인할 수 없습니다. 문의를 새로고침해 주세요."
    : sending
      ? "답변을 안전한 작업 대기열에 등록하는 중입니다."
      : deliveryActive && delivery
        ? replyDeliveryMeta[delivery.status].detail
        : deliveryReconciliation
          ? replyDeliveryMeta.reconciliation_required.detail
          : !remoteReplyChannel
            ? "이 채널은 현재 SellerPilot 답변 API를 지원하지 않아 판매자센터에서 수동 처리해야 합니다."
            : null;

  useModalInteraction(Boolean(reviewReply), reviewDialogRef, () => setReviewReply(null), {
    initialFocusRef: reviewCloseButtonRef,
  });

  const activeDeliveryKey = [...effectiveDeliveryByTicket.entries(), ...displayTickets
    .filter((ticket) => ticket.blockingDelivery)
    .map((ticket) => [ticket.sourceId, ticket.blockingDelivery as OperationTicketDelivery] as const)]
    .filter(([, item]) => item.status === "queued" || item.status === "running")
    .map(([ticketId, item]) => `${ticketId}:${item.jobId}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!activeDeliveryKey) return;
    let cancelled = false;
    let checking = false;
    const targets = activeDeliveryKey.split("|").map((entry) => {
      const separator = entry.indexOf(":");
      return { ticketId: entry.slice(0, separator), jobId: entry.slice(separator + 1) };
    });
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const updates = await Promise.all(targets.map(async ({ ticketId, jobId }) => ({
          ticketId,
          delivery: await onDeliveryStatus(ticketId, jobId),
        })));
        if (cancelled) return;
        setDeliveryByTicket((current) => {
          const next = { ...current };
          let changed = false;
          for (const update of updates) {
            if (!update.delivery) continue;
            const previous = current[update.ticketId];
            if (previous
                && previous.jobId === update.delivery.jobId
                && previous.status === update.delivery.status
                && previous.updatedAt === update.delivery.updatedAt) continue;
            next[update.ticketId] = update.delivery;
            changed = true;
          }
          return changed ? next : current;
        });
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeDeliveryKey, onDeliveryStatus]);
  const setSelectedReply = (value: string) => {
    if (!selectedDraftTicket || composerLocked) return;
    setReplyDrafts((current) => withCsReplyDraft(current, selectedDraftTicket, value));
  };
  const sendReply = async () => {
    if (!reviewReply) return;
    const { ticket, reply: replyToSend } = reviewReply;
    const currentTicket = displayTickets.find((candidate) => candidate.sourceId === ticket.sourceId);
    if (!currentTicket
      || currentTicket.latestInboundKey !== ticket.latestInboundKey
      || currentTicket.latestMessageState !== "normal"
      || !currentTicket.replyAllowed) {
      setReviewReply(null);
      notify(currentTicket?.latestMessageState === "recalled"
        ? "최신 Lazada 메시지가 회수되어 답변을 접수하지 않았습니다."
        : "문의 내용이 변경됐거나 충돌 상태입니다. 최신 문의를 다시 확인해 주세요.");
      return;
    }
    if (sendingByTicket[ticket.sourceId]) return;
    setReviewReply(null);
    setSendingByTicket((current) => ({ ...current, [ticket.sourceId]: true }));
    try {
      const queued = await onSend(currentTicket, replyToSend);
      if (queued) {
        setDeliveryByTicket((current) => ({ ...current, [ticket.sourceId]: queued.delivery }));
        notify(queued.message);
      }
    } finally {
      setSendingByTicket((current) => ({ ...current, [ticket.sourceId]: false }));
    }
  };
  const requestReplyReview = () => {
    if (!selected || composerLocked || !reply.trim() || !remoteReplyChannel) return;
    setReviewReply({ ticket: selected, reply });
  };
  const createDraft = async () => {
    if (!selected || drafting || composerLocked) return;
    const expectedInboundKey = selected.latestInboundKey;
    setDrafting(true);
    try {
      const draft = await onDraft(selected, targetLocale);
      if (draft && selectedDraftTicket && currentInboundByTicketRef.current.get(selected.sourceId) === expectedInboundKey) {
        setReplyDrafts((current) => withCsReplyDraft(current, selectedDraftTicket, draft));
        notify(`${supportLocaleLabels[targetLocale]} CLI 답변 초안을 불러왔습니다. 외부 전송 여부를 확인해 주세요.`);
      }
    } finally {
      setDrafting(false);
    }
  };
  const updateStatus = async (status: "waiting" | "in_progress" | "resolved") => {
    if (!selected || sending || deliveryActive || deliveryReconciliation) return;
    if (remoteReplyChannel && status === "resolved" && !providerConfirmed) return;
    await onStatus(selected, status);
  };
  const unresolvedCount = channelTickets.filter((ticket) => ticket.status !== "처리 완료").length;
  const lastSuccess = syncStatus.filter((item) => item.data_type === "inquiries" && item.last_succeeded_at).sort((left, right) => Date.parse(right.last_succeeded_at ?? "") - Date.parse(left.last_succeeded_at ?? ""))[0]?.last_succeeded_at ?? null;
  const inquiryChannelStates = activeChannelKeys.map((channelKey) => {
    const rows = syncStatus.filter((item) => item.channel_key === channelKey && item.data_type === "inquiries").sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
    const state = rows[0] ?? null;
    return { channelKey, state };
  });
  const verificationNow = new Date(snapshotGeneratedAt ?? "invalid");
  const inquiryAttentionCount = csChannelAttentionCount(inquiryChannelStates.map(({ channelKey, state }) => ({
    channelKey,
    status: state?.status,
    importedCount: state?.imported_count,
    lastError: state?.last_error,
    lastSucceededAt: state?.last_succeeded_at,
    needsAttention: Boolean(
      historyBackfill
      && historyBackfill.channels.some((channel) => channel === channelKey)
      && historyBackfill.status !== "succeeded"
    ),
  })), verificationNow);
  const historyBackfillActive = historyBackfill?.status === "queued" || historyBackfill?.status === "running";
  const historyBackfillDays = historyBackfill?.historyDays ?? 30;
  const historyBackfillTitle = historyBackfill?.status === "succeeded"
    ? `${historyBackfillDays}일 문의 읽기 작업 완료`
    : historyBackfill?.status === "blocked" || historyBackfill?.blockedReason === "STATIC_EGRESS_REQUIRED"
      ? "채널 송신 경로 설정 필요"
    : historyBackfill?.status === "failed"
      ? `${historyBackfillDays}일 문의 이력 일부 실패`
      : `${historyBackfillDays}일 문의 이력 처리 중`;
  const applyFilters = (nextChannel: CsChannelFilter, nextStatus: CsStatusFilter) => {
    setMobileConversationOpen(false);
    onFilterChange(nextChannel, nextStatus, null);
  };
  const selectTicket = (ticket: DisplayTicket) => {
    setMobileConversationOpen(true);
    onFilterChange(initialChannel, resolvedInitialStatus, ticket.sourceId);
  };
  const selectedChannel = initialChannel === "all" ? null : initialChannel;
  const selectedChannelMeta = selectedChannel ? channels[selectedChannel] : null;
  const selectedSync = selectedChannel
    ? inquiryChannelStates.find((item) => item.channelKey === selectedChannel)?.state
    : null;
  return (
    <div className="page-stack cs-page">
      <section className="cs-summary"><button type="button" aria-pressed={resolvedInitialStatus === "open"} className={resolvedInitialStatus === "open" ? "active" : ""} onClick={() => applyFilters(initialChannel, "open")}><span className="metric-icon violet"><Inbox size={18} /></span><span><small>미처리 문의</small><strong>{unresolvedCount}</strong></span></button><button type="button" aria-pressed={resolvedInitialStatus === "urgent"} className={resolvedInitialStatus === "urgent" ? "active" : ""} onClick={() => applyFilters(initialChannel, "urgent")}><span className="metric-icon orange"><Clock3 size={18} /></span><span><small>긴급 문의</small><strong>{channelTickets.filter((ticket) => ticket.status === "긴급").length}</strong></span></button><button type="button" aria-pressed={resolvedInitialStatus === "all"} className={resolvedInitialStatus === "all" ? "active" : ""} onClick={() => applyFilters(initialChannel, "all")}><span className="metric-icon green"><BadgeCheck size={18} /></span><span><small>전체 문의</small><strong>{channelTickets.length}</strong></span></button><button type="button" aria-pressed={resolvedInitialStatus === "reconciliation"} className={resolvedInitialStatus === "reconciliation" ? "active" : ""} onClick={() => applyFilters(initialChannel, "reconciliation")}><span className="metric-icon blue"><Bot size={18} /></span><span><small>원장 확인 필요</small><strong>{channelTickets.filter((ticket) => ticket.replyDeliveryStatus === "reconciliation_required").length}</strong></span></button></section>
      {!selectedChannel ? <section className="panel live-empty-state large"><Inbox size={32} /><b>응대할 판매채널을 먼저 선택하세요.</b><small>왼쪽 채널을 누르면 그 채널 문의만 표시됩니다.</small></section> : <>
      <section className="panel-heading table-title cs-live-heading"><div><span className="panel-kicker">{selectedChannelMeta?.market}</span><h3>{selectedChannelMeta?.name} 문의</h3><small>{channelLiveCaption(selectedChannel, selectedSync)}</small></div><div className="cs-filter-actions"><button className="filter-button" type="button" onClick={() => void onSync()} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{syncing ? "조회 중" : "이 채널 새로고침"}</button></div></section>
      {historyBackfill && selectedChannel && historyBackfill.channels.includes(selectedChannel as "coupang" | "elevenst" | "smartstore") ? <section className={`panel cs-history-backfill ${historyBackfill.status}`} role="status"><div className="cs-history-backfill-heading"><span className="metric-icon blue">{historyBackfillActive ? <LoaderCircle className="spin" size={17} /> : historyBackfill.status === "succeeded" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}</span><span><b>{historyBackfillTitle}</b></span><em>{historyBackfill.progressPercent}%</em></div></section> : null}
      {channelTickets.length === 0 ? <section className="panel live-empty-state large"><Inbox size={32} /><b>이 채널에 표시할 문의가 없습니다.</b><small>{channelLiveCaption(selectedChannel, selectedSync)}</small>{selectedChannel === "shopee" ? <small>상세 문의 양식: /cs/ask/shopee</small> : null}<button className="ghost-button" type="button" onClick={() => void onSync()} disabled={syncing}>문의 가져오기</button></section> :
      <section className={`cs-workspace panel ${mobileConversationOpen || initialTicketId ? "mobile-conversation-open" : ""}`}>
        <aside className="ticket-list"><div className="ticket-list-header"><div className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="고객명, 문의번호, 내용 검색" aria-label="문의 검색" /></div></div><div className="ticket-tabs" role="tablist" aria-label="문의 처리 상태">{([{ key: "waiting", label: "미답변" }, { key: "in_progress", label: "처리 중" }, { key: "resolved", label: "완료" }] as const).map((tab) => <button type="button" role="tab" aria-selected={resolvedInitialStatus === tab.key} key={tab.key} className={resolvedInitialStatus === tab.key ? "active" : ""} onClick={() => applyFilters(initialChannel, tab.key)}>{tab.label}{tab.key === "waiting" && <span>{channelTickets.filter((ticket) => csTicketMatchesFilter(ticket, "waiting")).length}</span>}</button>)}</div>{filteredTickets.map((ticket) => { const ticketDelivery = effectiveDeliveryByTicket.get(ticket.sourceId) ?? ticket.blockingDelivery ?? null; const deliveryMeta=ticketDelivery?replyDeliveryPresentation(ticketDelivery):null; return <button type="button" key={ticket.sourceId} className={`ticket-item ${selected?.sourceId === ticket.sourceId ? "active" : ""}`} onClick={() => selectTicket(ticket)}><div className="ticket-avatar">{ticket.customer.charAt(0)}</div><div><div><b>{ticket.customer}</b><small>{ticket.time}</small></div><span><ChannelMark code={ticketChannelCodes[ticket.channel] ?? "Q"} size="sm" />{ticket.subject}</span><p>{ticket.preview}</p><span className="ticket-state-row"><StatusBadge status={ticket.replyDeliveryStatus === "reconciliation_required" ? "원장 확인 필요" : ticket.status} />{ticket.latestMessageState === "recalled" ? <StatusBadge status="메시지 회수" /> : ticket.latestMessageState === "conflict_review_required" ? <StatusBadge status="원문 충돌 검토" /> : null}{ticketDelivery&&deliveryMeta ? <em className={`ticket-delivery-state ${deliveryMeta.tone}`}>{ticket.blockingDelivery?.jobId === ticketDelivery.jobId ? `이전 메시지 · ${deliveryMeta.label}` : deliveryMeta.label}</em> : null}</span></div></button>; })}{filteredTickets.length === 0 && <div className="ticket-list-empty"><Inbox size={24} /><b>이 조건의 문의가 없습니다.</b><small>다른 상태나 채널을 선택해 주세요.</small></div>}</aside>
        {!selected ? <article className="conversation conversation-empty"><div className="live-empty-state"><MessageCircleMore size={30} /><b>표시할 문의를 선택해 주세요.</b><small>목록이 비어 있으면 다른 상태 또는 채널 필터를 선택할 수 있습니다.</small></div></article> : <>
        <article className="conversation"><header><div><button className="mobile-back" type="button" aria-label="문의 목록으로 돌아가기" onClick={() => { setMobileConversationOpen(false); onFilterChange(initialChannel, resolvedInitialStatus, null); }}><ArrowLeft size={16} /></button><span className="ticket-avatar large">{selected.customer.charAt(0)}</span><span><b>{selected.customer}</b><small>{selected.channel} · {selected.id}</small></span></div><div className="cs-ticket-status-control">{completed ? <span className="cs-status-locked"><CheckCircle2 size={14} />처리 완료</span> : <label className="filter-select compact"><span className="sr-only">문의 처리 상태</span><select disabled={sending || deliveryActive || deliveryReconciliation} value={selected.status === "처리 중" ? "in_progress" : "waiting"} onChange={(event) => void updateStatus(event.target.value as "waiting" | "in_progress" | "resolved")}><option value="waiting">답변 대기</option><option value="in_progress">처리 중</option>{!remoteReplyChannel ? <option value="resolved">수동 처리 완료</option> : providerConfirmed ? <option value="resolved">채널 확인 후 처리 완료</option> : null}</select><ChevronDown size={14} /></label>}</div></header>
          <div className="conversation-body"><div className={`order-context ${selected.orderId || selected.externalOrderReference ? "" : "order-context-unlinked"}`}><Package size={16} /><span><small>{selected.ticketKind === "after_sales" ? "반품·환불 주문" : "문의 주문"}</small><b>{selected.orderId ?? selected.externalOrderReference ?? "주문 연결 필요"}</b></span><div className="order-context-meta"><em>{selected.orderId ? "내부 원장" : selected.externalOrderReference ? "채널 참조" : "미연결"}</em><StatusBadge status={selected.orderId || selected.externalOrderReference ? "식별값 확인" : "확인 필요"} /><small>{selected.orderId || selected.externalOrderReference ? "저장된 식별값만 표시합니다." : "고객명만으로 주문을 추정하지 않습니다."}</small></div></div><ConversationTimeline key={selected.sourceId} ticketId={selected.sourceId} refreshKey={`${selected.replyDeliveryStatus}:${selected.time}`} authenticatedFetch={authenticatedFetch} /></div>
          {delivery ? (()=>{const deliveryMeta=replyDeliveryPresentation(delivery);return <section className={`cs-delivery-banner ${deliveryMeta.tone}`} role="status" aria-live="polite"><span>{delivery.status === "succeeded" ? <CheckCircle2 size={18} /> : delivery.status === "failed" || delivery.status === "cancelled" || delivery.status === "reconciliation_required" ? <AlertTriangle size={18} /> : <LoaderCircle className={delivery.status === "running" ? "spin" : ""} size={18} />}</span><div><b>{deliveryMeta.label}</b><p>{delivery.channel === "qoo10" && delivery.qoo10S3ReadbackState ? deliveryMeta.detail : delivery.reconciliationReason ?? delivery.safeMessage ?? deliveryMeta.detail}</p><small>작업 {delivery.jobId.slice(0, 8)} · {relativeTime(delivery.updatedAt)}</small></div>{delivery.status === "reconciliation_required" || (delivery.channel === "qoo10" && delivery.qoo10S3ReadbackState && delivery.qoo10AutomaticResendAllowed === false) ? <em>자동 재전송 차단</em> : null}</section>;})() : null}
          <footer className={`reply-composer ${composerLocked ? "is-locked" : ""}`}><div className="ai-draft-head"><span><Sparkles size={14} />{composerLockReason ?? "문의 원문을 바탕으로 검토용 초안을 생성합니다."}</span><button type="button" disabled={drafting || composerLocked} onClick={() => void createDraft()}>{drafting ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{drafting ? "CLI 작성 중" : "CLI 초안 생성"}</button></div><label className="reply-label" htmlFor={`cs-reply-${selected.sourceId}`}><span>답변 내용</span><small>{reply.length.toLocaleString()} / 4,000자</small></label><textarea id={`cs-reply-${selected.sourceId}`} value={reply} maxLength={4000} disabled={composerLocked} onChange={(event) => setSelectedReply(event.target.value)} placeholder={remoteReplyChannel ? "판매채널로 전송할 실제 답변을 입력하세요." : "판매자센터에서 수동 처리할 채널입니다."} /><p className={`reply-composer-help ${composerLocked ? "locked" : ""}`}>{composerLockReason ?? "판매채널 성공 응답이 원장에 기록된 뒤에만 처리 완료로 표시됩니다."}</p><div><span><label className="reply-tool-select"><Languages size={15} /><span className="sr-only">답변 언어</span><select value={targetLocale} disabled={composerLocked} onChange={(event) => setTargetLocale(event.target.value as SupportLocale)}>{Object.entries(supportLocaleLabels).map(([locale, label]) => <option key={locale} value={locale}>{label}</option>)}</select><ChevronDown size={13} /></label><label className="reply-tool-select"><FileText size={15} /><span className="sr-only">답변 템플릿</span><select defaultValue="" disabled={composerLocked} onChange={(event) => { const template = supportReplyTemplates.find((item) => item.label === event.target.value); if (template) setSelectedReply(template.value); event.target.value = ""; }}><option value="">템플릿</option>{supportReplyTemplates.map((template) => <option value={template.label} key={template.label}>{template.label}</option>)}</select><ChevronDown size={13} /></label></span><button type="button" className="send-button" disabled={composerLocked || !reply.trim()} onClick={requestReplyReview}>{sending || deliveryActive ? <LoaderCircle className="spin" size={15} /> : deliveryReconciliation ? <AlertTriangle size={15} /> : <Send size={15} />}{sending ? "대기열 등록 중" : delivery?.status === "queued" ? "답변 처리 대기" : delivery?.status === "running" ? "판매채널 처리 중" : deliveryReconciliation ? "전송 여부 확인 필요" : completed ? "처리 완료" : remoteReplyChannel ? "검토 후 답변 전송" : "채널 답변 API 미지원"}</button></div></footer>
        </article>
        <aside className="customer-panel"><div className="customer-profile"><div className="ticket-avatar xl">{selected.customer.charAt(0)}</div><h4>{selected.customer}</h4><span>{selected.channel} 구매자</span></div><div className="customer-facts"><div><small>문의 연결 주문</small><b>{selected.orderId ? "원장 연결" : selected.externalOrderReference ? "채널 참조" : "확인 필요"}</b></div><div><small>데이터 출처</small><b>{selected.ticketKind === "after_sales" ? "After-sales 원문" : "실제 채널 API"}</b></div></div><div className="detail-section"><h5>연결 주문</h5><div className="mini-order"><span className="tiny-thumb"><Package size={17} /></span><span><b>{selected.orderId ?? selected.externalOrderReference ?? "주문 연결 필요"}</b><small>{selected.orderId || selected.externalOrderReference ? "저장된 식별값만 표시합니다." : "고객명으로 주문을 추측하지 않습니다."}</small></span></div><dl><div><dt>내부 주문 ID</dt><dd>{selected.orderId ?? "-"}</dd></div><div><dt>채널 주문 참조</dt><dd>{selected.externalOrderReference ?? "-"}</dd></div><div><dt>공급자 상태</dt><dd>{selected.providerStatus === "waiting" ? "고객 응답 대기" : selected.providerStatus === "answered" ? "채널 답변 확인" : selected.providerStatus === "closed" ? "채널 종료" : "확인 전"}</dd></div></dl></div><div className="detail-section"><h5>응대 원칙</h5><p className="ai-guide"><Bot size={16} />{selected.orderId || selected.externalOrderReference ? "표시된 주문 식별값과 판매채널 원문을 함께 확인하세요." : "주문 연결 전에는 주문·배송 상태를 단정하지 마세요."}</p></div></aside>
        </>}
      </section>}
      </>}
      {reviewReply ? <div className="shipment-dialog-overlay cs-reply-review-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !sendingByTicket[reviewReply.ticket.sourceId]) setReviewReply(null); }}><section ref={reviewDialogRef} tabIndex={-1} className="shipment-dialog cs-reply-review-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-reply-review-title"><header><div><span className="metric-icon violet"><MessageCircleMore size={18} /></span><span><h3 id="cs-reply-review-title">판매채널 답변 최종 검토</h3><small>대상 고객과 문의번호를 다시 확인하세요.</small></span></div><button ref={reviewCloseButtonRef} className="icon-only-button" type="button" aria-label="답변 검토 창 닫기" disabled={Boolean(sendingByTicket[reviewReply.ticket.sourceId])} onClick={() => setReviewReply(null)}><X size={17} /></button></header><dl className="cs-reply-review-facts"><div><dt>판매채널</dt><dd>{reviewReply.ticket.channel}</dd></div><div><dt>고객</dt><dd>{reviewReply.ticket.customer}</dd></div><div><dt>문의번호</dt><dd className="mono">{reviewReply.ticket.id}</dd></div><div><dt>전달 방식</dt><dd>안전한 worker 대기열</dd></div></dl><div className="cs-reply-review-copy"><small>실제 전송할 답변</small><p>{reviewReply.reply}</p></div><div className="shipment-warning"><AlertTriangle size={16} /><span><b>확인 버튼을 누르면 실제 판매채널 작업 대기열에 등록됩니다.</b><small>전송 결과가 불확실하면 자동 재시도하지 않고 확인 필요 상태로 격리합니다.</small></span></div><footer><button type="button" className="credential-secondary" disabled={Boolean(sendingByTicket[reviewReply.ticket.sourceId])} onClick={() => setReviewReply(null)}>수정하기</button><button type="button" className="publish-execute" disabled={Boolean(sendingByTicket[reviewReply.ticket.sourceId])} onClick={() => void sendReply()}><Send size={15} />대상 확인 후 대기열 등록</button></footer></section></div> : null}
    </div>
  );
}
