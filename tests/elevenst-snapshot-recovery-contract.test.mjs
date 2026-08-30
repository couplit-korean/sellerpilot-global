import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationName = "20260831054000_recover_elevenst_listing_snapshot.sql";
const migration = await readFile(new URL(
  `../supabase/migrations/${migrationName}`,
  import.meta.url,
), "utf8");
const route = await readFile(new URL(
  "../app/api/admin/listings/elevenst-snapshot/recover/route.ts",
  import.meta.url,
), "utf8");

function stripUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "")
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
}

async function compatibilityLayer() {
  const source = await readFile(new URL("./supabase-migrations.test.mjs", import.meta.url), "utf8");
  const match = source.match(
    /const supabaseCompatibilityLayer = String\.raw`([\s\S]*?)`;\n\nfunction withoutUnavailableExtensions/,
  );
  assert.ok(match);
  return match[1];
}

async function migrationNames() {
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
  return {
    migrationUrl,
    names: (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  };
}

async function createDatabase(options = { includeRecovery: true }) {
  const db = new PGlite();
  await db.exec(await compatibilityLayer());
  const { migrationUrl, names } = await migrationNames();
  for (const name of names) {
    if (!options.includeRecovery && name >= migrationName) break;
    await db.exec(stripUnavailableExtensions(await readFile(new URL(name, migrationUrl), "utf8")));
  }
  return db;
}

test("11st recovery attests only the exact immutable production tuple", () => {
  for (const value of [
    "f7927a29-46b2-4d77-90da-759c79c50bc7",
    "363f3b81-f364-4f22-af4e-4920199904d0",
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "84957a46-4a90-43bb-a9b6-e4f2be984b58",
    "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
    "9573255804",
    "eed923ee9a26973e58d1f8ba381c28e190296f7c89b10cce5d7ec4d4fa1dbd71",
    "77debf98a349c27cbecc8a348f62e8fdf55d61d97fe87e7bac8e4d9f68fb7fd7",
    "1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af",
    "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62",
  ]) assert.match(migration, new RegExp(value, "u"));
  assert.match(migration, /source_request_bytes = 4349/u);
  assert.match(migration, /source_response_bytes = 1083/u);
  assert.match(migration, /2026-08-24T07:42:18\.57602Z/u);
  assert.match(migration, /2026-08-24T07:42:26\.415136Z/u);
  assert.match(migration, /source_job\.listing_id is null/u);
  assert.match(migration, /source_job\.seller_account_key is null/u);
  assert.match(migration, /source_job\.request_fingerprint is null/u);
  assert.match(migration, /source_job\.provider_mutation_started_at is null/u);
  assert.match(migration, /v_same_attempt_jobs <> 1/u);
  assert.match(migration, /v_same_remote_jobs <> 1/u);
  assert.match(migration, /v_later_writes <> 0/u);
  assert.match(migration, /listing_mutation_release_gate_is_effective\(\)/u);
});

test("11st recovery queues only an exact read-only GET verifier", () => {
  const enqueue = migration.match(
    /create function public\.sellerpilot_service_enqueue_elevenst_listing_snapshot_recovery\([\s\S]*?\n\$\$;/u,
  )?.[0] ?? "";
  assert.ok(enqueue);
  assert.match(enqueue, /'listing\.publication\.verify'/u);
  assert.match(enqueue, /'sellerpilotReadOnly', true/u);
  assert.match(enqueue, /'sellerpilotSnapshotOnly', true/u);
  assert.match(enqueue, /'elevenst_exact_legacy_snapshot_recovery_v1'/u);
  assert.match(enqueue, /'createAllowed', false/u);
  assert.match(enqueue, /'listingMutationAllowed', false/u);
  assert.doesNotMatch(enqueue, /'listing\.create'\s*,\s*v_context/u);
  assert.doesNotMatch(enqueue, /'listing\.update'\s*,\s*v_context/u);
});

test("11st snapshot completion cannot promote a listing or create publication review evidence", () => {
  const completion = migration.match(
    /create function sellerpilot_private\.apply_elevenst_snapshot_recovery\(\)[\s\S]*?\n\$\$;/u,
  )?.[0] ?? "";
  assert.ok(completion);
  assert.match(completion, /insert into sellerpilot_private\.elevenst_listing_snapshots/u);
  assert.match(completion, /approvedContentVerified', false/u);
  assert.match(completion, /publicationReviewCreated', false/u);
  assert.match(completion, /listingStateChanged', false/u);
  assert.doesNotMatch(completion, /insert into sellerpilot_private\.listing_publication_reviews/u);
  assert.doesNotMatch(completion, /apply_listing_publication_review_to_listing/u);
  assert.doesNotMatch(completion, /update sellerpilot_private\.product_listings/u);
  assert.match(migration, /not exists \([\s\S]*publication-content-verification'[\s\S]*step\.value->>'ok' = 'true'/u);
});

test("authenticated recovery route remains fail-closed before enqueue", () => {
  assert.match(route, /authenticateAdminRequest\(request\)/u);
  assert.match(route, /mode: z\.enum\(\["dry_run", "execute"\]\)/u);
  const runtimeGate = route.indexOf("if (!runtimeStaticEgressReady)");
  const enqueue = route.indexOf("sellerpilot_service_enqueue_elevenst_listing_snapshot_recovery");
  assert.ok(runtimeGate >= 0 && enqueue > runtimeGate);
  assert.match(route, /blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED/u);
  assert.match(route, /createAllowed: false/u);
  assert.match(route, /listingMutationAllowed: false/u);
});

test("a generic modern or null-lineage source cannot create an exact legacy attestation", async () => {
  const db = await createDatabase();
  const ownerId = "91000000-0000-4000-8000-000000000001";
  const productId = "92000000-0000-4000-8000-000000000001";
  const listingId = "93000000-0000-4000-8000-000000000001";
  const attemptId = "94000000-0000-4000-8000-000000000001";
  try {
    await db.exec("set session_replication_role = replica");
    await db.query("insert into auth.users (id,email) values ($1,'generic-elevenst@example.test')", [ownerId]);
    await db.query(
      `insert into sellerpilot_private.products (
         id,owner_id,external_code,sku,name,description,status
       ) values ($1,$2,'GENERIC-11ST','GENERIC-11ST','일반 상품','일반 설명','draft')`,
      [productId, ownerId],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id,owner_id,product_id,channel_key,remote_id,status,currency,price,
         operation_attempt_id,market,target_id,failure_class,marketplace_sku,
         seller_account_key,requested_publication_intent,remote_visibility
       ) values (
         $1,$2,$3,'elevenst','1234567890','failed','KRW',5000,$4,'KR','KR',
         'external_action','GENERIC-11ST',$5,'live','unknown'
       )`,
      [listingId, ownerId, productId, attemptId, "b".repeat(64)],
    );
    await db.exec("set session_replication_role = origin");
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    const prepared = (await db.query(
      "select public.sellerpilot_service_prepare_elevenst_listing_snapshot_recovery($1) as result",
      [listingId],
    )).rows[0].result;
    assert.equal(prepared.status, "blocked");
    assert.equal(prepared.blockedReason, "exact_legacy_source_attestation_required");
    assert.equal(Number((await db.query(
      "select count(*) as count from sellerpilot_private.elevenst_exact_legacy_source_attestations",
    )).rows[0].count), 0);
    assert.equal(Number((await db.query(
      "select count(*) as count from sellerpilot_private.channel_gateway_jobs where listing_id=$1",
      [listingId],
    )).rows[0].count), 0);
  } finally {
    await db.close();
  }
});

test("an exact-ID tuple with different bytes aborts instead of being generically backfilled", async () => {
  const db = await createDatabase({ includeRecovery: false });
  const ownerId = "768ce4ac-0000-4000-8000-000000000001";
  const credentialId = "b2dd0ff7-4420-495f-aead-a45857fb3bfe";
  const attemptId = "84957a46-4a90-43bb-a9b6-e4f2be984b58";
  const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
  const listingId = "363f3b81-f364-4f22-af4e-4920199904d0";
  const sourceJobId = "f7927a29-46b2-4d77-90da-759c79c50bc7";
  try {
    await db.exec("set session_replication_role = replica");
    await db.query("insert into auth.users (id,email) values ($1,'exact-mismatch@example.test')", [ownerId]);
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
      [credentialId, "1".repeat(64), ownerId, "2".repeat(64)],
    );
    await db.query(
      `insert into sellerpilot_private.products (
         id,owner_id,external_code,sku,name,description,status,
         detail_page_data,detail_page_version,detail_page_updated_at,
         detail_page_approved_version,detail_page_image_manifest
       ) values (
         $1,$2,'EXACT-11ST','EXACT-11ST','정확 후보','설명','draft',
         '{}'::jsonb,1,clock_timestamp(),1,$3::jsonb
       )`,
      [productId, ownerId, JSON.stringify({
        contract: "sellerpilot_detail_image_manifest_v2",
        algorithm: "sha256",
        digest: "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62",
        images: Array.from({ length: 8 }, (_, index) => ({
          role: `detail-role-${index}`,
          path: `results/${productId}/claims/${attemptId}/detail-role-${index}.png`,
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
         $1,$2,$3,'elevenst','listing.create','exact-legacy-source-attempt',
         $4,'succeeded',200,'9573255804',
         '2026-08-24T07:42:22.07751Z','2026-08-24T07:42:26.415136Z',
         false,false,null
       )`,
      [attemptId, ownerId, credentialId, "1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af"],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id,owner_id,product_id,channel_key,remote_id,status,currency,price,
         operation_attempt_id,market,target_id,failure_class,marketplace_sku,
         seller_account_key,requested_publication_intent,remote_visibility
       ) values (
         $1,$2,$3,'elevenst','9573255804','failed','KRW',5000,$4,'KR','KR',
         'external_action','EXACT-11ST',$5,'live','unknown'
       )`,
      [listingId, ownerId, productId, attemptId, "2".repeat(64)],
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
      [sourceJobId, credentialId, attemptId, JSON.stringify({
        arguments: {
          product: { prdNm: "부착형 케이블 정리 클립 6개 세트", dispCtgrNo: "1341821", sellerPrdCd: "EXACT-11ST" },
          verificationOnly: true,
        },
      }), JSON.stringify({ ok: true, remoteId: "9573255804", steps: [] }), ownerId],
    );
    await db.exec("set session_replication_role = origin");
    await assert.rejects(
      db.exec(stripUnavailableExtensions(migration)),
      /exact 11st legacy source tuple does not match/u,
    );
  } finally {
    await db.close();
  }
});
