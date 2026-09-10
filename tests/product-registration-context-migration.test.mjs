import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260907024000_product_registration_context.sql",
  import.meta.url,
);
const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const PRODUCT_A = "20000000-0000-4000-8000-000000000001";
const PRODUCT_B = "20000000-0000-4000-8000-000000000002";
const JOB_A = "30000000-0000-4000-8000-000000000001";
const JOB_B = "30000000-0000-4000-8000-000000000002";
const CLAIM_A = "40000000-0000-4000-8000-000000000001";
const EXTERNAL_A = "50000000-0000-4000-8000-000000000001";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users (id uuid primary key);
    create table sellerpilot_private.admin_users (
      user_id uuid primary key references auth.users(id)
    );
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key,
      kind text not null,
      status text not null,
      request_payload jsonb not null default '{}'::jsonb,
      result_payload jsonb,
      created_by uuid not null references auth.users(id)
    );
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null references auth.users(id),
      external_code text not null,
      sku text not null,
      name text not null,
      description text not null default '',
      source_url text,
      status text not null default 'draft',
      on_hand integer not null default 0,
      cost_krw numeric not null default 0,
      demo boolean not null default false,
      ai_job_id uuid references sellerpilot_private.ai_cli_jobs(id),
      product_facts jsonb not null default '{}'::jsonb,
      detail_page_data jsonb,
      detail_page_version bigint not null default 0,
      detail_page_approved_version bigint not null default 0,
      detail_page_image_manifest jsonb,
      detail_page_updated_at timestamptz,
      external_detail_import_id uuid,
      updated_at timestamptz not null default now()
    );
    create table sellerpilot_private.external_detail_imports (
      id uuid primary key,
      product_id uuid not null references sellerpilot_private.products(id),
      owner_id uuid not null references auth.users(id),
      status text not null,
      approved_at timestamptz,
      approved_product_updated_at timestamptz,
      approved_detail_version bigint
    );
    create table sellerpilot_private.product_category_assignments (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel text not null,
      environment text not null,
      market text not null default '',
      category_id text not null,
      category_path text[] not null default '{}',
      provided_attributes jsonb not null default '{}'::jsonb,
      status text not null,
      confirmed_at timestamptz,
      required_attributes jsonb not null default '[]'::jsonb,
      official_metadata jsonb not null default '{}'::jsonb,
      missing_required_attributes jsonb not null default '[]'::jsonb,
      official_verified_at timestamptz,
      is_leaf boolean not null default false,
      classification_source text not null default 'official_tree_search'
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      market text not null default '',
      target_id text not null default '',
      remote_id text,
      marketplace_sku text,
      public_url text,
      public_page_status text not null default 'unverified',
      public_page_checked_at timestamptz,
      status text not null default 'draft',
      currency text not null default 'KRW',
      price numeric not null default 0,
      last_error text,
      failure_class text,
      inventory_sync_status text not null default 'never',
      last_inventory_quantity integer,
      inventory_sync_error text,
      last_inventory_synced_at timestamptz,
      published_at timestamptz,
      seller_account_key text,
      operation_attempt_id uuid,
      requested_publication_intent text not null default 'safe_test',
      remote_visibility text not null default 'unknown',
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      remote_created_at timestamptz,
      last_verified_at timestamptz,
      updated_at timestamptz not null default now()
    );
    insert into auth.users (id) values ('${OWNER_A}'), ('${OWNER_B}');
    insert into sellerpilot_private.admin_users (user_id) values ('${OWNER_A}');
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

async function asService(db) {
  await db.exec("set role service_role");
  await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)");
}

async function resetRole(db) {
  await db.exec("reset role");
  await db.exec("select set_config('request.jwt.claim.role', '', false)");
}

async function readContext(db, ownerId = OWNER_A, productId = PRODUCT_A) {
  return scalar(
    db,
    "select public.sellerpilot_service_get_product_registration_context($1::uuid, $2::uuid)",
    [ownerId, productId],
  );
}

