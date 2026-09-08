import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
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

const proposalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.SELLERPILOT_TEMU_INTEGRATED_ROOT?.trim()
  || resolve(proposalRoot, "../../../../..");
const source = (path: string) => resolve(sourceRoot, path);
const read = (path: string) => readFile(source(path), "utf8");

const [
  completionRouteSource,
  historyRouteSource,
  baseGatewayMigration,
  serializedGatewayMigration,
  lineageClaimMigration,
  scopedWorkerMigration,
  atomicCompletionMigration,
  providerRateMigration,
  coverageMigration,
  retryV1Migration,
  retryV2Migration,
  ownerBoundProposal,
] = await Promise.all([
  read("app/api/channel-gateway/worker/complete/route.ts"),
  read("app/api/admin/cs/history-coverage/route.ts"),
  read("supabase/migrations/20260825104500_prepare_gateway_credential_refresh.sql"),
  read("supabase/migrations/20260825111820_serialize_gateway_ledger_transactions.sql"),
  read("supabase/migrations/20260825111840_provider_listing_readback_rebind.sql"),
  read("supabase/migrations/20260826090000_scope_worker_tokens_and_idempotent_ai_completion.sql"),
  read("supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql"),
  read("supabase/migrations/20260907233000_add_provider_rate_budgets.sql"),
  read("supabase/migrations/20260907231000_add_cs_history_coverage_ledger.sql"),
  read("supabase/migrations/20260908140414_cs_temu_durable_detail_retry.sql"),
  read("supabase/migrations/20260908140416_cs_temu_detail_retry_replay.sql"),
  readFile(resolve(proposalRoot, "sql/temu-009-owner-bound-retry-history.sql"), "utf8"),
]);

const gatewayContract = await import(pathToFileURL(source("lib/channels/gateway-contract.ts")).href);
const inquirySync = await import(pathToFileURL(source("lib/channels/inquiry-sync.ts")).href);
const inquiryCoverage = await import(pathToFileURL(source("lib/channels/inquiry-coverage.ts")).href);
const retryRpc = await import(pathToFileURL(source("lib/channels/cs/temu/retry-rpc.ts")).href);
const elevenstWorkerCompletion = await import(pathToFileURL(
  source("lib/channels/cs/elevenst/worker-completion.ts"),
).href);
const historyCoverageContract = await import(pathToFileURL(source("lib/cs/history-coverage.ts")).href);

function createFunction(sql: string, marker: string) {
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `missing function marker: ${marker}`);
  const end = sql.indexOf("\n$$;", start);
  assert.ok(end > start, `missing function terminator: ${marker}`);
  return sql.slice(start, end + 4);
}

function migrationDoBlock(sql: string, diagnostic: string) {
  const diagnosticAt = sql.indexOf(diagnostic);
  assert.ok(diagnosticAt >= 0, `missing migration diagnostic: ${diagnostic}`);
  const start = sql.lastIndexOf("do $migration$", diagnosticAt);
  const end = sql.indexOf("$migration$;", diagnosticAt);
  assert.ok(start >= 0 && end > diagnosticAt, `missing migration block: ${diagnostic}`);
  return sql.slice(start, end + "$migration$;".length);
}

function replaceExactlyOnce(input: string, oldValue: string, newValue: string) {
  const first = input.indexOf(oldValue);
  assert.ok(first >= 0, `missing patch preimage: ${oldValue}`);
  assert.equal(input.indexOf(oldValue, first + oldValue.length), -1, `duplicate patch preimage: ${oldValue}`);
  return input.slice(0, first) + newValue + input.slice(first + oldValue.length);
}

const patchedCompletionRoute = replaceExactlyOnce(
  completionRouteSource,
  '"sellerpilot_service_requeue_temu_after_sales_detail_v2"',
  '"sellerpilot_service_requeue_temu_after_sales_detail_v3"',
);
const patchedHistoryRoute = replaceExactlyOnce(
  historyRouteSource,
  'admin.userClient.rpc("sellerpilot_read_cs_history_coverage_v1")',
  'admin.userClient.rpc("sellerpilot_read_cs_history_coverage_v2", { p_owner_id: admin.user.id })',
);

