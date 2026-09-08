import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20260908000000_add_cs_credential_capability_bindings.sql", import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000000901";
const credential = "00000000-0000-4000-8000-000000000902";
const worker = "00000000-0000-4000-8000-000000000903";
const job1 = "00000000-0000-4000-8000-000000000904";
const job2 = "00000000-0000-4000-8000-000000000905";
const claim1 = "00000000-0000-4000-8000-000000000906";
const claim2 = "00000000-0000-4000-8000-000000000907";
const hex = (character) => character.repeat(64);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, channel text, environment text, fingerprint text, status text, expires_at timestamptz,
      seller_account_key_source text, seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key, credential_id uuid, channel text, operation text, status text);
    create table sellerpilot_private.gateway_completion_receipts(job_id uuid primary key, claim_token uuid);
    create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key, token_hash text, scope text, status text, expires_at timestamptz);
    insert into sellerpilot_private.channel_credentials values('${credential}','shopee','production','SAFE1234','active',now()+interval '1 day','provider_certified_v1',now());
    insert into sellerpilot_private.ai_cli_worker_tokens values('${worker}','token-hash','gateway','active',now()+interval '1 day');
    insert into sellerpilot_private.channel_gateway_jobs values('${job1}','${credential}','shopee','inquiries.list','succeeded'),('${job2}','${credential}','shopee','inquiries.list','succeeded');
    insert into sellerpilot_private.gateway_completion_receipts values('${job1}','${claim1}'),('${job2}','${claim2}');
  `);
  await db.exec(migration);
  return db;
}

function evidence(app, token, targets = [hex("c")]) {
  return JSON.stringify({ contract: "sellerpilot-cs-credential-binding/1", channel: "shopee", operation: "inquiries.list", country: "SG", appFingerprint: app, tokenFingerprint: token, targetFingerprints: targets });
}

test("completed CS jobs record targets and token rotation supersedes old bindings", async () => {
  const db = await fixture();
  try {
    const first = (await db.query("select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb) result", ["token-hash", job1, claim1, evidence(hex("a"), hex("b"), [hex("c"), hex("d")])])).rows[0].result;
    assert.equal(first.bindingCount, 2);
    await db.query("select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb)", ["token-hash", job2, claim2, evidence(hex("a"), hex("e"))]);
    const states = (await db.query("select status,count(*)::int count from sellerpilot_private.cs_credential_capability_bindings group by status order by status")).rows;
    assert.deepEqual(states, [{ status: "active", count: 1 }, { status: "superseded", count: 2 }]);
  } finally { await db.close(); }
});

test("credential revoke propagates and only an authenticated administrator can read", async () => {
  const db = await fixture();
  try {
    await db.query("select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb)", ["token-hash", job1, claim1, evidence(hex("a"), hex("b"))]);
    await db.exec("update sellerpilot_private.channel_credentials set status='revoked'");
    assert.equal((await db.query("select status from sellerpilot_private.cs_credential_capability_bindings")).rows[0].status, "revoked");
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query("select has_function_privilege($1,'public.sellerpilot_read_cs_credential_bindings_v1()','EXECUTE') ok", [role])).rows[0].ok, false);
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    const read = (await db.query("select public.sellerpilot_read_cs_credential_bindings_v1() result")).rows[0].result;
    assert.equal(read.bindings[0].bindingStatus, "revoked");
    assert.equal(read.bindings[0].sellerAccountBinding, "provider_certified");
  } finally { await db.close(); }
});
