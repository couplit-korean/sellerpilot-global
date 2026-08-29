import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828135000_server_product_research_runtime.sql",
  import.meta.url,
);
const secretGuardFixMigrationUrl = new URL(
  "../supabase/migrations/20260828135100_fix_server_product_research_secret_guard.sql",
  import.meta.url,
);
const serverCompletionMigrationUrl = new URL(
  "../supabase/migrations/20260829114703_accept_server_product_research_completion.sql",
  import.meta.url,
);
const RESEARCH_JOB_ID = "10000000-0000-4000-8000-000000000001";
const EXPIRED_DESKTOP_JOB_ID = "10000000-0000-4000-8000-000000000002";
const STUDIO_JOB_ID = "10000000-0000-4000-8000-000000000003";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key,
      kind text not null,
      status text not null default 'queued',
      request_payload jsonb not null default '{}'::jsonb,
      result_payload jsonb,
      error_message text,
      attempt_count integer not null default 0,
      worker_token_id uuid,
      claim_token uuid,
      lease_expires_at timestamptz,
      available_at timestamptz not null default clock_timestamp(),
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
    create function sellerpilot_private.ai_completion_fingerprint(
      p_status text,
      p_result_payload jsonb,
      p_error_message text
    ) returns text
    language sql immutable
    as $$
      select md5(jsonb_build_object(
        'status', p_status,
        'result', p_result_payload,
        'error', p_error_message
      )::text) || md5('sellerpilot:' || jsonb_build_object(
        'status', p_status,
        'result', p_result_payload,
        'error', p_error_message
      )::text)
    $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(await readFile(secretGuardFixMigrationUrl, "utf8"));
  await db.exec(await readFile(serverCompletionMigrationUrl, "utf8"));
  return db;
}

async function assumeServiceRole(db) {
  await db.exec("set role service_role");
}

test("server research migration is service-only and structurally isolated", async () => {
  const [migration, secretGuardFixMigration, serverCompletionMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(secretGuardFixMigrationUrl, "utf8"),
    readFile(serverCompletionMigrationUrl, "utf8"),
  ]);
  assert.match(migration, /job\.kind = 'product_research'/);
  assert.doesNotMatch(migration, /job\.kind\s+in\s*\([^)]*product_studio/i);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /server_product_research_completion_receipts/);
  assert.match(migration, /status in \('queued', 'succeeded', 'failed'\)/);
  assert.match(migration, /primary key \(job_id, claim_token\)/);
  assert.match(migration, /worker_token_id is null/);
  assert.match(migration, /current_setting\('request\.jwt\.claim\.role'/);
  assert.doesNotMatch(migration, /vault|channel_gateway|credential|shipment|listing/i);
  for (const signature of [
    "sellerpilot_service_claim_product_research_ai_job(text)",
    "sellerpilot_service_touch_product_research_ai_job(uuid,uuid)",
    "sellerpilot_service_complete_product_research_ai_job(uuid,uuid,jsonb)",
    "sellerpilot_service_release_product_research_ai_job(uuid,uuid,text,boolean,integer)",
  ]) {
    assert.match(secretGuardFixMigration, new RegExp(signature.replace(/[()]/g, "\\$&")));
  }
  assert.match(secretGuardFixMigration, /v_rewritten := replace\(v_definition, v_guard, ''\)/);
  assert.match(secretGuardFixMigration, /grant execute on function public\.sellerpilot_service_claim_product_research_ai_job\(text\)[\s\S]*to service_role/);
  assert.match(serverCompletionMigration, /p_result_payload->>'mode' not in \('cli-research', 'server-research'\)/);
  assert.match(serverCompletionMigration, /security definer[\s\S]*set search_path = ''/);
  assert.match(serverCompletionMigration, /revoke all on function public\.sellerpilot_service_complete_product_research_ai_job\(uuid, uuid, jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(serverCompletionMigration, /grant execute on function public\.sellerpilot_service_complete_product_research_ai_job\(uuid, uuid, jsonb\)[\s\S]*to service_role/);
});

test("server claimant claims research only and never takes a studio job", async () => {
  const db = await fixture();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload,created_at)
       values
         ($1,'product_research','{"research_input":"research me"}',clock_timestamp()-interval '2 minutes'),
         ($2,'product_studio','{}',clock_timestamp()-interval '1 minute')`,
      [RESEARCH_JOB_ID, STUDIO_JOB_ID],
    );
    await assumeServiceRole(db);
    assert.equal(
      (await scalar(db, "select current_setting('request.jwt.claim.role', true)")) ?? "",
      "",
      "opaque sb_secret service-role execution must not depend on the legacy JWT GUC",
    );
    const claimed = await scalar(
      db,
      "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')",
    );
    assert.equal(claimed.id, RESEARCH_JOB_ID);
    assert.equal(claimed.kind, "product_research");
    assert.equal(claimed.claim_scope, "server_product_research");
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0') is null"),
      true,
    );
    await db.exec("reset role");
    assert.deepEqual((await db.query(
      "select status,attempt_count,claim_token from sellerpilot_private.ai_cli_jobs where id=$1",
      [STUDIO_JOB_ID],
    )).rows, [{ status: "queued", attempt_count: 0, claim_token: null }]);
  } finally {
    await db.close();
  }
});

test("server claimant safely takes over an expired desktop research lease", async () => {
  const db = await fixture();
  try {
    const desktopClaim = "30000000-0000-4000-8000-000000000001";
    const desktopWorker = "40000000-0000-4000-8000-000000000001";
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(
         id,kind,status,request_payload,attempt_count,worker_token_id,
         claim_token,lease_expires_at
       ) values (
         $1,'product_research','running','{"research_input":"recover me"}',
         1,$2,$3,clock_timestamp()-interval '1 second'
       )`,
      [EXPIRED_DESKTOP_JOB_ID, desktopWorker, desktopClaim],
    );
    await assumeServiceRole(db);
    const claimed = await scalar(
      db,
      "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')",
    );
    assert.equal(claimed.id, EXPIRED_DESKTOP_JOB_ID);
    assert.notEqual(claimed.claim_token, desktopClaim);
    assert.equal(claimed.attempt_count, 2);
    await db.exec("reset role");
    assert.deepEqual((await db.query(
      "select status,worker_token_id,claim_token from sellerpilot_private.ai_cli_jobs where id=$1",
      [EXPIRED_DESKTOP_JOB_ID],
    )).rows, [{ status: "running", worker_token_id: null, claim_token: claimed.claim_token }]);
  } finally {
    await db.close();
  }
});

