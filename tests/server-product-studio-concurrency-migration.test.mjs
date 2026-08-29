import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260829031000_bound_server_product_studio_concurrency.sql",
  import.meta.url,
);
const FIRST_TOKEN_HASH = "a".repeat(64);
const SECOND_TOKEN_HASH = "b".repeat(64);
const FIRST_TOKEN_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_TOKEN_ID = "10000000-0000-4000-8000-000000000002";
const JOB_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
];
const EXPIRED_RETRY_JOB_ID = "20000000-0000-4000-8000-000000000005";
const EXPIRED_TERMINAL_JOB_ID = "20000000-0000-4000-8000-000000000006";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function createSchemaFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;
    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key,
      token_hash text not null unique,
      scope text not null,
      status text not null,
      expires_at timestamptz not null,
      last_seen_at timestamptz,
      last_version text
    );
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key,
      kind text not null,
      request_payload jsonb not null default '{}'::jsonb,
      status text not null default 'queued',
      worker_token_id uuid,
      claim_token uuid,
      attempt_count integer not null default 0,
      available_at timestamptz not null default now(),
      lease_expires_at timestamptz,
      error_message text,
      terminal_image_failure_context jsonb,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table sellerpilot_private.ai_cli_audit (
      id bigint generated always as identity primary key,
      action text not null,
      worker_token_id uuid,
      job_id uuid,
      safe_detail jsonb not null default '{}'::jsonb
    );
  `);
  return db;
}

async function createFixture() {
  const db = await createSchemaFixture();
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.query(
    `insert into sellerpilot_private.ai_cli_worker_tokens (
       id, token_hash, scope, status, expires_at
     ) values
       ($1, $2, 'ai', 'active', now() + interval '1 day'),
       ($3, $4, 'ai', 'active', now() + interval '1 day')`,
    [FIRST_TOKEN_ID, FIRST_TOKEN_HASH, SECOND_TOKEN_ID, SECOND_TOKEN_HASH],
  );
  for (const [index, id] of JOB_IDS.entries()) {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, request_payload, available_at, created_at
       ) values ($1, 'product_studio', $2::jsonb, now() - ($3::text || ' minutes')::interval,
         now() - ($3::text || ' minutes')::interval)`,
      [id, JSON.stringify({ retryIdentity: `product-${index + 1}` }), 10 - index],
    );
  }
  return db;
}

