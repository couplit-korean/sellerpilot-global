import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908043000_fix_exact_coupang_completion_service_role.sql",
  import.meta.url,
), "utf8");
const predecessorMigration = await readFile(new URL(
  "../supabase/migrations/20260907191500_reconcile_exact_coupang_live_create_get_only.sql",
  import.meta.url,
), "utf8");
const predecessorResolver = predecessorMigration.match(
  /create function public\.sellerpilot_service_resolve_exact_coupang_live_verifier[\s\S]*?end\$\$;/,
)?.[0] ?? "";

test("exact Coupang resolver accepts only the active PostgREST service role", () => {
  const resolver = migration.match(
    /create or replace function[\s\S]*?\n\$\$;\n\nrevoke all on function/,
  )?.[0] ?? "";
  assert.ok(resolver);
  assert.match(
    resolver,
    /current_setting\('role', true\) is distinct from 'service_role'/,
  );
  assert.doesNotMatch(resolver, /request\.jwt\.claim\.role/);
  assert.match(
    migration,
    /grant execute on function[\s\S]*sellerpilot_service_resolve_exact_coupang_live_verifier\(uuid\)[\s\S]*to service_role/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function[\s\S]*to (?:anon|authenticated)/,
  );
  assert.match(
    migration,
    /definition_sha256 <> 'f00cf967f04081ad22a5f0b259d314d712f5acc7c438b34410f6ebf1ba079349'/,
  );
  assert.match(
    migration,
    /'cd812a3ab7a039384f7446072878d23c26dfaec3442a7c4a03eb7efe71bce3ec'/,
  );
  assert.equal(
    migration.match(/af8340dcac984a197adf6dd7a9f3d54b61c32cdfeb5e5d6b040827266c1c8193/g)?.length,
    2,
  );
  assert.equal(
    migration.match(
      /array\['postgres:EXECUTE:f', 'service_role:EXECUTE:f'\]::text\[\]/g,
    )?.length,
    2,
  );
  assert.equal(
    migration.match(/function_owner <> 'postgres'/g)?.length,
    2,
  );
  assert.equal(migration.match(/or not security_definer/g)?.length, 2);
  assert.equal(
    migration.match(/function_config is distinct from array\['search_path=""'\]::text\[\]/g)?.length,
    2,
  );
  assert.equal(
    migration.match(
      /pg_catalog\.strpos\([\s\S]*?pg_catalog\.lower\(definition\)[\s\S]*?'current_setting\(''role'', true\) is distinct from ''service_role'''[\s\S]*?\)/g,
    )?.length,
    1,
  );
});

test("role guard repair preserves the exact GET-only reconciliation contract", () => {
  for (const invariant of [
    "coupang_exact_live_completion_valid",
    "coupang_exact_live_remote_resources",
    "coupang_exact_live_verify_receipts",
    "16375780938",
    "providerLiveVerified",
    "buyerVisibleVerified",
    "providerMutationPerformed",
  ]) {
    assert.ok(migration.includes(invariant), `missing invariant: ${invariant}`);
  }
  assert.doesNotMatch(
    migration,
    /provider_mutation_started_at\s*=|write_resource_(?:kind|key)\s*=/,
  );
});

test("PostgreSQL applies the exact patch and admits only service_role execution", async () => {
  assert.ok(predecessorResolver);
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema extensions;
      create extension pgcrypto with schema extensions;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid primary key,
        response_payload jsonb
      );
      create table sellerpilot_private.channel_operation_attempts(
        id uuid primary key
      );
      create table sellerpilot_private.product_listings(
        id uuid primary key,
        owner_id uuid,
        remote_id text,
        status text,
        failure_class text,
        remote_visibility text,
        provider_status text,
        remote_resources jsonb,
        published_at timestamptz,
        last_verified_at timestamptz,
        last_error text,
        updated_at timestamptz
      );
      create table sellerpilot_private.coupang_exact_live_verify_runs(
        verifier_job_id uuid primary key,
        source_job_id uuid,
        source_attempt_id uuid,
        listing_id uuid,
        source_job_sha256 text,
        source_attempt_sha256 text
      );
      create table sellerpilot_private.coupang_exact_live_verify_receipts(
        verifier_job_id uuid primary key,
        source_job_id uuid,
        source_attempt_id uuid,
        listing_id uuid,
        remote_id text,
        response_sha256 text,
        seller_product_verified boolean,
        all_vendor_items_on_sale boolean,
        exact_content_verified boolean,
        exact_eight_images_verified boolean,
        vendor_item_ids jsonb,
        provider_live_verified boolean,
        buyer_visible_verified boolean,
        provider_mutation_performed boolean,
        recorded_at timestamptz
      );
      create table sellerpilot_private.operation_audit(
        owner_id uuid,
        action text,
        entity_type text,
        entity_id text,
        safe_detail jsonb
      );
      create function sellerpilot_private.coupang_exact_live_remote_resources(uuid)
      returns jsonb language sql stable set search_path = '' as
      $$ select '{}'::jsonb $$;
      create function sellerpilot_private.coupang_exact_live_completion_valid(uuid)
      returns boolean language sql stable set search_path = '' as
      $$ select false $$;
      ${predecessorResolver}
      revoke all on function
      public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)
      from public, anon, authenticated;
      grant execute on function
      public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)
      to service_role;
    `);

    await db.exec(migration);
    await db.exec(migration);

    await db.exec("set role service_role");
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_resolve_exact_coupang_live_verifier('86d2cb63-d382-4cc9-8153-654cf7ccec80')",
      ),
      /exact Coupang verifier run missing/,
    );
    await db.exec("reset role");

    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query(
          "select public.sellerpilot_service_resolve_exact_coupang_live_verifier('86d2cb63-d382-4cc9-8153-654cf7ccec80')",
        ),
        /permission denied|not permitted/i,
      );
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});
