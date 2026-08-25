import type { ActiveChannelKey } from "../lib/channels/catalog";

export type CsReplyTicket = {
  sourceId: string;
  replyDraft: string | null;
};

export type CsReplyDrafts = Readonly<Record<string, string>>;

export function selectedCsTicket<T extends { sourceId: string }>(tickets: readonly T[], selectedSourceId: string | null) {
  return tickets.find((ticket) => ticket.sourceId === selectedSourceId)
    ?? tickets[0]
    ?? null;
}

export function csReplyDraftValue(drafts: CsReplyDrafts, ticket: CsReplyTicket | null) {
  if (!ticket) return "";
  return Object.hasOwn(drafts, ticket.sourceId)
    ? drafts[ticket.sourceId] ?? ""
    : ticket.replyDraft ?? "";
}

export function withCsReplyDraft(drafts: CsReplyDrafts, ticket: CsReplyTicket, value: string): CsReplyDrafts {
  return { ...drafts, [ticket.sourceId]: value };
}

export type CsReplySavePlan = {
  endpoint: "/api/admin/cs/reply" | "/api/operations/snapshot";
  body:
    | { ticketId: string; reply: string }
    | { action: "ticket_update"; id: string; status: "in_progress"; replyDraft: string };
  completionMessage: string;
  remote: boolean;
};

export function csReplySavePlan(ticketId: string, channelKey: string, reply: string): CsReplySavePlan {
  if (["qoo10", "lazada", "coupang", "smartstore"].includes(channelKey)) {
    return {
      endpoint: "/api/admin/cs/reply",
      body: { ticketId, reply },
      completionMessage: "판매채널에 답변을 전송하고 처리 완료로 기록했습니다.",
      remote: true,
    };
  }
  return {
    endpoint: "/api/operations/snapshot",
    body: { action: "ticket_update", id: ticketId, status: "in_progress", replyDraft: reply },
    completionMessage: "외부 채널에는 전송하지 않았습니다. 내부 답변 초안을 처리 중 상태로 저장했습니다.",
    remote: false,
  };
}

type CsInquirySyncStatus = "never" | "queued" | "running" | "passed" | "failed" | "unsupported";

const channelReadCapabilities: Record<ActiveChannelKey, { subject: string; integrated: boolean; replyLabel: string }> = {
  qoo10: { subject: "상품 문의", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  shopee: { subject: "구매자 채팅", integrated: false, replyLabel: "답변: 내부 초안만 · Chat API 미연동" },
  lazada: { subject: "Lazada IM", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  coupang: { subject: "상품·콜센터 문의", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  elevenst: { subject: "판매자 문의", integrated: false, replyLabel: "답변: 현재 API 미지원 · 판매자센터 처리" },
  smartstore: { subject: "상품·고객 문의", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  ebay: { subject: "Seller Hub 문의", integrated: false, replyLabel: "답변: 현재 API 미지원 · Seller Hub 처리" },
  temu: { subject: "반품·환불 작업", integrated: true, replyLabel: "답변: 내부 초안만 · 구매자 채팅 미연동" },
};

export type CsChannelVerification = {
  readLabel: string;
  replyLabel: string;
  badge: string;
  tone: "passed" | "failed" | "unsupported";
};

export function csChannelVerification(
  channelKey: ActiveChannelKey,
  status: CsInquirySyncStatus | null | undefined,
  importedCount = 0,
  lastError: string | null = null,
): CsChannelVerification {
  const capability = channelReadCapabilities[channelKey];
  if (!capability.integrated || status === "unsupported") {
    return { readLabel: `${capability.subject} 수신 API 미연동`, replyLabel: capability.replyLabel, badge: "수신 미지원", tone: "unsupported" };
  }
  if (status === "passed") return { readLabel: `${capability.subject} 조회 성공 · 원장 ${Math.max(0, importedCount)}건`, replyLabel: capability.replyLabel, badge: "조회 성공", tone: "passed" };
  if (status === "failed") {
    const lazadaPermissionBlocked = channelKey === "lazada"
      && /(?:does not have permission|permission[^\n]{0,80}(?:api|access)|api[^\n]{0,80}permission)/i.test(lastError ?? "");
    return {
      readLabel: lazadaPermissionBlocked ? "Lazada IM 조회 거절 · 운영 앱 Buyer IM 권한 필요" : `${capability.subject} 조회 실패`,
      replyLabel: capability.replyLabel,
      badge: lazadaPermissionBlocked ? "권한 필요" : "조회 실패",
      tone: "failed",
    };
  }
  if (status === "queued") return { readLabel: `${capability.subject} 조회 대기`, replyLabel: capability.replyLabel, badge: "조회 대기", tone: "unsupported" };
  if (status === "running") return { readLabel: `${capability.subject} 조회 중`, replyLabel: capability.replyLabel, badge: "조회 중", tone: "unsupported" };
  return {
    readLabel: `${capability.subject} 조회 검증 전`,
    replyLabel: capability.replyLabel,
    badge: "검증 전",
    tone: "unsupported",
  };
}
