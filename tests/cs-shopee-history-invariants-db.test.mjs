import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql004 = await readFile(new URL("../supabase/migrations/20260908142023_cs_shopee_history_ledger.sql", import.meta.url), "utf8");
const sql007 = await readFile(new URL("../supabase/migrations/20260908142028_cs_shopee_history_start.sql", import.meta.url), "utf8");
const sql010 = await readFile(new URL("../supabase/migrations/20260908145331_cs_shopee_history_request_invariants.sql", import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000010001";
const credential = "00000000-0000-4000-8000-000000010002";
const oldCredential = "00000000-0000-4000-8000-000000010003";
const worker = "00000000-0000-4000-8000-000000010004";
const planJob = "00000000-0000-4000-8000-000000010005";
const planClaim = "00000000-0000-4000-8000-000000010006";
const tokenHash = "synthetic-invariant-worker-token";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const shops = [{ shopId: "1719148844", country: "SG" }, { shopId: "1758392145", country: "TW" }];

async function fixture({ secondTargetCredential = credential, conflictingCountry = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions; create schema vault;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,
      environment text not null,version integer not null,status text not null,vault_secret_id uuid
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,status text not null,expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,environment text not null,request_payload jsonb not null,
      status text not null,created_by uuid not null references auth.users(id),claim_token uuid,
      worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),lease_expires_at timestamptz
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),claim_token uuid not null,
      worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id)
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid not null references auth.users(id),channel_key text not null,
      external_ticket_id text not null,demo boolean not null default false,ticket_kind text not null,
      reply_context jsonb not null default '{}'::jsonb,provider_context jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id),channel_key text not null,inbound_key text not null,
      remote_message_id text,provider_context jsonb not null default '{}'::jsonb
    );
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create table sellerpilot_private.channel_market_targets(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),channel text not null,
      environment text not null,target_id text not null,market_code text not null,
      verified_at timestamptz not null default now(),
      unique(owner_id,channel,environment,market_code,target_id)
    );
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select false$$;
    create function public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)
    returns uuid language plpgsql security definer set search_path='' as $$
    declare next_id uuid:=gen_random_uuid();
    begin
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,channel,operation,environment,request_payload,status,created_by
      ) select next_id,$1,$3,$4,current.environment,$5,'queued',current.created_by
          from sellerpilot_private.channel_credentials current where current.id=$1;
      return next_id;
    end $$;
    insert into auth.users values('${owner}');
    insert into sellerpilot_private.admin_users values('${owner}');
    insert into sellerpilot_private.ai_cli_worker_tokens values('${worker}','${tokenHash}','active',now()+interval '1 day');
    insert into sellerpilot_private.channel_credentials values
      ('${credential}','${owner}','shopee','production',7,'active','${uuid(10101)}'),
      ('${oldCredential}','${owner}','shopee','production',6,'grace','${uuid(10102)}');
    insert into vault.decrypted_secrets values
      ('${uuid(10101)}','{"shopee_targets":[{"type":"shop","id":"1719148844"},{"type":"shop","id":"1758392145"}]}'),
      ('${uuid(10102)}','{"shopee_targets":[{"type":"shop","id":"1758392145"}]}');
    insert into sellerpilot_private.channel_market_targets(owner_id,credential_id,channel,environment,target_id,market_code)
      values('${owner}','${credential}','shopee','production','1719148844','SG');
    insert into sellerpilot_private.channel_market_targets(owner_id,credential_id,channel,environment,target_id,market_code)
      values('${owner}','${secondTargetCredential}','shopee','production','1758392145','TW');
    ${conflictingCountry ? `insert into sellerpilot_private.channel_market_targets(owner_id,credential_id,channel,environment,target_id,market_code)
      values('${owner}','${credential}','shopee','production','1719148844','MY');` : ""}
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${planJob}','${credential}','shopee','inquiries.list','production','{}','running','${owner}',
      '${planClaim}','${worker}',now()+interval '1 hour'
    );
  `);
  await db.exec(sql004); await db.exec(sql007); await db.exec(sql010);
  return db;
}

const range = () => {
  const to = Math.floor(Date.now() / 1_000) - 60;
  return { from: to - 16 * 86_400, to };
};

async function start(db, requestKey, from, to) {
  return (await db.query(`select public.sellerpilot_service_start_cs_shopee_history_v1(
    $1,$2,$3,$4
  ) result`, [owner, requestKey, from, to])).rows[0].result;
}

test("NULL history boundaries fail before any review-only job can be inserted", async () => {
  const db = await fixture(); const requestKey = uuid(10201); const { from, to } = range();
  try {
    await assert.rejects(start(db, requestKey, null, to), /SHOPEE_HISTORY_START_INVALID/);
    await assert.rejects(start(db, requestKey, from, null), /SHOPEE_HISTORY_START_INVALID/);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_start_requests")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_scopes")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status='queued'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("one request UUID is immutable across range and target plan while exact replay queues zero", async () => {
  const db = await fixture(); const requestKey = uuid(10202); const { from, to } = range();
  try {
    const first = await start(db, requestKey, from, to);
    assert.equal(first.queuedJobCount, 6);
    const replay = await start(db, requestKey, from, to);
    assert.equal(replay.status, "reused"); assert.equal(replay.queuedJobCount, 0); assert.equal(replay.reusedScopeCount, 6);
    await assert.rejects(start(db, requestKey, from + 1, to), /SHOPEE_HISTORY_REQUEST_REUSE_MISMATCH/);
    await db.query(`update sellerpilot_private.channel_market_targets set market_code='PH'
      where credential_id=$1 and target_id='1758392145'`, [credential]);
    await assert.rejects(start(db, requestKey, from, to), /SHOPEE_HISTORY_REQUEST_REUSE_MISMATCH/);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status='queued'")).rows[0].n, 6);
  } finally { await db.close(); }
});

test("old-credential target metadata and one-shop multi-country ambiguity cannot become verified scope", async () => {
  const { from, to } = range();
  const old = await fixture({ secondTargetCredential: oldCredential });
  try {
    await assert.rejects(start(old, uuid(10203), from, to), /SHOPEE_HISTORY_TARGET_COUNTRY_AMBIGUOUS/);
  } finally { await old.close(); }
  const conflict = await fixture({ conflictingCountry: true });
  try {
    await assert.rejects(start(conflict, uuid(10204), from, to), /SHOPEE_HISTORY_TARGET_COUNTRY_AMBIGUOUS/);
    await assert.rejects(conflict.query(`insert into sellerpilot_private.channel_market_targets(
      owner_id,credential_id,channel,environment,target_id,market_code,verified_at
    ) values($1,$2,'shopee','production','999','US',null)`, [owner, credential]), /null value/iu);
  } finally { await conflict.close(); }
});

test("plan RPC accepts only the exact credential market and Vault country binding", async () => {
  const db = await fixture();
  const scope = (country) => ({
    scopeKey: "shopee:1719148844:product_review:cursor-corpus", kind: "product_review",
    shopId: "1719148844", country, coverage: "provider_cursor_corpus",
    arguments: { kind: "product_review", cursor: "", pageSize: 100, shopId: "1719148844" },
  });
  try {
    await assert.rejects(db.query(`select public.sellerpilot_service_plan_cs_shopee_history_v1(
      $1,$2,$3,'wrong-country-run',$4::jsonb
    )`, [tokenHash, planJob, planClaim, JSON.stringify([scope("MY")])]), /SHOPEE_HISTORY_SCOPE_TARGET_MISMATCH/);
    const accepted = (await db.query(`select public.sellerpilot_service_plan_cs_shopee_history_v1(
      $1,$2,$3,'exact-country-run',$4::jsonb
    ) result`, [tokenHash, planJob, planClaim, JSON.stringify([scope("SG")])])).rows[0].result;
    assert.equal(accepted.insertedCount, 1);
  } finally { await db.close(); }
});

test("event insert binds run ID, sequence and input checkpoint to the completed job", async () => {
  const db = await fixture(); const { from, to } = range();
  try {
    const requestA = uuid(10205); const requestB = uuid(10206);
    const runA = (await start(db, requestA, from, to)).historyRunId;
    const runB = (await start(db, requestB, from, to)).historyRunId;
    const scopeKey = "shopee:1719148844:product_review:cursor-corpus";
    const event = (jobId) => ({ type: "page", eventKey: jobId, sequence: 1, scopeKey,
      shopId: "1719148844", kind: "product_review", inputCheckpointDigest: null,
      pageDigest: "a".repeat(64), remoteRecordDigests: [], normalizedRecordDigests: [],
      isolatedRecordDigests: [], excludedRecordDigests: [], projectedEventDigests: [], nextCheckpoint: null });
    const insertCompleted = async (number, runId, sequence = 1, checkpoint = null) => {
      const jobId = uuid(number); const claim = uuid(number + 100);
      await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,channel,operation,environment,request_payload,status,created_by
      ) values($1,$2,'shopee','inquiries.list','production',$3,'succeeded',$4)`, [jobId, credential, {
        arguments: { sellerpilotShopeeHistoryRunId: runId, sellerpilotShopeeScopeKey: scopeKey,
          sellerpilotShopeeHistorySequence: sequence, sellerpilotShopeeInputCheckpointDigest: checkpoint,
          shopId: "1719148844", kind: "product_review" },
      }, owner]);
      await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)", [jobId, claim, worker]);
      return { jobId, claim };
    };
    const wrongRun = await insertCompleted(10301, runA);
    await assert.rejects(db.query(`select public.sellerpilot_service_record_cs_shopee_history_event_v1(
      $1,$2,$3,$4,$5::jsonb
    )`, [tokenHash, wrongRun.jobId, wrongRun.claim, runB, JSON.stringify(event(wrongRun.jobId))]),
    /SHOPEE_HISTORY_EVENT_JOB_METADATA_MISMATCH/);
    const wrongSequence = await insertCompleted(10302, runA, 2);
    await assert.rejects(db.query(`select public.sellerpilot_service_record_cs_shopee_history_event_v1(
      $1,$2,$3,$4,$5::jsonb
    )`, [tokenHash, wrongSequence.jobId, wrongSequence.claim, runA, JSON.stringify(event(wrongSequence.jobId))]),
    /SHOPEE_HISTORY_EVENT_JOB_METADATA_MISMATCH/);
    const wrongCheckpoint = await insertCompleted(10303, runA, 1, "d".repeat(64));
    await assert.rejects(db.query(`select public.sellerpilot_service_record_cs_shopee_history_event_v1(
      $1,$2,$3,$4,$5::jsonb
    )`, [tokenHash, wrongCheckpoint.jobId, wrongCheckpoint.claim, runA, JSON.stringify(event(wrongCheckpoint.jobId))]),
    /SHOPEE_HISTORY_EVENT_JOB_METADATA_MISMATCH/);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events")).rows[0].n, 0);
  } finally { await db.close(); }
});