const compiledCompletionRoute = ts.transpileModule(patchedCompletionRoute, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledHistoryRoute = ts.transpileModule(patchedHistoryRoute, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";
const NON_ADMIN = "10000000-0000-4000-8000-000000000003";
const CREDENTIAL = "20000000-0000-4000-8000-000000000001";
const OTHER_CREDENTIAL = "20000000-0000-4000-8000-000000000002";
const TOKEN_ID = "30000000-0000-4000-8000-000000000001";
const JOB_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_JOB_ID = "40000000-0000-4000-8000-000000000002";
const EXHAUST_JOB_ID = "40000000-0000-4000-8000-000000000003";
const WORKER_TOKEN = `spw_${"temu-v7-fixture-token".repeat(2)}`;
const TOKEN_HASH = createHash("sha256").update(WORKER_TOKEN).digest("hex");

const uuid = (tail: number) => `50000000-0000-4000-8000-${String(tail).padStart(12, "0")}`;
const summary = (number: number) => ({
  parentAfterSalesSn: `AFTER-${number}`,
  parentOrderSn: `ORDER-${number}`,
  afterSalesStatusGroup: 1,
  operateExpireTimeMs: null,
  availableOperateList: [1, "VIEW"],
  returnDeliveryType: null,
  parentAfterSalesStatus: 1,
  updateAt: 1_788_000_000 + number,
  afterSalesType: 2,
  createAt: 1_787_000_000 + number,
});
const queue = [summary(1), summary(2), summary(3)];

function baseArguments(runId: string) {
  return {
    kind: "after_sales",
    includeDetails: true,
    pageNo: 1,
    pageSize: 200,
    afterSalesStatusGroup: 1,
    updateAtStart: 1_787_000_000,
    updateAtEnd: 1_788_000_100,
    sellerpilotHistoryRunId: runId,
  };
}

function retryArguments(runId: string, retryCount: number) {
  return {
    ...baseArguments(runId),
    retryReplayQueue: queue.slice(0, 1),
    detailQueue: queue.slice(1),
    sellerpilotTemuDetailRetryCount: retryCount,
  };
}

function retryPayload(jobId: string, claimToken: string, runId: string, retryCount: number) {
  return {
    jobId,
    claimToken,
    status: "failed",
    error: "Synthetic Temu detail read failed",
    retryContinuation: {
      reason: "retryable_read_failure",
      arguments: retryArguments(runId, retryCount),
      retryCount,
      retryAfterSeconds: 5 * 2 ** (retryCount - 1),
      deferredCount: 2,
      replayCount: 1,
      providerStatus: 503,
    },
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
          buyerComment: `synthetic-comment-${number}`,
          afterSalesReason: `synthetic-reason-${number}`,
          refundAmount: { currencyCode: "USD", amount: String(number) },
          afterSalesStatus: 1,
        }],
      },
    },
  };
}

function successPayload(jobId: string, claimToken: string, count = 3) {
  return {
    jobId,
    claimToken,
    status: "succeeded",
    result: {
      ok: true,
      channel: "temu",
      operation: "inquiries.list",
      steps: Array.from({ length: count }, (_, index) => detailStep(index + 1)),
      safeMessage: "Synthetic Temu detail batch complete",
    },
  };
}

