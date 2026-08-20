import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { gatewayWorkerCompletionSchema } from "../../../../../lib/channels/gateway-contract";
import { normalizeChannelInquiries } from "../../../../../lib/channels/inquiry-sync";
import { normalizeChannelOrders } from "../../../../../lib/channels/order-sync";
import type { ActiveChannelKey } from "../../../../../lib/channels/catalog";
import type { ChannelOperationResult } from "../../../../../lib/channels/operations";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { dispatchPendingPushNotifications } from "../../../../../lib/push-notifications";

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
  let refreshedCredentialId = "";
  if (parsed.data.status === "succeeded") {
    if (job.channel !== parsed.data.result.channel || job.operation !== parsed.data.result.operation) {
      return NextResponse.json({ message: "채널 작업 결과가 요청과 일치하지 않습니다." }, { status: 409 });
    }
    const oauthResult = parsed.data.result.operation === "oauth.exchange" ? parsed.data.result : null;
    const credentialRefresh = oauthResult
      ? { payload: oauthResult.credentialPayload, expiresAt: oauthResult.expiresAt }
      : parsed.data.credentialRefresh;
    if (credentialRefresh) {
      if (job.channel !== "shopee" && job.channel !== "lazada") {
        return NextResponse.json({ message: "이 채널에는 OAuth 인증값 갱신을 적용할 수 없습니다." }, { status: 409 });
      }
      const credentialId = typeof job.credential_id === "string" ? job.credential_id : "";
      const rpcName = job.channel === "shopee" ? "sellerpilot_service_refresh_shopee" : "sellerpilot_service_refresh_lazada";
      const { data: nextCredentialId, error: refreshError } = await serviceClient.rpc(rpcName, {
        p_credential_id: credentialId,
        p_secret_payload: credentialRefresh.payload,
        p_expires_at: credentialRefresh.expiresAt,
      });
      if (refreshError || typeof nextCredentialId !== "string") {
        await serviceClient.rpc("sellerpilot_complete_channel_gateway_job", {
          p_token_hash: tokenHash,
          p_job_id: parsed.data.jobId,
          p_status: "failed",
          p_response_payload: null,
          p_error_message: "Refreshed channel credential could not be stored.",
        });
        return NextResponse.json({ message: "갱신된 채널 인증값을 Vault에 저장하지 못했습니다." }, { status: 500 });
      }
      refreshedCredentialId = nextCredentialId;
    }
    if (refreshedCredentialId && parsed.data.result.operation === "diagnostic.test") {
      const { error: diagnosticError } = await serviceClient.rpc("sellerpilot_record_credential_test", {
        p_credential_id: refreshedCredentialId,
        p_status: parsed.data.result.diagnostic.status,
        p_safe_message: parsed.data.result.diagnostic.message,
      });
      if (diagnosticError) {
        return NextResponse.json({ message: "갱신된 채널 인증값에 연결 검사 결과를 기록하지 못했습니다." }, { status: 500 });
      }
    }
    if (parsed.data.result.operation === "orders.list") {
      const credentialId = typeof job.credential_id === "string" ? job.credential_id : "";
      const orderResult = parsed.data.result as ChannelOperationResult;
      if (orderResult.ok) {
        const orders = normalizeChannelOrders(job.channel as ActiveChannelKey, orderResult);
        const { error: ingestError } = await serviceClient.rpc("sellerpilot_service_ingest_orders", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_orders: orders,
        });
        if (ingestError) {
          await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
            p_credential_id: credentialId,
            p_channel: job.channel,
            p_data_type: "orders",
            p_status: "failed",
            p_error: "정규화된 주문을 운영 원장에 저장하지 못했습니다.",
          });
          return NextResponse.json({ message: "채널 주문을 운영 원장에 저장하지 못했습니다." }, { status: 500 });
        }
      } else {
        await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_data_type: "orders",
          p_status: "failed",
          p_error: orderResult.safeMessage,
        });
      }
    }
    if (parsed.data.result.operation === "inquiries.list") {
      const credentialId = typeof job.credential_id === "string" ? job.credential_id : "";
      const inquiryResult = parsed.data.result as ChannelOperationResult;
      if (inquiryResult.ok) {
        const inquiries = normalizeChannelInquiries(job.channel as ActiveChannelKey, inquiryResult);
        const { error: ingestError } = await serviceClient.rpc("sellerpilot_service_ingest_inquiries", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_inquiries: inquiries,
        });
        if (ingestError) {
          await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
            p_credential_id: credentialId,
            p_channel: job.channel,
            p_data_type: "inquiries",
            p_status: "failed",
            p_error: "정규화된 고객 문의를 운영 원장에 저장하지 못했습니다.",
          });
          return NextResponse.json({ message: "채널 고객 문의를 운영 원장에 저장하지 못했습니다." }, { status: 500 });
        }
      } else {
        const { error: syncError } = await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_data_type: "inquiries",
          p_status: "failed",
          p_error: inquiryResult.safeMessage,
        });
        if (syncError) return NextResponse.json({ message: "채널 문의 실패 상태를 기록하지 못했습니다." }, { status: 500 });
      }
    }
    storedResponse = oauthResult
      ? { ok: true, channel: oauthResult.channel, operation: oauthResult.operation, safeMessage: oauthResult.safeMessage }
      : parsed.data.result;
  } else if (job.operation === "orders.list" || job.operation === "inquiries.list") {
    const dataType = job.operation === "orders.list" ? "orders" : "inquiries";
    await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
      p_credential_id: typeof job.credential_id === "string" ? job.credential_id : "",
      p_channel: job.channel,
      p_data_type: dataType,
      p_status: "failed",
      p_error: parsed.data.error,
    });
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
  if (job.operation === "orders.list" && parsed.data.status === "succeeded") {
    await dispatchPendingPushNotifications(serviceClient).catch(() => null);
  }
  return NextResponse.json({ message: "채널 작업 결과가 안전하게 저장됐습니다." });
}
