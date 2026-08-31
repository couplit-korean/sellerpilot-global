import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { enqueueInquiryReplyViaChannelGateway } from "../../../../../lib/channels/gateway";
import { buildInquiryReplyArguments, supportsInquiryReply } from "../../../../../lib/channels/inquiry-reply";
import type { ActiveChannelKey } from "../../../../../lib/channels/catalog";
import { ebayAsqMarketplaceId } from "../../../../../lib/channels/ebay-asq";
import {
  configuredServerlessStaticEgressChannels,
  hasServerlessStaticEgressFor,
  SERVERLESS_STATIC_EGRESS_REQUIRED,
} from "../../../../../lib/channels/serverless-static-egress";

export const runtime = "nodejs";

const schema = z.object({
  ticketId: z.string().uuid(),
  expectedInboundKey: z.string().min(1).max(500),
  reply: z.string().trim().min(1).max(4000),
});

const statusQuerySchema = z.object({
  ticketId: z.string().uuid(),
  jobId: z.string().uuid(),
});

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function noStoreAdminError(response: NextResponse) {
  const cloned = response.clone();
  cloned.headers.set("cache-control", noStoreHeaders["cache-control"]);
  return cloned;
}

function contextRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value) && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])) {
    return value[0] as Record<string, unknown>;
  }
  return null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function loadTicketReplyContext(
  admin: Exclude<Awaited<ReturnType<typeof authenticateAdminRequest>>, NextResponse>,
  ticketId: string,
): Promise<Record<string, unknown> | null> {
  const [current, dispatch] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_ticket_reply_context_v2", { p_id: ticketId }),
    admin.userClient.rpc("sellerpilot_get_ticket_reply_dispatch_context", { p_id: ticketId }),
  ]);
  const currentRecord = current.error ? null : contextRecord(current.data);
  const dispatchRecord = dispatch.error ? null : contextRecord(dispatch.data);
  if (!currentRecord && !dispatchRecord) return null;

  const currentProvider = objectRecord(currentRecord?.provider_context)
    ?? objectRecord(currentRecord?.reply_context);
  const dispatchProvider = objectRecord(dispatchRecord?.provider_context)
    ?? objectRecord(dispatchRecord?.reply_context);
  return {
    ...(dispatchRecord ?? {}),
    ...(currentRecord ?? {}),
    provider_context: { ...(dispatchProvider ?? {}), ...(currentProvider ?? {}) },
  } as Record<string, unknown>;
}

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CHANNEL_GATEWAY_STATIC_EGRESS_REQUIRED")) {
    return "Vercel 고정 egress IP를 판매채널에 등록하고 서버 설정을 활성화한 뒤 다시 시도해 주세요.";
  }
  if (message.includes("COUPANG_WING_USER_ID_MISSING")) return "쿠팡 API Vault에 WING 실사용자 ID를 입력해 주세요.";
  if (message.startsWith("INQUIRY_REPLY_INVALID:")) return "채널 문의 원문 식별값이 없어 실제 답변을 보낼 수 없습니다. 문의를 새로고침해 주세요.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_LINEAGE_UNBOUND")) return "이 문의를 수집한 판매자 계정 연결을 확인할 수 없습니다. 문의를 새로고침한 뒤 다시 시도해 주세요.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_RECONCILIATION_REQUIRED")) return "이 문의의 이전 답변 접수 여부를 먼저 판매자센터에서 확인해야 합니다.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_PROVIDER_NOT_WAITING")) return "판매채널에서 이미 답변되었거나 종료된 문의입니다. 문의를 새로고침해 주세요.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_CONTEXT_STALE")) return "최신 고객 메시지 연결을 확인할 수 없습니다. 문의를 새로고침해 주세요.";
  if (/CREDENTIALS_MISSING|TOKEN_EXCHANGE_FAILED|ACCESS_TOKEN_MISSING/.test(message)) return "판매채널 인증값이 누락됐거나 만료됐습니다.";
  if (message.includes("CHANNEL_GATEWAY_REPLY_CONFLICT")) return "이 문의에는 다른 답변이 이미 전송 중이거나 전송 완료됐습니다. 판매자센터와 문의 상태를 확인해 주세요.";
  if (message.includes("EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS")) return "eBay 판매자 계정의 분당 답변 한도에 도달했습니다. 60초 뒤 다시 시도해 주세요.";
  if (message.includes("EBAY_ASQ_PROVIDER_COOLDOWN_100_SECONDS")) return "eBay가 답변 호출을 일시 차단했습니다. 마지막 한도 오류로부터 100초 뒤 다시 시도해 주세요.";
  if (message.includes("CHANNEL_GATEWAY_TIMEOUT")) return "판매채널 답변 작업이 아직 끝나지 않았습니다. 잠시 후 문의 상태를 다시 확인해 주세요.";
  if (message.includes("CHANNEL_GATEWAY")) return "고정 IP 채널 작업자에서 답변을 처리하지 못했습니다.";
  return "판매채널에서 CS 답변을 처리하지 못했습니다.";
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return noStoreAdminError(admin);

  const url = new URL(request.url);
  const parsed = statusQuerySchema.safeParse({
    ticketId: url.searchParams.get("ticketId"),
    jobId: url.searchParams.get("jobId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ message: "CS 전달 상태 조회 대상을 확인해 주세요." }, { status: 400, headers: noStoreHeaders });
  }

  const { data, error } = await admin.userClient.rpc("sellerpilot_get_inquiry_reply_delivery", {
    p_ticket_id: parsed.data.ticketId,
    p_job_id: parsed.data.jobId,
  });
  if (error) {
    return NextResponse.json({ message: "CS 전달 상태 원장이 아직 준비되지 않았습니다." }, { status: 503, headers: noStoreHeaders });
  }
  const delivery = contextRecord(data);
  if (!delivery) {
    return NextResponse.json({ message: "해당 문의의 전달 작업을 찾지 못했습니다." }, { status: 404, headers: noStoreHeaders });
  }
  return NextResponse.json({ delivery }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return noStoreAdminError(admin);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "CS 답변 내용을 확인해 주세요." }, { status: 400, headers: noStoreHeaders });
  }

  const ticket = await loadTicketReplyContext(admin, parsed.data.ticketId);
  const channel = typeof ticket?.channel_key === "string" ? ticket.channel_key as ActiveChannelKey : null;
  const environment = ticket?.environment === "sandbox" || ticket?.environment === "production"
    ? ticket.environment
    : null;
  const externalTicketId = typeof ticket?.external_ticket_id === "string" ? ticket.external_ticket_id : "";
  const providerContext = objectRecord(ticket?.provider_context) ?? {};
  let marketplaceBound = false;
  try {
    marketplaceBound = Boolean(ebayAsqMarketplaceId(providerContext.marketplaceId));
  } catch {
    marketplaceBound = false;
  }
  const ebayRelease = {
    providerCertified: ticket?.seller_account_key_source === "provider_certified_v1",
    sellerAccountVerified: typeof ticket?.seller_account_verified_at === "string"
      && !Number.isNaN(Date.parse(ticket.seller_account_verified_at)),
    marketplaceBound,
  };
  if (!ticket || !channel || !environment || !supportsInquiryReply(channel, environment, ebayRelease)) {
    return NextResponse.json(
      { message: "이 판매채널은 SellerPilot에서 실제 CS 답변 전송을 지원하지 않습니다." },
      { status: 409, headers: noStoreHeaders },
    );
  }
  if (ticket.status === "resolved") {
    return NextResponse.json(
      { message: "이미 처리 완료된 문의입니다. 중복 답변은 전송하지 않았습니다." },
      { status: 409, headers: noStoreHeaders },
    );
  }
  if (ticket.provider_status !== "waiting" || typeof ticket.latest_inbound_key !== "string" || !ticket.latest_inbound_key) {
    return NextResponse.json(
      { message: ticket.provider_status === "answered" || ticket.provider_status === "closed"
        ? "판매채널에서 이미 답변되었거나 종료된 문의입니다. 문의를 새로고침해 주세요."
        : "최신 고객 메시지 연결을 확인할 수 없습니다. 문의를 새로고침해 주세요." },
      { status: 409, headers: noStoreHeaders },
    );
  }
  if (ticket.latest_inbound_key !== parsed.data.expectedInboundKey) {
    return NextResponse.json(
      { message: "검토 중 새 고객 메시지가 도착했습니다. 최신 문의를 다시 확인해 주세요." },
      { status: 409, headers: noStoreHeaders },
    );
  }

  if (channel === "coupang" && !hasServerlessStaticEgressFor(
    configuredServerlessStaticEgressChannels(),
    ["coupang"],
  )) {
    return NextResponse.json({
      message: "Vercel 고정 egress IP를 판매채널에 등록하고 서버 설정을 활성화한 뒤 다시 시도해 주세요.",
      blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
      staticEgressReady: false,
    }, { status: 409, headers: noStoreHeaders });
  }

  try {
    const replyArguments = buildInquiryReplyArguments(channel, externalTicketId, parsed.data.reply, providerContext);
    const { jobId } = await enqueueInquiryReplyViaChannelGateway({
      serviceClient: admin.serviceClient,
      ticketId: parsed.data.ticketId,
      channel,
      reply: parsed.data.reply,
      expectedInboundKey: parsed.data.expectedInboundKey,
      arguments: replyArguments,
    });
    const queuedAt = new Date().toISOString();
    return NextResponse.json({
      ok: true,
      accepted: true,
      jobId,
      ticketId: parsed.data.ticketId,
      channel,
      environment,
      delivery: {
        jobId,
        ticketId: parsed.data.ticketId,
        channel,
        inboundKey: ticket.latest_inbound_key,
        status: "queued",
        safeMessage: null,
        reconciliationReason: null,
        providerRequestId: null,
        providerMessageId: null,
        queuedAt,
        startedAt: null,
        completedAt: null,
        updatedAt: queuedAt,
      },
      message: "답변을 안전한 판매채널 작업 대기열에 등록했습니다.",
    }, { status: 202, headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json({ message: failureMessage(error) }, {
      status: /EBAY_ASQ_(?:RATE_LIMITED_75_PER_60_SECONDS|PROVIDER_COOLDOWN_100_SECONDS)/.test(message)
        ? 429
        : /CHANNEL_GATEWAY_(?:STATIC_EGRESS_REQUIRED|REPLY_(?:CONFLICT|LINEAGE_UNBOUND|RECONCILIATION_REQUIRED|PROVIDER_NOT_WAITING|CONTEXT_STALE))/.test(message)
          ? 409
          : 422,
      headers: noStoreHeaders,
    });
  }
}
