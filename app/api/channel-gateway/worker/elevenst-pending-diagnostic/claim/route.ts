import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { gatewayClaimSchema } from "../../../../../../lib/channels/gateway-contract";
import { supabaseUrl } from "../../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorMessage, workerRpcErrorStatus } from "../../../../../../lib/worker-rpc";

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
  const body = await request.json().catch(() => null) as { jobId?: unknown; version?: unknown } | null;
  if (!body || (body.jobId !== undefined && typeof body.jobId !== "string")) {
    return NextResponse.json({ message: "11번가 pending 진단 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_claim_elevenst_pending_diagnostic_v1",
    {
      p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
      p_worker_version: typeof body.version === "string" ? body.version.slice(0, 80) : "unknown",
      p_job_id: typeof body.jobId === "string" ? body.jobId : null,
    },
  );
  if (error) {
    const status = workerRpcErrorStatus(error);
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (!data) return new NextResponse(null, { status: 204 });
  const parsed = gatewayClaimSchema.safeParse(data);
  if (!parsed.success
      || parsed.data.channel !== "elevenst"
      || parsed.data.operation !== "diagnostic.test"
      || (typeof body.jobId === "string" && parsed.data.id !== body.jobId)
      || parsed.data.request.sellerpilotPendingCredentialDiagnosticV1 !== true
      || parsed.data.request.identityEvidence !== "admin_claim_v1") {
    return NextResponse.json({ message: "11번가 pending 진단 claim이 일치하지 않습니다." }, { status: 409 });
  }
  return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store, max-age=0" } });
}