class TestResponse extends Response {
  static json(body: unknown, init: ResponseInit = {}) {
    return new TestResponse(JSON.stringify(body), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
  }
}

function completionRequest(payload: unknown, token = WORKER_TOKEN) {
  return new Request("https://fixture.invalid/api/channel-gateway/worker/complete", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function jsonParameter(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema vault; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function extensions.digest(text, text) returns bytea language sql immutable
      as $$select sha256(convert_to($1, 'UTF8'))$$;
    create function extensions.digest(bytea, text) returns bytea language sql immutable
      as $$select sha256($1)$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer
      set search_path = '' as $$select exists(
        select 1 from sellerpilot_private.admin_users admin where admin.user_id = auth.uid()
      )$$;
    create table vault.secrets(
      id uuid primary key default gen_random_uuid(), secret text not null, name text, description text
    );
    create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      created_by uuid not null references auth.users(id),
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      vault_secret_id uuid references vault.secrets(id)
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,
      token_hash text not null unique,
      scope text not null,
      status text not null,
      expires_at timestamptz not null,
      last_seen_at timestamptz,
      last_version text
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,
      status text,
      http_status integer,
      remote_id text,
      safe_message text,
      completed_at timestamptz
    );
    create table sellerpilot_private.products(
      id uuid primary key,
      status text,
      updated_at timestamptz
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,
      product_id uuid,
      owner_id uuid,
      operation_attempt_id uuid,
      status text,
      remote_id text,
      public_url text,
      last_error text,
      failure_class text,
      published_at timestamptz,
      last_verified_at timestamptz,
      updated_at timestamptz
    );
    create table sellerpilot_private.operation_audit(
      owner_id uuid, action text, entity_type text, entity_id text, safe_detail jsonb
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null,
      response_payload jsonb,
      status text not null default 'queued',
      seller_account_key text,
      request_fingerprint text,
      created_by uuid not null references auth.users(id),
      worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
      claim_token uuid,
      lease_expires_at timestamptz,
      provider_mutation_started_at timestamptz,
      rate_not_before timestamptz,
      attempt_count integer not null default 0,
      error_message text,
      completed_at timestamptz,
      updated_at timestamptz not null default clock_timestamp(),
      started_at timestamptz,
      created_at timestamptz not null default clock_timestamp(),
      credential_refresh_in_flight boolean not null default false,
      credential_refresh_recovery_vault_id uuid,
      oauth_request_vault_id uuid,
      oauth_exchange_completed boolean not null default false,
      prepared_credential_id uuid
    );
    create table sellerpilot_private.captured_inquiries(
      job_owner uuid, credential_id uuid, payload jsonb, captured_at timestamptz default clock_timestamp()
    );
    create function sellerpilot_private.gateway_external_write_observed(text, jsonb)
      returns boolean language sql immutable set search_path = '' as $$select false$$;
    create function public.sellerpilot_record_credential_test(uuid, text, text)
      returns void language sql as $$select$$;
    create function public.sellerpilot_service_ingest_orders(uuid, text, jsonb)
      returns integer language sql as $$select jsonb_array_length($3)$$;
    create function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
      returns integer language plpgsql security definer set search_path = '' as $$
      declare v_owner uuid;
      begin
        select created_by into v_owner from sellerpilot_private.channel_credentials where id = $1;
        insert into sellerpilot_private.captured_inquiries(job_owner, credential_id, payload)
          values(v_owner, $1, $3);
        return jsonb_array_length($3);
      end $$;
    create function public.sellerpilot_service_mark_channel_sync(uuid, text, text, text, text)
      returns void language sql as $$select$$;
    create function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid, uuid, boolean)
      returns void language sql as $$select$$;
    create function public.sellerpilot_service_prepare_gateway_credential_refresh(
      text, uuid, uuid, jsonb, timestamptz, boolean, boolean
    ) returns jsonb language sql as $$select '{"status":"invalid"}'::jsonb$$;
  `);

  const baseClaim = createFunction(
    baseGatewayMigration,
    "create or replace function public.sellerpilot_claim_channel_gateway_job(",
  );
  const serializedClaim = createFunction(
    serializedGatewayMigration,
    "create function public.sellerpilot_claim_channel_gateway_job(",
  );
  const lineageClaim = createFunction(
    lineageClaimMigration,
    "create function public.sellerpilot_claim_channel_gateway_job(",
  );
  const workerScope = createFunction(
    scopedWorkerMigration,
    "create or replace function sellerpilot_private.worker_token_has_scope(",
  );
  const scopedClaim = createFunction(
    scopedWorkerMigration,
    "create function public.sellerpilot_claim_channel_gateway_job(",
  );
  const completeGatewayJob = createFunction(
    baseGatewayMigration,
    "create function public.sellerpilot_complete_channel_gateway_job(",
  );

  await db.exec(baseClaim);
  await db.exec(`
    alter function public.sellerpilot_claim_channel_gateway_job(text, text)
      rename to sellerpilot_11820_claim_gateway_unsafe;
    ${serializedClaim}
    alter function public.sellerpilot_claim_channel_gateway_job(text, text)
      rename to sellerpilot_11840_claim_gateway_unsafe;
    ${lineageClaim}
    ${workerScope}
    alter function public.sellerpilot_claim_channel_gateway_job(text, text)
      rename to sellerpilot_260826_claim_gateway_unscoped;
    ${scopedClaim}
  `);
  await db.exec(migrationDoBlock(
    providerRateMigration,
    "LOCAL_GATEWAY_RATE_BUDGET_CLAIM_SOURCE_DRIFT",
  ));
  await db.exec(completeGatewayJob);
  await db.exec(atomicCompletionMigration);
  await db.exec(coverageMigration);
  await db.exec(retryV1Migration);
  await db.exec(retryV2Migration);
  await db.exec(ownerBoundProposal);

  await db.query("insert into auth.users values($1),($2),($3)", [OWNER, OTHER_OWNER, NON_ADMIN]);
  await db.query("insert into sellerpilot_private.admin_users values($1),($2)", [OWNER, OTHER_OWNER]);
  await db.query(`insert into vault.secrets(id,secret) values
    ($1,$3),($2,$4)`, [
    uuid(901), uuid(902),
    JSON.stringify({ app_key: "synthetic", app_secret: "synthetic", access_token: "synthetic" }),
    JSON.stringify({ app_key: "synthetic-other", app_secret: "synthetic-other", access_token: "synthetic-other" }),
  ]);
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,created_by,channel,environment,status,expires_at,vault_secret_id
  ) values
    ($1,$2,'temu','production','active',clock_timestamp()+interval '1 day',$5),
    ($3,$4,'temu','production','active',clock_timestamp()+interval '1 day',$6)`,
  [CREDENTIAL, OWNER, OTHER_CREDENTIAL, OTHER_OWNER, uuid(901), uuid(902)]);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens(
    id,token_hash,scope,status,expires_at
  ) values($1,$2,'gateway','active',clock_timestamp()+interval '1 day')`, [TOKEN_ID, TOKEN_HASH]);
  return db;
}

async function insertJob(
  db: PGlite,
  { jobId, owner = OWNER, credential = CREDENTIAL, runId = uuid(100) }:
  { jobId: string; owner?: string; credential?: string; runId?: string },
) {
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,created_by
  ) values($1,$2,'temu','inquiries.list','production',$3::jsonb,'queued',$4)`, [
    jobId,
    credential,
    JSON.stringify({
      periodicKey: `inquiries:history:temu:${runId}`,
      arguments: baseArguments(runId),
    }),
    owner,
  ]);
}

