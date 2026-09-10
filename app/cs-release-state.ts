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

const remoteCsReplyChannels = new Set(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay"]);

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
  qoo10: { subject: "MSG·HELP·ITEM 문의·취소·반품·교환 클레임", integrated: true, replyLabel: "답변: 일반 문의만 보안 게이트웨이 원격 전송 · 클레임은 읽기 전용 · 별도 리뷰 댓글은 공식 QAPI 미제공" },
  shopee: { subject: "상품 후기·반품/환불", integrated: true, replyLabel: "답변: 상품 후기는 reply_comment 전송 · 반품/환불은 읽기 전용 · Buyer Chat은 Seller Centre 확인" },
  lazada: { subject: "Lazada IM", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  coupang: { subject: "상품·콜센터 문의·취소·반품·교환", integrated: true, replyLabel: "답변: 상품·콜센터 문의만 보안 게이트웨이 원격 전송 · 취소·반품·교환은 읽기 전용" },
  elevenst: { subject: "상품 Q&A", integrated: true, replyLabel: "답변: 게시글 번호·상품 번호·최신 문의 세대가 일치할 때만 보안 게이트웨이 원격 전송 · 셀러톡·긴급알리미·리뷰는 별도" },
  smartstore: { subject: "상품·고객 문의", integrated: true, replyLabel: "답변: 보안 게이트웨이 원격 전송" },
  ebay: { subject: "eBay ASQ·Trading·Commerce 메시지", integrated: true, replyLabel: "답변: ASQ 또는 Commerce 중 검증된 계정·문의 계보만 보안 게이트웨이 전송" },
  temu: { subject: "반품·환불 작업", integrated: true, replyLabel: "답변: 내부 초안만 · 구매자 채팅 미연동" },
};

export type CsChannelVerification = {
  readLabel: string;
  replyLabel: string;
  badge: string;
  tone: "passed" | "failed" | "unsupported";
};

const POLLING_FRESHNESS_LIMIT_MS = 15 * 60 * 1_000;

export function csChannelHistoryCoverageLabel(channelKey: ActiveChannelKey) {
  const labels: Record<ActiveChannelKey, string> = {
    qoo10: "과거 범위: 일반 문의 최근 7일 상태별 조회 + 클레임 현재 6일·매일 최근 30일 자동 재검사 · QSM 리뷰는 별도 수동 확인",
    shopee: "과거 범위: 8개 OAuth 숍의 상품 후기 전 페이지 + 반품/환불 15일 이하 분할 조회 · Buyer Chat 공개 API 계약 미확보",
    lazada: "과거 범위: 공식 bootstrap 최근 1개월·최대 3,000건 · Push 상태 별도 확인",
    coupang: "과거 범위: 30일을 6일 이하 5개 창으로 분할 · 상품·콜센터 문의와 취소·반품·교환을 독립 수집 · 매일 8개 범위 자동 재검사",
    elevenst: "과거 범위: 상품 Q&A를 공식 최대 7일 범위로 분할 · 30일 기간 선택 수집과 매일 최근 30일 자동 재검사 · 셀러톡·긴급알리미·리뷰는 별도",
    smartstore: "과거 범위: 30일 단위 기간 선택 수집 · 매일 최근 30일 자동 재검사",
    ebay: "과거 범위: ASQ 최근 14일·Trading Inbox 최근 6일 자동 조회·Commerce 회원 대화 최근 6일 자동 조회 · 매일 1년을 31일 이하 창으로 복구하고 eBay 시스템 대화도 전 페이지 재검사 · Commerce는 commerce.message 동의 필요",
    temu: "과거 범위: 반품·환불 현재 14일 + 일일 30일 목록·상세 조회 · 앱 활성/심사/고정 송신 경로 필요 · 구매자 채팅 미연동",
  };
  return labels[channelKey];
}

export function csChannelVerification(
  channelKey: ActiveChannelKey,
  status: CsInquirySyncStatus | null | undefined,
  importedCount = 0,
  lastError: string | null = null,
  lastSucceededAt: string | null = null,
  now = new Date(),
): CsChannelVerification {
  const capability = channelReadCapabilities[channelKey];
  if (!capability.integrated || status === "unsupported") {
    return capability.integrated
      ? { readLabel: `${capability.subject} 수신 연결 조건 미충족`, replyLabel: capability.replyLabel, badge: "연결 확인 필요", tone: "unsupported" }
      : { readLabel: `${capability.subject} 수신 API 미연동`, replyLabel: capability.replyLabel, badge: "수신 미연결", tone: "unsupported" };
  }
  if (status === "passed") {
    const succeededAt = lastSucceededAt ? Date.parse(lastSucceededAt) : Number.NaN;
    if (!Number.isFinite(succeededAt)) return {
      readLabel: `${capability.subject} 조회 성공 시각 미확인 · 누적 원장 ${Math.max(0, importedCount)}건`,
      replyLabel: capability.replyLabel,
      badge: "시각 확인 필요",
      tone: "unsupported",
    };
    if (channelKey === "lazada") return {
      readLabel: `${capability.subject} 이력 조회 통과 · Push 수신 상태 별도 확인 · 누적 원장 ${Math.max(0, importedCount)}건`,
      replyLabel: capability.replyLabel,
      badge: "Push 확인 필요",
      tone: "unsupported",
    };
    const age = now.getTime() - succeededAt;
    if (!Number.isFinite(now.getTime()) || age < -5 * 60 * 1_000 || age > POLLING_FRESHNESS_LIMIT_MS) return {
      readLabel: `${capability.subject} 최근 조회 지연 · 누적 원장 ${Math.max(0, importedCount)}건`,
      replyLabel: capability.replyLabel,
      badge: "수집 지연",
      tone: "failed",
    };
    return {
      readLabel: `${capability.subject} 최근 조회 작업 통과 · 누적 원장 ${Math.max(0, importedCount)}건`,
      replyLabel: capability.replyLabel,
      badge: "최근 조회 통과",
      tone: "passed",
    };
  }
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
  lastSucceededAt?: string | null;
  needsAttention?: boolean;
}[], now = new Date()) {
  return new Set(states.filter((state) => state.needsAttention || csChannelVerification(
    state.channelKey,
    state.status,
    state.importedCount,
    state.lastError,
    state.lastSucceededAt,
    now,
  ).tone !== "passed").map((state) => state.channelKey)).size;
}
