import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import ts from "typescript";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const integratedRoot = repositoryRoot;
const canonicalMap = {"smartstore-003-order-binding-health-v2.sql": "supabase/migrations/20260908140403_cs_smartstore_order_binding_v2.sql", "smartstore-004-next-history-window-v1.sql": "supabase/migrations/20260908140405_cs_smartstore_history_checkpoint.sql", "smartstore-005-exact-history-window-v5.sql": "supabase/migrations/20260908140407_cs_smartstore_exact_history_window_v5.sql", "smartstore-007-checkpoint-run-scope-v2.sql": "supabase/migrations/20260908142530_cs_smartstore_checkpoint_run_scope_v2.sql", "smartstore-008-explicit-coverage-bounds-v1.sql": "supabase/migrations/20260908151019_cs_smartstore_explicit_coverage_bounds.sql", "smartstore-008-exact-history-window-v6.sql": "supabase/migrations/20260908151022_cs_smartstore_exact_history_window_v6.sql", "smartstore-008-checkpoint-full-day-v3.sql": "supabase/migrations/20260908151024_cs_smartstore_checkpoint_full_day_v3.sql", "smartstore-009-continuation-safe-window-v7.sql": "supabase/migrations/20260908155617_cs_smartstore_continuation_safe_window_v7.sql", "smartstore-009-checkpoint-deferred-cutoff-v4.sql": "supabase/migrations/20260908155620_cs_smartstore_checkpoint_deferred_cutoff_v4.sql"};
const operator = "00000000-0000-4000-8000-000000000900";
const seller = "00000000-0000-4000-8000-000000000901";
const credential = "00000000-0000-4000-8000-000000000902";
const otherSeller = "00000000-0000-4000-8000-000000000903";
const otherCredential = "00000000-0000-4000-8000-000000000904";
const tokenId = "00000000-0000-4000-8000-000000000905";
const tokenHash = "smartstore-v7-test-token";
let claimSequence = 100;

const readProposal = name => readFile(new URL("../" + canonicalMap[name], import.meta.url), "utf8");
const coverageSql = await readFile(new URL(
  "../supabase/migrations/20260907231000_add_cs_history_coverage_ledger.sql",
  import.meta.url,
), "utf8");
const enqueueV5Sql = await readProposal("smartstore-005-exact-history-window-v5.sql");
const checkpointV1Sql = await readProposal("smartstore-004-next-history-window-v1.sql");
const checkpointV2Sql = await readProposal("smartstore-007-checkpoint-run-scope-v2.sql");
const explicitCoverageSql = await readProposal("smartstore-008-explicit-coverage-bounds-v1.sql");
const enqueueV6Sql = await readProposal("smartstore-008-exact-history-window-v6.sql");
const checkpointV3Sql = await readProposal("smartstore-008-checkpoint-full-day-v3.sql");
const enqueueV7Sql = await readProposal("smartstore-009-continuation-safe-window-v7.sql");
const checkpointV4Sql = await readProposal("smartstore-009-checkpoint-deferred-cutoff-v4.sql");

function atInstant(source, needle, instant) {
  assert.ok(source.includes(needle), `missing clock needle: ${needle}`);
  return source.replace(needle, `v_now timestamptz:=timestamptz '${instant}';`);
}

function v6At(instant) {
  return atInstant(
    enqueueV6Sql,
    "v_now timestamptz := date_trunc('milliseconds',clock_timestamp());",
    instant,
  );
}

function v7At(instant) {
  return atInstant(
    enqueueV7Sql,
    "v_now timestamptz := date_trunc('milliseconds',clock_timestamp());",
    instant,
  );
}

function v4At(instant) {
  return atInstant(checkpointV4Sql, "v_now timestamptz:=statement_timestamp();", instant);
}

function v3At(instant) {
  return checkpointV3Sql.replace(
    "create function public.sellerpilot_next_smartstore_history_window_v3",
    "create or replace function public.sellerpilot_next_smartstore_history_window_v3",
  ).replace(
    "v_now timestamptz := statement_timestamp();",
    `v_now timestamptz := timestamptz '${instant}';`,
  );
}

