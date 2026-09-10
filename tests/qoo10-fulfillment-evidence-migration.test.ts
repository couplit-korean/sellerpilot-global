import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  qoo10QsmCreateFulfillmentCaptureContract,
  qoo10QsmCreateFulfillmentCollector,
  qoo10QsmCreateFulfillmentOrigin,
  qoo10QsmCreateFulfillmentTrustBoundary,
  sealQoo10QsmCreateFulfillmentCapture,
  type Qoo10QsmCreateFulfillmentCapture,
} from "../lib/channels/qoo10-listing-create-fulfillment-qsm-source";

const migrationUrl = new URL(
  "../supabase/migrations/20260910023500_qoo10_fulfillment_evidence.sql",
  import.meta.url,
);
const ownerId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000001";
const productId = "40000000-0000-4000-8000-000000000001";
const vaultId = "30000000-0000-4000-8000-000000000001";
const sellerId = "seller-fixture";
const testItemCode = "1234567890";
const dispatchPlaceId = "dispatch-jp-1";
const returnPolicyId = "returns-jp-1";
const targetId = "Japan · QAPI";
const attemptId = "50000000-0000-4000-8000-000000000001";
const requestFingerprint = "f".repeat(64);

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create schema vault;
    create table auth.users (id uuid primary key);
    create table sellerpilot_private.admin_users (
      user_id uuid primary key references auth.users(id)
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      version integer not null,
      vault_secret_id uuid not null,
      status text not null,
      expires_at timestamptz,
      created_by uuid not null references auth.users(id)
    );
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null references auth.users(id),
      demo boolean not null default false,
      status text not null default 'active'
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,
      operation text not null,
      request_fingerprint text not null,
      status text not null,
      gateway_write_required boolean not null default true,
      pre_gateway_retryable boolean not null default false,
      http_status integer,
      remote_id text,
      safe_message text,
      completed_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      attempt_id uuid references sellerpilot_private.channel_operation_attempts(id)
    );
    create table vault.decrypted_secrets (
      id uuid primary key,
      decrypted_secret text not null
    );
    insert into auth.users(id) values ('${ownerId}');
    insert into sellerpilot_private.admin_users(user_id) values ('${ownerId}');
    insert into sellerpilot_private.products(id,owner_id) values ('${productId}','${ownerId}');
    insert into vault.decrypted_secrets(id, decrypted_secret)
      values ('${vaultId}', '{"seller_id":"${sellerId}","api_key":"not-returned"}');
    insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,status,created_by
    ) values (
      '${credentialId}','qoo10','production',7,'${vaultId}','active','${ownerId}'
    );
    insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,request_fingerprint,status
    ) values (
      '${attemptId}','${ownerId}','${credentialId}','qoo10','listing.create',
      '${requestFingerprint}','running'
    );
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

async function asService(db: PGlite) {
  await db.exec("set role service_role");
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.exec("select set_config('request.jwt.claim.role','',false)");
}

function capture(observedAt = new Date().toISOString()) {
  return sealQoo10QsmCreateFulfillmentCapture({
    contract: qoo10QsmCreateFulfillmentCaptureContract,
    collector: qoo10QsmCreateFulfillmentCollector,
    trustBoundary: qoo10QsmCreateFulfillmentTrustBoundary,
    browser: {
      name: "Chrome",
      family: "chrome",
      type: "extension",
      profileName: "CHANGHEE",
    },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    authenticatedSellerId: sellerId,
    testItemCode,
    testItemSellerCode: "seller-item-fixture",
    observedAt,
    dispatchPlaces: [{
      id: dispatchPlaceId,
      active: true,
      payload: {
        label: "dispatch", countryCode: "JP", postalCode: "1000001",
        addressLine1: "Tokyo",
      },
    }],
    returnPolicies: [{
      id: returnPolicyId,
      active: true,
      payload: {
        label: "returns", returnWindowDays: 7, returnShippingPaidBy: "buyer",
      },
    }],
  });
}