test("server completion is claim-fenced and exactly idempotent", async () => {
  const db = await fixture();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload)
       values ($1,'product_research','{"research_input":"research me"}')`,
      [RESEARCH_JOB_ID],
    );
    await assumeServiceRole(db);
    const claimed = await scalar(
      db,
      "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_touch_product_research_ai_job($1,$2)",
        [RESEARCH_JOB_ID, claimed.claim_token],
      ),
      "running",
    );
    const result = JSON.stringify({ mode: "server-research", summary: "first" });
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_research_ai_job($1,$2,$3::jsonb)",
        [RESEARCH_JOB_ID, claimed.claim_token, result],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_research_ai_job($1,$2,$3::jsonb)",
        [RESEARCH_JOB_ID, claimed.claim_token, result],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_research_ai_job($1,$2,$3::jsonb)",
        [RESEARCH_JOB_ID, claimed.claim_token, JSON.stringify({ mode: "server-research", summary: "changed" })],
      ),
      false,
    );
    await db.exec("reset role");
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.ai_cli_jobs where id=$1", [RESEARCH_JOB_ID]),
      "succeeded",
    );
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status='queued', result_payload=null, completed_at=null,
              available_at=clock_timestamp()
        where id=$1`,
      [RESEARCH_JOB_ID],
    );
    await assumeServiceRole(db);
    const retried = await scalar(
      db,
      "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')",
    );
    assert.notEqual(retried.claim_token, claimed.claim_token);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_research_ai_job($1,$2,$3::jsonb)",
        [RESEARCH_JOB_ID, retried.claim_token, JSON.stringify({ mode: "server-research", summary: "retry" })],
      ),
      true,
    );
  } finally {
    await db.close();
  }
});

