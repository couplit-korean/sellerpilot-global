import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260909134539_temu_history_checkpoint_resume.sql",
  import.meta.url,
), "utf8");
const periodicBase = await readFile(new URL(
  "../supabase/migrations/20260820170000_periodic_channel_sync.sql",
  import.meta.url,
), "utf8");
const periodicCurrent = await readFile(new URL(
  "../supabase/migrations/20260831145000_release_smartstore_from_static_egress.sql",
  import.meta.url,
), "utf8");
const sellerLineage = await readFile(new URL(
  "../supabase/migrations/20260825111800_bind_listing_seller_accounts.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-00000000f301";
const administrator = "00000000-0000-4000-8000-00000000f302";
const credential = "00000000-0000-4000-8000-00000000f303";
const worker = "00000000-0000-4000-8000-00000000f304";
const requestKey = "00000000-0000-4000-8000-00000000f305";
const sellerKey = "b".repeat(64);

function functionStatement(source, name) {
  const markers = [`create or replace function ${name}`, `create function ${name}`];
  const start = markers.map(marker => source.indexOf(marker)).find(index => index >= 0);
  assert.notEqual(start, undefined, `missing function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return source.slice(start, end + 4);
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${administrator}');
    create function auth.uid()returns uuid language sql stable as $$
      select '${administrator}'::uuid
    $$;
    create function public.sellerpilot_is_admin()returns boolean language sql stable as $$select true$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,status text,expires_at timestamptz,
      seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,
      created_by uuid,version integer default 1,created_at timestamptz default now()
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text,scope text,status text,expires_at timestamptz,created_by uuid
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid,attempt_id uuid,listing_id uuid,
      seller_account_key text,created_by uuid,channel text,operation text,environment text,
      request_payload jsonb,status text default 'queued',
      attempt_count integer default 0,provider_mutation_started_at timestamptz,
      worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz,completed_at timestamptz,
      started_at timestamptz,error_message text,updated_at timestamptz default now(),created_at timestamptz default now(),
      response_payload jsonb
    );
    create table sellerpilot_private.channel_sync_state(
      owner_id uuid,channel_key text,data_type text,status text,imported_count integer,
      last_started_at timestamptz,last_error text,updated_at timestamptz,
      primary key(owner_id,channel_key,data_type)
    );
    create table sellerpilot_private.serverless_static_egress_policy(
      channel text primary key,enabled boolean not null
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,credential_id uuid,channel text,operation text,status text,seller_account_key text
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,product_id uuid,channel_key text,remote_id text,marketplace_sku text,
      market text,target_id text,operation_attempt_id uuid,seller_account_key text
    );
    create table sellerpilot_private.channel_market_targets(
      credential_id uuid,channel text,market_code text,target_id text
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key,claim_token uuid,worker_token_id uuid,completion_fingerprint text,
      continuation_job_id uuid,created_at timestamptz default now()
    );
    create function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
      returns jsonb language sql security definer set search_path='' as $$select null::jsonb$$;
    insert into sellerpilot_private.channel_credentials(
      id,channel,environment,status,expires_at,seller_account_key,seller_account_key_source,
      seller_account_verified_at,created_by,version,created_at
    )values(
      '${credential}','temu','production','active',now()+interval'1 day','${sellerKey}',
      'provider_certified_v1',now(),'${owner}',1,now()
    );
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${worker}','worker-hash','serverless_cs','active',now()+interval'1 day','${administrator}'
    );
    insert into sellerpilot_private.serverless_static_egress_policy values('temu',true);
  `);
  await db.exec(functionStatement(
    sellerLineage,
    "sellerpilot_private.guard_gateway_job_seller_lineage",
  ));
  await db.exec(`create trigger guard_gateway_job_seller_lineage
    before insert or update on sellerpilot_private.channel_gateway_jobs
    for each row execute function sellerpilot_private.guard_gateway_job_seller_lineage()`);
  await db.exec(functionStatement(
    periodicBase,
    "public.sellerpilot_service_enqueue_periodic_sync",
  ));
  await db.exec(`alter function public.sellerpilot_service_enqueue_periodic_sync(
    text,text,jsonb,integer
  ) rename to sellerpilot_310450_enqueue_periodic_sync_unsafe`);
  await db.exec(functionStatement(
    periodicCurrent,
    "public.sellerpilot_service_enqueue_periodic_sync",
  ));
  await db.exec(migration);
  return db;
}

async function scalar(db, sql, parameters = []) {
  return (await db.query(sql, parameters)).rows[0]?.result;
}

test("successful pages advance, failed cursor resumes in place, and completed receipts survive", async () => {
  const db = await fixture();
  try {
    const started = await scalar(db,
      "select public.sellerpilot_start_or_resume_temu_history_v1($1,$2::jsonb) result",
      [credential, JSON.stringify({ action: "start", requestKey,
        fromDate: "2026-09-08", toDate: "2026-09-08" })]);
    assert.equal(started.status, "running");
    assert.equal(started.pendingJobCount, 1);
    assert.deepEqual(started.activeCursor, { date: "2026-09-08", statusGroup: 1, pageNo: 1 });
    assert.deepEqual(started.providerRetention, { status: "unverified", earliestSupportedDate: null });
    let job = (await db.query("select*from sellerpilot_private.channel_gateway_jobs order by created_at,id limit 1")).rows[0];
    assert.equal(job.operation, "inquiries.list");
    assert.equal(job.credential_id, credential);
    assert.equal(job.seller_account_key, sellerKey);
    assert.equal(job.request_payload.arguments.kind, "after_sales");
    assert.equal(job.request_payload.arguments.includeDetails, true);

    const firstClaim = "00000000-0000-4000-8000-00000000f311";
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='succeeded',claim_token=$1 where id=$2", [firstClaim, job.id]);
    await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3,$4,null,now())",
      [job.id, firstClaim, worker, "a".repeat(64)]);
    const advanced = await scalar(db,
      "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
      ["worker-hash", job.id, firstClaim]);
    assert.equal(advanced.completedPageCount, 1);
    assert.deepEqual(advanced.activeCursor, { date: "2026-09-08", statusGroup: 2, pageNo: 1 });
    assert.equal(advanced.pendingJobCount, 1);
    assert.equal(advanced.replayed, false);
    const replayed = await scalar(db,
      "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
      ["worker-hash", job.id, firstClaim]);
    assert.deepEqual(replayed.activeCursor, advanced.activeCursor);
    assert.equal(replayed.completedPageCount, 1);
    assert.equal(replayed.pendingJobCount, 1);
    assert.equal(replayed.replayed, true);

    job = (await db.query("select*from sellerpilot_private.channel_gateway_jobs where status='queued' order by created_at,id limit 1")).rows[0];
    const failedClaim = "00000000-0000-4000-8000-00000000f312";
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='failed',attempt_count=1,claim_token=$1 where id=$2", [failedClaim, job.id]);
    await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3,$4,null,now())",
      [job.id, failedClaim, worker, "c".repeat(64)]);
    const failed = await scalar(db,
      "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
      ["worker-hash", job.id, failedClaim]);
    assert.equal(failed.status, "failed");
    assert.equal(failed.completedPageCount, 1);
    assert.equal(failed.canResume, true);

    const resumed = await scalar(db,
      "select public.sellerpilot_start_or_resume_temu_history_v1($1,$2::jsonb) result",
      [credential, JSON.stringify({ action: "resume", runId: failed.runId,
        expectedCursor: failed.activeCursor, expectedRetryCount: 0 })]);
    assert.equal(resumed.status, "running");
    assert.equal(resumed.retryCount, 1);
    assert.equal(resumed.completedPageCount, 1);
    assert.equal(resumed.completedPagesPreserved, true);
    const jobs = (await db.query("select id,status from sellerpilot_private.channel_gateway_jobs order by created_at,id")).rows;
    assert.equal(jobs.length, 2);
    assert.equal(jobs[1].status, "queued");
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.gateway_completion_receipts where job_id=$1",
      [job.id],
    )).rows[0].count, 0);
    const delayedFailedReplay = await scalar(db,
      "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
      ["worker-hash", job.id, failedClaim]);
    assert.equal(delayedFailedReplay.status, "failed");
    assert.equal(delayedFailedReplay.replayed, true);
    assert.equal((await db.query(
      "select status from sellerpilot_private.temu_history_runs where id=$1",
      [failed.runId],
    )).rows[0].status, "running");

    await db.query("update sellerpilot_private.temu_history_runs set status='failed',retry_count=3 where id=$1", [failed.runId]);
    const exhausted = await scalar(db,
      "select public.sellerpilot_get_temu_history_checkpoint_v1($1,$2,$3,$4) result",
      [credential, failed.runId, "2026-09-08", "2026-09-08"]);
    assert.equal(exhausted.status, "retry_exhausted");
    assert.equal(exhausted.canResume, false);
    assert.equal(exhausted.completedPageCount, 1);
  } finally {
    await db.close();
  }
});

