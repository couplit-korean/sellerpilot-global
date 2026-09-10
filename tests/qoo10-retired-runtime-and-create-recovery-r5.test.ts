import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  qoo10CreateCurrentStateFenceRpc,
  qoo10CreateGetRecoveryRpc,
  qoo10DurableCreateFulfillmentBindingArgument,
  qoo10DurableCreateFulfillmentBindingContract,
  qoo10RetiredExistingItemCode,
  recordQoo10CreateOfficialGetRecovery,
} from "../lib/server-qoo10-listing-create-fulfillment-source";
import {
  qoo10LotteExistingPostWriteVerificationRequirement,
  qoo10LotteExistingUpdateIdentity,
  qoo10LotteExistingUpdateProtection,
  qoo10LotteExistingUpdateTupleMatches,
} from "../lib/channels/qoo10-existing-update-identity";
import { qoo10LotteExistingGatewayRequirement } from "../lib/server-qoo10-lotte-existing-postwrite-reconciliation";
import {
  qoo10QsmCreateFulfillmentCaptureContract,
  qoo10QsmCreateFulfillmentCollector,
  qoo10QsmCreateFulfillmentOrigin,
  qoo10QsmCreateFulfillmentTrustBoundary,
  sealQoo10QsmCreateFulfillmentCapture,
} from "../lib/channels/qoo10-listing-create-fulfillment-qsm-source";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  }
  return nextResolve(specifier, context);
} });

const ownerId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000001";
const productId = "30000000-0000-4000-8000-000000000001";
const listingId = "40000000-0000-4000-8000-000000000001";
const attemptId = "50000000-0000-4000-8000-000000000001";
const jobId = "60000000-0000-4000-8000-000000000001";
const claimToken = "70000000-0000-4000-8000-000000000001";
const vaultId = "80000000-0000-4000-8000-000000000001";
const requestFingerprint = "f".repeat(64);
const fulfillmentDigest = "e".repeat(64);
const sellerId = "seller-fixture";
const targetId = "Japan · QAPI";
const sellerCode = "NEW-SKU-001";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

function durableArguments(sourceId: string, sourceRevision: string, captureDigest: string) {
  const observedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(observedAt) + 5 * 60_000).toISOString();
  const binding = {
    contract: qoo10DurableCreateFulfillmentBindingContract,
    sourceId, ownerId, productId, credentialId, credentialVersion: 7,
    sellerId, market: "JP" as const, targetId,
    sourceRevision, captureDigest,
    fulfillmentEvidenceDigest: fulfillmentDigest,
    observedAt, expiresAt,
  };
  return {
    binding,
    argumentsValue: {
      params: { SellerCode: sellerCode },
      [qoo10DurableCreateFulfillmentBindingArgument]: binding,
      sellerpilotQoo10CreateFulfillmentEvidence: { evidenceDigest: fulfillmentDigest },
      sellerpilotQoo10CreateApprovalBinding: { fulfillmentEvidenceDigest: fulfillmentDigest },
    },
  };
}