async function seedOwnedContext(db) {
  await db.query(
    `insert into sellerpilot_private.ai_cli_jobs (
       id, kind, status, request_payload, result_payload, created_by
     ) values ($1, 'product_studio', 'failed', $2::jsonb, $3::jsonb, $4)`,
    [
      JOB_A,
      JSON.stringify({
        manual_fields: { productName: "job fallback", stock: 1 },
        image_paths: [`${OWNER_A}/${JOB_A}/input/001.jpg`],
        image_specs: [{ originalPath: `${OWNER_A}/${JOB_A}/original/001.source` }],
      }),
      JSON.stringify({
        mode: "cli",
        asset_storage_paths: {
          hero: `results/${JOB_A}/claims/${CLAIM_A}/hero.png`,
        },
        localizedListings: [{ channel: "smartstore", market: "KR", locale: "ko-KR" }],
        product: { classification: { taxonomy: "fixture" } },
      }),
      OWNER_A,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.products (
       id, owner_id, external_code, sku, name, description, source_url,
       status, on_hand, cost_krw, ai_job_id, product_facts,
       detail_page_data, detail_page_version, detail_page_approved_version,
       detail_page_image_manifest, detail_page_updated_at, updated_at
     ) values (
       $1, $2, 'EXTERNAL', 'SKU-A', '상품 A', '설명', 'https://example.test/item',
       'draft', 7, 1000, $3, $4::jsonb,
       '{"root":{},"content":[]}'::jsonb, 3, 2,
       '{"contract":"stale-fixture"}'::jsonb, now() - interval '1 hour', now()
     )`,
    [PRODUCT_A, OWNER_A, JOB_A, JSON.stringify({ productName: "current facts", stock: 7 })],
  );
  await db.query(
    `insert into sellerpilot_private.product_category_assignments (
       id, owner_id, product_id, channel, environment, market, category_id,
       category_path, provided_attributes, status, confirmed_at,
       required_attributes, official_metadata, missing_required_attributes,
       official_verified_at, is_leaf, classification_source
     ) values (
       '60000000-0000-4000-8000-000000000001', $1, $2,
       'smartstore', 'production', 'KR', '50022679', array['생활','정리'],
       '{"color":"white","sizes":["S","M"],"discardedNumber":2}'::jsonb,
       'confirmed', now(), '[{"id":"color"}]'::jsonb,
       '{"source":"official"}'::jsonb, '[]'::jsonb, now(), true,
       'official_tree_search'
     )`,
    [OWNER_A, PRODUCT_A],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id, owner_id, product_id, channel_key, market, target_id, remote_id,
       marketplace_sku, status, failure_class, operation_attempt_id,
       requested_publication_intent, remote_visibility, provider_status,
       published_at
     ) values (
       '70000000-0000-4000-8000-000000000001', $1, $2,
       'smartstore', 'KR', '', '13688607602', 'SKU-A', 'failed',
       'external_action', '80000000-0000-4000-8000-000000000001',
       'live', 'unknown', 'invalidInputs', now() - interval '1 day'
     )`,
    [OWNER_A, PRODUCT_A],
  );
}

test("service-only admin and owner fences fail closed without exposing another product", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      readContext(db),
      /PRODUCT_REGISTRATION_CONTEXT_ACCESS_DENIED/,
    );
    await asService(db);
    await assert.rejects(
      db.query("select * from sellerpilot_private.products"),
      /permission denied/i,
    );
    await assert.rejects(
      readContext(db, OWNER_B, PRODUCT_A),
      /PRODUCT_REGISTRATION_CONTEXT_ADMIN_REQUIRED/,
    );
    assert.equal(await readContext(db, OWNER_A, PRODUCT_B), null);
  } finally {
    await resetRole(db).catch(() => {});
    await db.close();
  }
});

