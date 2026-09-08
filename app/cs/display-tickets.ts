import type { CsSnapshot } from "../../lib/cs/snapshot";
import type { DisplayTicket } from "./workspace-contracts";
const ticketStatusLabel = {
  urgent: "긴급",
  waiting: "답변 대기",
  in_progress: "처리 중",
  resolved: "처리 완료",
} as const;

const channelNameByKey: Record<string, string> = {
  qoo10: "Qoo10",
  shopee: "Shopee",
  lazada: "Lazada",
  coupang: "쿠팡",
  elevenst: "11번가",
  smartstore: "네이버 스마트스토어",
  ebay: "eBay",
  temu: "Temu",
};

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(value));
}


export function displayCsTickets(snapshot: CsSnapshot | null): DisplayTicket[] {
 return snapshot?.tickets.map((ticket) => ({
    sourceId: ticket.id,
    id: ticket.externalTicketId,
    channelKey: ticket.channelKey,
    customer: ticket.customerName,
    channel: channelNameByKey[ticket.channelKey] ?? ticket.channelKey,
    subject: ticket.subject,
    originalMessage: ticket.message,
    preview: ticket.translatedMessage ?? ticket.message,
    replyDraft: ticket.replyDraft,
    replyDeliveryStatus: ticket.blockingDelivery?.status === "reconciliation_required"
      ? "reconciliation_required"
      : ticket.replyDeliveryStatus,
    replyDeliveryError: ticket.replyDeliveryError,
    orderId: ticket.orderId,
    externalOrderReference: ticket.externalOrderReference ?? null,
    providerStatus: ticket.providerStatus ?? "unknown",
    latestInboundKey: ticket.latestInboundKey ?? null,
    ticketKind: ticket.ticketKind ?? "conversation",
    latestMessageState: ticket.latestMessageState ?? "normal",
    replyAllowed: ticket.replyAllowed !== false,
    remoteReplySupported: ticket.providerContext?.replySupported !== false,
    delivery: ticket.delivery ?? null,
    blockingDelivery: ticket.blockingDelivery ?? null,
    time: relativeTime(ticket.receivedAt),
    status: ticketStatusLabel[ticket.status],
  })) ?? [];
}
