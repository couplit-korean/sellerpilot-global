import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const urls = {
  currentCredential: new URL("../supabase/migrations/20260901082000_bind_ebay_exact_update_to_current_active_credential.sql", import.meta.url),
  lineage: new URL("../supabase/migrations/20260901194336_rebind_ebay_exact_current_credential_lineage.sql", import.meta.url),
  dynamicCredential: new URL("../supabase/migrations/20260902083000_rearm_ebay_exact_dynamic_credential.sql", import.meta.url),
  stable: new URL("../supabase/migrations/20260902093000_stabilize_ebay_exact_content_fingerprint.sql", import.meta.url),
  representative: new URL("../supabase/migrations/20260902101500_bind_ebay_exact_server_representative.sql", import.meta.url),
  identity: new URL("../supabase/migrations/20260902103000_bind_ebay_exact_current_attempt_identity.sql", import.meta.url),
  rotatingIdentity: new URL("../supabase/migrations/20260902104000_bind_ebay_exact_rotating_credential_lineage.sql", import.meta.url),
  currentAttemptProof: new URL("../supabase/migrations/20260902106000_bind_ebay_exact_current_attempt_proof.sql", import.meta.url),
};

const id = {
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  product: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listing: "8b2cbfaf-3854-437d-b381-abfd70291354",
  attempt: "079cd680-47fb-4910-b3d8-27d19356e66e",
  historical: "66285742-5909-40db-b1f3-fa4c300b8911",
  current: "bbf7c49e-c9db-4279-adeb-b2e1b1489eb9",
  lineageCredential: "a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1",
  lineageJob: "fdff6983-1f08-4f51-a751-bc61b4bf7070",
  attestation: "fc54f95c-3533-4dbd-820f-cb2dfaf018e7",
  sourceJob: "08e8cff9-5d7c-4992-b668-6d932aa5ff10",
  sourceAttempt: "22457f2e-51d8-43c5-bb03-d2c1bb7fe697",
  sourcePermit: "c2e9f199-f6a7-425f-8668-7eebd5b08bb4",
  permit: "7ae83178-d335-4b7e-8e35-2f55e905bbde",
};
const seller = "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f";
const sourceFingerprint = "79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc";
const stableFingerprint = "acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef";
const requestFingerprint = "4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e";
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

function extractTransition(source) {
  const block = source.indexOf("do $patch_ebay_current_content_permit_transition$");
  const start = source.indexOf("v_transition constant text := $new$", block);
  const bodyStart = start + "v_transition constant text := $new$".length;
  const end = source.indexOf("$new$;", bodyStart);
  assert.ok(block >= 0 && start >= 0 && end >= 0);
  return source.slice(bodyStart, end);
}

