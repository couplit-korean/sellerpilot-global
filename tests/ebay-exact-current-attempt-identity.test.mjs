import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260902103000_bind_ebay_exact_current_attempt_identity.sql",
  import.meta.url,
);
const credentialMigrationUrl = new URL(
  "../supabase/migrations/20260901082000_bind_ebay_exact_update_to_current_active_credential.sql",
  import.meta.url,
);

const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const listingId = "8b2cbfaf-3854-437d-b381-abfd70291354";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const attemptId = "079cd680-47fb-4910-b3d8-27d19356e66e";
const credentialId = "a74a8894-4985-4475-a833-70abdc79620a";
const sellerAccountKey =
  "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${signature} body must exist`);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + 3);
}

test("eBay current-attempt migration is forward-only and preserves every exact fence", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  for (const exact of [
    listingId,
    productId,
    attemptId,
    "800551945442",
    "244042196011",
    "QA-20260823-CC-001-US",
    sellerAccountKey,
  ]) {
    assert.match(migration, new RegExp(exact, "u"));
  }
  assert.doesNotMatch(
    migration,
    /listing\.operation_attempt_id\s*=\s*'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid/u,
  );
  assert.match(migration, /attempt\.status = 'failed'/u);
  assert.match(migration, /attempt\.http_status = 422/u);
  assert.match(migration, /attempt\.remote_id is null/u);
  assert.match(migration, /attempt\.gateway_write_required/u);
  assert.match(migration, /attempt\.pre_gateway_retryable/u);
  assert.match(migration, /attempt_job\.attempt_id = attempt\.id/u);
  assert.doesNotMatch(migration, /credential\.version\s*=\s*106/u);
  assert.match(migration, /ebay_exact_current_credential_is_valid/u);
  assert.match(migration, /exact_existing_update_release_is_current/u);
  assert.match(migration, /active_serverless_runtime_release_sha/u);
  assert.match(migration, /listing\.price = 12\.90/u);
  assert.match(migration, /product\.on_hand = 1/u);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.(?:channel_gateway_jobs|channel_operation_attempts|exact_existing_update_permits)/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.(?:product_listings|channel_gateway_jobs|channel_operation_attempts|exact_existing_update_permits)/iu,
  );
  assert.doesNotMatch(migration, /fetch\s*\(|api\.ebay\.com/iu);
});

