import type { ActiveChannelKey } from "../lib/channels/catalog";

export type CsReplyTicket = {
  sourceId: string;
  replyDraft: string | null;
};

export type CsReplyDrafts = Readonly<Record<string, string>>;

export function selectedCsTicket<T extends { sourceId: string }>(tickets: readonly T[], selectedSourceId: string | null) {
  if (selectedSourceId) {
    return tickets.find((ticket) => ticket.sourceId === selectedSourceId) ?? null;
  }
  return tickets[0] ?? null;
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
    | { ticketId: string; expectedInboundKey: string; reply: string }
    | { action: "ticket_update"; id: string; status: "in_progress"; expectedInboundKey: string | null; replyDraft: string };
  completionMessage: string;
  remote: boolean;
};

const remoteCsReplyChannels = new Set(["qoo10", "lazada", "coupang", "smartstore", "ebay"]);

export function isRemoteCsReplyChannel(channelKey: string) {
  return remoteCsReplyChannels.has(channelKey);
}

export function csReplySavePlan(
  ticketId: string,
  channelKey: string,
  reply: string,
  expectedInboundKey: string | null,
): CsReplySavePlan {
  if (isRemoteCsReplyChannel(channelKey)) {
    if (!expectedInboundKey) throw new Error("문의 세대를 확인한 뒤 답변을 전송해 주세요.");
    return {
      endpoint: "/api/admin/cs/reply",
      body: { ticketId, expectedInboundKey, reply },
      completionMessage: "판매채널에 답변을 전송하고 처리 완료로 기록했습니다.",
      remote: true,
    };
  }
  return {
    endpoint: "/api/operations/snapshot",
    body: { action: "ticket_update", id: ticketId, status: "in_progress", expectedInboundKey, replyDraft: reply },
    completionMessage: "외부 채널에는 전송하지 않았습니다. 내부 답변 초안을 처리 중 상태로 저장했습니다.",
    remote: false,
  };
}

export type CsInquirySyncStatus = "never" | "queued" | "running" | "passed" | "failed" | "unsupported";

const channelReadCapabilities: Record<ActiveChannelKey, { subject: string; integrated: boolean; replyLabel: string }> = {
  qoo10: { subject: "상품 문의", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  shopee: { subject: "구매자 채팅", integrated: false, replyLabel: "답변: 내부 초안만 · Chat API 미연동" },
  lazada: { subject: "Lazada IM", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  coupang: { subject: "상품·콜센터 문의", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  elevenst: { subject: "상품 Q&A·긴급알리미", integrated: false, replyLabel: "답변: 미연결 · 공식 상세 계약·서비스 권한 검증 전" },
  smartstore: { subject: "상품·고객 문의", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  ebay: { subject: "eBay 상품 문의(ASQ)", integrated: true, replyLabel: "답변: 검증된 계정·사이트·문의 계보만 보안 게이트웨이 전송" },
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
  if (channelKey === "elevenst" && (!capability.integrated || status === "unsupported")) {
    return {
      readLabel: `${capability.subject} 수신 연동 전`,
      replyLabel: capability.replyLabel,
      badge: "수신 미연결",
      tone: "unsupported",
    };
  }
  if (!capability.integrated || status === "unsupported") {
    return capability.integrated
      ? { readLabel: `${capability.subject} 수신 연결 조건 미충족`, replyLabel: capability.replyLabel, badge: "연결 확인 필요", tone: "unsupported" }
      : { readLabel: `${capability.subject} 수신 API 미연동`, replyLabel: capability.replyLabel, badge: "수신 미연결", tone: "unsupported" };
  }
  if (status === "passed") return {
    readLabel: `${capability.subject} 최근 조회 작업 통과 · 누적 원장 ${Math.max(0, importedCount)}건`,
    replyLabel: capability.replyLabel,
    badge: "최근 조회 통과",
    tone: "passed",
  };
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

export function csChannelAttentionCount(states: readonly {
  channelKey: ActiveChannelKey;
  status: CsInquirySyncStatus | null | undefined;
  importedCount?: number;
  lastError?: string | null;
  needsAttention?: boolean;
}[]) {
  return new Set(states.filter((state) => state.needsAttention || csChannelVerification(
    state.channelKey,
    state.status,
    state.importedCount,
    state.lastError,
  ).tone !== "passed").map((state) => state.channelKey)).size;
}
