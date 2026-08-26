import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { isActiveChannelKey, type ActiveChannelKey } from "../../../../lib/channels/catalog";
import { executeChannelOperation } from "../../../../lib/channels/operations";
import { inquirySyncArguments, normalizeChannelInquiries } from "../../../../lib/channels/inquiry-sync";
import { shouldBootstrapLazadaIm } from "../../../../lib/channels/lazada-im-bootstrap";
import { normalizeChannelOrders, orderSyncRequests } from "../../../../lib/channels/order-sync";
import { createPromiseGate } from "../../../../lib/promise-pool";
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
const MANUAL_SYNC_ENQUEUE_CONCURRENCY = 4;
const MANUAL_SYNC_RPC_TIMEOUT_MS = 8_000;

// The gate is shared by concurrent manual requests within one server instance,
// avoiding the previous per-channel nested Promise.all database burst.
const runPeriodicEnqueueRpc = createPromiseGate(MANUAL_SYNC_ENQUEUE_CONCURRENCY);

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

function periodicInquiryPayload(channel: ActiveChannelKey, argumentsValue: Record<string, unknown>, index: number) {
  const suffix = argumentsValue.bootstrap === true
    ? "bootstrap"
    : channel === "coupang" && typeof argumentsValue.kind === "string"
      ? argumentsValue.kind
      : String(index);
  return {
    periodicKey: `inquiries:${suffix}`,
    arguments: argumentsValue,
  };
}

function periodicEnqueueSummary(values: unknown[]) {
  const statuses = values.map((value) => value && typeof value === "object" && !Array.isArray(value)
    ? String((value as Record<string, unknown>).status ?? "")
    : "");
  if (statuses.some((status) => !["queued", "already_pending", "not_connected", "reconnect_required", "reconciliation_required"].includes(status))) {
    throw new Error("periodic_sync_enqueue_invalid");
  }
  return {
    status: statuses.includes("reconnect_required")
      ? "reconnect_required" as const
      : statuses.includes("reconciliation_required")
        ? "reconciliation_required" as const
        : statuses.includes("not_connected")
          ? "not_connected" as const
          : statuses.includes("queued")
            ? "queued" as const
            : "already_pending" as const,
    queuedJobs: statuses.filter((status) => status === "queued").length,
    pendingJobs: statuses.filter((status) => status === "already_pending").length,
  };
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: MANUAL_SYNC_RPC_TIMEOUT_MS });
  if (isAdminApiError(admin)) return admin;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "동기화 채널 요청을 확인해 주세요." }, { status: 400 });
  if (!parsed.data.includeImBootstrap) {
    return NextResponse.json({
      ok: false,
      delegated: true,
      message: "자동 주문·문의 동기화는 중복 실행 없이 로컬 스케줄러에서 처리합니다.",
    }, {
      // A non-success response also stops already-open legacy tabs from
      // scheduling three follow-up snapshot reloads for this retired path.
      status: 409,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  const syncNormalizationTimestamp = new Date().toISOString();

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
        const queued = await Promise.all(requests.map((payload) => runPeriodicEnqueueRpc(() => admin.serviceClient.rpc("sellerpilot_service_enqueue_periodic_sync", {
          p_channel: channel,
          p_operation: "orders.list",
          p_request_payload: payload,
          p_min_interval_minutes: 5,
        }))));
        if (queued.some(({ error }) => Boolean(error))) throw new Error("order_sync_enqueue_failed");
        return {
          channel,
          ...periodicEnqueueSummary(queued.map(({ data }) => data)),
        };
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
        operationResults.flatMap((operationResult) => normalizeChannelOrders(
          channel,
          operationResult,
          syncNormalizationTimestamp,
        ))
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
        const queued = await Promise.all(requests.map((argumentsValue, index) => runPeriodicEnqueueRpc(() => admin.serviceClient.rpc("sellerpilot_service_enqueue_periodic_sync", {
          p_channel: channel,
          p_operation: "inquiries.list",
          p_request_payload: periodicInquiryPayload(channel, argumentsValue, index),
          p_min_interval_minutes: 5,
        }))));
        if (queued.some(({ error }) => Boolean(error))) throw new Error("inquiry_sync_enqueue_failed");
        return {
          channel,
          ...periodicEnqueueSummary(queued.map(({ data }) => data)),
        };
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
      const inquiries = normalizeChannelInquiries(channel, operationResult, syncNormalizationTimestamp);
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
  const needsAttention = [...results, ...inquiryResults].some((result) => (
    result.status === "failed"
      || result.status === "not_connected"
      || result.status === "reconnect_required"
      || result.status === "reconciliation_required"
  ));
  return NextResponse.json({
    ok: !needsAttention,
    requestedChannels: [...requested],
    connectedChannels: credentials.map((credential) => credential.channel),
    results,
    inquiryResults,
    push: { configured: push.configured, sent: push.sent, failed: push.failed },
    message: needsAttention
      ? "동기화를 요청했지만 일부 채널은 연결·재연동 또는 외부 처리 결과의 수동 확인이 필요합니다. 채널별 상태를 확인해 주세요."
      : "연결된 판매채널의 주문·고객 문의 동기화를 요청했습니다.",
  }, {
    status: needsAttention ? 207 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
