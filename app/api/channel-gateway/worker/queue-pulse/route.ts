import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

// The channel worker asked for work through the claim route on every tick, and
// that chain costs a few hundred milliseconds of database CPU even when the
// queue is empty. This route answers the same question with two indexed counts
// so the worker can stay idle without paying for the claim.
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("channel gateway queue pulse server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc("sellerpilot_gateway_queue_pulse", {
    p_token_hash: tokenHash,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway queue pulse RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  const pulse = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  // A pulse that cannot be read must not look like an empty queue, otherwise the
  // worker would stop claiming while work is waiting.
  if (typeof pulse.queued !== "number" || typeof pulse.staleRunning !== "number") {
    return NextResponse.json({ message: "채널 작업 대기 상태를 확인하지 못했습니다." }, { status: 503 });
  }
  return NextResponse.json(pulse, { headers: { "cache-control": "no-store, max-age=0" } });
}
