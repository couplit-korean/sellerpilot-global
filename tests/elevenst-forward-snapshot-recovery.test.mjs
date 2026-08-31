import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationName =
  "20260901044230_recover_exact_elevenst_snapshot_forward.sql";
const legacyRecoveryMigration =
  "20260831054000_recover_elevenst_listing_snapshot.sql";
const OUT_OF_SCOPE_COMPETITOR_MIGRATIONS = new Set([
  "20260831131500_retire_pre_v3_competitor_search_queue.sql",
  "20260831132000_competitor_identity_lineage_fence.sql",
]);
const migration = await readFile(new URL(
  `../supabase/migrations/${migrationName}`,
  import.meta.url,
), "utf8");

const IDS = Object.freeze({
  owner: "768ce4ac-0000-4000-8000-000000000001",
  credential: "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
  attempt: "84957a46-4a90-43bb-a9b6-e4f2be984b58",
  product: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listing: "363f3b81-f364-4f22-af4e-4920199904d0",
  sourceJob: "f7927a29-46b2-4d77-90da-759c79c50bc7",
});
const SELLER_ACCOUNT_KEY = "2".repeat(64);
const REQUEST_SHA =
  "eed923ee9a26973e58d1f8ba381c28e190296f7c89b10cce5d7ec4d4fa1dbd71";
const RESPONSE_SHA =
  "77debf98a349c27cbecc8a348f62e8fdf55d61d97fe87e7bac8e4d9f68fb7fd7";
const IMAGE_OBSERVATION_SHA =
  "2ce9e1896d7d14525bce5c509c89228520c720476defd955054ace603756f2b9";
const OBSERVED_PROVIDER_IMAGES = Object.freeze([
  "https://cdn.011st.com/product/9573255804/B.webp?15666467",
  "https://cdn.011st.com/product/9573255804/A1.webp?93344322",
  "https://cdn.011st.com/product/9573255804/A2.webp?158196316",
  "https://cdn.011st.com/product/9573255804/A3.webp?260866092",
]);

function stripUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "")
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
}

async function compatibilityLayer() {
  const source = await readFile(
    new URL("./supabase-migrations.test.mjs", import.meta.url),
    "utf8",
  );
  const match = source.match(
    /const supabaseCompatibilityLayer = String\.raw`([\s\S]*?)`;\n\nfunction withoutUnavailableExtensions/,
  );
  assert.ok(match);
  return match[1];
}

async function databaseBeforeForwardMigration() {
  const db = new PGlite();
  await db.exec(await compatibilityLayer());
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    if (name === legacyRecoveryMigration || name === migrationName) continue;
    if (OUT_OF_SCOPE_COMPETITOR_MIGRATIONS.has(name)) continue;
    await db.exec(stripUnavailableExtensions(
      await readFile(new URL(name, migrationUrl), "utf8"),
    ));
  }
  return db;
}

