import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorStatus } from "../../../../../lib/worker-rpc";
import { supportReplyResultSchema, supportReplyWorkerRequestSchema } from "../../../../../lib/cs/draft-contract";
export const runtime = "nodejs";
const headers = { "cache-control": "no-store, max-age=0" };
const identity = { jobId: z.string().uuid(), claimToken: z.string().uuid() };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  z.object({ action: z.literal("heartbeat"), ...identity }).strict(),
  z.object({ action: z.literal("complete"), ...identity, status: z.enum(["succeeded", "failed"]), result: supportReplyResultSchema.optional(), error: z.string().min(1).max(500).optional() }).strict(),
]);
const claimSchema = z.object({ id: z.string().uuid(), claim_token: z.string().uuid(), request: supportReplyWorkerRequestSchema, attempt_count: z.number().int().min(1).max(3), lease_expires_at: z.string().datetime({ offset: true }) });
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (spw_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return NextResponse.json({ message: "CS 작업자 인증이 필요합니다." }, { status: 401, headers });
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !secret) return NextResponse.json({ message: "CS 작업자 연결 설정이 필요합니다." }, { status: 503, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "CS 작업 요청 형식을 확인해 주세요." }, { status: 400, headers });
  const client = createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: createBoundedSupabaseFetch() } });
  const p_token_hash = createHash("sha256").update(token).digest("hex");
  const input = parsed.data;
  const args = input.action === "claim" ? { p_token_hash } : { p_token_hash, p_id: input.jobId, p_claim_token: input.claimToken };
  if (input.action === "complete" && (input.status === "succeeded" ? !input.result || input.error !== undefined : input.result !== undefined || !input.error)) {
    return NextResponse.json({ message: "CS 완료 결과와 상태가 일치하지 않습니다." }, { status: 400, headers });
  }
  const name = input.action === "claim" ? "sellerpilot_claim_cs_reply_draft" : input.action === "heartbeat" ? "sellerpilot_touch_cs_reply_draft" : "sellerpilot_complete_cs_reply_draft";
  const { data, error } = await client.rpc(name, input.action === "complete" ? { ...args, p_status: input.status, p_result: input.result ?? null, p_error: input.error ?? null } : args);
  if (error) return NextResponse.json({ message: "CS 작업 원장 요청을 완료하지 못했습니다." }, { status: workerRpcErrorStatus(error), headers });
  if (input.action === "claim") {
    if (data === null) return new NextResponse(null, { status: 204, headers });
    const claim = claimSchema.safeParse(data);
    return claim.success ? NextResponse.json(claim.data, { headers }) : NextResponse.json({ message: "CS 작업 원장 형식을 확인하지 못했습니다." }, { status: 502, headers });
  }
  const accepted = input.action === "heartbeat" ? data === true : data === "completed" || data === "replayed";
  return NextResponse.json({ status: data }, { status: accepted ? 200 : 409, headers });
}
