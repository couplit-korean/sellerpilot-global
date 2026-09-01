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
const lifecycleJobId = "94000000-0000-4000-8000-000000000010";
const lifecycleAttemptId = "94000000-0000-4000-8000-000000000011";
const workerTokenId = "94000000-0000-4000-8000-000000000012";
const claimToken = "94000000-0000-4000-8000-000000000013";
const inventoryLifecycleJobId = "94000000-0000-4000-8000-000000000014";
const inventoryLifecycleAttemptId = "94000000-0000-4000-8000-000000000015";
const inventoryClaimToken = "94000000-0000-4000-8000-000000000016";
const sellerKey = "a".repeat(64);
const evidenceDigest = "b".repeat(64);
const releaseSha = "c".repeat(40);
const requestFingerprint = "d".repeat(64);
const inventoryRequestFingerprint = "e".repeat(64);
const providerImageDigest = "f".repeat(64);

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

async function installLifecycleFunctions(db) {
  await db.exec(`
    create function sellerpilot_private.shopee_sg_exact_update_release_is_current(text)
    returns boolean language sql stable security definer set search_path = ''
    as $$ select true $$;
  `);
  for (const signature of [
    "create function sellerpilot_private.shopee_sg_exact_update_lineage_is_current(",
    "create function sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current(",
    "create function sellerpilot_private.bind_shopee_sg_exact_update_claim(",
    "create function sellerpilot_private.shopee_sg_exact_update_provider_allowed(",
    "create function sellerpilot_private.consume_shopee_sg_exact_update_provider(",
    "create function sellerpilot_private.guard_shopee_sg_exact_update_job(",
  ]) {
    await db.exec(extractFunction(migration, signature));
  }
  await db.exec(`
    create constraint trigger guard_shopee_sg_exact_update_job
    after insert or update on sellerpilot_private.channel_gateway_jobs
    deferrable initially deferred
    for each row execute function sellerpilot_private.guard_shopee_sg_exact_update_job();
  `);
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

function inventoryArguments() {
  return {
    sellerpilotShopeeSgExistingUpdate: binding("inventory"),
    shopId: "1719148844",
    country: "sg",
    itemId: "53717126190",
    quantity: 1,
  };
}

function contentResponse() {
  return {
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
          currency: "SGD",
          priceSgd: 16.77,
          providerStatus: "UNLIST",
          visibility: "non_public",
          providerImageIdentityDigest: providerImageDigest,
          representativeImageCount: 1,
          detailImageCount: 8,
          titleLanguageVerified: true,
          descriptionLanguageVerified: true,
        },
      },
    }],
  };
}

