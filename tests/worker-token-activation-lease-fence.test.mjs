import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828143500_harden_worker_token_activation_lease_fence.sql",
  import.meta.url,
);
const retirementMigrationUrl = new URL(
  "../supabase/migrations/20260828150000_remove_legacy_combined_worker_scope.sql",
  import.meta.url,
);
const tokenRouteUrl = new URL("../app/api/admin/ai-worker-token/route.ts", import.meta.url);

const OLD_SET_ID = "10000000-0000-4000-8000-000000000001";
const REPLACEMENT_SET_ID = "20000000-0000-4000-8000-000000000001";
const LEGACY_HASH = "a".repeat(64);
const OLD_AI_HASH = "b".repeat(64);
const OLD_GATEWAY_HASH = "c".repeat(64);
const OLD_SCHEDULER_HASH = "d".repeat(64);
const REPLACEMENT_HASHES = {
  ai: "1".repeat(64),
  gateway: "2".repeat(64),
  scheduler: "3".repeat(64),
};

async function createWorkerFenceDb() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

    create schema sellerpilot_private;
    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key default gen_random_uuid(),
      label text,
      token_hash text not null unique,
      fingerprint text not null,
      status text not null,
      scope text not null,
      expires_at timestamptz not null,
      rotation_set_id uuid,
      activation_expires_at timestamptz,
      activated_at timestamptz,
      last_seen_at timestamptz,
      last_version text,
      revoked_at timestamptz
    );
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key default gen_random_uuid(),
      worker_token_id uuid,
      status text not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      worker_token_id uuid,
      status text not null
    );
    create table sellerpilot_private.ai_cli_audit (
      action text not null,
      worker_token_id uuid,
      safe_detail jsonb not null
    );

    create function public.sellerpilot_claim_product_ai_job(
      p_token_hash text,
      p_worker_version text default null
    )
    returns jsonb
    language sql
    security definer
    set search_path = ''
    as $$ select null::jsonb $$;
  `);
  return db;
}

async function insertPendingReplacementSet(db) {
  await db.query(
    `insert into sellerpilot_private.ai_cli_worker_tokens (
       label, token_hash, fingerprint, status, scope, expires_at,
       rotation_set_id, activation_expires_at
     ) values
       ('Replacement AI', $1, '111111111111', 'pending', 'ai',
        clock_timestamp() + interval '1 day', $4, clock_timestamp() + interval '1 hour'),
       ('Replacement gateway', $2, '222222222222', 'pending', 'gateway',
        clock_timestamp() + interval '1 day', $4, clock_timestamp() + interval '1 hour'),
       ('Replacement scheduler', $3, '333333333333', 'pending', 'scheduler',
        clock_timestamp() + interval '1 day', $4, clock_timestamp() + interval '1 hour')`,
    [
      REPLACEMENT_HASHES.ai,
      REPLACEMENT_HASHES.gateway,
      REPLACEMENT_HASHES.scheduler,
      REPLACEMENT_SET_ID,
    ],
  );
}

async function activateReplacementSet(db) {
  const result = await db.query(
    `select public.sellerpilot_service_activate_worker_token_set(
       $1, $2::jsonb
     ) as result`,
    [REPLACEMENT_SET_ID, JSON.stringify(REPLACEMENT_HASHES)],
  );
  return result.rows[0].result;
}

test("worker token activation fences active combined-worker leases before mutation", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const functionBody = migration.match(
    /create or replace function public\.sellerpilot_service_activate_worker_token_set\([\s\S]*?\n\$\$;/,
  )?.[0] ?? "";

  assert.ok(functionBody, "activation function replacement must be present");
  assert.match(functionBody, /security definer\s+set search_path = ''/);

  const advisoryLock = functionBody.indexOf("pg_advisory_xact_lock(193674993, 821065043)");
  const tokenTableLock = functionBody.indexOf(
    "lock table sellerpilot_private.ai_cli_worker_tokens in share row exclusive mode",
  );
  const aiLeaseCount = functionBody.indexOf("from sellerpilot_private.ai_cli_jobs job");
  const gatewayLeaseCount = functionBody.indexOf("from sellerpilot_private.channel_gateway_jobs job");
  const firstTokenMutation = functionBody.indexOf("update sellerpilot_private.ai_cli_worker_tokens token");

  assert.ok(advisoryLock >= 0, "activation must acquire the rotation advisory lock");
  assert.ok(tokenTableLock > advisoryLock, "token-table lock must follow the advisory lock");
  assert.ok(aiLeaseCount > tokenTableLock, "AI lease count must run under both locks");
  assert.ok(gatewayLeaseCount > aiLeaseCount, "gateway lease count must run under both locks");
  assert.ok(firstTokenMutation > gatewayLeaseCount, "no token may change before both lease counts complete");

  const aiFence = functionBody.slice(aiLeaseCount, gatewayLeaseCount);
  const gatewayFence = functionBody.slice(gatewayLeaseCount, firstTokenMutation);
  for (const fence of [aiFence, gatewayFence]) {
    assert.match(fence, /on token\.id = job\.worker_token_id/);
    assert.match(fence, /token\.scope in \('ai', 'gateway', 'scheduler', 'legacy_combined'\)/);
    assert.match(fence, /token\.status = 'active'/);
    assert.match(fence, /token\.rotation_set_id is distinct from p_rotation_set_id/);
    assert.match(fence, /job\.status = 'running'/);
    assert.doesNotMatch(
      fence,
      /lease_expires_at/,
      "running jobs must fail closed even if their recorded lease time looks stale",
    );
  }
  assert.match(
    functionBody,
    /if v_ai_running > 0 or v_gateway_running > 0 then[\s\S]*?'status', 'leases_active'[\s\S]*?'aiRunning', v_ai_running[\s\S]*?'gatewayRunning', v_gateway_running/,
  );
  assert.match(
    migration,
    /revoke all on function public\.sellerpilot_service_activate_worker_token_set\([\s\S]*?from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.sellerpilot_service_activate_worker_token_set\([\s\S]*?to service_role;/,
  );
});

test("admin activation route validates and reports the lease fence as HTTP 409", async () => {
  const route = await readFile(tokenRouteUrl, "utf8");

  assert.match(route, /z\.discriminatedUnion\("status", \[/);
  assert.match(
    route,
    /status: z\.literal\("leases_active"\),\s*aiRunning: z\.number\(\)\.int\(\)\.nonnegative\(\),\s*gatewayRunning: z\.number\(\)\.int\(\)\.nonnegative\(\),/,
  );
  assert.match(
    route,
    /if \(result\.data\.status === "leases_active"\) \{[\s\S]*?status: result\.data\.status,[\s\S]*?aiRunning: result\.data\.aiRunning,[\s\S]*?gatewayRunning: result\.data\.gatewayRunning,[\s\S]*?토큰을 교체하지 않았습니다\.[\s\S]*?status: 409/,
  );

  const leaseResponse = route.indexOf('if (result.data.status === "leases_active")');
  const activatedResponse = route.indexOf('status: "activated"', leaseResponse);
  assert.ok(leaseResponse >= 0 && activatedResponse > leaseResponse, "lease fence must precede activation success");
});

test("worker token activation fences running jobs owned by the scoped set being replaced", async () => {
  const db = await createWorkerFenceDb();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at,
         rotation_set_id, activated_at, last_seen_at
       ) values
         ('Old AI', $1, 'BBBBBBBBBBBB', 'active', 'ai',
          clock_timestamp() + interval '1 day', $4, clock_timestamp(), clock_timestamp()),
         ('Old gateway', $2, 'CCCCCCCCCCCC', 'active', 'gateway',
          clock_timestamp() + interval '1 day', $4, clock_timestamp(), clock_timestamp()),
         ('Old scheduler', $3, 'DDDDDDDDDDDD', 'active', 'scheduler',
          clock_timestamp() + interval '1 day', $4, clock_timestamp(), clock_timestamp())`,
      [OLD_AI_HASH, OLD_GATEWAY_HASH, OLD_SCHEDULER_HASH, OLD_SET_ID],
    );
    await insertPendingReplacementSet(db);
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (worker_token_id, status)
       select id, 'running'
         from sellerpilot_private.ai_cli_worker_tokens
        where token_hash = $1`,
      [OLD_AI_HASH],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (worker_token_id, status)
       select id, 'running'
         from sellerpilot_private.ai_cli_worker_tokens
        where token_hash = $1`,
      [OLD_GATEWAY_HASH],
    );

    await db.exec(await readFile(migrationUrl, "utf8"));
    assert.deepEqual(await activateReplacementSet(db), {
      status: "leases_active",
      aiRunning: 1,
      gatewayRunning: 1,
    });
    assert.deepEqual(
      (await db.query(
        `select status, count(*)::integer as count
           from sellerpilot_private.ai_cli_worker_tokens
          group by status
          order by status`,
      )).rows,
      [
        { status: "active", count: 3 },
        { status: "pending", count: 3 },
      ],
    );

    await db.query("update sellerpilot_private.ai_cli_jobs set status = 'succeeded'");
    await db.query("update sellerpilot_private.channel_gateway_jobs set status = 'succeeded'");
    assert.deepEqual(await activateReplacementSet(db), {
      status: "activated",
      tokenSetId: REPLACEMENT_SET_ID,
      replayed: false,
    });
    assert.deepEqual(
      (await db.query(
        `select rotation_set_id::text as rotation_set_id, status, count(*)::integer as count
           from sellerpilot_private.ai_cli_worker_tokens
          group by rotation_set_id, status
          order by status, rotation_set_id`,
      )).rows,
      [
        { rotation_set_id: REPLACEMENT_SET_ID, status: "active", count: 3 },
        { rotation_set_id: OLD_SET_ID, status: "revoked", count: 3 },
      ],
    );
  } finally {
    await db.close();
  }
});

