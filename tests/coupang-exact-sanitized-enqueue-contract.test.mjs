import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901090000_fix_coupang_exact_sanitized_enqueue_contract.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const listingId = "7ffc6e46-3173-4695-9889-5fa1529765f1";
const attemptId = "a4af8e47-b820-40c4-96ff-67b6e6d930fe";
const credentialId = "32de2968-d4b7-4fda-a84b-16a7ce0257cc";
const releaseSha = "cf2528bf43714ef3394174bd530e65368acdee4e";
const fingerprint = "9".repeat(64);
const sellerAccountKey = "a".repeat(64);
const safeMessage = "Vercel 서버리스 채널 게이트웨이에서 안전하게 처리된 오류가 발생했습니다.";

function extractTaggedDo(source, tag) {
  const marker = `$${tag}$`;
  const start = source.indexOf(`do ${marker}`);
  assert.notEqual(start, -1, `${tag} must exist`);
  const end = source.indexOf(`${marker};`, start + marker.length);
  assert.notEqual(end, -1, `${tag} end must exist`);
  return source.slice(start, end + marker.length + 1);
}

async function createDatabase({ insertExactRows = true, insertGatewayJob = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema sellerpilot_private;
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      sku text not null,
      on_hand integer not null,
      demo boolean not null,
      status text not null
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz,
      last_checked_at timestamptz,
      last_check_status text
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      request_fingerprint text not null,
      status text not null,
      http_status integer,
      remote_id text,
      safe_message text,
      completed_at timestamptz,
      gateway_write_required boolean not null,
      pre_gateway_retryable boolean not null,
      seller_account_key text
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      remote_id text,
      market text not null,
      target_id text not null,
      currency text not null,
      price numeric not null,
      status text not null,
      failure_class text,
      requested_publication_intent text,
      remote_visibility text,
      provider_status text,
      published_at timestamptz,
      operation_attempt_id uuid,
      last_error text,
      remote_resources jsonb not null,
      seller_account_key text
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      attempt_id uuid,
      listing_id uuid,
      operation text not null,
      status text not null
    );
    create table sellerpilot_private.exact_existing_update_permits (
      permit_id uuid primary key,
      channel text not null,
      listing_id uuid not null,
      product_id uuid not null,
      credential_id uuid not null,
      owner_id uuid not null,
      seller_account_key text not null,
      release_sha text not null,
      request_fingerprint text not null,
      expires_at timestamptz not null,
      update_job_id uuid,
      update_attempt_id uuid,
      bound_at timestamptz,
      bound_worker_token_id uuid,
      bound_claim_token uuid,
      consumed_at timestamptz,
      invalidated_at timestamptz,
      invalidation_reason text
    );
  `);
  if (!insertExactRows) return db;
  await db.query(
    `insert into sellerpilot_private.products
       (id,owner_id,sku,on_hand,demo,status)
     values ($1,$2,'QA-20260823-CC-001',1,false,'draft')`,
    [productId, ownerId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,channel,environment,status,expires_at,seller_account_key,
       seller_account_key_source,seller_account_verified_at,
       last_checked_at,last_check_status
     ) values (
       $1,'coupang','production','active',null,$2,
       'credential_incarnation_v1',clock_timestamp(),
       clock_timestamp(),'passed'
     )`,
    [credentialId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,request_fingerprint,
       status,http_status,remote_id,safe_message,completed_at,
       gateway_write_required,pre_gateway_retryable,seller_account_key
     ) values (
       $1,$2,$3,'coupang','listing.update',$4,'failed',422,null,$5,
       clock_timestamp(),true,true,$6
     )`,
    [attemptId, ownerId, credentialId, fingerprint, safeMessage, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,market,target_id,
       currency,price,status,failure_class,requested_publication_intent,
       remote_visibility,provider_status,published_at,operation_attempt_id,
       last_error,remote_resources,seller_account_key
     ) values (
       $1,$2,$3,'coupang','16356981734','KR','KR','KRW',5000,
       'failed','retryable','live','unknown',null,null,$4,$5,'{}'::jsonb,$6
     )`,
    [listingId, ownerId, productId, attemptId, safeMessage, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.exact_existing_update_permits (
       permit_id,channel,listing_id,product_id,credential_id,owner_id,
       seller_account_key,release_sha,request_fingerprint,expires_at
     ) values (
       '10000000-0000-4000-8000-000000000001','coupang',$1,$2,$3,$4,
       $5,$6,$7,statement_timestamp()-interval '1 minute'
     )`,
    [listingId, productId, credentialId, ownerId, sellerAccountKey, releaseSha, fingerprint],
  );
  if (insertGatewayJob) {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs
         (id,attempt_id,listing_id,operation,status)
       values ('10000000-0000-4000-8000-000000000002',$1,$2,'listing.update','failed')`,
      [attemptId, listingId],
    );
  }
  return db;
}

test("latest exact Coupang enqueue rollback retires only the expired unbound permit", async () => {
  const db = await createDatabase();
  try {
    await db.exec(extractTaggedDo(
      migration,
      "reconcile_coupang_exact_sanitized_enqueue_failure",
    ));
    const listing = (await db.query(
      `select failure_class,operation_attempt_id
         from sellerpilot_private.product_listings where id=$1`,
      [listingId],
    )).rows[0];
    const permit = (await db.query(
      `select invalidation_reason,invalidated_at is not null as invalidated,
              update_job_id,bound_at,consumed_at
         from sellerpilot_private.exact_existing_update_permits`,
    )).rows[0];
    assert.deepEqual(listing, {
      failure_class: "external_action",
      operation_attempt_id: attemptId,
    });
    assert.deepEqual(permit, {
      invalidation_reason: "expired_before_job",
      invalidated: true,
      update_job_id: null,
      bound_at: null,
      consumed_at: null,
    });
  } finally {
    await db.close();
  }
});

test("any durable gateway job makes the latest reconciliation fail closed", async () => {
  const db = await createDatabase({ insertGatewayJob: true });
  try {
    await assert.rejects(
      db.exec(extractTaggedDo(
        migration,
        "reconcile_coupang_exact_sanitized_enqueue_failure",
      )),
      /COUPANG_EXACT_SANITIZED_ENQUEUE_RECONCILIATION_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

test("clean replay does not create the production Coupang tuple", async () => {
  const db = await createDatabase({ insertExactRows: false });
  try {
    await db.exec(extractTaggedDo(
      migration,
      "reconcile_coupang_exact_sanitized_enqueue_failure",
    ));
    const count = (await db.query(
      "select count(*)::integer count from sellerpilot_private.product_listings",
    )).rows[0].count;
    assert.equal(count, 0);
  } finally {
    await db.close();
  }
});
