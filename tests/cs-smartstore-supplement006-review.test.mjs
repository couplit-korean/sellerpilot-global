import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const operator = "00000000-0000-4000-8000-000000000800";
const seller = "00000000-0000-4000-8000-000000000801";
const credential = "00000000-0000-4000-8000-000000000802";
const tokenId = "00000000-0000-4000-8000-000000000803";
const tokenHash = "smartstore-coverage-test-token";
const coverageSql = await readFile(new URL(
  "../supabase/migrations/20260907231000_add_cs_history_coverage_ledger.sql",
  import.meta.url,
), "utf8");
const enqueueV5Sql = await readFile(new URL(
  "../supabase/migrations/20260908140407_cs_smartstore_exact_history_window_v5.sql",
  import.meta.url,
), "utf8");
const explicitCoverageSql = await readFile(new URL(
  "../supabase/migrations/20260908151019_cs_smartstore_explicit_coverage_bounds.sql",
  import.meta.url,
), "utf8");
const enqueueV6Sql = await readFile(new URL(
  "../supabase/migrations/20260908151022_cs_smartstore_exact_history_window_v6.sql",
  import.meta.url,
), "utf8");
const checkpointV1Sql = await readFile(new URL(
  "../supabase/migrations/20260908140405_cs_smartstore_history_checkpoint.sql",
  import.meta.url,
), "utf8");
const checkpointV2Sql = await readFile(new URL(
  "../supabase/migrations/20260908142530_cs_smartstore_checkpoint_run_scope_v2.sql",
  import.meta.url,
), "utf8");
const checkpointV3Sql = await readFile(new URL(
  "../supabase/migrations/20260908151024_cs_smartstore_checkpoint_full_day_v3.sql",
  import.meta.url,
), "utf8");

function enqueueAt(instant) {
  const needle = "v_now timestamptz := date_trunc('milliseconds',clock_timestamp());";
  const replacement = `v_now timestamptz := timestamptz '${instant}';`;
  assert.ok(enqueueV6Sql.includes(needle));
  return enqueueV6Sql.replace(needle, replacement);
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
      );
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
    declare
      v_job uuid;v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
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
            'sellerpilotHistoryRunId',p_run_id::text,
            'sellerpilotHistoryItemKey',p_item_key
          )
        )
      ) returning id into v_job;
      return v_job;
    end$$;

    insert into auth.users values('${operator}'),('${seller}');
    insert into sellerpilot_private.admin_users values('${operator}');
    insert into sellerpilot_private.serverless_static_egress_policy values('smartstore',true);
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${seller}','smartstore','production','active',null,
      'seller-a','credential_incarnation_v1',now(),1,now()
    );
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${tokenId}','${tokenHash}','gateway','active',now()+interval '1 day'
    );
    select set_config('request.jwt.claim.sub','${operator}',false);
  `);
  await db.exec(coverageSql);
  await db.exec(enqueueV5Sql);
  await db.exec(explicitCoverageSql);
  await db.exec(enqueueAt(instant));
  await db.exec(checkpointV1Sql);
  await db.exec(checkpointV2Sql);
  await db.exec(checkpointV3Sql);
  return db;
}

async function start(db, fromDate, throughDate) {
  await db.exec("set role authenticated");
  try {
    return (await db.query(
      "select public.sellerpilot_start_smartstore_inquiry_history_window_v6($1,$2,$3,'production') result",
      [fromDate, throughDate, credential],
    )).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function checkpoint(db, fromDate, throughDate) {
  await db.exec("set role authenticated");
  try {
    return (await db.query(
      "select public.sellerpilot_next_smartstore_history_window_v3($1,$2,$3,'production') result",
      [fromDate, throughDate, credential],
    )).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function completeAndRecord(db, runId) {
  const jobs = (await db.query(`
    select id,request_payload#>>'{arguments,kind}' kind
      from sellerpilot_private.channel_gateway_jobs
     where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1
     order by kind
  `, [runId])).rows;
  assert.equal(jobs.length, 2);
  for (const [index, job] of jobs.entries()) {
    const claim = `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`;
    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      status='succeeded',response_payload='{"ok":true,"operation":"inquiries.list"}'::jsonb,
      started_at=now()-interval '1 minute',completed_at=now(),updated_at=now()
      where id=$1`, [job.id]);
    await db.query(
      "insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)",
      [job.id, claim, tokenId],
    );
    await db.exec(job.kind === "customer" ? "set timezone='UTC'" : "set timezone='Asia/Seoul'");
    await db.exec("set role service_role");
    try {
      const recorded = (await db.query(`select public.sellerpilot_service_record_cs_history_page_v1(
        $1,$2,$3,'sellerpilot-inquiry-coverage/1',0,0,'[]'::jsonb,0,true,false
      ) result`, [tokenHash, job.id, claim])).rows[0].result;
      assert.equal(recorded.status, "completed");
    } finally {
      await db.exec("reset role");
    }
  }
  await db.query(
    "select sellerpilot_private.refresh_inquiry_history_backfill_run($1)",
    [runId],
  );
}