test("real eBay current-attempt identity, proof, arm and permit trigger accept only the complete 13-asset no-job lineage", async () => {
  const [credentialMigration, lineageMigration, dynamicCredentialMigration, stableMigration, representativeMigration, identityMigration, rotatingIdentityMigration, currentAttemptProofMigration] = await Promise.all(
    Object.values(urls).map((url) => readFile(url, "utf8")),
  );
  const currentCredential = extractFunction(credentialMigration, "create function sellerpilot_private.ebay_exact_current_credential_is_valid(");
  const proof = extractFunction(lineageMigration, "create or replace function\n  sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(");
  const arm = extractFunction(lineageMigration, "create or replace function public.sellerpilot_service_arm_ebay_no_effect_retry(");
  const identity = extractFunction(identityMigration, "create or replace function\n  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(");
  const identityAlias = extractFunction(identityMigration, "create or replace function\n  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(");
  const transition = extractTransition(lineageMigration);
  const db = new PGlite();

  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema sellerpilot_private; create schema extensions;
      create function extensions.digest(value text, algorithm text) returns bytea
      language sql immutable as $$ select sha256(convert_to(value, 'UTF8')) $$;
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
        id uuid primary key, owner_id uuid not null, credential_id uuid,
        channel text not null, operation text not null, status text not null,
        http_status integer, remote_id text, completed_at timestamptz,
        gateway_write_required boolean not null, pre_gateway_retryable boolean not null,
        request_fingerprint text, seller_account_key text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, owner_id uuid not null, product_id uuid not null,
        channel_key text not null, status text, failure_class text,
        operation_attempt_id uuid, remote_id text, market text, target_id text,
        marketplace_sku text, provider_resource_id text, remote_resources jsonb,
        currency text, price numeric, requested_publication_intent text,
        remote_visibility text, provider_status text, published_at timestamptz,
        seller_account_key text
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, attempt_id uuid, listing_id uuid, credential_id uuid,
        channel text, operation text, environment text, status text,
        response_payload jsonb, request_fingerprint text, request_payload jsonb,
        seller_account_key text
      );
      create table sellerpilot_private.provider_listing_lineage_attestations (
        id uuid primary key, listing_id uuid, credential_id uuid, gateway_job_id uuid,
        channel text, environment text, seller_account_key text,
        expected_remote_id text, verified_remote_id text, market text, target_id text,
        marketplace_sku text, provider_resource_id text, evidence_version text,
        evidence_digest text, verified_at timestamptz
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key, channel text, listing_id uuid, product_id uuid,
        credential_id uuid, owner_id uuid, market text, target_id text,
        remote_id text, seller_sku text, provider_resource_id text, currency text,
        price numeric, stock integer, seller_account_key text,
        credential_version integer, credential_fingerprint text,
        credential_account_source text, credential_verified_at timestamptz,
        credential_expires_at timestamptz, credential_last_checked_at timestamptz,
        credential_last_check_status text, snapshot_revision integer,
        snapshot_payload_sha256 text, snapshot_source_job_id uuid, release_sha text,
        request_fingerprint text, armed_at timestamptz, expires_at timestamptz,
        retry_source_job_id uuid, retry_source_attempt_id uuid,
        retry_source_permit_id uuid, retry_source_response_sha256 text,
        update_job_id uuid, update_attempt_id uuid, arguments_sha256 text,
        arguments_bytes integer, request_payload_sha256 text,
        request_payload_bytes integer, bound_at timestamptz,
        bound_worker_token_id uuid, bound_claim_token uuid, consumed_at timestamptz,
        invalidated_at timestamptz, invalidation_reason text
      );
      create table sellerpilot_private.marketplace_normalized_assets (
        object_path text primary key, status text, uploaded_at timestamptz
      );
      create table sellerpilot_private.marketplace_normalized_asset_refs (
        attempt_id uuid, owner_id uuid, product_id uuid, channel text, market text,
        target_id text, object_path text, upload_confirmed_at timestamptz,
        canonical_public_url text
      );
      create table sellerpilot_private.operation_audit (
        owner_id uuid, action text, entity_type text, entity_id text,
        safe_detail jsonb, occurred_at timestamptz
      );
      create function sellerpilot_private.active_serverless_runtime_release_sha()
      returns text language sql stable as $$ select '${releaseSha}'::text $$;
      create function sellerpilot_private.exact_existing_update_release_is_current(channel text, release text)
      returns boolean language sql stable as $$ select channel = 'ebay' and release = '${releaseSha}' $$;
      ${currentCredential}
      create function sellerpilot_private.ebay_exact_v101_content_arguments_valid(p_arguments jsonb)
      returns boolean language sql immutable as $$
        select p_arguments->>'publicationExpectedFingerprint' = 'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
          and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedObjectPath}' ~
          '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'
          and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedSourceSha256}' ~
          '^[a-f0-9]{64}$'
      $$;
      create function sellerpilot_private.exact_existing_update_arguments_before_temu_173960(p_channel text, p_arguments jsonb, p_release_sha text, p_request_fingerprint text, p_expected_stock integer)
      returns boolean language sql immutable as $$
        select p_channel <> 'ebay' or (p_request_fingerprint = 'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
          and sellerpilot_private.ebay_exact_v101_content_arguments_valid(p_arguments))
      $$;
      create function sellerpilot_private.exact_existing_update_arguments_before_lazada_173980(channel text, arguments jsonb, release text, fingerprint text, stock integer)
      returns boolean language sql immutable as $$ select sellerpilot_private.exact_existing_update_arguments_before_temu_173960(channel, arguments, release, fingerprint, stock) $$;
      create function sellerpilot_private.sp_173990_exact_args_pre(channel text, arguments jsonb, release text, fingerprint text, stock integer)
      returns boolean language sql immutable as $$ select sellerpilot_private.exact_existing_update_arguments_before_lazada_173980(channel, arguments, release, fingerprint, stock) $$;
      create function sellerpilot_private.exact_existing_update_arguments_valid(channel text, arguments jsonb, release text, fingerprint text, stock integer)
      returns boolean language sql immutable as $$ select sellerpilot_private.sp_173990_exact_args_pre(channel, arguments, release, fingerprint, stock) $$;
      ${proof}
      create function sellerpilot_private.guard_exact_existing_update_permit_transition()
      returns trigger language plpgsql security definer set search_path = '' as $$
      begin
      ${transition}
        raise exception 'exact permit immutable';
      end $$;
      create trigger guard_exact_existing_update_permit_transition before update or delete
      on sellerpilot_private.exact_existing_update_permits for each row execute function sellerpilot_private.guard_exact_existing_update_permit_transition();
      ${arm}
      ${identity}
      ${identityAlias}
    `);

    await db.exec(dynamicCredentialMigration);
    await db.exec(stableMigration);
    await db.exec(representativeMigration);
    await db.exec(identity);
    await db.exec(identityAlias);
    await db.exec(rotatingIdentityMigration);
    await db.exec(currentAttemptProofMigration);

    await db.exec(`
      insert into sellerpilot_private.products values ('${id.product}','${id.owner}','QA-20260823-CC-001',1,false,'active');
      insert into sellerpilot_private.channel_credentials values
        ('${id.lineageCredential}','ebay','production','revoked',84,'A48BC6BD3D4B','${seller}','provider_certified_v1',now()-interval '3 days',now()-interval '2 days',now()-interval '2 days','passed'),
        ('${id.historical}','ebay','production','revoked',106,'A106A106A106','${seller}','provider_certified_v1',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day','failed'),
        ('${id.current}','ebay','production','active',107,'A107A107A107','${seller}','provider_certified_v1',now()-interval '1 hour',now()+interval '1 day',now(),'passed');
      insert into sellerpilot_private.channel_operation_attempts values
        ('${id.sourceAttempt}','${id.owner}','${id.lineageCredential}','ebay','listing.update','failed',400,'800551945442',now()-interval '2 days',true,false,'${sourceFingerprint}','${seller}'),
        ('${id.attempt}','${id.owner}','${id.historical}','ebay','listing.update','failed',422,null,now()-interval '1 hour',true,true,'${stableFingerprint}','${seller}');
      insert into sellerpilot_private.product_listings values ('${id.listing}','${id.owner}','${id.product}','ebay','failed','retryable','${id.attempt}','800551945442','US','EBAY_US','QA-20260823-CC-001-US','244042196011','{}','USD',12.90,'live','unknown',null,null,'${seller}');
      insert into sellerpilot_private.channel_gateway_jobs values
        ('${id.lineageJob}',null,'${id.listing}','${id.lineageCredential}','ebay','listing.lineage.verify','production','succeeded','{}',null,'{}','${seller}'),
        ('${id.sourceJob}','${id.sourceAttempt}','${id.listing}','${id.lineageCredential}','ebay','listing.update','production','succeeded',jsonb_build_object('ok',false,'steps',jsonb_build_array(jsonb_build_object('name','one'),jsonb_build_object('name','two'),jsonb_build_object('name','three'),jsonb_build_object('name','inventory-item-update','data',jsonb_build_object('errors',jsonb_build_array(jsonb_build_object('errorId',25718)))))), '${sourceFingerprint}','{}','${seller}');
      insert into sellerpilot_private.provider_listing_lineage_attestations values ('${id.attestation}','${id.listing}','${id.lineageCredential}','${id.lineageJob}','ebay','production','${seller}','800551945442','800551945442','US','EBAY_US','QA-20260823-CC-001-US','244042196011','provider_listing_readback_v1','3ba3464e14408e04967534e0227f01424378fc8b5b112ea05887769fecff781a',now()-interval '1 day');
      insert into sellerpilot_private.exact_existing_update_permits (permit_id,channel,listing_id,product_id,credential_id,owner_id,release_sha,request_fingerprint,update_job_id,update_attempt_id,bound_at,bound_worker_token_id,bound_claim_token,consumed_at,invalidated_at,invalidation_reason)
      values ('${id.sourcePermit}','ebay','${id.listing}','${id.product}','${id.lineageCredential}','${id.owner}','${releaseSha}','${sourceFingerprint}','${id.sourceJob}','${id.sourceAttempt}',now()-interval '2 days','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',now()-interval '2 days',now()-interval '2 days','ebay_deterministic_no_effect_400');
      insert into sellerpilot_private.exact_existing_update_permits (permit_id,channel,listing_id,product_id,credential_id,owner_id,market,target_id,remote_id,seller_sku,provider_resource_id,currency,price,stock,seller_account_key,credential_version,credential_fingerprint,credential_account_source,credential_verified_at,credential_expires_at,credential_last_checked_at,credential_last_check_status,release_sha,request_fingerprint,armed_at,expires_at,retry_source_job_id,retry_source_attempt_id,retry_source_permit_id,retry_source_response_sha256)
      values ('${id.permit}','ebay','${id.listing}','${id.product}','${id.historical}','${id.owner}','US','EBAY_US','800551945442','QA-20260823-CC-001-US','244042196011','USD',12.90,1,'${seller}',106,'A106A106A106','provider_certified_v1',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day','failed','${releaseSha}','${stableFingerprint}',now()-interval '10 minutes',now()-interval '5 minutes','${id.sourceJob}','${id.sourceAttempt}','${id.sourcePermit}',encode(extensions.digest((select response_payload::text from sellerpilot_private.channel_gateway_jobs where id='${id.sourceJob}'),'sha256'),'hex'));
      insert into sellerpilot_private.marketplace_normalized_assets select path,'available',now() from (
        select 'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg' path
        union all select 'normalized/aa/'||lpad(to_hex(value),64,'0')||'.jpg' from generate_series(2,13) value
      ) paths;
      insert into sellerpilot_private.marketplace_normalized_asset_refs
      select '${id.attempt}','${id.owner}','${id.product}','ebay','US','EBAY_US',object_path,now(),'https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/'||object_path
      from sellerpilot_private.marketplace_normalized_assets;
      set request.jwt.claim.role = 'service_role';
    `);

    const identityLookup = async () => (await db.query(`select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit('${id.listing}','${id.current}','${id.product}','US','EBAY_US') value`)).rows[0].value;
    const proofLookup = async () => (await db.query(`select sellerpilot_private.ebay_exact_v101_content_rebind_is_proved('${id.current}','${releaseSha}','${requestFingerprint}') value`)).rows[0].value;

    assert.equal((await identityLookup()).credentialId, id.current);
    await db.exec("delete from sellerpilot_private.marketplace_normalized_asset_refs where object_path = (select object_path from sellerpilot_private.marketplace_normalized_asset_refs where object_path like 'normalized/aa/%' limit 1)");
    assert.equal(await proofLookup(), false, "one missing asset must close the real proof");
    await db.exec(`insert into sellerpilot_private.marketplace_normalized_asset_refs select '${id.attempt}','${id.owner}','${id.product}','ebay','US','EBAY_US',object_path,now(),'https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/'||object_path from sellerpilot_private.marketplace_normalized_assets where object_path not in (select object_path from sellerpilot_private.marketplace_normalized_asset_refs)`);
    assert.equal(await proofLookup(), true);
    const armed = (await db.query(`select public.sellerpilot_service_arm_ebay_no_effect_retry('ebay','${id.listing}','${id.current}','${releaseSha}','${requestFingerprint}') value`)).rows[0].value;
    assert.equal(armed.rearmed, true);
    assert.deepEqual((await db.query(`select credential_id::text,credential_version,request_fingerprint,expires_at=armed_at+interval '5 minutes' exact_ttl from sellerpilot_private.exact_existing_update_permits where permit_id='${id.permit}'`)).rows[0], { credential_id: id.current, credential_version: 107, request_fingerprint: requestFingerprint, exact_ttl: true });
  } finally {
    await db.close();
  }
});
