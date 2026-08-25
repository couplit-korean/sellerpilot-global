import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { gatewayClaimSchema } from "../../../../../lib/channels/gateway-contract";
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
  const body = await request.json().catch(() => ({})) as { version?: unknown };
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const { data, error } = await serviceClient.rpc("sellerpilot_claim_channel_gateway_job", {
    p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
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
  return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store, max-age=0" } });
}
