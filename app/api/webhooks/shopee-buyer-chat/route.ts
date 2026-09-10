import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  persistVerifiedShopeeBuyerChatPush,
  readShopeeBuyerChatPushAddress,
  ShopeeBuyerChatPushError,
  shopeeBuyerChatPushTransportSchema,
  verifyAndNormalizeShopeeBuyerChatPush,
} from "../../../../lib/channels/cs/shopee/buyer-chat-push";
import { ShopeeBuyerChatIngestError } from "../../../../lib/channels/cs/shopee/buyer-chat-ingest";
import { supabaseUrl } from "../../../../lib/supabase/config";
import { createBoundedSupabaseFetch } from "../../../../lib/worker-rpc";

export const runtime = "nodejs";
const noStore = { "cache-control": "no-store, max-age=0" };
const maxRawBodyBytes = 65_536;

async function readBoundedRawBody(request: Request, declaredLength: number | null) {
  if (request.body === null) throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxRawBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (declaredLength !== null && declaredLength !== total) {
    throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
  }
  const rawBody = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
}

function errorResponse(error: unknown) {
  const pushCode = error instanceof ShopeeBuyerChatPushError ? error.code : null;
  const ingestCode = error instanceof ShopeeBuyerChatIngestError ? error.code : null;
  const status = pushCode === "SIGNATURE_INVALID"
    ? 401
    : pushCode === "REQUEST_INVALID" || pushCode === "SCOPE_MISMATCH"
        || pushCode === "MESSAGE_UNSUPPORTED"
      ? 400
      : pushCode === "TRANSPORT_UNAVAILABLE"
          || ingestCode === "ENTITLEMENT_UNAVAILABLE" || ingestCode === "ENTITLEMENT_INVALID"
        ? 403
        : 503;
  return NextResponse.json({
    message: status === 401
      ? "Shopee push 서명이 올바르지 않습니다."
      : status === 400
        ? "지원되는 Shopee Buyer Chat message push가 아닙니다."
        : status === 403
          ? "Shopee Buyer Chat push 권한 또는 shop 결속을 확인하지 못했습니다."
          : "Shopee Buyer Chat push 저장을 완료하지 못했습니다.",
  }, { status, headers: noStore });
}

export async function POST(request: Request) {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null && !/^\d+$/u.test(contentLengthHeader)) {
    return errorResponse(new ShopeeBuyerChatPushError("REQUEST_INVALID"));
  }
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null
      && (!Number.isSafeInteger(contentLength) || contentLength > maxRawBodyBytes)) {
    return errorResponse(new ShopeeBuyerChatPushError("REQUEST_INVALID"));
  }
  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedRawBody(request, contentLength);
  } catch (error) {
    return errorResponse(error);
  }
  let address: ReturnType<typeof readShopeeBuyerChatPushAddress>;
  try {
    address = readShopeeBuyerChatPushAddress(rawBody);
  } catch (error) {
    return errorResponse(error);
  }

  const callbackUrl = process.env.SHOPEE_BUYER_CHAT_PUSH_CALLBACK_URL?.trim() ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey || !callbackUrl) {
    return errorResponse(new ShopeeBuyerChatPushError("TRANSPORT_UNAVAILABLE"));
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  let resolution: Awaited<ReturnType<typeof serviceClient.rpc>>;
  try {
    resolution = await serviceClient.rpc(
      "sellerpilot_service_resolve_shopee_buyer_chat_push_v1",
      { p_shop_id: address.shopId },
    );
  } catch (error) {
    return errorResponse(new ShopeeBuyerChatPushError("RECEIPT_FAILED", { cause: error }));
  }
  const { data, error } = resolution;
  const transport = shopeeBuyerChatPushTransportSchema.safeParse(data);
  if (error || !transport.success || transport.data.shopId !== address.shopId) {
    return errorResponse(new ShopeeBuyerChatPushError("TRANSPORT_UNAVAILABLE", {
      cause: error ?? undefined,
    }));
  }

  try {
    const push = verifyAndNormalizeShopeeBuyerChatPush({
      callbackUrl,
      rawBody,
      partnerKey: transport.data.partnerKey,
      authorization: request.headers.get("authorization") ?? "",
      expectedShopId: transport.data.shopId,
    });
    await persistVerifiedShopeeBuyerChatPush({ transport: transport.data, push }, serviceClient);
    // Shopee documents a 2xx response with an empty body as the only successful
    // acknowledgement. Anything not durably recorded above remains retryable.
    return new Response(null, { status: 204, headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