test("an old successful completion replays immutably after later pages and final completion", async () => {
  const db = await fixture();
  try {
    await scalar(db,
      "select public.sellerpilot_start_or_resume_temu_history_v1($1,$2::jsonb) result",
      [credential, JSON.stringify({ action: "start", requestKey,
        fromDate: "2026-09-08", toDate: "2026-09-08" })]);
    let first;
    for (let statusGroup = 1; statusGroup <= 7; statusGroup += 1) {
      const job = (await db.query(
        "select*from sellerpilot_private.channel_gateway_jobs where status='queued' order by created_at,id limit 1",
      )).rows[0];
      assert.ok(job);
      const claim = `00000000-0000-4000-8000-${String(0xf320 + statusGroup).padStart(12, "0")}`;
      await db.query(
        "update sellerpilot_private.channel_gateway_jobs set status='succeeded',claim_token=$1 where id=$2",
        [claim, job.id],
      );
      await db.query(
        "insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3,$4,null,now())",
        [job.id, claim, worker, String(statusGroup).repeat(64)],
      );
      const checkpoint = await scalar(db,
        "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
        ["worker-hash", job.id, claim]);
      if (statusGroup === 1) first = { jobId: job.id, claim, checkpoint };
    }
    const completed = (await db.query(
      "select status,cursor_date,cursor_status_group,cursor_page_no from sellerpilot_private.temu_history_runs",
    )).rows[0];
    assert.equal(completed.status, "complete");
    assert.equal(completed.cursor_date, null);
    assert.equal(await scalar(db,
      "select count(*)::integer result from sellerpilot_private.temu_history_completed_pages"), 7);
    assert.equal(await scalar(db,
      "select count(*)::integer result from sellerpilot_private.channel_gateway_jobs"), 7);

    const delayedReplay = await scalar(db,
      "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
      ["worker-hash", first.jobId, first.claim]);
    assert.equal(delayedReplay.replayed, true);
    assert.deepEqual(delayedReplay.activeCursor, first.checkpoint.activeCursor);
    assert.equal(delayedReplay.status, "running");
    assert.equal((await db.query("select status from sellerpilot_private.temu_history_runs")).rows[0].status, "complete");
    assert.equal(await scalar(db,
      "select count(*)::integer result from sellerpilot_private.channel_gateway_jobs"), 7);
    await assert.rejects(db.query(
      "update sellerpilot_private.temu_history_checkpoint_receipts set result_payload='{}'::jsonb where job_id=$1",
      [first.jobId],
    ), /TEMU_HISTORY_CHECKPOINT_RECEIPT_IMMUTABLE/);
  } finally {
    await db.close();
  }
});