test("legacy retirement rejects the just-activated set until every scope heartbeats", async () => {
  const db = await createWorkerFenceDb();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at,
         activated_at, last_seen_at
       ) values (
         'Legacy combined', $1, 'AAAAAAAAAAAA', 'active', 'legacy_combined',
         clock_timestamp() + interval '1 day', clock_timestamp(), clock_timestamp()
       )`,
      [LEGACY_HASH],
    );
    await insertPendingReplacementSet(db);
    await db.exec(await readFile(migrationUrl, "utf8"));
    assert.deepEqual(await activateReplacementSet(db), {
      status: "activated",
      tokenSetId: REPLACEMENT_SET_ID,
      replayed: false,
    });
    assert.equal(
      (await db.query(
        `select count(*)::integer as count
           from sellerpilot_private.ai_cli_worker_tokens
          where rotation_set_id = $1
            and status = 'active'
            and last_seen_at is null`,
        [REPLACEMENT_SET_ID],
      )).rows[0].count,
      3,
    );

    const retirementMigration = await readFile(retirementMigrationUrl, "utf8");
    await assert.rejects(
      db.exec(retirementMigration),
      (error) => {
        assert.equal(error.code, "55000");
        assert.match(
          error.message,
          /active heartbeat-verified scoped worker token set required before retiring legacy_combined/,
        );
        return true;
      },
    );
    await db.exec("rollback").catch(() => undefined);
    assert.equal(
      (await db.query(
        `select to_regprocedure(
           'public.sellerpilot_20260828_claim_product_ai_job_scoped_once(text,text)'
         ) is null as untouched`,
      )).rows[0].untouched,
      true,
    );

    await db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set last_seen_at = activated_at
        where rotation_set_id = $1
          and status = 'active'
          and scope in ('ai', 'gateway', 'scheduler')`,
      [REPLACEMENT_SET_ID],
    );
    await db.exec(retirementMigration);
    assert.equal(
      (await db.query(
        `select to_regprocedure(
           'public.sellerpilot_20260828_claim_product_ai_job_scoped_once(text,text)'
         ) is not null as applied`,
      )).rows[0].applied,
      true,
    );
  } finally {
    await db.close();
  }
});

test("legacy retirement allows only a genuinely empty worker-token ledger without heartbeats", async () => {
  const db = await createWorkerFenceDb();
  try {
    await db.exec(await readFile(retirementMigrationUrl, "utf8"));
    assert.equal(
      (await db.query(
        `select to_regprocedure(
           'public.sellerpilot_20260828_claim_product_ai_job_scoped_once(text,text)'
         ) is not null as applied`,
      )).rows[0].applied,
      true,
    );
  } finally {
    await db.close();
  }
});