test("server completion keeps cutover compatibility and rejects unknown result modes", async () => {
  const db = await fixture();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload)
       values ($1,'product_research','{"research_input":"research me"}')`,
      [RESEARCH_JOB_ID],
    );
    await assumeServiceRole(db);
    const claimed = await scalar(
      db,
      "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_research_ai_job($1,$2,$3::jsonb)",
        [RESEARCH_JOB_ID, claimed.claim_token, JSON.stringify({ mode: "cli-research" })],
      ),
      true,
    );
  } finally {
    await db.close();
  }

  const unknownModeDb = await fixture();
  try {
    await unknownModeDb.query(
      `insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload)
       values ($1,'product_research','{"research_input":"research me"}')`,
      [RESEARCH_JOB_ID],
    );
    await assumeServiceRole(unknownModeDb);
    const claimed = await scalar(
      unknownModeDb,
      "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')",
    );
    await assert.rejects(
      unknownModeDb.query(
        "select public.sellerpilot_service_complete_product_research_ai_job($1,$2,$3::jsonb)",
        [RESEARCH_JOB_ID, claimed.claim_token, JSON.stringify({ mode: "unknown-research" })],
      ),
      /invalid product research result/,
    );
  } finally {
    await unknownModeDb.close();
  }
});

test("transient releases requeue twice and the third attempt becomes terminal", async () => {
  const db = await fixture();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload)
       values ($1,'product_research','{"research_input":"research me"}')`,
      [RESEARCH_JOB_ID],
    );
    await assumeServiceRole(db);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = await scalar(
        db,
        "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')",
      );
      const released = await scalar(
        db,
        "select public.sellerpilot_service_release_product_research_ai_job($1,$2,'gateway_request_failed',false,30)",
        [RESEARCH_JOB_ID, claimed.claim_token],
      );
      assert.equal(released, attempt < 3 ? "queued" : "failed");
      assert.equal(
        await scalar(
          db,
          "select public.sellerpilot_service_release_product_research_ai_job($1,$2,'gateway_request_failed',false,30)",
          [RESEARCH_JOB_ID, claimed.claim_token],
        ),
        released,
      );
      assert.equal(
        await scalar(
          db,
          "select public.sellerpilot_service_release_product_research_ai_job($1,$2,'gateway_request_failed',true,30)",
          [RESEARCH_JOB_ID, claimed.claim_token],
        ),
        "ownership_lost",
      );
      if (attempt < 3) {
        await db.exec("reset role");
        await db.query(
          "update sellerpilot_private.ai_cli_jobs set available_at=clock_timestamp() where id=$1",
          [RESEARCH_JOB_ID],
        );
        await assumeServiceRole(db);
      }
    }
    await db.exec("reset role");
    assert.deepEqual((await db.query(
      "select status,attempt_count,claim_token,worker_token_id from sellerpilot_private.ai_cli_jobs where id=$1",
      [RESEARCH_JOB_ID],
    )).rows, [{ status: "failed", attempt_count: 3, claim_token: null, worker_token_id: null }]);
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.server_product_research_completion_receipts where job_id=$1",
        [RESEARCH_JOB_ID],
      ),
      3,
    );
  } finally {
    await db.close();
  }
});

test("a stale server completion cannot overwrite a later claim", async () => {
  const db = await fixture();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload)
       values ($1,'product_research','{"research_input":"first"}')`,
      [RESEARCH_JOB_ID],
    );
    await assumeServiceRole(db);
    const first = await scalar(db, "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')");
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0') is null"),
      true,
      "an active lease must not be reclaimed",
    );
    await db.exec("reset role");
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set lease_expires_at=clock_timestamp()-interval '1 second'
        where id=$1`,
      [RESEARCH_JOB_ID],
    );
    await assumeServiceRole(db);
    const next = await scalar(db, "select public.sellerpilot_service_claim_product_research_ai_job('test/1.0')");
    assert.equal(next.id, RESEARCH_JOB_ID);
    assert.notEqual(next.claim_token, first.claim_token);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_research_ai_job($1,$2,$3::jsonb)",
        [RESEARCH_JOB_ID, first.claim_token, JSON.stringify({ mode: "server-research" })],
      ),
      false,
    );
  } finally {
    await db.close();
  }
});

test("public and authenticated roles cannot invoke server research RPCs", async () => {
  const db = await fixture();
  try {
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon','public.sellerpilot_service_claim_product_research_ai_job(text)','EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated','public.sellerpilot_service_complete_product_research_ai_job(uuid,uuid,jsonb)','EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role','public.sellerpilot_service_claim_product_research_ai_job(text)','EXECUTE')",
      ),
      true,
    );
  } finally {
    await db.close();
  }
});