test("eBay exact identity follows the sole current same-seller credential and the exact failed no-job attempt", async () => {
  const [migration, credentialMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(credentialMigrationUrl, "utf8"),
  ]);
  const identity = extractFunction(
    migration,
    "create or replace function\n  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(",
  );
  const currentCredential = extractFunction(
    credentialMigration,
    "create function sellerpilot_private.ebay_exact_current_credential_is_valid(",
  );

  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
      create table sellerpilot_private.test_release_state (
        singleton boolean primary key default true,
        current boolean not null
      );
      insert into sellerpilot_private.test_release_state values (true, true);
      create table sellerpilot_private.channel_credentials (
        id uuid primary key, channel text not null, environment text not null,
        status text not null, version integer not null, fingerprint text not null,
        seller_account_key text not null, seller_account_key_source text,
        seller_account_verified_at timestamptz, expires_at timestamptz,
        last_checked_at timestamptz, last_check_status text
      );
      create table sellerpilot_private.products (
        id uuid primary key, owner_id uuid not null, sku text not null,
        on_hand integer not null, demo boolean not null, status text not null
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key, owner_id uuid not null, credential_id uuid not null,
        channel text not null, operation text not null, status text not null,
        http_status integer, remote_id text, gateway_write_required boolean,
        pre_gateway_retryable boolean, seller_account_key text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, owner_id uuid not null, product_id uuid not null,
        channel_key text not null, remote_id text, marketplace_sku text,
        provider_resource_id text, remote_resources jsonb, status text,
        failure_class text, operation_attempt_id uuid,
        requested_publication_intent text, remote_visibility text,
        provider_status text, published_at timestamptz, currency text,
        price numeric, market text, target_id text, seller_account_key text
      );
      create table sellerpilot_private.provider_listing_lineage_attestations (
        id uuid primary key, listing_id uuid not null, credential_id uuid not null,
        gateway_job_id uuid not null, channel text not null, environment text not null,
        seller_account_key text not null, expected_remote_id text,
        verified_remote_id text, market text, target_id text,
        marketplace_sku text, provider_resource_id text, evidence_version text,
        evidence_digest text, verified_at timestamptz
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, attempt_id uuid, listing_id uuid, credential_id uuid,
        channel text not null, environment text not null, operation text not null,
        status text not null, seller_account_key text
      );
      create function sellerpilot_private.active_serverless_runtime_release_sha()
      returns text language sql stable security definer set search_path = '' as $$
        select case when current then repeat('a', 40) else null end
          from sellerpilot_private.test_release_state where singleton
      $$;
      create function sellerpilot_private.exact_existing_update_release_is_current(
        p_channel text, p_release_sha text
      ) returns boolean language sql stable security definer set search_path = '' as $$
        select coalesce(
          p_channel = 'ebay'
          and p_release_sha = repeat('a', 40)
          and (select current from sellerpilot_private.test_release_state where singleton),
          false
        )
      $$;
      ${currentCredential}
      ${identity}
      insert into sellerpilot_private.products values (
        '${productId}', '${ownerId}', 'QA-20260823-CC-001', 1, false, 'active'
      );
      insert into sellerpilot_private.channel_credentials values
        ('a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1', 'ebay', 'production',
         'revoked', 84, 'A48BC6BD3D4B', '${sellerAccountKey}',
         'provider_certified_v1', now() - interval '2 days',
         now() - interval '1 day', now() - interval '1 day', 'passed'),
        ('${credentialId}', 'ebay', 'production', 'active', 106,
         'A106A106A106', '${sellerAccountKey}', 'provider_certified_v1',
         now(), now() + interval '1 day', now(), 'passed');
      insert into sellerpilot_private.channel_operation_attempts values (
        '${attemptId}', '${ownerId}', '${credentialId}', 'ebay',
        'listing.update', 'failed', 422, null, true, true, '${sellerAccountKey}'
      );
      insert into sellerpilot_private.product_listings values (
        '${listingId}', '${ownerId}', '${productId}', 'ebay',
        '800551945442', 'QA-20260823-CC-001-US', '244042196011',
        '{}'::jsonb, 'failed', 'retryable', '${attemptId}', 'live', 'unknown',
        null, null, 'USD', 12.90, 'US', 'EBAY_US', '${sellerAccountKey}'
      );
      insert into sellerpilot_private.channel_gateway_jobs values (
        'fdff6983-1f08-4f51-a751-bc61b4bf7070', null, '${listingId}',
        'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1', 'ebay', 'production',
        'listing.lineage.verify', 'succeeded', '${sellerAccountKey}'
      );
      insert into sellerpilot_private.provider_listing_lineage_attestations values (
        'fc54f95c-3533-4dbd-820f-cb2dfaf018e7', '${listingId}',
        'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1',
        'fdff6983-1f08-4f51-a751-bc61b4bf7070', 'ebay', 'production',
        '${sellerAccountKey}', '800551945442', '800551945442', 'US',
        'EBAY_US', 'QA-20260823-CC-001-US', '244042196011',
        'provider_listing_readback_v1',
        '3ba3464e14408e04967534e0227f01424378fc8b5b112ea05887769fecff781a',
        now() - interval '1 day'
      );
    `);

    const lookup = async () => (
      await db.query(
        `select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
           '${listingId}'::uuid, '${credentialId}'::uuid, '${productId}'::uuid,
           'US', 'EBAY_US'
         ) identity`,
      )
    ).rows[0].identity;

    const accepted = await lookup();
    assert.equal(accepted.listingId, listingId);
    assert.equal(accepted.credentialId, credentialId);
    assert.equal(accepted.publicListingId, "800551945442");
    assert.equal(accepted.offerId, "244042196011");
    assert.equal(accepted.priceUsd, 12.9);
    assert.equal(accepted.stock, 1);

    await db.exec(`
      insert into sellerpilot_private.channel_gateway_jobs values (
        '5ed5a486-08c5-4052-9753-a50b421cbf94', '${attemptId}', '${listingId}',
        '${credentialId}', 'ebay', 'production', 'listing.update', 'failed',
        '${sellerAccountKey}'
      )
    `);
    assert.equal(await lookup(), null, "any job for the exact attempt must close identity");
    await db.exec(`
      delete from sellerpilot_private.channel_gateway_jobs
       where id = '5ed5a486-08c5-4052-9753-a50b421cbf94';
      update sellerpilot_private.test_release_state set current = false;
    `);
    assert.equal(await lookup(), null, "inactive or non-closed-gate runtime must close identity");
    await db.exec(`
      update sellerpilot_private.test_release_state set current = true;
      update sellerpilot_private.channel_credentials
         set version = 107, fingerprint = 'A107A107A107'
       where id = '${credentialId}'
    `);
    const rotated = await lookup();
    assert.equal(
      rotated.credentialId,
      credentialId,
      "a later sole current provider-certified same-seller credential remains valid",
    );
  } finally {
    await db.close();
  }
});
