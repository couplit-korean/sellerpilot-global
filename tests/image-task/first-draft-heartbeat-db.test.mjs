import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("active image worker polls renew only the same live claim and preserve permissions", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role service_role;
      create schema sellerpilot_private;
      create table sellerpilot_private.ai_cli_worker_tokens (
        id uuid primary key, token_hash text, scope text, status text, expires_at timestamptz
      );
      create table sellerpilot_private.first_draft_image_requests (
        job_id uuid primary key, status text, worker_token_id uuid,
        verified_assets jsonb default '{}', updated_at timestamptz
      );
      create table sellerpilot_private.ai_cli_jobs (
        id uuid primary key, kind text, status text, result_payload jsonb, request_payload jsonb
      );
      insert into sellerpilot_private.ai_cli_worker_tokens values
        ('11111111-1111-4111-8111-111111111111', repeat('a',64), 'ai', 'active', now()+interval '1 day'),
        ('22222222-2222-4222-8222-222222222222', repeat('b',64), 'ai', 'active', now()+interval '1 day');
    `);
    const base = await readFile(new URL("../../supabase/migrations/20260912120000_first_draft_image_requests.sql", import.meta.url), "utf8");
    const start = base.indexOf("create or replace function public.sellerpilot_service_get_first_draft_image_request(");
    await db.exec(base.slice(start, base.indexOf("\n$$;", start) + 4));
    await db.exec(`revoke all on function public.sellerpilot_service_get_first_draft_image_request(text,uuid) from public;
      grant execute on function public.sellerpilot_service_get_first_draft_image_request(text,uuid) to service_role;`);
    const acl = async () => (await db.query("select proacl::text acl, prosecdef, proconfig from pg_proc where oid='public.sellerpilot_service_get_first_draft_image_request(text,uuid)'::regprocedure")).rows[0];
    const beforeAcl = await acl();
    const migration = await readFile(new URL("../../supabase/migrations/20260914043300_first_draft_active_worker_heartbeat.sql", import.meta.url), "utf8");
    await db.exec(migration);
    assert.deepEqual(await acl(), beforeAcl);
    await db.exec("begin");
    const jobId = "33333333-3333-4333-8333-333333333333";
    await db.query(`insert into sellerpilot_private.ai_cli_jobs values ($1,'product_research','succeeded',
      '{"asset_storage_paths":{},"preflightAssetLineage":{}}','{"kept":true}');`, [jobId]);
    await db.query(`insert into sellerpilot_private.first_draft_image_requests values
      ($1,'generating','11111111-1111-4111-8111-111111111111','{"portrait":{"kept":true}}',clock_timestamp()-interval '20 minutes');`, [jobId]);
    const timestamp = async () => (await db.query("select updated_at::text value from sellerpilot_private.first_draft_image_requests where job_id=$1", [jobId])).rows[0].value;
    const state = async (token="a") => (await db.query("select public.sellerpilot_service_get_first_draft_image_request($1,$2) state", [token.repeat(64), jobId])).rows[0].state;
    const expiredTimestamp = await timestamp();
    const result = await state();
    assert.deepEqual(result, { status: "generating", verifiedAssets: { portrait: { kept: true } }, request: { kept: true }, result: { asset_storage_paths: {}, preflightAssetLineage: {} } });
    assert.notEqual(await timestamp(), expiredTimestamp);
    const renewedTimestamp = await timestamp();
    await state();
    assert.equal(await timestamp(), renewedTimestamp, "polls inside one minute do not rewrite the row");
    assert.equal(await state("b"), null);
    assert.equal(await timestamp(), renewedTimestamp);
    for (const status of ["queued", "cancelled", "done"]) {
      await db.query("update sellerpilot_private.first_draft_image_requests set status=$1,updated_at=clock_timestamp()-interval '20 minutes' where job_id=$2", [status,jobId]);
      const before = await timestamp();
      assert.equal(await state(), null, status);
      assert.equal(await timestamp(), before, status);
    }
    await db.query("update sellerpilot_private.first_draft_image_requests set status='generating',updated_at=clock_timestamp()-interval '31 minutes' where job_id=$1", [jobId]);
    const expired = await timestamp();
    assert.equal(await state(), null, "an expired lease cannot be revived by polling");
    assert.equal(await timestamp(), expired);
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::integer n from sellerpilot_private.first_draft_image_requests")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