async function fixture(instant) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create table auth.users(id uuid primary key);
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean
      language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table sellerpilot_private.serverless_static_egress_policy(
      channel text primary key,enabled boolean not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),
      channel text not null,environment text not null,status text not null,
      expires_at timestamptz,seller_account_key text,seller_account_key_source text,
      seller_account_verified_at timestamptz,version integer,created_at timestamptz
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,scope text,status text,expires_at timestamptz
    );
    create table sellerpilot_private.inquiry_history_backfill_runs(
      id uuid primary key default gen_random_uuid(),request_key text not null unique,
      owner_id uuid not null,initiated_by uuid,history_days integer not null,
      range_start date not null,range_end date not null,status text not null default 'queued',
      expected_initial_jobs integer not null,total_jobs integer not null default 0,
      queued_jobs integer not null default 0,running_jobs integer not null default 0,
      succeeded_jobs integer not null default 0,failed_jobs integer not null default 0,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      completed_at timestamptz,channels text[] not null,credential_ids jsonb not null,
      constraint inquiry_history_backfill_runs_history_days_check check(history_days between 7 and 30),
      check(range_end-range_start=history_days-1)
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null,response_payload jsonb,status text not null default 'queued',
      created_by uuid not null references auth.users(id),started_at timestamptz,
      created_at timestamptz not null default now(),completed_at timestamptz,
      updated_at timestamptz not null default now(),attempt_count integer not null default 0,
      credential_refresh_in_flight boolean not null default false,
      credential_refresh_recovery_vault_id uuid,worker_token_id uuid,claim_token uuid,
      lease_expires_at timestamptz,error_message text
    );
    create unique index channel_gateway_jobs_history_initial_item_idx
      on sellerpilot_private.channel_gateway_jobs(
        ((request_payload#>>'{arguments,sellerpilotHistoryRunId}')),channel,
        ((request_payload#>>'{arguments,sellerpilotHistoryItemKey}'))
      ) where nullif(request_payload#>>'{arguments,sellerpilotHistoryRunId}','') is not null
        and nullif(request_payload#>>'{arguments,sellerpilotHistoryItemKey}','') is not null
        and nullif(request_payload->>'continuationOf','') is null;
    create unique index channel_gateway_jobs_continuation_once_idx
      on sellerpilot_private.channel_gateway_jobs((request_payload->>'continuationOf'))
      where nullif(request_payload->>'continuationOf','') is not null;
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
      claim_token uuid not null,worker_token_id uuid not null
        references sellerpilot_private.ai_cli_worker_tokens(id)
    );

    create function sellerpilot_private.refresh_inquiry_history_backfill_run(p_run_id uuid)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare
      v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
      v_total integer;v_queued integer;v_running integer;v_succeeded integer;
      v_failed integer;v_status text;
    begin
      select count(*)::integer,count(*) filter(where status='queued')::integer,
        count(*) filter(where status='running')::integer,
        count(*) filter(where status='succeeded')::integer,
        count(*) filter(where status in('failed','cancelled','reconciliation_required'))::integer
        into v_total,v_queued,v_running,v_succeeded,v_failed
        from sellerpilot_private.channel_gateway_jobs
       where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text;
      select * into v_run from sellerpilot_private.inquiry_history_backfill_runs
       where id=p_run_id for update;
      v_status:=case
        when v_total>=v_run.expected_initial_jobs and v_queued=0 and v_running=0 and v_failed=0 then 'succeeded'
        when v_total>=v_run.expected_initial_jobs and v_queued=0 and v_running=0 and v_failed>0 then 'failed'
        when v_running>0 or v_succeeded>0 or v_failed>0 then 'running'
        else 'queued' end;
      update sellerpilot_private.inquiry_history_backfill_runs set
        status=v_status,total_jobs=v_total,queued_jobs=v_queued,running_jobs=v_running,
        succeeded_jobs=v_succeeded,failed_jobs=v_failed,
        completed_at=case when v_status in('succeeded','failed') then now() else null end,
        updated_at=now() where id=p_run_id returning * into v_run;
      return jsonb_build_object('runId',v_run.id,'status',v_run.status,
        'historyDays',v_run.history_days,'fromDate',v_run.range_start,
        'toDate',v_run.range_end,'channels',to_jsonb(v_run.channels),
        'expectedInitialJobs',v_run.expected_initial_jobs,'totalJobs',v_run.total_jobs,
        'queuedJobs',v_run.queued_jobs,'runningJobs',v_run.running_jobs,
        'succeededJobs',v_run.succeeded_jobs,'failedJobs',v_run.failed_jobs);
    end$$;
    create function sellerpilot_private.enqueue_inquiry_history_backfill_item(
      p_run_id uuid,p_channel text,p_item_key text,p_arguments jsonb
    ) returns uuid language plpgsql security definer set search_path='' as $$
    declare v_job uuid;v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
      v_credential uuid;
    begin
      select * into v_run from sellerpilot_private.inquiry_history_backfill_runs where id=p_run_id;
      v_credential:=(v_run.credential_ids->>'smartstore')::uuid;
      insert into sellerpilot_private.channel_gateway_jobs(
        created_by,credential_id,channel,environment,operation,request_payload
      ) values(v_run.owner_id,v_credential,p_channel,'production','inquiries.list',
        jsonb_build_object(
          'periodicKey',format('inquiries:history:%s:%s:%s',p_run_id,p_channel,p_item_key),
          'arguments',p_arguments||jsonb_build_object(
            'sellerpilotHistoryRunId',p_run_id::text,'sellerpilotHistoryItemKey',p_item_key
          )
        )) returning id into v_job;
      return v_job;
    end$$;
    create function sellerpilot_private.inherit_inquiry_history_backfill_tags()
    returns trigger language plpgsql set search_path='' as $$
    declare v_parent sellerpilot_private.channel_gateway_jobs%rowtype;
    begin
      if nullif(new.request_payload->>'continuationOf','') is null then return new; end if;
      select * into v_parent from sellerpilot_private.channel_gateway_jobs parent
       where parent.id=(new.request_payload->>'continuationOf')::uuid
         and parent.created_by=new.created_by;
      if not found then return new; end if;
      new.request_payload:=jsonb_set(jsonb_set(new.request_payload,
        '{arguments,sellerpilotHistoryRunId}',
        to_jsonb(v_parent.request_payload#>>'{arguments,sellerpilotHistoryRunId}'),true),
        '{arguments,sellerpilotHistoryItemKey}',
        to_jsonb(v_parent.request_payload#>>'{arguments,sellerpilotHistoryItemKey}'),true);
      return new;
    end$$;
    create trigger inherit_inquiry_history_backfill_tags
      before insert on sellerpilot_private.channel_gateway_jobs
      for each row execute function sellerpilot_private.inherit_inquiry_history_backfill_tags();

    insert into auth.users values('${operator}'),('${seller}'),('${otherSeller}');
    insert into sellerpilot_private.admin_users values('${operator}');
    insert into sellerpilot_private.serverless_static_egress_policy values('smartstore',true);
    insert into sellerpilot_private.channel_credentials values
      ('${credential}','${seller}','smartstore','production','active',null,
       'seller-a','credential_incarnation_v1',now(),1,now()),
      ('${otherCredential}','${otherSeller}','smartstore','sandbox','active',null,
       'seller-b','credential_incarnation_v1',now(),1,now());
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${tokenId}','${tokenHash}','gateway','active',now()+interval '1 day'
    );
    select set_config('request.jwt.claim.sub','${operator}',false);
  `);
  await db.exec(coverageSql);
  await db.exec(enqueueV5Sql);
  await db.exec(explicitCoverageSql);
  await db.exec(v6At(instant));
  await db.exec(enqueueV7Sql.includes("clock_timestamp") ? v7At(instant) : enqueueV7Sql);
  await db.exec(checkpointV1Sql);
  await db.exec(checkpointV2Sql);
  await db.exec(v3At(instant));
  await db.exec(v4At(instant));
  return db;
}

async function installAt(db, instant) {
  await db.exec(v6At(instant));
  await db.exec(v7At(instant));
  await db.exec(v4At(instant));
}

async function start(db, fromDate, throughDate) {
  await db.exec("set role authenticated");
  try {
    return (await db.query(
      "select public.sellerpilot_start_smartstore_inquiry_history_window_v7($1,$2,$3,'production') result",
      [fromDate, throughDate, credential],
    )).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function checkpoint(db, floorDate, throughDate) {
  await db.exec("set role authenticated");
  try {
    return (await db.query(
      "select public.sellerpilot_next_smartstore_history_window_v4($1,$2,$3,'production') result",
      [floorDate, throughDate, credential],
    )).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function roots(db, runId) {
  return (await db.query(`select id,request_payload from sellerpilot_private.channel_gateway_jobs
    where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1
      and request_payload->>'continuationOf' is null
    order by request_payload#>>'{arguments,kind}'`, [runId])).rows;
}

async function insertContinuation(db, parentId, overrides = {}) {
  const parent = (await db.query(
    "select * from sellerpilot_private.channel_gateway_jobs where id=$1",
    [parentId],
  )).rows[0];
  const parentDepth = Number(parent.request_payload.arguments.sellerpilotPaginationDepth ?? 0);
  const depth = overrides.depth ?? parentDepth + 1;
  const args = structuredClone(parent.request_payload.arguments);
  delete args.sellerpilotHistoryRunId;
  delete args.sellerpilotHistoryItemKey;
  args.sellerpilotPaginationDepth = depth;
  args.query = { ...args.query, page: Number(args.query.page ?? 1) + 1 };
  const payload = {
    periodicKey: `continuation:${parentId}:${depth}`,
    continuationOf: overrides.continuationOf ?? parentId,
    arguments: { ...args, ...(overrides.arguments ?? {}) },
  };
  const id = overrides.id ?? crypto.randomUUID();
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,created_by,
    attempt_count,completed_at,error_message
  ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,
    case when $7='failed' then now() else null end,
    case when $7='failed' then 'fixture failure' else null end)`, [
    id,
    overrides.credentialId ?? parent.credential_id,
    overrides.channel ?? parent.channel,
    overrides.operation ?? parent.operation,
    overrides.environment ?? parent.environment,
    payload,
    overrides.status ?? "queued",
    overrides.ownerId ?? parent.created_by,
    overrides.attemptCount ?? 0,
  ]);
  return id;
}

async function recordSucceededPage(db, jobId, hasContinuation = false) {
  const claim = `00000000-0000-4000-9000-${String(claimSequence++).padStart(12, "0")}`;
  await db.query(`update sellerpilot_private.channel_gateway_jobs set
    status='succeeded',response_payload=$2,started_at=now()-interval '1 minute',
    completed_at=now(),updated_at=now() where id=$1`, [
    jobId,
    hasContinuation
      ? { ok: true, operation: "inquiries.list", continuation: { next: true } }
      : { ok: true, operation: "inquiries.list" },
  ]);
  await db.query(
    "insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)",
    [jobId, claim, tokenId],
  );
  await db.exec("set role service_role");
  try {
    return (await db.query(`select public.sellerpilot_service_record_cs_history_page_v1(
      $1,$2,$3,'sellerpilot-inquiry-coverage/1',0,0,'[]'::jsonb,0,true,$4
    ) result`, [tokenHash, jobId, claim, hasContinuation])).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function refresh(db, runId) {
  return (await db.query(
    "select sellerpilot_private.refresh_inquiry_history_backfill_run($1) result",
    [runId],
  )).rows[0].result;
}

async function completeOnePageRun(db, runId) {
  for (const root of await roots(db, runId)) await recordSucceededPage(db, root.id, false);
  return refresh(db, runId);
}

test("v7 accepts a valid page2+ lineage and the recorder/checkpoint use its root scope", async () => {
  const db = await fixture("2024-08-03 00:05:00+09");
  try {
    const run = await start(db, "2024-08-01", "2024-08-01");
    const initial = await roots(db, run.runId);
    const customer = initial.find(job => job.request_payload.arguments.kind === "customer");
    const product = initial.find(job => job.request_payload.arguments.kind === "product");
    await recordSucceededPage(db, customer.id, false);
    await recordSucceededPage(db, product.id, true);
    const page2 = await insertContinuation(db, product.id);
    await recordSucceededPage(db, page2, true);
    const page3 = await insertContinuation(db, page2);
    await recordSucceededPage(db, page3, false);
    assert.equal((await refresh(db, run.runId)).status, "succeeded");
    await assert.rejects(db.query(
      "select public.sellerpilot_start_smartstore_inquiry_history_window_v6('2024-08-01','2024-08-01',$1,'production')",
      [credential],
    ), /SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH/);
    const reused = await start(db, "2024-08-01", "2024-08-01");
    assert.equal(reused.reused, true);
    assert.equal(reused.retriedJobs, 0);
    assert.equal(reused.totalJobs, 4);
    const scans = (await db.query(`select root_job_id,ticket_kind,page_count,status
      from sellerpilot_private.cs_history_scans order by ticket_kind`)).rows;
    assert.deepEqual(scans.map(scan => [scan.ticket_kind, scan.page_count, scan.status]), [
      ["customer", 1, "completed"], ["product", 3, "completed"],
    ]);
    assert.equal(scans.find(scan => scan.ticket_kind === "product").root_job_id, product.id);
    assert.equal((await checkpoint(db, "2024-08-01", "2024-08-01")).complete, true);
  } finally {
    await db.close();
  }
});

test("v7 resumes only a failed page2 and preserves succeeded roots", async () => {
  const db = await fixture("2024-08-03 00:05:00+09");
  try {
    const run = await start(db, "2024-08-01", "2024-08-01");
    const initial = await roots(db, run.runId);
    const customer = initial.find(job => job.request_payload.arguments.kind === "customer");
    const product = initial.find(job => job.request_payload.arguments.kind === "product");
    await recordSucceededPage(db, customer.id, false);
    await recordSucceededPage(db, product.id, true);
    const page2 = await insertContinuation(db, product.id, { status: "failed", attemptCount: 1 });
    assert.equal((await refresh(db, run.runId)).status, "failed");
    const resumed = await start(db, "2024-08-01", "2024-08-01");
    assert.equal(resumed.reused, true);
    assert.equal(resumed.retriedJobs, 1);
    const states = (await db.query(`select id,status from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1`, [run.runId])).rows;
    assert.equal(states.find(job => job.id === page2).status, "queued");
    assert.ok(states.filter(job => job.id !== page2).every(job => job.status === "succeeded"));
    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      status='succeeded',response_payload='{"ok":true,"operation":"inquiries.list"}'::jsonb,
      started_at=now()-interval '1 minute',completed_at=now(),updated_at=now()
      where id=$1`, [page2]);
    assert.equal((await refresh(db, run.runId)).status, "succeeded");
    assert.equal((await checkpoint(db, "2024-08-01", "2024-08-01")).complete, false);
    await recordSucceededPage(db, page2, false);
    assert.equal((await refresh(db, run.runId)).status, "succeeded");
    assert.equal((await checkpoint(db, "2024-08-01", "2024-08-01")).complete, true);
  } finally {
    await db.close();
  }
});

test("KNOWN DEFECT: v7 retries a failed child without retiring its prior completion receipt", async () => {
  const db = await fixture("2024-08-03 00:05:00+09");
  try {
    const run = await start(db, "2024-08-01", "2024-08-01");
    const initial = await roots(db, run.runId);
    const customer = initial.find(job => job.request_payload.arguments.kind === "customer");
    const product = initial.find(job => job.request_payload.arguments.kind === "product");
    await recordSucceededPage(db, customer.id, false);
    await recordSucceededPage(db, product.id, true);
    const child = await insertContinuation(db, product.id, { status: "failed", attemptCount: 1 });
    const oldClaim = "00000000-0000-4000-9000-000000000099";
    // Model the receipt persisted by atomic failed completion; this is a storage
    // contract probe, not a claim that the fixture ran the production POST.
    await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)",
      [child, oldClaim, tokenId]);
    assert.equal((await refresh(db, run.runId)).status, "failed");
    assert.equal((await start(db, "2024-08-01", "2024-08-01")).retriedJobs, 1);
    assert.equal((await db.query("select claim_token from sellerpilot_private.gateway_completion_receipts where job_id=$1", [child])).rows[0].claim_token, oldClaim);
    await assert.rejects(recordSucceededPage(db, child, false), error => error.code === "23505");
  } finally {
    await db.close();
  }
});

test("duplicate roots and forged tagged children fail closed", async () => {
  const duplicateDb = await fixture("2024-08-03 00:05:00+09");
  try {
    const run = await start(duplicateDb, "2024-08-01", "2024-08-01");
    const product = (await roots(duplicateDb, run.runId))
      .find(job => job.request_payload.arguments.kind === "product");
    await assert.rejects(duplicateDb.query(`insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,status,created_by
    ) select credential_id,channel,operation,environment,request_payload,'queued',created_by
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [product.id]), /unique/);
    await duplicateDb.exec("drop index sellerpilot_private.channel_gateway_jobs_history_initial_item_idx");
    await duplicateDb.query(`insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,status,created_by
    ) select credential_id,channel,operation,environment,request_payload,'queued',created_by
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [product.id]);
    await assert.rejects(start(duplicateDb, "2024-08-01", "2024-08-01"),
      /SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH/);
  } finally {
    await duplicateDb.close();
  }

  const forgedDb = await fixture("2024-08-03 00:05:00+09");
  try {
    const run = await start(forgedDb, "2024-08-01", "2024-08-01");
    const product = (await roots(forgedDb, run.runId))
      .find(job => job.request_payload.arguments.kind === "product");
    const args = { ...product.request_payload.arguments, sellerpilotPaginationDepth: 1 };
    await forgedDb.query(`insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,status,created_by
    ) values($1,'smartstore','inquiries.list','production',$2,'queued',$3)`, [
      credential,
      {
        periodicKey: "continuation:00000000-0000-4000-8000-000000000999:1",
        continuationOf: "00000000-0000-4000-8000-000000000999",
        arguments: args,
      },
      seller,
    ]);
    await assert.rejects(start(forgedDb, "2024-08-01", "2024-08-01"),
      /SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH/);
  } finally {
    await forgedDb.close();
  }
});

test("v7 retry is isolated from an unrelated seller and run", async () => {
  const db = await fixture("2024-08-03 00:05:00+09");
  try {
    const run = await start(db, "2024-08-01", "2024-08-01");
    const unrelatedRun = crypto.randomUUID();
    const unrelatedJob = crypto.randomUUID();
    await db.query(`insert into sellerpilot_private.inquiry_history_backfill_runs(
      id,request_key,owner_id,initiated_by,history_days,range_start,range_end,status,
      expected_initial_jobs,total_jobs,queued_jobs,running_jobs,succeeded_jobs,failed_jobs,
      completed_at,channels,credential_ids
    ) values($1,$2,$3,$4,1,'2024-07-01','2024-07-01','failed',2,1,0,0,0,1,now(),
      array['smartstore']::text[],jsonb_build_object('smartstore',$5::text))`, [
      unrelatedRun, "f".repeat(64), otherSeller, operator, otherCredential,
    ]);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,status,created_by,
      attempt_count,completed_at,error_message
    ) values($1,$2,'smartstore','inquiries.list','sandbox',$3,'failed',$4,1,now(),'other')`, [
      unrelatedJob,
      otherCredential,
      {
        periodicKey: `inquiries:history:${unrelatedRun}:smartstore:product:2024-07-01:2024-07-01`,
        arguments: {
          sellerpilotHistoryRunId: unrelatedRun,
          sellerpilotHistoryItemKey: "product:2024-07-01:2024-07-01",
          kind: "product",
        },
      },
      otherSeller,
    ]);
    const reused = await start(db, "2024-08-01", "2024-08-01");
    assert.equal(reused.runId, run.runId);
    assert.equal(reused.retriedJobs, 0);
    assert.equal((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [unrelatedJob],
    )).rows[0].status, "failed");
  } finally {
    await db.close();
  }
});

test("v7 and v4 are the only authenticated contracts and private validators stay private", async () => {
  const db = await fixture("2024-08-03 00:05:00+09");
  try {
    for (const signature of [
      "public.sellerpilot_start_smartstore_inquiry_history_window_v6(date,date,uuid,text)",
      "public.sellerpilot_next_smartstore_history_window_v3(date,date,uuid,text)",
      "sellerpilot_private.smartstore_history_run_lineage_valid_v1(uuid,uuid,uuid,text,date,date,text)",
      "sellerpilot_private.smartstore_history_run_reconciled_v1(uuid,uuid,uuid,text,date,date,text)",
    ]) {
      assert.equal((await db.query(
        "select has_function_privilege('authenticated',$1,'execute') allowed",
        [signature],
      )).rows[0].allowed, false);
    }
    for (const signature of [
      "public.sellerpilot_start_smartstore_inquiry_history_window_v7(date,date,uuid,text)",
      "public.sellerpilot_next_smartstore_history_window_v4(date,date,uuid,text)",
    ]) {
      assert.equal((await db.query(
        "select has_function_privilege('authenticated',$1,'execute') allowed",
        [signature],
      )).rows[0].allowed, true);
      for (const role of ["anon", "service_role"]) {
        assert.equal((await db.query(
          "select has_function_privilege($1,$2,'execute') allowed",
          [role, signature],
        )).rows[0].allowed, false);
      }
    }
  } finally {
    await db.close();
  }
});

test("today cutoff yields to an older window and becomes full-day on the next day", async () => {
  const db = await fixture("2024-08-01 12:00:00+09");
  try {
    const first = await checkpoint(db, "2024-06-03", "2024-08-01");
    assert.deepEqual([first.nextWindow.fromDate, first.nextWindow.throughDate],
      ["2024-07-03", "2024-08-01"]);
    const cutoff = await start(db, first.nextWindow.fromDate, first.nextWindow.throughDate);
    assert.equal(cutoff.coverageMode, "cutoff");
    await completeOnePageRun(db, cutoff.runId);

    const frozenV3 = (await db.query(
      "select public.sellerpilot_next_smartstore_history_window_v3('2024-06-03','2024-08-01',$1,'production') result",
      [credential],
    )).rows[0].result;
    assert.deepEqual([frozenV3.nextWindow.fromDate, frozenV3.nextWindow.throughDate],
      ["2024-07-03", "2024-08-01"]);

    const older = await checkpoint(db, "2024-06-03", "2024-08-01");
    assert.deepEqual([older.nextWindow.fromDate, older.nextWindow.throughDate],
      ["2024-06-03", "2024-07-02"]);
    const olderRun = await start(db, older.nextWindow.fromDate, older.nextWindow.throughDate);
    assert.equal(olderRun.coverageMode, "full_day");
    await completeOnePageRun(db, olderRun.runId);
    const waiting = await checkpoint(db, "2024-06-03", "2024-08-01");
    assert.deepEqual([waiting.completedWindowCount, waiting.remainingWindowCount], [1, 1]);
    assert.deepEqual([waiting.nextWindow.fromDate, waiting.nextWindow.throughDate],
      ["2024-07-03", "2024-08-01"]);

    await installAt(db, "2024-08-02 00:05:00+09");
    const nextDay = await checkpoint(db, "2024-06-03", "2024-08-01");
    assert.deepEqual([nextDay.nextWindow.fromDate, nextDay.nextWindow.throughDate],
      ["2024-07-03", "2024-08-01"]);
    const fullDay = await start(db, nextDay.nextWindow.fromDate, nextDay.nextWindow.throughDate);
    assert.equal(fullDay.coverageMode, "full_day");
    assert.notEqual(fullDay.runId, cutoff.runId);
    await completeOnePageRun(db, fullDay.runId);
    const complete = await checkpoint(db, "2024-06-03", "2024-08-01");
    assert.equal(complete.complete, true);
    assert.deepEqual([complete.completedWindowCount, complete.remainingWindowCount], [2, 0]);
  } finally {
    await db.close();
  }
});

test("current integrated route executes v4 checkpoint and v7 enqueue", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "sellerpilot-smartstore-v7-route-"));
  const routeRelative = "app/api/admin/cs/channels/smartstore/history-resume-v5/route.ts";
  try {
    await execFileAsync("git", ["init", "--quiet"], { cwd: temporaryRoot });
    await mkdir(path.join(temporaryRoot, path.dirname(routeRelative)), { recursive: true });
    await copyFile(path.join(integratedRoot, routeRelative), path.join(temporaryRoot, routeRelative));
    await execFileAsync("git", ["add", routeRelative], { cwd: temporaryRoot });
    const route = await readFile(path.join(temporaryRoot, routeRelative), "utf8");
    const compiled = ts.transpileModule(route, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: routeRelative,
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.length ?? 0, 0);
    assert.match(route, /sellerpilot-smartstore-history-checkpoint\/4/);
    assert.match(route, /smartstore:history:v4/);
    assert.match(route, /sellerpilot_next_smartstore_history_window_v4/);
    assert.match(route, /sellerpilot_start_smartstore_inquiry_history_window_v7/);
    assert.doesNotMatch(route, /sellerpilot_next_smartstore_history_window_v3/);
    assert.doesNotMatch(route, /sellerpilot_start_smartstore_inquiry_history_window_v6/);

    const calls = [];
    const exportsObject = {};
    const sandbox = vm.createContext({
      exports: exportsObject,
      Request,
      Response,
      URL,
      Date,
      require(name) {
        if (name === "zod") return { z };
        if (name === "next/server") return { NextResponse: Response };
        if (name.endsWith("/admin-api")) return {
          authenticateAdminRequest: async () => ({
            userClient: {
              rpc: async (rpcName, args) => {
                calls.push({ name: rpcName, args });
                if (rpcName === "sellerpilot_list_credentials") return {
                  data: [{
                    id: credential,
                    channel: "smartstore",
                    environment: "production",
                    status: "active",
                  }],
                  error: null,
                };
                if (rpcName === "sellerpilot_next_smartstore_history_window_v4") return {
                  data: {
                    contract: "sellerpilot-smartstore-history-checkpoint/4",
                    checkedAt: "2024-08-01T03:00:00.000Z",
                    environment: "production",
                    totalWindowCount: 2,
                    completedWindowCount: 0,
                    remainingWindowCount: 2,
                    complete: false,
                    nextWindow: {
                      key: "smartstore:history:v4:2024-06-03:2024-07-02",
                      fromDate: "2024-06-03",
                      throughDate: "2024-07-02",
                      productItemKey: "product:2024-06-03:2024-07-02",
                      customerItemKey: "customer:2024-06-03:2024-07-02",
                    },
                    advanceRule: "current_cutoff_deferred_behind_older_exact_full_kst_day_windows",
                  },
                  error: null,
                };
                if (rpcName === "sellerpilot_start_smartstore_inquiry_history_window_v7") return {
                  data: {
                    contract: "sellerpilot-smartstore-exact-history-window/7",
                    runId: "00000000-0000-4000-8000-000000000906",
                    acceptedNotCompleted: true,
                  },
                  error: null,
                };
                throw new Error(`unexpected rpc ${rpcName}`);
              },
            },
          }),
          isAdminApiError: value => value instanceof Response,
        };
        throw new Error(`unexpected import ${name}`);
      },
    });
    vm.runInContext(compiled.outputText, sandbox);
    const response = await exportsObject.POST(new Request(
      "https://sellerpilot.test/api/admin/cs/channels/smartstore/history-resume-v5",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ floorDate: "2024-06-03", throughDate: "2024-08-01" }),
      },
    ));
    assert.equal(response.status, 202);
    assert.deepEqual(calls.map(call => call.name), [
      "sellerpilot_list_credentials",
      "sellerpilot_next_smartstore_history_window_v4",
      "sellerpilot_start_smartstore_inquiry_history_window_v7",
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[2].args)), {
      p_from_date: "2024-06-03",
      p_through_date: "2024-07-02",
      p_credential_id: credential,
      p_environment: "production",
    });
    const body = await response.json();
    assert.equal(body.acceptedNotCompleted, true);
    assert.equal(body.checkpointBeforeEnqueue.nextWindow.key,
      "smartstore:history:v4:2024-06-03:2024-07-02");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
