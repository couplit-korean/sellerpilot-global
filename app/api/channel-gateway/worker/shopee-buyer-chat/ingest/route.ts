import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  ingestAuthorizedShopeeBuyerChatPage,
  ShopeeBuyerChatIngestError,
  shopeeBuyerChatWorkerIngestRequestSchema,
} from "../../../../../../lib/channels/cs/shopee/buyer-chat-ingest";
import { supabaseUrl } from "../../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch } from "../../../../../../lib/worker-rpc";

export const runtime = "nodejs";
const noStore = { "cache-control": "no-store, max-age=0" };

function errorResponse(error: unknown) {
  const code = error instanceof ShopeeBuyerChatIngestError ? error.code : "WRITER_FAILED";
  const status = code === "REQUEST_INVALID" || code === "PAGE_INVALID"
    ? 400
    : code === "ENTITLEMENT_UNAVAILABLE" || code === "ENTITLEMENT_INVALID"
      ? 403
      : code === "RECEIPT_INVALID"
        ? 502
        : 503;
  return NextResponse.json({
    message: status === 403
      ? "Shopee Buyer Chat 서버 권한이 없거나 만료됐습니다."
      : status === 400
        ? "Shopee Buyer Chat 페이지 형식이 올바르지 않습니다."
        : "Shopee Buyer Chat 원장 저장을 완료하지 못했습니다.",
  }, { status, headers: noStore });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." },
      { status: 401, headers: noStore });
  }
  const body = shopeeBuyerChatWorkerIngestRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) return errorResponse(new ShopeeBuyerChatIngestError("REQUEST_INVALID"));

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "Supabase 서버 연결이 완료되지 않았습니다." },
      { status: 503, headers: noStore });
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const { data: workerAuthorized, error: workerError } = await serviceClient.rpc(
    "sellerpilot_service_validate_worker_token",
    {
      p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
      p_worker_version: body.data.workerVersion,
    },
  );
  if (workerError || workerAuthorized !== true) {
    return NextResponse.json({ message: "채널 작업자 인증이 만료됐습니다." },
      { status: workerError ? 503 : 401, headers: noStore });
  }
  try {
    const receipt = await ingestAuthorizedShopeeBuyerChatPage({
      credentialId: body.data.credentialId,
      shopId: body.data.shopId,
      entitlementId: body.data.entitlementId,
      page: body.data.page,
    }, serviceClient);
    return NextResponse.json(receipt, { status: 200, headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
