import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});

const integratedRoot = process.env.SELLERPILOT_SHOPEE_INTEGRATED_ROOT?.trim();
const gatewayModule = integratedRoot
  ? pathToFileURL(resolve(integratedRoot, "lib/channels/serverless-gateway.ts")).href
  : "../lib/channels/serverless-gateway.ts";
const { executeServerlessCsProviderJob, runOneServerlessCsGatewayJob } = await import(gatewayModule);
const { withShopeeHistoryContinuation } = await import(
  "../lib/channels/cs/shopee/history-event-evidence.ts"
);
const sourceRoot = integratedRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sql004 = await readFile(resolve(sourceRoot,
  "supabase/migrations/20260908142023_cs_shopee_history_ledger.sql"), "utf8");
const sql007 = await readFile(resolve(sourceRoot,
  "supabase/migrations/20260908142028_cs_shopee_history_start.sql"), "utf8");
const sql009 = await readFile(resolve(sourceRoot,
  "supabase/migrations/20260908142029_cs_shopee_atomic_history_completion.sql"), "utf8");
const sql010 = await readFile(resolve(sourceRoot,
  "supabase/migrations/20260908145331_cs_shopee_history_request_invariants.sql"), "utf8");
const sql012 = await readFile(resolve(sourceRoot,
  "supabase/migrations/20260908151735_cs_shopee_history_date_intent_cutoff.sql"), "utf8");