test("the forward migration adds only an atomic one-job claim fence", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const lock = migration.indexOf("pg_advisory_xact_lock(193674993, 821065061)");
  const count = migration.indexOf("select count(*)::integer");
  const admission = migration.indexOf("if v_running_jobs >= 1 then return null; end if;");
  const queuedClaim = migration.indexOf("for update skip locked", admission);

  assert.ok(lock > 0 && lock < count && count < admission && admission < queuedClaim);
  assert.match(migration, /job\.kind in \('product_studio', 'product_asset_regeneration'\)/);
  assert.match(migration, /'request', job\.request_payload/);
  assert.match(migration, /'claim_token', job\.claim_token/);
  assert.match(migration, /lease_expires_at = clock_timestamp\(\) \+ interval '15 minutes'/);
  assert.match(migration, /if v_running_jobs > 1 then[\s\S]*concurrency must be quiesced before migration/);
  assert.match(
    migration,
    /create unique index ai_cli_jobs_single_server_studio_running_uidx\s+on sellerpilot_private\.ai_cli_jobs \(\(1\)\)\s+where status = 'running'\s+and kind in \('product_studio', 'product_asset_regeneration'\)/,
  );
  assert.equal(
    [...migration.matchAll(/create\s+(?:unique\s+)?index\s+/gi)].length,
    1,
    "the forward migration must add only the single declarative Studio fence",
  );
  assert.doesNotMatch(migration, /create\s+table|alter\s+table|add\s+column/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.sellerpilot_claim_product_ai_job\(text, text\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.sellerpilot_claim_product_ai_job\(text, text\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /listing|channel_gateway|publish/i);
});

test("migration fails closed when rollout was not quiesced", async () => {
  const db = await createSchemaFixture();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, request_payload, status, attempt_count,
         available_at, lease_expires_at, created_at, updated_at
       ) values
         ($1, 'product_studio', '{}'::jsonb, 'running', 1,
          now(), now() + interval '10 minutes', now(), now()),
         ($2, 'product_asset_regeneration', '{}'::jsonb, 'running', 1,
          now(), now() + interval '10 minutes', now(), now())`,
      [JOB_IDS[0], JOB_IDS[1]],
    );
    await assert.rejects(
      db.exec(await readFile(migrationUrl, "utf8")),
      /concurrency must be quiesced before migration/,
    );
    await db.exec("rollback").catch(() => {});
  } finally {
    await db.close();
  }
});

test("two active worker tokens cannot claim a second Studio job, while each terminal job releases the next exact retry", async () => {
  const db = await createFixture();
  try {
    await db.exec("set role service_role");
    const [first, blocked] = await Promise.all([
      scalar(db, "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/a')", [FIRST_TOKEN_HASH]),
      scalar(db, "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/b')", [SECOND_TOKEN_HASH]),
    ]);
    const initialClaims = [first, blocked].filter(Boolean);
    assert.equal(initialClaims.length, 1);
    assert.equal(initialClaims[0].id, JOB_IDS[0]);
    assert.deepEqual(initialClaims[0].request, { retryIdentity: "product-1" });
    assert.match(initialClaims[0].claim_token, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/fourth') is null", [FIRST_TOKEN_HASH]),
      true,
    );
    await db.exec("reset role");

    // A terminal failure is isolated to its exact claim and immediately frees
    // the serial admission slot for the next preserved request.
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set status='failed', completed_at=now() where id=$1",
      [JOB_IDS[0]],
    );
    await db.exec("set role service_role");
    const second = await scalar(
      db,
      "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/next')",
      [SECOND_TOKEN_HASH],
    );
    assert.equal(second.id, JOB_IDS[1]);
    assert.deepEqual(second.request, { retryIdentity: "product-2" });
    await db.exec("reset role");

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set status='succeeded', completed_at=now() where id=$1",
      [JOB_IDS[1]],
    );
    await db.exec("set role service_role");
    const third = await scalar(
      db,
      "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/third')",
      [FIRST_TOKEN_HASH],
    );
    assert.equal(third.id, JOB_IDS[2]);
    assert.deepEqual(third.request, { retryIdentity: "product-3" });
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/blocked-fourth') is null", [SECOND_TOKEN_HASH]),
      true,
    );
  } finally {
    await db.exec("reset role").catch(() => {});
    await db.close();
  }
});

test("the declarative fence rejects a second running Studio writer outside the claim RPC", async () => {
  const db = await createFixture();
  try {
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status='running', attempt_count=1, lease_expires_at=now()+interval '10 minutes'
        where id=$1`,
      [JOB_IDS[0]],
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.ai_cli_jobs
            set status='running', attempt_count=1, lease_expires_at=now()+interval '10 minutes'
          where id=$1`,
        [JOB_IDS[1]],
      ),
      /ai_cli_jobs_single_server_studio_running_uidx|unique constraint/i,
    );
  } finally {
    await db.close();
  }
});

test("expired leases retry only through attempt three and then become terminal without consuming the slot", async () => {
  const db = await createFixture();
  try {
    await db.exec("update sellerpilot_private.ai_cli_jobs set status='cancelled'");
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, request_payload, status, worker_token_id, claim_token,
         attempt_count, available_at, lease_expires_at, created_at, updated_at
       ) values (
         $1, 'product_studio', '{"retryIdentity":"expired-third"}'::jsonb,
         'running', $2, gen_random_uuid(), 2, now() - interval '1 hour',
         now() - interval '1 minute', now() - interval '2 hours', now() - interval '1 hour'
       )`,
      [EXPIRED_RETRY_JOB_ID, FIRST_TOKEN_ID],
    );

    await db.exec("set role service_role");
    const thirdAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/expired-third')",
      [FIRST_TOKEN_HASH],
    );
    await db.exec("reset role");
    assert.equal(thirdAttempt.id, EXPIRED_RETRY_JOB_ID);
    assert.equal(thirdAttempt.attempt_count, 3);
    assert.deepEqual(thirdAttempt.request, { retryIdentity: "expired-third" });

    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set lease_expires_at=now()-interval '1 minute'
        where id=$1`,
      [EXPIRED_RETRY_JOB_ID],
    );

    await db.exec("set role service_role");
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/expired-third-terminal') is null", [FIRST_TOKEN_HASH]),
      true,
    );
    await db.exec("reset role");

    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, request_payload, status, worker_token_id, claim_token,
         attempt_count, available_at, lease_expires_at, created_at, updated_at
       ) values (
         $1, 'product_asset_regeneration', '{"retryIdentity":"already-terminal"}'::jsonb,
         'running', $2, gen_random_uuid(), 3, now() - interval '1 hour',
         now() - interval '1 minute', now() - interval '2 hours', now() - interval '1 hour'
       )`,
      [EXPIRED_TERMINAL_JOB_ID, SECOND_TOKEN_ID],
    );

    await db.exec("set role service_role");
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_product_ai_job($1, 'vercel-studio/terminal') is null", [SECOND_TOKEN_HASH]),
      true,
    );
    await db.exec("reset role");
    assert.deepEqual((await db.query(
      `select id::text, status, attempt_count, claim_token, worker_token_id,
              completed_at is not null as completed
         from sellerpilot_private.ai_cli_jobs
        where id in ($1, $2)
        order by id`,
      [EXPIRED_RETRY_JOB_ID, EXPIRED_TERMINAL_JOB_ID],
    )).rows, [
      {
        id: EXPIRED_RETRY_JOB_ID,
        status: "failed",
        attempt_count: 3,
        claim_token: null,
        worker_token_id: null,
        completed: true,
      },
      {
        id: EXPIRED_TERMINAL_JOB_ID,
        status: "failed",
        attempt_count: 3,
        claim_token: null,
        worker_token_id: null,
        completed: true,
      },
    ]);
  } finally {
    await db.exec("reset role").catch(() => {});
    await db.close();
  }
});
