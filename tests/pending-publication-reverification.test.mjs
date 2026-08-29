import assert from "node:assert/strict";
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

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
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

function evidence() {
  return {
    identityVerified: true,
    statusVerified: true,
    localeVerified: true,
    fingerprintVerified: true,
    imageCountVerified: true,
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
    evidence: evidence(),
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
    },
  };
  const sourceResponse = {
    ok: true,
    channel: "qoo10",
    operation: "listing.create",
    remoteId: identity.remoteId,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    remoteState: remoteState(identity, "pending_review", sourceVerifiedAt),
    publicationFulfilled: false,
  };

  await asReplica(db, async () => {
    await db.query(
      `insert into sellerpilot_private.products (
         id,owner_id,external_code,sku,name,description,status
       ) values ($1,$2,$3,$4,$5,'publication review fixture','draft')`,
      [
        identity.productId,
        OWNER_ID,
        `PRODUCT-${index}`,
        `SKU-${index}`,
        `Publication fixture ${index}`,
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
            evidence: evidence(),
            locale: identity.locale,
            fingerprint: identity.fingerprint,
            imageCount: 8,
          },
        }),
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
