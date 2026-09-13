import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/20260914063000_product_studio_local_handoff.sql", import.meta.url);
const owner = "10000000-0000-4000-8000-000000000001";
const otherOwner = "10000000-0000-4000-8000-000000000002";
const tokenId = "20000000-0000-4000-8000-000000000001";
const otherTokenId = "20000000-0000-4000-8000-000000000002";
const jobId = "30000000-0000-4000-8000-000000000001";
const anotherJobId = "30000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const server = "sellerpilot-vercel-product-studio/1.5";
const mac = "sellerpilot-cli-worker/1.62";
const request = {
  reuse_first_draft_assets: true,
  source_research_job_id: "40000000-0000-4000-8000-000000000001",
  image_paths: ["owner/source/original.source"],
  preflight_asset_storage_paths: { portrait: "results/research/claims/existing/portrait.png" },
  preflight_asset_digests: { portrait: "c".repeat(64) },
  manual_fields: { title: "나랑드 500ml 1병" },
};

async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0] ?? {})[0];
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key, token_hash text unique, scope text, status text,
      expires_at timestamptz, last_seen_at timestamptz, last_version text, created_by uuid
    );
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key, kind text, status text default 'queued', request_payload jsonb,
      result_payload jsonb, worker_token_id uuid, claim_token uuid,
      attempt_count integer default 0, available_at timestamptz default now(),
      lease_expires_at timestamptz, error_message text, terminal_image_failure_context jsonb,
      started_at timestamptz, completed_at timestamptz, created_at timestamptz default now(),
      updated_at timestamptz default now(), created_by uuid
    );
    create unique index ai_cli_jobs_single_server_studio_running_uidx
      on sellerpilot_private.ai_cli_jobs ((1)) where status='running'
        and kind in ('product_studio','product_asset_regeneration');
    create table sellerpilot_private.ai_cli_audit (
      id bigint generated always as identity, action text, worker_token_id uuid, job_id uuid, safe_detail jsonb
    );
    create table sellerpilot_private.product_ai_revisions (
      job_id uuid, status text, actor_user_id uuid, product_id uuid, base_ai_job_id uuid,
      base_product_updated_at timestamptz
    );
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20260830122000_attest_product_revision_fallback.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(migration, "utf8"));
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens
    (id,token_hash,scope,status,expires_at,created_by) values
    ($1,$2,'ai','active',now()+interval '1 day',$3),
    ($4,$5,'ai','active',now()+interval '1 day',$3)`, [tokenId, hash, otherOwner, otherTokenId, otherHash]);
  await db.query(`insert into sellerpilot_private.ai_cli_jobs
    (id,kind,request_payload,created_by,terminal_image_failure_context)
    values ($1,'product_studio',$2,$3,'{"retained":true}')`, [jobId, request, owner]);
  return db;
}
const claim = (db, version = server, tokenHash = hash) => scalar(db,
  "select public.sellerpilot_claim_product_ai_job($1,$2)", [tokenHash, version]);
const handoff = (db, claimed, overrides = {}) => scalar(db,
  "select public.sellerpilot_handoff_product_studio_to_local($1,$2,$3,$4,$5)",
  [overrides.tokenHash ?? hash, overrides.jobId ?? jobId, overrides.claimToken ?? claimed.claim_token,
    overrides.ownerId ?? owner, overrides.reason ?? "gateway_forbidden"]);
const row = (db) => scalar(db, "select to_jsonb(j) from sellerpilot_private.ai_cli_jobs j where id=$1", [jobId]);

test("exact shared-worker handoff preserves the job and all source evidence, and only Mac reclaims local work", async () => {
  const db = await fixture();
  try {
    const claimed = await claim(db);
    assert.equal(claimed.owner_id, owner);
    assert.equal(claimed.revision_fallback_authorized, false);
    const before = await row(db);
    // A Mac poll may update this shared token diagnostic while Vercel owns the job.
    assert.equal(await claim(db, mac), null);
    assert.equal(await handoff(db, claimed), true);
    const queued = await row(db);
    assert.equal(queued.id, before.id);
    assert.deepEqual(queued.request_payload, { ...request, studio_runtime: "local" });
    assert.deepEqual(queued.terminal_image_failure_context, before.terminal_image_failure_context);
    assert.equal(queued.result_payload, null);
    assert.equal(queued.status, "queued");
    assert.equal(queued.attempt_count, before.attempt_count);
    assert.equal(queued.claim_token, null);
    assert.equal(queued.worker_token_id, null);
    assert.equal(queued.lease_expires_at, null);
    assert.equal(await claim(db, server), null);
    const resumed = await claim(db, mac);
    assert.equal(resumed.id, claimed.id);
    assert.notEqual(resumed.claim_token, claimed.claim_token);
    assert.equal(resumed.attempt_count, claimed.attempt_count + 1);
    assert.deepEqual(resumed.request, queued.request_payload);
    assert.equal(await handoff(db, claimed), false, "the old Vercel claim cannot requeue a Mac claim");
    assert.equal(await handoff(db, resumed), false, "a local job cannot loop through the same handoff");
    assert.equal(await scalar(db, "select count(*)::int from sellerpilot_private.ai_cli_jobs"), 1);
    assert.equal(await scalar(db, "select count(*)::int from sellerpilot_private.ai_cli_audit where action='job_retried'"), 1);
  } finally { await db.close(); }
});

test("wrong owner, worker, job, claim and non-Gateway quality failures make no changes", async () => {
  const db = await fixture();
  try {
    const claimed = await claim(db);
    const before = await row(db);
    for (const overrides of [
      { ownerId: otherOwner }, { tokenHash: otherHash }, { jobId: anotherJobId },
      { claimToken: "50000000-0000-4000-8000-000000000001" },
      { reason: "gateway_result_invalid" }, { reason: "source_photo_mismatch" },
      { reason: "gateway_timeout" }, { reason: "gateway_unauthorized" },
    ]) {
      assert.equal(await handoff(db, claimed, overrides), false);
      assert.deepEqual(await row(db), before);
    }
  } finally { await db.close(); }
});

test("expired leases, cancelled or completed jobs, regeneration jobs and existing results cannot hand off", async () => {
  const db = await fixture();
  try {
    const claimed = await claim(db);
    for (const mutation of [
      "lease_expires_at=now()-interval '1 second'", "status='cancelled'", "status='failed'",
      "status='succeeded'", "kind='product_asset_regeneration'", "result_payload='{\"already\":true}'",
      "request_payload=request_payload-'reuse_first_draft_assets'",
      "request_payload=request_payload || '{\"reuse_first_draft_assets\":false}'",
      "request_payload=request_payload || '{\"revision_mode\":\"replace_product_assets\"}'",
    ]) {
      await db.exec("begin");
      await db.exec(`update sellerpilot_private.ai_cli_jobs set ${mutation}`);
      const before = await row(db);
      assert.equal(await handoff(db, claimed), false, mutation);
      assert.deepEqual(await row(db), before);
      await db.exec("rollback");
    }
    await db.query("insert into sellerpilot_private.product_ai_revisions(job_id,status,actor_user_id) values ($1,'pending',$2)", [jobId,owner]);
    assert.equal(await handoff(db, claimed), false, "a recorded revision cannot masquerade as new Studio work");
  } finally { await db.close(); }
});

test("active AI authentication remains mandatory and RPC is service-role only", async () => {
  const db = await fixture();
  try {
    const claimed = await claim(db);
    await assert.rejects(handoff(db, claimed, { tokenHash: "bad" }), /invalid worker token/);
    for (const mutation of ["status='revoked'", "scope='cs'", "expires_at=now()-interval '1 second'"]) {
      await db.exec("begin");
      await db.exec(`update sellerpilot_private.ai_cli_worker_tokens set ${mutation}`);
      await assert.rejects(handoff(db, claimed), /invalid worker token/);
      await db.exec("rollback");
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(await scalar(db,
        "select has_function_privilege($1,'public.sellerpilot_handoff_product_studio_to_local(text,uuid,uuid,uuid,text)','execute')", [role]), role === "service_role");
    }
  } finally { await db.close(); }
});

test("all supported Gateway account failures hand off and server still claims ordinary work with its one-job fence", async () => {
  const db = await fixture();
  try {
    const claimed = await claim(db);
    for (const reason of ["gateway_forbidden", "gateway_authentication_error", "gateway_billing_required",
      "gateway_customer_verification_required", "gateway_rate_limited"]) {
      await db.exec("begin");
      assert.equal(await handoff(db, claimed, { reason }), true);
      await db.exec("rollback");
    }
    assert.equal(await handoff(db, claimed), true);
    await db.query(`insert into sellerpilot_private.ai_cli_jobs
      (id,kind,request_payload,created_by) values ($1,'product_studio','{}',$2)`, [anotherJobId, owner]);
    assert.equal((await claim(db, server)).id, anotherJobId);
    assert.equal(await claim(db, mac), null, "existing global single-running fence is retained");
  } finally { await db.close(); }
});

test("third server attempt can transfer once to a fourth local attempt without resetting the attempt history", async () => {
  const db = await fixture();
  try {
    await db.exec("update sellerpilot_private.ai_cli_jobs set attempt_count=2");
    const claimed = await claim(db);
    assert.equal(claimed.attempt_count, 3);
    assert.equal(await handoff(db, claimed), true);
    const resumed = await claim(db, mac);
    assert.equal(resumed.attempt_count, 4);
    assert.equal(await handoff(db, resumed), false);
  } finally { await db.close(); }
});

test("the migration refuses to overwrite a claimer whose production baseline has drifted", async () => {
  const db = await fixture();
  try {
    await assert.rejects(db.exec(await readFile(migration, "utf8")), /claimer definition drifted/);
    await db.exec("rollback");
  } finally { await db.close(); }
});
