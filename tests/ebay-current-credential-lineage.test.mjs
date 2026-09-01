import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  ebayExactExistingQaRecoveryBindingValue,
  ebayExactExistingQaRecoveryIdentity,
} from "../lib/channels/ebay-exact-existing-qa-recovery.ts";

const migrationUrl = new URL(
  "../supabase/migrations/20260901194336_rebind_ebay_exact_current_credential_lineage.sql",
  import.meta.url,
);
const dynamicRearmMigrationUrl = new URL(
  "../supabase/migrations/20260902083000_rearm_ebay_exact_dynamic_credential.sql",
  import.meta.url,
);
const currentCredentialMigrationUrl = new URL(
  "../supabase/migrations/20260901082000_bind_ebay_exact_update_to_current_active_credential.sql",
  import.meta.url,
);

const sellerAccountKey =
  "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f";
const revokedV101 = "f78397ec-c387-48ec-b562-64e754d90ac5";
const activeV103 = "bb42910f-68ce-4662-8867-28fad2c7a858";
const activeV104 = "0b2401d3-f6e8-44f8-9353-5b69e5035fb2";
const contentFingerprint =
  "bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231";
const releaseSha = "d".repeat(40);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${signature} body must exist`);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + 3);
}

test("eBay exact identity and permit rearm follow the sole current credential after later rotations", async () => {
  const migration = await readFile(dynamicRearmMigrationUrl, "utf8");

  for (const exactValue of [
    "8b2cbfaf-3854-437d-b381-abfd70291354",
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "c9d5b739-4ae7-4596-acbc-06f900a21ba3",
    "07b8ced8-fa77-4c22-a708-2ce1ec4e3c77",
    "800551945442",
    "244042196011",
    "QA-20260823-CC-001-US",
    sellerAccountKey,
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(
    migration,
    /sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit[\s\S]*listing\.failure_class = 'retryable'[\s\S]*ebay_exact_current_credential_is_valid/u,
  );
  assert.match(
    migration,
    /permit\.credential_id is distinct from p_credential_id/u,
  );
  assert.match(
    migration,
    /product\.on_hand = 1/u,
  );
  assert.match(
    migration,
    /'sourceAttemptId',\s*'07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'::uuid/u,
  );
  assert.match(
    migration,
    /listing\.operation_attempt_id =\s*'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid/u,
  );
  assert.doesNotMatch(migration, new RegExp(activeV103, "u"));
  assert.doesNotMatch(migration, /credential\.version = (103|104)/u);
  assert.doesNotMatch(migration, /insert\s+into\s+sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(migration, /fetch\s*\(|api\.ebay\.com|providerMutationCount'\s*,\s*1/iu);
  assert.match(migration, /does not arm a permit, enqueue a job, or call eBay/u);
});

test("the exact identity RPC accepts a later sole active credential and rejects duplicate active rows", async () => {
  const [migration, currentCredentialMigration] = await Promise.all([
    readFile(dynamicRearmMigrationUrl, "utf8"),
    readFile(currentCredentialMigrationUrl, "utf8"),
  ]);
  const identity = extractFunction(
    migration,
    "create or replace function\n  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(",
  );
  const validator = extractFunction(
    currentCredentialMigration,
    "create function sellerpilot_private.ebay_exact_current_credential_is_valid(",
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
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
        id uuid primary key, listing_id uuid, credential_id uuid,
        channel text not null, environment text not null, operation text not null,
        status text not null, seller_account_key text
      );
      ${validator}
      ${identity}
      insert into sellerpilot_private.products values (
        'ddccde35-9c58-4856-b673-d7aa27ce4220',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'QA-20260823-CC-001', 1, false, 'active'
      );
      insert into sellerpilot_private.product_listings values (
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'ddccde35-9c58-4856-b673-d7aa27ce4220', 'ebay',
        '800551945442', 'QA-20260823-CC-001-US', '244042196011',
        '{}'::jsonb, 'failed', 'retryable',
        'c9d5b739-4ae7-4596-acbc-06f900a21ba3', 'live', 'unknown',
        null, null, 'USD', 12.90, 'US', 'EBAY_US', '${sellerAccountKey}'
      );
      insert into sellerpilot_private.channel_credentials values
        ('a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1', 'ebay', 'production',
         'revoked', 84, 'A48BC6BD3D4B', '${sellerAccountKey}',
         'provider_certified_v1', now() - interval '10 days',
         now() - interval '1 day', now() - interval '1 day', 'passed'),
        ('${activeV103}', 'ebay', 'production', 'active', 103,
         'A103A103A103', '${sellerAccountKey}', 'provider_certified_v1',
         now() - interval '1 hour', now() + interval '1 day', now(), 'passed');
      insert into sellerpilot_private.channel_gateway_jobs values (
        'fdff6983-1f08-4f51-a751-bc61b4bf7070',
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1', 'ebay', 'production',
        'listing.lineage.verify', 'succeeded', '${sellerAccountKey}'
      );
      insert into sellerpilot_private.provider_listing_lineage_attestations values (
        'fc54f95c-3533-4dbd-820f-cb2dfaf018e7',
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1',
        'fdff6983-1f08-4f51-a751-bc61b4bf7070', 'ebay', 'production',
        '${sellerAccountKey}', '800551945442', '800551945442', 'US',
        'EBAY_US', 'QA-20260823-CC-001-US', '244042196011',
        'provider_listing_readback_v1',
        '3ba3464e14408e04967534e0227f01424378fc8b5b112ea05887769fecff781a',
        now() - interval '1 day'
      );
    `);

    const lookup = async (credentialId) => (
      await db.query(
        `select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
           '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid, $1::uuid,
           'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid, 'US', 'EBAY_US'
         ) identity`,
        [credentialId],
      )
    ).rows[0].identity;

    const v103Identity = await lookup(activeV103);
    assert.equal(v103Identity.credentialId, activeV103);
    assert.equal(
      v103Identity.sourceAttemptId,
      "07b8ced8-fa77-4c22-a708-2ce1ec4e3c77",
    );
    assert.equal(
      ebayExactExistingQaRecoveryBindingValue(v103Identity)?.credentialId,
      activeV103,
    );
    assert.equal(
      v103Identity.sourceAttemptId,
      ebayExactExistingQaRecoveryIdentity.sourceAttemptId,
    );
    await db.exec(`
      update sellerpilot_private.channel_credentials
         set status = 'revoked'
       where id = '${activeV103}'::uuid;
      insert into sellerpilot_private.channel_credentials values (
        '${activeV104}', 'ebay', 'production', 'active', 104,
        'A104A104A104', '${sellerAccountKey}', 'provider_certified_v1',
        now(), now() + interval '1 day', now(), 'passed'
      );
    `);
    const v104Identity = await lookup(activeV104);
    assert.equal(v104Identity.credentialId, activeV104);
    assert.equal(
      v104Identity.sourceAttemptId,
      "07b8ced8-fa77-4c22-a708-2ce1ec4e3c77",
    );
    assert.equal(
      ebayExactExistingQaRecoveryBindingValue(v104Identity)?.credentialId,
      activeV104,
    );

    await db.exec(`
      insert into sellerpilot_private.channel_credentials values (
        '3c46d19a-60b8-43fa-91df-b21769f97503', 'ebay', 'production',
        'active', 105, 'A105A105A105', '${sellerAccountKey}',
        'provider_certified_v1', now(), now() + interval '1 day', now(), 'passed'
      );
    `);
    assert.equal(await lookup(activeV104), null);
  } finally {
    await db.close();
  }
});

