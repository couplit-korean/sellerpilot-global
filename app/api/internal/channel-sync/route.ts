import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { activeChannelKeys, type ActiveChannelKey } from "../../../../lib/channels/catalog";
import { inquirySyncArguments } from "../../../../lib/channels/inquiry-sync";
import { orderSyncRequests } from "../../../../lib/channels/order-sync";
import { dispatchPendingPushNotifications } from "../../../../lib/push-notifications";
import { supabaseUrl } from "../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;

type QueueResult = {
  channel?: unknown;
  operation?: unknown;
  status?: unknown;
  jobId?: unknown;
};

function periodicInquiryRequests(channel: ActiveChannelKey, now: Date) {
  return inquirySyncArguments(channel, now).map((argumentsValue, index) => ({
    periodicKey: `inquiries:${channel === "coupang" && typeof argumentsValue.kind === "string" ? argumentsValue.kind : index}`,
    arguments: argumentsValue,
  }));
}

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
  const now = new Date();
  const queueRequests = activeChannelKeys.flatMap((channel) => [
    ...orderSyncRequests(channel, now).map((payload) => ({ channel, operation: "orders.list" as const, payload })),
    ...periodicInquiryRequests(channel, now).map((payload) => ({ channel, operation: "inquiries.list" as const, payload })),
  ]);

  const results = await mapWithConcurrency(queueRequests, 8, async ({ channel, operation, payload }) => {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_enqueue_periodic_sync", {
      p_channel: channel,
      p_operation: operation,
      p_request_payload: payload,
      p_min_interval_minutes: 5,
    });
    if (error) return { channel, operation, status: "failed" as const };
    const result = data && typeof data === "object" && !Array.isArray(data) ? data as QueueResult : {};
    return {
      channel,
      operation,
      status: typeof result.status === "string" ? result.status : "failed",
    };
  });

  const push = await dispatchPendingPushNotifications(serviceClient, 100)
    .catch(() => ({ configured: true, claimed: 0, sent: 0, failed: 1 }));
  const queued = results.filter((result) => result.status === "queued").length;
  const pending = results.filter((result) => result.status === "already_pending").length;
  const failed = results.filter((result) => result.status === "failed").length;

  return NextResponse.json({
    ok: failed === 0,
    scheduledAt: now.toISOString(),
    queued,
    pending,
    failed,
    results,
    push: { configured: push.configured, sent: push.sent, failed: push.failed },
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!cronSecret) {
    return NextResponse.json({ message: "주기 동기화 인증값이 설정되지 않았습니다." }, { status: 503 });
  }
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: "주기 동기화 인증이 필요합니다." }, { status: 401 });
  }
  const serviceClient = serverClient();
  if (!serviceClient) {
    return NextResponse.json({ message: "Supabase 서버 연결이 완료되지 않았습니다." }, { status: 503 });
  }
  return runPeriodicSync(serviceClient);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const serviceClient = serverClient();
  if (!workerToken.startsWith("spw_") || !serviceClient) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { version?: unknown };
  const version = typeof body.version === "string" ? body.version.slice(0, 80) : "sellerpilot-cli-worker";
  const { data, error } = await serviceClient.rpc("sellerpilot_service_validate_worker_token", {
    p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
    p_worker_version: version,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("periodic channel sync authentication RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (data !== true) {
    return NextResponse.json({ message: workerRpcErrorMessage(401) }, { status: 401 });
  }
  return runPeriodicSync(serviceClient);
}
