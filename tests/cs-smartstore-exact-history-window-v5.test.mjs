import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const operator = "00000000-0000-4000-8000-000000000500";
const seller = "00000000-0000-4000-8000-000000000501";
const otherSeller = "00000000-0000-4000-8000-000000000502";
const credential = "00000000-0000-4000-8000-000000000503";
const otherCredential = "00000000-0000-4000-8000-000000000504";
const enqueueSql = await readFile(new URL(
  "../supabase/migrations/20260908140407_cs_smartstore_exact_history_window_v5.sql",
  import.meta.url,
), "utf8");
const checkpointSql = await readFile(new URL(
  "../supabase/migrations/20260908140405_cs_smartstore_history_checkpoint.sql",
  import.meta.url,
), "utf8");

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    insert into sellerpilot_private.admin_users values('${operator}');
    create function public.sellerpilot_is_admin() returns boolean
      language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;

    create table sellerpilot_private.serverless_static_egress_policy(
      channel text primary key, enabled boolean not null
    );
    insert into sellerpilot_private.serverless_static_egress_policy values('smartstore',true);
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid not null, channel text not null,
      environment text not null, status text not null, expires_at timestamptz,
      seller_account_key text, seller_account_key_source text,
      seller_account_verified_at timestamptz, version integer, created_at timestamptz
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${seller}','smartstore','production','active',null,
      'seller-a','credential_incarnation_v1',now(),1,now()
    );
    create table sellerpilot_private.inquiry_history_backfill_runs(
      id uuid primary key default gen_random_uuid(),
      request_key text not null unique,
      owner_id uuid not null, initiated_by uuid, history_days integer not null,
      range_start date not null, range_end date not null,
      status text not null default 'queued', expected_initial_jobs integer not null,
      total_jobs integer not null default 0, queued_jobs integer not null default 0,
      running_jobs integer not null default 0, succeeded_jobs integer not null default 0,
      failed_jobs integer not null default 0, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), completed_at timestamptz,
      channels text[] not null, credential_ids jsonb not null,
      constraint inquiry_history_backfill_runs_history_days_check check(history_days between 7 and 30),
      check(range_end-range_start=history_days-1)
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(), created_by uuid not null,
      credential_id uuid not null, channel text not null, environment text not null,
      operation text not null, request_payload jsonb not null, status text not null default 'queued',
      attempt_count integer not null default 0, credential_refresh_in_flight boolean not null default false,
      credential_refresh_recovery_vault_id uuid, worker_token_id uuid, claim_token uuid,
      lease_expires_at timestamptz, completed_at timestamptz, error_message text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create unique index channel_gateway_jobs_history_initial_item_idx
      on sellerpilot_private.channel_gateway_jobs(
        ((request_payload#>>'{arguments,sellerpilotHistoryRunId}')),channel,
        ((request_payload#>>'{arguments,sellerpilotHistoryItemKey}'))
      );
    create table sellerpilot_private.cs_history_scans(
      id bigint generated always as identity primary key,
      owner_id uuid not null, credential_id uuid not null, channel text not null,
      environment text not null, scope_key text not null, ticket_kind text not null,
      status text not null, scan_completed_at timestamptz, reconciled_at timestamptz,
      unprocessed_count integer not null
    );

    create function sellerpilot_private.refresh_inquiry_history_backfill_run(p_run_id uuid)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
      v_total integer;v_queued integer;v_running integer;v_succeeded integer;v_failed integer;v_status text;
    begin
      select count(*)::integer,count(*) filter (where status='queued')::integer,
        count(*) filter (where status='running')::integer,count(*) filter (where status='succeeded')::integer,
        count(*) filter (where status in('failed','cancelled','reconciliation_required'))::integer
        into v_total,v_queued,v_running,v_succeeded,v_failed
        from sellerpilot_private.channel_gateway_jobs
       where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text;
      select * into v_run from sellerpilot_private.inquiry_history_backfill_runs where id=p_run_id for update;
      v_status:=case when v_total>=v_run.expected_initial_jobs and v_queued=0 and v_running=0 and v_failed=0 then'succeeded'
        when v_total>=v_run.expected_initial_jobs and v_queued=0 and v_running=0 and v_failed>0 then'failed'
        when v_running>0 or v_succeeded>0 or v_failed>0 then'running'else'queued'end;
      update sellerpilot_private.inquiry_history_backfill_runs set status=v_status,total_jobs=v_total,
        queued_jobs=v_queued,running_jobs=v_running,succeeded_jobs=v_succeeded,failed_jobs=v_failed,
        completed_at=case when v_status in('succeeded','failed')then now()else null end,updated_at=now()
       where id=p_run_id returning * into v_run;
      return jsonb_build_object('runId',v_run.id,'status',v_run.status,'historyDays',v_run.history_days,
        'fromDate',v_run.range_start,'toDate',v_run.range_end,'channels',to_jsonb(v_run.channels),
        'expectedInitialJobs',v_run.expected_initial_jobs,'totalJobs',v_run.total_jobs,
        'queuedJobs',v_run.queued_jobs,'runningJobs',v_run.running_jobs,
        'succeededJobs',v_run.succeeded_jobs,'failedJobs',v_run.failed_jobs);
    end$$;
    create function sellerpilot_private.enqueue_inquiry_history_backfill_item(
      p_run_id uuid,p_channel text,p_item_key text,p_arguments jsonb
    ) returns uuid language plpgsql security definer set search_path='' as $$
    declare v_job uuid;v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;v_credential uuid;
    begin
      select * into v_run from sellerpilot_private.inquiry_history_backfill_runs where id=p_run_id;
      v_credential:=(v_run.credential_ids->>'smartstore')::uuid;
      insert into sellerpilot_private.channel_gateway_jobs(
        created_by,credential_id,channel,environment,operation,request_payload
      ) values(v_run.owner_id,v_credential,p_channel,'production','inquiries.list',jsonb_build_object(
        'periodicKey',format('inquiries:history:%s:%s:%s',p_run_id,p_channel,p_item_key),
        'arguments',p_arguments||jsonb_build_object('sellerpilotHistoryRunId',p_run_id::text,
          'sellerpilotHistoryItemKey',p_item_key)
      )) returning id into v_job;
      return v_job;
    end$$;

    revoke all on sellerpilot_private.serverless_static_egress_policy,
      sellerpilot_private.channel_credentials,sellerpilot_private.inquiry_history_backfill_runs,
      sellerpilot_private.channel_gateway_jobs,sellerpilot_private.cs_history_scans
      from public,anon,authenticated,service_role;
    select set_config('request.jwt.claim.sub','${operator}',false);
  `);
  await db.exec(enqueueSql);
  return db;
}

async function start(db, fromDate, throughDate, credentialId = credential) {
  return (await db.query(
    "select public.sellerpilot_start_smartstore_inquiry_history_window_v5($1,$2,$3,'production') result",
    [fromDate, throughDate, credentialId],
  )).rows[0].result;
}

async function jobs(db, runId) {
  return (await db.query(`
    select status,attempt_count,request_payload
      from sellerpilot_private.channel_gateway_jobs
     where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1
     order by request_payload#>>'{arguments,sellerpilotHistoryItemKey}'
  `, [runId])).rows;
}

test("v5 SQL installs with SmartStore-only 1-30 day constraint and exact ACL", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_start_smartstore_inquiry_history_window_v5(date,date,uuid,text)','execute') allowed",
        [role],
      )).rows[0].allowed, false);
    }
    assert.equal((await db.query(
      "select has_function_privilege('authenticated','public.sellerpilot_start_smartstore_inquiry_history_window_v5(date,date,uuid,text)','execute') allowed",
    )).rows[0].allowed, true);
    await assert.rejects(db.query(`insert into sellerpilot_private.inquiry_history_backfill_runs(
      request_key,owner_id,history_days,range_start,range_end,expected_initial_jobs,channels,credential_ids
    )values($1,$2,1,'2024-01-01','2024-01-01',1,array['coupang']::text[],'{}')`, ["a".repeat(64), seller]), /check constraint/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from sellerpilot_private.channel_credentials"), /permission denied/);
  } finally {
    await db.close();
  }
});

test("v5 enqueues exact 1, 6, 7 and 30 day product/customer windows across KST and UTC", async () => {
  const db = await fixture();
  try {
    const cases = [
      ["2024-01-01", "2024-01-01", 1],
      ["2024-02-27", "2024-03-03", 6],
      ["2024-03-04", "2024-03-10", 7],
      ["2024-03-11", "2024-04-09", 30],
    ];
    for (const [fromDate, throughDate, days] of cases) {
      await db.exec("set role authenticated");
      const result = await start(db, fromDate, throughDate);
      assert.equal(result.contract, "sellerpilot-smartstore-exact-history-window/5");
      assert.equal(result.historyDays, days);
      assert.deepEqual([result.fromDate, result.toDate, result.totalJobs], [fromDate, throughDate, 2]);
      await db.exec("reset role");
      const rows = await jobs(db, result.runId);
      assert.equal(rows.length, 2);
      const customer = rows.find(row => row.request_payload.arguments.kind === "customer");
      const product = rows.find(row => row.request_payload.arguments.kind === "product");
      assert.deepEqual(customer.request_payload.arguments.query, {
        startSearchDate: fromDate, endSearchDate: throughDate, page: 1, size: 200,
      });
      assert.equal(product.request_payload.arguments.query.fromDate, `${fromDate}T00:00:00.000+09:00`);
      assert.equal(product.request_payload.arguments.query.toDate, `${throughDate}T23:59:59.999+09:00`);
      const run = (await db.query(
        "select owner_id=$1 seller_owner,initiated_by=$2 admin_actor from sellerpilot_private.inquiry_history_backfill_runs where id=$3",
        [seller, operator, result.runId],
      )).rows[0];
      assert.deepEqual(run, { seller_owner: true, admin_actor: true });
    }

    await db.exec("set timezone='UTC';set role authenticated");
    const first = await start(db, "2024-05-01", "2024-05-06");
    await db.exec("reset role;set timezone='Asia/Seoul';set role authenticated");
    const repeated = await start(db, "2024-05-01", "2024-05-06");
    assert.equal(repeated.reused, true);
    assert.equal(repeated.runId, first.runId);
    await db.exec("reset role");
    assert.equal((await jobs(db, first.runId)).length, 2);
  } finally {
    await db.close();
  }
});

test("v5 duplicate and restart remain idempotent and never replay exhausted failures", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    const initial = await start(db, "2024-06-01", "2024-06-06");
    const duplicate = await start(db, "2024-06-01", "2024-06-06");
    assert.equal(duplicate.reused, true);
    await db.exec("reset role");
    assert.equal((await jobs(db, initial.runId)).length, 2);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status=case
      when request_payload#>>'{arguments,kind}'='product' then 'succeeded' else 'failed' end,
      attempt_count=1,completed_at=now() where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1`, [initial.runId]);
    await db.query("select sellerpilot_private.refresh_inquiry_history_backfill_run($1)", [initial.runId]);
    await db.exec("set role authenticated");
    const retried = await start(db, "2024-06-01", "2024-06-06");
    assert.equal(retried.retriedJobs, 1);
    await db.exec("reset role");
    assert.deepEqual((await jobs(db, initial.runId)).map(row => row.status).sort(), ["queued", "succeeded"]);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='failed',attempt_count=4,completed_at=now()
      where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1 and status='queued'`, [initial.runId]);
    await db.query("select sellerpilot_private.refresh_inquiry_history_backfill_run($1)", [initial.runId]);
    await db.exec("set role authenticated");
    const exhausted = await start(db, "2024-06-01", "2024-06-06");
    assert.equal(exhausted.retriedJobs, 0);
    await db.exec("reset role");
    assert.ok((await jobs(db, initial.runId)).some(row => row.status === "failed" && row.attempt_count === 4));
    assert.equal((await jobs(db, initial.runId)).length, 2);
  } finally {
    await db.close();
  }
});

test("v5 rejects revoked credentials, ambiguous seller scopes, invalid ranges and non-admins", async () => {
  const db = await fixture();
  try {
    await db.exec(`update sellerpilot_private.channel_credentials set status='revoked' where id='${credential}';set role authenticated`);
    await assert.rejects(start(db, "2024-07-01", "2024-07-01"), /SMARTSTORE_EXACT_HISTORY_CREDENTIAL_INVALID/);
    await db.exec("reset role");
    await db.exec(`update sellerpilot_private.channel_credentials set status='active' where id='${credential}';
      insert into sellerpilot_private.channel_credentials values(
        '${otherCredential}','${otherSeller}','smartstore','production','active',null,
        'seller-b','credential_incarnation_v1',now(),1,now()
      );set role authenticated`);
    await assert.rejects(start(db, "2024-07-01", "2024-07-01"), /SMARTSTORE_EXACT_HISTORY_ACTIVE_SCOPE_AMBIGUOUS/);
    await db.exec("reset role");
    await db.exec(`update sellerpilot_private.channel_credentials set status='revoked' where id='${otherCredential}';set role authenticated`);
    await assert.rejects(start(db, "2024-07-02", "2024-08-01"), /SMARTSTORE_EXACT_HISTORY_WINDOW_INVALID/);
    await assert.rejects(start(db, "2024-07-02", "2024-07-01"), /SMARTSTORE_EXACT_HISTORY_WINDOW_INVALID/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [otherSeller]);
    await db.exec("set role authenticated");
    await assert.rejects(start(db, "2024-07-02", "2024-07-02"), /administrator access required/);
  } finally {
    await db.close();
  }
});

test("a one-day checkpoint advances only after both exact seller scopes complete", async () => {
  const db = await fixture();
  try {
    await db.exec(checkpointSql);
    await db.exec("set role authenticated");
    const enqueued = await start(db, "2024-08-01", "2024-08-01");
    await db.exec("reset role");
    const rows = await jobs(db, enqueued.runId);
    const productScope = rows.find(row => row.request_payload.arguments.kind === "product").request_payload.periodicKey;
    const customerScope = rows.find(row => row.request_payload.arguments.kind === "customer").request_payload.periodicKey;
    await db.query(`insert into sellerpilot_private.cs_history_scans
      (owner_id,credential_id,channel,environment,scope_key,ticket_kind,status,scan_completed_at,reconciled_at,unprocessed_count)
      values($1,$2,'smartstore','production',$3,'product','completed',now(),now(),0),
        ($4,$5,'smartstore','production',$6,'customer','completed',now(),now(),0),
        ($1,$2,'smartstore','production',$6,'customer','running',null,null,0)`,
    [seller, credential, productScope, otherSeller, otherCredential, customerScope]);
    await db.exec("set role authenticated");
    let checkpoint = (await db.query(
      "select public.sellerpilot_next_smartstore_history_window_v1('2024-08-01','2024-08-01',$1,'production') result",
      [credential],
    )).rows[0].result;
    assert.equal(checkpoint.completedWindowCount, 0);
    assert.equal(checkpoint.nextWindow.fromDate, "2024-08-01");
    await db.exec("reset role");
    await db.query(`update sellerpilot_private.cs_history_scans set status='completed',scan_completed_at=now(),reconciled_at=now()
      where owner_id=$1 and credential_id=$2 and ticket_kind='customer'`, [seller, credential]);
    await db.exec("set role authenticated");
    checkpoint = (await db.query(
      "select public.sellerpilot_next_smartstore_history_window_v1('2024-08-01','2024-08-01',$1,'production') result",
      [credential],
    )).rows[0].result;
    assert.equal(checkpoint.completedWindowCount, 1);
    assert.equal(checkpoint.complete, true);
    assert.equal(checkpoint.nextWindow, null);
  } finally {
    await db.close();
  }
});
