import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  exactLazadaRecoveryJobId,
  recoverExactLazadaCredential,
} from "../../../../../lib/channels/lazada-reconciliation-recovery";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;

const workerTokenPattern = /^spw_[A-Za-z0-9_-]{43}$/;
const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!workerTokenPattern.test(workerToken)) {
    return NextResponse.json(
      { message: "채널 작업자 인증이 필요합니다." },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
  if (body?.jobId !== exactLazadaRecoveryJobId) {
    return NextResponse.json(
      { ok: false, status: "invalid_job" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) {
    console.error("exact Lazada recovery server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json(
      { message: workerRpcErrorMessage(503) },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch(10_000) },
  });
  const outcome = await recoverExactLazadaCredential(
    {
      jobId: body.jobId,
      tokenHash: createHash("sha256").update(workerToken, "utf8").digest("hex"),
    },
    {
      rpc: async (name, arguments_ = {}) => {
        const { data, error } = await serviceClient.rpc(name, arguments_);
        return { data, error };
      },
    },
  );

  return NextResponse.json(outcome.body, {
    status: outcome.httpStatus,
    headers: noStoreHeaders,
  });
}
