import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260827235328_expire_stale_non_cs_ai_jobs.sql",
  import.meta.url,
);
const opaqueSecretGuardFixUrl = new URL(
  "../supabase/migrations/20260828002000_fix_stale_ai_service_secret_guard.sql",
  import.meta.url,
);
const maintenanceRouteUrl = new URL("../app/api/internal/maintenance/route.ts", import.meta.url);

const ids = {
  runningExpired: "10000000-0000-4000-8000-000000000001",
  queuedOldest: "10000000-0000-4000-8000-000000000002",
  queuedResearch: "10000000-0000-4000-8000-000000000003",
  queuedRegeneration: "10000000-0000-4000-8000-000000000004",
  queuedRecent: "10000000-0000-4000-8000-000000000005",
  runningLive: "10000000-0000-4000-8000-000000000006",
  supportReply: "10000000-0000-4000-8000-000000000007",
  queuedFuture: "10000000-0000-4000-8000-000000000008",
  runningNullLeaseOld: "10000000-0000-4000-8000-000000000009",
  runningNullLeaseRecent: "10000000-0000-4000-8000-000000000010",
  supportRunningNullLeaseOld: "10000000-0000-4000-8000-000000000011",
};

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function serviceScalar(db, sql, params = []) {
  await db.exec("set role service_role");
  try {
    return await scalar(db, sql, params);
  } finally {
    await db.exec("reset role");
  }
}

test("scheduled maintenance expires only bounded stale non-CS AI work and remains idempotent", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;
      create schema sellerpilot_private;
      create table sellerpilot_private.ai_cli_jobs (
        id uuid primary key,
        kind text not null,
        status text not null,
        request_payload jsonb not null default '{}'::jsonb,
        result_payload jsonb,
        error_message text,
        attempt_count integer not null default 0,
        worker_token_id uuid,
        claim_token uuid,
        lease_expires_at timestamptz,
        available_at timestamptz not null default clock_timestamp(),
        retry_started_at timestamptz,
        created_at timestamptz not null default clock_timestamp(),
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default clock_timestamp()
      );
      create table sellerpilot_private.ai_cli_audit (
        id bigint generated always as identity primary key,
        action text not null,
        job_id uuid,
        safe_detail jsonb not null default '{}'::jsonb
      );
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.exec(await readFile(opaqueSecretGuardFixUrl, "utf8"));

    assert.equal(await scalar(
      db,
      "select has_function_privilege('anon', 'public.sellerpilot_service_expire_stale_ai_jobs(timestamptz,integer)', 'EXECUTE')",
    ), false);
    assert.equal(await scalar(
      db,
      "select has_function_privilege('authenticated', 'public.sellerpilot_service_expire_stale_ai_jobs(timestamptz,integer)', 'EXECUTE')",
    ), false);
    assert.equal(await scalar(
      db,
      "select has_function_privilege('service_role', 'public.sellerpilot_service_expire_stale_ai_jobs(timestamptz,integer)', 'EXECUTE')",
    ), true);

    await db.exec("set role anon");
    await assert.rejects(
      scalar(db, "select public.sellerpilot_service_expire_stale_ai_jobs(now() - interval '1 day', 2)"),
      /permission denied/,
    );
    await db.exec("reset role");
    await assert.rejects(
      serviceScalar(db, "select public.sellerpilot_service_expire_stale_ai_jobs(now() - interval '1 hour', 2)"),
      /at least six hours/,
    );

    await db.query(`
      insert into sellerpilot_private.ai_cli_jobs (
        id, kind, status, result_payload, worker_token_id, claim_token,
        lease_expires_at, available_at, retry_started_at, created_at, started_at
      ) values
        ($1, 'product_studio', 'running', '{"partial":true}', $8, $9,
          now() - interval '1 minute', now(), null, now() - interval '2 days', now() - interval '2 hours'),
        ($2, 'product_studio', 'queued', '{"stale":true}', null, null,
          null, now() - interval '2 days', null, now() - interval '4 days', null),
        ($3, 'product_research', 'queued', null, null, null,
          null, now() - interval '2 days', now() - interval '3 days', now() - interval '5 days', null),
        ($4, 'product_asset_regeneration', 'queued', null, null, null,
          null, now() - interval '2 days', null, now() - interval '2 days', null),
        ($5, 'product_studio', 'queued', null, null, null,
          null, now(), null, now() - interval '2 hours', null),
        ($6, 'product_studio', 'running', null, $8, $10,
          now() + interval '5 minutes', now(), null, now() - interval '2 days', now() - interval '1 hour'),
        ($7, 'support_reply', 'queued', null, null, null,
          null, now() - interval '2 days', null, now() - interval '4 days', null),
        ($11, 'product_studio', 'queued', null, null, null,
          null, now() + interval '1 hour', null, now() - interval '4 days', null),
        ($12, 'product_research', 'running', '{"legacy":true}', $8, $9,
          null, now(), null, now() - interval '3 days', now() - interval '2 days'),
        ($13, 'product_studio', 'running', null, $8, $10,
          null, now(), null, now() - interval '2 hours', now() - interval '1 hour'),
        ($14, 'support_reply', 'running', null, $8, $10,
          null, now(), null, now() - interval '3 days', now() - interval '2 days')
    `, [
      ids.runningExpired,
      ids.queuedOldest,
      ids.queuedResearch,
      ids.queuedRegeneration,
      ids.queuedRecent,
      ids.runningLive,
      ids.supportReply,
      "20000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
      ids.queuedFuture,
      ids.runningNullLeaseOld,
      ids.runningNullLeaseRecent,
      ids.supportRunningNullLeaseOld,
    ]);

    assert.deepEqual(
      await serviceScalar(db, "select public.sellerpilot_service_expire_stale_ai_jobs(now() - interval '1 day', 2)"),
      { queuedExpired: 0, runningExpired: 2, total: 2 },
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.ai_cli_jobs where status = 'failed'"),
      2,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.ai_cli_audit where action = 'job_failed' and safe_detail->>'retryable' = 'true'"),
      2,
    );
    const expiredRunning = (await db.query(
      "select status, result_payload, worker_token_id, claim_token, lease_expires_at, error_message from sellerpilot_private.ai_cli_jobs where id = $1",
      [ids.runningExpired],
    )).rows[0];
    assert.equal(expiredRunning.status, "failed");
    assert.equal(expiredRunning.result_payload, null);
    assert.equal(expiredRunning.worker_token_id, null);
    assert.equal(expiredRunning.claim_token, null);
    assert.equal(expiredRunning.lease_expires_at, null);
    assert.match(expiredRunning.error_message, /기존 입력으로 다시 시도/);

    assert.deepEqual(
      await serviceScalar(db, "select public.sellerpilot_service_expire_stale_ai_jobs(now() - interval '1 day', 2)"),
      { queuedExpired: 2, runningExpired: 0, total: 2 },
    );
    assert.deepEqual(
      await serviceScalar(db, "select public.sellerpilot_service_expire_stale_ai_jobs(now() - interval '1 day', 2)"),
      { queuedExpired: 1, runningExpired: 0, total: 1 },
    );
    assert.deepEqual(
      await serviceScalar(db, "select public.sellerpilot_service_expire_stale_ai_jobs(now() - interval '1 day', 2)"),
      { queuedExpired: 0, runningExpired: 0, total: 0 },
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.ai_cli_audit where action = 'job_failed'"),
      5,
    );

    const untouched = await db.query(
      "select id::text, status from sellerpilot_private.ai_cli_jobs where id = any($1::uuid[]) order by id",
      [[ids.queuedRecent, ids.runningLive, ids.supportReply, ids.queuedFuture, ids.runningNullLeaseRecent, ids.supportRunningNullLeaseOld]],
    );
    assert.deepEqual(untouched.rows, [
      { id: ids.queuedRecent, status: "queued" },
      { id: ids.runningLive, status: "running" },
      { id: ids.supportReply, status: "queued" },
      { id: ids.queuedFuture, status: "queued" },
      { id: ids.runningNullLeaseRecent, status: "running" },
      { id: ids.supportRunningNullLeaseOld, status: "running" },
    ]);
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});