test("eBay exact content retry is dynamic but remains bound to the one listing and offer", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const proof = extractFunction(
    migration,
    "create or replace function\n  sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(",
  );
  const arm = extractFunction(
    migration,
    "create or replace function public.sellerpilot_service_arm_ebay_no_effect_retry(",
  );

  for (const exactValue of [
    "8b2cbfaf-3854-437d-b381-abfd70291354",
    "800551945442",
    "244042196011",
    "QA-20260823-CC-001-US",
    "7ae83178-d335-4b7e-8e35-2f55e905bbde",
    contentFingerprint,
    sellerAccountKey,
    "ebay_exact_current_content_contract_rearmed",
  ]) {
    assert.match(proof + arm, new RegExp(exactValue, "u"));
  }
  assert.match(proof, /ebay_exact_current_credential_is_valid/u);
  assert.match(
    proof,
    /ref\.canonical_public_url ~[\s\S]*sellerpilot-marketplace\/normalized\/29\/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a/u,
  );
  assert.match(arm, /ebay_exact_current_credential_is_valid/u);
  assert.match(arm, /expires_at = v_now \+ interval '5 minutes'/u);
  assert.match(arm, /for share of listing, credential/u);
  assert.match(arm, /for update/u);
  assert.match(
    migration,
    /exact_existing_update_lineage_is_current[\s\S]*exact_existing_update_lineage_before_lazada_173980[\s\S]*exact_existing_update_lineage_before_temu_173960[\s\S]*ebay_exact_current_credential_is_valid/u,
  );

  for (const revokedConstant of [revokedV101, "BEEF134012FD"]) {
    assert.doesNotMatch(proof, new RegExp(revokedConstant, "u"));
    assert.doesNotMatch(arm, new RegExp(revokedConstant, "u"));
  }
  assert.doesNotMatch(proof, /current_credential\.version = 101/u);
  assert.doesNotMatch(arm, /credential\.version = 101/u);
  assert.match(
    migration,
    /v_prior_rotation_start[\s\S]*v_rotation_end[\s\S]*execute v_definition/u,
  );
  assert.match(
    migration,
    /v_definition, 'f78397ec-c387-48ec-b562-64e754d90ac5'[\s\S]*<> 0/u,
  );
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
  assert.doesNotMatch(migration, /delete\s+from/iu);
  assert.match(migration, /'providerMutationCount', 0/u);
  assert.match(migration, /'gatewayJobCount', 0/u);
});

