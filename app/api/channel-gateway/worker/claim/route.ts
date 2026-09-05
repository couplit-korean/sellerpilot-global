import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { gatewayClaimSchema } from "../../../../../lib/channels/gateway-contract";
import {
  isLocalGatewayRecoveryAllowedTuple,
  LOCAL_GATEWAY_RECOVERY_RPC_NAME,
  parseChannelGatewayClaimMode,
} from "../../../../../lib/channels/local-gateway-recovery-lane";
import { channelPriceUpdateRelease } from "../../../../../lib/channels/price-update-release";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("channel gateway claim server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const body = await request.json().catch(() => ({})) as { version?: unknown; mode?: unknown };
  const claimMode = parseChannelGatewayClaimMode(body.mode);
  if (claimMode === "invalid") {
    return NextResponse.json({ message: "채널 작업 수신 모드가 올바르지 않습니다." }, { status: 400 });
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const claimRpcName = claimMode === "local_recovery"
    ? LOCAL_GATEWAY_RECOVERY_RPC_NAME
    : "sellerpilot_claim_channel_gateway_job";
  const { data, error } = await serviceClient.rpc(claimRpcName, {
    p_token_hash: tokenHash,
    p_worker_version: typeof body.version === "string" ? body.version.slice(0, 80) : "unknown",
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway claim RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (!data) return new NextResponse(null, { status: 204 });
  const parsed = gatewayClaimSchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ message: "채널 작업 형식이 올바르지 않습니다." }, { status: 500 });
  if (
    claimMode === "local_recovery"
    && !isLocalGatewayRecoveryAllowedTuple(parsed.data.channel, parsed.data.operation)
  ) {
    return NextResponse.json({ message: "채널 작업 범위가 올바르지 않습니다." }, { status: 409 });
  }
  if (parsed.data.operation === "price.update") {
    const release = channelPriceUpdateRelease(parsed.data.channel);
    if (!release.available) {
      const { data: completion, error: completionError } = await serviceClient.rpc(
        "sellerpilot_service_complete_gateway_transaction",
        {
          p_token_hash: tokenHash,
          p_job_id: parsed.data.id,
          p_claim_token: parsed.data.claim_token,
          p_status: "failed",
          p_response_payload: null,
          p_error_message: `PRICE_UPDATE_RELEASE_BLOCKED: ${release.reason}`,
          p_credential_refresh: null,
          p_normalized_orders: null,
          p_normalized_inquiries: null,
          p_diagnostic: null,
        },
      );
      const completed = completion && typeof completion === "object" && !Array.isArray(completion)
        ? completion as Record<string, unknown>
        : null;
      if (completionError || completed?.status !== "completed") {
        const status = completionError ? workerRpcErrorStatus(completionError) : 503;
        console.error("blocked price update claim could not be completed safely", {
          code: completionError?.code ?? "invalid_contract",
          status,
        });
        return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
      }
      return new NextResponse(null, { status: 204 });
    }
  }
  return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store, max-age=0" } });
}
