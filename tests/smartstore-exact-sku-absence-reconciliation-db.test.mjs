import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const sourceJobId = "50a1e9e3-8c15-4a21-b2f3-7b00490c6408";
const attemptId = "25aafa20-708e-4acb-8a83-372dcefcd966";
const listingId = "043ccf5a-ca7a-4f89-8add-15de541287b1";
const productId = "c0bdb493-6447-41bf-af0a-46a3da7a75a8";
const credentialId = "2aa76829-3d63-4842-9c3e-622acd3d0d2f";
const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const issuerId = "21eb1892-0894-4f9f-b414-4c9464182dd6";
const accountKey = "a".repeat(64);
const requestFingerprint = "29f6ac10bef3599f3cb9de20d593a600235848b97478a96edc1a1012083ed11f";
const bodyBindingSha256 = "d39ccd5c2b192a8322c6f2e749bfb347a1b0f8317db567bd6c9061870032702a";
const errorMessage = "Gateway write lease expired; provider outcome requires reconciliation.";

const migrationSource = await readFile(new URL(
  "../supabase/migrations/20260914181000_smartstore_exact_sku_absence_reconciliation.sql",
  import.meta.url,
), "utf8");

async function setup({ ebayApplied = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create function extensions.digest(text,text) returns bytea
      language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.products(
      id uuid primary key,owner_id uuid,sku text,status text,updated_at timestamptz,
      detail_page_version integer,detail_page_approved_version integer
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid,channel text,environment text,status text,
      expires_at timestamptz,version integer,fingerprint text,vault_secret_id uuid,
      last_rotated_at timestamptz,seller_account_key_source text,
      seller_account_verified_at timestamptz,seller_account_key text
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,owner_id uuid,channel text,operation text,status text,
      http_status integer,credential_id uuid,seller_account_key text,
      request_fingerprint text,completed_at timestamptz,safe_message text
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,owner_id uuid,product_id uuid,channel_key text,
      operation_attempt_id uuid,status text,failure_class text,remote_id text,
      seller_account_key text,last_error text,updated_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,created_by uuid,channel text,operation text,environment text,
      status text,listing_id uuid,attempt_id uuid,credential_id uuid,
      seller_account_key text,request_fingerprint text,request_payload jsonb,
      provider_mutation_started_at timestamptz,completed_at timestamptz,
      response_payload jsonb,error_message text,worker_token_id uuid,
      claim_token uuid,lease_expires_at timestamptz
    );
    create table sellerpilot_private.smartstore_create_final_transports(
      job_id uuid primary key
    );
    create function sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb(uuid)
    returns boolean language sql stable security definer set search_path='' as
    $$select false$$;
    create function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
    returns boolean language sql stable security definer set search_path='' as
    $$select sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb($1)$$;
  `);
  if (ebayApplied) {
    await db.exec(`
      alter function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
        rename to listing_mutation_reconciliation_resolved_before_ebay_narangd_repair;
      create function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
      returns boolean language sql stable security definer set search_path='' as
      $$select sellerpilot_private.listing_mutation_reconciliation_resolved_before_ebay_narangd_repair($1) or false$$;
    `);
  }
  const payload = {
    arguments: {
      sellerpilotSmartstoreCreateSource: {
        bodyBindingSha256,
        sellerManagementCode: "AUTO-00BF58A2E8434FF09667",
      },
    },
  };
  await db.query("insert into auth.users values($1),($2)", [ownerId, issuerId]);
  await db.query(`insert into sellerpilot_private.products values(
    $1,$2,'AUTO-00BF58A2E8434FF09667','draft',
    '2026-09-14 07:14:19.228067+00',1,1
  )`, [productId, ownerId]);
  await db.query(`insert into sellerpilot_private.channel_credentials values(
    $1,$2,'smartstore','production','active',null,1,'3F7B781CA280',
    'ad060001-136a-474f-a371-fb5239239f06',
    '2026-08-18 00:36:54.926455+00','credential_incarnation_v1',
    '2026-08-25 11:40:32.606508+00',$3
  )`, [credentialId, issuerId, accountKey]);
  await db.query(`insert into sellerpilot_private.channel_operation_attempts values(
    $1,$2,'smartstore','listing.create','manual_required',409,$3,$4,$5,
    '2026-09-14 06:58:58.724917+00',$6
  )`, [attemptId, ownerId, credentialId, accountKey, requestFingerprint, errorMessage]);
  await db.query(`insert into sellerpilot_private.product_listings values(
    $1,$2,$3,'smartstore',$4,'failed','external_action',null,null,$5,
    '2026-09-14 06:58:58.724917+00'
  )`, [listingId, ownerId, productId, attemptId, errorMessage]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values(
    $1,$2,'smartstore','listing.create','production','reconciliation_required',
    $3,$4,$5,$6,$7,$8,'2026-09-14 06:41:11.085299+00',
    '2026-09-14 06:58:58.724917+00',null,$9,null,null,null
  )`, [sourceJobId, issuerId, listingId, attemptId, credentialId, accountKey,
    requestFingerprint, JSON.stringify(payload), errorMessage]);
  const requestSha256 = (await db.query(`select encode(
    extensions.digest(request_payload::text,'sha256'),'hex'
  ) value from sellerpilot_private.channel_gateway_jobs where id=$1`, [sourceJobId])).rows[0].value;
  const accountSha256 = (await db.query(
    "select encode(extensions.digest($1::text,'sha256'),'hex') value", [accountKey],
  )).rows[0].value;
  const topMd5 = (await db.query(`select md5(prosrc) value from pg_proc
    where oid='sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure`)).rows[0].value;
  const preEbayMd5 = ebayApplied
    ? (await db.query(`select md5(prosrc) value from pg_proc
      where oid='sellerpilot_private.listing_mutation_reconciliation_resolved_before_ebay_narangd_re(uuid)'::regprocedure`)).rows[0].value
    : topMd5;
  const lowerMd5 = (await db.query(`select md5(prosrc) value from pg_proc
    where oid='sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb(uuid)'::regprocedure`)).rows[0].value;
  const sql = migrationSource
    .replaceAll("36929a92795ac77eac6984c76fa762de", preEbayMd5)
    .replaceAll("079423399e92fc93245b4163fd5063d2", topMd5)
    .replaceAll("c000072cb34fae737de357cabda57b1c", lowerMd5)
    .replaceAll("5902d55d44e23c3fb6f35e69bb3f451c8c24454aa175a3b2fbed33b24204d507", requestSha256)
    .replaceAll("eea02ee8ff761aa52d68379530df56a73a0eee71b31ce9b233409c8021bd6c3b", accountSha256);
  return { db, sql, topMd5 };
}

