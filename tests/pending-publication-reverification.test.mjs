import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const RELEASE_SHA = "a".repeat(40);
const OTHER_RELEASE_SHA = "b".repeat(40);
const SELLER_ACCOUNT_KEY = "c".repeat(64);
const CREDENTIAL_FINGERPRINT = "d".repeat(64);
const WORKER_TOKEN_HASH = "e".repeat(64);
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "00000000-0000-4000-8000-000000000002";
const VAULT_SECRET_ID = "00000000-0000-4000-8000-000000000003";
const WORKER_TOKEN_ID = "00000000-0000-4000-8000-000000000004";
const PUBLICATION_CHANNELS = [
  "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay",
];
const DETAIL_ROLES = [
  "detail-overview", "detail-context", "detail-package", "detail-feature",
  "detail-contents", "detail-use", "detail-care", "detail-routine",
];
const STUDIO_ASSET_ROLES = [
  "hero", "square", "portrait", "wide",
  "detail-overview", "detail-feature", "detail-use", "detail-package",
  "detail-routine", "detail-scale", "detail-storage", "detail-context",
  "detail-material", "detail-dimensions", "detail-contents", "detail-care",
];

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function jsonDigest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function stripUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "")
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
}

async function compatibilityLayer() {
  // Keep the focused test on the same PGlite/Supabase emulation contract as
  // the main migration suite without changing that shared test file.
  const source = await readFile(
    new URL("./supabase-migrations.test.mjs", import.meta.url),
    "utf8",
  );
  const match = source.match(
    /const supabaseCompatibilityLayer = String\.raw`([\s\S]*?)`;\n\nfunction withoutUnavailableExtensions/,
  );
  assert.ok(match, "shared Supabase compatibility layer must remain discoverable");
  return match[1];
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(await compatibilityLayer());
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
  const migrationNames = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrationNames) {
    await db.exec(stripUnavailableExtensions(
      await readFile(new URL(name, migrationUrl), "utf8"),
    ));
  }
  return db;
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function asReplica(db, work) {
  await db.exec("set session_replication_role = replica;");
  try {
    return await work();
  } finally {
    await db.exec("set session_replication_role = origin;");
  }
}

