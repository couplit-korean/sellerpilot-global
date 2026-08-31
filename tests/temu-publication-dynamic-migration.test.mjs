import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER_ID = "d0f39ad6-e4af-4b7e-965d-9e0a324f2fab";
const RELEASE_SHA = "a".repeat(40);
const SERVERLESS_TOKEN_HASH = "d".repeat(64);
const EXACT_TEMU_PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const EXACT_TEMU_SKU = "QA-20260823-CC-001";
const EXACT_TEMU_CATEGORY_ID = "601099";
const EXACT_TEMU_TEMPLATE = "QA_KR_STANDARD";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function setClaims(db, role = "authenticated", userId = OWNER_ID) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function migrationHarness() {
  const source = await readFile(
    new URL("./supabase-migrations.test.mjs", import.meta.url),
    "utf8",
  );
  const compatibilityMarker = "const supabaseCompatibilityLayer = String.raw`";
  const compatibilityStart = source.indexOf(compatibilityMarker) + compatibilityMarker.length;
  const compatibilityEnd = source.indexOf("`;\n\nfunction withoutUnavailableExtensions", compatibilityStart);
  assert.ok(compatibilityStart >= compatibilityMarker.length && compatibilityEnd > compatibilityStart);
  const functionStart = source.indexOf("function withoutUnavailableExtensions");
  const functionEnd = source.indexOf("\n\n// This one broad integration flow", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const withoutUnavailableExtensions = Function(
    `"use strict"; return (${source.slice(functionStart, functionEnd)});`,
  )();
  return {
    compatibility: source.slice(compatibilityStart, compatibilityEnd),
    withoutUnavailableExtensions,
  };
}

async function replayMigrations(db) {
  const { compatibility, withoutUnavailableExtensions } = await migrationHarness();
  await db.exec(compatibility);
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const source = await readFile(new URL(name, migrationUrl), "utf8");
    await db.exec(withoutUnavailableExtensions(source));
  }
}

async function enableTemuRuntime(db) {
  for (const channel of [
    "qoo10", "shopee", "lazada", "coupang",
    "elevenst", "smartstore", "ebay", "temu",
  ]) {
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready($1,true,$2)",
      [channel, RELEASE_SHA],
    );
  }
  await db.query(
    "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
    [RELEASE_SHA],
  );
  await db.query(
    `insert into sellerpilot_private.serverless_runtime_canary_receipts (
       release_id, passed_at, consumed_at
     ) values ($1, clock_timestamp(), clock_timestamp())`,
    [RELEASE_SHA],
  );
  await db.exec(`
    update cron.job
       set active=true
     where jobname in (
       'sellerpilot-serverless-cs-wake-v1',
       'sellerpilot-product-research-v1',
       'sellerpilot-channel-sync-v1',
       'sellerpilot-competitor-prices-v1',
       'sellerpilot-kakao-notifications-v1',
       'sellerpilot-maintenance-v1'
     );
  `);
  const gate = await scalar(
    db,
    "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
    [RELEASE_SHA],
  );
  assert.equal(gate.open, true);
  await db.exec(`
    update sellerpilot_private.serverless_static_egress_policy
       set enabled=true,updated_at=clock_timestamp()
     where channel='temu';
  `);
  await scalar(
    db,
    `select set_config(
      'request.headers',
      '{"x-sellerpilot-static-egress-channels":"temu"}',
      false
    )`,
  );
}

function activationFixtureData(suffix) {
  const sourceFingerprint = suffix.repeat(64).slice(0, 64);
  const manifestDigest = String((Number(suffix) + 1) % 10).repeat(64);
  const goodsId = `9007199254740${990 + Number(suffix)}`;
  const externalGoodsId = `SP-TEMU-DYNAMIC-${suffix}`;
  const representativeImage = `https://assets.example.test/products/temu-dynamic-${suffix}/hero.jpg`;
  const images = Array.from({ length: 8 }, (_, index) => ({
    role: `detail-${index + 1}`,
    path: `products/temu-dynamic-${suffix}/detail-${index + 1}.jpg`,
    sourceSha256: String(index + 1).repeat(64),
  }));
  const assetBinding = {
    contract: "sellerpilot_publication_asset_binding_v1",
    providerImageSurface: "detail_content",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: manifestDigest,
    approvedDetailImages: images.map((image) => ({
      role: image.role,
      approvedObjectPath: image.path,
      approvedSourceSha256: image.sourceSha256,
    })),
    providerTransportImages: images.map((image) => ({
      role: image.role,
      publicUrl: `https://assets.example.test/${image.path}`,
      objectPath: image.path,
      contentSha256: image.sourceSha256,
    })),
  };
  const argumentsPayload = {
    publicationIntent: "safe_test",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: sourceFingerprint,
    sellerpilotPublicationAssetBinding: assetBinding,
    body: {
      language: "ko",
      goodsBasic: {
        externalGoodsId,
        goodsName: `Temu 동적 검증 상품 ${suffix}`,
        extCatName: "601099",
        costTemplate: "QA_KR_STANDARD",
        goodsDesc: "승인된 한국어 상세 설명",
        bulletPoints: ["승인된 한국어 상세 구성"],
        goodsCarouselImage: [representativeImage],
        detailImage: images.map((image) => `https://assets.example.test/${image.path}`),
      },
      skuList: [{
        externalSkuId: `${externalGoodsId}-01`,
        quantity: 1,
        price: { basePrice: { amount: "10000", currency: "KRW" } },
      }],
    },
  };
  return {
    sourceFingerprint,
    manifestDigest,
    goodsId,
    externalGoodsId,
    representativeImage,
    images,
    argumentsPayload,
  };
}

