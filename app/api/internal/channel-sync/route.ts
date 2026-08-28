import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { activeChannelKeys, type ActiveChannelKey } from "../../../../lib/channels/catalog";
import { orderSyncRequests } from "../../../../lib/channels/order-sync";
import {
  dispatchPendingPushNotifications,
  getPushPublicConfiguration,
} from "../../../../lib/push-notifications";
import { supabaseUrl } from "../../../../lib/supabase/config";
import { deadlineAfter, deadlineRemaining } from "../../../../lib/time-deadline";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
} from "../../../../lib/worker-rpc";
import {
  internalScheduleAuthorization,
  internalScheduleCanaryPayload,
  internalScheduleRequestMode,
  runtimeStatusMatchesCurrentRelease,
} from "../../../../lib/internal-scheduler-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
// The gateway drain is the single owner for current inquiries. This route
// produces at most 17 idempotent order enqueue RPCs, avoiding duplicate
// inquiry wakeups while preserving every channel/status order window.
const PERIODIC_SYNC_ENQUEUE_CONCURRENCY = 5;
const CHANNEL_SYNC_WORK_BUDGET_MS = 240_000;
const CHANNEL_SYNC_RPC_START_RESERVE_MS = 10_000;
const CHANNEL_SYNC_PUSH_START_RESERVE_MS = 60_000;
const CHANNEL_SYNC_PUSH_FINALIZATION_RESERVE_MS = 15_000;

type QueueResult = {
  channel?: unknown;
  operation?: unknown;
  status?: unknown;
  jobId?: unknown;
};

type PeriodicSyncResult = {
  channel: ActiveChannelKey;
  operation: "orders.list";
  status: "queued" | "already_pending" | "not_connected" | "reconnect_required" | "reconciliation_required" | "fixed_egress_required" | "failed";
  infrastructureFailure?: true;
};

function serverClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) return null;
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runPeriodicSync(serviceClient: NonNullable<ReturnType<typeof serverClient>>) {
  const workDeadline = deadlineAfter(CHANNEL_SYNC_WORK_BUDGET_MS);
  const now = new Date();
  const queueRequests = activeChannelKeys.flatMap((channel) =>
    orderSyncRequests(channel, now).map((payload) => ({
      channel,
      operation: "orders.list" as const,
      payload,
    })));

  const queuedResults = await mapWithConcurrency(queueRequests, PERIODIC_SYNC_ENQUEUE_CONCURRENCY, async ({ channel, operation, payload }): Promise<PeriodicSyncResult> => {
    if (deadlineRemaining(workDeadline) < CHANNEL_SYNC_RPC_START_RESERVE_MS) {
      return { channel, operation, status: "failed", infrastructureFailure: true };
    }
    try {
      const { data, error } = await serviceClient.rpc("sellerpilot_service_enqueue_periodic_sync", {
        p_channel: channel,
        p_operation: operation,
        p_request_payload: payload,
        p_min_interval_minutes: 5,
      });
      if (error) return { channel, operation, status: "failed", infrastructureFailure: true };
      const result = data && typeof data === "object" && !Array.isArray(data) ? data as QueueResult : {};
      const status = result.status;
      if (status !== "queued" && status !== "already_pending" && status !== "not_connected" && status !== "reconnect_required" && status !== "reconciliation_required" && status !== "fixed_egress_required") {
        return { channel, operation, status: "failed", infrastructureFailure: true };
      }
      return { channel, operation, status };
    } catch {
      return { channel, operation, status: "failed", infrastructureFailure: true };
    }
  });
  const results = queuedResults;

  const pushDeferred = deadlineRemaining(workDeadline) < CHANNEL_SYNC_PUSH_START_RESERVE_MS;
  const push = pushDeferred
    ? {
        configured: getPushPublicConfiguration().configured,
        claimed: 0,
        sent: 0,
        failed: 0,
        reconciliationRequired: 0,
        deferred: 0,
        finalizationFailed: 0,
      }
    : await dispatchPendingPushNotifications(serviceClient, 100, {
        deadlineMs: workDeadline,
        finalizationReserveMs: CHANNEL_SYNC_PUSH_FINALIZATION_RESERVE_MS,
      }).catch(() => ({
        configured: true,
        claimed: 0,
        sent: 0,
        failed: 0,
        reconciliationRequired: 0,
        deferred: 0,
        finalizationFailed: 1,
      }));
  const queued = results.filter((result) => result.status === "queued").length;
  const pending = results.filter((result) => result.status === "already_pending").length;
  const reconnectRequired = results.filter((result) => result.status === "reconnect_required").length;
  const reconciliationRequired = results.filter((result) => result.status === "reconciliation_required").length;
  const fixedEgressRequired = results.filter((result) => result.status === "fixed_egress_required").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const infrastructureFailures = results.filter((result) => result.infrastructureFailure).length;
  const databaseWideFailure = results.length > 0 && infrastructureFailures === results.length;
  const pushRequiresAttention = push.reconciliationRequired > 0 || push.finalizationFailed > 0;
  if (infrastructureFailures > 0) {
    console.error("periodic channel sync enqueue RPC failures", {
      failed: infrastructureFailures,
      total: results.length,
    });
  }

  return NextResponse.json({
    ok: failed === 0
      && reconnectRequired === 0
      && reconciliationRequired === 0
      && fixedEgressRequired === 0
      && !pushRequiresAttention,
    scheduledAt: now.toISOString(),
    queued,
    pending,
    reconnectRequired,
    reconciliationRequired,
    fixedEgressRequired,
    failed,
    infrastructureFailures,
    results,
    push: {
      configured: push.configured,
      sent: push.sent,
      failed: push.failed,
      reconciliationRequired: push.reconciliationRequired,
      deferred: pushDeferred || push.deferred > 0,
      finalizationFailed: push.finalizationFailed,
    },
  }, {
    status: databaseWideFailure
      ? 503
      : infrastructureFailures > 0
          || reconnectRequired > 0
          || reconciliationRequired > 0
          || fixedEgressRequired > 0
          || pushRequiresAttention
        ? 207
        : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = internalScheduleAuthorization(
    request.headers.get("authorization"),
    cronSecret,
  );
  if (authorization === "missing") {
    return NextResponse.json({ message: "주기 동기화 인증값이 설정되지 않았습니다." }, { status: 503 });
  }
  if (authorization !== "authorized") {
    return NextResponse.json({ message: "주기 동기화 인증이 필요합니다." }, { status: 401 });
  }
  const requestedMode = internalScheduleRequestMode(request);
  if (requestedMode === "invalid") {
    return NextResponse.json({ message: "주기 동기화 실행 모드를 확인하지 못했습니다." }, { status: 400 });
  }
  if (requestedMode === "canary") {
    return NextResponse.json(internalScheduleCanaryPayload());
  }
  const serviceClient = serverClient();
  if (!serviceClient) {
    return NextResponse.json({ message: "Supabase 서버 연결이 완료되지 않았습니다." }, { status: 503 });
  }
  const { data: runtimeStatus, error: runtimeStatusError } = await serviceClient.rpc(
    "sellerpilot_service_serverless_cs_wakeup_status",
  );
  if (runtimeStatusError || !runtimeStatusMatchesCurrentRelease(runtimeStatus)) {
    return NextResponse.json({ message: "서버 일정이 활성화되지 않았습니다." }, { status: 503 });
  }
  return runPeriodicSync(serviceClient);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  const serviceClient = serverClient();
  if (!serviceClient) {
    return NextResponse.json({ message: "Supabase 서버 연결이 완료되지 않았습니다." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({})) as { version?: unknown };
  const version = typeof body.version === "string" ? body.version.slice(0, 80) : "sellerpilot-cli-worker";
  let validationData: unknown;
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_validate_worker_token", {
      p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
      p_worker_version: version,
    });
    if (error) {
      console.error("periodic channel sync authentication RPC failed", { code: error.code ?? "unknown", status: 503 });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
    validationData = data;
  } catch {
    console.error("periodic channel sync authentication RPC threw", { status: 503 });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  if (validationData !== true) {
    return NextResponse.json({ message: workerRpcErrorMessage(401) }, { status: 401 });
  }
  return runPeriodicSync(serviceClient);
}