function inventoryResponse() {
  return {
    ok: true,
    remoteId: "53717126190",
    steps: [{
      data: {
        sellerpilotShopeeSgExistingReadback: {
          contract: "sellerpilot_shopee_sg_existing_inventory_readback_v1",
          itemId: "53717126190",
          sku: "QA-20260823-CC-001",
          currency: "SGD",
          priceSgd: 16.77,
          stock: 1,
          providerStatus: "UNLIST",
          visibility: "non_public",
          providerImageIdentityDigest: providerImageDigest,
          representativeImageCount: 1,
          detailImageCount: 8,
          titleLanguageVerified: true,
          descriptionLanguageVerified: true,
        },
      },
    }],
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
    create schema extensions;
    create function extensions.digest(value text, algorithm text) returns bytea
      language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8') end
      $$;
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
      seller_account_key text,operation_attempt_id uuid,failure_class text
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,owner_id uuid,credential_id uuid,channel text,operation text,
      status text,seller_account_key text,request_fingerprint text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,attempt_id uuid,listing_id uuid,credential_id uuid,channel text,
      operation text,environment text,status text,attempt_count integer,
      provider_mutation_started_at timestamptz,response_payload jsonb,seller_account_key text,
      request_payload jsonb,request_fingerprint text,worker_token_id uuid,claim_token uuid,
      lease_expires_at timestamptz,completed_at timestamptz,error_message text,
      started_at timestamptz,updated_at timestamptz
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
    "create function sellerpilot_private.shopee_sg_exact_content_receipt_valid(",
    "create function sellerpilot_private.shopee_sg_exact_inventory_receipt_valid(",
    "create function sellerpilot_private.shopee_sg_exact_content_receipt_image_digest(",
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
    `insert into sellerpilot_private.product_listings(
      id,product_id,owner_id,channel_key,remote_id,marketplace_sku,market,target_id,status,
      requested_publication_intent,remote_visibility,provider_status,currency,price,
      published_at,last_verified_at,seller_account_key,operation_attempt_id,failure_class
    ) values(
      $1,$2,$3,'shopee','53717126190','QA-20260823-CC-001','SG','1719148844',
      'paused','safe_test','non_public','UNLIST','SGD',16.77,null,now(),$4,null,null
    )`,
    [listingId, productId, ownerId, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
      id,attempt_id,listing_id,credential_id,channel,operation,environment,status,
      attempt_count,provider_mutation_started_at,response_payload,seller_account_key
    ) values(
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
  assert.match(migration, /shopee_sg_exact_content_receipt_valid/u);
  assert.match(migration, /shopee_sg_exact_inventory_receipt_valid/u);
  assert.match(migration, /listing_mutation_release_gate_is_effective\('shopee'\)/u);
  assert.doesNotMatch(migration, /set_listing_mutation_release_gate/u);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/u);
  const bind = extractFunction(
    migration,
    "create function sellerpilot_private.bind_shopee_sg_exact_update_claim(",
  );
  const provider = extractFunction(
    migration,
    "create function sellerpilot_private.shopee_sg_exact_update_provider_allowed(",
  );
  for (const source of [bind, provider]) {
    assert.match(source, /shopee_sg_exact_update_enqueued_lineage_is_current/u);
    assert.doesNotMatch(
      source,
      /and sellerpilot_private\.shopee_sg_exact_update_lineage_is_current\(/u,
    );
  }
});

test("PGlite preserves exact Shopee lineage across enqueue, claim, and provider allowance", async () => {
  const db = await database();
  try {
    await installLifecycleFunctions(db);
    const argumentsValue = contentArguments();
    const requestPayload = { arguments: argumentsValue };
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts values(
        $1,$2,$3,'shopee','listing.update','running',$4,$5
      )`,
      [lifecycleAttemptId, ownerId, credentialId, sellerKey, requestFingerprint],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,credential_id,channel,operation,environment,status,
        attempt_count,provider_mutation_started_at,response_payload,seller_account_key,
        request_payload,request_fingerprint,worker_token_id,claim_token,lease_expires_at,
        completed_at,error_message,started_at,updated_at
      ) values(
        $1,$2,$3,$4,'shopee','listing.update','production','queued',0,
        null,null,$5,$6::jsonb,$7,null,null,null,null,null,null,now()
      )`,
      [
        lifecycleJobId, lifecycleAttemptId, listingId, credentialId, sellerKey,
        JSON.stringify(requestPayload), requestFingerprint,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.shopee_sg_exact_update_permits(
        phase,listing_id,product_id,credential_id,owner_id,seller_account_key,
        credential_version,credential_fingerprint,credential_verified_at,
        adoption_attestation_id,adoption_gateway_job_id,adoption_evidence_digest,
        item_id,marketplace_sku,merchant_id,shop_id,market,locale,currency,price,
        stock,provider_status,release_sha,request_fingerprint,armed_at,expires_at,
        update_job_id,update_attempt_id,arguments_sha256,request_payload_sha256
      ) select
        'content',$1,$2,$3,$4,$5,101,'ABCDEF123456',credential.seller_account_verified_at,
        $6,$7,$8,'53717126190','QA-20260823-CC-001','5511564','1719148844',
        'SG','en-SG','SGD',16.77,1,'UNLIST',$9,$10,now(),now()+interval '5 minutes',
        job.id,job.attempt_id,
        encode(extensions.digest((job.request_payload->'arguments')::text,'sha256'),'hex'),
        encode(extensions.digest(job.request_payload::text,'sha256'),'hex')
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_credentials credential on credential.id=$3
      where job.id=$11`,
      [
        listingId, productId, credentialId, ownerId, sellerKey, adoptionId,
        adoptionJobId, evidenceDigest, releaseSha, requestFingerprint, lifecycleJobId,
      ],
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set status='queued',operation_attempt_id=$2,failure_class=null
        where id=$1`,
      [listingId, lifecycleAttemptId],
    );

    const permitId = await scalar(
      db,
      "select permit_id from sellerpilot_private.shopee_sg_exact_update_permits where update_job_id=$1",
      [lifecycleJobId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_update_lineage_is_current($1)",
      [permitId],
    ), false, "the pre-enqueue paused predicate must no longer match");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current($1)",
      [permitId],
    ), true, "the immutable queued lineage must remain current");

    const queued = await scalar(
      db,
      "select to_jsonb(job) from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [lifecycleJobId],
    );
    const running = {
      ...queued,
      status: "running",
      attempt_count: 1,
      worker_token_id: workerTokenId,
      claim_token: claimToken,
      lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.bind_shopee_sg_exact_update_claim($1::jsonb,$2::jsonb)",
      [JSON.stringify(queued), JSON.stringify(running)],
    ), true, "the first exact claim must bind while the listing is queued");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='running',attempt_count=1,worker_token_id=$2,claim_token=$3,
              lease_expires_at=now()+interval '5 minutes',started_at=now(),updated_at=now()
        where id=$1`,
      [lifecycleJobId, workerTokenId, claimToken],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_update_provider_allowed($1,$2)",
      [lifecycleJobId, claimToken],
    ), true, "the bound running claim must reach the provider boundary");

    await db.query(
      "update sellerpilot_private.product_listings set price=16.78 where id=$1",
      [listingId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_update_provider_allowed($1,$2)",
      [lifecycleJobId, claimToken],
    ), false, "immutable commerce drift must still fail closed");
    await db.query(
      "update sellerpilot_private.product_listings set price=16.77 where id=$1",
      [listingId],
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set provider_mutation_started_at=now(),updated_at=now()
        where id=$1`,
      [lifecycleJobId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.consume_shopee_sg_exact_update_provider($1,$2)",
      [lifecycleJobId, claimToken],
    ), true, "the exact content permit must be consumed once at provider begin");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',response_payload=$2::jsonb,completed_at=now(),updated_at=now()
        where id=$1`,
      [lifecycleJobId, JSON.stringify(contentResponse())],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_content_succeeded($1,$2,$3)",
      [listingId, credentialId, sellerKey],
    ), true, "content completion must carry the full exact readback receipt");
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set response_payload=jsonb_set(response_payload,
              '{steps,0,data,sellerpilotShopeeSgExistingReadback,priceSgd}',
              '16.78'::jsonb)
          where id=$1`,
        [lifecycleJobId],
      ),
      /Shopee SG exact success readback invalid/u,
    );

    // Listing completion returns the exact non-public item to paused. Resource
    // enqueue does not replace listing.operation_attempt_id or set queued.
    await db.query(
      `update sellerpilot_private.product_listings
          set status='paused',failure_class=null
        where id=$1`,
      [listingId],
    );
    const inventoryArgumentsValue = inventoryArguments();
    const inventoryRequestPayload = { arguments: inventoryArgumentsValue };
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts values(
        $1,$2,$3,'shopee','inventory.update','running',$4,$5
      )`,
      [
        inventoryLifecycleAttemptId, ownerId, credentialId, sellerKey,
        inventoryRequestFingerprint,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,credential_id,channel,operation,environment,status,
        attempt_count,provider_mutation_started_at,response_payload,seller_account_key,
        request_payload,request_fingerprint,worker_token_id,claim_token,lease_expires_at,
        completed_at,error_message,started_at,updated_at
      ) values(
        $1,$2,$3,$4,'shopee','inventory.update','production','queued',0,
        null,null,$5,$6::jsonb,$7,null,null,null,null,null,null,now()
      )`,
      [
        inventoryLifecycleJobId, inventoryLifecycleAttemptId, listingId,
        credentialId, sellerKey, JSON.stringify(inventoryRequestPayload),
        inventoryRequestFingerprint,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.shopee_sg_exact_update_permits(
        phase,listing_id,product_id,credential_id,owner_id,seller_account_key,
        credential_version,credential_fingerprint,credential_verified_at,
        adoption_attestation_id,adoption_gateway_job_id,adoption_evidence_digest,
        item_id,marketplace_sku,merchant_id,shop_id,market,locale,currency,price,
        stock,provider_status,release_sha,request_fingerprint,armed_at,expires_at,
        update_job_id,update_attempt_id,arguments_sha256,request_payload_sha256
      ) select
        'inventory',$1,$2,$3,$4,$5,101,'ABCDEF123456',credential.seller_account_verified_at,
        $6,$7,$8,'53717126190','QA-20260823-CC-001','5511564','1719148844',
        'SG','en-SG','SGD',16.77,1,'UNLIST',$9,$10,now(),now()+interval '5 minutes',
        job.id,job.attempt_id,
        encode(extensions.digest((job.request_payload->'arguments')::text,'sha256'),'hex'),
        encode(extensions.digest(job.request_payload::text,'sha256'),'hex')
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_credentials credential on credential.id=$3
      where job.id=$11`,
      [
        listingId, productId, credentialId, ownerId, sellerKey, adoptionId,
        adoptionJobId, evidenceDigest, releaseSha, inventoryRequestFingerprint,
        inventoryLifecycleJobId,
      ],
    );
    const inventoryPermitId = await scalar(
      db,
      "select permit_id from sellerpilot_private.shopee_sg_exact_update_permits where update_job_id=$1",
      [inventoryLifecycleJobId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current($1)",
      [inventoryPermitId],
    ), true, "inventory must remain claimable while the listing stays paused");
    assert.equal(await scalar(
      db,
      "select operation_attempt_id=$2 from sellerpilot_private.product_listings where id=$1",
      [listingId, lifecycleAttemptId],
    ), true, "resource enqueue must not pretend it replaced the listing attempt");

    const inventoryQueued = await scalar(
      db,
      "select to_jsonb(job) from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [inventoryLifecycleJobId],
    );
    const inventoryRunning = {
      ...inventoryQueued,
      status: "running",
      attempt_count: 1,
      worker_token_id: workerTokenId,
      claim_token: inventoryClaimToken,
      lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.bind_shopee_sg_exact_update_claim($1::jsonb,$2::jsonb)",
      [JSON.stringify(inventoryQueued), JSON.stringify(inventoryRunning)],
    ), true, "the inventory claim must bind without a listing queued transition");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='running',attempt_count=1,worker_token_id=$2,claim_token=$3,
              lease_expires_at=now()+interval '5 minutes',started_at=now(),updated_at=now()
        where id=$1`,
      [inventoryLifecycleJobId, workerTokenId, inventoryClaimToken],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.shopee_sg_exact_update_provider_allowed($1,$2)",
      [inventoryLifecycleJobId, inventoryClaimToken],
    ), true, "inventory must reach the provider boundary only after content receipt success");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set provider_mutation_started_at=now(),updated_at=now()
        where id=$1`,
      [inventoryLifecycleJobId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.consume_shopee_sg_exact_update_provider($1,$2)",
      [inventoryLifecycleJobId, inventoryClaimToken],
    ), true);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',response_payload=$2::jsonb,completed_at=now(),updated_at=now()
        where id=$1`,
      [inventoryLifecycleJobId, JSON.stringify(inventoryResponse())],
    );
    assert.equal(await scalar(
      db,
      `select response_payload#>>'{steps,0,data,sellerpilotShopeeSgExistingReadback,stock}'
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [inventoryLifecycleJobId],
    ), "1");
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set response_payload=jsonb_set(response_payload,
              '{steps,0,data,sellerpilotShopeeSgExistingReadback,providerImageIdentityDigest}',
              to_jsonb($2::text))
          where id=$1`,
        [inventoryLifecycleJobId, "0".repeat(64)],
      ),
      /Shopee SG exact success readback invalid/u,
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set response_payload=jsonb_set(response_payload,
              '{steps,0,data,sellerpilotShopeeSgExistingReadback,detailImageCount}',
              '7'::jsonb)
          where id=$1`,
        [inventoryLifecycleJobId],
      ),
      /Shopee SG exact success readback invalid/u,
    );
  } finally {
    await db.close();
  }
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
    const attackedTopLevel = contentArguments();
    attackedTopLevel.shipping = { enabled: true };
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.shopee_sg_exact_update_arguments_valid(
        $1::jsonb,'content',$2,$3,$4,$5,16.77
      )`,
      [JSON.stringify(attackedTopLevel), releaseSha, requestFingerprint, listingId, credentialId],
    ), false);

    const response = contentResponse();
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,credential_id,channel,operation,environment,status,
        attempt_count,provider_mutation_started_at,response_payload,seller_account_key
      ) values(
        $1,$2,$3,$4,'shopee','listing.update','production','succeeded',1,
        now(),$5::jsonb,$6
      )`,
      [contentJobId, contentAttemptId, listingId, credentialId, JSON.stringify(response), sellerKey],
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
