import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { z } from "zod";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const gatewayContract = await import("../../../../../lib/channels/gateway-contract");
const inquirySync = await import("../../../../../lib/channels/inquiry-sync");
const inquiryCoverage = await import("../../../../../lib/channels/inquiry-coverage");
const retryRpc = await import("../../../../../lib/channels/cs/temu/retry-rpc");
const elevenstWorkerCompletion = await import("../../../../../lib/channels/cs/elevenst/worker-completion");
const routeSource = await readFile(new URL(
  "../../../../../app/api/channel-gateway/worker/complete/route.ts",
  import.meta.url,
), "utf8");
const workerSource = await readFile(new URL(
  "../../../../../scripts/ai-cli-worker.mjs",
  import.meta.url,
), "utf8");
const retryMigration = await readFile(new URL(
  "../../../../../supabase/migrations/20260908140414_cs_temu_durable_detail_retry.sql",
  import.meta.url,
), "utf8");
const atomicCompletionMigration = await readFile(new URL(
  "../../../../../supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql",
  import.meta.url,
), "utf8");
const continuationBlockStart = atomicCompletionMigration.indexOf(
  "  v_continuation := p_response_payload->'continuation';",
);
const continuationBlockEnd = atomicCompletionMigration.indexOf(
  "  insert into sellerpilot_private.gateway_completion_receipts (",
  continuationBlockStart,
);
assert.ok(continuationBlockStart > 0 && continuationBlockEnd > continuationBlockStart);
const continuationAndParentCompletionBlock = atomicCompletionMigration.slice(
  continuationBlockStart,
  continuationBlockEnd,
);
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const JOB_ID = "10000000-0000-4000-8000-00000000d001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-00000000d002";
const CHILD_JOB_ID = "30000000-0000-4000-8000-00000000d003";
const WORKER_TOKEN = `spw_${"fixture-worker-token".repeat(2)}`;
const TOKEN_HASH = crypto.createHash("sha256").update(WORKER_TOKEN).digest("hex");
const REQUEUE_RPC = "sellerpilot_service_requeue_temu_after_sales_detail_v2";
const CONTEXT_RPC = "sellerpilot_service_gateway_completion_context";
const COMPLETE_RPC = "sellerpilot_service_complete_gateway_transaction";

const summary = (number: number) => ({
  parentAfterSalesSn: `AFTER-${number}`,
  parentOrderSn: `ORDER-${number}`,
  afterSalesStatusGroup: 1,
  operateExpireTimeMs: null,
  availableOperateList: [1],
  returnDeliveryType: null,
  parentAfterSalesStatus: 1,
  updateAt: 1_788_000_000 + number,
  afterSalesType: 2,
  createAt: 1_787_000_000 + number,
});
const retryArguments = {
  kind: "after_sales",
  includeDetails: true,
  pageNo: 1,
  pageSize: 200,
  updateAtStart: 1_787_000_000,
  updateAtEnd: 1_788_000_100,
  retryReplayQueue: [summary(1)],
  detailQueue: [summary(2), summary(3)],
  sellerpilotTemuDetailRetryCount: 1,
};
const retryContinuation = {
  reason: "retryable_read_failure" as const,
  arguments: retryArguments,
  retryCount: 1,
  retryAfterSeconds: 5,
  deferredCount: 2,
  replayCount: 1,
  providerStatus: 503,
};
const retryPayload = {
  jobId: JOB_ID,
  claimToken: CLAIM_TOKEN,
  status: "failed" as const,
  error: "Temu detail read failed",
  retryContinuation,
};

class TestResponse extends Response {
  static json(body: unknown, init: ResponseInit = {}) {
    return response(body, init);
  }
}

