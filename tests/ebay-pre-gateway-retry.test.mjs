import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901165800_recover_ebay_exact_pre_gateway_retry.sql",
  import.meta.url,
);
const credentialRotationMigrationUrl = new URL(
  "../supabase/migrations/20260901165900_recover_ebay_exact_credential_rotation.sql",
  import.meta.url,
);
const v101CredentialRotationMigrationUrl = new URL(
  "../supabase/migrations/20260901173700_recover_ebay_exact_v101_credential_rotation.sql",
  import.meta.url,
);
const ebayNoEffectMigrationUrl = new URL(
  "../supabase/migrations/20260901165500_recover_ebay_deterministic_no_effect_retry.sql",
  import.meta.url,
);

const ids = {
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  product: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listing: "8b2cbfaf-3854-437d-b381-abfd70291354",
  historicalCredential: "9e7de791-e6e6-4255-8d61-5a1f9576d797",
  currentCredential: "75853087-d2a8-4f56-9c05-e66fcc65e372",
  v101Credential: "f78397ec-c387-48ec-b562-64e754d90ac5",
  competingCredential: "6dc1b794-2417-4fc8-af3d-cb404214927d",
  sourceJob: "08e8cff9-5d7c-4992-b668-6d932aa5ff10",
  sourceAttempt: "22457f2e-51d8-43c5-bb03-d2c1bb7fe697",
  sourcePermit: "c2e9f199-f6a7-425f-8668-7eebd5b08bb4",
  retryAttempt: "c9d5b739-4ae7-4596-acbc-06f900a21ba3",
  retryPermit: "7ae83178-d335-4b7e-8e35-2f55e905bbde",
  retryJob: "d7f2843d-3a6a-4d33-98ca-67e4620b67f3",
  nextAttempt: "123edaa4-1681-4cf0-9e46-1030f3a5bcd8",
};

const releaseSha = "f51d5147f28949b2ef9d07d1d13ecb404259b260";
const v101ReleaseSha = "52490285b070f31bba898bed431ffc489684c001";
const sourceFingerprint =
  "79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc";
const retryFingerprint =
  "ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2";
const sellerAccountKey =
  "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const delimiters = ["$$", "$function$"];
  const bodyCandidates = delimiters
    .map((delimiter) => ({
      delimiter,
      offset: source.indexOf(`as ${delimiter}`, start),
    }))
    .filter(({ offset }) => offset >= 0)
    .sort((left, right) => left.offset - right.offset);
  assert.notEqual(bodyCandidates.length, 0, `${signature} body must exist`);
  const { delimiter, offset: bodyStart } = bodyCandidates[0];
  const end = source.indexOf(
    `${delimiter};`,
    bodyStart + `as ${delimiter}`.length,
  );
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + delimiter.length + 1);
}

function extractTaggedDo(source, tag) {
  const marker = `$${tag}$`;
  const start = source.indexOf(`do ${marker}`);
  assert.notEqual(start, -1, `${tag} must exist`);
  const end = source.indexOf(`${marker};`, start + marker.length);
  assert.notEqual(end, -1, `${tag} end must exist`);
  return source.slice(start, end + marker.length + 1);
}