test("181000 records one exact immutable zero-match receipt without rewriting the incident", async () => {
  const { db, sql, topMd5 } = await setup();
  try {
    const before = (await db.query(`select to_jsonb(job) value
      from sellerpilot_private.channel_gateway_jobs job where id=$1`, [sourceJobId])).rows[0].value;
    await db.exec(sql);
    const after = (await db.query(`select to_jsonb(job) value
      from sellerpilot_private.channel_gateway_jobs job where id=$1`, [sourceJobId])).rows[0].value;
    assert.deepEqual(after, before);
    assert.equal((await db.query(`select count(*)::integer value
      from sellerpilot_private.smartstore_create_absence_receipts`)).rows[0].value, 1);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) value`,
      [sourceJobId])).rows[0].value, true);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved(gen_random_uuid()) value`)).rows[0].value, false);
    assert.equal((await db.query(`select md5(prosrc) value from pg_proc
      where oid='sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure`)).rows[0].value, topMd5);
    await assert.rejects(db.exec(`update sellerpilot_private.smartstore_create_absence_receipts
      set exact_absence_verified=false`), /SMARTSTORE_CREATE_ABSENCE_RECEIPT_IMMUTABLE/u);
    await assert.rejects(db.exec(`delete from sellerpilot_private.smartstore_create_absence_receipts`),
      /SMARTSTORE_CREATE_ABSENCE_RECEIPT_IMMUTABLE/u);
  } finally {
    await db.close();
  }
});

