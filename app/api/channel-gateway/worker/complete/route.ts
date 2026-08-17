import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { gatewayWorkerCompletionSchema } from "../../../../../lib/channels/gateway-contract";
import { supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || !supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  const parsed = gatewayWorkerCompletionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "채널 작업 완료 형식이 올바르지 않습니다." }, { status: 400 });

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: snapshot, error: snapshotError } = await serviceClient.rpc("sellerpilot_get_channel_gateway_job", {
    p_job_id: parsed.data.jobId,
  });
  const job = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : null;
  if (snapshotError || !job || job.status !== "running") {
    return NextResponse.json({ message: "실행 중인 채널 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }

  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  let storedResponse: Record<string, unknown> | null = null;
  if (parsed.data.status === "succeeded") {
    if (job.channel !== parsed.data.result.channel || job.operation !== parsed.data.result.operation) {
      return NextResponse.json({ message: "채널 작업 결과가 요청과 일치하지 않습니다." }, { status: 409 });
    }
    const oauthResult = parsed.data.result.operation === "oauth.exchange" ? parsed.data.result : null;
    const credentialRefresh = oauthResult
      ? { payload: oauthResult.credentialPayload, expiresAt: oauthResult.expiresAt }
      : parsed.data.credentialRefresh;
    if (credentialRefresh) {
      const credentialId = typeof job.credential_id === "string" ? job.credential_id : "";
      const rpcName = job.channel === "shopee" ? "sellerpilot_service_refresh_shopee" : "sellerpilot_service_refresh_lazada";
      const { error: refreshError } = await serviceClient.rpc(rpcName, {
        p_credential_id: credentialId,
        p_secret_payload: credentialRefresh.payload,
        p_expires_at: credentialRefresh.expiresAt,
      });
      if (refreshError) {
        await serviceClient.rpc("sellerpilot_complete_channel_gateway_job", {
          p_token_hash: tokenHash,
          p_job_id: parsed.data.jobId,
          p_status: "failed",
          p_response_payload: null,
          p_error_message: "Refreshed channel credential could not be stored.",
        });
        return NextResponse.json({ message: "갱신된 채널 인증값을 Vault에 저장하지 못했습니다." }, { status: 500 });
      }
    }
    storedResponse = oauthResult
      ? { ok: true, channel: oauthResult.channel, operation: oauthResult.operation, safeMessage: oauthResult.safeMessage }
      : parsed.data.result;
  }

  const { data, error } = await serviceClient.rpc("sellerpilot_complete_channel_gateway_job", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_status: parsed.data.status,
    p_response_payload: storedResponse,
    p_error_message: parsed.data.status === "failed" ? parsed.data.error : null,
  });
  if (error) return NextResponse.json({ message: "채널 작업 완료 상태를 저장하지 못했습니다." }, { status: 401 });
  if (data !== true) return NextResponse.json({ message: "실행 중인 채널 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  return NextResponse.json({ message: "채널 작업 결과가 안전하게 저장됐습니다." });
}