function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function response(body: unknown, init: ResponseInit = {}) {
  return new TestResponse(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
}

function request(payload: unknown) {
  return new Request("https://fixture.invalid/api/channel-gateway/worker/complete", {
    method: "POST",
    headers: { authorization: `Bearer ${WORKER_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

type Rpc = (name: string, arguments_?: Record<string, unknown>) => Promise<{
  data: unknown;
  error: null | { code?: string; message?: string };
}>;

function loadRoute(rpc: Rpc) {
  const context = vm.createContext({
    exports: {}, Request, Response: TestResponse, Headers, Buffer, Date, Error, Object,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-service-key" } },
    console: { error() {}, log() {} },
    require(name: string) {
      if (name === "node:crypto") return crypto;
      if (name === "@supabase/supabase-js") return {
        createClient() { return { rpc }; },
      };
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name === "zod") return { z };
      if (name.endsWith("/lib/channels/gateway-contract")) return gatewayContract;
      if (name.endsWith("/lib/server-smartstore-content-repair")) {
        return { smartstoreContentRepairCompletionSchema: z.any() };
      }
      if (name.endsWith("/lib/channels/inquiry-sync")) return inquirySync;
      if (name.endsWith("/lib/channels/inquiry-coverage")) return inquiryCoverage;
      if (name.endsWith("/lib/channels/cs/elevenst/worker-completion")) return elevenstWorkerCompletion;
      if (name.endsWith("/lib/channels/cs/qoo10/reply-readback-completion")) return {
        qoo10ReplyS3CompletionEvidence: () => null,
        qoo10ReplyS3ReadbackContext: () => null,
        qoo10ReplyS3StatusRpcArguments: () => ({}),
      };
      if (name.endsWith("/lib/channels/reply-verification")) return {
        hasProviderReplyAcceptance: () => true,
        inquiryReplyObservations: () => [],
      };
      if (name.endsWith("/lib/channels/lazada-im-webhook")) return {
        lazadaQuarantineReady: async () => true,
        markLazadaImRawEvent: async () => true,
        persistLazadaImRawEvent: async () => ({ ok: false }),
      };
      if (name.endsWith("/lib/channels/lazada-im")) return { lazadaImHistoryRawPages: () => [] };
      if (name.endsWith("/lib/channels/order-sync")) return { normalizeChannelOrders: () => [] };
      if (name.endsWith("/lib/supabase/config")) return { supabaseUrl: "https://fixture.supabase.co" };
      if (name.endsWith("/lib/cs/channels/elevenst/read-observation")) {
        return { buildElevenstCsReadObservation: () => null };
      }
      if (name.endsWith("/lib/push-notifications")) {
        return { dispatchPendingPushNotifications: async () => {} };
      }
      if (name.endsWith("/lib/worker-rpc")) return {
        createBoundedSupabaseFetch: () => undefined,
        workerRpcErrorMessage: (status: number) => `fixture rpc unavailable ${status}`,
        workerRpcErrorStatus: () => 503,
      };
      if (name.endsWith("/lib/channels/cs/temu/retry-rpc")) return retryRpc;
      throw new Error(`unexpected route import: ${name}`);
    },
  });
  vm.runInContext(compiledRoute, context, { timeout: 1_000 });
  return context.exports.POST as (request_: Request) => Promise<Response>;
}

function retryReceipt(replayed: boolean) {
  return {
    contract: "temu-after-sales-detail-retry-v2",
    status: "deferred",
    retryCount: 1,
    retryAfterSeconds: 5,
    deferredCount: 2,
    replayCount: 1,
    failureCode: "TEMU_AFTER_SALES_DETAIL_READ_FAILED",
    replayed,
  };
}

function detailStep(number: number) {
  return {
    name: number === 1 ? "inquiries" : `inquiries:${number}`,
    ok: true,
    status: 200,
    data: {
      success: true,
      sellerpilotListSummary: summary(number),
      result: {
        parentAfterSalesSn: `AFTER-${number}`,
        parentOrderSn: `ORDER-${number}`,
        parentAfterSalesStatus: 1,
        afterSalesType: 2,
        lastUpdateAtMillis: 1_788_000_000_000 + number * 1_000,
        afterSalesList: [{
          afterSalesSn: `AFTER-${number}-CHILD`,
          orderSn: `ORDER-${number}`,
          buyerComment: `fixture-message-${number}`,
          afterSalesStatus: 1,
        }],
      },
    },
  };
}

test("worker DTO is forwarded only on failed Temu inquiry completion and validates exact retry shape", () => {
  assert.match(workerSource, /completionStatus === "failed"\s*&& job\.channel === "temu"\s*&& job\.operation === "inquiries\.list"/u);
  const completionStart = workerSource.indexOf('const completionPayload = completionStatus === "failed"');
  const completionEnd = workerSource.indexOf("stageSmartstoreListingUpdateCompletionJournal(completionPayload)", completionStart);
  assert.ok(completionStart > 0 && completionEnd > completionStart);
  assert.match(workerSource.slice(completionStart, completionEnd), /buildGatewayWorkerFailedCompletionPayload\([\s\S]*retryContinuation/u);
  const actualPayload = elevenstWorkerCompletion.buildGatewayWorkerFailedCompletionPayload({
    job: { id: JOB_ID, channel: "temu", operation: "inquiries.list" },
    claimToken: CLAIM_TOKEN,
    error: retryPayload.error,
    retryContinuation,
    result: {
      ok: false, channel: "temu", operation: "inquiries.list",
      steps: [{ name: "inquiries", ok: false, status: 503, data: { rawBody: "must-not-cross" } }],
      safeMessage: retryPayload.error,
    },
  });
  assert.deepEqual(actualPayload, retryPayload);
  const parsed = gatewayContract.gatewayWorkerCompletionSchema.safeParse(actualPayload);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(normalize(parsed.data.retryContinuation), retryContinuation);

  assert.equal(gatewayContract.gatewayWorkerCompletionSchema.safeParse({
    ...retryPayload,
    retryContinuation: {
      ...retryContinuation,
      arguments: { ...retryArguments, detailQueue: [{ ...summary(2), phone: "not-allowed" }] },
    },
  }).success, false);
  assert.equal(gatewayContract.gatewayWorkerCompletionSchema.safeParse({
    ...retryPayload,
    retryContinuation: { ...retryContinuation, deferredCount: 1 },
  }).success, false);
});

test("actual POST schedules durable retry before snapshot and exact-replays after lost response", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let requeues = 0;
  const POST = loadRoute(async (name, arguments_ = {}) => {
    calls.push({ name, arguments: normalize(arguments_) });
    assert.equal(name, REQUEUE_RPC);
    requeues += 1;
    return { data: retryReceipt(requeues > 1), error: null };
  });

  const first = await POST(request(retryPayload));
  assert.equal(first.status, 202);
  assert.equal(first.headers.get("retry-after"), "5");
  assert.deepEqual(await first.json(), {
    message: "Temu 상세 조회 실패를 성공으로 완료하지 않고 같은 작업에 재조회 예약했습니다.",
    completionStatus: "retry_scheduled",
    jobCompleted: false,
    providerReadSucceeded: false,
    retryScheduled: true,
    retryReceiptReplayed: false,
    retryCount: 1,
    retryAfterSeconds: 5,
    deferredCount: 2,
    replayCount: 1,
  });

  // Model the worker losing the first HTTP response and replaying the exact POST.
  const replay = await POST(request(retryPayload));
  assert.equal(replay.status, 202);
  assert.equal((await replay.json()).retryReceiptReplayed, true);
  assert.deepEqual(calls.map((call) => call.name), [REQUEUE_RPC, REQUEUE_RPC]);
  assert.deepEqual(calls[1]?.arguments, calls[0]?.arguments);
  assert.deepEqual(calls[0]?.arguments, {
    p_token_hash: TOKEN_HASH,
    p_job_id: JOB_ID,
    p_claim_token: CLAIM_TOKEN,
    p_retry_arguments: retryArguments,
    p_retry_count: 1,
    p_retry_after_seconds: 5,
    p_deferred_count: 2,
    p_replay_count: 1,
    p_provider_status: 503,
  });
  assert.equal(calls.some((call) => call.name === CONTEXT_RPC || call.name === COMPLETE_RPC), false);
});

test("worker claim/lineage rejection cannot fall through to generic success completion", async () => {
  const calls: string[] = [];
  const POST = loadRoute(async (name) => {
    calls.push(name);
    assert.equal(name, REQUEUE_RPC);
    return { data: null, error: { code: "40001", message: "fixture lineage conflict" } };
  });
  const result = await POST(request(retryPayload));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).code, "TEMU_AFTER_SALES_DETAIL_RETRY_RECORDING_FAILED");
  assert.deepEqual(calls, [REQUEUE_RPC]);
});

test("retry exhaustion has no retry DTO, completes failed, and preserves the retry_exhausted DB contract", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const POST = loadRoute(async (name, arguments_ = {}) => {
    calls.push({ name, arguments: normalize(arguments_) });
    if (name === CONTEXT_RPC) return {
      data: {
        status: "running",
        channel: "temu",
        operation: "inquiries.list",
        normalization_timestamp: "2026-09-08T00:00:00.000Z",
        request: { arguments: { ...retryArguments, sellerpilotTemuDetailRetryCount: 3 } },
      },
      error: null,
    };
    if (name === COMPLETE_RPC) return { data: { status: "completed" }, error: null };
    throw new Error(`unexpected RPC ${name}`);
  });
  const response_ = await POST(request({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "failed",
    error: "Temu detail retry exhausted",
  }));
  assert.equal(response_.status, 200);
  assert.deepEqual(calls.map((call) => call.name), [CONTEXT_RPC, COMPLETE_RPC]);
  const completion = calls[1]!.arguments;
  assert.equal(completion.p_status, "failed");
  assert.equal(completion.p_response_payload, null);
  assert.equal(completion.p_error_message, "Temu detail retry exhausted");
  assert.match(retryMigration, /when v_retry_count = 3 then 'retry_exhausted'/u);
});

test("final parent success replay keeps two unique detail revisions and zero duplicate child rows", async () => {
  let contextCalls = 0;
  let parentStatus = "running";
  const normalizedBatches: unknown[][] = [];
  const childRows = new Map<string, string>();
  const completionFingerprints = new Set<string>();
  const result = {
    ok: true,
    channel: "temu",
    operation: "inquiries.list",
    steps: [detailStep(1), detailStep(2)],
    continuation: {
      reason: "page_cap_reached",
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        pageNo: 1,
        pageSize: 200,
        detailQueue: [summary(3)],
        sellerpilotPaginationDepth: 1,
      },
    },
    safeMessage: "Temu detail batch complete",
  };
  const payload = { jobId: JOB_ID, claimToken: CLAIM_TOKEN, status: "succeeded", result };
  const POST = loadRoute(async (name, arguments_ = {}) => {
    if (name === CONTEXT_RPC) {
      contextCalls += 1;
      return {
        data: {
          status: contextCalls === 1 ? "running" : "completed_replay",
          channel: "temu",
          operation: "inquiries.list",
          credential_id: "40000000-0000-4000-8000-00000000d004",
          normalization_timestamp: "2026-09-08T12:00:00.000Z",
        },
        error: null,
      };
    }
    if (name === COMPLETE_RPC) {
      const inquiries = normalize(arguments_.p_normalized_inquiries) as unknown[];
      normalizedBatches.push(inquiries);
      const fingerprint = JSON.stringify(arguments_);
      if (!completionFingerprints.has(fingerprint)) {
        completionFingerprints.add(fingerprint);
        childRows.set(`continuation:${JOB_ID}:1`, CHILD_JOB_ID);
        parentStatus = String(arguments_.p_status);
      }
      return {
        data: { status: "completed", replayed: contextCalls > 1, continuationJobId: CHILD_JOB_ID },
        error: null,
      };
    }
    if (name === "sellerpilot_service_record_cs_history_page_v1") return {
      data: {
        contract: "cs_history_coverage_v1",
        status: "completed",
        jobId: JOB_ID,
      },
      error: null,
    };
    throw new Error(`unexpected RPC ${name}`);
  });

  const first = await POST(request(payload));
  const replay = await POST(request(payload));
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(parentStatus, "succeeded");
  assert.equal(completionFingerprints.size, 1);
  assert.equal(childRows.size, 1);
  assert.equal(childRows.size - new Set(childRows.values()).size, 0);
  assert.equal(normalizedBatches.length, 2);
  for (const inquiries of normalizedBatches) {
    assert.equal(inquiries.length, 2);
    const records = inquiries as Array<{ externalTicketId: string; inboundKey: string }>;
    assert.equal(new Set(records.map((row) => row.externalTicketId)).size, 2);
    assert.equal(new Set(records.map((row) => row.inboundKey)).size, 2);
  }
});

test("canonical completion SQL succeeds the Temu parent and creates no duplicate continuation child", async () => {
  const db = new PGlite();
  const credentialId = "40000000-0000-4000-8000-00000000d004";
  const ownerId = "50000000-0000-4000-8000-00000000d005";
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials(
        id uuid primary key,
        environment text not null,
        created_by uuid not null
      );
      insert into sellerpilot_private.channel_credentials values(
        '${credentialId}', 'production', '${ownerId}'
      );
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid primary key,
        credential_id uuid not null,
        attempt_id uuid,
        channel text not null,
        operation text not null,
        environment text not null,
        request_payload jsonb not null,
        created_by uuid not null
      );
      create unique index fixture_continuation_once
        on sellerpilot_private.channel_gateway_jobs((request_payload->>'periodicKey'));
      create table sellerpilot_private.fixture_parent(
        id uuid primary key,
        status text not null
      );
      insert into sellerpilot_private.fixture_parent values('${JOB_ID}', 'running');
      create function public.sellerpilot_service_mark_channel_sync(uuid, text, text, text, text)
        returns void language sql as 'select';
      create function public.sellerpilot_complete_channel_gateway_job(
        text, uuid, uuid, text, jsonb, text
      ) returns boolean language plpgsql as $$
      begin
        update sellerpilot_private.fixture_parent set status = $4 where id = $2;
        return found;
      end $$;
      create function public.fixture_temu_completion(p_response_payload jsonb, p_status text)
        returns uuid language plpgsql as $$
      declare
        p_job_id uuid := '${JOB_ID}';
        p_claim_token uuid := '${CLAIM_TOKEN}';
        p_token_hash text := '${TOKEN_HASH}';
        p_error_message text := null;
        v_job record;
        v_result_ok boolean := true;
        v_effective_credential_id uuid := '${credentialId}';
        v_continuation jsonb;
        v_continuation_arguments jsonb;
        v_continuation_depth integer;
        v_continuation_job_id uuid;
        v_completed boolean;
      begin
        select 'temu'::text as channel,
               'inquiries.list'::text as operation
          into v_job;
        ${continuationAndParentCompletionBlock}
        return v_continuation_job_id;
      end $$;
    `);
    const responsePayload = {
      ok: true,
      channel: "temu",
      operation: "inquiries.list",
      continuation: {
        reason: "page_cap_reached",
        arguments: {
          kind: "after_sales",
          includeDetails: true,
          pageNo: 1,
          pageSize: 200,
          detailQueue: [summary(3)],
          sellerpilotPaginationDepth: 1,
        },
      },
    };
    const complete = () => db.query(
      "select public.fixture_temu_completion($1::jsonb, 'succeeded') child_id",
      [JSON.stringify(responsePayload)],
    );
    const firstChild = (await complete()).rows[0].child_id;
    const replayedChild = (await complete()).rows[0].child_id;
    assert.equal(replayedChild, firstChild);
    assert.equal((await db.query(
      "select status from sellerpilot_private.fixture_parent where id = $1",
      [JOB_ID],
    )).rows[0].status, "succeeded");
    const children = (await db.query(`
      select id, request_payload->>'periodicKey' periodic_key
        from sellerpilot_private.channel_gateway_jobs
       where request_payload->>'continuationOf' = $1
    `, [JOB_ID])).rows;
    assert.equal(children.length, 1);
    assert.equal(new Set(children.map((row) => row.id)).size, 1);
    assert.equal(children.length - new Set(children.map((row) => row.id)).size, 0);
  } finally {
    await db.close();
  }
});
