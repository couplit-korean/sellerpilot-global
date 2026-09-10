import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260909153336_cs_qoo10_inquiry_identity_context.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const token = "00000000-0000-4000-8000-000000000002";
const credentialA = "00000000-0000-4000-8000-000000000003";
const credentialB = "00000000-0000-4000-8000-000000000004";
const jobA = "00000000-0000-4000-8000-000000000005";
const jobB = "00000000-0000-4000-8000-000000000006";
const claimA = "00000000-0000-4000-8000-000000000007";
const claimB = "00000000-0000-4000-8000-000000000008";
const tokenHash = "c".repeat(64);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,created_by uuid,
      seller_account_key text,seller_account_key_source text,status text,
      expires_at timestamptz
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text,status text,expires_at timestamptz,scope text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,channel text,operation text,environment text,
      created_by uuid,seller_account_key text,status text,worker_token_id uuid,
      claim_token uuid,lease_expires_at timestamptz
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key,claim_token uuid,worker_token_id uuid
    );
  `);
  await db.exec(migration);
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens values($1,$2,'active',clock_timestamp()+interval '1 hour','gateway')", [token, tokenHash]);
  await db.query(`insert into sellerpilot_private.channel_credentials values
    ($1,'qoo10','production',$3,$4,'credential_incarnation_v1','active',clock_timestamp()+interval '1 hour'),
    ($2,'qoo10','production',$3,$5,'credential_incarnation_v1','active',clock_timestamp()+interval '1 hour')`, [
    credentialA, credentialB, owner, "a".repeat(64), "b".repeat(64),
  ]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values
    ($1,$2,'qoo10','inquiries.list','production',$5,$6,'running',$7,$3,clock_timestamp()+interval '15 minutes'),
    ($4,$8,'qoo10','inquiries.list','production',$5,$9,'running',$7,$10,clock_timestamp()+interval '15 minutes')`, [
    jobA, credentialA, claimA, jobB, owner, "a".repeat(64), token, credentialB, "b".repeat(64), claimB,
  ]);
  return db;
}

async function readContext(db, job, claim) {
  return (await db.query(
    "select public.sellerpilot_service_qoo10_inquiry_identity_context_v1($1,$2,$3) result",
    [tokenHash, job, claim],
  )).rows[0].result;
}

test("same provider question can receive two distinct attested account contexts", async () => {
  const db = await fixture();
  try {
    const first = await readContext(db, jobA, claimA);
    const second = await readContext(db, jobB, claimB);
    assert.equal(first.contract, "sellerpilot-qoo10-inquiry-identity-context/1");
    assert.equal(first.ownerId, second.ownerId);
    assert.notEqual(first.sellerAccountKey, second.sellerAccountKey);
    assert.notEqual(first.sourceCredentialId, second.sourceCredentialId);
  } finally {
    await db.close();
  }
});

test("completed receipt preserves identity lookup but cross-claim access fails", async () => {
  const db = await fixture();
  try {
    await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)", [jobA, claimA, token]);
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='succeeded',worker_token_id=null,claim_token=null,lease_expires_at=null where id=$1", [jobA]);
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='revoked',expires_at=clock_timestamp()-interval '1 hour' where id=$1", [token]);
    await db.query("update sellerpilot_private.channel_credentials set status='revoked',expires_at=clock_timestamp()-interval '1 hour' where id=$1", [credentialA]);
    assert.equal((await readContext(db, jobA, claimA)).sourceCredentialId, credentialA);
    await assert.rejects(readContext(db, jobA, claimB), /QOO10_INQUIRY_IDENTITY_CONTEXT_RECEIPT_REQUIRED/u);
  } finally {
    await db.close();
  }
});

test("running access accepts gateway and serverless scopes but rejects wrong scope or expiry", async () => {
  const db = await fixture();
  try {
    for (const scope of ["gateway", "serverless_cs", "legacy_combined"]) {
      await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope=$1,status='active',expires_at=clock_timestamp()+interval '1 hour' where id=$2", [scope, token]);
      assert.equal((await readContext(db, jobA, claimA)).sourceCredentialId, credentialA);
    }
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='product_worker' where id=$1", [token]);
    await assert.rejects(readContext(db, jobA, claimA), /QOO10_INQUIRY_IDENTITY_CONTEXT_RECEIPT_REQUIRED/u);
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs',expires_at=clock_timestamp()-interval '1 second' where id=$1", [token]);
    await assert.rejects(readContext(db, jobA, claimA), /QOO10_INQUIRY_IDENTITY_CONTEXT_RECEIPT_REQUIRED/u);
  } finally {
    await db.close();
  }
});

test("running access requires an active unexpired credential", async () => {
  const db = await fixture();
  try {
    await db.query("update sellerpilot_private.channel_credentials set status='revoked' where id=$1", [credentialA]);
    await assert.rejects(readContext(db, jobA, claimA), /QOO10_INQUIRY_ACCOUNT_LINEAGE_UNATTESTED/u);
    await db.query("update sellerpilot_private.channel_credentials set status='active',expires_at=clock_timestamp()-interval '1 second' where id=$1", [credentialA]);
    await assert.rejects(readContext(db, jobA, claimA), /QOO10_INQUIRY_ACCOUNT_LINEAGE_UNATTESTED/u);
  } finally {
    await db.close();
  }
});