async function claim(db: PGlite) {
  return (await db.query(
    "select public.sellerpilot_claim_channel_gateway_job($1,'temu-v7-chain/1') result",
    [TOKEN_HASH],
  )).rows[0].result as Record<string, unknown> | null;
}

async function fastForwardRetryClock(db: PGlite, jobId: string) {
  const scheduled = (await db.query(`select
      extract(epoch from (next_attempt_at-observed_at))::int retry_after,
      retry_count
    from sellerpilot_private.temu_after_sales_detail_retry_ledger
    where job_id=$1 order by retry_count desc limit 1`, [jobId])).rows[0];
  assert.equal(scheduled.retry_after, 5 * 2 ** (Number(scheduled.retry_count) - 1));
  await db.query(
    "update sellerpilot_private.channel_gateway_jobs set rate_not_before=clock_timestamp()-interval '1 millisecond' where id=$1",
    [jobId],
  );
}

function databaseRpc(db: PGlite) {
  return async (name: string, args: Record<string, unknown> = {}) => {
    try {
      let query: string;
      let values: unknown[];
      if (name === "sellerpilot_service_requeue_temu_after_sales_detail_v3") {
        query = `select public.sellerpilot_service_requeue_temu_after_sales_detail_v3(
          $1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9
        ) result`;
        values = [args.p_token_hash, args.p_job_id, args.p_claim_token,
          jsonParameter(args.p_retry_arguments), args.p_retry_count, args.p_retry_after_seconds,
          args.p_deferred_count, args.p_replay_count, args.p_provider_status];
      } else if (name === "sellerpilot_service_gateway_completion_context") {
        query = "select public.sellerpilot_service_gateway_completion_context($1,$2,$3) result";
        values = [args.p_token_hash, args.p_job_id, args.p_claim_token];
      } else if (name === "sellerpilot_service_complete_gateway_transaction") {
        query = `select public.sellerpilot_service_complete_gateway_transaction(
          $1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb
        ) result`;
        values = [args.p_token_hash, args.p_job_id, args.p_claim_token, args.p_status,
          jsonParameter(args.p_response_payload), args.p_error_message,
          jsonParameter(args.p_credential_refresh), jsonParameter(args.p_normalized_orders),
          jsonParameter(args.p_normalized_inquiries), jsonParameter(args.p_diagnostic)];
      } else if (name === "sellerpilot_service_record_cs_history_page_v1") {
        query = `select public.sellerpilot_service_record_cs_history_page_v1(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        ) result`;
        values = [args.p_token_hash, args.p_job_id, args.p_claim_token,
          args.p_provider_contract_version, args.p_provider_row_count,
          args.p_projected_event_count, jsonParameter(args.p_observation_digests),
          args.p_excluded_count, args.p_event_row_comparable, args.p_has_continuation];
      } else {
        throw new Error(`unexpected completion RPC: ${name}`);
      }
      return { data: (await db.query(query, values)).rows[0]?.result ?? null, error: null };
    } catch (error) {
      return {
        data: null,
        error: { code: String((error as { code?: unknown }).code ?? "PGLITE_ERROR"), message: String(error) },
      };
    }
  };
}

