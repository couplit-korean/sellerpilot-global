import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901173970_allow_exact_shopee_sg_existing_updates.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const ownerId = "94000000-0000-4000-8000-000000000001";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const listingId = "94000000-0000-4000-8000-000000000002";
const credentialId = "94000000-0000-4000-8000-000000000003";
const vaultId = "94000000-0000-4000-8000-000000000004";
const adoptionId = "94000000-0000-4000-8000-000000000005";
const adoptionJobId = "94000000-0000-4000-8000-000000000006";
const contentJobId = "94000000-0000-4000-8000-000000000007";
const contentAttemptId = "94000000-0000-4000-8000-000000000008";
const sellerKey = "a".repeat(64);
const evidenceDigest = "b".repeat(64);
const releaseSha = "c".repeat(40);
const requestFingerprint = "d".repeat(64);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${signature} body must exist`);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + 3);
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

function binding(phase) {
  return {
    contract: "sellerpilot_shopee_sg_existing_update_v1",
    phase,
    listingId,
    productId,
    credentialId,
    sellerAccountKey: sellerKey,
    itemId: "53717126190",
    sku: "QA-20260823-CC-001",
    merchantId: "5511564",
    shopId: "1719148844",
    market: "SG",
    locale: "en-SG",
    currency: "SGD",
    priceSgd: 16.77,
    stock: 1,
    providerStatus: "UNLIST",
    adoptionAttestationId: adoptionId,
    adoptionGatewayJobId: adoptionJobId,
    adoptionEvidenceDigest: evidenceDigest,
    releaseSha,
  };
}

function contentArguments() {
  const imageUrls = Array.from(
    { length: 9 },
    (_, index) => `https://sellerpilot.example/images/${index + 1}.jpg`,
  );
  return {
    sellerpilotShopeeSgExistingUpdate: binding("content"),
    localItemId: "53717126190",
    shopId: "1719148844",
    country: "sg",
    body: {
      item_id: 53717126190,
      item_name: "Reusable Cable Organizer Clips for Home and Office",
      description: "Keep charging cables neatly organized with durable reusable clips for desks, offices, and travel.",
    },
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "en-SG",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: requestFingerprint,
    imageUrls,
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      providerImageSurface: "buyer_visible",
      providerTransportImages: imageUrls.slice(1).map((publicUrl) => ({ publicUrl })),
    },
  };
}

