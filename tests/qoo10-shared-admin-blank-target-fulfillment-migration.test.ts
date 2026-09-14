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
} from "../lib/channels/qoo10-listing-create-fulfillment-qsm-source";

const baseMigration = new URL(
  "../supabase/migrations/20260910023500_qoo10_fulfillment_evidence.sql",
  import.meta.url,
);
const sharedAdminMigration = new URL(
  "../supabase/migrations/20260914173000_qoo10_shared_admin_blank_target_fulfillment.sql",
  import.meta.url,
);
const productOwnerId = "10000000-0000-4000-8000-000000000001";
const credentialOwnerId = "10000000-0000-4000-8000-000000000002";
const credentialId = "20000000-0000-4000-8000-000000000001";
const vaultId = "30000000-0000-4000-8000-000000000001";
const productId = "40000000-0000-4000-8000-000000000001";
const sellerId = "seller-fixture";
const testItemCode = "1234567890";

function capture() {
  return sealQoo10QsmCreateFulfillmentCapture({
    contract: qoo10QsmCreateFulfillmentCaptureContract,
    collector: qoo10QsmCreateFulfillmentCollector,
    trustBoundary: qoo10QsmCreateFulfillmentTrustBoundary,
    browser: { name: "Chrome", family: "chrome", type: "extension", profileName: "CHANGHEE" },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    authenticatedSellerId: sellerId,
    testItemCode,
    testItemSellerCode: "seller-item-fixture",
    observedAt: new Date().toISOString(),
    dispatchPlaces: [{ id: "dispatch-jp-1", active: true, payload: {
      label: "dispatch", countryCode: "JP", postalCode: "1000001", addressLine1: "Tokyo",
    } }],
    returnPolicies: [{ id: "returns-jp-1", active: true, payload: {
      label: "returns", returnWindowDays: 7, returnShippingPaidBy: "buyer",
    } }],
  });
}

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create schema vault;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, channel text not null, environment text not null,
      version integer not null, vault_secret_id uuid not null, status text not null,
      expires_at timestamptz, created_by uuid not null references auth.users(id)
    );
    create table sellerpilot_private.products(
      id uuid primary key, owner_id uuid not null references auth.users(id),
      demo boolean not null default false, status text not null default 'draft'
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key, owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null, operation text not null, request_fingerprint text not null,
      status text not null, gateway_write_required boolean not null default true,
      pre_gateway_retryable boolean not null default false, http_status integer,
      remote_id text, safe_message text, completed_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),
      attempt_id uuid references sellerpilot_private.channel_operation_attempts(id)
    );
    create table vault.decrypted_secrets(id uuid primary key, decrypted_secret text not null);
    insert into auth.users(id) values ('${productOwnerId}'),('${credentialOwnerId}');
    insert into sellerpilot_private.admin_users(user_id)
      values ('${productOwnerId}'),('${credentialOwnerId}');
    insert into sellerpilot_private.products(id,owner_id,status)
      values ('${productId}','${productOwnerId}','draft');
    insert into vault.decrypted_secrets(id,decrypted_secret)
      values ('${vaultId}','{"seller_id":"${sellerId}","api_key":"not-returned"}');
    insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,status,created_by
    ) values ('${credentialId}','qoo10','production',7,'${vaultId}','active','${credentialOwnerId}');
  `);
  await db.exec(await readFile(baseMigration, "utf8"));
  await db.exec(await readFile(sharedAdminMigration, "utf8"));
  await db.exec("set role service_role");
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  return db;
}

test("blank Qoo10 target binds a shared-admin credential and preserves draft-state CAS", async () => {
  const db = await fixture();
  const value = capture();
  const inserted = await db.query<{ source_id: string }>(`
    select public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,7,'JP','',$4::text,$5::text,
      'dispatch-jp-1','returns-jp-1',$6::text,$7::text,$8::jsonb
    ) as source_id
  `, [productOwnerId, productId, credentialId, sellerId, testItemCode,
    value.sourceRevision, value.captureDigest, JSON.stringify(value)]);
  const sourceId = inserted.rows[0]!.source_id;
  const taken = await db.query<{ source: Record<string, unknown> }>(`
    select public.sellerpilot_service_take_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,7,'JP',''
    ) as source
  `, [productOwnerId, productId, credentialId]);
  assert.equal(taken.rows[0]!.source.targetId, "");
  assert.equal(taken.rows[0]!.source.ownerId, productOwnerId);
  assert.equal(taken.rows[0]!.source.credentialId, credentialId);
  const fenced = await db.query<{ fenced: boolean }>(`
    select public.sellerpilot_service_fence_qoo10_create_now_v3(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,7,$5::text,'JP','',
      $6::text,$7::text,$8::text
    ) as fenced
  `, [sourceId, productOwnerId, productId, credentialId, sellerId,
    value.sourceRevision, value.captureDigest, "e".repeat(64)]);
  assert.equal(fenced.rows[0]!.fenced, true);
  await db.close();
});

test("removing shared credential owner admin status fails closed", async () => {
  const db = await fixture();
  await db.exec("reset role");
  await db.exec(`delete from sellerpilot_private.admin_users where user_id='${credentialOwnerId}'`);
  await db.exec("set role service_role");
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  const value = capture();
  await assert.rejects(() => db.query(`
    select public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,7,'JP','',$4::text,$5::text,
      'dispatch-jp-1','returns-jp-1',$6::text,$7::text,$8::jsonb
    )
  `, [productOwnerId, productId, credentialId, sellerId, testItemCode,
    value.sourceRevision, value.captureDigest, JSON.stringify(value)]),
  /QOO10_CREATE_FULFILLMENT_CREDENTIAL_MISMATCH/u);
  await db.close();
});

test("product status drift after the browser capture fails before the provider fence", async () => {
  const db = await fixture();
  const value = capture();
  const inserted = await db.query<{ source_id: string }>(`
    select public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,7,'JP','',$4::text,$5::text,
      'dispatch-jp-1','returns-jp-1',$6::text,$7::text,$8::jsonb
    ) as source_id
  `, [productOwnerId, productId, credentialId, sellerId, testItemCode,
    value.sourceRevision, value.captureDigest, JSON.stringify(value)]);
  const sourceId = inserted.rows[0]!.source_id;
  await db.query(`
    select public.sellerpilot_service_take_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,7,'JP',''
    )
  `, [productOwnerId, productId, credentialId]);
  await db.exec("reset role");
  await db.query("update sellerpilot_private.products set status='active' where id=$1", [productId]);
  await db.exec("set role service_role");
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  await assert.rejects(() => db.query(`
    select public.sellerpilot_service_fence_qoo10_create_now_v3(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,7,$5::text,'JP','',
      $6::text,$7::text,$8::text
    )
  `, [sourceId, productOwnerId, productId, credentialId, sellerId,
    value.sourceRevision, value.captureDigest, "e".repeat(64)]),
  /QOO10_CREATE_CURRENT_STATE_CAS_REJECTED/u);
  await db.close();
});