async function scanBounds(db, runId) {
  return (await db.query(`
    select ticket_kind,timezone_name,
      to_char(range_start_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.MS') start_utc,
      to_char(range_end_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.MS') end_utc
      from sellerpilot_private.cs_history_scans
     where scope_key like $1 order by ticket_kind
  `, [`inquiries:history:${runId}:%`])).rows;
}

// Frozen006 review probes: these passing assertions confirm unresolved defects.
test("review006: continuation child makes an otherwise identical v6 retry fail", async () => {
  const db = await fixture("2024-08-02 00:05:00+09");
  try {
    const run = await start(db,"2024-08-01","2024-08-01");
    await db.exec(`drop index sellerpilot_private.channel_gateway_jobs_history_initial_item_idx;
      create unique index channel_gateway_jobs_history_initial_item_idx on sellerpilot_private.channel_gateway_jobs(
        ((request_payload#>>'{arguments,sellerpilotHistoryRunId}')),channel,
        ((request_payload#>>'{arguments,sellerpilotHistoryItemKey}')))
        where request_payload->>'continuationOf' is null;`);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,status,created_by)
      select credential_id,channel,operation,environment,
        request_payload||jsonb_build_object('continuationOf',id::text),'queued',created_by
      from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1
      and request_payload#>>'{arguments,kind}'='product'`,[run.runId]);
    await assert.rejects(start(db,"2024-08-01","2024-08-01"), /SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH/);
  } finally { await db.close(); }
});

test("central fix: missing coverage mode is rejected before scan insertion", async () => {
  const db = await fixture("2024-08-02 00:05:00+09");
  try {
    const run = await start(db,"2024-08-01","2024-08-01");
    await db.query(`update sellerpilot_private.channel_gateway_jobs set request_payload=
      request_payload #- '{arguments,sellerpilotHistoryCoverageMode}'
      where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1`,[run.runId]);
    await assert.rejects(completeAndRecord(db,run.runId), /SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID/);
    assert.equal((await scanBounds(db,run.runId)).length,0);
    assert.equal((await checkpoint(db,"2024-08-01","2024-08-01")).complete,false);
  } finally { await db.close(); }
});

test("review006: completed today cutoff remains the next window ahead of older unsynced history", async () => {
  const db = await fixture("2024-08-01 12:00:00+09");
  try {
    const checkpointAtNoon=checkpointV3Sql.replace('create function public.sellerpilot_next_smartstore_history_window_v3',
      'create or replace function public.sellerpilot_next_smartstore_history_window_v3')
      .replace('v_now timestamptz := statement_timestamp();',"v_now timestamptz := timestamptz '2024-08-01 12:00:00+09';");
    await db.exec(checkpointAtNoon);
    const run=await start(db,"2024-07-03","2024-08-01");
    await completeAndRecord(db,run.runId);
    const next=await checkpoint(db,"2024-06-03","2024-08-01");
    assert.equal(next.totalWindowCount,2);
    assert.equal(next.nextWindow.fromDate,"2024-07-03");
    assert.equal(next.nextWindow.throughDate,"2024-08-01");
    assert.equal((await start(db,next.nextWindow.fromDate,next.nextWindow.throughDate)).runId,run.runId);
  } finally { await db.close(); }
});
