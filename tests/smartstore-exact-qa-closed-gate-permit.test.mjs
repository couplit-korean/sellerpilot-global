import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901053500_allow_exact_smartstore_update_through_closed_gate.sql",
  import.meta.url,
);
const representativeFilenameMigrationUrl = new URL(
  "../supabase/migrations/20260901070000_correct_smartstore_representative_filename.sql",
  import.meta.url,
);
const exactStockMigrationUrl = new URL(
  "../supabase/migrations/20260901174000_require_exact_smartstore_stock_one.sql",
  import.meta.url,
);
const listingId = "7babb554-48dc-4869-81b1-cd4d435d7b96";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const credentialId = "2aa76829-3d63-4842-9c3e-622acd3d0d2f";
const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const attemptId = "11111111-1111-4111-8111-111111111111";
const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const sellerAccountKey =
  "fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

function exactArguments(representativeFilename = "thumbnail-square.png") {
  const details = Array.from({ length: 8 }, (_, offset) => {
    const index = offset + 1;
    const digest = index.toString(16).padStart(64, "0");
    const objectPath = `normalized/${digest.slice(0, 2)}/${digest}.jpg`;
    return {
      role: `detail-section-${index}`,
      approvedObjectPath:
        `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/detail-${index}.png`,
      approvedSourceSha256: (index + 16).toString(16).padStart(64, "0"),
      publicUrl:
        `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
      objectPath,
      contentSha256: digest,
    };
  });
  const representativeDigest = "f".repeat(64);
  const representative = {
    role: "gallery-representative",
    approvedObjectPath:
      `results/33333333-3333-4333-8333-333333333333/claims/44444444-4444-4444-8444-444444444444/${representativeFilename}`,
    approvedSourceSha256: "e".repeat(64),
    publicUrl:
      `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/ff/${representativeDigest}.jpg`,
    objectPath: `normalized/ff/${representativeDigest}.jpg`,
    contentSha256: representativeDigest,
  };
  return {
    originProductNo: "13671684696",
    imageUrls: [representative.publicUrl, ...details.map((image) => image.publicUrl)],
    body: {
      originProduct: {
        name: "부착형 케이블 정리 클립 6개 세트",
        detailContent: [
          "<p>케이블을 깔끔하게 정리하는 부착형 클립 세트입니다.</p>",
          ...details.map((image) => `<img src="${image.publicUrl}" alt="상세 이미지">`),
        ].join(""),
        salePrice: 5000,
        stockQuantity: 1,
        detailAttribute: {
          sellerCodeInfo: { sellerManagementCode: "QA-20260823-CC-001" },
        },
      },
      smartstoreChannelProduct: {
        channelProductName: "부착형 케이블 정리 클립 6개 세트",
      },
    },
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: fingerprint,
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailPageVersion: 1,
      approvedManifestDigest: "c".repeat(64),
      approvedDetailImages: details,
      providerImageSurface: "gallery",
      providerTransportImages: [representative, ...details.map((image) => ({
        role: image.role,
        publicUrl: image.publicUrl,
        objectPath: image.objectPath,
        contentSha256: image.contentSha256,
      }))],
    },
    sellerpilotSmartstoreExactQaRecovery: {
      contract: "smartstore_exact_qa_recovery_v1",
      phase: "listing.update",
      productId,
      listingId,
      originProductNo: "13671684696",
      channelProductNo: "13732202182",
      centralSku: "QA-20260823-CC-001",
      sellerManagementCodeSource: "provider_readback_required",
      sellerAccountLineage: "validated_by_service_rpc",
    },
  };
}

test("Smartstore exact closed-gate permit is five-minute, one-use, and provider-bound", async () => {
  const [migration, filenameMigration, exactStockMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(representativeFilenameMigrationUrl, "utf8"),
    readFile(exactStockMigrationUrl, "utf8"),
  ]);
  assert.match(migration, /expires_at <= armed_at \+ interval '5 minutes'/u);
  assert.match(migration, /create unique index smartstore_exact_qa_one_active_update_per_listing/u);
  assert.match(migration, /sellerpilot_service_arm_exact_smartstore_qa_update/u);
  assert.match(migration, /bind_exact_smartstore_qa_update_claim/u);
  assert.match(migration, /consume_exact_smartstore_qa_update_provider/u);
  assert.match(migration, /sellerpilot_300950_begin_gateway_mutation_before_release_gate/u);
  assert.match(migration, /sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate/u);
  assert.match(
    migration,
    /update_job_id is null[\s\S]*?bound_claim_token is null[\s\S]*?consumed_at is null/u,
  );
  assert.match(
    migration,
    /job\.attempt_count = 1[\s\S]*?job\.provider_mutation_started_at is null[\s\S]*?permit\.consumed_at is null/u,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.listing_mutation_release_gate/iu,
    "the forward migration must not open or modify the generic gate",
  );
  assert.match(filenameMigration, /pg_catalog\.pg_get_functiondef/u);
  assert.match(filenameMigration, /thumbnail-square\[\.\]png/u);
  assert.doesNotMatch(
    filenameMigration,
    /update\s+sellerpilot_private\.listing_mutation_release_gate/iu,
    "the filename correction must not modify the generic release gate",
  );
  assert.match(
    exactStockMigration,
    /v_origin->>''stockQuantity'' is not distinct from ''1''/u,
  );
  assert.match(
    exactStockMigration,
    /requires no active exact update job/u,
  );
  assert.match(exactStockMigration, /requires no active permit/u);
  assert.doesNotMatch(
    exactStockMigration,
    /update\s+sellerpilot_private\.listing_mutation_release_gate/iu,
    "the exact-stock correction must not modify the generic release gate",
  );
});

test("Smartstore exact SQL payload fence accepts only Korean copy, stock one, and one plus eight approved assets", async () => {
  const [migration, filenameMigration, exactStockMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(representativeFilenameMigrationUrl, "utf8"),
    readFile(exactStockMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.smartstore_exact_qa_html_image_urls(",
    ));
    const validator = extractFunction(
      migration,
      "create function sellerpilot_private.smartstore_exact_qa_update_arguments_valid(",
    );
    await db.exec(validator);
    const legacy = exactArguments("square.png");
    const valid = exactArguments();
    const allowed = async (argumentsValue) => (await db.query(
      `select sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
         $1::jsonb,$2
       ) value`,
      [JSON.stringify(argumentsValue), releaseSha],
    )).rows[0].value;
    assert.equal(await allowed(legacy), true, "the historical preimage must stay reproducible");
    assert.equal(await allowed(valid), false, "the historical mismatch must be reproduced");

    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
    `);
    await db.exec(filenameMigration);
    assert.equal(await allowed(valid), true, "the forward patch must allow the canonical asset");
    assert.equal(await allowed(legacy), false, "the legacy filename must remain closed");

    const stockAboveExact = structuredClone(valid);
    stockAboveExact.body.originProduct.stockQuantity = 2;
    assert.equal(
      await allowed(stockAboveExact),
      true,
      "the historical validator accepted any positive stock before the exact-stock patch",
    );
    await db.exec(`
      create table sellerpilot_private.channel_gateway_jobs (
        channel text not null,
        operation text not null,
        status text not null,
        request_payload jsonb not null
      );
      create table sellerpilot_private.smartstore_exact_qa_update_permits (
        listing_id uuid not null,
        invalidated_at timestamptz,
        consumed_at timestamptz,
        expires_at timestamptz not null
      );
    `);
    await db.exec(exactStockMigration);
    assert.equal(await allowed(valid), true, "the exact one-unit stock must remain allowed");
    assert.equal(await allowed(stockAboveExact), false, "stock above one must be rejected");

    const nearMisses = [
      (value) => { value.sellerpilotSmartstoreExactQaRecovery.listingId = crypto.randomUUID(); },
      (value) => { value.body.originProduct.name = "Cable organizer clips"; },
      (value) => { value.body.originProduct.stockQuantity = 2; },
      (value) => { value.imageUrls.push(value.imageUrls[0]); },
      (value) => {
        value.sellerpilotPublicationAssetBinding.providerTransportImages.reverse();
      },
      (value) => {
        value.sellerpilotPublicationAssetBinding.providerTransportImages[1]
          .contentSha256 = "d".repeat(64);
      },
      (value) => {
        value.sellerpilotPublicationAssetBinding.providerTransportImages[0]
          .approvedObjectPath = value.sellerpilotPublicationAssetBinding
            .providerTransportImages[0].approvedObjectPath.replace(
              "thumbnail-square.png",
              "hero.png",
            );
      },
    ];
    for (const mutate of nearMisses) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      assert.equal(await allowed(invalid), false);
    }
  } finally {
    await db.close();
  }
});

