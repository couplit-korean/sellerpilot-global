import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901130000_reconcile_exact_elevenst_manual_live_readback.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const IDS = Object.freeze({
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  product: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listing: "363f3b81-f364-4f22-af4e-4920199904d0",
  attempt: "84957a46-4a90-43bb-a9b6-e4f2be984b58",
  sourceJob: "f7927a29-46b2-4d77-90da-759c79c50bc7",
  credential: "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
  unrelatedListing: "10000000-0000-4000-8000-000000000001",
});
const SELLER_KEY = "e".repeat(64);
const MANIFEST_DIGEST =
  "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62";

async function database({ seed = true, stock = 1, activeJob = false } = {}) {
  const db = new PGlite();
  await db.exec(String.raw`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users (id uuid primary key);
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      sku text not null,
      name text not null,
      on_hand integer not null,
      status text not null,
      detail_page_version bigint not null,
      detail_page_approved_version bigint not null,
      detail_page_image_manifest jsonb not null,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      created_by uuid not null,
      channel text not null,
      environment text not null,
      version integer not null,
      fingerprint text not null,
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
      status text not null,
      http_status integer,
      remote_id text,
      request_fingerprint text,
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
      marketplace_sku text,
      currency text not null,
      price numeric not null,
      status text not null,
      failure_class text,
      requested_publication_intent text not null,
      remote_visibility text not null,
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      published_at timestamptz,
      last_verified_at timestamptz,
      operation_attempt_id uuid,
      seller_account_key text,
      last_error text,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      status text not null,
      attempt_count integer not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb
    );
    create table sellerpilot_private.elevenst_listing_snapshots (
      listing_id uuid primary key,
      credential_id uuid not null,
      seller_account_key text not null,
      remote_id text not null,
      product_payload jsonb not null,
      source_job_id uuid not null,
      source_operation text not null
    );
    create table sellerpilot_private.exact_existing_update_permits (
      permit_id uuid primary key,
      channel text not null,
      listing_id uuid not null,
      invalidated_at timestamptz
    );
    create table sellerpilot_private.listing_publication_reviews (
      listing_id uuid primary key
    );
    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid not null,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      safe_detail jsonb not null
    );

    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
begin
  if nullif(current_setting('sellerpilot.temu_publication_apply', true), '') is not null then
    return new;
  end if;
  if new.status = 'published' then
    raise exception 'terminal provider evidence required';
  end if;
  return new;
end;
    $$;
    create trigger guard_product_listing_seller_lineage
    before update on sellerpilot_private.product_listings
    for each row execute function
      sellerpilot_private.guard_product_listing_seller_lineage();
  `);

  if (!seed) return db;
  const images = Array.from({ length: 8 }, (_, index) => ({
    url: `https://cdn.example.test/approved-${index + 1}.webp`,
  }));
  await db.query("insert into auth.users (id) values ($1)", [IDS.owner]);
  await db.query(
    `insert into sellerpilot_private.products (
       id,owner_id,sku,name,on_hand,status,detail_page_version,
       detail_page_approved_version,detail_page_image_manifest
     ) values ($1,$2,'QA-20260823-CC-001',
       '부착형 케이블 정리 클립 6개 세트',$3,'draft',1,1,$4::jsonb)`,
    [
      IDS.product,
      IDS.owner,
      stock,
      JSON.stringify({
        contract: "sellerpilot_detail_image_manifest_v2",
        digest: MANIFEST_DIGEST,
        images,
      }),
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,created_by,channel,environment,version,fingerprint,status,
       seller_account_key,seller_account_key_source,
       seller_account_verified_at,last_checked_at,last_check_status
     ) values ($1,$2,'elevenst','production',2,'654321FEDCBA','active',
       $3,'credential_incarnation_v1',clock_timestamp(),
       clock_timestamp(),'passed')`,
    [IDS.credential, IDS.owner, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,status,http_status,
       remote_id,request_fingerprint,seller_account_key
     ) values ($1,$2,$3,'elevenst','listing.create','succeeded',200,
       '9573255804',$4,$5)`,
    [
      IDS.attempt,
      IDS.owner,
      IDS.credential,
      "1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af",
      SELLER_KEY,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,market,target_id,
       marketplace_sku,currency,price,status,failure_class,
       requested_publication_intent,remote_visibility,provider_status,
       remote_resources,published_at,last_verified_at,operation_attempt_id,
       seller_account_key,last_error
     ) values (
       $1,$2,$3,'elevenst','9573255804','KR','KR',
       'QA-20260823-CC-001','KRW',5000,'failed','external_action',
       'live','unknown',null,'{}'::jsonb,null,null,$4,$5,
       '기존 원격 상태 확인 필요'
     )`,
    [IDS.listing, IDS.owner, IDS.product, IDS.attempt, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,market,target_id,
       marketplace_sku,currency,price,status,failure_class,
       requested_publication_intent,remote_visibility,remote_resources,
       operation_attempt_id,seller_account_key,last_error
     ) values (
       $1,$2,$3,'smartstore','13671684696','KR','KR',null,
       'KRW',5000,'published',null,'live','live','{}'::jsonb,null,$4,null
     )`,
    [IDS.unrelatedListing, IDS.owner, IDS.product, SELLER_KEY],
  );
  const product = {
    sellerPrdCd: "QA-20260823-CC-001",
    prdNm: "부착형 케이블 정리 클립 6개 세트",
    selPrc: "5000",
    prdSelQty: "1",
  };
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       status,attempt_count,request_payload,response_payload
     ) values ($1,$2,$3,null,'elevenst','listing.create','production',
       'succeeded',1,$4::jsonb,$5::jsonb)`,
    [
      IDS.sourceJob,
      IDS.credential,
      IDS.attempt,
      JSON.stringify({ arguments: { product, verificationOnly: true } }),
      JSON.stringify({ ok: true, remoteId: "9573255804" }),
    ],
  );
  await db.query(
    `insert into sellerpilot_private.elevenst_listing_snapshots (
       listing_id,credential_id,seller_account_key,remote_id,product_payload,
       source_job_id,source_operation
     ) values ($1,$2,$3,'9573255804',$4::jsonb,$5,'listing.create')`,
    [
      IDS.listing,
      IDS.credential,
      SELLER_KEY,
      JSON.stringify(product),
      IDS.sourceJob,
    ],
  );
  if (activeJob) {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         status,attempt_count,request_payload,response_payload
       ) values ('20000000-0000-4000-8000-000000000001',$1,null,$2,
         'elevenst','listing.update','production','queued',0,
         '{"arguments":{"productNo":"9573255804"}}'::jsonb,null)`,
      [IDS.credential, IDS.listing],
    );
  }
  return db;
}