test("editing context returns current facts and metadata despite stale approval timestamps", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(migration, /approved_product_updated_at\s+is\s+(?:not\s+)?distinct\s+from/i);
  assert.doesNotMatch(
    migration,
    /(?:insert\s+into|update|delete\s+from)\s+sellerpilot_private\.(?:products|ai_cli_jobs|product_listings|product_category_assignments)\b/i,
  );

  const db = await fixture();
  try {
    await seedOwnedContext(db);
    const before = await db.query("select * from sellerpilot_private.products where id=$1", [PRODUCT_A]);
    await db.query(
      `insert into sellerpilot_private.external_detail_imports (
         id, product_id, owner_id, status, approved_at,
         approved_product_updated_at, approved_detail_version
       ) values ($1, $2, $3, 'approved', now() - interval '2 hours',
         now() - interval '1 day', 2)`,
      [EXTERNAL_A, PRODUCT_A, OWNER_A],
    );
    await db.query(
      "update sellerpilot_private.products set external_detail_import_id=$1 where id=$2",
      [EXTERNAL_A, PRODUCT_A],
    );
    const expected = await db.query("select * from sellerpilot_private.products where id=$1", [PRODUCT_A]);

    await asService(db);
    const context = await readContext(db);
    assert.equal(context.contract, "sellerpilot_product_registration_context_v1");
    assert.equal(context.contextMode, "editing_only");
    assert.equal(context.ownerId, OWNER_A);
    assert.equal(context.product.id, PRODUCT_A);
    assert.equal(context.manualFields.productName, "current facts");
    assert.equal(context.manualFields.stock, 7);
    assert.equal(context.studioJob.status, "failed");
    assert.equal(context.contentMode, "external_generated");
    assert.equal(context.detailAssetSource, "external_generated");
    assert.equal(context.externalDetailState.status, "approved");
    assert.equal(context.detailPage.version, 3);
    assert.equal(context.detailPage.approvedVersion, 2);
    assert.equal(context.assignments[0].requiredAttributes[0].id, "color");
    assert.equal(context.assignments[0].officialMetadata.source, "official");
    assert.deepEqual(context.assignments[0].providedAttributes, {
      color: "white",
      sizes: ["S", "M"],
    });
    assert.equal(context.listings[0].remoteId, "13688607602");
    assert.equal(context.listings[0].operationAttemptId, "80000000-0000-4000-8000-000000000001");
    assert.equal(context.listings[0].providerStatus, "invalidInputs");
    assert.equal(context.sourceImagePaths[0], `${OWNER_A}/${JOB_A}/input/001.jpg`);
    assert.equal(context.generatedImagePaths.hero, `results/${JOB_A}/claims/${CLAIM_A}/hero.png`);
    await resetRole(db);

    const after = await db.query("select * from sellerpilot_private.products where id=$1", [PRODUCT_A]);
    assert.notDeepEqual(before.rows, expected.rows, "fixture must contain a stale post-approval product timestamp");
    assert.deepEqual(after.rows, expected.rows, "read RPC must not mutate the product ledger");
  } finally {
    await resetRole(db).catch(() => {});
    await db.close();
  }
});

test("empty product facts use only the owned job draft fallback", async () => {
  const db = await fixture();
  try {
    await seedOwnedContext(db);
    await db.query(
      "update sellerpilot_private.products set product_facts='{}'::jsonb where id=$1",
      [PRODUCT_A],
    );
    await asService(db);
    const context = await readContext(db);
    assert.equal(context.manualFields.productName, "job fallback");
    assert.equal(context.manualFields.stock, 1);
  } finally {
    await resetRole(db).catch(() => {});
    await db.close();
  }
});

test("source and generated paths cannot cross an owner boundary", async () => {
  const db = await fixture();
  try {
    await seedOwnedContext(db);
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set request_payload = jsonb_set(
            request_payload, '{image_paths}', $1::jsonb, true
          )
        where id=$2`,
      [JSON.stringify([`${OWNER_B}/${JOB_A}/input/001.jpg`]), JOB_A],
    );
    await asService(db);
    await assert.rejects(
      readContext(db),
      /PRODUCT_REGISTRATION_CONTEXT_SOURCE_PATH_INVALID/,
    );
    await db.exec("rollback").catch(() => {});
    await resetRole(db);

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set request_payload=jsonb_set(request_payload, '{image_paths}', $1::jsonb, true) where id=$2",
      [JSON.stringify([`${OWNER_A}/${JOB_A}/input/001.jpg`]), JOB_A],
    );
    await db.query(
      "insert into sellerpilot_private.ai_cli_jobs (id,kind,status,request_payload,result_payload,created_by) values ($1,'product_studio','succeeded','{}',null,$2)",
      [JOB_B, OWNER_B],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set result_payload=jsonb_set(result_payload, '{asset_storage_paths,hero}', to_jsonb($1::text), true) where id=$2",
      [`results/${JOB_B}/claims/${CLAIM_A}/hero.png`, JOB_A],
    );
    await asService(db);
    await assert.rejects(
      readContext(db),
      /PRODUCT_REGISTRATION_CONTEXT_GENERATED_PATH_INVALID/,
    );
  } finally {
    await resetRole(db).catch(() => {});
    await db.close();
  }
});