function temuProviderAssetBinding(fixture) {
  const roles = fixture.images.map((image) => image.role);
  return {
    contract: "sellerpilot_provider_asset_binding_v1",
    providerImageSurface: "detail_content",
    sourceAssetBindingDigest: "e".repeat(64),
    providerImageDigest: "f".repeat(64),
    approvedManifestDigest: fixture.manifestDigest,
    approvedDetailPageVersion: 1,
    approvedDetailRoles: roles,
    providerTransportRoles: roles,
    providerDetailImageIdentities: fixture.images.map(
      (image) => `https://assets.example.test/${image.path}`,
    ),
  };
}

function validTemuActivationRemoteState(fixture, fingerprint) {
  return {
    verified: true,
    visibility: "live",
    providerStatus: "LIVE",
    locale: "ko-KR",
    fingerprint,
    imageCount: 8,
    verifiedAt: new Date(Date.now() + 1_000).toISOString(),
    resources: {
      goodsId: fixture.goodsId,
      externalGoodsId: fixture.externalGoodsId,
    },
    evidence: {
      version: "temu_list_status_detail_stock_v3",
      readbackMethods: [
        "temu.local.goods.list.retrieve",
        "bg.local.goods.publish.status.get",
        "bg.local.goods.detail.query",
        "temu.local.goods.sku.stock.query",
      ],
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      representativeImageVerified: true,
      imageCountVerified: true,
      imageOrderVerified: true,
      contentVerified: true,
      skuIdentityVerified: true,
      priceVerified: true,
      stockVerified: true,
      goodsIdVerified: true,
      externalGoodsIdVerified: true,
      observedRepresentativeImageCount: 1,
      representativeImageDigest: createHash("sha256")
        .update(JSON.stringify([fixture.representativeImage]), "utf8")
        .digest("hex"),
      observedSkuCount: 1,
      publicationAssetBinding: temuProviderAssetBinding(fixture),
    },
  };
}

function exactTemuCreateFixture(idempotencyKey) {
  const requestFingerprint = "6".repeat(64);
  const scopeFingerprint = createHash("sha256").update(JSON.stringify({
    contract: "temu_create_attempt_external_id_v1",
    productId: EXACT_TEMU_PRODUCT_ID,
    sourceSku: EXACT_TEMU_SKU,
    market: "KR",
    targetId: "",
    idempotencyKey,
  }), "utf8").digest("hex");
  const externalGoodsId = `SP-DDCCDE359C58-${scopeFingerprint.slice(0, 32).toUpperCase()}`;
  const manifestDigest = "8".repeat(64);
  const representativeImage = "https://assets.example.test/products/temu-exact-cable/hero.jpg";
  const images = Array.from({ length: 8 }, (_, index) => {
    const ordinal = index + 1;
    const role = `detail-${ordinal}`;
    const objectPath = `products/temu-exact-cable/detail-${ordinal}.jpg`;
    const publicUrl = `https://assets.example.test/${objectPath}`;
    const contentSha256 = String(ordinal).repeat(64);
    return { role, objectPath, publicUrl, contentSha256 };
  });
  const sellerpilotPublicationAssetBinding = {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: manifestDigest,
    approvedDetailImages: images.map((image) => ({
      role: image.role,
      approvedObjectPath: image.objectPath,
      approvedSourceSha256: image.contentSha256,
      publicUrl: image.publicUrl,
      objectPath: image.objectPath,
      contentSha256: image.contentSha256,
    })),
    providerImageSurface: "detail_content",
    providerTransportImages: images.map((image) => ({
      role: image.role,
      publicUrl: image.publicUrl,
      objectPath: image.objectPath,
      contentSha256: image.contentSha256,
    })),
  };
  return {
    idempotencyKey,
    requestFingerprint,
    scopeFingerprint,
    externalGoodsId,
    manifestDigest,
    representativeImage,
    images,
    payload: {
      arguments: {
        publicationIntent: "safe_test",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ko-KR",
        publicationExpectedImageCount: 8,
        publicationExpectedFingerprint: requestFingerprint,
        sellerpilotTemuCreateCorrelation: {
          version: "temu_create_attempt_external_id_v1",
          sourceSellerSku: EXACT_TEMU_SKU,
          externalGoodsId,
          scopeFingerprint,
          skuCount: 1,
        },
        sellerpilotPublicationAssetBinding,
        body: {
          language: "ko",
          goodsBasic: {
            externalGoodsId,
            goodsName: "케이블 정리 클립 QA 상품",
            extCatName: EXACT_TEMU_CATEGORY_ID,
            costTemplate: EXACT_TEMU_TEMPLATE,
            goodsDesc: "승인된 한국어 케이블 정리 클립 상세 설명",
            bulletPoints: ["승인된 한국어 상품 구성"],
            goodsCarouselImage: [representativeImage],
            detailImage: images.map((image) => image.publicUrl),
          },
          skuList: [{
            externalSkuId: `${externalGoodsId}-01`,
            quantity: 1,
            price: { basePrice: { amount: "5000", currency: "KRW" } },
          }],
        },
      },
    },
  };
}