function loadCompletionRoute(db: PGlite) {
  const rpc = databaseRpc(db);
  const context = vm.createContext({
    exports: {}, Request, Response: TestResponse, Headers, Buffer, Date, Error, Object,
    process: { env: { SUPABASE_SECRET_KEY: "synthetic-service-key" } },
    console: { error() {}, log() {} },
    require(name: string) {
      if (name === "node:crypto") return { createHash };
      if (name === "@supabase/supabase-js") return { createClient: () => ({ rpc }) };
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
        workerRpcErrorMessage: (status: number) => `synthetic rpc unavailable ${status}`,
        workerRpcErrorStatus: () => 503,
      };
      if (name.endsWith("/lib/channels/cs/temu/retry-rpc")) return retryRpc;
      throw new Error(`unexpected completion import: ${name}`);
    },
  });
  vm.runInContext(compiledCompletionRoute, context, { timeout: 2_000 });
  return context.exports.POST as (request: Request) => Promise<Response>;
}

async function historyRpc(db: PGlite, ownerId: string, name: string, args: Record<string, unknown> = {}) {
  assert.equal(name, "sellerpilot_read_cs_history_coverage_v2");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerId]);
  try {
    await db.exec("set role authenticated");
    const result = (await db.query(
      "select public.sellerpilot_read_cs_history_coverage_v2($1) result",
      [args.p_owner_id],
    )).rows[0].result;
    return { data: result, error: null };
  } catch (error) {
    return { data: null, error: { code: "PGLITE_ERROR", message: String(error) } };
  } finally {
    await db.exec("reset role");
  }
}

function loadHistoryRoute(db: PGlite) {
  const context = vm.createContext({
    exports: {}, Request, Response: TestResponse, Headers, Date, Error, Object,
    console: { error() {}, log() {} },
    require(name: string) {
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name.endsWith("/lib/admin-api")) return {
        authenticateAdminRequest: async (request: Request) => {
          const ownerId = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
          if (![OWNER, OTHER_OWNER].includes(ownerId)) return TestResponse.json({}, { status: 403 });
          return {
            user: { id: ownerId },
            userClient: { rpc: (rpcName: string, args?: Record<string, unknown>) => (
              historyRpc(db, ownerId, rpcName, args)
            ) },
          };
        },
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (name.endsWith("/lib/cs/history-coverage")) return historyCoverageContract;
      throw new Error(`unexpected history import: ${name}`);
    },
  });
  vm.runInContext(compiledHistoryRoute, context, { timeout: 1_000 });
  return context.exports.GET as (request: Request) => Promise<Response>;
}

