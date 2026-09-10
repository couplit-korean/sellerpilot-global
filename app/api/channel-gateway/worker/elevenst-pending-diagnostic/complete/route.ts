import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorMessage, workerRpcErrorStatus } from "../../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const requestSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  diagnostic: z.object({
    status: z.enum(["passed", "manual", "failed"]),
    message: z.string().trim().min(1).max(500),
    remoteRequestId: z.string().max(160).optional(),
  }).strict(),
}).strict();

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
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "11번가 pending 진단 완료 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_complete_elevenst_pending_diagnostic_v1",
    {
      p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
      p_diagnostic: parsed.data.diagnostic,
    },
  );
  const receipt = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
  if (error || receipt?.status !== "completed"
      || receipt.jobId !== parsed.data.jobId
      || receipt.diagnosticStatus !== parsed.data.diagnostic.status
      || receipt.identityEvidence !== "admin_claim_v1") {
    if (!error) {
      return NextResponse.json({ message: "11번가 pending 진단 완료 대상이 일치하지 않습니다." }, { status: 409 });
    }
    const status = workerRpcErrorStatus(error);
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  return NextResponse.json(receipt, { headers: { "cache-control": "no-store, max-age=0" } });
}