async function databaseFixture() {
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
      id uuid primary key, channel text not null, environment text not null,
      version integer not null, vault_secret_id uuid not null, status text not null,
      expires_at timestamptz, created_by uuid not null references auth.users(id)
    );
    create table sellerpilot_private.products (
      id uuid primary key, owner_id uuid not null references auth.users(id),
      demo boolean not null default false, status text not null default 'active'
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key, owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null, operation text not null, request_fingerprint text not null,
      status text not null, gateway_write_required boolean not null default true,
      pre_gateway_retryable boolean not null default false, http_status integer,
      remote_id text, safe_message text, completed_at timestamptz
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key, owner_id uuid not null, product_id uuid not null,
      channel_key text not null, market text not null, target_id text not null,
      operation_attempt_id uuid, status text not null, remote_id text
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key, attempt_id uuid, listing_id uuid, credential_id uuid,
      channel text not null, operation text not null, request_fingerprint text,
      request_payload jsonb not null, claim_token uuid, status text not null,
      lease_expires_at timestamptz, provider_mutation_started_at timestamptz
    );
    create table vault.decrypted_secrets (
      id uuid primary key, decrypted_secret text not null
    );
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $$
    begin
      if p_token_hash = repeat('b',64) then return false; end if;
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=clock_timestamp()
       where id=p_job_id and claim_token=p_claim_token and status='running';
      return found;
    end $$;
    insert into auth.users values ('${ownerId}');
    insert into sellerpilot_private.admin_users values ('${ownerId}');
    insert into sellerpilot_private.products values ('${productId}','${ownerId}',false,'active');
    insert into vault.decrypted_secrets values (
      '${vaultId}','{"seller_id":"${sellerId}","api_key":"never-returned"}'
    );
    insert into sellerpilot_private.channel_credentials values (
      '${credentialId}','qoo10','production',7,'${vaultId}','active',null,'${ownerId}'
    );
    insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,request_fingerprint,status
    ) values (
      '${attemptId}','${ownerId}','${credentialId}','qoo10','listing.create',
      '${requestFingerprint}','running'
    );
    insert into sellerpilot_private.product_listings values (
      '${listingId}','${ownerId}','${productId}','qoo10','JP','${targetId}',
      '${attemptId}','queued',null
    );
  `);
  await db.exec(await readFile(new URL(
    "../supabase/migrations/20260910023500_qoo10_fulfillment_evidence.sql",
    import.meta.url,
  ), "utf8"));
  await db.exec(await readFile(new URL(
    "../supabase/migrations/20260910033500_qoo10_gateway_create_atomic_recovery.sql",
    import.meta.url,
  ), "utf8"));
  await db.exec(await readFile(new URL(
    "../supabase/migrations/20260910050000_qoo10_retired_runtime_and_create_recovery_hardening_r5.sql",
    import.meta.url,
  ), "utf8"));
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

async function seedSourceAndJob(db: PGlite) {
  await asService(db);
  const observedAt = new Date().toISOString();
  const capture = sealQoo10QsmCreateFulfillmentCapture({
    contract: qoo10QsmCreateFulfillmentCaptureContract,
    collector: qoo10QsmCreateFulfillmentCollector,
    trustBoundary: qoo10QsmCreateFulfillmentTrustBoundary,
    browser: {
      name: "Chrome", family: "chrome", type: "extension", profileName: "CHANGHEE",
    },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    authenticatedSellerId: sellerId,
    testItemCode: "1234567890",
    testItemSellerCode: "seller-item-fixture",
    observedAt,
    dispatchPlaces: [{ id: "dispatch-1", active: true, payload: {
      label: "dispatch", countryCode: "JP", postalCode: "1000001",
      addressLine1: "Tokyo",
    } }],
    returnPolicies: [{ id: "return-1", active: true, payload: {
      label: "return", returnWindowDays: 7, returnShippingPaidBy: "buyer",
    } }],
  });
  const recorded = await db.query<{ source_id: string }>(`
    select public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,7,'JP',$4::text,$5::text,'1234567890',
      'dispatch-1','return-1',$6::text,$7::text,$8::jsonb
    ) source_id
  `, [ownerId, productId, credentialId, targetId, sellerId,
    capture.sourceRevision, capture.captureDigest, JSON.stringify(capture)]);
  const sourceId = recorded.rows[0].source_id;
  await db.query(`select public.sellerpilot_service_take_qoo10_create_fulfillment_capture(
    $1::uuid,$2::uuid,$3::uuid,7,'JP',$4::text
  )`, [ownerId, productId, credentialId, targetId]);
  const { argumentsValue, binding } = durableArguments(
    sourceId, capture.sourceRevision, capture.captureDigest,
  );
  binding.observedAt = observedAt;
  binding.expiresAt = new Date(Date.parse(observedAt) + 5 * 60_000).toISOString();
  await resetRole(db);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,attempt_id,listing_id,credential_id,channel,operation,request_fingerprint,
    request_payload,claim_token,status,lease_expires_at
  ) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'qoo10','listing.create',$5::text,
    $6::jsonb,$7::uuid,'running',clock_timestamp()+interval '10 minutes')`, [
    jobId, attemptId, listingId, credentialId, requestFingerprint,
    JSON.stringify({ arguments: argumentsValue }), claimToken,
  ]);
  await asService(db);
  return { sourceId, capture };
}

