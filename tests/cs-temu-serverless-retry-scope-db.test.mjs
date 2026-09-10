import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const durableMigration = await readFile(new URL(
  "../supabase/migrations/20260908140414_cs_temu_durable_detail_retry.sql",
  import.meta.url,
), "utf8");
const replayMigration = await readFile(new URL(
  "../supabase/migrations/20260908140416_cs_temu_detail_retry_replay.sql",
  import.meta.url,
), "utf8");
const scopeMigration = await readFile(new URL(
  "../supabase/migrations/20260909101645_cs_temu_serverless_retry_scope.sql",
  import.meta.url,
), "utf8");

const ownerId = "00000000-0000-4000-8000-00000000c001";
const otherOwnerId = "00000000-0000-4000-8000-00000000c002";
const tokenId = "00000000-0000-4000-8000-00000000c003";
const credentialId = "00000000-0000-4000-8000-00000000c004";
const jobId = "00000000-0000-4000-8000-00000000c005";
const claimId = "00000000-0000-4000-8000-00000000c006";

function summary() {
  return {
    parentAfterSalesSn: "AFTER-1",
    parentOrderSn: "ORDER-1",
    afterSalesStatusGroup: 1,
    operateExpireTimeMs: null,
    availableOperateList: [1, "VIEW"],
    returnDeliveryType: null,
    parentAfterSalesStatus: 1,
    updateAt: 1_788_000_000,
    afterSalesType: 2,
    createAt: 1_787_000_000,
  };
}

function baseArguments() {
  return {
    kind: "after_sales",
    includeDetails: true,
    pageNo: 1,
    pageSize: 200,
    afterSalesStatusGroup: 1,
    updateAtStart: 1_787_000_000,
    updateAtEnd: 1_788_000_000,
    sellerpilotHistoryRunId: "00000000-0000-4000-8000-00000000c007",
  };
}

function retryArguments() {
  return {
    ...baseArguments(),
    detailQueue: [summary()],
    sellerpilotTemuDetailRetryCount: 1,
  };
}

async function fixture({
  applyProposal = false,
  tokenScope = "serverless_cs",
  tokenStatus = "active",
  tokenExpired = false,
  tokenOwner = ownerId,
  credentialOwner = ownerId,
  jobOwner = ownerId,
  channel = "temu",
  operation = "inquiries.list",
} = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create function extensions.digest(text, text)
      returns bytea language sql immutable
      as $$select sha256(convert_to($1, 'UTF8'))$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,
      token_hash text not null,
      scope text not null,
      status text not null,
      expires_at timestamptz not null,
      created_by uuid not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      status text not null,
      expires_at timestamptz,
      created_by uuid not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid references sellerpilot_private.channel_credentials(id),
      created_by uuid not null,
      channel text not null,
      operation text not null,
      request_payload jsonb not null,
      status text not null,
      worker_token_id uuid,
      claim_token uuid,
      lease_expires_at timestamptz,
      provider_mutation_started_at timestamptz,
      rate_not_before timestamptz,
      attempt_count integer not null default 0,
      error_message text,
      completed_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create function public.sellerpilot_is_admin()
      returns boolean language sql stable as $$select true$$;
  `);
  await db.query(`
    insert into sellerpilot_private.ai_cli_worker_tokens
      values ($1, 'token-hash', $2, $3, now() + $4::interval, $5)
  `, [tokenId, tokenScope, tokenStatus, tokenExpired ? "-1 second" : "1 day", tokenOwner]);
  await db.query(`
    insert into sellerpilot_private.channel_credentials
      values ($1, $2, 'active', now() + interval '1 day', $3)
  `, [credentialId, channel, credentialOwner]);
  await db.exec(durableMigration);
  await db.exec(replayMigration);
  if (applyProposal) await db.exec(scopeMigration);
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs(
      id, credential_id, created_by, channel, operation, request_payload,
      status, worker_token_id, claim_token, lease_expires_at, attempt_count
    ) values ($1, $2, $3, $4, $5, jsonb_build_object(
      'periodicKey', 'inquiries:history:2026-09-08:after_sales',
      'arguments', $6::jsonb
    ), 'running', $7, $8, now() + interval '10 minutes', 2)
  `, [jobId, credentialId, jobOwner, channel, operation, JSON.stringify(baseArguments()), tokenId, claimId]);
  return db;
}

async function requeue(db, claim = claimId) {
  return (await db.query(`
    select public.sellerpilot_service_requeue_temu_after_sales_detail_v2(
      $1, $2, $3, $4::jsonb, 1, 5, 1, 0, 503
    ) result
  `, ["token-hash", jobId, claim, JSON.stringify(retryArguments())])).rows[0].result;
}

