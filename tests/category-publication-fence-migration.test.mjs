import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const originalMigrationUrl = new URL(
  "../supabase/migrations/20260825111820_serialize_gateway_ledger_transactions.sql",
  import.meta.url,
);
const fenceMigrationUrl = new URL(
  "../supabase/migrations/20260829165803_enforce_category_publication_environment_and_market.sql",
  import.meta.url,
);

const ADMIN = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ENV = "20000000-0000-4000-8000-000000000001";
const PRODUCT_SANDBOX = "20000000-0000-4000-8000-000000000002";
const PRODUCT_EBAY = "20000000-0000-4000-8000-000000000003";
const CREDENTIAL_PRODUCTION = "30000000-0000-4000-8000-000000000001";
const CREDENTIAL_SANDBOX = "30000000-0000-4000-8000-000000000002";
const CREDENTIAL_EBAY = "30000000-0000-4000-8000-000000000003";
const ATTEMPT_ENV = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_SANDBOX = "40000000-0000-4000-8000-000000000002";
const ATTEMPT_EBAY_MISMATCH = "40000000-0000-4000-8000-000000000003";
const ATTEMPT_EBAY_EMPTY = "40000000-0000-4000-8000-000000000004";
const ATTEMPT_EBAY_VALID = "40000000-0000-4000-8000-000000000005";
const FINGERPRINT = "a".repeat(64);

