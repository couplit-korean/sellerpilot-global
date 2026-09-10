import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { isActiveChannelKey, type ActiveChannelKey } from "../../../../../lib/channels/catalog";
import { shouldBootstrapLazadaIm } from "../../../../../lib/channels/lazada-im-bootstrap";
import { coupangHistoryRecoveryBatch, coupangHistoryRecoveryCheckpoint } from "../../../../../lib/channels/cs/coupang/history-recovery";
import {
  configuredServerlessStaticEgressChannels,
  hasServerlessStaticEgressFor,
  SERVERLESS_STATIC_EGRESS_REQUIRED,
} from "../../../../../lib/channels/serverless-static-egress";
import { createPromiseGate } from "../../../../../lib/promise-pool";

import { inquirySyncRequests } from "../../../../../lib/channels/inquiry-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  channels: z.array(z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"])).max(8).optional(),
  includeImBootstrap: z.boolean().default(false),
  historyDays: z.number().int().min(7).max(30).optional(),
  historyEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
      && value >= "2000-01-30" && value <= today;
  }).optional(),
});

const historyBackfillResultSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(["queued", "running", "succeeded", "failed", "blocked"]),
  historyDays: z.number().int().min(7).max(30),
  fromDate: z.string(),
  toDate: z.string(),
  channels: z.array(z.enum(["coupang", "elevenst", "smartstore"])).min(1).max(3),
  expectedInitialJobs: z.number().int().nonnegative(),
  totalJobs: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  runningJobs: z.number().int().nonnegative(),
  succeededJobs: z.number().int().nonnegative(),
  failedJobs: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  blockedReason: z.literal(SERVERLESS_STATIC_EGRESS_REQUIRED).optional(),
  reused: z.boolean().optional(),
  retriedJobs: z.number().int().nonnegative().optional(),
});

type HistoryBackfillResult = z.infer<typeof historyBackfillResultSchema>;

type CredentialRow = {
  id: string;
  channel: string;
  environment: "sandbox" | "production";
  status: string;
  owner_id?: string | null;
  seller_account_key?: string | null;
  seller_account_key_source?: string | null;
  seller_account_verified_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
  last_rotated_at?: string | null;
};

const MANUAL_SYNC_ENQUEUE_CONCURRENCY = 4;
const MANUAL_SYNC_RPC_TIMEOUT_MS = 8_000;


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

function periodicEnqueueSummary(values: unknown[]) {
  const statuses = values.map((value) => value && typeof value === "object" && !Array.isArray(value)
    ? String((value as Record<string, unknown>).status ?? "")
    : "");
  if (statuses.some((status) => !["queued", "already_pending", "not_connected", "reconnect_required", "reconciliation_required", "fixed_egress_required"].includes(status))) {
    throw new Error("periodic_sync_enqueue_invalid");
  }
  const fixedEgressRequired = statuses.includes("fixed_egress_required");
  return {
    status: statuses.includes("reconnect_required")
      ? "reconnect_required" as const
      : statuses.includes("reconciliation_required")
        ? "reconciliation_required" as const
        : fixedEgressRequired
          ? "fixed_egress_required" as const
        : statuses.includes("not_connected")
          ? "not_connected" as const
          : statuses.includes("queued")
            ? "queued" as const
            : "already_pending" as const,
    queuedJobs: statuses.filter((status) => status === "queued").length,
    pendingJobs: statuses.filter((status) => status === "already_pending").length,
    ...(fixedEgressRequired ? { blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED } : {}),
  };
}