test("Smartstore closed-gate enqueue bypass rejects every near-miss before a job exists", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create function sellerpilot_private.smartstore_exact_qa_release_is_current(value text)
      returns boolean language sql immutable as $$ select value = '${releaseSha}' $$;
      create function sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
        value jsonb, current_release text
      ) returns boolean language sql immutable as $$
        select value#>>'{sellerpilotSmartstoreExactQaRecovery,contract}' =
                 'smartstore_exact_qa_recovery_v1'
          and value->>'publicationExpectedFingerprint' = '${fingerprint}'
          and current_release = '${releaseSha}'
      $$;
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key,
        owner_id uuid not null,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        status text not null,
        request_fingerprint text not null
      );
      create table sellerpilot_private.smartstore_exact_qa_update_permits (
        listing_id uuid not null,
        product_id uuid not null,
        credential_id uuid not null,
        owner_id uuid not null,
        origin_product_no text not null,
        channel_product_no text not null,
        seller_account_key text not null,
        release_sha text not null,
        request_fingerprint text not null,
        update_job_id uuid,
        update_attempt_id uuid,
        arguments_sha256 text,
        request_payload_sha256 text,
        bound_at timestamptz,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        expires_at timestamptz not null
      );
    `);
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.smartstore_exact_qa_enqueue_gate_bypass_allowed(",
    ));
    await db.query(`
      insert into sellerpilot_private.channel_operation_attempts(
        id,owner_id,credential_id,channel,operation,status,request_fingerprint
      ) values($1,$2,$3,'smartstore','listing.update','running',$4)
    `, [attemptId, ownerId, credentialId, fingerprint]);
    await db.query(`
      insert into sellerpilot_private.smartstore_exact_qa_update_permits(
        listing_id,product_id,credential_id,owner_id,origin_product_no,
        channel_product_no,seller_account_key,release_sha,request_fingerprint,
        expires_at
      ) values($1,$2,$3,$4,'13671684696','13732202182',$5,$6,$7,
        statement_timestamp()+interval '5 minutes')
    `, [
      listingId,
      productId,
      credentialId,
      ownerId,
      sellerAccountKey,
      releaseSha,
      fingerprint,
    ]);
    const requestPayload = JSON.stringify({ arguments: exactArguments() });
    const allowed = async ({
      listing = listingId,
      credential = credentialId,
      attempt = attemptId,
      channel = "smartstore",
      operation = "listing.update",
      payload = requestPayload,
    } = {}) => (await db.query(
      `select sellerpilot_private.smartstore_exact_qa_enqueue_gate_bypass_allowed(
         $1,$2,$3,$4,$5,$6::jsonb
       ) value`,
      [listing, credential, attempt, channel, operation, payload],
    )).rows[0].value;

    assert.equal(await allowed(), true);
    for (const nearMiss of [
      { listing: crypto.randomUUID() },
      { credential: crypto.randomUUID() },
      { attempt: crypto.randomUUID() },
      { channel: "qoo10" },
      { operation: "listing.create" },
      { payload: "{}" },
      { payload: requestPayload.replace(fingerprint, "e".repeat(64)) },
    ]) assert.equal(await allowed(nearMiss), false);

    await db.query(
      `update sellerpilot_private.smartstore_exact_qa_update_permits
          set update_job_id=$1`,
      [crypto.randomUUID()],
    );
    assert.equal(await allowed(), false, "a bound permit cannot admit another job");
  } finally {
    await db.close();
  }
});