function extractAtomicFunction(migration) {
  const start = migration.indexOf(
    "create or replace function public.sellerpilot_service_reserve_and_enqueue_listing_create",
  );
  assert.ok(start >= 0, "original atomic listing.create function must exist");
  const end = migration.indexOf("\n$$;", start);
  assert.ok(end > start, "original atomic listing.create function must be complete");
  return migration.slice(start, end + "\n$$;".length);
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function reserve(db, {
  productId,
  credentialId,
  attemptId,
  channel,
  market,
  targetId,
}) {
  return scalar(
    db,
    `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
      $1, $2, $3, $4, $5, $6, 'USD', 12.34, $7, '{}'::jsonb
    )`,
    [productId, credentialId, attemptId, channel, market, targetId, FINGERPRINT],
  );
}

async function setup(db, originalMigration, fenceMigration) {
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;

    create table sellerpilot_private.admin_users (user_id uuid primary key);
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      demo boolean not null default false,
      status text not null
    );
    create table sellerpilot_private.product_category_assignments (
      owner_id uuid not null,
      product_id uuid not null,
      channel text not null,
      environment text not null,
      market text not null default '',
      status text not null,
      is_leaf boolean not null,
      missing_required_attributes jsonb not null default '[]'::jsonb,
      confirmed_at timestamptz
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      created_by uuid not null
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      request_fingerprint text not null,
      status text not null,
      http_status integer,
      safe_message text,
      completed_at timestamptz
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      market text not null default '',
      target_id text not null default '',
      status text not null,
      currency text not null,
      price numeric(14,2) not null,
      remote_id text,
      operation_attempt_id uuid,
      failure_class text,
      last_error text,
      seller_account_key text,
      published_at timestamptz,
      updated_at timestamptz not null default now(),
      unique (owner_id, product_id, channel_key, market, target_id)
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null,
      request_fingerprint text,
      response_payload jsonb,
      error_message text,
      status text not null default 'queued',
      created_by uuid not null,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    );
    create table sellerpilot_private.operation_audit (
      owner_id uuid not null,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      safe_detail jsonb not null
    );
  `);
  await db.exec(extractAtomicFunction(originalMigration));
  await db.exec(fenceMigration);

  await db.query("insert into sellerpilot_private.admin_users(user_id) values ($1)", [ADMIN]);
  await db.query(
    `insert into sellerpilot_private.products(id,owner_id,status) values
       ($1,$4,'ready'), ($2,$4,'ready'), ($3,$4,'ready')`,
    [PRODUCT_ENV, PRODUCT_SANDBOX, PRODUCT_EBAY, ADMIN],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials(
       id,channel,environment,status,created_by
     ) values
       ($1,'shopee','production','active',$4),
       ($2,'shopee','sandbox','active',$4),
       ($3,'ebay','production','active',$4)`,
    [CREDENTIAL_PRODUCTION, CREDENTIAL_SANDBOX, CREDENTIAL_EBAY, ADMIN],
  );
  await db.query(
    `insert into sellerpilot_private.product_category_assignments(
       owner_id,product_id,channel,environment,market,status,is_leaf,
       missing_required_attributes,confirmed_at
     ) values
       ($1,$2,'shopee','sandbox','MY','confirmed',true,'[]'::jsonb,now()),
       ($1,$3,'shopee','production','MY','confirmed',true,'[]'::jsonb,now()),
       ($1,$4,'ebay','production','GB','confirmed',true,'[]'::jsonb,now())`,
    [ADMIN, PRODUCT_ENV, PRODUCT_SANDBOX, PRODUCT_EBAY],
  );
  for (const [id, credentialId, channel] of [
    [ATTEMPT_ENV, CREDENTIAL_PRODUCTION, "shopee"],
    [ATTEMPT_SANDBOX, CREDENTIAL_SANDBOX, "shopee"],
    [ATTEMPT_EBAY_MISMATCH, CREDENTIAL_EBAY, "ebay"],
    [ATTEMPT_EBAY_EMPTY, CREDENTIAL_EBAY, "ebay"],
    [ATTEMPT_EBAY_VALID, CREDENTIAL_EBAY, "ebay"],
  ]) {
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts(
         id,owner_id,credential_id,channel,operation,request_fingerprint,status
       ) values ($1,$2,$3,$4,'listing.create',$5,'running')`,
      [id, ADMIN, credentialId, channel, FINGERPRINT],
    );
  }
}

test("atomic listing.create requires the category assignment credential environment", async () => {
  const [originalMigration, fenceMigration] = await Promise.all([
    readFile(originalMigrationUrl, "utf8"),
    readFile(fenceMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  try {
    await setup(db, originalMigration, fenceMigration);
    await assert.rejects(
      reserve(db, {
        productId: PRODUCT_ENV,
        credentialId: CREDENTIAL_PRODUCTION,
        attemptId: ATTEMPT_ENV,
        channel: "shopee",
        market: "MY",
        targetId: "shop-production",
      }),
      /confirmed market category required/,
    );
    await assert.rejects(
      reserve(db, {
        productId: PRODUCT_SANDBOX,
        credentialId: CREDENTIAL_SANDBOX,
        attemptId: ATTEMPT_SANDBOX,
        channel: "shopee",
        market: "MY",
        targetId: "shop-sandbox",
      }),
      /confirmed market category required/,
    );
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.product_listings"), 0);
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"), 0);

    await db.query(
      `update sellerpilot_private.product_category_assignments
          set environment='production'
        where product_id=$1`,
      [PRODUCT_ENV],
    );
    const accepted = await reserve(db, {
      productId: PRODUCT_ENV,
      credentialId: CREDENTIAL_PRODUCTION,
      attemptId: ATTEMPT_ENV,
      channel: "shopee",
      market: "MY",
      targetId: "shop-production",
    });
    assert.equal(accepted.status, "queued");
    assert.equal(
      await scalar(db, "select environment from sellerpilot_private.channel_gateway_jobs where id=$1", [accepted.job_id]),
      "production",
    );
  } finally {
    await db.close();
  }
});

test("atomic eBay listing.create requires a concrete market matching its confirmed assignment", async () => {
  const [originalMigration, fenceMigration] = await Promise.all([
    readFile(originalMigrationUrl, "utf8"),
    readFile(fenceMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  try {
    await setup(db, originalMigration, fenceMigration);
    await assert.rejects(
      reserve(db, {
        productId: PRODUCT_EBAY,
        credentialId: CREDENTIAL_EBAY,
        attemptId: ATTEMPT_EBAY_MISMATCH,
        channel: "ebay",
        market: "US",
        targetId: "EBAY_US",
      }),
      /confirmed market category required/,
    );
    await assert.rejects(
      reserve(db, {
        productId: PRODUCT_EBAY,
        credentialId: CREDENTIAL_EBAY,
        attemptId: ATTEMPT_EBAY_EMPTY,
        channel: "ebay",
        market: "",
        targetId: "EBAY_GB",
      }),
      /concrete market required/,
    );

    const accepted = await reserve(db, {
      productId: PRODUCT_EBAY,
      credentialId: CREDENTIAL_EBAY,
      attemptId: ATTEMPT_EBAY_VALID,
      channel: "ebay",
      market: "gb",
      targetId: "EBAY_GB",
    });
    assert.equal(accepted.status, "queued");
    assert.equal(
      await scalar(db, "select market from sellerpilot_private.product_listings where id=$1", [accepted.listing_id]),
      "GB",
    );
  } finally {
    await db.close();
  }
});

test("the guarded atomic RPC remains service-only and its unsafe delegate is not callable", async () => {
  const [originalMigration, fenceMigration] = await Promise.all([
    readFile(originalMigrationUrl, "utf8"),
    readFile(fenceMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  try {
    await setup(db, originalMigration, fenceMigration);
    const signature = "public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)";
    const unsafeSignature = "public.sellerpilot_165803_reserve_and_enqueue_listing_unsafe(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)";
    assert.equal(await scalar(db, `select has_function_privilege('authenticated','${signature}','execute')`), false);
    assert.equal(await scalar(db, `select has_function_privilege('service_role','${signature}','execute')`), true);
    assert.equal(await scalar(db, `select has_function_privilege('service_role','${unsafeSignature}','execute')`), false);
  } finally {
    await db.close();
  }
});