async function callAtomic(
  db: PGlite,
  sourceId: string,
  capture: ReturnType<typeof sealQoo10QsmCreateFulfillmentCapture>,
  tokenHash = "a".repeat(64),
) {
  return db.query<{ receipt: Record<string, unknown> }>(`
    select public.sellerpilot_service_begin_qoo10_gateway_create_v1(
      $1::text,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,7,
      $8::text,'JP',$9::text,$10::text,$11::text,$12::text
    ) receipt
  `, [tokenHash, jobId, claimToken, sourceId, ownerId, productId, credentialId,
    sellerId, targetId, capture.sourceRevision, capture.captureDigest, fulfillmentDigest]);
}

test("r5 owned Lotte/existing-product runtime no longer matches the retired SKU", () => {
  assert.notEqual(qoo10LotteExistingUpdateIdentity.remoteId, "1217536689");
  assert.notEqual(qoo10LotteExistingUpdateIdentity.sellerSku, "AUTO-780720401E2D4E4EA45F");
  assert.equal(qoo10LotteExistingUpdateTupleMatches({
    productId: "1ed4acfc-7603-48ec-a638-241131e59358",
    listingId: "13858f41-78fd-463f-9390-e8f06e71e538",
    credentialId: "2b49d081-5188-4a75-9555-e0a6438e8a2b",
    remoteId: "1217536689",
    market: "JP",
    targetId: "Japan · QAPI",
    sellerSku: "AUTO-780720401E2D4E4EA45F",
  }), false);
  assert.equal(qoo10LotteExistingUpdateProtection({
    [ "sellerpilotQoo10LotteExistingUpdateProtection" ]: { remoteId: "1217536689" },
  }), null);
  assert.equal(qoo10LotteExistingPostWriteVerificationRequirement({}), null);
  assert.equal(qoo10LotteExistingGatewayRequirement({
    jobId, attemptId, listingId, channel: "qoo10", operation: "listing.update",
    publicationVerificationBoundary: new Date().toISOString(),
    completionStatus: "reconciliation_required",
    result: { ok: false, channel: "qoo10", operation: "listing.update", remoteId: "1217536689", steps: [] },
  }), null);
});

test("r5 owned Qoo10 modules do not keep an active 1217536689 create-success path", async () => {
  const files = [
    "lib/channels/qoo10-existing-update-identity.ts",
    "lib/channels/qoo10-qsm-existing-carrier-collector.ts",
    "lib/channels/qoo10-qsm-existing-carrier-cdp-collector.ts",
    "lib/channels/qoo10-qsm-existing-postwrite-service-runner.ts",
    "lib/channels/qoo10-update-shipping.ts",
    "lib/product-registration/channels/qoo10.ts",
    "lib/server-qoo10-lotte-existing-carrier-evidence.ts",
    "lib/server-qoo10-lotte-existing-postwrite-reconciliation.ts",
    "lib/channels/qoo10-content-preview.ts",
    "lib/server-qoo10-content-preview.ts",
    "scripts/qoo10-qsm-existing-carrier-collector.ts",
    "app/api/channel-gateway/worker/qoo10-create-boundary/route.ts",
    "app/api/channel-gateway/worker/qoo10-create-boundary/recover/route.ts",
    "lib/channels/listing-update.ts",
    "lib/channels/commerce-worker-completion.ts",
    "app/api/admin/channel-operations/route.ts",
    "scripts/commerce-gateway-job.mjs",
  ];
  for (const file of files) {
    const body = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(body, /1217536689/u, file);
  }
});