function historyRequest(ownerId: string) {
  return new Request("https://fixture.invalid/api/admin/cs/history-coverage", {
    headers: { authorization: `Bearer ${ownerId}` },
  });
}

async function assertStatus(response: Response, expected: number) {
  const body = await response.clone().text();
  assert.equal(response.status, expected, body);
}

test("frozen V7 uses current integrated preimages and applies canonical retry v1 then v2", () => {
  assert.equal(createHash("sha256").update(completionRouteSource).digest("hex"),
    "b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383");
  assert.match(retryV1Migration, /temu-after-sales-detail-retry-v1/u);
  assert.match(retryV2Migration, /drop function public\.sellerpilot_service_requeue_temu_after_sales_detail_v1/u);
  assert.match(retryV2Migration, /temu-after-sales-detail-retry-v2/u);
  assert.match(patchedCompletionRoute, /sellerpilot_service_requeue_temu_after_sales_detail_v3/u);
  assert.match(patchedHistoryRoute, /sellerpilot_read_cs_history_coverage_v2/u);
  assert.match(ownerBoundProposal, /created_by = job\.created_by/u);
  assert.match(ownerBoundProposal, /where owner_id = p_owner_id/u);
});

test("one PGlite DB runs partial failure through POST, old-claim replay, real claim, completion and owner GET", async () => {
  const db = await fixture();
  const runId = uuid(101);
  const otherRunId = uuid(102);
  try {
    await insertJob(db, { jobId: JOB_ID, runId });
    const firstClaim = await claim(db);
    assert.equal(firstClaim?.id, JOB_ID);
    assert.equal(firstClaim?.attempt_count, 1);
    const claimToken = String(firstClaim?.claim_token);
    const POST = loadCompletionRoute(db);

    const wrongJob = await POST(completionRequest(retryPayload(uuid(999), claimToken, runId, 1)));
    assert.equal(wrongJob.status, 503);
    const wrongClaim = await POST(completionRequest(retryPayload(JOB_ID, uuid(998), runId, 1)));
    assert.equal(wrongClaim.status, 503);
    assert.equal((await db.query("select status from sellerpilot_private.channel_gateway_jobs where id=$1", [JOB_ID])).rows[0].status, "running");

    const retry = await POST(completionRequest(retryPayload(JOB_ID, claimToken, runId, 1)));
    await assertStatus(retry, 202);
    assert.equal(retry.headers.get("retry-after"), "5");
    assert.equal((await retry.clone().json()).jobCompleted, false);

    const lostResponseReplay = await POST(completionRequest(retryPayload(JOB_ID, claimToken, runId, 1)));
    assert.equal(lostResponseReplay.status, 202);
    assert.equal((await lostResponseReplay.json()).retryReceiptReplayed, true);
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.temu_after_sales_detail_retry_ledger where job_id=$1`, [JOB_ID])).rows[0].count, 1);

    assert.equal(await claim(db), null, "rate_not_before must prevent an early reclaim");
    await fastForwardRetryClock(db, JOB_ID);
    const secondClaim = await claim(db);
    assert.equal(secondClaim?.id, JOB_ID);
    assert.equal(secondClaim?.attempt_count, 2);
    assert.notEqual(secondClaim?.claim_token, claimToken);

    const completion = await POST(completionRequest(successPayload(JOB_ID, String(secondClaim?.claim_token))));
    await assertStatus(completion, 200);
    const terminal = (await db.query(`select status,claim_token,worker_token_id,response_payload
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [JOB_ID])).rows[0];
    assert.equal(terminal.status, "succeeded");
    assert.equal(terminal.claim_token, null);
    assert.equal(terminal.worker_token_id, null);
    assert.equal(terminal.response_payload.ok, true);
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.gateway_completion_receipts where job_id=$1", [JOB_ID])).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.cs_history_scan_pages where job_id=$1", [JOB_ID])).rows[0].count, 1);
    assert.equal((await db.query("select jsonb_array_length(payload)::int count from sellerpilot_private.captured_inquiries where credential_id=$1", [CREDENTIAL])).rows[0].count, 3);

    await insertJob(db, {
      jobId: OTHER_JOB_ID,
      owner: OTHER_OWNER,
      credential: OTHER_CREDENTIAL,
      runId: otherRunId,
    });
    const otherClaim = await claim(db);
    assert.equal(otherClaim?.id, OTHER_JOB_ID);
    const otherCompletion = await POST(completionRequest(
      successPayload(OTHER_JOB_ID, String(otherClaim?.claim_token), 1),
    ));
    await assertStatus(otherCompletion, 200);

    await assert.rejects(db.query(
      "update sellerpilot_private.channel_gateway_jobs set credential_id=$1 where id=$2",
      [OTHER_CREDENTIAL, JOB_ID],
    ), /TEMU_GATEWAY_OWNER_CREDENTIAL_MISMATCH/);

    const GET = loadHistoryRoute(db);
    const ownerResponse = await GET(historyRequest(OWNER));
    await assertStatus(ownerResponse, 200);
    const ownerHistory = await ownerResponse.json();
    assert.deepEqual(ownerHistory.scans.map((scan: { scopeKey: string }) => scan.scopeKey), [
      `inquiries:history:temu:${runId}`,
    ]);
    assert.equal(ownerHistory.scans[0].status, "completed");
    assert.equal(ownerHistory.scans[0].providerRowCount, 3);
    assert.equal(ownerHistory.scans[0].observedUniqueCount, 3);
    assert.deepEqual(ownerHistory.gaps, []);

    const otherResponse = await GET(historyRequest(OTHER_OWNER));
    assert.equal(otherResponse.status, 200);
    const otherHistory = await otherResponse.json();
    assert.deepEqual(otherHistory.scans.map((scan: { scopeKey: string }) => scan.scopeKey), [
      `inquiries:history:temu:${otherRunId}`,
    ]);
    assert.equal((await GET(historyRequest(NON_ADMIN))).status, 403);
  } finally {
    await db.close();
  }
});