async function exactListing(db) {
  return (await db.query(
    `select status,failure_class,remote_visibility,provider_status,
            remote_resources,published_at,last_verified_at,
            operation_attempt_id,marketplace_sku
       from sellerpilot_private.product_listings where id=$1`,
    [IDS.listing],
  )).rows[0];
}

test("manual 11st reconciliation is exact, provider-call-free, and truthfully counts UI actions", () => {
  for (const value of [
    IDS.product,
    IDS.listing,
    IDS.attempt,
    IDS.sourceJob,
    IDS.credential,
    "9573255804",
    "QA-20260823-CC-001",
    "부착형 케이블 정리 클립 6개 세트",
    MANIFEST_DIGEST,
    "elevenst_seller_office_changhee_browser_verified_v1",
  ]) assert.match(migration, new RegExp(value, "u"));
  assert.match(migration, /'effectiveContentUpdateCount', 1/u);
  assert.match(migration, /'noRemoteEffectUiAttemptCount', 1/u);
  assert.match(migration, /'saleReleaseCount', 1/u);
  assert.match(migration, /'newProductCreated', false/u);
  assert.match(migration, /'exactObservedTimeAvailable', false/u);
  assert.match(migration, /'observedAt', null/u);
  assert.match(migration, /'providerWritePerformedByMigration', false/u);
  assert.match(migration, /'sellerPilotGatewayJobCreated', false/u);
  assert.match(migration, /'sourceAttemptRewritten', false/u);
  assert.match(
    migration,
    /sellerpilot\.qoo10_partial_manual_apply/u,
  );
  assert.doesNotMatch(
    migration,
    /insert into sellerpilot_private\.channel_gateway_jobs/u,
  );
  assert.doesNotMatch(
    migration,
    /insert into sellerpilot_private\.channel_operation_attempts/u,
  );
  assert.doesNotMatch(
    migration,
    /insert into sellerpilot_private\.product_listings/u,
  );
  assert.doesNotMatch(migration, /sellerpilot_service_enqueue/u);
  assert.doesNotMatch(migration, /https?:\/\//u);
});

test("exact browser-verified tuple becomes published with a private receipt and no synthetic attempt", async () => {
  const db = await database();
  try {
    const attemptsBefore = (await db.query(
      "select * from sellerpilot_private.channel_operation_attempts order by id",
    )).rows;
    const jobsBefore = (await db.query(
      "select * from sellerpilot_private.channel_gateway_jobs order by id",
    )).rows;
    const listingsBefore = Number((await db.query(
      "select count(*) as count from sellerpilot_private.product_listings",
    )).rows[0].count);

    await db.exec(migration);

    const listing = await exactListing(db);
    assert.equal(listing.status, "published");
    assert.equal(listing.failure_class, null);
    assert.equal(listing.remote_visibility, "live");
    assert.equal(listing.provider_status, "103");
    assert.equal(listing.operation_attempt_id, IDS.attempt);
    assert.equal(listing.marketplace_sku, "QA-20260823-CC-001");
    assert.ok(listing.published_at);
    assert.equal(listing.last_verified_at.toISOString(), listing.published_at.toISOString());
    assert.equal(
      listing.remote_resources.contract,
      "sellerpilot_manual_remote_readback_v1",
    );
    assert.equal(
      listing.remote_resources.verification.observedAt,
      null,
    );
    assert.equal(
      listing.remote_resources.verification.observationWindow.exactTimeAvailable,
      false,
    );
    assert.equal(listing.remote_resources.verification.detailImageCount, 8);
    assert.equal(
      listing.remote_resources.verification.providerActions
        .effectiveContentUpdateCount,
      1,
    );
    assert.equal(
      listing.remote_resources.verification.providerActions
        .noRemoteEffectUiAttemptCount,
      1,
    );
    assert.equal(
      listing.remote_resources.verification.providerActions.saleReleaseCount,
      1,
    );

    const receipt = (await db.query(
      `select * from sellerpilot_private.elevenst_manual_live_reconciliations
        where listing_id=$1`,
      [IDS.listing],
    )).rows[0];
    assert.equal(receipt.observed_at, null);
    assert.equal(receipt.exact_observed_time_available, false);
    assert.equal(receipt.approved_detail_image_count, 8);
    assert.equal(receipt.effective_content_update_count, 1);
    assert.equal(receipt.no_remote_effect_ui_attempt_count, 1);
    assert.equal(receipt.sale_release_count, 1);
    assert.equal(receipt.new_product_created, false);
    assert.equal(
      receipt.recorded_at.toISOString(),
      listing.last_verified_at.toISOString(),
    );
    assert.equal((await db.query(
      "select status from sellerpilot_private.products where id=$1",
      [IDS.product],
    )).rows[0].status, "active");
    assert.deepEqual((await db.query(
      "select * from sellerpilot_private.channel_operation_attempts order by id",
    )).rows, attemptsBefore);
    assert.deepEqual((await db.query(
      "select * from sellerpilot_private.channel_gateway_jobs order by id",
    )).rows, jobsBefore);
    assert.equal(Number((await db.query(
      "select count(*) as count from sellerpilot_private.product_listings",
    )).rows[0].count), listingsBefore);

    const audit = (await db.query(
      `select safe_detail from sellerpilot_private.operation_audit
        where action='elevenst_exact_manual_live_reconciled'`,
    )).rows[0].safe_detail;
    assert.equal(audit.providerWritePerformedByMigration, false);
    assert.equal(audit.sellerPilotGatewayJobCreated, false);
    assert.equal(audit.sourceAttemptRewritten, false);
    assert.equal(audit.newListingCreated, false);
  } finally {
    await db.close();
  }
});

test("fresh replay creates only private schema and near-miss or active-job tuples fail closed", async () => {
  const fresh = await database({ seed: false });
  try {
    await fresh.exec(migration);
    assert.equal(Number((await fresh.query(
      `select count(*) as count
         from sellerpilot_private.elevenst_manual_live_reconciliations`,
    )).rows[0].count), 0);
  } finally {
    await fresh.close();
  }

  for (const [name, options] of [
    ["stock drift", { stock: 2 }],
    ["active mutation", { activeJob: true }],
  ]) {
    const db = await database(options);
    try {
      await assert.rejects(
        db.exec(migration),
        /exact 11st manual live tuple does not match/u,
        name,
      );
      await db.exec("rollback");
      const listing = await exactListing(db);
      assert.equal(listing.status, "failed");
      assert.equal(listing.remote_visibility, "unknown");
      assert.equal(Number((await db.query(
        `select count(*) as count
           from pg_catalog.pg_tables
          where schemaname='sellerpilot_private'
            and tablename='elevenst_manual_live_reconciliations'`,
      )).rows[0].count), 0);
    } finally {
      await db.close();
    }
  }
});
