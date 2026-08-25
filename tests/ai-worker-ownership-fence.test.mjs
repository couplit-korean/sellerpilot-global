import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260825103015_compensate_unprepared_ai_worker_claims.sql",
  import.meta.url,
);
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_A_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN_B_ID = "10000000-0000-4000-8000-000000000002";
const JOB_ID = "20000000-0000-4000-8000-000000000001";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

test("AI heartbeat cannot revive an expired lease or follow a reclaimed job", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;
      create schema sellerpilot_private;
      create table sellerpilot_private.ai_cli_worker_tokens (
        id uuid primary key,
        token_hash text not null unique,
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
        attempt_count integer not null default 0,
        lease_expires_at timestamptz,
        error_message text,
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
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.query(
      "insert into sellerpilot_private.ai_cli_worker_tokens(id,token_hash,status,expires_at) values ($1,$2,'active',now()+interval '1 day'),($3,$4,'active',now()+interval '1 day')",
      [TOKEN_A_ID, TOKEN_A, TOKEN_B_ID, TOKEN_B],
    );
    await db.query(
      "insert into sellerpilot_private.ai_cli_jobs(id,kind) values ($1,'product_studio')",
      [JOB_ID],
    );

    const firstClaim = await scalar(db, "select public.sellerpilot_claim_ai_job($1,'worker-a')", [TOKEN_A]);
    assert.equal(firstClaim.id, JOB_ID);
    assert.equal(
      await scalar(db, "select public.sellerpilot_touch_ai_job($1,$2,$3,'worker-a')", [TOKEN_A, JOB_ID, firstClaim.claim_token]),
      "running",
    );

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
      [JOB_ID],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_touch_ai_job($1,$2,$3,'stale-a')", [TOKEN_A, JOB_ID, firstClaim.claim_token]),
      "ownership_lost",
    );
    assert.equal(
      await scalar(db, "select lease_expires_at < now() from sellerpilot_private.ai_cli_jobs where id=$1", [JOB_ID]),
      true,
    );

    const secondClaim = await scalar(db, "select public.sellerpilot_claim_ai_job($1,'worker-b')", [TOKEN_B]);
    assert.equal(secondClaim.id, JOB_ID);
    assert.notEqual(secondClaim.claim_token, firstClaim.claim_token);
    assert.equal(
      await scalar(db, "select worker_token_id::text from sellerpilot_private.ai_cli_jobs where id=$1", [JOB_ID]),
      TOKEN_B_ID,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_touch_ai_job($1,$2,$3,'stale-a')", [TOKEN_A, JOB_ID, firstClaim.claim_token]),
      "ownership_lost",
    );
    assert.equal(
      await scalar(db, "select worker_token_id::text from sellerpilot_private.ai_cli_jobs where id=$1", [JOB_ID]),
      TOKEN_B_ID,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_touch_ai_job($1,$2,$3,'worker-b')", [TOKEN_B, JOB_ID, secondClaim.claim_token]),
      "running",
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_touch_ai_job($1,'30000000-0000-4000-8000-000000000001',$2,'worker-a')", [TOKEN_A, firstClaim.claim_token]),
      null,
    );
  } finally {
    await db.close();
  }
});

test("AI heartbeat route and worker treat ownership loss as terminal before storage writes", async () => {
  const [migration, route, worker] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL("../app/api/ai/worker/heartbeat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /j\.worker_token_id = v_token_id[\s\S]*j\.claim_token = p_claim_token[\s\S]*j\.lease_expires_at > now\(\)/);
  assert.match(migration, /return 'ownership_lost'/);
  assert.match(route, /data !== "running"[\s\S]*status: 409/);
  assert.match(worker, /terminalStatuses: \[401, 404, 409\]/);
  assert.match(worker, /function createAiJobHeartbeat/);
  assert.match(worker, /createLeaseBoundedStorageFetch\(jobHeartbeat\.signal\)/);
  assert.ok((worker.match(/await assertJobLeaseHealthy\(\)/g) ?? []).length >= 7);
  assert.match(worker, /await stopJobHeartbeat\(\);[\s\S]*persistWorkerCompletion/);
});
