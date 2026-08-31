import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831140000_coupang_exact_qa_recovery_fence.sql",
  import.meta.url,
);

const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const listingId = "7ffc6e46-3173-4695-9889-5fa1529765f1";
const credentialId = "c0000000-0000-4000-8000-000000000001";
const updateAttemptId = "c0000000-0000-4000-8000-000000000002";
const stopAttemptId = "c0000000-0000-4000-8000-000000000003";
const ownerId = "c0000000-0000-4000-8000-000000000004";
const sellerAccountKey = "a".repeat(64);

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
    create schema sellerpilot_private;
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      sku text not null,
      demo boolean not null default false,
      status text not null
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      remote_id text,
      market text,
      target_id text,
      seller_account_key text,
      status text not null,
      failure_class text,
      requested_publication_intent text,
      remote_visibility text,
      provider_status text,
      published_at timestamptz,
      remote_resources jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      status text not null,
      environment text not null,
      expires_at timestamptz,
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      listing_id uuid,
      operation text not null,
      status text not null
    );
    create function public.sellerpilot_service_reserve_and_enqueue_listing_create(
      uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
    ) returns jsonb language sql set search_path='' as $$
      select '{"status":"predecessor_create"}'::jsonb
    $$;
    create function public.sellerpilot_service_enqueue_listing_gateway_job(
      uuid, uuid, uuid, text, text, jsonb
    ) returns jsonb language sql set search_path='' as $$
      select '{"status":"predecessor_enqueue"}'::jsonb
    $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.query(
    `insert into sellerpilot_private.products
       (id,owner_id,sku,demo,status)
     values ($1,$2,'QA-20260823-CC-001',false,'ready')`,
    [productId, ownerId],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,market,target_id,
       seller_account_key,status,failure_class,requested_publication_intent,
       remote_visibility,provider_status,published_at,remote_resources
     ) values (
       $1,$2,$3,'coupang','16356981734','KR','KR',$4,'failed',
       'external_action','live','unknown',null,null,'{}'::jsonb
     )`,
    [listingId, ownerId, productId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,channel,status,environment,expires_at,seller_account_key,
       seller_account_key_source,seller_account_verified_at
     ) values (
       $1,'coupang','active','production',null,$2,
       'credential_incarnation_v1',clock_timestamp()
     )`,
    [credentialId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts
       (id,credential_id,channel,operation,status)
     values ($1,$2,'coupang','listing.update','running'),
            ($3,$2,'coupang','listing.stop','running')`,
    [updateAttemptId, credentialId, stopAttemptId],
  );
  return db;
}

async function identity(db, phase) {
  return (await db.query(
    `select public.sellerpilot_service_get_coupang_exact_qa_recovery_identity(
       $1,$2,$3,'KR','KR',$4
     ) as value`,
    [listingId, credentialId, productId, phase],
  )).rows[0].value;
}

function updatePayload(marker) {
  return {
    arguments: {
      body: { sellerProductId: 16356981734 },
      publicationIntent: "live",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedImageCount: 8,
      sellerpilotCoupangExactQaRecovery: marker,
    },
  };
}

test("Coupang exact QA recovery identity and enqueue are transactionally fenced", async () => {
  const db = await createDatabase();
  try {
    const marker = await identity(db, "listing.update");
    assert.deepEqual(marker, {
      contract: "coupang_exact_qa_recovery_v1",
      phase: "listing.update",
      productId,
      listingId,
      sellerProductId: "16356981734",
      vendorItemId: "95962393877",
      sellerSku: "QA-20260823-CC-001",
      sellerAccountLineage: "validated_by_service_rpc",
    });
    const accepted = (await db.query(
      `select public.sellerpilot_service_enqueue_listing_gateway_job(
         $1,$2,$3,'coupang','listing.update',$4::jsonb
       ) as value`,
      [listingId, credentialId, updateAttemptId, JSON.stringify(updatePayload(marker))],
    )).rows[0].value;
    assert.equal(accepted.status, "predecessor_enqueue");

    const forged = structuredClone(updatePayload(marker));
    forged.arguments.sellerpilotCoupangExactQaRecovery.vendorItemId = "95962393878";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'coupang','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(forged)],
      ),
      /COUPANG_EXACT_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    await db.query(
      `update sellerpilot_private.channel_credentials
          set seller_account_key=$1 where id=$2`,
      ["b".repeat(64), credentialId],
    );
    assert.equal(await identity(db, "listing.update"), null);
  } finally {
    await db.close();
  }
});

test("Coupang exact QA product can never reserve another create", async () => {
  const db = await createDatabase();
  try {
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
           $1,$2,$3,'coupang','KR','KR','KRW',10000,'fingerprint','{}'::jsonb
         )`,
        [productId, credentialId, updateAttemptId],
      ),
      /COUPANG_EXACT_QA_DUPLICATE_CREATE_FORBIDDEN/,
    );
  } finally {
    await db.close();
  }
});

test("Coupang exact QA stop binds one published remote item and zero images", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `update sellerpilot_private.product_listings
          set status='published',failure_class=null,remote_visibility='live',
              published_at=clock_timestamp(),
              remote_resources='{"vendorItemIds":["95962393877"]}'::jsonb
        where id=$1`,
      [listingId],
    );
    const marker = await identity(db, "listing.stop");
    assert.equal(marker.phase, "listing.stop");
    const payload = {
      arguments: {
        sellerProductId: "16356981734",
        vendorItemId: "95962393877",
        sellerSku: "QA-20260823-CC-001",
        publicationExpectedImageCount: 0,
        sellerpilotCoupangExactQaRecovery: marker,
      },
    };
    const accepted = (await db.query(
      `select public.sellerpilot_service_enqueue_listing_gateway_job(
         $1,$2,$3,'coupang','listing.stop',$4::jsonb
       ) as value`,
      [listingId, credentialId, stopAttemptId, JSON.stringify(payload)],
    )).rows[0].value;
    assert.equal(accepted.status, "predecessor_enqueue");
  } finally {
    await db.close();
  }
});
