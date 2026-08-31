import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831132018_smartstore_exact_qa_recovery_fence.sql",
  import.meta.url,
);

const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const listingId = "7babb554-48dc-4869-81b1-cd4d435d7b96";
const credentialId = "b0000000-0000-4000-8000-000000000001";
const attemptId = "b0000000-0000-4000-8000-000000000002";
const ownerId = "b0000000-0000-4000-8000-000000000003";
const sellerAccountKey =
  "fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8";

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
      marketplace_sku text,
      market text,
      target_id text,
      seller_account_key text,
      status text not null,
      failure_class text,
      requested_publication_intent text,
      remote_visibility text,
      provider_status text,
      published_at timestamptz,
      currency text not null,
      price numeric not null,
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
     values ($1,$2,'QA-20260823-CC-001',false,'draft')`,
    [productId, ownerId],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,marketplace_sku,
       market,target_id,seller_account_key,status,failure_class,
       requested_publication_intent,remote_visibility,provider_status,
       published_at,currency,price,remote_resources
     ) values (
       $1,$2,$3,'smartstore','13671684696',null,'KR','KR',$4,'failed',
       'external_action','live','unknown',null,null,'KRW',5000,'{}'::jsonb
     )`,
    [listingId, ownerId, productId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,channel,status,environment,expires_at,seller_account_key,
       seller_account_key_source,seller_account_verified_at
     ) values (
       $1,'smartstore','active','production',null,$2,
       'credential_incarnation_v1',clock_timestamp()
     )`,
    [credentialId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts
       (id,credential_id,channel,operation,status)
     values ($1,$2,'smartstore','listing.update','running')`,
    [attemptId, credentialId],
  );
  return db;
}

async function identity(db) {
  return (await db.query(
    `select public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
       $1,$2,$3,'KR','KR'
     ) as value`,
    [listingId, credentialId, productId],
  )).rows[0].value;
}

function updatePayload(marker) {
  return {
    arguments: {
      originProductNo: "13671684696",
      body: {
        originProduct: {
          salePrice: 5000,
          stockQuantity: 1,
          detailAttribute: {
            sellerCodeInfo: {
              sellerManagementCode: "QA-20260823-CC-001",
            },
          },
        },
      },
      publicationIntent: "live",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedImageCount: 8,
      sellerpilotSmartstoreExactQaRecovery: marker,
    },
  };
}

test("Smartstore exact QA recovery identity and enqueue are transactionally fenced", async () => {
  const db = await createDatabase();
  try {
    const marker = await identity(db);
    assert.deepEqual(marker, {
      contract: "smartstore_exact_qa_recovery_v1",
      phase: "listing.update",
      productId,
      listingId,
      originProductNo: "13671684696",
      channelProductNo: "13732202182",
      centralSku: "QA-20260823-CC-001",
      sellerManagementCodeSource: "provider_readback_required",
      sellerAccountLineage: "validated_by_service_rpc",
    });
    const accepted = (await db.query(
      `select public.sellerpilot_service_enqueue_listing_gateway_job(
         $1,$2,$3,'smartstore','listing.update',$4::jsonb
       ) as value`,
      [listingId, credentialId, attemptId, JSON.stringify(updatePayload(marker))],
    )).rows[0].value;
    assert.equal(accepted.status, "predecessor_enqueue");

    const forged = structuredClone(updatePayload(marker));
    forged.arguments.sellerpilotSmartstoreExactQaRecovery.channelProductNo =
      "13732202183";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'smartstore','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, attemptId, JSON.stringify(forged)],
      ),
      /SMARTSTORE_EXACT_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    await db.query(
      `update sellerpilot_private.product_listings
          set marketplace_sku='QA-20260823-CC-001' where id=$1`,
      [listingId],
    );
    assert.equal(await identity(db), null);
  } finally {
    await db.close();
  }
});

test("Smartstore exact QA product can never reserve another create", async () => {
  const db = await createDatabase();
  try {
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
           $1,$2,$3,'smartstore','KR','KR','KRW',5000,'fingerprint','{}'::jsonb
         )`,
        [productId, credentialId, attemptId],
      ),
      /SMARTSTORE_EXACT_QA_DUPLICATE_CREATE_FORBIDDEN/,
    );
  } finally {
    await db.close();
  }
});
