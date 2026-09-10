import { completeShippingWorker, type ShippingWorkerCompletion } from "../../../../../lib/shipping/worker-completion";
import { isShippingOperation } from "../../../../../lib/shipping/contracts";
import { completeCsWorker, completeCsWorkerRetry, type CsWorkerCompletion } from "../../../../../lib/cs/operations/worker-completion";
import { completeCommerceWorker } from "../../../../../lib/channels/commerce-worker-completion";
import { isCsOperation } from "../../../../../lib/cs/operations/contracts";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { gatewayWorkerCompletionSchema } from "../../../../../lib/channels/gateway-contract";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorMessage, workerRpcErrorStatus } from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;

function completionPayloadBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
}

function completionSchemaDiagnostics(error: z.ZodError) {
  return error.issues.slice(0, 12).map((issue) => ({
    path: issue.path,
    code: issue.code,
  }));
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("channel gateway completion server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const completionPayload = await request.json().catch(() => null);
  const parsed = gatewayWorkerCompletionSchema.safeParse(completionPayload);
  if (!parsed.success) {
    console.error("channel gateway completion payload rejected", {
      payloadBytes: completionPayloadBytes(completionPayload),
      issues: completionSchemaDiagnostics(parsed.error),
    });
    return NextResponse.json({ message: "채널 작업 완료 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");

  // The retry RPC authenticates the exact worker token/job/claim and owns the
  // queued-state replay contract. Run it before the generic completion
  // snapshot so a lost HTTP response can safely re-enter with the old claim.
  if (parsed.data.status === "failed" && parsed.data.retryContinuation) {
    const retryResponse = await completeCsWorkerRetry(serviceClient, tokenHash, parsed.data as CsWorkerCompletion);
    if (retryResponse) return retryResponse;
  }

  const { data: snapshot, error: snapshotError } = await serviceClient.rpc("sellerpilot_service_gateway_completion_context", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_claim_token: parsed.data.claimToken,
  });
  const job = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : null;
  if (snapshotError) {
    const status = workerRpcErrorStatus(snapshotError);
    console.error("channel gateway completion snapshot RPC failed", {
      code: snapshotError.code ?? "unknown",
      status,
    });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (!job || (job.status !== "running" && job.status !== "completed_replay")) {
    return NextResponse.json({ message: "실행 중인 채널 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }
  return isCsOperation(String(job.operation))
    ? completeCsWorker({ serviceClient, tokenHash, job, completion: parsed.data as CsWorkerCompletion })
    : isShippingOperation(String(job.operation)) ? completeShippingWorker({ serviceClient, tokenHash, job, completion: parsed.data as ShippingWorkerCompletion })
    : completeCommerceWorker({ serviceClient, tokenHash, job, completion: parsed.data });
}