async function seedPrincipal(db) {
  await asReplica(db, async () => {
    await db.query(
      "insert into auth.users (id,email) values ($1,'publication-review@example.test')",
      [OWNER_ID],
    );
    await db.query(
      `insert into vault.secrets (id,secret,name)
       values ($1,'{"access_key":"safe-test"}','publication-review-test')`,
      [VAULT_SECRET_ID],
    );
    await db.query(
      `insert into sellerpilot_private.channel_credentials (
         id,channel,environment,version,vault_secret_id,fingerprint,status,
         expires_at,created_by,seller_account_key,seller_account_key_source,
         seller_account_verified_at
       ) values (
         $1,'qoo10','production',1,$2,$3,'active',
         clock_timestamp() + interval '1 day',$4,$5,
         'credential_incarnation_v1',clock_timestamp()
       )`,
      [
        CREDENTIAL_ID,
        VAULT_SECRET_ID,
        CREDENTIAL_FINGERPRINT,
        OWNER_ID,
        SELLER_ACCOUNT_KEY,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         id,label,token_hash,fingerprint,status,expires_at,created_by,scope
       ) values (
         $1,'publication verifier',$2,'PUBVERIFY001','active',
         clock_timestamp() + interval '1 day',$3,'gateway'
       )`,
      [WORKER_TOKEN_ID, WORKER_TOKEN_HASH, OWNER_ID],
    );
  });
}

function reviewIdentity(index) {
  const base = 100 + index * 10;
  const digit = (index % 15).toString(16);
  return {
    productId: uuid(base + 1),
    attemptId: uuid(base + 2),
    listingId: uuid(base + 3),
    sourceJobId: uuid(base + 4),
    verifierJobId: uuid(base + 5),
    claimToken: uuid(base + 6),
    fingerprint: digit.repeat(64),
    remoteId: `remote-product-${index}`,
    market: "JP",
    targetId: `jp-shop-${index}`,
    marketplaceSku: `MARKET-SKU-${index}`,
    locale: "ja-JP",
  };
}

function publicationAssets(identity) {
  const images = DETAIL_ROLES.map((role, index) => {
    const contentSha256 = String(index + 1).padStart(64, "0");
    const approvedSourceSha256 = String(index + 17).padStart(64, "0");
    const objectPath = `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
    const approvedObjectPath = `results/${identity.productId}/claims/${identity.attemptId}/${role}.png`;
    return {
      role,
      approvedObjectPath,
      approvedSourceSha256,
      sourceObjectPath: approvedObjectPath,
      sourceSha256: approvedSourceSha256,
      publicUrl: `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
      objectPath,
      contentSha256,
    };
  });
  const approvedManifestDigest = "a".repeat(64);
  const binding = {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest,
    approvedDetailImages: images,
    providerImageSurface: "detail_content",
    providerTransportImages: images.map((image) => ({
      role: image.role,
      publicUrl: image.publicUrl,
      objectPath: image.objectPath,
      contentSha256: image.contentSha256,
    })),
  };
  return {
    images,
    manifest: {
      contract: "sellerpilot_detail_image_manifest_v2",
      algorithm: "sha256",
      digest: approvedManifestDigest,
      images: images.map(({ role, approvedObjectPath, approvedSourceSha256 }) => ({
        role,
        path: approvedObjectPath,
        sourceSha256: approvedSourceSha256,
      })),
    },
    binding,
    providerBinding: {
      contract: "sellerpilot_provider_asset_binding_v1",
      sourceAssetBindingDigest: jsonDigest(binding),
      approvedManifestDigest,
      approvedDetailPageVersion: 1,
      approvedDetailRoles: DETAIL_ROLES,
      providerImageSurface: "detail_content",
      providerTransportRoles: DETAIL_ROLES,
      providerDetailImageIdentities: images.map(({ publicUrl }) => publicUrl),
      providerImageDigest: jsonDigest(images.map(({ publicUrl }) => publicUrl)),
    },
  };
}

function evidence(identity) {
  const contentDigest = "d".repeat(64);
  const imageDigest = "e".repeat(64);
  return {
    identityVerified: true,
    statusVerified: true,
    localeVerified: true,
    fingerprintVerified: true,
    imageCountVerified: true,
    contentVerified: true,
    sourceContentVerified: true,
    languageContentVerified: true,
    titleLanguageVerified: true,
    descriptionLanguageVerified: true,
    detailImageCountVerified: true,
    approvedManifestDigestVerified: true,
    sourceIdentityVerified: true,
    contentDigestVerified: true,
    sourceJobId: identity.sourceJobId,
    sourceOperation: "listing.create",
    sourceContentDigest: contentDigest,
    remoteContentDigest: contentDigest,
    sourceImageDigest: imageDigest,
    remoteImageDigest: imageDigest,
    remoteProjectionDigest: contentDigest,
    providerImageSurface: "detail_content",
  };
}

function publicationArguments(identity, check) {
  return {
    publicationReviewId: identity.listingId,
    publicationReviewSourceJobId: identity.sourceJobId,
    publicationReviewCheck: check,
    sellerpilotReadOnly: true,
    remoteId: identity.remoteId,
    market: identity.market,
    targetId: identity.targetId,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: identity.locale,
    publicationExpectedFingerprint: identity.fingerprint,
    publicationExpectedImageCount: 8,
    remoteResources: { remoteId: identity.remoteId },
  };
}

function remoteState(identity, visibility, verifiedAt) {
  return {
    verified: true,
    visibility,
    providerStatus: visibility.toUpperCase(),
    verifiedAt,
    createdAt: verifiedAt,
    evidence: evidence(identity),
    resources: { remoteId: identity.remoteId },
    locale: identity.locale,
    fingerprint: identity.fingerprint,
    imageCount: 8,
  };
}

function verifierResponse(identity, visibility, verifiedAt) {
  return {
    ok: true,
    channel: "qoo10",
    operation: "listing.publication.verify",
    remoteId: identity.remoteId,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    remoteState: remoteState(identity, visibility, verifiedAt),
    publicationFulfilled: visibility === "live",
    ...(visibility === "live"
      ? { publicUrl: `https://example.test/items/${identity.remoteId}` }
      : {}),
  };
}

async function seedReview(db, index, options = {}) {
  const identity = reviewIdentity(index);
  const assets = publicationAssets(identity);
  const reviewStatus = options.reviewStatus ?? "pending";
  const checkCount = options.checkCount ?? 0;
  const lastJobStatus = options.lastJobStatus ?? null;
  const deadlineInterval = options.deadlineInterval ?? "60 minutes";
  const nextCheckInterval = options.nextCheckInterval ?? "-1 second";
  const sourceVerifiedAt = new Date(Date.now() - 120_000).toISOString();
  const sourceRequest = {
    arguments: {
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: identity.locale,
      publicationExpectedFingerprint: identity.fingerprint,
      publicationExpectedImageCount: 8,
      sellerpilotPublicationAssetBinding: assets.binding,
      params: {
        ItemTitle: "日本語の商品名",
        ItemDescription: `<p>日本語の商品詳細です。</p>${assets.images.map(({ publicUrl }) => `<img src="${publicUrl}">`).join("")}`,
      },
    },
  };
  const sourceResponse = {
    ok: true,
    channel: "qoo10",
    operation: "listing.create",
    remoteId: identity.remoteId,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    remoteState: {
      ...remoteState(identity, "pending_review", sourceVerifiedAt),
      evidence: {
        ...remoteState(identity, "pending_review", sourceVerifiedAt).evidence,
        publicationAssetBinding: assets.providerBinding,
      },
    },
    publicationFulfilled: false,
    steps: [{
      name: "GetItemDetailInfo-publication-readback",
      ok: true,
      status: 200,
      data: {
        ResultCode: 0,
        ResultObject: {
          ItemNo: identity.remoteId,
          ItemStatus: "S1",
          ItemTitle: "日本語の商品名",
          ItemDetail: `<p>日本語の商品詳細です。</p>${assets.images.map(({ publicUrl }) => `<img src="${publicUrl}">`).join("")}`,
        },
      },
    }],
  };

  await asReplica(db, async () => {
    await db.query(
      `insert into sellerpilot_private.products (
         id,owner_id,external_code,sku,name,description,status,
         detail_page_data,detail_page_version,detail_page_updated_at,
         detail_page_approved_version,detail_page_image_manifest
       ) values (
         $1,$2,$3,$4,$5,'publication review fixture','draft',
         '{}'::jsonb,1,clock_timestamp(),1,$6::jsonb
       )`,
      [
        identity.productId,
        OWNER_ID,
        `PRODUCT-${index}`,
        `SKU-${index}`,
        `Publication fixture ${index}`,
        JSON.stringify(assets.manifest),
      ],
    );
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts (
         id,owner_id,credential_id,channel,operation,idempotency_key,
         request_fingerprint,status,http_status,remote_id,started_at,
         completed_at,gateway_write_required,seller_account_key
       ) values (
         $1,$2,$3,'qoo10','listing.create',$4,$5,'succeeded',200,$6,
         clock_timestamp() - interval '4 minutes',
         clock_timestamp() - interval '2 minutes',true,$7
       )`,
      [
        identity.attemptId,
        OWNER_ID,
        CREDENTIAL_ID,
        `publication-source-${index}`,
        identity.fingerprint,
        identity.remoteId,
        SELLER_ACCOUNT_KEY,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id,owner_id,product_id,channel_key,remote_id,status,currency,price,
         operation_attempt_id,last_verified_at,market,target_id,failure_class,
         marketplace_sku,seller_account_key,requested_publication_intent,
         remote_visibility,provider_status,remote_resources,remote_created_at
       ) values (
         $1,$2,$3,'qoo10',$4,'paused','JPY',1000,$5,$6,$7,$8,null,$9,$10,
         'live','pending_review','PENDING_REVIEW',$11::jsonb,$6
       )`,
      [
        identity.listingId,
        OWNER_ID,
        identity.productId,
        identity.remoteId,
        identity.attemptId,
        sourceVerifiedAt,
        identity.market,
        identity.targetId,
        identity.marketplaceSku,
        SELLER_ACCOUNT_KEY,
        JSON.stringify({
          resources: { remoteId: identity.remoteId },
          verification: {
            verifiedAt: sourceVerifiedAt,
            evidence: evidence(identity),
            locale: identity.locale,
            fingerprint: identity.fingerprint,
            imageCount: 8,
          },
        }),
      ],
    );
    await db.query(
      `insert into sellerpilot_private.marketplace_normalized_assets (
         object_path,content_sha256,status,uploaded_at
       )
       select image->>'objectPath',image->>'contentSha256','available',clock_timestamp()
         from jsonb_array_elements($1::jsonb) as approved(image)
       on conflict (object_path) do nothing`,
      [JSON.stringify(assets.images)],
    );
    await db.query(
      `insert into sellerpilot_private.marketplace_normalized_asset_refs (
         object_path,attempt_id,owner_id,product_id,channel,market,target_id,
         upload_confirmed_at,canonical_public_url,source_object_path,
         source_content_sha256
       )
       select image->>'objectPath',$1,$2,$3,'qoo10',$4,$5,
              clock_timestamp(),image->>'publicUrl',image->>'sourceObjectPath',
              image->>'sourceSha256'
         from jsonb_array_elements($6::jsonb) as approved(image)`,
      [
        identity.attemptId,
        OWNER_ID,
        identity.productId,
        identity.market,
        identity.targetId,
        JSON.stringify(assets.images),
      ],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,response_payload,status,created_by,created_at,started_at,
         completed_at,write_resource_kind,write_resource_key,request_fingerprint,
         seller_account_key,provider_mutation_started_at
       ) values (
         $1,$2,$3,$4,'qoo10','listing.create','production',$5::jsonb,$6::jsonb,
         'succeeded',$7,clock_timestamp() - interval '4 minutes',
         clock_timestamp() - interval '3 minutes',
         clock_timestamp() - interval '2 minutes','listing_mutation',$8,$8,$9,
         clock_timestamp() - interval '3 minutes'
       )`,
      [
        identity.sourceJobId,
        CREDENTIAL_ID,
        identity.attemptId,
        identity.listingId,
        JSON.stringify(sourceRequest),
        JSON.stringify(sourceResponse),
        OWNER_ID,
        identity.fingerprint,
        SELLER_ACCOUNT_KEY,
      ],
    );

    if (lastJobStatus) {
      const running = lastJobStatus === "running";
      const terminal = ["succeeded", "failed", "reconciliation_required"].includes(lastJobStatus);
      const lastResponse = options.lastResponse
        ?? (lastJobStatus === "succeeded"
          ? verifierResponse(identity, "pending_review", sourceVerifiedAt)
          : null);
      await db.query(
        `insert into sellerpilot_private.channel_gateway_jobs (
           id,credential_id,attempt_id,listing_id,channel,operation,environment,
           request_payload,response_payload,status,error_message,worker_token_id,
           attempt_count,lease_expires_at,created_by,started_at,completed_at,
           claim_token,request_fingerprint,seller_account_key
         ) values (
           $1,$2,null,$3,'qoo10','listing.publication.verify','production',
           $4::jsonb,$5::jsonb,$6,$7,$8,$9,
           case when $6 = 'running' then clock_timestamp() + $10::interval else null end,
           $11,
           case when $6 = 'queued' then null else clock_timestamp() - interval '1 minute' end,
           case when $12 then clock_timestamp() else null end,
           case when $6 = 'running' then $13::uuid else null end,$14,$15
         )`,
        [
          identity.verifierJobId,
          CREDENTIAL_ID,
          identity.listingId,
          JSON.stringify({ arguments: publicationArguments(identity, checkCount) }),
          lastResponse ? JSON.stringify(lastResponse) : null,
          lastJobStatus,
          terminal && lastJobStatus !== "succeeded" ? "publication readback failed" : null,
          running ? WORKER_TOKEN_ID : null,
          options.attemptCount ?? (running ? 1 : 0),
          options.leaseInterval ?? "5 minutes",
          OWNER_ID,
          terminal,
          identity.claimToken,
          identity.fingerprint,
          SELLER_ACCOUNT_KEY,
        ],
      );
    }

    await db.query(
      `insert into sellerpilot_private.listing_publication_reviews (
         listing_id,owner_id,product_id,source_job_id,source_attempt_id,
         credential_id,seller_account_key,channel,environment,market,target_id,
         expected_remote_id,expected_locale,expected_fingerprint,
         expected_image_count,marketplace_sku,status,next_check_at,deadline_at,
         check_count,last_job_id,remote_state,last_verified_at,created_at,updated_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,'qoo10','production',$8,$9,$10,$11,$12,8,$13,
         $14,
         case when $14 = 'pending' then clock_timestamp() + $15::interval else null end,
         clock_timestamp() + $16::interval,$17,$18,$19::jsonb,$20,
         clock_timestamp() - interval '5 minutes',clock_timestamp()
       )`,
      [
        identity.listingId,
        OWNER_ID,
        identity.productId,
        identity.sourceJobId,
        identity.attemptId,
        CREDENTIAL_ID,
        SELLER_ACCOUNT_KEY,
        identity.market,
        identity.targetId,
        identity.remoteId,
        identity.locale,
        identity.fingerprint,
        identity.marketplaceSku,
        reviewStatus,
        nextCheckInterval,
        deadlineInterval,
        checkCount,
        lastJobStatus ? identity.verifierJobId : null,
        JSON.stringify(sourceResponse.remoteState),
        sourceVerifiedAt,
      ],
    );
  });
  return identity;
}

test("owned live verifier leases alone can hydrate the immutable source operation, body, response, and fingerprint", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    const identity = await seedReview(db, 70, {
      reviewStatus: "verifying",
      checkCount: 1,
      lastJobStatus: "running",
    });
    const assets = publicationAssets(identity);
    await asReplica(db, () => db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set scope='serverless_cs'
        where id=$1`,
      [WORKER_TOKEN_ID],
    ));
    const hydrated = await scalar(
      db,
      `select public.sellerpilot_service_listing_publication_verification_source(
         $1,$2,$3
       )`,
      [WORKER_TOKEN_HASH, identity.verifierJobId, identity.claimToken],
    );
    assert.equal(hydrated.contract, "listing_publication_verification_source_v1");
    assert.equal(hydrated.verificationJobId, identity.verifierJobId);
    assert.equal(hydrated.sourceJobId, identity.sourceJobId);
    assert.equal(hydrated.sourceOperation, "listing.create");
    assert.equal(hydrated.sourceFingerprint, identity.fingerprint);
    assert.equal(hydrated.expectedRemoteId, identity.remoteId);
    assert.equal(hydrated.expectedImageCount, 8);
    assert.equal(hydrated.sourceArguments.publicationExpectedFingerprint, identity.fingerprint);
    assert.equal(hydrated.sourceResponsePayload.operation, "listing.create");
    assert.equal(hydrated.sourceResponsePayload.steps[0].name, "GetItemDetailInfo-publication-readback");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_bind_marketplace_normalized_asset_urls($1,$2::jsonb)",
      [identity.attemptId, JSON.stringify(assets.images)],
    ), true);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_bind_marketplace_normalized_asset_urls($1,$2::jsonb)",
        [identity.attemptId, JSON.stringify(assets.images.map((image) => ({
          ...image,
          publicUrl: image.publicUrl.replace("sellerpilot.supabase.co", "attacker.example"),
        })))],
      ),
      /normalized asset URL binding invalid/,
    );
    await asReplica(db, () => db.query(
      `update sellerpilot_private.marketplace_normalized_asset_refs
          set canonical_public_url = replace(canonical_public_url,'sellerpilot.supabase.co','attacker.example')
        where attempt_id=$1
          and object_path=$2`,
      [identity.attemptId, assets.images[0].objectPath],
    ));
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_listing_publication_verification_source(
           $1,$2,$3
         )`,
        [WORKER_TOKEN_HASH, identity.verifierJobId, identity.claimToken],
      ),
      /publication verification source is unavailable/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_listing_publication_verification_source(
           $1,$2,$3
         )`,
        [WORKER_TOKEN_HASH, identity.verifierJobId, uuid(999999)],
      ),
      /publication verification source ownership required/,
    );
    assert.equal(await scalar(
      db,
      `select has_function_privilege(
         'authenticated',
         'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)',
         'EXECUTE'
       )`,
    ), false);
    assert.equal(await scalar(
      db,
      `select has_function_privilege(
         'service_role',
         'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)',
         'EXECUTE'
       )`,
    ), true);
  } finally {
    await db.close();
  }
});