async function seedExactTemuCreatePrerequisites(db) {
  const fixture = exactTemuCreateFixture("temu-exact-cable-seed-0001");
  await setClaims(db, "authenticated");
  const credentialId = await scalar(
    db,
    `select public.sellerpilot_rotate_credential(
      'temu','production',jsonb_build_object('app_key','temu-exact-cable-test'),
      now()+interval '30 days',90,30,7
    )`,
  );
  await db.query(
    `insert into sellerpilot_private.products (
       id,owner_id,external_code,sku,name,description,status,on_hand,reserved,
       reorder_point,cost_krw,demo,detail_page_data,detail_page_version,
       detail_page_updated_at,detail_page_approved_version,
       detail_page_image_manifest
     ) values (
       $1,$2,$3,$3,'케이블 정리 클립 QA 상품',
       '승인된 한국어 케이블 정리 클립 상세 설명','draft',1,0,1,1000,
       false,'{}'::jsonb,1,clock_timestamp(),1,$4::jsonb
     )`,
    [
      EXACT_TEMU_PRODUCT_ID,
      OWNER_ID,
      EXACT_TEMU_SKU,
      JSON.stringify({
        contract: "sellerpilot_detail_image_manifest_v2",
        algorithm: "sha256",
        digest: fixture.manifestDigest,
        images: fixture.images.map((image) => ({
          role: image.role,
          path: image.objectPath,
          sourceSha256: image.contentSha256,
        })),
      }),
    ],
  );
  await db.query(
    `insert into sellerpilot_private.product_category_assignments (
       owner_id,product_id,source_ref,product_name,channel,environment,market,
       category_id,category_path,is_leaf,confidence,classification_source,
       missing_required_attributes,official_metadata,status,
       official_verified_at,confirmed_at
     ) values (
       $1,$2,'temu-exact-cable-category-v1','케이블 정리 클립 QA 상품',
       'temu','production','KR',$3,array['생활','케이블 정리'],true,1,
       'seller_selected','[]'::jsonb,'{"verifiedBy":"focused-test"}'::jsonb,
       'confirmed',clock_timestamp(),clock_timestamp()
     )`,
    [OWNER_ID, EXACT_TEMU_PRODUCT_ID, EXACT_TEMU_CATEGORY_ID],
  );
  return { credentialId };
}

async function reserveExactTemuCreate(db, credentialId, fixture) {
  await setClaims(db, "authenticated");
  const claim = await scalar(
    db,
    `select public.sellerpilot_claim_channel_operation(
      $1,'temu','listing.create',$2,$3
    )`,
    [credentialId, fixture.idempotencyKey, fixture.requestFingerprint],
  );
  await setClaims(db, "service_role");
  return scalar(
    db,
    `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
      $1,$2,$3,'temu','KR','','KRW',5000,$4,$5::jsonb
    )`,
    [
      EXACT_TEMU_PRODUCT_ID,
      credentialId,
      claim.attempt_id,
      fixture.requestFingerprint,
      JSON.stringify(fixture.payload),
    ],
  );
}

async function seedVerifiedSafeTestListing(db, suffix) {
  const fixture = activationFixtureData(suffix);
  await setClaims(db, "authenticated");
  const credentialId = await scalar(
    db,
    `select public.sellerpilot_rotate_credential(
      'temu','production',jsonb_build_object('app_key',$1::text),
      now()+interval '30 days',90,30,7
    )`,
    [`temu-dynamic-${suffix}`],
  );
  const sellerAccountKey = String((Number(suffix) + 4) % 10).repeat(64);
  const sourceClaim = await scalar(
    db,
    `select public.sellerpilot_claim_channel_operation(
      $1,'temu','listing.create',$2,$3
    )`,
    [credentialId, `temu-dynamic-source-${suffix}-${"9".repeat(40)}`, fixture.sourceFingerprint],
  );
  await db.exec("set local session_replication_role=replica");
  await db.query(
    `update sellerpilot_private.channel_credentials
        set seller_account_key=$2,
            seller_account_key_source='provider_certified_v1',
            seller_account_verified_at=clock_timestamp()
      where id=$1`,
    [credentialId, sellerAccountKey],
  );
  const productId = await scalar(
    db,
    `insert into sellerpilot_private.products (
       owner_id,external_code,sku,name,description,status,on_hand,reserved,
       reorder_point,cost_krw,demo,detail_page_data,detail_page_version,
       detail_page_updated_at,
       detail_page_approved_version,detail_page_image_manifest
     ) values (
       $1,$2,$2,$3,'승인된 한국어 상세 설명','active',10,0,1,1000,
       false,'{}'::jsonb,1,clock_timestamp(),1,$4::jsonb
     ) returning id`,
    [
      OWNER_ID,
      `TEMU-DYNAMIC-${suffix}`,
      `Temu 동적 검증 상품 ${suffix}`,
      JSON.stringify({
        contract: "sellerpilot_detail_image_manifest_v2",
        algorithm: "sha256",
        digest: fixture.manifestDigest,
        images: fixture.images,
      }),
    ],
  );
  const listingId = await scalar(
    db,
    `insert into sellerpilot_private.product_listings (
       owner_id,product_id,channel_key,market,target_id,remote_id,status,
       currency,price,operation_attempt_id,last_verified_at,
       requested_publication_intent,remote_visibility,provider_status,
       remote_resources,seller_account_key
     ) values (
       $1,$2,'temu','KR','',$3::text,'paused','KRW',10000,$4,
       clock_timestamp(),'safe_test','non_public','OFF_SHELF',
       jsonb_build_object('resources',jsonb_build_object(
         'goodsId',$3::text,'externalGoodsId',$5::text
       )),$6::text
     ) returning id`,
    [
      OWNER_ID,
      productId,
      fixture.goodsId,
      sourceClaim.attempt_id,
      fixture.externalGoodsId,
      sellerAccountKey,
    ],
  );
  const sourceJobId = await scalar(
    db,
    `insert into sellerpilot_private.channel_gateway_jobs (
       credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,status,seller_account_key,
       request_fingerprint,created_by,provider_mutation_started_at,
       started_at,completed_at,updated_at
     ) values (
       $1,$2,$3,'temu','listing.create','production',
       jsonb_build_object('arguments',$4::jsonb),$5::jsonb,'succeeded',$6,$7,$8,
       clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp()
     ) returning id`,
    [
      credentialId,
      sourceClaim.attempt_id,
      listingId,
      JSON.stringify(fixture.argumentsPayload),
      JSON.stringify({
        ok: true,
        publicationFulfilled: true,
        publicationIntent: "safe_test",
        remoteId: fixture.goodsId,
        remoteState: {
          verified: true,
          visibility: "non_public",
          locale: "ko-KR",
          fingerprint: fixture.sourceFingerprint,
          imageCount: 8,
          providerStatus: "OFF_SHELF",
          verifiedAt: "2026-08-31T12:00:00.000Z",
          resources: {
            goodsId: fixture.goodsId,
            externalGoodsId: fixture.externalGoodsId,
          },
        },
      }),
      sellerAccountKey,
      fixture.sourceFingerprint,
      OWNER_ID,
    ],
  );
  await db.query(
    `update sellerpilot_private.channel_operation_attempts
        set status='succeeded',remote_id=$2,completed_at=clock_timestamp()
      where id=$1`,
    [sourceClaim.attempt_id, fixture.goodsId],
  );
  await db.exec("set local session_replication_role=origin");
  return {
    ...fixture,
    credentialId,
    sellerAccountKey,
    sourceAttemptId: sourceClaim.attempt_id,
    sourceJobId,
    productId,
    listingId,
  };
}