const fullProduct = Object.freeze({
  selMthdCd: "01",
  dispCtgrNo: "1341821",
  prdTypCd: "01",
  prdNm: "부착형 케이블 정리 클립 6개 세트",
  brand: "No Brand",
  rmaterialTypCd: "04",
  orgnTypCd: "03",
  orgnNmVal: "중국",
  sellerPrdCd: "QA-20260823-CC-001",
  suplDtyfrPrdClfCd: "01",
  forAbrdBuyClf: "01",
  prdStatCd: "01",
  minorSelCnYn: "Y",
  prdImage01: "https://cdn.example.test/elevenst/main.webp",
  prdImage02: "https://cdn.example.test/elevenst/extra-1.webp",
  prdImage03: "https://cdn.example.test/elevenst/extra-2.webp",
  prdImage04: "https://cdn.example.test/elevenst/extra-3.webp",
  htmlDetail: "<section lang=\"ko-KR\"><p>케이블 정리 클립 상세 설명입니다.</p></section>",
  ProductCertGroup: [
    { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
  ],
  selPrdClfCd: "3y:110",
  aplBgnDy: "2026/08/24",
  aplEndDy: "2029/08/23",
  selPrc: "5000",
  prdSelQty: "1",
  dlvCnAreaCd: "01",
  dlvWyCd: "01",
  dlvCstInstBasiCd: "01",
  bndlDlvCnYn: "Y",
  dlvCstPayTypCd: "03",
  rtngdDlvCst: "3000",
  exchDlvCst: "6000",
  asDetail: "11번가 판매자 문의를 이용해 주세요.",
  rtngExchDetail: "11번가 반품·교환 정책을 확인해 주세요.",
  ProductNotification: {
    type: "891045",
    item: [
      { code: "11800", name: "상품 상세설명 참조" },
      { code: "11905", name: "상품 상세설명 참조" },
      { code: "23760413", name: "상품 상세설명 참조" },
      { code: "23759100", name: "상품 상세설명 참조" },
      { code: "23756033", name: "상품 상세설명 참조" },
    ],
  },
});

const expectedSnapshotProduct = Object.freeze({
  ...fullProduct,
  prdImage01: OBSERVED_PROVIDER_IMAGES[0],
  prdImage02: OBSERVED_PROVIDER_IMAGES[1],
  prdImage03: OBSERVED_PROVIDER_IMAGES[2],
  prdImage04: OBSERVED_PROVIDER_IMAGES[3],
});

const requestPayload = Object.freeze({
  arguments: {
    product: fullProduct,
    verificationOnly: true,
  },
});
const responsePayload = Object.freeze({
  ok: true,
  remoteId: "9573255804",
  steps: [
    { name: "product-create", ok: true, status: 200 },
    { name: "product-readback", ok: true, status: 200 },
    { name: "verification-stop-display", ok: true, status: 200 },
  ],
});

async function seedExactTuple(db) {
  await db.exec("set session_replication_role = replica");
  await db.query(
    "insert into auth.users (id,email) values ($1,'exact-forward-elevenst@example.test')",
    [IDS.owner],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,channel,environment,version,vault_secret_id,fingerprint,status,
       created_by,last_checked_at,last_check_status,seller_account_key,
       seller_account_key_source,seller_account_verified_at
     ) values (
       $1,'elevenst','production',2,'11111111-1111-4111-8111-111111111111',
       $2,'active',$3,clock_timestamp(),'passed',$4,
       'credential_incarnation_v1',clock_timestamp()
     )`,
    [IDS.credential, "1".repeat(64), IDS.owner, SELLER_ACCOUNT_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.products (
       id,owner_id,external_code,sku,name,description,status,
       detail_page_data,detail_page_version,detail_page_updated_at,
       detail_page_approved_version,detail_page_image_manifest
     ) values (
       $1,$2,'QA-20260823-CC-001','QA-20260823-CC-001',
       '부착형 케이블 정리 클립 6개 세트','QA 설명','draft',
       '{}'::jsonb,1,clock_timestamp(),1,$3::jsonb
     )`,
    [IDS.product, IDS.owner, JSON.stringify({
      contract: "sellerpilot_detail_image_manifest_v2",
      algorithm: "sha256",
      digest: "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62",
      images: Array.from({ length: 8 }, (_, index) => ({
        role: `detail-role-${index + 1}`,
        path: `results/${IDS.product}/detail-role-${index + 1}.png`,
        sourceSha256: String(index + 1).padStart(64, "0"),
      })),
    })],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,idempotency_key,
       request_fingerprint,status,http_status,remote_id,started_at,completed_at,
       gateway_write_required,pre_gateway_retryable,seller_account_key
     ) values (
       $1,$2,$3,'elevenst','listing.create','exact-forward-elevenst-source',
       $4,'succeeded',200,'9573255804',
       '2026-08-24T07:42:22.07751Z','2026-08-24T07:42:26.415136Z',
       false,false,null
     )`,
    [
      IDS.attempt,
      IDS.owner,
      IDS.credential,
      "1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af",
    ],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,status,currency,price,
       operation_attempt_id,market,target_id,failure_class,marketplace_sku,
       seller_account_key,requested_publication_intent,remote_visibility,
       provider_status,published_at
     ) values (
       $1,$2,$3,'elevenst','9573255804','failed','KRW',5000,$4,'KR','KR',
       'external_action',null,$5,'live','unknown',null,null
     )`,
    [IDS.listing, IDS.owner, IDS.product, IDS.attempt, SELLER_ACCOUNT_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,status,attempt_count,created_by,
       created_at,started_at,completed_at,updated_at,seller_account_key,
       request_fingerprint,provider_mutation_started_at
     ) values (
       $1,$2,$3,null,'elevenst','listing.create','production',
       $4::jsonb,$5::jsonb,'succeeded',1,$6,
       '2026-08-24T07:42:18.57602Z','2026-08-24T07:42:22.07751Z',
       '2026-08-24T07:42:26.415136Z','2026-08-24T07:42:26.415136Z',
       null,null,null
     )`,
    [
      IDS.sourceJob,
      IDS.credential,
      IDS.attempt,
      JSON.stringify(requestPayload),
      JSON.stringify(responsePayload),
      IDS.owner,
    ],
  );
  await db.exec("set session_replication_role = origin");
}

async function fixturePayloadAttestation(db) {
  return (await db.query(
    `select
       octet_length(request_payload::text)::integer as request_bytes,
       octet_length(response_payload::text)::integer as response_bytes,
       encode(extensions.digest(request_payload::text, 'sha256'), 'hex') as request_sha,
       encode(extensions.digest(response_payload::text, 'sha256'), 'hex') as response_sha
     from sellerpilot_private.channel_gateway_jobs
     where id = $1`,
    [IDS.sourceJob],
  )).rows[0];
}

function migrationForFixture(attestation) {
  return migration
    .replaceAll(REQUEST_SHA, attestation.request_sha)
    .replaceAll(RESPONSE_SHA, attestation.response_sha)
    .replace(
      "octet_length(v_source_job.request_payload::text) <> 4349",
      `octet_length(v_source_job.request_payload::text) <> ${attestation.request_bytes}`,
    )
    .replace(
      "octet_length(v_source_job.response_payload::text) <> 1083",
      `octet_length(v_source_job.response_payload::text) <> ${attestation.response_bytes}`,
    );
}

test("11st forward repair is exact, provider-write-free, and independent of legacy 310540", () => {
  assert.ok(migrationName > "20260901040027_harden_ebay_exact_existing_qa_language_and_image_fence.sql");
  for (const value of [
    IDS.credential,
    IDS.attempt,
    IDS.product,
    IDS.listing,
    IDS.sourceJob,
    "9573255804",
    "QA-20260823-CC-001",
    REQUEST_SHA,
    RESPONSE_SHA,
    IMAGE_OBSERVATION_SHA,
    "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62",
    ...OBSERVED_PROVIDER_IMAGES,
  ]) assert.ok(migration.includes(value), `migration must bind ${value}`);
  assert.match(migration, /insert into sellerpilot_private\.elevenst_listing_snapshots/u);
  assert.match(migration, /'requiresFreshProviderPreflight', true/u);
  assert.match(migration, /'providerWritePerformed', false/u);
  assert.match(migration, /'runtimeStaticEgressChanged', false/u);
  assert.match(
    migration,
    /'contract', 'elevenst_seller_office_read_only_image_observation_v1'/u,
  );
  assert.match(migration, /'providerImageNormalizationOverlayOnly', true/u);
  assert.match(
    migration,
    /'historicalSourceFieldsPreservedExceptProviderImages', true/u,
  );
  assert.match(migration, /listing_mutation_release_gate_is_effective\('elevenst'\)/u);
  assert.doesNotMatch(migration, /elevenst_exact_legacy_source_attestations/u);
  assert.doesNotMatch(migration, /elevenst_listing_snapshot_recoveries/u);
  assert.doesNotMatch(migration, /sellerpilot_service_enqueue/u);
  assert.doesNotMatch(migration, /insert into sellerpilot_private\.channel_gateway_jobs/u);
  assert.doesNotMatch(migration, /insert into sellerpilot_private\.listing_publication_reviews/u);
  assert.doesNotMatch(migration, /update sellerpilot_private\.channel_gateway_jobs/u);
  assert.doesNotMatch(migration, /update sellerpilot_private\.product_listings/u);
  assert.doesNotMatch(migration, /serverless_static_egress_policy/u);
  assert.doesNotMatch(migration, /serverless_static_egress_allowed/u);
});

test("exact null-SKU production tuple gains only its trusted snapshot", async () => {
  const db = await databaseBeforeForwardMigration();
  try {
    assert.equal((await db.query(
      "select to_regclass('sellerpilot_private.elevenst_exact_legacy_source_attestations') as relation",
    )).rows[0].relation, null);
    await seedExactTuple(db);
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    const attestation = await fixturePayloadAttestation(db);
    const staticEgressBefore = (await db.query(
      "select public.sellerpilot_service_serverless_static_egress_status() as status",
    )).rows[0].status;
    const listingBefore = (await db.query(
      `select status, failure_class, marketplace_sku, remote_visibility,
              provider_status, published_at, currency, price
         from sellerpilot_private.product_listings where id=$1`,
      [IDS.listing],
    )).rows[0];
    const gatewayJobsBefore = Number((await db.query(
      "select count(*) as count from sellerpilot_private.channel_gateway_jobs",
    )).rows[0].count);

    await db.exec(migrationForFixture(attestation));

    const listingAfter = (await db.query(
      `select status, failure_class, marketplace_sku, remote_visibility,
              provider_status, published_at, currency, price
         from sellerpilot_private.product_listings where id=$1`,
      [IDS.listing],
    )).rows[0];
    assert.deepEqual(listingAfter, listingBefore);
    assert.equal(Number((await db.query(
      "select count(*) as count from sellerpilot_private.channel_gateway_jobs",
    )).rows[0].count), gatewayJobsBefore);
    assert.equal(Number((await db.query(
      "select count(*) as count from sellerpilot_private.listing_publication_reviews where listing_id=$1",
      [IDS.listing],
    )).rows[0].count), 0);
    assert.deepEqual((await db.query(
      "select public.sellerpilot_service_serverless_static_egress_status() as status",
    )).rows[0].status, staticEgressBefore);

    const persisted = (await db.query(
      `select credential_id, seller_account_key, remote_id, product_payload,
              source_job_id, source_operation, revision
         from sellerpilot_private.elevenst_listing_snapshots
        where listing_id=$1`,
      [IDS.listing],
    )).rows[0];
    assert.equal(persisted.credential_id, IDS.credential);
    assert.equal(persisted.seller_account_key, SELLER_ACCOUNT_KEY);
    assert.equal(persisted.remote_id, "9573255804");
    assert.equal(persisted.source_job_id, IDS.sourceJob);
    assert.equal(persisted.source_operation, "listing.create");
    assert.equal(Number(persisted.revision), 1);
    assert.deepEqual(persisted.product_payload, expectedSnapshotProduct);

    const rpcSnapshot = (await db.query(
      "select public.sellerpilot_service_get_elevenst_listing_snapshot($1,$2,$3) as snapshot",
      [IDS.listing, IDS.credential, "9573255804"],
    )).rows[0].snapshot;
    assert.equal(rpcSnapshot.remoteId, "9573255804");
    assert.equal(Number(rpcSnapshot.revision), 1);
    assert.deepEqual(rpcSnapshot.product, expectedSnapshotProduct);

    const audit = (await db.query(
      `select safe_detail from sellerpilot_private.operation_audit
        where action='elevenst_exact_listing_snapshot_forward_recovered'
          and entity_id=$1`,
      [IDS.listing],
    )).rows[0].safe_detail;
    assert.equal(audit.providerWritePerformed, false);
    assert.equal(audit.gatewayJobCreated, false);
    assert.equal(audit.publicationReviewCreated, false);
    assert.equal(audit.listingPublicationStateChanged, false);
    assert.equal(audit.runtimeStaticEgressChanged, false);
    assert.equal(audit.releaseGateChanged, false);
    assert.equal(audit.marketplaceSkuBackfilled, false);
    assert.equal(audit.legacyListingMarketplaceSkuPreserved, true);
    assert.equal(audit.requiresFreshProviderPreflight, true);
    assert.equal(audit.approvedDetailImageCount, 8);
    assert.equal(audit.providerImageNormalizationOverlayOnly, true);
    assert.equal(
      audit.historicalSourceFieldsPreservedExceptProviderImages,
      true,
    );
    assert.equal(
      audit.providerImageObservation.contract,
      "elevenst_seller_office_read_only_image_observation_v1",
    );
    assert.equal(audit.providerImageObservation.sellerStatusCode, "105");
    assert.equal(audit.providerImageObservation.sha256, IMAGE_OBSERVATION_SHA);
    assert.deepEqual(
      audit.providerImageObservation.imageUrls,
      OBSERVED_PROVIDER_IMAGES,
    );

    const exactAuditCount = Number((await db.query(
      `select count(*) as count from sellerpilot_private.operation_audit
        where action='elevenst_exact_listing_snapshot_forward_recovered'
          and entity_id=$1`,
      [IDS.listing],
    )).rows[0].count);
    const nearMissImage =
      "https://cdn.011st.com/product/9573255804/A3.webp?260866093";
    await db.query(
      `update sellerpilot_private.elevenst_listing_snapshots
          set product_payload=jsonb_set(
            product_payload,'{prdImage04}',to_jsonb($2::text),false
          )
        where listing_id=$1`,
      [IDS.listing, nearMissImage],
    );
    await assert.rejects(
      db.exec(migrationForFixture(attestation)),
      /exact 11st forward snapshot conflict/u,
    );
    await db.exec("rollback");
    assert.equal((await db.query(
      `select product_payload->>'prdImage04' as image
         from sellerpilot_private.elevenst_listing_snapshots
        where listing_id=$1`,
      [IDS.listing],
    )).rows[0].image, nearMissImage);
    assert.equal(Number((await db.query(
      `select count(*) as count from sellerpilot_private.operation_audit
        where action='elevenst_exact_listing_snapshot_forward_recovered'
          and entity_id=$1`,
      [IDS.listing],
    )).rows[0].count), exactAuditCount);

    await db.query(
      `update sellerpilot_private.elevenst_listing_snapshots
          set product_payload=$2::jsonb
        where listing_id=$1`,
      [IDS.listing, JSON.stringify(expectedSnapshotProduct)],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set request_payload=jsonb_set(
            request_payload,'{arguments,product,prdImage04}',
            to_jsonb($2::text),false
          )
        where id=$1`,
      [IDS.sourceJob, "https://cdn.example.test/elevenst/extra-3-near-miss.webp"],
    );
    await assert.rejects(
      db.exec(migrationForFixture(attestation)),
      /exact 11st forward snapshot tuple does not match/u,
    );
    await db.exec("rollback");
    assert.deepEqual((await db.query(
      `select product_payload from sellerpilot_private.elevenst_listing_snapshots
        where listing_id=$1`,
      [IDS.listing],
    )).rows[0].product_payload, expectedSnapshotProduct);
    assert.equal(Number((await db.query(
      `select count(*) as count from sellerpilot_private.operation_audit
        where action='elevenst_exact_listing_snapshot_forward_recovered'
          and entity_id=$1`,
      [IDS.listing],
    )).rows[0].count), exactAuditCount);
  } finally {
    await db.close();
  }
});