async function database() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
    create schema auth;
    create table auth.users(id uuid primary key);
    create schema vault;
    create table vault.secrets(id uuid primary key,secret text not null);
    create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets;
    create schema sellerpilot_private;
    create table sellerpilot_private.products(
      id uuid primary key,owner_id uuid not null,sku text not null,on_hand integer not null,
      demo boolean not null,status text not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text not null,environment text not null,status text not null,
      version integer not null,fingerprint text not null,vault_secret_id uuid not null,
      expires_at timestamptz,seller_account_key text,seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,product_id uuid not null,owner_id uuid not null,channel_key text not null,
      remote_id text,marketplace_sku text,market text,target_id text,status text,
      requested_publication_intent text,remote_visibility text,provider_status text,
      currency text,price numeric,published_at timestamptz,last_verified_at timestamptz,
      seller_account_key text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,attempt_id uuid,listing_id uuid,credential_id uuid,channel text,
      operation text,environment text,status text,attempt_count integer,
      provider_mutation_started_at timestamptz,response_payload jsonb,seller_account_key text
    );
    create table sellerpilot_private.shopee_existing_adoption_attestations(
      id uuid primary key,listing_id uuid,product_id uuid,owner_id uuid,credential_id uuid,
      gateway_job_id uuid,seller_account_key text,remote_id text,marketplace_sku text,
      merchant_id text,shop_id text,market text,locale text,currency text,price numeric,
      provider_status text,detail_image_count integer,evidence_digest text
    );
    create table sellerpilot_private.provider_listing_lineage_attestations(
      id uuid primary key default gen_random_uuid(),listing_id uuid,gateway_job_id uuid,
      credential_id uuid,seller_account_key text
    );
    create table sellerpilot_private.shopee_sg_exact_update_permits(
      permit_id uuid primary key default gen_random_uuid(),phase text,listing_id uuid,
      product_id uuid,credential_id uuid,owner_id uuid,seller_account_key text,
      credential_version integer,credential_fingerprint text,credential_verified_at timestamptz,
      adoption_attestation_id uuid,adoption_gateway_job_id uuid,adoption_evidence_digest text,
      item_id text,marketplace_sku text,merchant_id text,shop_id text,market text,locale text,
      currency text,price numeric,stock integer,provider_status text,release_sha text,
      request_fingerprint text,armed_at timestamptz,expires_at timestamptz,
      update_job_id uuid,update_attempt_id uuid,arguments_sha256 text,
      request_payload_sha256 text,bound_at timestamptz,bound_worker_token_id uuid,
      bound_claim_token uuid,consumed_at timestamptz,invalidated_at timestamptz,
      invalidation_reason text
    );
  `);
  for (const signature of [
    "create function sellerpilot_private.shopee_sg_exact_update_credential_allowed(",
    "create function sellerpilot_private.shopee_sg_exact_content_succeeded(",
    "create function sellerpilot_private.shopee_sg_exact_update_identity_json(",
    "create function public.sellerpilot_service_get_shopee_sg_exact_update_identity(",
    "create function sellerpilot_private.shopee_sg_exact_update_arguments_valid(",
  ]) {
    await db.exec(extractFunction(migration, signature));
  }
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const secret = {
    partner_id: "2031489",
    provider_account_identity_version: "v1",
    provider_account_subject: "shopee:main:4940266",
    authorization_expires_at: future,
    merchant_id: "5511564",
    shopee_targets: [
      { type: "merchant", id: "5511564" },
      {
        type: "shop",
        id: "1719148844",
        access_token: "fresh-access-token",
        access_token_expires_at: future,
      },
    ],
  };
  await db.query("insert into auth.users values($1)", [ownerId]);
  await db.query("insert into vault.secrets values($1,$2)", [vaultId, JSON.stringify(secret)]);
  await db.query(
    `insert into sellerpilot_private.products values($1,$2,'QA-20260823-CC-001',1,false,'active')`,
    [productId, ownerId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials values(
      $1,'shopee','production','active',101,'ABCDEF123456',$2,
      now()+interval '1 day',$3,'provider_certified_v1',now()
    )`,
    [credentialId, vaultId, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings values(
      $1,$2,$3,'shopee','53717126190','QA-20260823-CC-001','SG','1719148844',
      'paused','safe_test','non_public','UNLIST','SGD',16.77,null,now(),$4
    )`,
    [listingId, productId, ownerId, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs values(
      $1,null,$2,$3,'shopee','listing.lineage.verify','production','succeeded',1,
      null,'{}'::jsonb,$4
    )`,
    [adoptionJobId, listingId, credentialId, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.shopee_existing_adoption_attestations values(
      $1,$2,$3,$4,$5,$6,$7,'53717126190','QA-20260823-CC-001','5511564',
      '1719148844','SG','en-SG','SGD',16.77,'UNLIST',8,$8
    )`,
    [adoptionId, listingId, productId, ownerId, credentialId, adoptionJobId, sellerKey, evidenceDigest],
  );
  await db.query(
    `insert into sellerpilot_private.provider_listing_lineage_attestations(
      listing_id,gateway_job_id,credential_id,seller_account_key
    ) values($1,$2,$3,$4)`,
    [listingId, adoptionJobId, credentialId, sellerKey],
  );
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  return db;
}

test("Shopee SG exact update migration is ordered after adoption and never opens the global gate", () => {
  assert.equal(
    migrationUrl.pathname.endsWith("20260901173970_allow_exact_shopee_sg_existing_updates.sql"),
    true,
  );
  assert.match(migration, /shopee_sg_exact_update_permits/u);
  assert.match(migration, /interval '5 minutes'/u);
  assert.match(migration, /listing_mutation_release_gate_is_effective\('shopee'\)/u);
  assert.doesNotMatch(migration, /set_listing_mutation_release_gate/u);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/u);
});

test("PGlite allows content only for fresh already-bound lineage and inventory only after exact content readback", async () => {
  const db = await database();
  try {
    const contentIdentity = await scalar(
      db,
      "select public.sellerpilot_service_get_shopee_sg_exact_update_identity($1,$2,$3,'SG','1719148844','content')",
      [listingId, credentialId, productId],
    );
    assert.equal(contentIdentity.status, "allowed");
    assert.equal(contentIdentity.phase, "content");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_get_shopee_sg_exact_update_identity($1,$2,$3,'SG','1719148844','inventory') is null",
      [listingId, credentialId, productId],
    ), true);

    assert.equal(await scalar(
      db,
      `select sellerpilot_private.shopee_sg_exact_update_arguments_valid(
        $1::jsonb,'content',$2,$3,$4,$5,16.77
      )`,
      [JSON.stringify(contentArguments()), releaseSha, requestFingerprint, listingId, credentialId],
    ), true);
    const attackedContent = contentArguments();
    attackedContent.body.item_status = "NORMAL";
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.shopee_sg_exact_update_arguments_valid(
        $1::jsonb,'content',$2,$3,$4,$5,16.77
      )`,
      [JSON.stringify(attackedContent), releaseSha, requestFingerprint, listingId, credentialId],
    ), false);

    const contentResponse = {
      ok: true,
      remoteId: "53717126190",
      publicationFulfilled: true,
      remoteState: {
        visibility: "non_public",
        providerStatus: "UNLIST",
        locale: "en-SG",
        imageCount: 8,
      },
      steps: [{
        data: {
          sellerpilotShopeeSgExistingReadback: {
            contract: "sellerpilot_shopee_sg_existing_content_readback_v1",
            itemId: "53717126190",
            sku: "QA-20260823-CC-001",
            providerStatus: "UNLIST",
            detailImageCount: 8,
          },
        },
      }],
    };
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs values(
        $1,$2,$3,$4,'shopee','listing.update','production','succeeded',1,
        now(),$5::jsonb,$6
      )`,
      [contentJobId, contentAttemptId, listingId, credentialId, JSON.stringify(contentResponse), sellerKey],
    );
    await db.query(
      `insert into sellerpilot_private.shopee_sg_exact_update_permits(
        phase,listing_id,product_id,credential_id,owner_id,seller_account_key,
        credential_version,credential_fingerprint,credential_verified_at,
        adoption_attestation_id,adoption_gateway_job_id,adoption_evidence_digest,
        item_id,marketplace_sku,merchant_id,shop_id,market,locale,currency,price,
        stock,provider_status,release_sha,request_fingerprint,armed_at,expires_at,
        update_job_id,update_attempt_id,arguments_sha256,request_payload_sha256,
        bound_at,bound_claim_token,consumed_at
      ) values(
        'content',$1,$2,$3,$4,$5,101,'ABCDEF123456',now(),$6,$7,$8,
        '53717126190','QA-20260823-CC-001','5511564','1719148844','SG','en-SG',
        'SGD',16.77,1,'UNLIST',$9,$10,now()-interval '1 minute',now()+interval '4 minutes',
        $11,$12,$13,$14,now()-interval '30 seconds',$15,now()-interval '20 seconds'
      )`,
      [
        listingId, productId, credentialId, ownerId, sellerKey, adoptionId,
        adoptionJobId, evidenceDigest, releaseSha, requestFingerprint,
        contentJobId, contentAttemptId, "e".repeat(64), "f".repeat(64),
        "94000000-0000-4000-8000-000000000009",
      ],
    );
    const inventoryIdentity = await scalar(
      db,
      "select public.sellerpilot_service_get_shopee_sg_exact_update_identity($1,$2,$3,'SG','1719148844','inventory')",
      [listingId, credentialId, productId],
    );
    assert.equal(inventoryIdentity.status, "allowed");
    assert.equal(inventoryIdentity.phase, "inventory");

    const inventory = {
      sellerpilotShopeeSgExistingUpdate: binding("inventory"),
      shopId: "1719148844",
      country: "sg",
      itemId: "53717126190",
      quantity: 1,
    };
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.shopee_sg_exact_update_arguments_valid(
        $1::jsonb,'inventory',$2,$3,$4,$5,16.77
      )`,
      [JSON.stringify(inventory), releaseSha, requestFingerprint, listingId, credentialId],
    ), true);
    inventory.quantity = 2;
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.shopee_sg_exact_update_arguments_valid(
        $1::jsonb,'inventory',$2,$3,$4,$5,16.77
      )`,
      [JSON.stringify(inventory), releaseSha, requestFingerprint, listingId, credentialId],
    ), false);

    await db.query(
      `update vault.secrets set secret = jsonb_set(secret::jsonb,
        '{shopee_targets,1,access_token_expires_at}',
        to_jsonb((now()-interval '1 minute')::text))::text where id=$1`,
      [vaultId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_update_credential_allowed($1)",
      [credentialId],
    ), false);
  } finally {
    await db.close();
  }
});