async function assertUntouched(db) {
  const job = (await db.query(
    "select status, claim_token from sellerpilot_private.channel_gateway_jobs where id = $1",
    [jobId],
  )).rows[0];
  assert.deepEqual(job, { status: "running", claim_token: claimId });
  assert.equal((await db.query(
    "select count(*)::int count from sellerpilot_private.temu_after_sales_detail_retry_ledger",
  )).rows[0].count, 0);
}

test("current Temu retry v2 rejects the actual serverless_cs worker scope", async () => {
  const db = await fixture();
  try {
    await assert.rejects(requeue(db), /invalid worker token/);
    await assertUntouched(db);
  } finally { await db.close(); }
});

test("canonical scope migration accepts only exact gateway and serverless_cs read claims", async () => {
  for (const tokenScope of ["gateway", "serverless_cs"]) {
    const db = await fixture({ applyProposal: true, tokenScope });
    try {
      const receipt = await requeue(db);
      assert.deepEqual(receipt, {
        contract: "temu-after-sales-detail-retry-v2",
        status: "deferred",
        retryCount: 1,
        retryAfterSeconds: 5,
        deferredCount: 1,
        replayCount: 0,
        failureCode: "TEMU_AFTER_SALES_DETAIL_READ_FAILED",
        replayed: false,
      });
      assert.equal((await db.query(
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [jobId],
      )).rows[0].status, "queued");
      assert.deepEqual(await requeue(db), { ...receipt, replayed: true });
    } finally { await db.close(); }
  }
});

test("shared administrator worker may retry another creator's exactly claimed job", async () => {
  const db = await fixture({ applyProposal: true, tokenOwner: otherOwnerId });
  try {
    const receipt = await requeue(db);
    assert.equal(receipt.status, "deferred");
    assert.equal((await requeue(db)).replayed, true);
  } finally { await db.close(); }
});

test("canonical scope migration keeps scope, expiry, claim, lease, operation, channel and worker binding fences closed", async () => {
  const scenarios = [
    { fixture: { tokenScope: "serverless_cs_scheduler" }, pattern: /invalid worker token/ },
    { fixture: { tokenScope: "legacy_combined" }, pattern: /invalid worker token/ },
    { fixture: { tokenStatus: "revoked" }, pattern: /invalid worker token/ },
    { fixture: { tokenExpired: true }, pattern: /invalid worker token/ },
    { callClaim: "00000000-0000-4000-8000-00000000c099", pattern: /ownership lost/ },
    { prepare: (db) => db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [jobId]), pattern: /ownership lost/ },
    { fixture: { operation: "listing.create" }, pattern: /Temu after-sales read job required/ },
    { fixture: { operation: "inquiries.reply" }, pattern: /Temu after-sales read job required/ },
    { prepare: (db) => db.query("update sellerpilot_private.channel_gateway_jobs set worker_token_id = $2 where id = $1", [jobId, otherOwnerId]), pattern: /ownership lost/ },
    { fixture: { channel: "qoo10" }, pattern: /Temu after-sales read job required/ },
  ];
  for (const scenario of scenarios) {
    const db = await fixture({ applyProposal: true, ...scenario.fixture });
    try {
      if (scenario.prepare) await scenario.prepare(db);
      await assert.rejects(requeue(db, scenario.callClaim), scenario.pattern);
      await assertUntouched(db);
    } finally { await db.close(); }
  }
});

test("canonical scope migration rejects unexpected preimage and keeps service-only ACL", async () => {
  const db = await fixture({ applyProposal: true });
  try {
    await assert.rejects(db.exec(scopeMigration), /TEMU_RETRY_SCOPE_PREIMAGE_DRIFTED/);
    await db.exec("rollback");
    const permissions = (await db.query("select has_function_privilege('anon', 'public.sellerpilot_service_requeue_temu_after_sales_detail_v2(text,uuid,uuid,jsonb,integer,integer,integer,integer,integer)', 'EXECUTE') as anon, has_function_privilege('authenticated', 'public.sellerpilot_service_requeue_temu_after_sales_detail_v2(text,uuid,uuid,jsonb,integer,integer,integer,integer,integer)', 'EXECUTE') as authenticated, has_function_privilege('service_role', 'public.sellerpilot_service_requeue_temu_after_sales_detail_v2(text,uuid,uuid,jsonb,integer,integer,integer,integer,integer)', 'EXECUTE') as service")).rows[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false, service: true });
  } finally { await db.close(); }
});