async function enqueueActivation(db, fixture, activationFingerprint) {
  await setClaims(db, "service_role");
  const context = await scalar(
    db,
    `select public.sellerpilot_service_get_temu_activation_context(
      $1,$2,$3,$4,'KR',''
    )`,
    [OWNER_ID, fixture.productId, fixture.listingId, fixture.credentialId],
  );
  assert.equal(context.status, "allowed");
  await setClaims(db, "authenticated");
  const claim = await scalar(
    db,
    `select public.sellerpilot_claim_channel_operation(
      $1,'temu','listing.activate',$2,$3
    )`,
    [fixture.credentialId, context.claimIdempotencyKey, activationFingerprint],
  );
  await setClaims(db, "service_role");
  const enqueue = await scalar(
    db,
    `select public.sellerpilot_service_enqueue_temu_activation(
      $1,$2,$3,jsonb_build_object(
        'arguments',jsonb_set(
          $4::jsonb,'{publicationExpectedFingerprint}',to_jsonb($5::text)
        )
      )
    )`,
    [
      fixture.listingId,
      fixture.credentialId,
      claim.attempt_id,
      JSON.stringify(context.arguments),
      activationFingerprint,
    ],
  );
  assert.equal(enqueue.status, "queued");
  return { context, claim, enqueue };
}

async function claimActivationWorker(db, jobId, workerLabel) {
  await setClaims(db, "service_role");
  const workerClaim = await scalar(
    db,
    "select public.sellerpilot_claim_serverless_gateway_job($1,$2)",
    [SERVERLESS_TOKEN_HASH, workerLabel],
  );
  assert.equal(workerClaim.id, jobId);
  assert.equal(workerClaim.channel, "temu");
  assert.equal(workerClaim.operation, "listing.activate");
  return workerClaim;
}

