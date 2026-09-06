import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { gatewayClaimSchema } from "../../../../../../lib/channels/gateway-contract";
import {
  SHOPEE_EXACT_DIAGNOSTIC_JOB_ID,
  SHOPEE_EXACT_DIAGNOSTIC_OPERATION,
} from "../../../../../../lib/channels/shopee-exact-diagnostic-identity";
import { supabaseUrl } from "../../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../../lib/worker-rpc";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const body = await request.json().catch(() => ({})) as { version?: unknown; jobId?: unknown };
  if (body.jobId !== SHOPEE_EXACT_DIAGNOSTIC_JOB_ID) {
    return NextResponse.json({ message: "exact Shopee diagnostic job id required" }, { status: 409 });
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc("sellerpilot_claim_exact_shopee_diagnostic_job", {
    p_token_hash: tokenHash,
    p_worker_version: typeof body.version === "string" ? body.version.slice(0, 80) : "unknown",
    p_job_id: SHOPEE_EXACT_DIAGNOSTIC_JOB_ID,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (!data) return new NextResponse(null, { status: 204 });
  const parsed = gatewayClaimSchema.safeParse(data);
  if (!parsed.success
      || parsed.data.id !== SHOPEE_EXACT_DIAGNOSTIC_JOB_ID
      || parsed.data.channel !== "shopee"
      || parsed.data.operation !== SHOPEE_EXACT_DIAGNOSTIC_OPERATION) {
    return NextResponse.json({ message: "exact Shopee diagnostic claim mismatch" }, { status: 500 });
  }
  return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store, max-age=0" } });
}