const owner = "00000000-0000-4000-8000-000000012001";
const credential = "00000000-0000-4000-8000-000000012002";
const worker = "00000000-0000-4000-8000-000000012003";
const vaultId = "00000000-0000-4000-8000-000000012004";
const shopId = "1719148844";
const tokenHash = "synthetic-final-chain-worker-token";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function kstDate(milliseconds = Date.now()) {
  return new Date(milliseconds + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function kstMidnightEpoch(date) {
  return Math.floor(Date.parse(`${date}T00:00:00+09:00`) / 1_000);
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema vault; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,
      environment text not null,version integer not null,status text not null,vault_secret_id uuid
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,status text not null,expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,environment text not null,request_payload jsonb not null,
      status text not null,created_by uuid not null references auth.users(id),claim_token uuid,
      worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),lease_expires_at timestamptz
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),claim_token uuid not null,
      worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id)
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid not null references auth.users(id),channel_key text not null,
      external_ticket_id text not null,demo boolean not null default false,ticket_kind text not null,
      reply_context jsonb not null default '{}'::jsonb,provider_context jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id),channel_key text not null,inbound_key text not null,
      remote_message_id text,provider_context jsonb not null default '{}'::jsonb
    );
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create table sellerpilot_private.channel_market_targets(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),channel text not null,
      environment text not null,target_id text not null,market_code text not null,
      verified_at timestamptz not null default now(),
      unique(owner_id,channel,environment,market_code,target_id)
    );
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select false$$;
    create function public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)
    returns uuid language plpgsql security definer set search_path='' as $$
    declare next_id uuid:=gen_random_uuid();
    begin
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,channel,operation,environment,request_payload,status,created_by
      ) select next_id,$1,$3,$4,current.environment,$5,'queued',current.created_by
          from sellerpilot_private.channel_credentials current where current.id=$1;
      return next_id;
    end $$;
    create function public.sellerpilot_service_complete_serverless_cs_transaction(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
      p_response_payload jsonb default null,p_error_message text default null,
      p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
      p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_job sellerpilot_private.channel_gateway_jobs%rowtype; v_next_id uuid;
    begin
      select job.* into v_job from sellerpilot_private.channel_gateway_jobs job
       join sellerpilot_private.ai_cli_worker_tokens token on token.id=job.worker_token_id
      where job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
        and job.lease_expires_at>clock_timestamp() and token.token_hash=p_token_hash
        and token.status='active' and token.expires_at>clock_timestamp() for update of job;
      if not found then return jsonb_build_object('status','ownership_lost'); end if;
      update sellerpilot_private.channel_gateway_jobs set status=p_status where id=p_job_id;
      insert into sellerpilot_private.gateway_completion_receipts values(p_job_id,p_claim_token,v_job.worker_token_id);
      if p_status='succeeded' and jsonb_typeof(p_response_payload#>'{continuation,arguments}')='object' then
        v_next_id:=gen_random_uuid();
        insert into sellerpilot_private.channel_gateway_jobs(
          id,credential_id,channel,operation,environment,request_payload,status,created_by
        ) values(v_next_id,v_job.credential_id,v_job.channel,v_job.operation,v_job.environment,
          jsonb_set(v_job.request_payload,'{arguments}',p_response_payload#>'{continuation,arguments}'),
          'queued',v_job.created_by);
      end if;
      return jsonb_build_object('status','completed');
    end $$;
    insert into auth.users values('${owner}');
    insert into sellerpilot_private.admin_users values('${owner}');
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${owner}','shopee','production',7,'active','${vaultId}'
    );
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${worker}','${tokenHash}','active',clock_timestamp()+interval '1 day'
    );
    insert into vault.decrypted_secrets values(
      '${vaultId}','{"shopee_targets":[{"type":"shop","id":"${shopId}"}]}'
    );
    insert into sellerpilot_private.channel_market_targets(
      owner_id,credential_id,channel,environment,target_id,market_code
    ) values('${owner}','${credential}','shopee','production','${shopId}','SG');
  `);
  await db.exec(sql004);
  await db.exec(sql007);
  await db.exec(sql009);
  await db.exec(sql010);
  await db.exec(sql012);
  return db;
}

async function start(db, requestKey, fromDate, toDate) {
  return (await db.query(`select public.sellerpilot_service_start_cs_shopee_history_v2(
    $1,$2,$3::date,$4::date
  ) result`, [owner, requestKey, fromDate, toDate])).rows[0].result;
}

async function prepareClaim(db, runId, claimToken, { sequence, expires = true } = {}) {
  const selected = (await db.query(`select id,request_payload from sellerpilot_private.channel_gateway_jobs
    where status='queued' and request_payload#>>'{arguments,sellerpilotShopeeHistoryRunId}'=$1
      and request_payload#>>'{arguments,kind}'='product_review'
    order by id limit 1`, [runId])).rows[0];
  assert.ok(selected);
  if (sequence !== undefined) {
    selected.request_payload.arguments.sellerpilotShopeeHistorySequence = sequence;
    await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=$1 where id=$2",
      [selected.request_payload, selected.id]);
  }
  await db.query(`update sellerpilot_private.channel_gateway_jobs
    set status='running',claim_token=$1,worker_token_id=$2,
        lease_expires_at=clock_timestamp()+($3::text||' seconds')::interval
    where id=$4`, [claimToken, worker, expires ? 3600 : -1, selected.id]);
  return {
    id: selected.id,
    claim_token: claimToken,
    credential_id: credential,
    channel: "shopee",
    operation: "inquiries.list",
    environment: "production",
    request: selected.request_payload,
    credential: {
      partner_id: "2031489", partner_key: "synthetic-partner-key", shop_id: shopId,
      access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-02-01T00:00:00.000Z",
      authorization_expires_at: "2099-03-01T00:00:00.000Z",
      provider_account_identity_version: "v1",
      provider_account_subject: `shopee:shop:${shopId}`,
      shopee_targets: [{
        type: "shop", id: shopId, access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_token_expires_at: "2099-02-01T00:00:00.000Z",
      }],
    },
    attempt_count: 1,
  };
}

function reviewResult(job, commentId, continuation) {
  return {
    ok: true,
    channel: "shopee",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries", ok: true, status: 200,
      data: {
        sellerpilotProviderContext: { shopId },
        response: {
          item_comment_list: [{
            comment_id: commentId, item_id: 902, buyer_username: "synthetic-buyer",
            comment: "synthetic review", create_time: 1_788_000_000,
          }],
          more: Boolean(continuation), next_cursor: continuation ? "opaque-next" : "",
        },
      },
    }],
    ...(continuation ? { continuation: { reason: "page_cap_reached", arguments: continuation } } : {}),
    safeMessage: "synthetic Shopee review page",
  };
}

function dbRpc(db, job) {
  let claimed = false;
  return async (name, arguments_ = {}) => {
    try {
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        if (claimed) return { data: null, error: null };
        claimed = true;
        return { data: job, error: null };
      }
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
        return { data: { contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0 }, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") {
        const running = (await db.query(`select exists(select 1 from sellerpilot_private.channel_gateway_jobs
          where id=$1 and claim_token=$2 and status='running' and lease_expires_at>clock_timestamp()) ok`,
        [job.id, job.claim_token])).rows[0].ok;
        return { data: running ? "running" : "ownership_lost", error: null };
      }
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        const current = (await db.query(`select status,channel,operation from sellerpilot_private.channel_gateway_jobs
          where id=$1 and claim_token=$2`, [job.id, job.claim_token])).rows[0];
        return { data: current ? { ...current, normalization_timestamp: "2026-09-08T00:00:00.000Z" } : null, error: null };
      }
      if (name === "sellerpilot_service_record_cs_history_page_v1") {
        return { data: { contract: "cs_history_coverage_v1", status: "completed", jobId: job.id }, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_shopee_history_v1") {
        const result = (await db.query(`select public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
          $1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb
        ) result`, [
          arguments_.p_token_hash, arguments_.p_job_id, arguments_.p_claim_token,
          arguments_.p_status, JSON.stringify(arguments_.p_response_payload), arguments_.p_error_message,
          JSON.stringify(arguments_.p_credential_refresh), JSON.stringify(arguments_.p_normalized_orders),
          JSON.stringify(arguments_.p_normalized_inquiries), JSON.stringify(arguments_.p_diagnostic),
          arguments_.p_history_run_id, JSON.stringify(arguments_.p_history_event),
        ])).rows[0].result;
        return { data: result, error: null };
      }
      return { data: null, error: { code: "UNEXPECTED_RPC" } };
    } catch (error) {
      return { data: null, error: { code: String(error?.message ?? error).slice(0, 32) } };
    }
  };
}

async function runWorker(db, job, executeProvider) {
  return runOneServerlessCsGatewayJob({
    rpc: dbRpc(db, job), executeProvider, heartbeatIntervalMs: 60_000, logError: () => {},
  }, tokenHash);
}

test("database fixes the first KST-today cutoff across response loss and next-day retry state", async () => {
  const db = await fixture();
  const today = kstDate();
  const yesterday = kstDate(Date.now() - 86_400_000);
  const requestKey = uuid(12101);
  try {
    const before = Math.floor(Date.now() / 1_000);
    const first = await start(db, requestKey, today, today);
    const firstIntent = (await db.query(`select from_epoch,cutoff_epoch,from_date::text,to_date::text
      from sellerpilot_private.cs_shopee_history_request_intents where owner_id=$1 and request_key=$2`,
    [owner, requestKey])).rows[0];
    assert.equal(first.status, "queued");
    assert.equal(firstIntent.from_epoch, kstMidnightEpoch(today));
    assert.ok(Number(firstIntent.cutoff_epoch) >= before && Number(firstIntent.cutoff_epoch) <= Math.floor(Date.now() / 1_000));
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const replay = await start(db, requestKey, today, today);
    const replayIntent = (await db.query(`select cutoff_epoch from sellerpilot_private.cs_shopee_history_request_intents
      where owner_id=$1 and request_key=$2`, [owner, requestKey])).rows[0];
    assert.equal(replay.status, "reused");
    assert.equal(replay.queuedJobCount, 0);
    assert.equal(replayIntent.cutoff_epoch, firstIntent.cutoff_epoch);
    assert.equal((await db.query(`select to_epoch from sellerpilot_private.cs_shopee_history_start_requests
      where owner_id=$1 and request_key=$2`, [owner, requestKey])).rows[0].to_epoch, firstIntent.cutoff_epoch);
    await assert.rejects(start(db, requestKey, yesterday, today), /SHOPEE_HISTORY_DATE_INTENT_REUSE_MISMATCH/);

    const nextDayRetryKey = uuid(12102);
    const previousMidnight = kstMidnightEpoch(yesterday);
    const firstDayCutoff = previousMidnight + 12 * 60 * 60;
    await db.query(`insert into sellerpilot_private.cs_shopee_history_request_intents(
      owner_id,request_key,from_date,to_date,from_epoch,cutoff_epoch
    ) values($1,$2,$3::date,$3::date,$4,$5)`,
    [owner, nextDayRetryKey, yesterday, previousMidnight, firstDayCutoff]);
    const nextDayReplay = await start(db, nextDayRetryKey, yesterday, yesterday);
    assert.equal(nextDayReplay.status, "queued");
    assert.equal((await db.query(`select to_epoch from sellerpilot_private.cs_shopee_history_start_requests
      where owner_id=$1 and request_key=$2`, [owner, nextDayRetryKey])).rows[0].to_epoch, firstDayCutoff);
  } finally { await db.close(); }
});

test("final 004-007-009-010-012 chain records worker page, continuation and interruption atomically", async () => {
  const db = await fixture();
  const today = kstDate();
  try {
    const runId = (await start(db, uuid(12201), today, today)).historyRunId;
    const firstClaim = await prepareClaim(db, runId, uuid(12301));
    const firstArguments = firstClaim.request.arguments;
    const continuation = withShopeeHistoryContinuation(firstArguments, {
      ...firstArguments,
      cursor: "opaque-next",
      sellerpilotPaginationDepth: 1,
      sellerpilotPaginationEpoch: 0,
      sellerpilotPaginationTrail: ["a".repeat(64)],
    });
    const firstResponse = await runWorker(db, firstClaim, async () => reviewResult(firstClaim, 7001, continuation));
    assert.equal(firstResponse.status, 200, await firstResponse.text());
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events")).rows[0].n, 1);

    const secondClaim = await prepareClaim(db, runId, uuid(12302));
    assert.equal(secondClaim.request.arguments.sellerpilotShopeeHistorySequence, 2);
    assert.equal(secondClaim.request.arguments.sellerpilotShopeeInputCheckpointDigest,
      continuation.sellerpilotShopeeInputCheckpointDigest);
    const secondResponse = await runWorker(db, secondClaim, async () => reviewResult(secondClaim, 7002, null));
    assert.equal(secondResponse.status, 200, await secondResponse.text());
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events")).rows[0].n, 2);

    const interruptedRun = (await start(db, uuid(12202), today, today)).historyRunId;
    const interruptedClaim = await prepareClaim(db, interruptedRun, uuid(12303));
    const interruptedResponse = await runWorker(db, interruptedClaim, input =>
      executeServerlessCsProviderJob(input, async () => ({
        ok: false, channel: "shopee", operation: "inquiries.list",
        steps: [{ name: "inquiries", ok: false, status: 403, data: {
          sellerpilotProviderContext: { shopId },
        } }],
        safeMessage: "synthetic authorization denial",
      })));
    assert.equal(interruptedResponse.status, 200, await interruptedResponse.text());
    const interrupted = (await db.query(`select event_type,event_payload->>'reason' reason
      from sellerpilot_private.cs_shopee_history_events where job_id=$1`, [interruptedClaim.id])).rows[0];
    assert.deepEqual(interrupted, { event_type: "interruption", reason: "authorization_required" });
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts")).rows[0].n, 3);
  } finally { await db.close(); }
});

test("bad worker metadata and expired lease store no receipt, event or continuation", async () => {
  const db = await fixture();
  const today = kstDate();
  try {
    const metadataRun = (await start(db, uuid(12401), today, today)).historyRunId;
    const badMetadata = await prepareClaim(db, metadataRun, uuid(12501), { sequence: 2 });
    const metadataResponse = await runWorker(db, badMetadata, async () => reviewResult(badMetadata, 7101, null));
    assert.equal(metadataResponse.status, 503);
    assert.equal((await db.query("select status from sellerpilot_private.channel_gateway_jobs where id=$1", [badMetadata.id])).rows[0].status, "running");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts where job_id=$1", [badMetadata.id])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events where job_id=$1", [badMetadata.id])).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotShopeeHistoryRunId}'=$1 and status='queued'`, [metadataRun])).rows[0].n, 1);

    const leaseRun = (await start(db, uuid(12402), today, today)).historyRunId;
    const expired = await prepareClaim(db, leaseRun, uuid(12502), { expires: false });
    let providerCalled = false;
    const leaseResponse = await runWorker(db, expired, async () => {
      providerCalled = true;
      return reviewResult(expired, 7102, null);
    });
    assert.equal(leaseResponse.status, 409);
    assert.equal(providerCalled, false);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts where job_id=$1", [expired.id])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events where job_id=$1", [expired.id])).rows[0].n, 0);
  } finally { await db.close(); }
});
