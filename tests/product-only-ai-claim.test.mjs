import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828130000_isolate_product_ai_worker_claim.sql",
  import.meta.url,
);
const TOKEN_HASH = "a".repeat(64);
const TOKEN_ID = "10000000-0000-4000-8000-000000000001";
const GATEWAY_TOKEN_HASH = "b".repeat(64);
const GATEWAY_TOKEN_ID = "10000000-0000-4000-8000-000000000002";
const SUPPORT_JOB_ID = "20000000-0000-4000-8000-000000000001";
const RESEARCH_JOB_ID = "20000000-0000-4000-8000-000000000002";
const STUDIO_JOB_ID = "20000000-0000-4000-8000-000000000003";
const REGENERATION_JOB_ID = "20000000-0000-4000-8000-000000000004";
const EXPIRED_SUPPORT_JOB_ID = "20000000-0000-4000-8000-000000000005";
const EXPIRED_PRODUCT_JOB_ID = "20000000-0000-4000-8000-000000000006";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function createFixture() {
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
      preparation_failure_count integer not null default 0,
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
    create function public.sellerpilot_claim_ai_job(text, text default null)
    returns jsonb
    language sql
    as $$ select '{"legacy":true}'::jsonb $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.query(
    `insert into sellerpilot_private.ai_cli_worker_tokens(
       id,token_hash,scope,status,expires_at
     ) values
       ($1,$2,'ai','active',now()+interval '1 day'),
       ($3,$4,'gateway','active',now()+interval '1 day')`,
    [TOKEN_ID, TOKEN_HASH, GATEWAY_TOKEN_ID, GATEWAY_TOKEN_HASH],
  );
  return db;
}

test("product-only claim is a separate rolling-compatible route contract", async () => {
  const [migration, route, worker] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create function public\.sellerpilot_claim_product_ai_job\(/);
  assert.doesNotMatch(migration, /create or replace function public\.sellerpilot_claim_ai_job\(/);
  assert.match(migration, /job\.kind in \(\s*'product_studio',\s*'product_research',\s*'product_asset_regeneration'\s*\)/);
  assert.doesNotMatch(migration, /job\.kind in \([^)]*support_reply/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /claim_scope', 'product'/);
  assert.match(migration, /revoke all on function public\.sellerpilot_claim_product_ai_job\(text, text\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.sellerpilot_claim_product_ai_job\(text, text\)[\s\S]*to service_role/);

  assert.match(route, /body\.scope !== undefined && body\.scope !== "product"/);
  assert.match(route, /const productOnlyClaim = body\.scope === "product"/);
  assert.match(route, /productOnlyClaim\s*\? await serviceClient\.rpc\("sellerpilot_claim_product_ai_job", claimArguments\)\s*:\s*await serviceClient\.rpc\("sellerpilot_claim_local_ai_job", claimArguments\)/);

  assert.match(worker, /const productOnly = process\.argv\.includes\("--product-only"\)/);
  assert.match(worker, /const aiOnly = process\.argv\.includes\("--ai-only"\) \|\| productOnly/);
  assert.match(worker, /productOnly \? \{ scope: "product" \} : \{\}/);
  assert.match(worker, /const gatewayWorkerToken = aiOnly \? ""/);
  assert.match(worker, /const schedulerWorkerToken = aiOnly \? ""/);
  assert.match(worker, /productOnly \? "product-only" : aiOnly \? "ai-only" : "all-scopes"/);
  assert.match(worker, /if \(productOnly && job\.claim_scope !== "product"\)/);
  assert.ok(
    worker.indexOf('if (productOnly && job.claim_scope !== "product")')
      < worker.indexOf("await processJob(job)", worker.indexOf("const job = await response.json()")),
    "product-only workers must fail closed before dispatching an unscoped claim",
  );
});

test("product-only claimant never claims or recovers support replies", async () => {
  const db = await createFixture();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(
         id,kind,available_at,created_at
       ) values
         ($1,'support_reply',now()-interval '2 hours',now()-interval '2 hours'),
         ($2,'product_research',now()-interval '90 minutes',now()-interval '90 minutes'),
         ($3,'product_studio',now()-interval '80 minutes',now()-interval '80 minutes'),
         ($4,'product_asset_regeneration',now()-interval '70 minutes',now()-interval '70 minutes')`,
      [SUPPORT_JOB_ID, RESEARCH_JOB_ID, STUDIO_JOB_ID, REGENERATION_JOB_ID],
    );

    assert.deepEqual(await scalar(db, "select public.sellerpilot_claim_ai_job($1,'legacy-worker')", [TOKEN_HASH]), { legacy: true });

    await db.exec("set role service_role");
    const claims = [];
    for (let index = 0; index < 3; index += 1) {
      claims.push(await scalar(
        db,
        "select public.sellerpilot_claim_product_ai_job($1,'product-worker/1.54')",
        [TOKEN_HASH],
      ));
    }
    assert.deepEqual(claims.map((claim) => claim.kind), [
      "product_research",
      "product_studio",
      "product_asset_regeneration",
    ]);
    assert.equal(claims.every((claim) => claim.claim_scope === "product"), true);
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_product_ai_job($1,'product-worker/1.54') is null", [TOKEN_HASH]),
      true,
    );
    await db.exec("reset role");

    assert.deepEqual((await db.query(
      "select status,attempt_count,worker_token_id from sellerpilot_private.ai_cli_jobs where id=$1",
      [SUPPORT_JOB_ID],
    )).rows, [{ status: "queued", attempt_count: 0, worker_token_id: null }]);

    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(
         id,kind,status,worker_token_id,claim_token,attempt_count,
         lease_expires_at,available_at,created_at
       ) values
         ($1,'support_reply','running',$3,gen_random_uuid(),1,now()-interval '1 minute',now()-interval '3 hours',now()-interval '3 hours'),
         ($2,'product_studio','running',$3,gen_random_uuid(),1,now()-interval '1 minute',now()-interval '1 hour',now()-interval '1 hour')`,
      [EXPIRED_SUPPORT_JOB_ID, EXPIRED_PRODUCT_JOB_ID, TOKEN_ID],
    );
    await db.exec("set role service_role");
    const recoveredProduct = await scalar(
      db,
      "select public.sellerpilot_claim_product_ai_job($1,'product-worker/1.54')",
      [TOKEN_HASH],
    );
    await db.exec("reset role");
    assert.equal(recoveredProduct.id, EXPIRED_PRODUCT_JOB_ID);
    assert.deepEqual((await db.query(
      "select status,attempt_count,worker_token_id::text from sellerpilot_private.ai_cli_jobs where id=$1",
      [EXPIRED_SUPPORT_JOB_ID],
    )).rows, [{ status: "running", attempt_count: 1, worker_token_id: TOKEN_ID }]);

    await db.exec("set role service_role");
    await assert.rejects(
      db.query("select public.sellerpilot_claim_product_ai_job($1,'wrong-scope')", [GATEWAY_TOKEN_HASH]),
      /invalid worker token/,
    );
    await db.exec("reset role");
  } finally {
    await db.exec("reset role").catch(() => {});
    await db.close();
  }
});

test("product-only RPC execute privilege is service-role only", async () => {
  const db = await createFixture();
  try {
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.sellerpilot_claim_product_ai_job($1,'forbidden')", [TOKEN_HASH]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role").catch(() => {});
    await db.close();
  }
});