test("maintenance reports stale AI recovery failures after continuing independent cleanup", async () => {
  const [route, migration, opaqueSecretGuardFix] = await Promise.all([
    readFile(maintenanceRouteUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
    readFile(opaqueSecretGuardFixUrl, "utf8"),
  ]);

  assert.match(route, /STALE_AI_QUEUED_TIMEOUT_MS = 24 \* 60 \* 60_000/);
  assert.match(route, /STALE_AI_RECOVERY_LIMIT = 100/);
  assert.match(route, /sellerpilot_service_expire_stale_ai_jobs/);
  assert.match(route, /p_queued_before: new Date\(Date\.now\(\) - STALE_AI_QUEUED_TIMEOUT_MS\)\.toISOString\(\)/);
  assert.match(route, /p_limit: STALE_AI_RECOVERY_LIMIT/);
  assert.ok(
    route.indexOf("expireStaleAiJobs(serviceClient)")
      < route.indexOf("queueRefreshIfNeeded(serviceClient, \"shopee\")"),
    "stale AI recovery must be attempted even when a later OAuth maintenance step fails",
  );
  assert.match(
    route,
    /if \(!staleAiJobsRecovery\.ok \|\| !staleGatewayJobsRecovery\.ok \|\| !stalePushDeliveryRecovery\.ok\)[\s\S]{0,2000}status: 502/,
  );
  assert.match(route, /다른 정리 작업 결과는 아래에 보존했습니다/);
  assert.match(route, /total !== queuedExpired \+ runningExpired/);

  assert.match(migration, /job\.status = 'running'[\s\S]{0,420}job\.lease_expires_at < v_now/);
  assert.match(migration, /job\.lease_expires_at is null[\s\S]{0,180}coalesce\(job\.started_at, job\.updated_at, job\.created_at\) < p_queued_before/);
  assert.match(migration, /job\.status = 'queued'[\s\S]{0,220}coalesce\(job\.retry_started_at, job\.created_at\) < p_queued_before/);
  assert.match(migration, /for update of job skip locked[\s\S]{0,80}limit v_limit/);
  assert.match(migration, /kind in \('product_studio', 'product_research', 'product_asset_regeneration'\)/);
  assert.doesNotMatch(migration, /kind in \([^)]*support_reply/);
  assert.match(migration, /'source', 'scheduled_maintenance'/);
  assert.match(migration, /'retryable', true/);
  assert.match(migration, /revoke all on function public\.sellerpilot_service_expire_stale_ai_jobs[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.sellerpilot_service_expire_stale_ai_jobs[\s\S]*to service_role/);
  assert.match(opaqueSecretGuardFix, /pg_get_functiondef/);
  assert.match(opaqueSecretGuardFix, /expected legacy role guard was not found/);
  assert.match(opaqueSecretGuardFix, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(opaqueSecretGuardFix, /grant execute on function[\s\S]*to service_role/);
});
