import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const heartbeatSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  version: z.string().min(1).max(80).optional(),
});

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("channel gateway heartbeat server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }

  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "채널 작업자 신호 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc("sellerpilot_touch_channel_gateway_job", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_claim_token: parsed.data.claimToken,
    p_worker_version: parsed.data.version ?? "sellerpilot-cli-worker/1.24",
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway heartbeat RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (!data) {
    return NextResponse.json({ message: "채널 작업을 찾지 못했습니다." }, { status: 404 });
  }
  if (data !== "running") {
    return NextResponse.json({ message: "채널 작업 실행 권한 또는 lease가 만료됐습니다." }, { status: 409 });
  }
  return NextResponse.json({ status: data }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