async function recordCapture(db: PGlite, value: Qoo10QsmCreateFulfillmentCapture) {
  return db.query<{ source_id: string }>(`
    select public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::text,$7::text,
      $8::text,$9::text,$10::text,$11::text,$12::text,$13::jsonb
    ) as source_id
  `, [
    ownerId, productId, credentialId, 7, "JP", targetId, sellerId, testItemCode,
    dispatchPlaceId, returnPolicyId, value.sourceRevision,
    value.captureDigest, JSON.stringify(value),
  ]);
}

async function takeCapture(db: PGlite, version = 7) {
  const result = await db.query<{ source: unknown }>(`
    select public.sellerpilot_service_take_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::text
    ) as source
  `, [ownerId, productId, credentialId, version, "JP", targetId]);
  return result.rows[0]?.source ?? null;
}

async function fenceCapture(db: PGlite, sourceId: string, value: Qoo10QsmCreateFulfillmentCapture) {
  return db.query<{ fenced: boolean }>(`
    select public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_current(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::text,$7::text,
      $8::text,$9::text,$10::text,$11::text
    ) as fenced
  `, [
    sourceId, ownerId, productId, credentialId, 7, sellerId, "JP", targetId,
    value.sourceRevision, value.captureDigest, "e".repeat(64),
  ]);
}

async function fenceLocalCapture(db: PGlite, sourceId: string, value: Qoo10QsmCreateFulfillmentCapture) {
  return db.query<{ fenced: boolean }>(`
    select public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_current(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::text,$7::text,
      $8::text,$9::text,$10::text,$11::text,$12::uuid,$13::text
    ) as fenced
  `, [
    sourceId, ownerId, productId, credentialId, 7, sellerId, "JP", targetId,
    value.sourceRevision, value.captureDigest, "e".repeat(64),
    attemptId, requestFingerprint,
  ]);
}

test("service-only append/take returns one exact fresh source and blocks replay", async () => {
  const db = await fixture();
  const value = capture();
  await assert.rejects(() => recordCapture(db, value), /ACCESS_DENIED|permission denied/iu);

  await asService(db);
  const inserted = await recordCapture(db, value);
  assert.match(inserted.rows[0].source_id, /^[0-9a-f-]{36}$/u);
  await assert.rejects(
    () => db.query("select * from sellerpilot_private.qoo10_create_fulfillment_captures"),
    /permission denied/iu,
  );

  const source = await takeCapture(db) as Record<string, unknown>;
  assert.equal(source.contract, "sellerpilot_qoo10_durable_create_fulfillment_source_v1");
  assert.equal(source.ownerId, ownerId);
  assert.equal(source.productId, productId);
  assert.equal(source.credentialId, credentialId);
  assert.equal(source.credentialVersion, 7);
  assert.equal(source.market, "JP");
  assert.equal(source.targetId, targetId);
  assert.equal(source.sellerId, sellerId);
  assert.equal(source.testItemCode, testItemCode);
  assert.equal(source.dispatchPlaceId, dispatchPlaceId);
  assert.equal(source.returnPolicyId, returnPolicyId);
  assert.deepEqual(source.capture, value);
  const fenced = await fenceCapture(db, String(source.sourceId), value);
  assert.equal(fenced.rows[0].fenced, true);
  await assert.rejects(
    () => fenceCapture(db, String(source.sourceId), value),
    /MUTATION_FENCE_REJECTED/iu,
  );
  assert.equal(await takeCapture(db), null);
  await assert.rejects(() => recordCapture(db, value), /CAPTURE_REPLAY/iu);
  await db.close();
});