test("pre-gateway recovery remains exact and removes the unsupported JSON helper", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  for (const exactValue of [
    ids.listing,
    ids.sourceJob,
    ids.sourceAttempt,
    ids.sourcePermit,
    ids.retryAttempt,
    ids.retryPermit,
    retryFingerprint,
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(
    migration,
    /select count\(\*\) from pg_catalog\.jsonb_object_keys\(v_retry\)/u,
  );
  assert.match(
    migration,
    /pg_catalog\.strpos\(v_definition, 'jsonb_object_length'\) > 0/u,
  );
  assert.match(migration, /'gatewayJobCount', 0/u);
  assert.match(migration, /'providerMutationCount', 0/u);
  assert.match(migration, /'autoRetry', false/u);
  assert.match(migration, /'oldJobReused', false/u);
  assert.doesNotMatch(migration, /delete\s+from/iu);
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
});

test("credential rotation migration is one exact permit transition with no provider retry", async () => {
  const migration = await readFile(credentialRotationMigrationUrl, "utf8");
  for (const exactValue of [
    ids.listing,
    ids.retryAttempt,
    ids.retryPermit,
    ids.historicalCredential,
    ids.currentCredential,
    retryFingerprint,
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(migration, /current_credential\.version = 100/u);
  assert.match(
    migration,
    /'ebay_exact_pre_gateway_credential_rotated'/u,
  );
  assert.match(migration, /'providerMutationCount', 0/u);
  assert.match(migration, /'autoRetry', false/u);
  assert.doesNotMatch(migration, /delete\s+from/iu);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_operation_attempts/iu,
  );
});

test("v101 rotation remains one exact unbound permit transition with no provider action", async () => {
  const migration = await readFile(v101CredentialRotationMigrationUrl, "utf8");
  for (const exactValue of [
    ids.listing,
    ids.retryAttempt,
    ids.retryPermit,
    ids.historicalCredential,
    ids.v101Credential,
    retryFingerprint,
    "BEEF134012FD",
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(migration, /current_credential\.version = 101/u);
  assert.match(
    migration,
    /'ebay_exact_pre_gateway_v101_credential_rotated'/u,
  );
  assert.match(migration, /release_sha = p_release_sha/u);
  assert.match(migration, /'providerMutationCount', 0/u);
  assert.match(migration, /'autoRetry', false/u);
  for (const digest of [
    "b5388d573e78fcfb4a752ca878ec005689c2cc14fcf2778e3dc464e8172dd40c",
    "327202829188f619271744f99be91246d9be70fd382656b0a4892be4dc91b4bc",
    "cd7cf419254b00848274a78eba3025821d9d98a1da7dc0b72a56aa5c9579536d",
    "7ef1164cda06fda7cbda1df47fd5772bc5702fb9c26ae870bb98bfb94004d236",
    "6d1e06f43ce762917cc936aea0bdbaf1acd157d22804f589e0b92241b771b833",
    "24682b20f45912cb2864cb880ba98179110088ec3be6ece49d52442c73129542",
    "0261afc163ecfa7025b5722836b87acf5c6f65058de9d2c4d34f06d43b3a0771",
  ]) {
    assert.match(migration, new RegExp(digest, "u"));
  }
  assert.match(
    migration,
    /v_now timestamptz := statement_timestamp\(\)/u,
  );
  assert.match(
    migration,
    /from public, anon, authenticated, service_role;\s*grant execute on function\s+public\.sellerpilot_service_arm_ebay_no_effect_retry/isu,
  );
  assert.match(
    migration,
    /not pg_catalog\.has_function_privilege\(\s*'service_role', v_arm_signature, 'EXECUTE'/u,
  );
  assert.doesNotMatch(migration, /delete\s+from/iu);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_operation_attempts/iu,
  );
});

test("PGlite preserves v100 and rotates only the same expired permit to sole active v101", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const rotationMigration = await readFile(credentialRotationMigrationUrl, "utf8");
  const v101RotationMigration = await readFile(
    v101CredentialRotationMigrationUrl,
    "utf8",
  );
  const ebayNoEffectMigration = await readFile(
    ebayNoEffectMigrationUrl,
    "utf8",
  );
  const proof = extractFunction(
    migration,
    "create function\n  sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(",
  );
  const rearmProof = extractFunction(
    migration,
    "create function\n  sellerpilot_private.ebay_exact_pre_gateway_rearm_is_proved(",
  );
  const retryAvailable = extractFunction(
    migration,
    "create or replace function\n  sellerpilot_private.ebay_exact_no_effect_retry_available(",
  );
  const permitCurrent = extractFunction(
    migration,
    "create or replace function\n  sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(",
  );
  const arm = extractFunction(
    migration,
    "create or replace function public.sellerpilot_service_arm_ebay_no_effect_retry(",
  );
  const patchLineage = extractTaggedDo(
    migration,
    "patch_ebay_pre_gateway_identity_and_enqueue_lineage",
  );
  const patchKeyCount = extractTaggedDo(
    migration,
    "patch_ebay_retry_marker_key_count",
  );
  const permitTransition = extractTaggedDo(
    migration,
    "patch_ebay_pre_gateway_permit_transition",
  );
  const rotatedProof = extractFunction(
    rotationMigration,
    "create or replace function\n  sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(",
  );
  const rotatedAvailability = extractTaggedDo(
    rotationMigration,
    "patch_ebay_rotated_retry_availability",
  );
  const rotatedPermitTransition = extractTaggedDo(
    rotationMigration,
    "patch_ebay_rotated_permit_transition",
  );
  const rotatedArm = extractTaggedDo(
    rotationMigration,
    "patch_ebay_retry_arm_credential_rotation",
  );
  const exactPermitGuard = extractFunction(
    ebayNoEffectMigration,
    "create or replace function\n  sellerpilot_private.guard_exact_existing_update_permit_transition()",
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
      create schema extensions;

      create table sellerpilot_private.products (
        id uuid primary key, owner_id uuid not null, sku text not null,
        on_hand integer not null, demo boolean not null, status text not null
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key, channel text not null,
        seller_account_key text not null, version integer not null,
        fingerprint text not null, seller_account_key_source text,
        seller_account_verified_at timestamptz, expires_at timestamptz,
        last_checked_at timestamptz, last_check_status text,
        environment text not null, status text not null
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key, owner_id uuid not null, credential_id uuid,
        channel text not null, operation text not null, status text not null,
        http_status integer, remote_id text, completed_at timestamptz,
        gateway_write_required boolean not null,
        pre_gateway_retryable boolean not null, request_fingerprint text,
        seller_account_key text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, owner_id uuid not null, product_id uuid not null,
        channel_key text not null, status text not null, failure_class text,
        operation_attempt_id uuid, remote_id text, market text,
        target_id text, marketplace_sku text, provider_resource_id text,
        remote_resources jsonb not null, currency text, price numeric,
        requested_publication_intent text, remote_visibility text,
        provider_status text, published_at timestamptz,
        seller_account_key text
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, attempt_id uuid unique, listing_id uuid,
        credential_id uuid, channel text, operation text, environment text,
        status text, response_payload jsonb, request_fingerprint text,
        request_payload jsonb
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key, channel text, listing_id uuid,
        product_id uuid, credential_id uuid, owner_id uuid, market text,
        target_id text, remote_id text, seller_sku text,
        provider_resource_id text, currency text, price numeric, stock integer,
        seller_account_key text, credential_version integer,
        credential_fingerprint text, credential_account_source text,
        credential_verified_at timestamptz, credential_expires_at timestamptz,
        credential_last_checked_at timestamptz,
        credential_last_check_status text, snapshot_revision integer,
        snapshot_payload_sha256 text, snapshot_source_job_id uuid,
        release_sha text, request_fingerprint text, armed_at timestamptz,
        expires_at timestamptz, retry_source_job_id uuid,
        retry_source_attempt_id uuid, retry_source_permit_id uuid,
        retry_source_response_sha256 text, update_job_id uuid,
        update_attempt_id uuid, arguments_sha256 text, arguments_bytes integer,
        request_payload_sha256 text, request_payload_bytes integer,
        bound_at timestamptz, bound_worker_token_id uuid,
        bound_claim_token uuid, consumed_at timestamptz,
        invalidated_at timestamptz, invalidation_reason text
      );
      create table sellerpilot_private.marketplace_normalized_assets (
        object_path text primary key, status text, uploaded_at timestamptz
      );
      create table sellerpilot_private.marketplace_normalized_asset_refs (
        attempt_id uuid, owner_id uuid, product_id uuid, channel text,
        market text, target_id text, object_path text,
        upload_confirmed_at timestamptz, canonical_public_url text
      );
      create table sellerpilot_private.operation_audit (
        owner_id uuid, action text, entity_type text, entity_id text,
        safe_detail jsonb, occurred_at timestamptz
      );

      create function extensions.digest(p_value text, p_algorithm text)
      returns bytea language sql immutable as $$
        select case
          when lower(p_algorithm) = 'sha256'
          then sha256(convert_to(p_value, 'UTF8'))
          else convert_to(md5(p_value || p_algorithm), 'UTF8')
        end
      $$;
      create function sellerpilot_private.active_serverless_runtime_release_sha()
      returns text language sql stable as $$ select '${releaseSha}'::text $$;
      create function sellerpilot_private.exact_existing_update_release_is_current(
        p_channel text, p_release_sha text
      ) returns boolean language sql stable as $$
        select p_channel = 'ebay'
          and p_release_sha = sellerpilot_private.active_serverless_runtime_release_sha()
      $$;
      create function sellerpilot_private.ebay_exact_current_credential_is_valid(
        p_credential_id uuid, p_seller_account_key text
      ) returns boolean language sql stable as $$
        select p_seller_account_key = '${sellerAccountKey}'
          and exists (
            select 1
              from sellerpilot_private.channel_credentials credential
             where credential.id = p_credential_id
               and credential.channel = 'ebay'
               and credential.environment = 'production'
               and credential.status = 'active'
               and credential.seller_account_key = p_seller_account_key
               and credential.seller_account_key_source = 'provider_certified_v1'
               and credential.seller_account_verified_at is not null
               and credential.expires_at > statement_timestamp()
               and credential.last_checked_at is not null
               and credential.last_check_status = 'passed'
               and credential.version = (
                 select max(candidate.version)
                   from sellerpilot_private.channel_credentials candidate
                  where candidate.channel = 'ebay'
                    and candidate.environment = 'production'
                    and candidate.seller_account_key = p_seller_account_key
               )
               and 1 = (
                 select count(*)
                   from sellerpilot_private.channel_credentials active_credential
                  where active_credential.channel = 'ebay'
                    and active_credential.environment = 'production'
                    and active_credential.status = 'active'
                    and active_credential.seller_account_key = p_seller_account_key
               )
          )
      $$;
      create function sellerpilot_private.ebay_exact_no_effect_source_is_proved()
      returns boolean language sql stable as $$ select true $$;

      create function sellerpilot_private.guard_exact_existing_update_permit_transition()
      returns trigger language plpgsql security definer set search_path = '' as $$
      declare
        v_mutable_fields constant text[] := array[
          'update_job_id', 'update_attempt_id', 'arguments_sha256',
          'arguments_bytes', 'request_payload_sha256', 'request_payload_bytes',
          'bound_at', 'bound_worker_token_id', 'bound_claim_token', 'consumed_at',
          'invalidated_at', 'invalidation_reason'
        ];
      begin
        if tg_op = 'DELETE' then
          raise exception 'exact existing update permits cannot be deleted';
        end if;
        if to_jsonb(new) - v_mutable_fields is distinct from
             to_jsonb(old) - v_mutable_fields
        then
          raise exception 'exact existing update permit identity is immutable';
        end if;
        if old.update_job_id is null
           and old.update_attempt_id is null
           and old.arguments_sha256 is null
           and old.request_payload_sha256 is null
           and old.bound_at is null
           and old.consumed_at is null
           and old.invalidated_at is null
           and new.update_job_id is not null
           and new.update_attempt_id is not null
        then return new; end if;
        raise exception 'exact existing update permit transition invalid';
      end;
      $$;
      create trigger guard_exact_existing_update_permit_transition
      before update or delete
      on sellerpilot_private.exact_existing_update_permits
      for each row execute function
        sellerpilot_private.guard_exact_existing_update_permit_transition();

      create function public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
        p_listing_id uuid, p_credential_id uuid, p_product_id uuid,
        p_market text, p_target_id text
      ) returns jsonb language sql stable as $$
        select case when exists (
          select 1 from sellerpilot_private.product_listings listing
           where listing.id = p_listing_id
             and listing.operation_attempt_id =
                   '${ids.sourceAttempt}'::uuid
        ) then jsonb_build_object('status', 'allowed')
          else jsonb_build_object('status', 'blocked') end
      $$;
      create function public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
        p_listing_id uuid, p_credential_id uuid, p_product_id uuid,
        p_market text, p_target_id text
      ) returns jsonb language sql stable as $$
        select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
          p_listing_id, p_credential_id, p_product_id, p_market, p_target_id
        )
      $$;

      create function public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
        p_listing_id uuid, p_credential_id uuid, p_attempt_id uuid,
        p_channel text, p_operation text, p_request_payload jsonb
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare
        v_job_id uuid := '${ids.retryJob}'::uuid;
      begin
        if not exists (
          select 1 from sellerpilot_private.product_listings listing
           where listing.id = p_listing_id
             and listing.operation_attempt_id =
                   '${ids.sourceAttempt}'::uuid
             and listing.failure_class = 'retryable'
        ) then raise exception 'EBAY_INNER_LINEAGE_MISMATCH'; end if;
        if not sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(
          '${ids.retryPermit}'::uuid
        ) then raise exception 'EBAY_PERMIT_NOT_CURRENT'; end if;
        insert into sellerpilot_private.channel_gateway_jobs (
          id, attempt_id, listing_id, credential_id, channel, operation,
          environment, status, request_fingerprint, request_payload
        ) values (
          v_job_id, p_attempt_id, p_listing_id, p_credential_id, p_channel,
          p_operation, 'production', 'queued', '${retryFingerprint}',
          p_request_payload
        ) on conflict (attempt_id) do nothing;
        update sellerpilot_private.exact_existing_update_permits
           set update_job_id = v_job_id,
               update_attempt_id = p_attempt_id,
               arguments_sha256 = repeat('d', 64),
               arguments_bytes = 200,
               request_payload_sha256 = repeat('e', 64),
               request_payload_bytes = 300
         where permit_id = '${ids.retryPermit}'::uuid
           and update_job_id is null and update_attempt_id is null;
        return jsonb_build_object(
          'status', 'queued', 'job_id', v_job_id, 'reused', false
        );
      end;
      $$;

      create function public.sellerpilot_service_enqueue_listing_gateway_job(
        p_listing_id uuid, p_credential_id uuid, p_attempt_id uuid,
        p_channel text, p_operation text, p_request_payload jsonb
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare
        v_retry jsonb :=
          p_request_payload#>'{arguments,sellerpilotEbayExactNoEffectRetry}';
        v_recovery_permit boolean;
      begin
        select exists (
          select 1 from sellerpilot_private.exact_existing_update_permits permit
           where permit.channel = 'ebay' and permit.listing_id = p_listing_id
             and permit.credential_id = p_credential_id
             and permit.retry_source_job_id = '${ids.sourceJob}'::uuid
             and permit.update_job_id is null
             and permit.invalidated_at is null
             and permit.expires_at > statement_timestamp()
        ) into v_recovery_permit;
        if v_recovery_permit and (
          jsonb_typeof(v_retry) is distinct from 'object'
          or jsonb_object_length(v_retry) <> 7
          or v_retry->>'contract' is distinct from
               'ebay_exact_no_effect_retry_v1'
          or v_retry->>'sourceJobId' is distinct from '${ids.sourceJob}'
          or v_retry->>'sourceAttemptId' is distinct from '${ids.sourceAttempt}'
          or v_retry->>'sourcePermitId' is distinct from '${ids.sourcePermit}'
          or v_retry->>'sourceRequestFingerprint' is distinct from
               '${sourceFingerprint}'
          or v_retry->'providerErrorId' is distinct from '25718'::jsonb
          or v_retry->>'providerEffect' is distinct from
               'deterministic_rejection_no_effect'
        ) then raise exception 'EBAY_EXACT_NO_EFFECT_RETRY_MARKER_REQUIRED'; end if;
        return public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
          p_listing_id, p_credential_id, p_attempt_id, p_channel,
          p_operation, p_request_payload
        );
      end;
      $$;

      insert into sellerpilot_private.products values (
        '${ids.product}', '${ids.owner}', 'QA-20260823-CC-001',
        1, false, 'active'
      );
      insert into sellerpilot_private.channel_credentials values
      (
        '${ids.historicalCredential}', 'ebay', '${sellerAccountKey}', 99,
        'B99B99B99B99', 'provider_certified_v1',
        '2026-09-01 07:00:00+00',
        '2026-09-01 09:00:00+00',
        '2026-09-01 08:00:00+00', 'passed',
        'production', 'revoked'
      ),
      (
        '${ids.currentCredential}', 'ebay', '${sellerAccountKey}', 100,
        'C100C100C100', 'provider_certified_v1',
        clock_timestamp() - interval '30 minutes',
        clock_timestamp() + interval '1 day',
        clock_timestamp() - interval '1 minute', 'passed',
        'production', 'active'
      );
      insert into sellerpilot_private.channel_operation_attempts values
      (
        '${ids.sourceAttempt}', '${ids.owner}', '${ids.historicalCredential}', 'ebay',
        'listing.update', 'failed', 400, '800551945442',
        '2026-09-01 08:16:15.994005+00', true, false,
        '${sourceFingerprint}', '${sellerAccountKey}'
      ),
      (
        '${ids.retryAttempt}', '${ids.owner}', '${ids.historicalCredential}', 'ebay',
        'listing.update', 'failed', 422, null,
        '2026-09-01 09:03:06.5+00', true, true,
        '${retryFingerprint}', '${sellerAccountKey}'
      );
      insert into sellerpilot_private.product_listings values (
        '${ids.listing}', '${ids.owner}', '${ids.product}', 'ebay', 'failed',
        'retryable', '${ids.retryAttempt}', '800551945442', 'US', 'EBAY_US',
        'QA-20260823-CC-001-US', '244042196011', '{}'::jsonb,
        'USD', 12.90, 'live', 'unknown', null, null, '${sellerAccountKey}'
      );
      insert into sellerpilot_private.channel_gateway_jobs (
        id, attempt_id, listing_id, credential_id, channel, operation,
        environment, status, response_payload, request_fingerprint,
        request_payload
      ) values (
        '${ids.sourceJob}', '${ids.sourceAttempt}', '${ids.listing}',
        '${ids.historicalCredential}', 'ebay', 'listing.update', 'production',
        'succeeded', jsonb_build_object(
          'ok', false, 'steps', jsonb_build_array(
            jsonb_build_object('name', 'offer-update-discovery-readback'),
            jsonb_build_object('name', 'offer-update-preflight-readback'),
            jsonb_build_object('name', 'inventory-item-update-preflight-readback'),
            jsonb_build_object(
              'name', 'inventory-item-update', 'data', jsonb_build_object(
                'errors', jsonb_build_array(jsonb_build_object('errorId', 25718))
              )
            )
          )
        ), '${sourceFingerprint}', '{}'::jsonb
      );
      insert into sellerpilot_private.exact_existing_update_permits (
        permit_id, channel, listing_id, product_id, credential_id, owner_id,
        release_sha, request_fingerprint, update_job_id, update_attempt_id,
        bound_at, bound_worker_token_id, bound_claim_token, consumed_at,
        invalidated_at, invalidation_reason
      ) values (
        '${ids.sourcePermit}', 'ebay', '${ids.listing}', '${ids.product}',
        '${ids.historicalCredential}', '${ids.owner}', '${releaseSha}',
        '${sourceFingerprint}', '${ids.sourceJob}', '${ids.sourceAttempt}',
        '2026-09-01 08:16:10+00', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '2026-09-01 08:16:12.8+00', '2026-09-01 08:16:16+00',
        'ebay_deterministic_no_effect_400'
      );
      insert into sellerpilot_private.exact_existing_update_permits (
        permit_id, channel, listing_id, product_id, credential_id, owner_id,
        market, target_id, remote_id, seller_sku, provider_resource_id,
        currency, price, stock, seller_account_key, credential_version,
        credential_fingerprint, credential_account_source,
        credential_verified_at, credential_expires_at,
        credential_last_checked_at, credential_last_check_status,
        snapshot_revision, snapshot_payload_sha256, snapshot_source_job_id,
        release_sha, request_fingerprint, armed_at, expires_at,
        retry_source_job_id,
        retry_source_attempt_id, retry_source_permit_id,
        retry_source_response_sha256
      ) values (
        '${ids.retryPermit}', 'ebay', '${ids.listing}', '${ids.product}',
        '${ids.historicalCredential}', '${ids.owner}', 'US', 'EBAY_US', '800551945442',
        'QA-20260823-CC-001-US', '244042196011', 'USD', 12.90, 1,
        '${sellerAccountKey}', 99, 'B99B99B99B99',
        'provider_certified_v1', '2026-09-01 07:00:00+00',
        '2026-09-01 09:00:00+00',
        '2026-09-01 08:00:00+00', 'passed',
        null, null, null, '${releaseSha}', '${retryFingerprint}',
        '2026-09-01 08:58:00+00', '2026-09-01 09:03:00+00',
        '${ids.sourceJob}', '${ids.sourceAttempt}', '${ids.sourcePermit}',
        encode(extensions.digest(
          (select response_payload::text
             from sellerpilot_private.channel_gateway_jobs
            where id = '${ids.sourceJob}'),
          'sha256'
        ), 'hex')
      );
      insert into sellerpilot_private.marketplace_normalized_assets
        (object_path, status, uploaded_at)
      select
        'normalized/aa/' || lpad(to_hex(value), 64, '0') || '.jpg',
        'available', clock_timestamp()
      from generate_series(1, 13) value;
      insert into sellerpilot_private.marketplace_normalized_asset_refs (
        attempt_id, owner_id, product_id, channel, market, target_id,
        object_path, upload_confirmed_at, canonical_public_url
      ) select
        '${ids.retryAttempt}', '${ids.owner}', '${ids.product}', 'ebay',
        'US', 'EBAY_US', asset.object_path, clock_timestamp(),
        'https://sellerpilot.supabase.co/storage/v1/object/public/' ||
          'sellerpilot-marketplace/' || asset.object_path
      from sellerpilot_private.marketplace_normalized_assets asset;
    `);

    await db.exec(proof);
    await db.exec(rearmProof);
    await db.exec(retryAvailable);
    await db.exec(permitCurrent);
    await db.exec(patchLineage);
    await db.exec(patchKeyCount);
    await db.exec(`
      drop trigger guard_exact_existing_update_permit_transition
        on sellerpilot_private.exact_existing_update_permits;
      drop function sellerpilot_private.guard_exact_existing_update_permit_transition();
    `);
    await db.exec(exactPermitGuard);
    await db.exec(`
      create trigger guard_exact_existing_update_permit_transition
      before update or delete
      on sellerpilot_private.exact_existing_update_permits
      for each row execute function
        sellerpilot_private.guard_exact_existing_update_permit_transition()
    `);
    await db.exec(permitTransition);
    await db.exec(arm);
    await db.exec(rotatedProof);
    await db.exec(rotatedAvailability);
    await db.exec(rotatedPermitTransition);
    await db.exec(rotatedArm);

    const preV101AvailabilityDefinition = (await db.query(`
      select pg_catalog.pg_get_functiondef(
        'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)'::regprocedure
      ) definition
    `)).rows[0].definition;
    assert.match(preV101AvailabilityDefinition, /select coalesce\(/u);
    await db.exec(preV101AvailabilityDefinition.replace(
      "select coalesce(",
      "select coalesce(/* unrelated drift */",
    ));
    await assert.rejects(
      db.exec(v101RotationMigration),
      /eBay v101 retry availability preimage mismatch/u,
    );
    await db.exec("rollback");
    await db.exec(preV101AvailabilityDefinition);

    await db.exec(v101RotationMigration);
    await db.exec("set request.jwt.claim.role = 'service_role'");

    const functionPostimages = (await db.query(`
      select procedure.oid::regprocedure::text signature,
             pg_catalog.encode(
               extensions.digest(procedure.prosrc, 'sha256'), 'hex'
             ) digest,
             owner.rolname owner,
             procedure.prosecdef security_definer,
             procedure.provolatile volatility,
             procedure.prokind kind,
             procedure.proconfig config,
             language.lanname language
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
        join pg_catalog.pg_language language on language.oid = procedure.prolang
       where procedure.oid in (
         'sellerpilot_private.ebay_exact_v101_rotation_is_proved(uuid)'::regprocedure,
         'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)'::regprocedure,
         'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure,
         'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
       )
       order by signature
    `)).rows;
    assert.deepEqual(
      Object.fromEntries(functionPostimages.map((row) => [row.signature, row.digest])),
      {
        "sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)":
          "327202829188f619271744f99be91246d9be70fd382656b0a4892be4dc91b4bc",
        "sellerpilot_private.ebay_exact_v101_rotation_is_proved(uuid)":
          "0261afc163ecfa7025b5722836b87acf5c6f65058de9d2c4d34f06d43b3a0771",
        "sellerpilot_private.guard_exact_existing_update_permit_transition()":
          "7ef1164cda06fda7cbda1df47fd5772bc5702fb9c26ae870bb98bfb94004d236",
        "sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)":
          "24682b20f45912cb2864cb880ba98179110088ec3be6ece49d52442c73129542",
      },
    );
    assert.equal(new Set(functionPostimages.map((row) => row.owner)).size, 1);
    for (const row of functionPostimages) {
      assert.equal(row.security_definer, true);
      assert.equal(row.kind, "f");
      assert.deepEqual(row.config, ["search_path=\"\""]);
      if (row.signature.includes("guard_exact_existing_update_permit_transition")
          || row.signature.includes("sellerpilot_service_arm_ebay_no_effect_retry")) {
        assert.equal(row.volatility, "v");
        assert.equal(row.language, "plpgsql");
      } else {
        assert.equal(row.volatility, "s");
        assert.equal(row.language, "sql");
      }
    }

    const privileges = (await db.query(`
      select
        pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'EXECUTE'
        ) arm_service,
        pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'EXECUTE'
        ) arm_authenticated,
        pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'EXECUTE'
        ) arm_anon,
        pg_catalog.has_function_privilege(
          'service_role',
          'sellerpilot_private.ebay_exact_v101_rotation_is_proved(uuid)',
          'EXECUTE'
        ) proof_service,
        pg_catalog.has_function_privilege(
          'authenticated',
          'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)',
          'EXECUTE'
        ) availability_authenticated,
        pg_catalog.has_function_privilege(
          'anon',
          'sellerpilot_private.guard_exact_existing_update_permit_transition()',
          'EXECUTE'
        ) guard_anon
    `)).rows[0];
    assert.deepEqual(privileges, {
      arm_service: true,
      arm_authenticated: false,
      arm_anon: false,
      proof_service: false,
      availability_authenticated: false,
      guard_anon: false,
    });

    await db.exec("begin");
    const armed = (await db.query(
      `select public.sellerpilot_service_arm_ebay_no_effect_retry(
         'ebay', $1, $2, $3, $4
       ) value`,
      [ids.listing, ids.currentCredential, releaseSha, retryFingerprint],
    )).rows[0].value;
    assert.equal(armed.rearmed, true);
    assert.equal(armed.reused, true);
    assert.equal(armed.permitId, ids.retryPermit);
    assert.equal(armed.credentialRotated, true);

    assert.deepEqual(
      (await db.query(
        `select credential_id::text, credential_version,
                credential_fingerprint, update_job_id
           from sellerpilot_private.exact_existing_update_permits
          where permit_id = $1`,
        [ids.retryPermit],
      )).rows[0],
      {
        credential_id: ids.currentCredential,
        credential_version: 100,
        credential_fingerprint: "C100C100C100",
        update_job_id: null,
      },
    );
    await db.exec("rollback");

    await db.exec(`
      update sellerpilot_private.channel_credentials
         set status = 'revoked'
       where id = '${ids.currentCredential}';
      insert into sellerpilot_private.channel_credentials values (
        '${ids.v101Credential}', 'ebay', '${sellerAccountKey}', 101,
        'BEEF134012FD', 'provider_certified_v1',
        clock_timestamp() - interval '20 minutes',
        clock_timestamp() + interval '1 year',
        clock_timestamp() - interval '1 minute', 'passed',
        'production', 'active'
      );
      create or replace function
        sellerpilot_private.active_serverless_runtime_release_sha()
      returns text language sql stable as $$
        select '${v101ReleaseSha}'::text
      $$;
    `);

    const armRetry = async (
      credentialId,
      suppliedReleaseSha,
      suppliedFingerprint,
    ) => (await db.query(
      `select public.sellerpilot_service_arm_ebay_no_effect_retry(
         'ebay', $1, $2, $3, $4
       ) value`,
      [
        ids.listing,
        credentialId,
        suppliedReleaseSha,
        suppliedFingerprint,
      ],
    )).rows[0].value;

    await assert.rejects(
      armRetry(
        ids.currentCredential,
        v101ReleaseSha,
        retryFingerprint,
      ),
      /eBay deterministic no-effect retry identity invalid/u,
    );
    await assert.rejects(
      armRetry(
        ids.v101Credential,
        "0000000000000000000000000000000000000000",
        retryFingerprint,
      ),
      /eBay deterministic no-effect retry identity invalid/u,
    );
    await assert.rejects(
      armRetry(
        ids.v101Credential,
        v101ReleaseSha,
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
      /eBay deterministic no-effect retry (?:identity invalid|already consumed)/u,
    );

    await db.exec(`
      update sellerpilot_private.channel_credentials
         set fingerprint = 'BADF101BADF1'
       where id = '${ids.v101Credential}'
    `);
    await assert.rejects(
      armRetry(ids.v101Credential, v101ReleaseSha, retryFingerprint),
      /eBay deterministic no-effect retry identity invalid/u,
    );
    await db.exec(`
      update sellerpilot_private.channel_credentials
         set fingerprint = 'BEEF134012FD'
       where id = '${ids.v101Credential}'
    `);

    await db.exec(`
      insert into sellerpilot_private.channel_credentials values (
        '${ids.competingCredential}', 'ebay', '${sellerAccountKey}', 102,
        'C0FFEE102ABC', 'provider_certified_v1',
        clock_timestamp() - interval '10 minutes',
        clock_timestamp() + interval '1 year',
        clock_timestamp() - interval '1 minute', 'passed',
        'production', 'active'
      )
    `);
    await assert.rejects(
      armRetry(ids.v101Credential, v101ReleaseSha, retryFingerprint),
      /eBay deterministic no-effect retry identity invalid/u,
    );
    await db.exec(`
      delete from sellerpilot_private.channel_credentials
       where id = '${ids.competingCredential}'
    `);

    assert.deepEqual(
      (await db.query(
        `select credential_id::text, credential_version,
                credential_fingerprint, release_sha, update_job_id
           from sellerpilot_private.exact_existing_update_permits
          where permit_id = $1`,
        [ids.retryPermit],
      )).rows[0],
      {
        credential_id: ids.historicalCredential,
        credential_version: 99,
        credential_fingerprint: "B99B99B99B99",
        release_sha: releaseSha,
        update_job_id: null,
      },
    );

    const v101Armed = await armRetry(
      ids.v101Credential,
      v101ReleaseSha,
      retryFingerprint,
    );
    assert.equal(v101Armed.rearmed, true);
    assert.equal(v101Armed.reused, true);
    assert.equal(v101Armed.permitId, ids.retryPermit);
    assert.equal(v101Armed.credentialRotated, true);
    assert.equal(v101Armed.releaseSha, v101ReleaseSha);

    assert.deepEqual(
      (await db.query(
        `select credential_id::text, credential_version,
                credential_fingerprint, release_sha, update_job_id
           from sellerpilot_private.exact_existing_update_permits
          where permit_id = $1`,
        [ids.retryPermit],
      )).rows[0],
      {
        credential_id: ids.v101Credential,
        credential_version: 101,
        credential_fingerprint: "BEEF134012FD",
        release_sha: v101ReleaseSha,
        update_job_id: null,
      },
    );
    assert.equal(
      (await db.query(
        `select count(*)::integer count
           from sellerpilot_private.channel_operation_attempts
          where id = $1 and credential_id = $2`,
        [ids.retryAttempt, ids.historicalCredential],
      )).rows[0].count,
      1,
    );

    await db.exec(`
      insert into sellerpilot_private.channel_operation_attempts values (
        '${ids.nextAttempt}', '${ids.owner}', '${ids.v101Credential}',
        'ebay', 'listing.update', 'running', null, null, null,
        true, false, '${retryFingerprint}', '${sellerAccountKey}'
      )
    `);

    const finalWrapper = (await db.query(
      `select pg_get_functiondef(
        'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
      ) definition`,
    )).rows[0].definition;
    assert.doesNotMatch(finalWrapper, /jsonb_object_length/u);
    assert.match(finalWrapper, /pg_catalog\.jsonb_object_keys\(v_retry\)/u);

    const requestPayload = {
      arguments: {
        sellerpilotEbayExactNoEffectRetry: {
          contract: "ebay_exact_no_effect_retry_v1",
          sourceJobId: ids.sourceJob,
          sourceAttemptId: ids.sourceAttempt,
          sourcePermitId: ids.sourcePermit,
          sourceRequestFingerprint: sourceFingerprint,
          providerErrorId: 25718,
          providerEffect: "deterministic_rejection_no_effect",
        },
      },
    };
    const enqueue = (await db.query(
      `select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1, $2, $3, 'ebay', 'listing.update', $4::jsonb
      ) value`,
      [
        ids.listing,
        ids.v101Credential,
        ids.nextAttempt,
        JSON.stringify(requestPayload),
      ],
    )).rows[0].value;
    assert.equal(enqueue.status, "queued");
    assert.equal(enqueue.job_id, ids.retryJob);
    assert.equal(
      (await db.query(
        "select count(*)::integer count from sellerpilot_private.channel_gateway_jobs where attempt_id = $1",
        [ids.nextAttempt],
      )).rows[0].count,
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select update_job_id::text, update_attempt_id::text
           from sellerpilot_private.exact_existing_update_permits
          where permit_id = $1`,
        [ids.retryPermit],
      )).rows[0],
      { update_job_id: ids.retryJob, update_attempt_id: ids.nextAttempt },
    );
    assert.equal(
      (await db.query(
        `select count(*)::integer count
           from sellerpilot_private.operation_audit
          where action = 'ebay_exact_pre_gateway_retry_rearmed'`,
      )).rows[0].count,
      1,
    );
    assert.equal(
      (await db.query(
        `select count(*)::integer count
           from sellerpilot_private.operation_audit
          where action = 'ebay_exact_pre_gateway_credential_rotated'`,
      )).rows[0].count,
      0,
    );
    assert.equal(
      (await db.query(
        `select count(*)::integer count
           from sellerpilot_private.operation_audit
          where action = 'ebay_exact_pre_gateway_v101_credential_rotated'`,
      )).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});