async function attestRelease(db, sha = RELEASE_SHA) {
  for (const channel of PUBLICATION_CHANNELS) {
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready($1,true,$2)",
      [channel, sha],
    );
  }
  await db.query(
    "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
    [sha],
  );
}

async function activateRuntimeFixture(db, sha = RELEASE_SHA) {
  await asReplica(db, async () => {
    await db.query(
      `insert into sellerpilot_private.serverless_runtime_canary_receipts (
         id,release_id,passed_at,consumed_at
       ) values ($1,$2,clock_timestamp(),clock_timestamp())`,
      [uuid(5), sha],
    );
    await db.query(
      `update cron.job set active=true
        where jobname in (
          'sellerpilot-serverless-cs-wake-v1',
          'sellerpilot-product-research-v1',
          'sellerpilot-channel-sync-v1',
          'sellerpilot-competitor-prices-v1',
          'sellerpilot-kakao-notifications-v1',
          'sellerpilot-maintenance-v1'
        )`,
    );
  });
  assert.equal(await scalar(
    db,
    "select sellerpilot_private.active_serverless_runtime_release_sha()",
  ), sha);
}

async function finishVerifier(db, identity, options = {}) {
  const status = options.status ?? "succeeded";
  const startedAt = await scalar(
    db,
    "select started_at::text from sellerpilot_private.channel_gateway_jobs where id=$1",
    [identity.verifierJobId],
  );
  const boundary = new Date(startedAt).getTime() + (options.verifiedAtOffsetMs ?? 0);
  const response = status === "succeeded"
    ? verifierResponse(identity, options.visibility ?? "pending_review", new Date(boundary).toISOString())
    : null;
  if (response && options.evidenceOverrides) {
    Object.assign(response.remoteState.evidence, options.evidenceOverrides);
  }
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set status=$2,response_payload=$3::jsonb,error_message=$4,
            worker_token_id=null,claim_token=null,lease_expires_at=null,
            completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=$1`,
    [
      identity.verifierJobId,
      status,
      response ? JSON.stringify(response) : null,
      status === "succeeded" ? null : "publication readback failed",
    ],
  );
}

test("Qoo10 can open alone while every other channel and Temu stay fail-closed at all DB boundaries", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    await activateRuntimeFixture(db);
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',true,$1)",
      [RELEASE_SHA],
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
      [RELEASE_SHA],
    );

    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_set_listing_channel_mutation_release_gate('shopee',true,$1)",
        [RELEASE_SHA],
      ),
      /unsupported scoped listing publication channel/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_set_listing_channel_mutation_release_gate('qoo10',true,$1)",
        [OTHER_RELEASE_SHA],
      ),
      /scoped publication components must attest the exact release/,
    );

    const unrelatedRunningJobId = uuid(9690);
    await asReplica(db, () => db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,status,created_by,created_at,started_at,worker_token_id,
         claim_token,lease_expires_at,attempt_count,write_resource_kind,
         write_resource_key,request_fingerprint,seller_account_key
       ) values (
         $1,$2,null,null,'shopee','listing.update','production','{}'::jsonb,
         'running',$3,clock_timestamp(),clock_timestamp(),$4,$5,
         clock_timestamp() + interval '5 minutes',1,'listing_mutation',$6,$6,$7
       )`,
      [
        unrelatedRunningJobId,
        CREDENTIAL_ID,
        OWNER_ID,
        WORKER_TOKEN_ID,
        uuid(9691),
        "7".repeat(64),
        SELLER_ACCOUNT_KEY,
      ],
    ));
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_set_listing_channel_mutation_release_gate('qoo10',true,$1)",
        [RELEASE_SHA],
      ),
      /running listing mutations must drain before scoped release-gate activation/,
    );
    await asReplica(db, () => db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='cancelled',worker_token_id=null,claim_token=null,
              lease_expires_at=null,completed_at=clock_timestamp()
        where id=$1`,
      [unrelatedRunningJobId],
    ));

    const scoped = await scalar(
      db,
      "select public.sellerpilot_service_set_listing_channel_mutation_release_gate('qoo10',true,$1)",
      [RELEASE_SHA],
    );
    assert.equal(scoped.open, true);
    assert.equal(scoped.openedChannel, "qoo10");
    assert.equal(scoped.effectiveOpen, false, "the legacy global bit must stay false");
    assert.equal(scoped.qoo10EffectiveOpen, true);
    assert.equal(scoped.qoo10AttestedRelease, RELEASE_SHA);
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10')",
      ),
      true,
    );
    for (const channel of [...PUBLICATION_CHANNELS.filter((item) => item !== "qoo10"), "temu"]) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.listing_mutation_release_gate_is_effective($1)",
          [channel],
        ),
        false,
        `${channel} must stay closed under the Qoo10 scope`,
      );
    }

    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('shopee',false,null)",
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_listing_mutation_release_gate_status()",
      )).qoo10EffectiveOpen,
      true,
      "an unrelated adapter reset must not close the Qoo10 scope",
    );

    await db.query(
      "select public.sellerpilot_service_set_listing_mutation_release_gate(false,null)",
    );
    await attestRelease(db);
    const global = await scalar(
      db,
      "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
      [RELEASE_SHA],
    );
    assert.equal(global.effectiveOpen, true);
    assert.equal(global.openedChannel, null);
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.listing_mutation_release_gate_is_effective('temu')",
      ),
      false,
      "Temu must stay closed even when the canonical seven-channel gate is open",
    );

    const temuJobId = uuid(9701);
    const temuClaimToken = uuid(9702);
    await asReplica(db, () => db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,status,created_by,created_at,write_resource_kind,
         write_resource_key,request_fingerprint,seller_account_key
       ) values (
         $1,$2,null,null,'temu','listing.update','production','{}'::jsonb,
         'queued',$3,clock_timestamp(),'listing_mutation',$4,$4,$5
       )`,
      [temuJobId, CREDENTIAL_ID, OWNER_ID, "9".repeat(64), SELLER_ACCOUNT_KEY],
    ));

    await assert.rejects(
      db.query(
        "update sellerpilot_private.channel_gateway_jobs set status='running',claim_token=$2 where id=$1",
        [temuJobId, temuClaimToken],
      ),
      /LISTING_MUTATION_RELEASE_GATE_CLOSED/,
      "the queue claim trigger must reject Temu",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3)",
        [WORKER_TOKEN_HASH, temuJobId, temuClaimToken],
      ),
      false,
      "the local provider boundary must reject Temu",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_serverless_gateway_provider_mutation($1,$2,$3)",
        [WORKER_TOKEN_HASH, temuJobId, temuClaimToken],
      ),
      false,
      "the serverless provider boundary must reject Temu",
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
           $1,$2,$3,'temu','KR','','KRW',1,$4,'{}'::jsonb
         )`,
        [uuid(9711), CREDENTIAL_ID, uuid(9712), "8".repeat(64)],
      ),
      /LISTING_MUTATION_RELEASE_GATE_CLOSED/,
      "the atomic listing.create boundary must reject Temu",
    );
    for (const operation of ["listing.update", "listing.stop"]) {
      await assert.rejects(
        db.query(
          `select public.sellerpilot_service_enqueue_listing_gateway_job(
             $1,$2,$3,'temu',$4,'{}'::jsonb
           )`,
          [uuid(9721), CREDENTIAL_ID, uuid(9722), operation],
        ),
        /LISTING_MUTATION_RELEASE_GATE_CLOSED/,
        `${operation} enqueue must reject Temu`,
      );
    }
  } finally {
    await db.close();
  }
});

test("release gate requires one exact SHA and closes on attestation drift", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    await activateRuntimeFixture(db);
    await attestRelease(db);
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',true,$1)",
      [OTHER_RELEASE_SHA],
    );
    await assert.rejects(
      () => db.query(
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [RELEASE_SHA],
      ),
      /exact release/,
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',true,$1)",
      [RELEASE_SHA],
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
      [OTHER_RELEASE_SHA],
    );
    await assert.rejects(
      () => db.query(
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [RELEASE_SHA],
      ),
      /exact release/,
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
      [RELEASE_SHA],
    );
    const opened = await scalar(
      db,
      "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
      [RELEASE_SHA],
    );
    assert.equal(opened.effectiveOpen, true);
    assert.equal(opened.openedRelease, RELEASE_SHA);

    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',true,$1)",
      [OTHER_RELEASE_SHA],
    );
    const adapterDrift = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(adapterDrift.open, false);
    assert.equal(adapterDrift.effectiveOpen, false);
    assert.equal(adapterDrift.openedRelease, null);

    await attestRelease(db);
    await db.query(
      "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
      [RELEASE_SHA],
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
      [OTHER_RELEASE_SHA],
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_listing_mutation_release_gate_status()",
      )).open,
      false,
    );
  } finally {
    await db.close();
  }
});

test("effective gate rejects deadline, reverse orphan, wrong last job, terminal queue, and expired lease", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    await activateRuntimeFixture(db);
    const identity = await seedReview(db, 1, {
      reviewStatus: "queued",
      checkCount: 1,
      lastJobStatus: "queued",
    });
    await attestRelease(db);
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [RELEASE_SHA],
      )).effectiveOpen,
      true,
    );

    await asReplica(db, () => db.query(
      `update sellerpilot_private.listing_publication_reviews
          set deadline_at=clock_timestamp() - interval '1 second'
        where listing_id=$1`,
      [identity.listingId],
    ));
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.listing_mutation_release_gate_is_effective()",
    ), false);
    await asReplica(db, () => db.query(
      `update sellerpilot_private.listing_publication_reviews
          set deadline_at=clock_timestamp() + interval '1 hour'
        where listing_id=$1`,
      [identity.listingId],
    ));

    await asReplica(db, () => db.query(
      "update sellerpilot_private.product_listings set remote_visibility='live' where id=$1",
      [identity.listingId],
    ));
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.listing_mutation_release_gate_is_effective()",
    ), false);
    await asReplica(db, () => db.query(
      "update sellerpilot_private.product_listings set remote_visibility='pending_review' where id=$1",
      [identity.listingId],
    ));

    await asReplica(db, () => db.query(
      `update sellerpilot_private.listing_publication_reviews
          set last_job_id=source_job_id
        where listing_id=$1`,
      [identity.listingId],
    ));
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.listing_mutation_release_gate_is_effective()",
    ), false);
    await asReplica(db, () => db.query(
      "update sellerpilot_private.listing_publication_reviews set last_job_id=$2 where listing_id=$1",
      [identity.listingId, identity.verifierJobId],
    ));

    await asReplica(db, () => db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='failed',completed_at=clock_timestamp()
        where id=$1`,
      [identity.verifierJobId],
    ));
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.listing_mutation_release_gate_is_effective()",
    ), false);

    await asReplica(db, async () => {
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='running',worker_token_id=$2,claim_token=$3,
                attempt_count=1,started_at=clock_timestamp() - interval '1 minute',
                completed_at=null,lease_expires_at=clock_timestamp() - interval '1 second'
          where id=$1`,
        [identity.verifierJobId, WORKER_TOKEN_ID, identity.claimToken],
      );
      await db.query(
        `update sellerpilot_private.listing_publication_reviews
            set status='verifying',next_check_at=null
          where listing_id=$1`,
        [identity.listingId],
      );
    });
    const status = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(status.open, true, "stored switch remains open for dynamic drift");
    assert.equal(status.effectiveOpen, false);
    assert.ok(status.orphanPendingReviews >= 1);
  } finally {
    await db.close();
  }
});

test("stale verifier leases requeue below four attempts and recover terminal jobs into pending or manual", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    const retried = await seedReview(db, 2, {
      reviewStatus: "verifying",
      checkCount: 1,
      lastJobStatus: "running",
      attemptCount: 3,
      leaseInterval: "-1 second",
    });
    const firstReap = await scalar(
      db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(100)",
    );
    assert.equal(firstReap.retried, 1);
    assert.equal(firstReap.failed, 0);
    assert.equal(await scalar(
      db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [retried.verifierJobId],
    ), "queued");
    assert.equal(await scalar(
      db,
      "select status from sellerpilot_private.listing_publication_reviews where listing_id=$1",
      [retried.listingId],
    ), "queued");

    const pending = await seedReview(db, 3, {
      reviewStatus: "verifying",
      checkCount: 1,
      lastJobStatus: "running",
      attemptCount: 4,
      leaseInterval: "-1 second",
    });
    const secondReap = await scalar(
      db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(100)",
    );
    assert.equal(secondReap.retried, 0);
    assert.equal(secondReap.failed, 1);
    assert.equal(await scalar(
      db,
      "select status from sellerpilot_private.listing_publication_reviews where listing_id=$1",
      [pending.listingId],
    ), "pending");

    const manual = await seedReview(db, 4, {
      reviewStatus: "verifying",
      checkCount: 8,
      lastJobStatus: "running",
      attemptCount: 4,
      leaseInterval: "-1 second",
    });
    const thirdReap = await scalar(
      db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(100)",
    );
    assert.equal(thirdReap.retried, 0);
    assert.equal(thirdReap.failed, 1);
    assert.equal(await scalar(
      db,
      "select status from sellerpilot_private.listing_publication_reviews where listing_id=$1",
      [manual.listingId],
    ), "manual_required");
    assert.equal(await scalar(
      db,
      "select failure_class from sellerpilot_private.product_listings where id=$1",
      [manual.listingId],
    ), "external_action");
  } finally {
    await db.close();
  }
});

test("verifier completion maps pending and every terminal visibility to the listing ledger", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    const cases = [
      ["pending_review", "pending", "paused", null],
      ["live", "live", "published", null],
      ["rejected", "rejected", "failed", "external_action"],
      ["withdrawn", "withdrawn", "paused", "external_action"],
      ["non_public", "non_public", "paused", "external_action"],
    ];
    for (const [offset, item] of cases.entries()) {
      const [visibility, reviewStatus, listingStatus, failureClass] = item;
      const identity = await seedReview(db, 10 + offset, {
        reviewStatus: "verifying",
        checkCount: 1,
        lastJobStatus: "running",
      });
      await finishVerifier(db, identity, { visibility });
      const row = (await db.query(
        `select review.status as review_status,listing.status as listing_status,
                listing.remote_visibility,listing.failure_class
           from sellerpilot_private.listing_publication_reviews review
           join sellerpilot_private.product_listings listing
             on listing.id=review.listing_id
          where review.listing_id=$1`,
        [identity.listingId],
      )).rows[0];
      assert.deepEqual(row, {
        review_status: reviewStatus,
        listing_status: listingStatus,
        remote_visibility: visibility,
        failure_class: failureClass,
      });
    }

    const manual = await seedReview(db, 16, {
      reviewStatus: "verifying",
      checkCount: 8,
      lastJobStatus: "running",
    });
    await finishVerifier(db, manual, { status: "failed" });
    assert.deepEqual((await db.query(
      `select review.status as review_status,listing.status as listing_status,
              listing.failure_class
         from sellerpilot_private.listing_publication_reviews review
         join sellerpilot_private.product_listings listing
           on listing.id=review.listing_id
        where review.listing_id=$1`,
      [manual.listingId],
    )).rows[0], {
      review_status: "manual_required",
      listing_status: "failed",
      failure_class: "external_action",
    });
  } finally {
    await db.close();
  }
});

test("live completion requires title and description language evidence independently", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    for (const [offset, field] of ["titleLanguageVerified", "descriptionLanguageVerified"].entries()) {
      const identity = await seedReview(db, 17 + offset, {
        reviewStatus: "verifying",
        checkCount: 1,
        lastJobStatus: "running",
      });
      await finishVerifier(db, identity, {
        visibility: "live",
        evidenceOverrides: { [field]: false },
      });
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.listing_publication_reviews where listing_id=$1",
        [identity.listingId],
      ), "pending", field);
      assert.equal(await scalar(
        db,
        "select status || ':' || remote_visibility from sellerpilot_private.product_listings where id=$1",
        [identity.listingId],
      ), "paused:pending_review", field);
    }
  } finally {
    await db.close();
  }
});

test("source attempt, fingerprint, channel, market, and target drift all force manual review", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    const drifts = [
      ["operation_attempt_id=null"],
      ["remote_resources=jsonb_set(remote_resources,'{verification,fingerprint}',to_jsonb($2::text))", "f".repeat(64)],
      ["channel_key='lazada'"],
      ["market='MY'"],
      ["target_id='drifted-target'"],
    ];
    for (const [offset, [assignment, value]] of drifts.entries()) {
      const identity = await seedReview(db, 20 + offset, {
        reviewStatus: "verifying",
        checkCount: 1,
        lastJobStatus: "running",
      });
      await asReplica(db, () => db.query(
        `update sellerpilot_private.product_listings set ${assignment} where id=$1`,
        value === undefined ? [identity.listingId] : [identity.listingId, value],
      ));
      await finishVerifier(db, identity, { visibility: "live" });
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.listing_publication_reviews where listing_id=$1",
        [identity.listingId],
      ), "manual_required", assignment);
      assert.equal(await scalar(
        db,
        "select failure_class from sellerpilot_private.product_listings where id=$1",
        [identity.listingId],
      ), "external_action", assignment);
    }
  } finally {
    await db.close();
  }
});

test("due enqueue and completion replay are idempotent and do not duplicate transition audit", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    await attestRelease(db);
    const identity = await seedReview(db, 30, {
      reviewStatus: "pending",
      checkCount: 0,
      nextCheckInterval: "-1 second",
    });
    const first = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_due_listing_publication_verifications(14)",
    );
    const second = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_due_listing_publication_verifications(14)",
    );
    assert.equal(first.queued, 1);
    assert.equal(second.queued, 0);
    const verifierJobId = await scalar(
      db,
      `select id from sellerpilot_private.channel_gateway_jobs
        where listing_id=$1 and operation='listing.publication.verify'`,
      [identity.listingId],
    );
    identity.verifierJobId = verifierJobId;
    identity.claimToken = uuid(999);
    assert.equal(await scalar(
      db,
      `select count(*)::integer from sellerpilot_private.channel_gateway_jobs
        where listing_id=$1 and operation='listing.publication.verify'`,
      [identity.listingId],
    ), 1);
    assert.equal(await scalar(
      db,
      "select check_count from sellerpilot_private.listing_publication_reviews where listing_id=$1",
      [identity.listingId],
    ), 1);

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='running',worker_token_id=$2,claim_token=$3,attempt_count=1,
              started_at=clock_timestamp() - interval '1 minute',
              lease_expires_at=clock_timestamp() + interval '5 minutes'
        where id=$1`,
      [identity.verifierJobId, WORKER_TOKEN_ID, identity.claimToken],
    );
    await finishVerifier(db, identity, { visibility: "pending_review" });
    assert.equal(await scalar(
      db,
      `select count(*)::integer from sellerpilot_private.operation_audit
        where action='listing_publication_review_transitioned'
          and entity_id=$1`,
      [identity.listingId],
    ), 1);
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.apply_listing_publication_verifier_completion($1)",
      [identity.verifierJobId],
    ), "review_completion_replayed");
    assert.equal(await scalar(
      db,
      `select count(*)::integer from sellerpilot_private.operation_audit
        where action='listing_publication_review_transitioned'
          and entity_id=$1`,
      [identity.listingId],
    ), 1);
  } finally {
    await db.close();
  }
});

