import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const patch = await readFile(new URL(
  "../supabase/migrations/20260908141312_cs_coupang_history_checkpoint.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000002001";
const other = "00000000-0000-4000-8000-000000002002";
const runId = "00000000-0000-4000-8000-000000002003";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer
      set search_path='' as $$select auth.uid()='${owner}'::uuid$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.inquiry_history_backfill_runs(
      id uuid primary key, owner_id uuid not null, history_days int not null,
      range_start date not null, range_end date not null, channels text[] not null,
      status text not null, expected_initial_jobs int not null,
      total_jobs int not null default 0, queued_jobs int not null default 0,
      running_jobs int not null default 0, succeeded_jobs int not null default 0,
      failed_jobs int not null default 0, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), completed_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(), request_payload jsonb not null,
      status text not null
    );
    create function sellerpilot_private.refresh_inquiry_history_backfill_run(p_run_id uuid)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare r sellerpilot_private.inquiry_history_backfill_runs%rowtype;
      total int; queued int; running int; succeeded int; failed int; state text; done_at timestamptz;
    begin
      select run.* into r from sellerpilot_private.inquiry_history_backfill_runs run
       where run.id=p_run_id for update;
      if not found then return null; end if;
      select count(*)::int,count(*) filter(where job.status='queued')::int,
        count(*) filter(where job.status='running')::int,
        count(*) filter(where job.status='succeeded')::int,
        count(*) filter(where job.status in('failed','cancelled','reconciliation_required'))::int
        into total,queued,running,succeeded,failed
        from sellerpilot_private.channel_gateway_jobs job
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text;
      state:=case when total>=r.expected_initial_jobs and queued=0 and running=0 and failed=0 then 'succeeded'
        when total>=r.expected_initial_jobs and queued=0 and running=0 and failed>0 then 'failed'
        when running>0 or succeeded>0 or failed>0 then 'running' else 'queued' end;
      done_at:=case when state in('succeeded','failed') then coalesce(r.completed_at,clock_timestamp()) else null end;
      update sellerpilot_private.inquiry_history_backfill_runs set status=state,total_jobs=total,
        queued_jobs=queued,running_jobs=running,succeeded_jobs=succeeded,failed_jobs=failed,
        completed_at=done_at,updated_at=clock_timestamp() where id=p_run_id returning * into r;
      return jsonb_build_object('runId',r.id,'status',r.status,'historyDays',r.history_days,
        'fromDate',r.range_start,'toDate',r.range_end,'channels',to_jsonb(r.channels),
        'expectedInitialJobs',r.expected_initial_jobs,'totalJobs',r.total_jobs,
        'queuedJobs',r.queued_jobs,'runningJobs',r.running_jobs,'succeededJobs',r.succeeded_jobs,
        'failedJobs',r.failed_jobs,'progressPercent',case when total=0 then 0 else floor(100.0*(succeeded+failed)/total)::int end,
        'startedAt',r.created_at,'updatedAt',r.updated_at,'completedAt',r.completed_at);
    end$$;
    revoke all on function sellerpilot_private.refresh_inquiry_history_backfill_run(uuid)
      from public,anon,authenticated,service_role;
    insert into sellerpilot_private.inquiry_history_backfill_runs(
      id,owner_id,history_days,range_start,range_end,channels,status,expected_initial_jobs
    ) values ('${runId}','${owner}',30,'2024-01-31','2024-02-29',array['coupang'],'queued',40);
    insert into sellerpilot_private.channel_gateway_jobs(request_payload,status)
      select jsonb_build_object('arguments',jsonb_build_object('sellerpilotHistoryRunId','${runId}')),
        case when value=40 then 'failed' else 'succeeded' end
      from generate_series(1,40) value;
  `);
  await db.exec(patch);
  return db;
}

async function checkpoint(db) {
  return (await db.query(
    "select public.sellerpilot_get_coupang_history_checkpoint_v1($1) result",
    [runId],
  )).rows[0].result;
}

test("failed or interrupted fixed history replays the identical end date", async () => {
  const db = await fixture();
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    let state = await checkpoint(db);
    assert.equal(state.status, "failed");
    assert.equal(state.canAdvance, false);
    assert.equal(state.replayEndDate, "2024-02-29");
    assert.equal(state.nextEndDate, null);
    await db.exec("reset role");
    await db.exec("update sellerpilot_private.channel_gateway_jobs set status='running' where status='failed'");
    await db.exec("set role authenticated");
    state = await checkpoint(db);
    assert.equal(state.status, "running");
    assert.equal(state.canAdvance, false);
    assert.equal(state.replayEndDate, "2024-02-29");
    assert.equal(state.nextEndDate, null);
  } finally {
    await db.close();
  }
});

test("all initial and continuation jobs must succeed before the next date is exposed", async () => {
  const db = await fixture();
  try {
    await db.exec("update sellerpilot_private.channel_gateway_jobs set status='succeeded'");
    await db.exec(`insert into sellerpilot_private.channel_gateway_jobs(request_payload,status)
      values
      ('{"arguments":{"sellerpilotHistoryRunId":"${runId}"},"continuationOf":"one"}','succeeded'),
      ('{"arguments":{"sellerpilotHistoryRunId":"${runId}"},"continuationOf":"two"}','succeeded')`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    const state = await checkpoint(db);
    assert.equal(state.totalJobs, 42);
    assert.equal(state.succeededJobs, 42);
    assert.equal(state.canAdvance, true);
    assert.equal(state.replayEndDate, "2024-02-29");
    assert.equal(state.nextEndDate, "2024-01-30");
  } finally {
    await db.close();
  }
});

test("checkpoint rejects malformed scope and has an admin-only grant", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)','EXECUTE') allowed",
        [role],
      )).rows[0].allowed, false);
    }
    assert.equal((await db.query(
      "select has_function_privilege('authenticated','public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)','EXECUTE') allowed",
    )).rows[0].allowed, true);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec("set role authenticated");
    await assert.rejects(checkpoint(db), /administrator access required/u);
    await db.exec("reset role");
    await db.exec(`update sellerpilot_private.inquiry_history_backfill_runs
      set expected_initial_jobs=39 where id='${runId}'`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    await assert.rejects(checkpoint(db), /COUPANG_HISTORY_CHECKPOINT_SCOPE_INVALID/u);
  } finally {
    await db.close();
  }
});