test("resume rejects credential, account, cursor and retry drift without deleting completed pages", async () => {
  const db = await fixture();
  try {
    const started = await scalar(db,
      "select public.sellerpilot_start_or_resume_temu_history_v1($1,$2::jsonb) result",
      [credential, JSON.stringify({ action: "start", requestKey,
        fromDate: "2026-09-08", toDate: "2026-09-08" })]);
    const job = (await db.query("select*from sellerpilot_private.channel_gateway_jobs limit 1")).rows[0];
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='failed',attempt_count=1 where id=$1", [job.id]);
    await db.query("update sellerpilot_private.temu_history_runs set status='failed' where id=$1", [started.runId]);
    for (const request of [
      { action: "resume", runId: started.runId, expectedCursor: { ...started.activeCursor, pageNo: 2 }, expectedRetryCount: 0 },
      { action: "resume", runId: started.runId, expectedCursor: started.activeCursor, expectedRetryCount: 1 },
    ]) {
      await assert.rejects(db.query(
        "select public.sellerpilot_start_or_resume_temu_history_v1($1,$2::jsonb)",
        [credential, JSON.stringify(request)]), /query returned no rows/);
    }
    await db.query("update sellerpilot_private.channel_credentials set seller_account_key=$1 where id=$2",
      ["d".repeat(64), credential]);
    await assert.rejects(db.query(
      "select public.sellerpilot_start_or_resume_temu_history_v1($1,$2::jsonb)",
      [credential, JSON.stringify({ action: "resume", runId: started.runId,
        expectedCursor: started.activeCursor, expectedRetryCount: 0 })]), /query returned no rows/);
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.temu_history_completed_pages")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