test("three scheduled retries exhaust through the actual completion POST and remain an owner-visible gap", async () => {
  const db = await fixture();
  const runId = uuid(103);
  try {
    await insertJob(db, { jobId: EXHAUST_JOB_ID, runId });
    const POST = loadCompletionRoute(db);
    let currentClaim = await claim(db);
    for (let retryCount = 1; retryCount <= 3; retryCount += 1) {
      assert.equal(currentClaim?.id, EXHAUST_JOB_ID);
      const response = await POST(completionRequest(retryPayload(
        EXHAUST_JOB_ID,
        String(currentClaim?.claim_token),
        runId,
        retryCount,
      )));
      await assertStatus(response, 202);
      assert.equal((await response.json()).retryCount, retryCount);
      await fastForwardRetryClock(db, EXHAUST_JOB_ID);
      currentClaim = await claim(db);
    }

    assert.equal(currentClaim?.attempt_count, 4);
    const exhausted = await POST(completionRequest({
      jobId: EXHAUST_JOB_ID,
      claimToken: currentClaim?.claim_token,
      status: "failed",
      error: "Synthetic Temu detail retry exhausted",
    }));
    await assertStatus(exhausted, 200);
    const job = (await db.query(`select status,error_message,attempt_count
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [EXHAUST_JOB_ID])).rows[0];
    assert.deepEqual(job, {
      status: "failed",
      error_message: "Synthetic Temu detail retry exhausted",
      attempt_count: 4,
    });
    assert.deepEqual((await db.query(`select retry_count,outcome
      from sellerpilot_private.temu_after_sales_detail_retry_ledger
      where job_id=$1 order by retry_count`, [EXHAUST_JOB_ID])).rows, [
      { retry_count: 1, outcome: "retry_failed" },
      { retry_count: 2, outcome: "retry_failed" },
      { retry_count: 3, outcome: "retry_exhausted" },
    ]);

    const GET = loadHistoryRoute(db);
    const response = await GET(historyRequest(OWNER));
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.scans.length, 0);
    assert.equal(history.gaps.length, 1);
    assert.equal(history.gaps[0].jobId, EXHAUST_JOB_ID);
    assert.equal(history.gaps[0].terminalStatus, "failed");
    assert.equal(history.gaps[0].resolvedAt, null);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [NON_ADMIN]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.sellerpilot_read_cs_history_coverage_v2($1)", [NON_ADMIN]),
      /owner administrator required/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
