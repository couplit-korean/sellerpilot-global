import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import {
  SHOPEE_BUYER_CHAT_TRANSPORT,
  projectShopeeBuyerChatApi,
  shopeeBuyerChatMediaReadSchema,
  shopeeBuyerChatPushObservationSchema,
  shopeeBuyerChatReadQuerySchema,
  shopeeBuyerChatReadSchema,
} from "../../../../../../../lib/cs/channels/shopee/buyer-chat-contract";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  try {
    const url = new URL(request.url);
    const allowedKeys = new Set(["credentialId", "shopId", "conversationId", "cursor", "limit"]);
    if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
      return NextResponse.json({ message: "Shopee Buyer Chat 조회 범위를 확인해 주세요." },
        { status: 400, headers });
    }
    const parsed = shopeeBuyerChatReadQuerySchema.safeParse({
      credentialId: url.searchParams.get("credentialId") ?? undefined,
      shopId: url.searchParams.get("shopId") ?? undefined,
      conversationId: url.searchParams.get("conversationId") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ message: "Shopee Buyer Chat 조회 범위를 확인해 주세요." },
        { status: 400, headers });
    }
    const [ledgerResult, pushResult] = await Promise.all([
      admin.userClient.rpc("sellerpilot_read_cs_shopee_buyer_chat_v1", {
        p_credential_id: parsed.data.credentialId ?? null,
        p_shop_id: parsed.data.shopId ?? null,
        p_conversation_id: parsed.data.conversationId ?? null,
        p_cursor: parsed.data.cursor ?? null,
        p_limit: parsed.data.limit,
      }),
      admin.userClient.rpc("sellerpilot_read_cs_shopee_buyer_chat_push_status_v1", {
        p_credential_id: parsed.data.credentialId ?? null,
        p_shop_id: parsed.data.shopId ?? null,
      }),
    ]);
    if (ledgerResult.error || pushResult.error) {
      return NextResponse.json({ message: "Shopee Buyer Chat 권한·기록을 조회하지 못했습니다." },
        { status: 503, headers });
    }
    const ledger = shopeeBuyerChatReadSchema.safeParse(ledgerResult.data);
    const push = shopeeBuyerChatPushObservationSchema.safeParse(pushResult.data);
    if (!ledger.success || !push.success) {
      return NextResponse.json({ message: "Shopee Buyer Chat 원장 응답을 확인하지 못했습니다." },
        { status: 502, headers });
    }
    const mediaResult = await admin.userClient.rpc(
      "sellerpilot_read_cs_shopee_buyer_chat_media_v1",
      {
        p_scopes: ledger.data.shops.map((shop) => ({
          credentialId: shop.credentialId,
          shopId: shop.shopId,
          messages: shop.messages.map((message) => ({
            conversationId: message.conversationId,
            messageId: message.messageId,
          })),
        })),
      },
    );
    if (mediaResult.error) {
      return NextResponse.json({ message: "Shopee Buyer Chat 첨부 기록을 조회하지 못했습니다." },
        { status: 503, headers });
    }
    const media = shopeeBuyerChatMediaReadSchema.safeParse(mediaResult.data);
    if (!media.success) {
      return NextResponse.json({ message: "Shopee Buyer Chat 첨부 응답을 확인하지 못했습니다." },
        { status: 502, headers });
    }
    return NextResponse.json(
      projectShopeeBuyerChatApi(
        ledger.data, SHOPEE_BUYER_CHAT_TRANSPORT, push.data, media.data,
      ),
      { headers },
    );
  } catch {
    return NextResponse.json({ message: "Shopee Buyer Chat 조회를 처리하지 못했습니다." },
      { status: 503, headers });
  }
}
