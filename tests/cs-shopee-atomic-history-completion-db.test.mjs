import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ledgerSql = await readFile(new URL(
  "../supabase/migrations/20260908142023_cs_shopee_history_ledger.sql",
  import.meta.url,
), "utf8");
const atomicSql = await readFile(new URL(
  "../supabase/migrations/20260908142029_cs_shopee_atomic_history_completion.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000009001";
const credential = "00000000-0000-4000-8000-000000009002";
const worker = "00000000-0000-4000-8000-000000009003";
const tokenHash = "synthetic-atomic-worker-token";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (character) => character.repeat(64);

function scope(shopId) {
  return {
    scopeKey: `shopee:${shopId}:product_review:cursor-corpus`,
    kind: "product_review",
    shopId,
    country: shopId === "1719148844" ? "SG" : "TW",
    coverage: "provider_cursor_corpus",
    arguments: { kind: "product_review", cursor: "", pageSize: 100, shopId },
  };
}

function pageEvent(jobId, shopId) {
  return {
    type: "page", eventKey: jobId, sequence: 1,
    scopeKey: `shopee:${shopId}:product_review:cursor-corpus`,
    shopId, kind: "product_review", inputCheckpointDigest: null,
    pageDigest: digest("a"), remoteRecordDigests: [digest("b")],
    normalizedRecordDigests: [digest("b")], isolatedRecordDigests: [],
    excludedRecordDigests: [], projectedEventDigests: [digest("c")],
    nextCheckpoint: null,
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create schema sellerpilot_private;
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
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select false$$;
    insert into auth.users values('${owner}');
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${owner}','shopee','production',1,'active',null
    );
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${worker}','${tokenHash}','active',clock_timestamp()+interval '1 day'
    );
    create function public.sellerpilot_service_complete_serverless_cs_transaction(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
      p_response_payload jsonb default null,p_error_message text default null,
      p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
      p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_worker uuid;
    begin
      update sellerpilot_private.channel_gateway_jobs job set status=p_status
       where job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
         and exists(select 1 from sellerpilot_private.ai_cli_worker_tokens token
           where token.id=job.worker_token_id and token.token_hash=p_token_hash
             and token.status='active' and token.expires_at>clock_timestamp())
       returning job.worker_token_id into v_worker;
      if v_worker is null then return jsonb_build_object('status','ownership_lost'); end if;
      insert into sellerpilot_private.gateway_completion_receipts values(p_job_id,p_claim_token,v_worker);
      return jsonb_build_object('status','completed');
    end $$;
  `);
  await db.exec(ledgerSql);
  await db.exec(atomicSql);
  return db;
}

async function runningJob(db, jobId, claimToken, runId, plannedScope) {
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,created_by,
    claim_token,worker_token_id,lease_expires_at
  ) values($1,$2,'shopee','inquiries.list','production',$3,'running',$4,$5,$6,clock_timestamp()+interval '1 hour')`, [
    jobId, credential, { arguments: {
      ...plannedScope.arguments,
      sellerpilotShopeeHistoryRunId: runId,
      sellerpilotShopeeScopeKey: plannedScope.scopeKey,
      sellerpilotShopeeHistorySequence: 1,
      sellerpilotShopeeInputCheckpointDigest: null,
    } }, owner, claimToken, worker,
  ]);
  await db.query(`select public.sellerpilot_service_plan_cs_shopee_history_v1(
    $1,$2,$3,$4,$5::jsonb
  )`, [tokenHash, jobId, claimToken, runId, JSON.stringify([plannedScope])]);
}

test("atomic wrapper commits gateway receipt and body-free Shopee history event together", async () => {
  const db = await fixture();
  const jobId = uuid(9101); const claimToken = uuid(9201); const runId = "atomic-success-run";
  const plannedScope = scope("1719148844");
  try {
    await runningJob(db, jobId, claimToken, runId, plannedScope);
    const result = (await db.query(`select public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
      $1,$2,$3,'succeeded','{}'::jsonb,null,null,null,'[]'::jsonb,null,$4,$5::jsonb
    ) result`, [tokenHash, jobId, claimToken, runId, JSON.stringify(pageEvent(jobId, plannedScope.shopId))])).rows[0].result;
    assert.equal(result.status, "completed");
    assert.equal(result.shopeeHistoryEventStatus, "recorded");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("invalid history event rolls the ordinary job completion back without a ledger gap", async () => {
  const db = await fixture();
  const jobId = uuid(9102); const claimToken = uuid(9202); const runId = "atomic-rollback-run";
  const plannedScope = scope("1758392145");
  try {
    await runningJob(db, jobId, claimToken, runId, plannedScope);
    const invalidEvent = { ...pageEvent(jobId, plannedScope.shopId), shopId: "1719148844" };
    await assert.rejects(db.query(`select public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
      $1,$2,$3,'succeeded','{}'::jsonb,null,null,null,'[]'::jsonb,null,$4,$5::jsonb
    )`, [tokenHash, jobId, claimToken, runId, JSON.stringify(invalidEvent)]), /SHOPEE_HISTORY_EVENT_SCOPE_MISMATCH/);
    assert.equal((await db.query("select status from sellerpilot_private.channel_gateway_jobs where id=$1", [jobId])).rows[0].status, "running");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("atomic Shopee completion wrapper is service-only", async () => {
  const db = await fixture();
  try {
    const signature = "public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,jsonb)";
    assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed", [signature])).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed", [signature])).rows[0].allowed, true);
  } finally { await db.close(); }
});