test("the existing current-credential predicate accepts v103 and fails closed on stale, duplicate, or wrong-seller rows", async () => {
  const source = await readFile(currentCredentialMigrationUrl, "utf8");
  const validator = extractFunction(
    source,
    "create function sellerpilot_private.ebay_exact_current_credential_is_valid(",
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials (
        id uuid primary key,
        channel text not null,
        environment text not null,
        status text not null,
        version integer not null,
        fingerprint text not null,
        seller_account_key text not null,
        seller_account_key_source text,
        seller_account_verified_at timestamptz,
        expires_at timestamptz,
        last_checked_at timestamptz,
        last_check_status text
      );
      ${validator}
      insert into sellerpilot_private.channel_credentials values
        ('${revokedV101}', 'ebay', 'production', 'revoked', 101,
         'BEEF134012FD', '${sellerAccountKey}', 'provider_certified_v1',
         now() - interval '1 day', now() + interval '1 day', now(), 'passed'),
        ('${activeV103}', 'ebay', 'production', 'active', 103,
         'A103A103A103', '${sellerAccountKey}', 'provider_certified_v1',
         now() - interval '1 hour', now() + interval '1 day', now(), 'passed');
    `);

    const valid = async (credentialId, key = sellerAccountKey) => (
      await db.query(
        "select sellerpilot_private.ebay_exact_current_credential_is_valid($1::uuid, $2::text) valid",
        [credentialId, key],
      )
    ).rows[0].valid;

    assert.equal(await valid(activeV103), true);
    assert.equal(await valid(revokedV101), false);
    assert.equal(await valid(activeV103, "a".repeat(64)), false);

    await db.exec(`
      insert into sellerpilot_private.channel_credentials values
        ('${activeV104}', 'ebay', 'production', 'active', 104,
         'A104A104A104', '${sellerAccountKey}', 'provider_certified_v1',
         now() - interval '1 hour', now() + interval '1 day', now(), 'passed');
    `);
    assert.equal(await valid(activeV103), false);
    assert.equal(await valid(activeV104), false);

    await db.exec(`
      delete from sellerpilot_private.channel_credentials
       where id = '${activeV104}'::uuid;
      update sellerpilot_private.channel_credentials
         set seller_account_key = '${"b".repeat(64)}'
       where id = '${activeV103}'::uuid;
    `);
    assert.equal(await valid(activeV103), false);
  } finally {
    await db.close();
  }
});

test("the arm RPC snapshots v103 once and a later credential rotation invalidates that snapshot", async () => {
  const [migration, currentCredentialMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(currentCredentialMigrationUrl, "utf8"),
  ]);
  const arm = extractFunction(
    migration,
    "create or replace function public.sellerpilot_service_arm_ebay_no_effect_retry(",
  );
  const validator = extractFunction(
    currentCredentialMigration,
    "create function sellerpilot_private.ebay_exact_current_credential_is_valid(",
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials (
        id uuid primary key, channel text not null, environment text not null,
        status text not null, version integer not null, fingerprint text not null,
        seller_account_key text not null, seller_account_key_source text,
        seller_account_verified_at timestamptz, expires_at timestamptz,
        last_checked_at timestamptz, last_check_status text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, owner_id uuid not null, channel_key text not null,
        remote_id text, market text, target_id text, marketplace_sku text,
        provider_resource_id text, currency text, price numeric,
        seller_account_key text
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key, channel text, listing_id uuid,
        remote_id text, provider_resource_id text, seller_account_key text,
        credential_id uuid, credential_version integer,
        credential_fingerprint text, credential_account_source text,
        credential_verified_at timestamptz, credential_expires_at timestamptz,
        credential_last_checked_at timestamptz,
        credential_last_check_status text, release_sha text,
        request_fingerprint text, armed_at timestamptz, expires_at timestamptz,
        update_job_id uuid, update_attempt_id uuid, arguments_sha256 text,
        arguments_bytes integer, request_payload_sha256 text,
        request_payload_bytes integer, bound_at timestamptz,
        bound_worker_token_id uuid, bound_claim_token uuid,
        consumed_at timestamptz, invalidated_at timestamptz,
        invalidation_reason text
      );
      create table sellerpilot_private.operation_audit (
        owner_id uuid, action text, entity_type text, entity_id text,
        safe_detail jsonb, occurred_at timestamptz
      );
      ${validator}
      create function sellerpilot_private.exact_existing_update_release_is_current(
        p_channel text, p_release_sha text
      ) returns boolean language sql stable as $$ select true $$;
      create function sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
        p_credential_id uuid, p_release_sha text, p_request_fingerprint text
      ) returns boolean language sql stable as $$
        select sellerpilot_private.ebay_exact_current_credential_is_valid(
          p_credential_id, '${sellerAccountKey}'
        )
      $$;
      ${arm}
      insert into sellerpilot_private.channel_credentials values
        ('${revokedV101}', 'ebay', 'production', 'revoked', 101,
         'BEEF134012FD', '${sellerAccountKey}', 'provider_certified_v1',
         now() - interval '1 day', now() + interval '1 day', now(), 'passed'),
        ('${activeV103}', 'ebay', 'production', 'active', 103,
         'A103A103A103', '${sellerAccountKey}', 'provider_certified_v1',
         now() - interval '1 hour', now() + interval '1 day', now(), 'passed');
      insert into sellerpilot_private.product_listings values (
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c', 'ebay',
        '800551945442', 'US', 'EBAY_US', 'QA-20260823-CC-001-US',
        '244042196011', 'USD', 12.90, '${sellerAccountKey}'
      );
      insert into sellerpilot_private.exact_existing_update_permits (
        permit_id, channel, listing_id, remote_id, provider_resource_id,
        seller_account_key, credential_id, credential_version,
        credential_fingerprint, credential_account_source,
        credential_verified_at, credential_expires_at,
        credential_last_checked_at, credential_last_check_status,
        release_sha, request_fingerprint, armed_at, expires_at
      ) values (
        '7ae83178-d335-4b7e-8e35-2f55e905bbde', 'ebay',
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '800551945442', '244042196011', '${sellerAccountKey}',
        '${revokedV101}', 101, 'BEEF134012FD', 'provider_certified_v1',
        now() - interval '2 days', now() - interval '1 day',
        now() - interval '2 days', 'passed', '${releaseSha}',
        '${contentFingerprint}', now() - interval '10 minutes',
        now() - interval '5 minutes'
      );
      set request.jwt.claim.role = 'service_role';
    `);

    const armed = (await db.query(
      `select public.sellerpilot_service_arm_ebay_no_effect_retry(
         'ebay', '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid,
         $1::uuid, $2::text, $3::text
       ) result`,
      [activeV103, releaseSha, contentFingerprint],
    )).rows[0].result;
    assert.equal(armed.rearmed, true);
    assert.equal(armed.credentialRotated, true);

    const snapshot = (await db.query(`
      select credential_id, credential_version, credential_fingerprint,
             expires_at = armed_at + interval '5 minutes' exact_ttl
        from sellerpilot_private.exact_existing_update_permits
    `)).rows[0];
    assert.deepEqual(snapshot, {
      credential_id: activeV103,
      credential_version: 103,
      credential_fingerprint: "A103A103A103",
      exact_ttl: true,
    });
    assert.equal((await db.query(`
      select count(*)::integer count
        from sellerpilot_private.operation_audit
       where action = 'ebay_exact_current_content_contract_rearmed'
    `)).rows[0].count, 1);

    await db.exec(`
      update sellerpilot_private.channel_credentials
         set status = 'revoked'
       where id = '${activeV103}'::uuid;
      insert into sellerpilot_private.channel_credentials values
        ('${activeV104}', 'ebay', 'production', 'active', 104,
         'A104A104A104', '${sellerAccountKey}', 'provider_certified_v1',
         now(), now() + interval '1 day', now(), 'passed');
    `);
    const oldSnapshotStillCurrent = (await db.query(
      `select sellerpilot_private.ebay_exact_current_credential_is_valid(
         credential_id, seller_account_key
       ) valid
         from sellerpilot_private.exact_existing_update_permits`,
    )).rows[0].valid;
    assert.equal(oldSnapshotStillCurrent, false);
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_arm_ebay_no_effect_retry(
           'ebay', '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid,
           $1::uuid, $2::text, $3::text
         )`,
        [activeV103, releaseSha, contentFingerprint],
      ),
      /eBay current content retry identity invalid/u,
    );
  } finally {
    await db.close();
  }
});