test("Temu publication migration dynamically fences durable activation and containment", async (t) => {
  const db = new PGlite();
  try {
    await replayMigrations(db);
    await db.query(
      "insert into auth.users(id,email) values($1,'temu-dynamic@example.test')",
      [OWNER_ID],
    );
    await db.query(
      `insert into sellerpilot_private.admin_users(user_id,display_name)
       values($1,'Temu Dynamic Test Admin')`,
      [OWNER_ID],
    );
    await setClaims(db, "service_role");
    await enableTemuRuntime(db);
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens(
         label,token_hash,fingerprint,status,scope,expires_at,created_by
       ) values(
         'Temu dynamic serverless worker',$1,'DDDDDDDDDDDD','active',
         'serverless_cs',clock_timestamp()+interval '1 day',$2
       )`,
      [SERVERLESS_TOKEN_HASH, OWNER_ID],
    );
    const exactCreatePrerequisites = await seedExactTemuCreatePrerequisites(db);

    await t.test("exact cable create cannot synthesize a missing Temu credential", async () => {
      await db.exec("begin");
      try {
        const fixture = exactTemuCreateFixture("temu-exact-cable-missing-credential-0001");
        await setClaims(db, "service_role");
        await assert.rejects(
          scalar(
            db,
            `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
              $1,$2,$3,'temu','KR','','KRW',5000,$4,$5::jsonb
            )`,
            [
              EXACT_TEMU_PRODUCT_ID,
              "11111111-1111-4111-8111-111111111111",
              "22222222-2222-4222-8222-222222222222",
              fixture.requestFingerprint,
              JSON.stringify(fixture.payload),
            ],
          ),
          /TEMU_EXACT_CABLE_ACTIVE_CREDENTIAL_REQUIRED/,
        );
      } finally {
        await db.exec("rollback").catch(() => undefined);
      }
    });

    await t.test("exact cable create refuses source inventory above stock one", async () => {
      await db.exec("begin");
      try {
        await db.query(
          "update sellerpilot_private.products set on_hand=2 where id=$1",
          [EXACT_TEMU_PRODUCT_ID],
        );
        const fixture = exactTemuCreateFixture("temu-exact-cable-source-stock-0001");
        await assert.rejects(
          reserveExactTemuCreate(db, exactCreatePrerequisites.credentialId, fixture),
          /TEMU_EXACT_CABLE_PRODUCT_IDENTITY_MISMATCH/,
        );
      } finally {
        await db.exec("rollback").catch(() => undefined);
      }
    });

    await t.test("exact cable create accepts only the fully bound safe-test request", async () => {
      const cases = [
        {
          label: "valid-control",
          mutate: () => {},
          error: null,
        },
        {
          label: "category-path-instead-of-leaf",
          mutate: (fixture) => { fixture.payload.arguments.body.goodsBasic.extCatName = "생활 > 케이블 정리"; },
          error: /TEMU_EXACT_CABLE_REQUEST_CONTEXT_MISMATCH/,
        },
        {
          label: "shipping-template-missing",
          mutate: (fixture) => { delete fixture.payload.arguments.body.goodsBasic.costTemplate; },
          error: /TEMU_EXACT_CABLE_REQUEST_CONTEXT_MISMATCH/,
        },
        {
          label: "stock-drift",
          mutate: (fixture) => { fixture.payload.arguments.body.skuList[0].quantity = 2; },
          error: /TEMU_EXACT_CABLE_SKU_CONTRACT_MISMATCH/,
        },
        {
          label: "price-drift",
          mutate: (fixture) => { fixture.payload.arguments.body.skuList[0].price.basePrice.amount = "5001"; },
          error: /TEMU_EXACT_CABLE_SKU_CONTRACT_MISMATCH/,
        },
        {
          label: "source-sku-missing",
          mutate: (fixture) => { delete fixture.payload.arguments.sellerpilotTemuCreateCorrelation.sourceSellerSku; },
          error: /TEMU_EXACT_CABLE_EXTERNAL_ID_MISMATCH/,
        },
        {
          label: "scope-fingerprint-drift",
          mutate: (fixture) => {
            fixture.payload.arguments.sellerpilotTemuCreateCorrelation.scopeFingerprint = "f".repeat(64);
          },
          error: /TEMU_EXACT_CABLE_EXTERNAL_ID_MISMATCH/,
        },
        {
          label: "representative-reused-as-detail",
          mutate: (fixture) => {
            fixture.payload.arguments.body.goodsBasic.detailImage[0] = fixture.representativeImage;
          },
          error: /TEMU_EXACT_CABLE_IMAGE_CONTRACT_MISMATCH/,
        },
        {
          label: "second-representative",
          mutate: (fixture) => {
            fixture.payload.arguments.body.goodsBasic.goodsCarouselImage.push(
              "https://assets.example.test/products/temu-exact-cable/hero-2.jpg",
            );
          },
          error: /TEMU_EXACT_CABLE_IMAGE_CONTRACT_MISMATCH/,
        },
        {
          label: "seven-details",
          mutate: (fixture) => { fixture.payload.arguments.body.goodsBasic.detailImage.pop(); },
          error: /TEMU_EXACT_CABLE_IMAGE_CONTRACT_MISMATCH/,
        },
        {
          label: "approved-binding-detail-drift",
          mutate: (fixture) => {
            fixture.payload.arguments.sellerpilotPublicationAssetBinding
              .providerTransportImages[0].publicUrl =
                "https://assets.example.test/products/temu-exact-cable/other-detail.jpg";
          },
          error: /TEMU_EXACT_CABLE_APPROVED_ASSET_BINDING_REQUIRED/,
        },
        {
          label: "live-intent",
          mutate: (fixture) => { fixture.payload.arguments.publicationIntent = "live"; },
          error: /TEMU_EXACT_CABLE_REQUEST_CONTEXT_MISMATCH/,
        },
      ];
      for (const [index, testCase] of cases.entries()) {
        await db.exec("begin");
        try {
          const fixture = exactTemuCreateFixture(
            `temu-exact-cable-create-${String(index + 1).padStart(4, "0")}`,
          );
          testCase.mutate(fixture);
          const before = await scalar(
            db,
            "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where channel='temu' and operation='listing.create'",
          );
          if (testCase.error) {
            await db.exec("savepoint exact_request_rejection");
            await assert.rejects(
              reserveExactTemuCreate(db, exactCreatePrerequisites.credentialId, fixture),
              testCase.error,
              testCase.label,
            );
            await db.exec("rollback to savepoint exact_request_rejection");
            assert.equal(
              await scalar(
                db,
                "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where channel='temu' and operation='listing.create'",
              ),
              before,
              testCase.label,
            );
          } else {
            const reserved = await reserveExactTemuCreate(
              db,
              exactCreatePrerequisites.credentialId,
              fixture,
            );
            assert.equal(reserved.status, "queued");
            assert.match(reserved.listing_id, /^[0-9a-f-]{36}$/i);
            assert.match(reserved.job_id, /^[0-9a-f-]{36}$/i);
            assert.equal(
              await scalar(
                db,
                `select request_payload=$2::jsonb
                   from sellerpilot_private.channel_gateway_jobs where id=$1`,
                [reserved.job_id, JSON.stringify(fixture.payload)],
              ),
              true,
            );
          }
        } finally {
          await db.exec("rollback");
        }
      }
    });

    await t.test("prewrite reaper closes generation one and permits only generation two", async () => {
      await db.exec("begin");
      try {
        const fixture = await seedVerifiedSafeTestListing(db, "1");
        const first = await enqueueActivation(db, fixture, "7".repeat(64));
        await claimActivationWorker(
          db,
          first.enqueue.job_id,
          "test/temu-prewrite-reaper",
        );
        assert.equal(
          await scalar(
            db,
            `select bound_at is not null and consumed_at is null
               from sellerpilot_private.temu_listing_activation_permits
              where activation_job_id=$1`,
            [first.enqueue.job_id],
          ),
          true,
        );
        await db.exec("set local session_replication_role=replica");
        await db.query(
          `update sellerpilot_private.channel_gateway_jobs
              set attempt_count=4,lease_expires_at=clock_timestamp()-interval '1 second'
            where id=$1`,
          [first.enqueue.job_id],
        );
        await db.exec("set local session_replication_role=origin");
        await scalar(
          db,
          "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(10)",
        );
        assert.deepEqual(
          (await db.query(
            `select permit.terminal_status,permit.consumed_at,
                    job.status,listing.status listing_status,
                    listing.requested_publication_intent,
                    listing.remote_visibility,
                    listing.operation_attempt_id::text
               from sellerpilot_private.temu_listing_activation_permits permit
               join sellerpilot_private.channel_gateway_jobs job
                 on job.id=permit.activation_job_id
               join sellerpilot_private.product_listings listing
                 on listing.id=permit.listing_id
              where permit.activation_job_id=$1`,
            [first.enqueue.job_id],
          )).rows,
          [{
            terminal_status: "failed",
            consumed_at: null,
            status: "failed",
            listing_status: "paused",
            requested_publication_intent: "safe_test",
            remote_visibility: "non_public",
            operation_attempt_id: fixture.sourceAttemptId,
          }],
        );
        // Production RPC calls run in separate transactions. Clear the local
        // projection marker before modelling the operator's later request.
        await scalar(
          db,
          "select set_config('sellerpilot.temu_publication_apply','',true)",
        );
        const second = await enqueueActivation(db, fixture, "a".repeat(64));
        assert.equal(second.context.activationGeneration, 2);
        assert.notEqual(second.context.claimIdempotencyKey, first.context.claimIdempotencyKey);
        assert.notEqual(second.enqueue.job_id, first.enqueue.job_id);
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("inactive credential preserves containment and later reactivation enqueues it", async () => {
      await db.exec("begin");
      try {
        const fixture = await seedVerifiedSafeTestListing(db, "2");
        await db.exec("set local session_replication_role=replica");
        await db.query(
          `update sellerpilot_private.channel_gateway_jobs
              set status='reconciliation_required',
                  request_payload=jsonb_set(
                    request_payload,
                    '{arguments,sellerpilotTemuCreateCorrelation}',
                    jsonb_build_object(
                      'version','temu_create_attempt_external_id_v1',
                      'externalGoodsId',$2::text
                    ),
                    true
                  ),
                  response_payload=jsonb_build_object(
                    'remoteId',$3::text,
                    'steps',jsonb_build_array(jsonb_build_object(
                      'name','goods-v3-add','ok',true
                    ))
                  ),
                  error_message='synthetic lost create acknowledgement',
                  completed_at=clock_timestamp(),
                  updated_at=clock_timestamp()
            where id=$1`,
          [fixture.sourceJobId, fixture.externalGoodsId, fixture.goodsId],
        );
        await db.query(
          `update sellerpilot_private.channel_credentials
              set status='invalid',expires_at=clock_timestamp()-interval '1 second'
            where id=$1`,
          [fixture.credentialId],
        );
        await db.exec("set local session_replication_role=origin");

        assert.equal(
          await scalar(
            db,
            "select sellerpilot_private.schedule_temu_safe_test_containment_discovery($1)",
            [fixture.sourceJobId],
          ),
          true,
        );
        assert.deepEqual(
          (await db.query(
            `select status,discovered_goods_id,next_check_at is not null as due
               from sellerpilot_private.temu_safe_test_containment_discoveries
              where source_job_id=$1`,
            [fixture.sourceJobId],
          )).rows,
          [{ status: "discovered", discovered_goods_id: fixture.goodsId, due: true }],
        );
        await setClaims(db, "service_role");
        const deferred = await scalar(
          db,
          "select public.sellerpilot_service_enqueue_due_listing_publication_verifications(14)",
        );
        assert.equal(deferred.temuContainmentDiscovery.deferred, 1);
        assert.equal(deferred.temuContainmentDiscovery.queued, 0);
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.temu_safe_test_containment_permits
              where source_job_id=$1`,
            [fixture.sourceJobId],
          ),
          0,
        );

        await db.exec("set local session_replication_role=replica");
        await db.query(
          `update sellerpilot_private.channel_credentials
              set status='active',expires_at=clock_timestamp()+interval '30 days'
            where id=$1`,
          [fixture.credentialId],
        );
        await db.query(
          `update sellerpilot_private.temu_safe_test_containment_discoveries
              set next_check_at=clock_timestamp()-interval '1 second'
            where source_job_id=$1`,
          [fixture.sourceJobId],
        );
        await db.exec("set local session_replication_role=origin");
        const recovered = await scalar(
          db,
          "select public.sellerpilot_service_enqueue_due_listing_publication_verifications(14)",
        );
        assert.equal(recovered.temuContainmentDiscovery.queued, 1);
        assert.deepEqual(
          (await db.query(
            `select permit.source_job_id::text,permit.listing_id::text,
                    permit.credential_id::text,permit.goods_id,
                    permit.external_goods_id,job.status,job.operation
               from sellerpilot_private.temu_safe_test_containment_permits permit
               join sellerpilot_private.channel_gateway_jobs job
                 on job.id=permit.containment_job_id
              where permit.source_job_id=$1`,
            [fixture.sourceJobId],
          )).rows,
          [{
            source_job_id: fixture.sourceJobId,
            listing_id: fixture.listingId,
            credential_id: fixture.credentialId,
            goods_id: fixture.goodsId,
            external_goods_id: fixture.externalGoodsId,
            status: "queued",
            operation: "listing.stop",
          }],
        );
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("last-write manifest drift blocks begin and post-begin reaper fails closed", async () => {
      await db.exec("begin");
      try {
        const fixture = await seedVerifiedSafeTestListing(db, "3");
        const activation = await enqueueActivation(db, fixture, "b".repeat(64));
        const workerClaim = await claimActivationWorker(
          db,
          activation.enqueue.job_id,
          "test/temu-manifest-drift",
        );
        await db.exec("set local session_replication_role=replica");
        await db.query(
          `update sellerpilot_private.products
              set detail_page_image_manifest=jsonb_set(
                detail_page_image_manifest,'{digest}',to_jsonb($2::text)
              )
            where id=$1`,
          [fixture.productId, "e".repeat(64)],
        );
        await db.exec("set local session_replication_role=origin");
        assert.equal(
          await scalar(
            db,
            `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
              $1,$2,$3
            )`,
            [SERVERLESS_TOKEN_HASH, workerClaim.id, workerClaim.claim_token],
          ),
          false,
        );
        assert.deepEqual(
          (await db.query(
            `select job.provider_mutation_started_at,permit.consumed_at
               from sellerpilot_private.channel_gateway_jobs job
               join sellerpilot_private.temu_listing_activation_permits permit
                 on permit.activation_job_id=job.id
              where job.id=$1`,
            [workerClaim.id],
          )).rows,
          [{ provider_mutation_started_at: null, consumed_at: null }],
        );

        await db.exec("set local session_replication_role=replica");
        await db.query(
          `update sellerpilot_private.products
              set detail_page_image_manifest=jsonb_set(
                detail_page_image_manifest,'{digest}',to_jsonb($2::text)
              )
            where id=$1`,
          [fixture.productId, fixture.manifestDigest],
        );
        await db.exec("set local session_replication_role=origin");
        assert.equal(
          await scalar(
            db,
            `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
              $1,$2,$3
            )`,
            [SERVERLESS_TOKEN_HASH, workerClaim.id, workerClaim.claim_token],
          ),
          true,
        );
        assert.equal(
          await scalar(
            db,
            `select provider_mutation_started_at is not null
                    and permit.consumed_at is not null
               from sellerpilot_private.channel_gateway_jobs job
               join sellerpilot_private.temu_listing_activation_permits permit
                 on permit.activation_job_id=job.id
              where job.id=$1`,
            [workerClaim.id],
          ),
          true,
        );
        await db.exec("set local session_replication_role=replica");
        await db.query(
          `update sellerpilot_private.channel_gateway_jobs
              set lease_expires_at=clock_timestamp()-interval '1 second'
            where id=$1`,
          [workerClaim.id],
        );
        await db.exec("set local session_replication_role=origin");
        const reaped = await scalar(
          db,
          "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(10)",
        );
        assert.equal(reaped.reconciliationRequired, 1);
        assert.deepEqual(
          (await db.query(
            `select permit.terminal_status,permit.consumed_at is not null as consumed,
                    job.status,listing.status listing_status,
                    listing.requested_publication_intent,
                    listing.remote_visibility,listing.failure_class
               from sellerpilot_private.temu_listing_activation_permits permit
               join sellerpilot_private.channel_gateway_jobs job
                 on job.id=permit.activation_job_id
               join sellerpilot_private.product_listings listing
                 on listing.id=permit.listing_id
              where permit.activation_job_id=$1`,
            [workerClaim.id],
          )).rows,
          [{
            terminal_status: "reconciliation_required",
            consumed: true,
            status: "reconciliation_required",
            listing_status: "failed",
            requested_publication_intent: "live",
            remote_visibility: "unknown",
            failure_class: "external_action",
          }],
        );
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("missing Temu terminal evidence is NULL-safe and cannot complete an activation", async () => {
      const cases = [
        { label: "valid-control", missing: null, expectedValid: true },
        { label: "image-order", missing: "imageOrderVerified", expectedValid: false },
        { label: "content", missing: "contentVerified", expectedValid: false },
        { label: "representative", missing: "representativeImageVerified", expectedValid: false },
        { label: "representative-count", missing: "observedRepresentativeImageCount", expectedValid: false },
        { label: "representative-digest", missing: "representativeImageDigest", expectedValid: false },
        { label: "sku-identity", missing: "skuIdentityVerified", expectedValid: false },
        { label: "price", missing: "priceVerified", expectedValid: false },
        { label: "stock", missing: "stockVerified", expectedValid: false },
        { label: "version", missing: "version", expectedValid: false },
        { label: "sku-count", missing: "observedSkuCount", expectedValid: false },
        { label: "readback-methods", missing: "readbackMethods", expectedValid: false },
        { label: "asset-binding", missing: "publicationAssetBinding", expectedValid: false },
      ];
      for (const testCase of cases) {
        await db.exec("begin");
        try {
          const fixture = await seedVerifiedSafeTestListing(db, "5");
          const fingerprint = "d".repeat(64);
          const activation = await enqueueActivation(db, fixture, fingerprint);
          const workerClaim = await claimActivationWorker(
            db,
            activation.enqueue.job_id,
            `test/temu-null-safe-${testCase.label}`,
          );
          assert.equal(
            await scalar(
              db,
              `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
                $1,$2,$3
              )`,
              [SERVERLESS_TOKEN_HASH, workerClaim.id, workerClaim.claim_token],
            ),
            true,
          );
          const remoteState = validTemuActivationRemoteState(fixture, fingerprint);
          if (testCase.missing) delete remoteState.evidence[testCase.missing];
          const completion = await scalar(
            db,
            `select public.sellerpilot_service_complete_serverless_cs_transaction(
              $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
            )`,
            [
              SERVERLESS_TOKEN_HASH,
              workerClaim.id,
              workerClaim.claim_token,
              JSON.stringify({
                ok: true,
                channel: "temu",
                operation: "listing.activate",
                publicationFulfilled: true,
                publicationIntent: "live",
                publicationStateContract: "verified_remote_state_v1",
                remoteId: fixture.goodsId,
                remoteState,
              }),
            ],
          );
          assert.equal(completion.status, "completed", testCase.label);
          assert.equal(
            await scalar(
              db,
              `select sellerpilot_private.temu_terminal_remote_state_valid(
                $1,$2,$3,8,array['live','pending_review']::text[]
              )`,
              [workerClaim.id, fixture.goodsId, fixture.externalGoodsId],
            ),
            testCase.expectedValid,
            testCase.label,
          );
          const outcome = (await db.query(
            `select permit.terminal_status,listing.status listing_status,
                    listing.remote_visibility
               from sellerpilot_private.temu_listing_activation_permits permit
               join sellerpilot_private.product_listings listing
                 on listing.id=permit.listing_id
              where permit.activation_job_id=$1`,
            [workerClaim.id],
          )).rows[0];
          if (testCase.expectedValid) {
            assert.deepEqual(outcome, {
              terminal_status: "succeeded",
              listing_status: "published",
              remote_visibility: "live",
            }, testCase.label);
          } else {
            assert.deepEqual(outcome, {
              terminal_status: "reconciliation_required",
              listing_status: "failed",
              remote_visibility: "unknown",
            }, testCase.label);
          }
        } finally {
          await db.exec("rollback");
        }
      }
    });

    await t.test("terminal evidence drift cannot project a live listing", async () => {
      await db.exec("begin");
      try {
        const fixture = await seedVerifiedSafeTestListing(db, "4");
        const activation = await enqueueActivation(db, fixture, "c".repeat(64));
        const workerClaim = await claimActivationWorker(
          db,
          activation.enqueue.job_id,
          "test/temu-terminal-evidence-drift",
        );
        assert.equal(
          await scalar(
            db,
            `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
              $1,$2,$3
            )`,
            [SERVERLESS_TOKEN_HASH, workerClaim.id, workerClaim.claim_token],
          ),
          true,
        );
        const completion = await scalar(
          db,
          `select public.sellerpilot_service_complete_serverless_cs_transaction(
            $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
          )`,
          [
            SERVERLESS_TOKEN_HASH,
            workerClaim.id,
            workerClaim.claim_token,
            JSON.stringify({
              ok: true,
              channel: "temu",
              operation: "listing.activate",
              publicationFulfilled: true,
              publicationIntent: "live",
              remoteId: fixture.goodsId,
              remoteState: {
                verified: true,
                visibility: "live",
                providerStatus: "ON_SHELF",
                locale: "ko-KR",
                fingerprint: "c".repeat(64),
                imageCount: 7,
                verifiedAt: "2026-08-31T12:00:00.000Z",
                resources: {
                  goodsId: fixture.goodsId,
                  externalGoodsId: fixture.externalGoodsId,
                },
                evidence: {
                  identityVerified: true,
                  statusVerified: true,
                  localeVerified: true,
                  fingerprintVerified: true,
                  imageCountVerified: true,
                },
              },
            }),
          ],
        );
        assert.equal(completion.status, "completed");
        assert.deepEqual(
          (await db.query(
            `select permit.terminal_status,permit.consumed_at is not null as consumed,
                    listing.status listing_status,
                    listing.requested_publication_intent,
                    listing.remote_visibility,listing.failure_class
               from sellerpilot_private.temu_listing_activation_permits permit
               join sellerpilot_private.product_listings listing
                 on listing.id=permit.listing_id
              where permit.activation_job_id=$1`,
            [workerClaim.id],
          )).rows,
          [{
            terminal_status: "reconciliation_required",
            consumed: true,
            listing_status: "failed",
            requested_publication_intent: "live",
            remote_visibility: "unknown",
            failure_class: "external_action",
          }],
        );
      } finally {
        await db.exec("rollback");
      }
    });
  } finally {
    await db.close();
  }
});