function historyBackfillMessage(result: HistoryBackfillResult) {
  const label = result.channels.map((channel) => ({
    coupang: "쿠팡",
    elevenst: "11번가",
    smartstore: "스마트스토어",
  })[channel]).join("·");
  if (result.status === "blocked" || result.blockedReason === SERVERLESS_STATIC_EGRESS_REQUIRED) {
    return `${label} 문의 조회에는 승인된 송신 경로 설정이 필요합니다. 설정 전에는 선택한 채널의 과거 문의 작업을 접수하거나 재시도하지 않습니다.`;
  }
  if (result.status === "succeeded") {
    return `${label} ${result.fromDate}~${result.toDate}의 ${result.historyDays}일 문의 ${result.succeededJobs}건의 읽기 작업이 모두 반영됐습니다.`;
  }
  if (result.status === "failed") {
    return `${label} ${result.fromDate}~${result.toDate}의 ${result.historyDays}일 문의 작업 중 ${result.failedJobs}건이 실패했습니다. 완료로 표시하지 않았으며 상태를 확인해 주세요.`;
  }
  if ((result.retriedJobs ?? 0) > 0) {
    return `${label} ${result.fromDate}~${result.toDate}의 ${result.historyDays}일 문의의 안전한 읽기 실패 ${result.retriedJobs}건을 다시 접수했습니다. ${result.succeededJobs}/${result.totalJobs}건 완료 상태입니다.`;
  }
  return `${label} ${result.fromDate}~${result.toDate}의 ${result.historyDays}일 문의 읽기 작업 ${result.totalJobs}건을 접수했습니다. 서버에서 순차 처리되며 ${result.succeededJobs}/${result.totalJobs}건 완료 상태입니다.`;
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: MANUAL_SYNC_RPC_TIMEOUT_MS });
  if (isAdminApiError(admin)) return admin;

  const requestedRunId = new URL(request.url).searchParams.get("runId");
  const parsedRunId = requestedRunId === null
    ? { success: true as const, data: null }
    : z.string().uuid().safeParse(requestedRunId);
  if (!parsedRunId.success) {
    return NextResponse.json({ message: "과거 문의 작업 ID를 확인해 주세요." }, { status: 400 });
  }

  const { data, error } = await admin.userClient.rpc(
    "sellerpilot_get_inquiry_history_backfill",
    { p_run_id: parsedRunId.data },
  );
  if (error) {
    return NextResponse.json({ message: "과거 문의 작업 상태를 읽지 못했습니다." }, { status: 500 });
  }
  if (data === null) {
    return NextResponse.json({ ok: true, historyBackfill: null }, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  const parsedResult = historyBackfillResultSchema.safeParse(data);
  if (!parsedResult.success) {
    return NextResponse.json({ message: "과거 문의 작업 상태 형식을 확인하지 못했습니다." }, { status: 500 });
  }
  if (parsedRunId.data && parsedResult.data.runId !== parsedRunId.data) {
    return NextResponse.json({ message: "요청한 과거 문의 작업과 조회 결과가 일치하지 않습니다." }, { status: 502 });
  }
  let checkpoint;
  try {
    if (parsedResult.data.channels.length === 1 && parsedResult.data.channels[0] === "coupang") {
      checkpoint = coupangHistoryRecoveryCheckpoint(parsedResult.data);
    }
  } catch {
    return NextResponse.json({ message: "쿠팡 과거 문의 기간과 처리 건수를 검증하지 못했습니다." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, historyBackfill: parsedResult.data, ...(checkpoint ? { checkpoint } : {}) }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  // Each request owns its admission state; product requests cannot occupy this gate.
  const runPeriodicEnqueueRpc = createPromiseGate(MANUAL_SYNC_ENQUEUE_CONCURRENCY);
  const admin = await authenticateAdminRequest(request, { timeoutMs: MANUAL_SYNC_RPC_TIMEOUT_MS });
  if (isAdminApiError(admin)) return admin;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || (parsed.data.historyEndDate !== undefined && parsed.data.historyDays === undefined)) return NextResponse.json({ message: "동기화 채널과 과거 문의 종료일을 확인해 주세요." }, { status: 400 });
  if (!parsed.data.includeImBootstrap && parsed.data.historyDays === undefined) {
    return NextResponse.json({
      ok: false,
      delegated: true,
      message: "자동 문의 동기화는 중복 실행 없이 서버 스케줄러에서 처리합니다.",
    }, {
      // A non-success response also stops already-open legacy tabs from
      // scheduling three follow-up snapshot reloads for this retired path.
      status: 409,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  const historyChannels = (parsed.data.channels ?? []) as Array<"coupang" | "elevenst" | "smartstore">;
  if (parsed.data.historyDays !== undefined
      && (historyChannels.length !== 1
        || new Set(historyChannels).size !== historyChannels.length
        || historyChannels.some((channel) => channel !== "coupang" && channel !== "elevenst" && channel !== "smartstore"))) {
    return NextResponse.json({ message: "과거 문의는 쿠팡, 11번가 또는 스마트스토어 중 한 채널씩 불러와 주세요." }, { status: 400 });
  }
  const staticEgressChannels = configuredServerlessStaticEgressChannels();
  if (parsed.data.historyDays !== undefined) {
    const envReady = hasServerlessStaticEgressFor(
      staticEgressChannels,
      historyChannels,
    );
    const { data: databasePolicy, error: databasePolicyError } = envReady
      ? await admin.serviceClient.rpc("sellerpilot_service_serverless_static_egress_status")
      : { data: null, error: null };
    const policy = databasePolicy && typeof databasePolicy === "object" && !Array.isArray(databasePolicy)
      ? databasePolicy as Record<string, unknown>
      : {};
    const databaseReady = historyChannels.every((channel) => policy[channel] === true);
    if (!envReady || databasePolicyError || !databaseReady) {
      const blockedAt = new Date();
      const seoulDate = (daysAgo: number) => new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date((parsed.data.historyEndDate ? Date.parse(`${parsed.data.historyEndDate}T12:00:00+09:00`) : blockedAt.getTime()) - daysAgo * 86_400_000));
      return NextResponse.json({
        ok: false,
        staticEgressReady: false,
        blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
        historyBackfill: {
          runId: "00000000-0000-4000-8000-000000000000",
          status: "blocked",
          blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
          historyDays: parsed.data.historyDays,
          fromDate: seoulDate(parsed.data.historyDays - 1),
          toDate: seoulDate(0),
          channels: historyChannels,
          expectedInitialJobs: 0,
          totalJobs: 0,
          queuedJobs: 0,
          runningJobs: 0,
          succeededJobs: 0,
          failedJobs: 0,
          progressPercent: 0,
          startedAt: blockedAt.toISOString(),
          updatedAt: blockedAt.toISOString(),
          completedAt: blockedAt.toISOString(),
        },
        message: "선택한 채널에 승인된 송신 경로 설정이 필요합니다. 다른 채널은 별도로 과거 문의를 불러올 수 있습니다.",
      }, {
        status: 409,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
  }

  const requested = new Set<ActiveChannelKey>((parsed.data.channels ?? ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]) as ActiveChannelKey[]);
  const [{ data: credentialRows, error: credentialError }, lazadaCredentials] = await Promise.all([
    admin.userClient.rpc("sellerpilot_list_credentials"),
    requested.has("lazada")
      ? admin.userClient.rpc("sellerpilot_list_active_lazada_credentials")
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (credentialError || lazadaCredentials.error) {
    return NextResponse.json({ message: "활성 채널 연결을 읽지 못했습니다." }, { status: 500 });
  }

  const smartstoreEnvironmentReady = hasServerlessStaticEgressFor(
    staticEgressChannels,
    ["smartstore"],
  );
  const { data: smartstorePolicyData, error: smartstorePolicyError } =
    requested.has("smartstore") && smartstoreEnvironmentReady
      ? await admin.serviceClient.rpc("sellerpilot_service_serverless_static_egress_status")
      : { data: null, error: null };
  const smartstorePolicy = smartstorePolicyData
    && typeof smartstorePolicyData === "object"
    && !Array.isArray(smartstorePolicyData)
    ? smartstorePolicyData as Record<string, unknown>
    : {};
  const smartstoreFixedEgressReady = smartstoreEnvironmentReady
    && !smartstorePolicyError
    && smartstorePolicy.smartstore === true;
  const genericCredentials = (Array.isArray(credentialRows) ? credentialRows : [])
    .filter((row): row is CredentialRow => Boolean(row) && typeof row === "object" && typeof row.id === "string" && typeof row.channel === "string")
    .filter((row) => row.status === "active" && row.environment === "production" && isActiveChannelKey(row.channel) && requested.has(row.channel))
    .filter((row) => row.channel !== "lazada")
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.channel === row.channel) === index);
  const activeLazadaCredentials = (Array.isArray(lazadaCredentials.data) ? lazadaCredentials.data : [])
    .filter((row): row is Omit<CredentialRow, "channel"> => Boolean(row) && typeof row === "object" && typeof row.id === "string")
    .map((row): CredentialRow => ({ ...row, channel: "lazada" }))
    .filter((row) => row.status === "active"
      && row.environment === "production"
      && typeof row.owner_id === "string"
      && /^[0-9a-f]{64}$/.test(row.seller_account_key ?? "")
      && row.seller_account_key_source === "provider_certified_v1"
      && typeof row.seller_account_verified_at === "string");
  const credentials = [...genericCredentials, ...activeLazadaCredentials];
  const connectedChannels = [...new Set(credentials.map((credential) => credential.channel))];
  if (parsed.data.historyDays !== undefined
      && !historyChannels.every((channel) => credentials.some((credential) => credential.channel === channel))) {
    return NextResponse.json({
      ok: false,
      connectedChannels,
      message: "선택한 채널의 운영 자격증명이 활성 상태여야 과거 문의를 다시 불러올 수 있습니다.",
    }, {
      status: 409,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  if (parsed.data.historyDays !== undefined) {
    const { data, error } = await admin.userClient.rpc(
      "sellerpilot_start_inquiry_history_backfill_v4",
      { p_channels: historyChannels, p_history_days: parsed.data.historyDays, p_end_date: parsed.data.historyEndDate ?? null },
    );
    if (error) {
      return NextResponse.json({
        ok: false,
        message: "선택한 채널의 자격증명 소유자와 연결 상태를 확인한 뒤 다시 시도해 주세요.",
      }, {
        status: 409,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
    const parsedResult = historyBackfillResultSchema.safeParse(data);
    if (!parsedResult.success) {
      return NextResponse.json({ message: "과거 문의 작업 접수 상태 형식을 확인하지 못했습니다." }, { status: 500 });
    }
    const result = parsedResult.data;
    if (result.channels.length !== 1 || result.channels[0] !== historyChannels[0]
      || result.historyDays !== parsed.data.historyDays
      || (parsed.data.historyEndDate !== undefined && result.toDate !== parsed.data.historyEndDate)) {
      return NextResponse.json({ message: "요청한 채널·기간과 과거 문의 접수 결과가 일치하지 않습니다." }, { status: 502 });
    }
    let checkpoint;
    try {
      if (historyChannels[0] === "coupang") {
        const batch = coupangHistoryRecoveryBatch(result.toDate, result.historyDays);
        if (result.fromDate !== batch.fromDate || result.expectedInitialJobs !== batch.expectedInitialJobs) {
          throw new Error("COUPANG_HISTORY_BATCH_MISMATCH");
        }
        checkpoint = coupangHistoryRecoveryCheckpoint(result);
      }
    } catch {
      return NextResponse.json({ message: "쿠팡 과거 문의 기간과 처리 건수를 검증하지 못했습니다." }, { status: 502 });
    }
    return NextResponse.json({
      ok: parsedResult.data.status !== "failed",
      requestedChannels: historyChannels,
      connectedChannels,
      historyBackfill: parsedResult.data,
      ...(checkpoint ? { checkpoint } : {}),
      message: historyBackfillMessage(parsedResult.data),
    }, {
      status: parsedResult.data.status === "failed" ? 207 : 202,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }

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
      ? [{ periodicKey: "inquiries:bootstrap", arguments: { bootstrap: true, startTime: Date.now(), pageSize: 20, sessionLimit: 100 } }]
      : inquirySyncRequests(channel);
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
    if ((channel === "temu" && !hasServerlessStaticEgressFor(staticEgressChannels, ["temu"]))
        || (channel === "smartstore" && !smartstoreFixedEgressReady)) {
      return {
        channel,
        status: "fixed_egress_required" as const,
        queuedJobs: 0,
        pendingJobs: 0,
        blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
      };
    }

    try {
        const queued = await Promise.all(requests.map((payload) => runPeriodicEnqueueRpc(() => channel === "lazada"
          ? admin.serviceClient.rpc("sellerpilot_service_enqueue_lazada_periodic_sync", {
              p_credential_id: credential.id,
              p_operation: "inquiries.list",
              p_request_payload: payload,
              p_min_interval_minutes: 5,
            })
          : admin.serviceClient.rpc("sellerpilot_service_enqueue_periodic_sync", {
              p_channel: channel,
              p_operation: "inquiries.list",
              p_request_payload: payload,
              p_min_interval_minutes: 5,
            }))));
        if (queued.some(({ error }) => Boolean(error))) throw new Error("inquiry_sync_enqueue_failed");
        return {
          channel,
          ...periodicEnqueueSummary(queued.map(({ data }) => data)),
        };
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

  const needsAttention = inquiryResults.some((result) => (
    result.status === "failed"
      || result.status === "not_connected"
      || result.status === "reconnect_required"
      || result.status === "reconciliation_required"
      || result.status === "fixed_egress_required"
  ));
  return NextResponse.json({
    ok: !needsAttention,
    requestedChannels: [...requested],
    connectedChannels,
    inquiryResults,
    message: inquiryResults.some((result) => result.status === "fixed_egress_required")
      ? "Temu·쿠팡·스마트스토어 조회에는 판매채널에 등록된 Vercel 고정 egress 설정이 필요합니다. 설정 전에는 해당 조회를 접수하거나 자동 재시도하지 않습니다."
      : needsAttention
      ? "동기화를 요청했지만 일부 채널은 연결·재연동 또는 외부 처리 결과의 수동 확인이 필요합니다. 채널별 상태를 확인해 주세요."
      : "연결된 판매채널의 고객 문의 동기화를 요청했습니다.",
  }, {
    status: needsAttention ? 207 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
