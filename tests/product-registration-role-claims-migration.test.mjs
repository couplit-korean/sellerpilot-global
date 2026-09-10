import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const draftMigrationUrl = new URL(
  "../supabase/migrations/20260907023000_product_registration_drafts.sql",
  import.meta.url,
);
const contextMigrationUrl = new URL(
  "../supabase/migrations/20260907024000_product_registration_context.sql",
  import.meta.url,
);
const roleClaimsMigrationUrl = new URL(
  "../supabase/migrations/20260907031500_product_registration_role_claims.sql",
  import.meta.url,
);

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";

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
    insert into auth.users (id) values ('${OWNER_ID}');
    insert into sellerpilot_private.admin_users (user_id) values ('${OWNER_ID}');
    insert into sellerpilot_private.products (
      id, owner_id, external_code, sku, name
    ) values (
      '${PRODUCT_ID}', '${OWNER_ID}', 'EXT-001', 'SKU-001', '상품'
    );
  `);
  await db.exec(await readFile(draftMigrationUrl, "utf8"));
  await db.exec(await readFile(contextMigrationUrl, "utf8"));
  await db.exec(await readFile(roleClaimsMigrationUrl, "utf8"));
  return db;
}

async function setServiceDatabaseRole(db) {
  await db.exec("set role service_role");
}

async function resetSession(db) {
  await db.exec("reset role");
  await db.exec("select set_config('request.jwt.claim.role', '', false)");
  await db.exec("select set_config('request.jwt.claims', '', false)");
}

async function setClaims(db, legacyRole, jsonClaims) {
  await db.query(
    "select set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claims', $2, false)",
    [legacyRole, jsonClaims],
  );
}

async function getDraft(db) {
  return scalar(
    db,
    "select public.sellerpilot_service_get_product_registration_draft($1::uuid,$2::uuid,'intake')",
    [OWNER_ID, DRAFT_ID],
  );
}

async function putDraft(db, expectedVersion = 0) {
  return scalar(
    db,
    `select public.sellerpilot_service_put_product_registration_draft(
       $1::uuid,$2::uuid,'intake',$3::uuid,$4::bigint,'{"name":"draft"}'::jsonb
     )`,
    [OWNER_ID, DRAFT_ID, PRODUCT_ID, expectedVersion],
  );
}

async function getContext(db) {
  return scalar(
    db,
    "select public.sellerpilot_service_get_product_registration_context($1::uuid,$2::uuid)",
    [OWNER_ID, PRODUCT_ID],
  );
}

test("JSON claims-only service role can use all three RPCs", async () => {
  const db = await fixture();
  try {
    await setServiceDatabaseRole(db);
    await setClaims(db, "", JSON.stringify({ role: "service_role", sub: OWNER_ID }));

    assert.equal(await getDraft(db), null);
    const saved = await putDraft(db);
    assert.equal(saved.version, 1);
    assert.equal((await getDraft(db)).productId, PRODUCT_ID);
    const context = await getContext(db);
    assert.equal(context.contract, "sellerpilot_product_registration_context_v1");
    assert.equal(context.ownerId, OWNER_ID);
  } finally {
    await resetSession(db).catch(() => {});
    await db.close();
  }
});

test("legacy service-role GUC remains compatible when JSON claims are absent", async () => {
  const db = await fixture();
  try {
    await setServiceDatabaseRole(db);
    await setClaims(db, "service_role", "");
    assert.equal(await getDraft(db), null);
    assert.equal((await getContext(db)).product.id, PRODUCT_ID);
  } finally {
    await resetSession(db).catch(() => {});
    await db.close();
  }
});

test("missing, malformed, and contradictory claims fail closed", async () => {
  const db = await fixture();
  try {
    await setServiceDatabaseRole(db);
    const rejectedClaims = [
      ["", ""],
      ["", "not-json"],
      ["service_role", "{}"],
      ["service_role", "[]"],
      ["service_role", "null"],
      ["service_role", JSON.stringify({ role: null })],
      ["service_role", JSON.stringify({ role: "" })],
      ["service_role", JSON.stringify({ role: "authenticated" })],
      ["authenticated", JSON.stringify({ role: "service_role" })],
      ["", JSON.stringify({ role: "anon" })],
    ];
    for (const [legacyRole, jsonClaims] of rejectedClaims) {
      await setClaims(db, legacyRole, jsonClaims);
      const claimLabel = JSON.stringify({ legacyRole, jsonClaims });
      await assert.rejects(
        getDraft(db),
        /PRODUCT_REGISTRATION_DRAFT_ACCESS_DENIED/,
        claimLabel,
      );
      await assert.rejects(
        getContext(db),
        /PRODUCT_REGISTRATION_CONTEXT_ACCESS_DENIED/,
        claimLabel,
      );
      await assert.rejects(
        putDraft(db),
        /PRODUCT_REGISTRATION_DRAFT_ACCESS_DENIED/,
        claimLabel,
      );
    }
  } finally {
    await resetSession(db).catch(() => {});
    await db.close();
  }
});

test("anon and authenticated retain no execute privilege after the rewrite", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      const checks = await db.query(
        `select
           has_function_privilege($1, 'public.sellerpilot_service_get_product_registration_draft(uuid,uuid,text)', 'execute') get_allowed,
           has_function_privilege($1, 'public.sellerpilot_service_put_product_registration_draft(uuid,uuid,text,uuid,bigint,jsonb)', 'execute') put_allowed,
           has_function_privilege($1, 'public.sellerpilot_service_get_product_registration_context(uuid,uuid)', 'execute') context_allowed`,
        [role],
      );
      assert.deepEqual(checks.rows, [{
        get_allowed: false,
        put_allowed: false,
        context_allowed: false,
      }]);
    }
  } finally {
    await resetSession(db).catch(() => {});
    await db.close();
  }
});

test("migration rewrites exactly one guard in each existing function", async () => {
  const db = await fixture();
  try {
    const definitions = await db.query(`
      select pg_get_functiondef(oid) definition
        from pg_proc
       where oid in (
         'public.sellerpilot_service_get_product_registration_draft(uuid,uuid,text)'::regprocedure,
         'public.sellerpilot_service_put_product_registration_draft(uuid,uuid,text,uuid,bigint,jsonb)'::regprocedure,
         'public.sellerpilot_service_get_product_registration_context(uuid,uuid)'::regprocedure
       )
       order by proname
    `);
    assert.equal(definitions.rows.length, 3);
    for (const { definition } of definitions.rows) {
      assert.equal(
        definition.split("sellerpilot_private.request_has_unambiguous_service_role_claim()").length - 1,
        1,
      );
      assert.equal(definition.includes("current_setting('request.jwt.claim.role', true)"), false);
    }
  } finally {
    await resetSession(db).catch(() => {});
    await db.close();
  }
});