test("r5 SQL identifiers stay within 63 bytes and export the short fence successor", async () => {
  const sql = await readFile(new URL(
    "../supabase/migrations/20260910050000_qoo10_retired_runtime_and_create_recovery_hardening_r5.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, new RegExp(qoo10CreateCurrentStateFenceRpc, "u"));
  assert.match(sql, new RegExp(qoo10CreateGetRecoveryRpc, "u"));
  for (const match of sql.matchAll(/sellerpilot_[a-z0-9_]+/giu)) {
    assert.ok(Buffer.byteLength(match[0], "utf8") <= 63, `${match[0]} exceeds 63 bytes`);
  }
});

test("review69: post-enqueue product-status change is rejected by current-state CAS", async () => {
  const db = await databaseFixture();
  const seeded = await seedSourceAndJob(db);
  await resetRole(db);
  await db.query(
    `update sellerpilot_private.products set status='paused' where id=$1`,
    [productId],
  );
  await asService(db);
  await assert.rejects(
    () => callAtomic(db, seeded.sourceId, seeded.capture),
    /QOO10_CREATE_CURRENT_STATE_CAS_REJECTED/u,
  );
  await resetRole(db);
  const started = await db.query<{ started: boolean }>(`
    select provider_mutation_started_at is not null as started
      from sellerpilot_private.channel_gateway_jobs where id=$1
  `, [jobId]);
  assert.equal(started.rows[0].started, false);
  await db.close();
});

test("review69: lost CREATE response records official GET recovery instead of a permanent 409", async () => {
  const db = await databaseFixture();
  const seeded = await seedSourceAndJob(db);
  await callAtomic(db, seeded.sourceId, seeded.capture);
  await resetRole(db);
  await db.query(`
    update sellerpilot_private.channel_operation_attempts
       set status='manual_required', http_status=409,
           safe_message='Qoo10 CREATE provider boundary crossed; official SellerCode lookup required.'
     where id=$1
  `, [attemptId]);
  await asService(db);
  const observedAt = new Date().toISOString();
  const receipt = await db.query<{ receipt: Record<string, unknown> }>(`
    select public.sellerpilot_service_qoo10_create_get_rec_v1(
      $1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,'unique',$6::text,
      $7::text,$8::text,200,'0',$9::timestamptz
    ) receipt
  `, ["a".repeat(64), jobId, claimToken, seeded.sourceId, sellerCode,
    "1234567891", digestA, digestB, observedAt]);
  assert.equal(receipt.rows[0].receipt.contract, "sellerpilot_qoo10_create_official_get_recovery_v1");
  assert.equal(receipt.rows[0].receipt.receiptKind, "official_get_recovery");
  assert.equal(receipt.rows[0].receipt.synthesizedPostReceipt, false);
  assert.equal(receipt.rows[0].receipt.listingPublished, false);
  assert.equal(receipt.rows[0].receipt.remoteId, "1234567891");
  await resetRole(db);
  const state = await db.query<{
    http_status: number; status: string; listing_remote: string | null; listing_status: string;
  }>(`
    select attempt.http_status, attempt.status,
           listing.remote_id listing_remote, listing.status listing_status
      from sellerpilot_private.channel_operation_attempts attempt
      join sellerpilot_private.product_listings listing on listing.id=$2
     where attempt.id=$1
  `, [attemptId, listingId]);
  assert.equal(state.rows[0].http_status, 200);
  assert.equal(state.rows[0].status, "reconciliation_required");
  assert.equal(state.rows[0].listing_remote, null);
  assert.equal(state.rows[0].listing_status, "queued");
  await db.close();
});

test("review69: GET recovery refuses existing item 1217536689 as a new CREATE", async () => {
  const db = await databaseFixture();
  const seeded = await seedSourceAndJob(db);
  await callAtomic(db, seeded.sourceId, seeded.capture);
  await asService(db);
  await assert.rejects(
    () => db.query(`
      select public.sellerpilot_service_qoo10_create_get_rec_v1(
        $1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,'unique',$6::text,
        $7::text,$8::text,200,'0',$9::timestamptz
      )
    `, ["a".repeat(64), jobId, claimToken, seeded.sourceId, sellerCode,
      qoo10RetiredExistingItemCode, digestA, digestB, new Date().toISOString()]),
    /QOO10_CREATE_GET_RECOVERY_EXISTING_ITEM_REJECTED/u,
  );
  await assert.rejects(
    () => recordQoo10CreateOfficialGetRecovery({
      gatewayTokenHash: "a".repeat(64),
      jobId, claimToken, sourceId: seeded.sourceId,
      requestSha256: digestA, responseSha256: digestB,
      observation: {
        contract: "sellerpilot_qoo10_local_create_seller_code_lookup_v1",
        lookupStatus: "observed",
        matchStatus: "unique",
        sellerCode,
        httpStatus: 200,
        resultCode: "0",
        resultMessage: null,
        exactRemoteIds: [qoo10RetiredExistingItemCode],
        uniqueRemoteId: qoo10RetiredExistingItemCode,
        observedAt: new Date().toISOString(),
      },
      rpc: async () => ({ data: null, error: null }),
    }),
    /QOO10_CREATE_GET_RECOVERY_EXISTING_ITEM_REJECTED/u,
  );
  await db.close();
});