test("verifiedAt at the job boundary is accepted while an earlier readback fails closed", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    const exact = await seedReview(db, 40, {
      reviewStatus: "verifying",
      checkCount: 1,
      lastJobStatus: "running",
    });
    await finishVerifier(db, exact, { visibility: "live", verifiedAtOffsetMs: 0 });
    assert.equal(await scalar(
      db,
      "select status from sellerpilot_private.listing_publication_reviews where listing_id=$1",
      [exact.listingId],
    ), "live");

    const before = await seedReview(db, 41, {
      reviewStatus: "verifying",
      checkCount: 8,
      lastJobStatus: "running",
    });
    await finishVerifier(db, before, { visibility: "live", verifiedAtOffsetMs: -1 });
    assert.equal(await scalar(
      db,
      "select status from sellerpilot_private.listing_publication_reviews where listing_id=$1",
      [before.listingId],
    ), "manual_required");
  } finally {
    await db.close();
  }
});

test("an immediate provider-live source completion remains pending until an independent strict verifier", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    const identity = await seedReview(db, 90);
    const priorResponse = await scalar(
      db,
      "select response_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
      [identity.sourceJobId],
    );
    const providerLiveResponse = {
      ...priorResponse,
      steps: [
        ...priorResponse.steps,
        {
          name: "detail-image-readback",
          ok: true,
          status: 200,
          data: { imageCount: 8 },
        },
      ],
      publicationFulfilled: true,
      remoteState: {
        ...priorResponse.remoteState,
        visibility: "live",
        providerStatus: "LIVE",
      },
    };
    await asReplica(db, async () => {
      await db.query(
        "delete from sellerpilot_private.listing_publication_reviews where listing_id=$1",
        [identity.listingId],
      );
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='running', response_payload=null, error_message=null,
                completed_at=null, claim_token=$2, worker_token_id=$3,
                lease_expires_at=clock_timestamp() + interval '5 minutes'
          where id=$1`,
        [identity.sourceJobId, identity.claimToken, WORKER_TOKEN_ID],
      );
      await db.query(
        `update sellerpilot_private.channel_operation_attempts
            set status='running', http_status=null, completed_at=null
          where id=$1`,
        [identity.attemptId],
      );
      await db.query(
        `update sellerpilot_private.product_listings
            set status='queued', remote_visibility='unknown',
                provider_status=null, remote_resources='{}'::jsonb,
                published_at=null, last_verified_at=null
          where id=$1`,
        [identity.listingId],
      );
    });

    assert.equal(await scalar(
      db,
      `select public.sellerpilot_complete_channel_gateway_job(
         $1,$2,$3,'succeeded',$4::jsonb,null
       )`,
      [
        WORKER_TOKEN_HASH,
        identity.sourceJobId,
        identity.claimToken,
        JSON.stringify(providerLiveResponse),
      ],
    ), true);

    assert.deepEqual((await db.query(
      `select status,
              response_payload#>>'{remoteState,visibility}' as visibility,
              response_payload#>>'{remoteState,evidence,providerObservedVisibility}' as provider_visibility,
              response_payload->>'publicationFulfilled' as fulfilled
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [identity.sourceJobId],
    )).rows[0], {
      status: "succeeded",
      visibility: "pending_review",
      provider_visibility: "live",
      fulfilled: "false",
    });
    assert.deepEqual((await db.query(
      `select status,remote_visibility,published_at is null as unpublished
         from sellerpilot_private.product_listings where id=$1`,
      [identity.listingId],
    )).rows[0], {
      status: "paused",
      remote_visibility: "pending_review",
      unpublished: true,
    });
    assert.deepEqual((await db.query(
      `select status,source_job_id::text from sellerpilot_private.listing_publication_reviews
        where listing_id=$1`,
      [identity.listingId],
    )).rows[0], {
      status: "pending",
      source_job_id: identity.sourceJobId,
    });
  } finally {
    await db.close();
  }
});

