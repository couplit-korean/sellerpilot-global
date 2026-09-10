import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Execute the production migration's continuation block, not a rewritten model.
// This isolates queue persistence; it does not certify the surrounding claim,
// authorization, receipt, or later wrapper migrations.
const sql = await readFile(new URL("../supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql", import.meta.url), "utf8");
const start = sql.indexOf("  v_continuation := p_response_payload->'continuation';");
const end = sql.indexOf("  v_completed := public.sellerpilot_complete_channel_gateway_job(", start);
assert.ok(start > 0 && end > start);
const block = sql.slice(start, end);
const credential = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const job = "00000000-0000-4000-8000-000000000003";

test("Shopee continuation SQL preserves scope and remainder, deduplicates replay, and rejects failed pages", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials(id uuid primary key, environment text, created_by uuid);
      insert into sellerpilot_private.channel_credentials values('${credential}','production','${owner}');
      create table sellerpilot_private.channel_gateway_jobs(id uuid primary key, credential_id uuid, attempt_id uuid,
        channel text, operation text, environment text, request_payload jsonb, created_by uuid);
      create unique index continuation_once on sellerpilot_private.channel_gateway_jobs((request_payload->>'periodicKey'));
      create function public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text) returns void language sql as 'select';
      create function public.fixture(p_response_payload jsonb,p_status text,p_job_id uuid) returns uuid language plpgsql as $$
      declare
        v_job record;
        v_result_ok boolean := true;
        v_effective_credential_id uuid := '${credential}';
        v_continuation jsonb; v_continuation_arguments jsonb;
        v_continuation_depth integer; v_continuation_job_id uuid;
      begin
        select 'shopee'::text as channel,'inquiries.list'::text as operation into v_job;
        ${block}
        return v_continuation_job_id;
      end $$;
    `);
    const args = { kind: "return_refund", createTimeFrom: 1700000000, createTimeTo: 1700000100,
      pageNo: 2, pageSize: 100, returnQueue: ["RETURN11"], nextPageNo: 2, sellerpilotPaginationDepth: 1 };
    const payload = { continuation: { reason: "page_cap_reached", arguments: args } };
    const call = (value, status = "succeeded") => db.query("select public.fixture($1::jsonb,$2,$3::uuid) as id", [JSON.stringify(value), status, job]);
    const first = (await call(payload)).rows[0].id;
    assert.equal((await call(payload)).rows[0].id, first);
    const rows = (await db.query("select * from sellerpilot_private.channel_gateway_jobs")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].credential_id, credential);
    assert.equal(rows[0].created_by, owner);
    assert.equal(rows[0].channel, "shopee");
    assert.equal(rows[0].operation, "inquiries.list");
    assert.deepEqual(rows[0].request_payload.arguments, args);
    await assert.rejects(call(payload, "failed"), /invalid gateway pagination continuation/);
    await assert.rejects(call({ continuation: { ...payload.continuation, arguments: { ...args, sellerpilotPaginationDepth: 51 } } }), /depth/);
    assert.equal((await db.query("select count(*)::int as n from sellerpilot_private.channel_gateway_jobs")).rows[0].n, 1);
  } finally { await db.close(); }
});
