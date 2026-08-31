import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831143000_ebay_exact_existing_qa_recovery_fence.sql",
  import.meta.url,
);

const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const listingId = "8b2cbfaf-3854-437d-b381-abfd70291354";
const publicListingId = "800551945442";
const offerId = "244042196011";
const sourceAttemptId = "07b8ced8-fa77-4c22-a708-2ce1ec4e3c77";
const credentialId = "a2593ca0-c2c2-4158-a35b-88aa27b5911a";
const lineageCredentialId = "a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1";
const lineageJobId = "fdff6983-1f08-4f51-a751-bc61b4bf7070";
const lineageAttestationId = "fc54f95c-3533-4dbd-820f-cb2dfaf018e7";
const lineageEvidenceDigest = "3ba3464e14408e04967534e0227f01424378fc8b5b112ea05887769fecff781a";
const updateAttemptId = "e0000000-0000-4000-8000-000000000001";
const ownerId = "e0000000-0000-4000-8000-000000000002";
const sellerAccountKey = "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f";

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
      on_hand integer not null,
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
      provider_resource_id text,
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
      operation_attempt_id uuid,
      remote_resources jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      status text not null,
      environment text not null,
      version integer not null,
      fingerprint text not null,
      expires_at timestamptz,
      last_checked_at timestamptz,
      last_check_status text,
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
      credential_id uuid,
      channel text,
      environment text,
      operation text not null,
      status text not null,
      seller_account_key text
    );
    create table sellerpilot_private.provider_listing_lineage_attestations (
      id uuid primary key,
      listing_id uuid not null unique,
      credential_id uuid not null,
      gateway_job_id uuid not null unique,
      seller_account_key text not null,
      channel text not null,
      environment text not null,
      expected_remote_id text not null,
      verified_remote_id text not null,
      market text not null,
      target_id text not null,
      marketplace_sku text,
      provider_resource_id text,
      evidence_version text not null,
      evidence_digest text not null,
      verified_at timestamptz not null
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
       (id,owner_id,sku,on_hand,demo,status)
     values ($1,$2,'QA-20260823-CC-001',7,false,'ready')`,
    [productId, ownerId],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,marketplace_sku,
       provider_resource_id,market,target_id,seller_account_key,status,
       failure_class,requested_publication_intent,remote_visibility,
       provider_status,published_at,currency,price,operation_attempt_id,
       remote_resources
     ) values (
       $1,$2,$3,'ebay',$4,'QA-20260823-CC-001-US',$5,'US','EBAY_US',
       $6,'failed','external_action','live','unknown',null,null,'USD',12.90,
       $7,'{}'::jsonb
     )`,
    [listingId, ownerId, productId, publicListingId, offerId, sellerAccountKey, sourceAttemptId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,channel,status,environment,version,fingerprint,expires_at,
       last_checked_at,last_check_status,seller_account_key,
       seller_account_key_source,seller_account_verified_at
     ) values (
       $1,'ebay','active','production',92,'B82F3FE28085',
       '2028-02-17T12:00:00Z',clock_timestamp(),'passed',$2,
       'provider_certified_v1',clock_timestamp()
     )`,
    [credentialId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,channel,status,environment,version,fingerprint,expires_at,
       last_checked_at,last_check_status,seller_account_key,
       seller_account_key_source,seller_account_verified_at
     ) values (
       $1,'ebay','revoked','production',84,'A48BC6BD3D4B',null,
       clock_timestamp(),'passed',$2,'provider_certified_v1',clock_timestamp()
     )`,
    [lineageCredentialId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,listing_id,credential_id,channel,environment,operation,status,
       seller_account_key
     ) values (
       $1,$2,$3,'ebay','production','listing.lineage.verify','succeeded',$4
     )`,
    [lineageJobId, listingId, lineageCredentialId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.provider_listing_lineage_attestations (
       id,listing_id,credential_id,gateway_job_id,seller_account_key,channel,
       environment,expected_remote_id,verified_remote_id,market,target_id,
       marketplace_sku,provider_resource_id,evidence_version,evidence_digest,
       verified_at
     ) values (
       $1,$2,$3,$4,$5,'ebay','production',$6,$6,'US','EBAY_US',
       'QA-20260823-CC-001-US',$7,'provider_listing_readback_v1',$8,
       clock_timestamp()
     )`,
    [
      lineageAttestationId,
      listingId,
      lineageCredentialId,
      lineageJobId,
      sellerAccountKey,
      publicListingId,
      offerId,
      lineageEvidenceDigest,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts
       (id,credential_id,channel,operation,status)
     values ($1,$2,'ebay','listing.update','running')`,
    [updateAttemptId, credentialId],
  );
  return db;
}

async function identity(db) {
  return (await db.query(
    `select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
       $1,$2,$3,'US','EBAY_US'
     ) as value`,
    [listingId, credentialId, productId],
  )).rows[0].value;
}

function detailHtml() {
  return `<p>This durable cable organizer keeps charging cords tidy and easy to reach.</p>${Array.from(
    { length: 8 },
    (_, index) => `<img src="https://cdn.example.com/detail-${index + 1}.jpg">`,
  ).join("")}`;
}

function updatePayload(marker) {
  return {
    arguments: {
      listingId: publicListingId,
      sku: "QA-20260823-CC-001-US",
      marketplaceId: "EBAY_US",
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "en-US",
      publicationExpectedImageCount: 8,
      inventoryItem: {
        condition: "NEW",
        availability: { shipToLocationAvailability: { quantity: marker.stock } },
        product: {
          title: "Adhesive Cable Organizer Clips",
          description: detailHtml(),
          imageUrls: ["https://cdn.example.com/main.jpg"],
        },
      },
      offer: {
        availableQuantity: marker.stock,
        listingDescription: detailHtml(),
        pricingSummary: { price: { currency: "USD", value: "12.9" } },
      },
      sellerpilotPublicationAssetBinding: {
        contract: "sellerpilot_publication_asset_binding_v1",
        providerImageSurface: "detail_content",
        approvedDetailImages: Array.from({ length: 8 }, () => ({})),
        providerTransportImages: Array.from({ length: 8 }, () => ({})),
      },
      sellerpilotEbayExactExistingQaRecovery: marker,
    },
  };
}

test("eBay exact existing QA identity and content update enqueue are transactionally fenced", async () => {
  const db = await createDatabase();
  try {
    const marker = await identity(db);
    assert.deepEqual(marker, {
      contract: "ebay_exact_existing_qa_recovery_v2",
      phase: "listing.update",
      productId,
      listingId,
      sourceAttemptId,
      publicListingId,
      market: "US",
      marketplaceId: "EBAY_US",
      marketplaceSku: "QA-20260823-CC-001-US",
      offerId,
      currency: "USD",
      priceUsd: 12.9,
      stock: 7,
      credentialId,
      sellerAccountKey,
      offerIdSource: "immutable_lineage_attestation_v1",
      sellerAccountLineage: "validated_by_service_rpc",
    });
    const accepted = (await db.query(
      `select public.sellerpilot_service_enqueue_listing_gateway_job(
         $1,$2,$3,'ebay','listing.update',$4::jsonb
       ) as value`,
      [listingId, credentialId, updateAttemptId, JSON.stringify(updatePayload(marker))],
    )).rows[0].value;
    assert.equal(accepted.status, "predecessor_enqueue");

    const forgedPrice = structuredClone(updatePayload(marker));
    forgedPrice.arguments.offer.pricingSummary.price.value = "12.91";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(forgedPrice)],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    const forgedBoundOffer = structuredClone(updatePayload(marker));
    forgedBoundOffer.arguments.sellerpilotEbayExactExistingQaRecovery.offerId =
      "244042196012";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(forgedBoundOffer)],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    const missingBoundOffer = structuredClone(updatePayload(marker));
    delete missingBoundOffer.arguments.sellerpilotEbayExactExistingQaRecovery.offerId;
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(missingBoundOffer)],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    const forgedOffer = structuredClone(updatePayload(marker));
    forgedOffer.arguments.offerId = "browser-forged-offer";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(forgedOffer)],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    const missingMarketplace = structuredClone(updatePayload(marker));
    delete missingMarketplace.arguments.marketplaceId;
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(missingMarketplace)],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    const extraGalleryImage = structuredClone(updatePayload(marker));
    extraGalleryImage.arguments.inventoryItem.product.imageUrls.push(
      "https://cdn.example.com/second.jpg",
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(extraGalleryImage)],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    const koreanTitle = structuredClone(updatePayload(marker));
    koreanTitle.arguments.inventoryItem.product.title =
      "부착형 케이블 정리 클립 6개 세트";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(koreanTitle)],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );

    await db.query(
      `update sellerpilot_private.product_listings
          set provider_resource_id=null
        where id=$1`,
      [listingId],
    );
    assert.equal(await identity(db), null);
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
           $1,$2,$3,'ebay','listing.update',$4::jsonb
         )`,
        [listingId, credentialId, updateAttemptId, JSON.stringify(updatePayload(marker))],
      ),
      /EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH/,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set provider_resource_id=$2
        where id=$1`,
      [listingId, offerId],
    );

    await db.query(
      `update sellerpilot_private.provider_listing_lineage_attestations
          set provider_resource_id='244042196012'
        where id=$1`,
      [lineageAttestationId],
    );
    assert.equal(await identity(db), null);
    await db.query(
      `update sellerpilot_private.provider_listing_lineage_attestations
          set provider_resource_id=$2
        where id=$1`,
      [lineageAttestationId, offerId],
    );

    await db.query(
      `update sellerpilot_private.channel_credentials set version=93 where id=$1`,
      [credentialId],
    );
    assert.equal(await identity(db), null);
  } finally {
    await db.close();
  }
});

test("eBay exact existing QA tuple can never reserve a duplicate create", async () => {
  const db = await createDatabase();
  try {
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
           $1,$2,$3,'ebay','US','EBAY_US','USD',12.90,'fingerprint','{}'::jsonb
         )`,
        [productId, credentialId, updateAttemptId],
      ),
      /EBAY_EXACT_EXISTING_QA_DUPLICATE_CREATE_FORBIDDEN/,
    );
  } finally {
    await db.close();
  }
});