test("legacy Studio SHA evidence accumulates monotonically and blocks v2 approval until all sixteen assets are bound", async () => {
  const db = await createDatabase();
  try {
    await seedPrincipal(db);
    const sourceJobId = uuid(2101);
    const productId = uuid(2102);
    const claimToken = uuid(2103);
    const paths = Object.fromEntries(STUDIO_ASSET_ROLES.map((role) => [
      role,
      `results/${sourceJobId}/claims/${claimToken}/${role}.png`,
    ]));
    const digests = Object.fromEntries(STUDIO_ASSET_ROLES.map((role) => [
      role,
      createHash("sha256").update(`${role}:${paths[role]}`, "utf8").digest("hex"),
    ]));
    const approvedImages = DETAIL_ROLES.map((role) => ({ role, path: paths[role] }));
    const priorManifestDigest = createHash("sha256")
      .update(approvedImages.map(({ role, path }) => `${role}\t${path}`).join("\n"), "utf8")
      .digest("hex");
    const priorManifest = {
      contract: "sellerpilot_detail_image_manifest_v1",
      algorithm: "sha256",
      digest: priorManifestDigest,
      images: approvedImages,
    };
    const sourceImages = approvedImages.map(({ role, path }) => ({
      role,
      path,
      sourceSha256: digests[role],
    }));

    await asReplica(db, async () => {
      await db.query(
        `insert into sellerpilot_private.ai_cli_jobs (
           id,kind,status,request_payload,result_payload,created_by,
           created_at,completed_at,updated_at
         ) values (
           $1,'product_studio','succeeded','{}'::jsonb,$2::jsonb,$3,
           clock_timestamp(),clock_timestamp(),clock_timestamp()
         )`,
        [sourceJobId, JSON.stringify({ asset_storage_paths: paths }), OWNER_ID],
      );
      await db.query(
        `insert into sellerpilot_private.products (
           id,owner_id,external_code,sku,name,description,status,ai_job_id,
           detail_page_data,detail_page_version,detail_page_updated_at,
           detail_page_approved_version,detail_page_image_manifest
         ) values (
           $1,$2,'LEGACY-SHA-PRODUCT','LEGACY-SHA-SKU','Legacy SHA fixture','',
           'draft',$3,'{}'::jsonb,1,clock_timestamp(),1,$4::jsonb
         )`,
        [productId, OWNER_ID, sourceJobId, JSON.stringify(priorManifest)],
      );
      await db.query(
        `insert into storage.objects(bucket_id,name)
         select 'sellerpilot-ai', value
           from jsonb_each_text($1::jsonb)`,
        [JSON.stringify(Object.fromEntries(DETAIL_ROLES.map((role) => [role, paths[role]])))],
      );
    });

    for (let index = 0; index < 15; index += 1) {
      const role = STUDIO_ASSET_ROLES[index];
      await db.query(
        index === 0
          ? `update sellerpilot_private.ai_cli_jobs
                set result_payload=jsonb_set(
                  result_payload,'{asset_storage_sha256s}',
                  jsonb_build_object($2::text,$3::text),true
                ) where id=$1`
          : `update sellerpilot_private.ai_cli_jobs
                set result_payload=jsonb_set(
                  result_payload,array['asset_storage_sha256s',$2::text],to_jsonb($3::text),true
                ) where id=$1`,
        [sourceJobId, role, digests[role]],
      );
      assert.equal(Number(await scalar(
        db,
        `select count(*)
           from sellerpilot_private.ai_cli_jobs job
           cross join lateral jsonb_object_keys(
             job.result_payload->'asset_storage_sha256s'
           ) digest_key
          where job.id=$1`,
        [sourceJobId],
      )), index + 1);
    }

    await assert.rejects(
      db.query(
        `update sellerpilot_private.ai_cli_jobs
            set result_payload=jsonb_set(
              result_payload,'{asset_storage_sha256s,hero}',to_jsonb($2::text),true
            ) where id=$1`,
        [sourceJobId, "f".repeat(64)],
      ),
      /product studio asset SHA-256 ledger invalid/,
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.ai_cli_jobs
            set result_payload=result_payload #- '{asset_storage_sha256s,hero}'
          where id=$1`,
        [sourceJobId],
      ),
      /product studio asset SHA-256 ledger invalid/,
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.ai_cli_jobs
            set result_payload=jsonb_set(
              result_payload,'{asset_storage_sha256s,unknown}',to_jsonb($2::text),true
            ) where id=$1`,
        [sourceJobId, "f".repeat(64)],
      ),
      /product studio asset SHA-256 ledger invalid/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_bind_product_detail_page_source_digests(
           $1,$2,1,$3,$4::jsonb
         )`,
        [productId, OWNER_ID, priorManifestDigest, JSON.stringify(sourceImages)],
      ),
      /detail page source digest context unavailable/,
    );

    const finalRole = STUDIO_ASSET_ROLES[15];
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set result_payload=jsonb_set(
              result_payload,array['asset_storage_sha256s',$2::text],to_jsonb($3::text),true
          ) where id=$1`,
      [sourceJobId, finalRole, digests[finalRole]],
    );
    assert.equal(Number(await scalar(
      db,
      `select count(*)
         from sellerpilot_private.ai_cli_jobs job
         cross join lateral jsonb_object_keys(
           job.result_payload->'asset_storage_sha256s'
         ) digest_key
        where job.id=$1`,
      [sourceJobId],
    )), 16);

    const manifestV2 = await scalar(
      db,
      `select public.sellerpilot_service_bind_product_detail_page_source_digests(
         $1,$2,1,$3,$4::jsonb
       )`,
      [productId, OWNER_ID, priorManifestDigest, JSON.stringify(sourceImages)],
    );
    assert.equal(manifestV2.contract, "sellerpilot_detail_image_manifest_v2");
    assert.deepEqual(manifestV2.images, sourceImages);
    assert.match(manifestV2.digest, /^[a-f0-9]{64}$/u);
  } finally {
    await db.close();
  }
});
