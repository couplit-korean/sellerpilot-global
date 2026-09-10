import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorMessage, workerRpcErrorStatus } from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";
const requestSchema = z.object({ jobId: z.string().uuid(), claimToken: z.string().uuid() }).strict();
const receiptSchema = z.object({
  contract: z.literal("sellerpilot-provider-request-rate-budget/1"),
  status: z.enum(["reserved", "waiting"]),
  retryAfterMs: z.number().int().min(0).max(60_000),
  operationLane: z.enum(["cs_reply", "cs_current", "cs_history", "non_cs_read", "non_cs_write"]),
}).strip().superRefine((receipt, context) => {
  if ((receipt.status === "reserved") !== (receipt.retryAfterMs === 0)) {
    context.addIssue({ code: "custom", path: ["retryAfterMs"], message: "rate receipt mismatch" });
  }
});

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !secretKey) return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "채널 호출 예산 요청 형식이 올바르지 않습니다." }, { status: 400 });
  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: createBoundedSupabaseFetch() } });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc("sellerpilot_service_reserve_provider_request_rate_budget_v1", { p_token_hash: tokenHash, p_job_id: parsed.data.jobId, p_claim_token: parsed.data.claimToken });
  if (error) { const status = workerRpcErrorStatus(error); return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status }); }
  const receipt = receiptSchema.safeParse(data);
  return receipt.success
    ? NextResponse.json(receipt.data, { headers: { "cache-control": "no-store, max-age=0" } })
    : NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
}