test("wrong credential version/account, stale, secret, and duplicate active rows fail closed", async () => {
  const db = await fixture();
  await asService(db);
  assert.equal(await takeCapture(db), null, "QSM login gap must read as no source");
  await assert.rejects(() => takeCapture(db, 8), /CREDENTIAL_MISMATCH/iu);

  await resetRole(db);
  await db.exec("insert into auth.users(id) values ('90000000-0000-4000-8000-000000000001')");
  await db.exec("update sellerpilot_private.channel_credentials set created_by='90000000-0000-4000-8000-000000000001'");
  await asService(db);
  await assert.rejects(() => recordCapture(db, capture()), /CREDENTIAL_MISMATCH/iu);
  await resetRole(db);
  await db.exec(`update sellerpilot_private.channel_credentials set created_by='${ownerId}'`);
  await asService(db);

  const stale = capture(new Date(Date.now() - 301_000).toISOString());
  await assert.rejects(() => recordCapture(db, stale), /CAPTURE_INVALID/iu);

  const wrongSeller = { ...capture(), authenticatedSellerId: "other-seller" };
  await assert.rejects(
    () => recordCapture(db, wrongSeller as Qoo10QsmCreateFulfillmentCapture),
    /CAPTURE_INVALID/iu,
  );

  const secret = structuredClone(capture()) as Qoo10QsmCreateFulfillmentCapture;
  secret.dispatchPlaces[0].payload.apiKey = "forbidden";
  await assert.rejects(() => recordCapture(db, secret), /CAPTURE_INVALID/iu);

  await recordCapture(db, capture());
  await assert.rejects(() => recordCapture(db, capture()), /CAPTURE_REPLAY/iu);
  await db.close();
});

test("capture and consumption ledgers are append-only", async () => {
  const db = await fixture();
  await asService(db);
  const value = capture();
  await recordCapture(db, value);
  const source = await takeCapture(db) as Record<string, unknown>;
  await fenceCapture(db, String(source.sourceId), value);
  await resetRole(db);
  await assert.rejects(
    () => db.exec("update sellerpilot_private.qoo10_create_fulfillment_captures set seller_id='changed'"),
    /LEDGER_IMMUTABLE/iu,
  );
  await assert.rejects(
    () => db.exec("delete from sellerpilot_private.qoo10_create_fulfillment_capture_consumptions"),
    /LEDGER_IMMUTABLE/iu,
  );
  await assert.rejects(
    () => db.exec("delete from sellerpilot_private.qoo10_create_fulfillment_mutation_fences"),
    /LEDGER_IMMUTABLE/iu,
  );
  await db.close();
});

test("local CAS atomically closes the attempt before mutation and only exact success can complete it", async () => {
  const db = await fixture();
  const value = capture();
  await asService(db);
  await recordCapture(db, value);
  const source = await takeCapture(db) as Record<string, unknown>;
  const fenced = await fenceLocalCapture(db, String(source.sourceId), value);
  assert.equal(fenced.rows[0].fenced, true);

  await resetRole(db);
  const boundary = await db.query<{
    status: string;
    pre_gateway_retryable: boolean;
    local_attempt_id: string;
  }>(`
    select attempt.status, attempt.pre_gateway_retryable, fence.local_attempt_id
      from sellerpilot_private.channel_operation_attempts attempt
      join sellerpilot_private.qoo10_create_fulfillment_mutation_fences fence
        on fence.local_attempt_id = attempt.id
     where attempt.id = $1
  `, [attemptId]);
  assert.deepEqual(boundary.rows[0], {
    status: "manual_required",
    pre_gateway_retryable: false,
    local_attempt_id: attemptId,
  });

  await asService(db);
  const completed = await db.query<{ completed: boolean }>(`
    select public.sellerpilot_service_complete_qoo10_local_create_after_boundary(
      $1::uuid,$2::uuid,200,'1234567890','verified create success'
    ) as completed
  `, [String(source.sourceId), attemptId]);
  assert.equal(completed.rows[0].completed, true);
  await resetRole(db);
  const terminal = await db.query<{ status: string; remote_id: string }>(
    "select status,remote_id from sellerpilot_private.channel_operation_attempts where id=$1",
    [attemptId],
  );
  assert.deepEqual(terminal.rows[0], { status: "succeeded", remote_id: "1234567890" });
  await db.close();
});