test("181000 resolution survives a fresh local listing and publication but fails on historical or seller drift", async () => {
  const { db, sql } = await setup();
  try {
    await db.exec(sql);
    await db.exec(`update sellerpilot_private.product_listings
      set status='queued',operation_attempt_id=gen_random_uuid(),seller_account_key='${accountKey}'
      where id='${listingId}'`);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) value`,
      [sourceJobId])).rows[0].value, true);

    await db.exec(`update sellerpilot_private.product_listings
      set status='published',remote_id='13749310594' where id='${listingId}';
      update sellerpilot_private.channel_credentials
      set status='revoked',version=2,fingerprint='AAAAAAAAAAAA',expires_at=clock_timestamp();`);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) value`,
      [sourceJobId])).rows[0].value, true);

    await db.exec("update sellerpilot_private.channel_credentials set seller_account_key=repeat('b',64)");
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) value`,
      [sourceJobId])).rows[0].value, false);
    await db.exec(`update sellerpilot_private.channel_credentials
      set seller_account_key='${accountKey}'`);
    await db.exec("update sellerpilot_private.channel_gateway_jobs set response_payload='{}'::jsonb");
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) value`,
      [sourceJobId])).rows[0].value, false);
  } finally {
    await db.close();
  }
});

test("181000 preserves and composes with an already-applied eBay 182000 resolver", async () => {
  const { db, sql, topMd5 } = await setup({ ebayApplied: true });
  try {
    await db.exec(sql);
    assert.equal((await db.query(`select md5(prosrc) value from pg_proc
      where oid='sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure`)).rows[0].value, topMd5);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) value`,
      [sourceJobId])).rows[0].value, true);
  } finally {
    await db.close();
  }
});

test("181000 exact preimage rejects source, ownership, transport, and state ambiguity", async () => {
  const cases = [
    ["different source request", "update sellerpilot_private.channel_gateway_jobs set request_payload='{}'"],
    ["wrong job state", "update sellerpilot_private.channel_gateway_jobs set status='failed'"],
    ["response already present", "update sellerpilot_private.channel_gateway_jobs set response_payload='{}'"],
    ["final transport exists", `insert into sellerpilot_private.smartstore_create_final_transports values('${sourceJobId}')`],
    ["attempt owner drift", "update sellerpilot_private.channel_operation_attempts set owner_id=gen_random_uuid()"],
    ["attempt status drift", "update sellerpilot_private.channel_operation_attempts set status='failed'"],
    ["listing remote exists", "update sellerpilot_private.product_listings set remote_id='999999999'"],
    ["listing seller identity invented", `update sellerpilot_private.product_listings set seller_account_key='${accountKey}'`],
    ["credential not active", "update sellerpilot_private.channel_credentials set status='revoked'"],
    ["credential incarnation drift", "update sellerpilot_private.channel_credentials set version=2"],
  ];
  for (const [name, mutation] of cases) {
    const { db, sql } = await setup();
    try {
      await db.exec(mutation);
      await assert.rejects(db.exec(sql), /SMARTSTORE_EXACT_SKU_ABSENCE_SOURCE_DRIFT/u, name);
    } finally {
      await db.close();
    }
  }
});

test("181000 embeds the exact private provider proof and composes before eBay 182000", () => {
  assert.match(migrationSource, /AUTO-00BF58A2E8434FF09667/u);
  assert.match(migrationSource, /36c268827ab59a8962ec48f9d21d2e31315c33eab7f4f4ed52aeb27770929958/u);
  assert.match(migrationSource, /011b8c67dff24a1a7a08914f9528bf244cd0223db72f3104098da5c25daf97df/u);
  assert.match(migrationSource, /0936984c80715e0d772ef17b72cb7e9586be6a90f43f28c3a75e0c92c1dd0a3d/u);
  assert.match(migrationSource, /contents\s*"\s*:\s*\[\]/u);
  assert.match(migrationSource, /totalElements\s*"\s*:\s*0/u);
  assert.match(migrationSource, /first\s*"\s*:\s*true/u);
  assert.match(migrationSource, /last\s*"\s*:\s*true/u);
  assert.doesNotMatch(migrationSource,
    /alter function sellerpilot_private\.listing_mutation_reconciliation_resolved\(uuid\)/u);
  assert.match(migrationSource, /TOP_RESOLVER_CHANGED/u);
});
