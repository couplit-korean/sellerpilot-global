import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import {
  ChannelGatewayReconciliationRequiredError,
  executeInquiryReplyViaChannelGateway,
} from "../../../../../lib/channels/gateway";
import { buildInquiryReplyArguments, supportsInquiryReply } from "../../../../../lib/channels/inquiry-reply";
import type { ActiveChannelKey } from "../../../../../lib/channels/catalog";
import { ebayAsqMarketplaceId } from "../../../../../lib/channels/ebay-asq";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  ticketId: z.string().uuid(),
  reply: z.string().trim().min(1).max(4000),
});

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("COUPANG_WING_USER_ID_MISSING")) return "쿠팡 API Vault에 WING 실사용자 ID를 입력해 주세요.";
  if (message.startsWith("INQUIRY_REPLY_INVALID:")) return "채널 문의 원문 식별값이 없어 실제 답변을 보낼 수 없습니다. 문의를 새로고침해 주세요.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_LINEAGE_UNBOUND")) return "이 문의를 수집한 판매자 계정 연결을 확인할 수 없습니다. 문의를 새로고침한 뒤 다시 시도해 주세요.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_RECONCILIATION_REQUIRED")) return "이 문의의 이전 답변 접수 여부를 먼저 판매자센터에서 확인해야 합니다.";
  if (/CREDENTIALS_MISSING|TOKEN_EXCHANGE_FAILED|ACCESS_TOKEN_MISSING/.test(message)) return "판매채널 인증값이 누락됐거나 만료됐습니다.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_CONFLICT")) return "이 문의에는 다른 답변이 이미 전송 중이거나 전송 완료됐습니다. 판매자센터와 문의 상태를 확인해 주세요.";
  if (message.includes("EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS")) return "eBay 판매자 계정의 분당 답변 한도에 도달했습니다. 60초 뒤 다시 시도해 주세요.";
  if (message.includes("EBAY_ASQ_PROVIDER_COOLDOWN_100_SECONDS")) return "eBay가 답변 호출을 일시 차단했습니다. 마지막 한도 오류로부터 100초 뒤 다시 시도해 주세요.";
  if (message.includes("CHANNEL_GATEWAY_TIMEOUT")) return "판매채널 답변 작업이 아직 끝나지 않았습니다. 잠시 후 문의 상태를 다시 확인해 주세요.";
  if (message.includes("CHANNEL_GATEWAY")) return "고정 IP 채널 작업자에서 답변을 처리하지 못했습니다.";
  return "판매채널에서 CS 답변을 처리하지 못했습니다.";
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "CS 답변 내용을 확인해 주세요." }, { status: 400 });

  const { data: rows, error: contextError } = await admin.userClient.rpc("sellerpilot_get_ticket_reply_dispatch_context", {
    p_id: parsed.data.ticketId,
  });
  const ticket = Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
    ? rows[0] as Record<string, unknown>
    : null;
  const channel = typeof ticket?.channel_key === "string" ? ticket.channel_key as ActiveChannelKey : null;
  const environment = ticket?.environment === "sandbox" || ticket?.environment === "production"
    ? ticket.environment
    : null;
  const externalTicketId = typeof ticket?.external_ticket_id === "string" ? ticket.external_ticket_id : "";
  const replyContext = ticket?.reply_context && typeof ticket.reply_context === "object" && !Array.isArray(ticket.reply_context)
    ? ticket.reply_context as Record<string, unknown>
    : {};
  let marketplaceBound = false;
  try {
    marketplaceBound = Boolean(ebayAsqMarketplaceId(replyContext.marketplaceId));
  } catch {
    marketplaceBound = false;
  }
  const ebayRelease = {
    providerCertified: ticket?.seller_account_key_source === "provider_certified_v1",
    sellerAccountVerified: typeof ticket?.seller_account_verified_at === "string"
      && !Number.isNaN(Date.parse(ticket.seller_account_verified_at)),
    marketplaceBound,
  };
  if (contextError || !ticket || !channel || !environment || !supportsInquiryReply(channel, environment, ebayRelease)) {
    return NextResponse.json({ message: "이 판매채널은 SellerPilot에서 실제 CS 답변 전송을 지원하지 않습니다." }, { status: 409 });
  }
  if (ticket.status === "resolved") {
    return NextResponse.json({ message: "이미 처리 완료된 문의입니다. 중복 답변은 전송하지 않았습니다." }, { status: 409 });
  }

  try {
    const replyArguments = buildInquiryReplyArguments(channel, externalTicketId, parsed.data.reply, replyContext);
    const result = await executeInquiryReplyViaChannelGateway({
      serviceClient: admin.serviceClient,
      ticketId: parsed.data.ticketId,
      channel,
      reply: parsed.data.reply,
      arguments: replyArguments,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.safeMessage }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
    }

    return NextResponse.json({ ok: true, channel, environment, safeMessage: result.safeMessage }, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof ChannelGatewayReconciliationRequiredError) {
      return NextResponse.json({
        message: "판매채널이 답변을 받았을 가능성이 있어 자동 재전송을 차단했습니다. 판매자센터에서 실제 답변 여부를 확인해 주세요.",
        remoteSent: true,
        reconciliationRequired: true,
      }, {
        status: 409,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json({ message: failureMessage(error) }, {
      status: /EBAY_ASQ_(?:RATE_LIMITED_75_PER_60_SECONDS|PROVIDER_COOLDOWN_100_SECONDS)/.test(message)
        ? 429
        : /CHANNEL_GATEWAY_REPLY_(?:CONFLICT|LINEAGE_UNBOUND|RECONCILIATION_REQUIRED)/.test(message)
          ? 409
          : 422,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
}
