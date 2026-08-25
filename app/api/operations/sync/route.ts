import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { isActiveChannelKey, type ActiveChannelKey } from "../../../../lib/channels/catalog";
import { executeChannelOperation } from "../../../../lib/channels/operations";
import { inquirySyncArguments, normalizeChannelInquiries } from "../../../../lib/channels/inquiry-sync";
import { shouldBootstrapLazadaIm } from "../../../../lib/channels/lazada-im-bootstrap";
import { normalizeChannelOrders, orderSyncRequests } from "../../../../lib/channels/order-sync";
import { dispatchPendingPushNotifications } from "../../../../lib/push-notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  channels: z.array(z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"])).max(8).optional(),
  includeImBootstrap: z.boolean().default(false),
});

type CredentialRow = {
  id: string;
  channel: string;
  environment: "sandbox" | "production";
  status: string;
  expires_at?: string | null;
  created_at?: string | null;
  last_rotated_at?: string | null;
};

const gatewayChannels = new Set<ActiveChannelKey>(["shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]);

function safeSyncFailure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const sanitized = message
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b(key|token|secret|authorization|signature)=\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
  return sanitized ? `${fallback} · ${sanitized}` : fallback;
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "동기화 채널 요청을 확인해 주세요." }, { status: 400 });

  const { data: credentialRows, error: credentialError } = await admin.userClient.rpc("sellerpilot_list_credentials");
  if (credentialError) {
    return NextResponse.json({ message: "활성 채널 연결을 읽지 못했습니다." }, { status: 500 });
  }

  const requested = new Set<ActiveChannelKey>((parsed.data.channels ?? ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]) as ActiveChannelKey[]);
  const credentials = (Array.isArray(credentialRows) ? credentialRows : [])
    .filter((row): row is CredentialRow => Boolean(row) && typeof row === "object" && typeof row.id === "string" && typeof row.channel === "string")
    .filter((row) => row.status === "active" && row.environment === "production" && isActiveChannelKey(row.channel) && requested.has(row.channel))
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.channel === row.channel) === index);
  const results = await Promise.all(credentials.map(async (credential) => {
    const channel = credential.channel as ActiveChannelKey;
    const requests = orderSyncRequests(channel);
    if (!requests.length) {
      await admin.serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
        p_credential_id: credential.id,
        p_channel: channel,
        p_data_type: "orders",
        p_status: "unsupported",
        p_error: "이 채널의 주문 Open API는 아직 연결되지 않았습니다.",
      });
      return { channel, status: "unsupported" as const };
    }

    try {
      if (gatewayChannels.has(channel)) {
        await admin.serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
          p_credential_id: credential.id,
          p_channel: channel,
          p_data_type: "orders",
          p_status: "queued",
          p_error: null,
        });
        const queued = await Promise.all(requests.map(({ arguments: argumentsValue }) => admin.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
          p_credential_id: credential.id,
          p_attempt_id: null,
          p_channel: channel,
          p_operation: "orders.list",
          p_request_payload: { arguments: argumentsValue },
        })));
        if (queued.some(({ error }) => Boolean(error))) throw new Error("order_sync_enqueue_failed");
        return { channel, status: "queued" as const, queuedJobs: queued.length };
      }

      const { data: secretPayload, error: secretError } = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
        p_credential_id: credential.id,
      });
      if (secretError || !secretPayload || typeof secretPayload !== "object" || Array.isArray(secretPayload)) throw new Error("credential_unavailable");
      const operationResults = await Promise.all(requests.map(({ arguments: argumentsValue }) => executeChannelOperation({
        channel,
        operation: "orders.list",
        payload: secretPayload as Record<string, unknown>,
        arguments: argumentsValue,
        environment: "production",
      })));
      if (operationResults.some((operationResult) => !operationResult.ok)) {
        throw new Error(operationResults.find((operationResult) => !operationResult.ok)?.safeMessage);
      }
      const orders = [...new Map(
        operationResults.flatMap((operationResult) => normalizeChannelOrders(channel, operationResult))
          .map((order) => [order.externalOrderId, order] as const),
      ).values()];
      const { error: ingestError } = await admin.serviceClient.rpc("sellerpilot_service_ingest_orders", {
        p_credential_id: credential.id,
        p_channel: channel,
        p_orders: orders,
      });
      if (ingestError) throw new Error("order_ingest_failed");
      return { channel, status: "passed" as const, importedCount: orders.length };
    } catch (error) {
      await admin.serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
        p_credential_id: credential.id,
        p_channel: channel,
        p_data_type: "orders",
        p_status: "failed",
        p_error: safeSyncFailure(error, "판매채널 주문 조회 또는 원장 저장을 완료하지 못했습니다."),
      });
      return { channel, status: "failed" as const };
    }
  }));

  const inquiryResults = await Promise.all(credentials.map(async (credential) => {
    const channel = credential.channel as ActiveChannelKey;
    const wantsLazadaBootstrap = channel === "lazada" && shouldBootstrapLazadaIm({
      requested: parsed.data.includeImBootstrap,
      credentialChangedAt: credential.last_rotated_at ?? credential.created_at,
    });
    let allowLazadaBootstrap = false;
    if (wantsLazadaBootstrap) {
      const { data: consumed, error: consumeError } = await admin.serviceClient.rpc(
        "sellerpilot_service_consume_lazada_im_bootstrap",
        { p_credential_id: credential.id },
      );
      if (consumeError) return { channel, status: "failed" as const, reason: "bootstrap_state_unavailable" as const };
      allowLazadaBootstrap = consumed === true;
    }
    const requests = allowLazadaBootstrap
      ? [{ bootstrap: true, startTime: Date.now(), pageSize: 20, sessionLimit: 100 }]
      : inquirySyncArguments(channel);
    if (!requests.length) {
      if (channel === "lazada") return { channel, status: "push_only" as const };
      await admin.serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
        p_credential_id: credential.id,
        p_channel: channel,
        p_data_type: "inquiries",
        p_status: "unsupported",
        p_error: "현재 공개 API 권한으로는 이 채널의 문의함을 안전하게 수집할 수 없습니다.",
      });
      return { channel, status: "unsupported" as const };
    }

    try {
      if (gatewayChannels.has(channel)) {
        await admin.serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
          p_credential_id: credential.id,
          p_channel: channel,
          p_data_type: "inquiries",
          p_status: "queued",
          p_error: null,
        });
        const queued = await Promise.all(requests.map((argumentsValue) => admin.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
          p_credential_id: credential.id,
          p_attempt_id: null,
          p_channel: channel,
          p_operation: "inquiries.list",
          p_request_payload: { arguments: argumentsValue },
        })));
        if (queued.some(({ error }) => Boolean(error))) throw new Error("inquiry_sync_enqueue_failed");
        return { channel, status: "queued" as const, queuedJobs: queued.length };
      }

      const { data: secretPayload, error: secretError } = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
        p_credential_id: credential.id,
      });
      if (secretError || !secretPayload || typeof secretPayload !== "object" || Array.isArray(secretPayload)) throw new Error("credential_unavailable");
      const operationResult = await executeChannelOperation({
        channel,
        operation: "inquiries.list",
        payload: secretPayload as Record<string, unknown>,
        arguments: requests[0],
        environment: "production",
      });
      if (!operationResult.ok) throw new Error(operationResult.safeMessage);
      const inquiries = normalizeChannelInquiries(channel, operationResult);
      const { error: ingestError } = await admin.serviceClient.rpc("sellerpilot_service_ingest_inquiries", {
        p_credential_id: credential.id,
        p_channel: channel,
        p_inquiries: inquiries,
      });
      if (ingestError) throw new Error("inquiry_ingest_failed");
      return { channel, status: "passed" as const, importedCount: inquiries.length };
    } catch (error) {
      await admin.serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
        p_credential_id: credential.id,
        p_channel: channel,
        p_data_type: "inquiries",
        p_status: "failed",
        p_error: safeSyncFailure(error, "판매채널 문의 조회 또는 원장 저장을 완료하지 못했습니다."),
      });
      return { channel, status: "failed" as const };
    }
  }));

  const push = await dispatchPendingPushNotifications(admin.serviceClient).catch(() => ({ configured: true, claimed: 0, sent: 0, failed: 1 }));
  return NextResponse.json({
    ok: true,
    requestedChannels: [...requested],
    connectedChannels: credentials.map((credential) => credential.channel),
    results,
    inquiryResults,
    push: { configured: push.configured, sent: push.sent, failed: push.failed },
    message: "연결된 판매채널의 주문·고객 문의 동기화를 요청했습니다.",
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
