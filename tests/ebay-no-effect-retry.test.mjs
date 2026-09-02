import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sourceMigrationUrl = new URL(
  "../supabase/migrations/20260901165500_recover_ebay_deterministic_no_effect_retry.sql",
  import.meta.url,
);
const correctionMigrationUrl = new URL(
  "../supabase/migrations/20260901165700_correct_ebay_no_effect_terminal_source_proof.sql",
  import.meta.url,
);
const routeUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);
const recoveryUrl = new URL(
  "../lib/channels/ebay-exact-existing-qa-recovery.ts",
  import.meta.url,
);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${signature} body must exist`);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + 3);
}

test("the retry surface is one new permit and never an old-job replay", async () => {
  const [migration, route, recovery] = await Promise.all([
    readFile(sourceMigrationUrl, "utf8"),
    readFile(routeUrl, "utf8"),
    readFile(recoveryUrl, "utf8"),
  ]);
  assert.match(migration, /exact_existing_one_retry_per_source_job/u);
  assert.match(migration, /retry_source_job_id[\s\S]*?08e8cff9-5d7c-4992-b668-6d932aa5ff10/u);
  assert.match(migration, /p_request_fingerprint =\s*'79507d23/u);
  assert.match(migration, /'autoRetry', false[\s\S]*?'oldJobReused', false/u);
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_operation_attempts/iu,
  );
  assert.doesNotMatch(
    route,
    /sellerpilot_service_arm_ebay_no_effect_retry/u,
  );
  assert.match(
    route,
    /boundEbayExactNoEffectRetry[\s\S]*?ebayExactAtomicEnqueueRequired = true[\s\S]*?sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry/u,
  );
  assert.match(
    recovery,
    /sellerpilotEbayExactNoEffectRetry[\s\S]*?deterministic_rejection_no_effect/u,
  );
});

test("PGlite proves only the exact 400/25718 first-write rejection", async () => {
  const migration = await readFile(correctionMigrationUrl, "utf8");
  const proofFunction = extractFunction(
    migration,
    "create or replace function\n  sellerpilot_private.ebay_exact_no_effect_source_is_proved()",
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, attempt_id uuid, listing_id uuid,
        credential_id uuid, channel text, operation text, environment text,
        status text, attempt_count integer, worker_token_id uuid,
        claim_token uuid, started_at timestamptz,
        provider_mutation_started_at timestamptz, completed_at timestamptz,
        request_fingerprint text, request_payload jsonb,
        response_payload jsonb
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key, status text, http_status integer,
        remote_id text, completed_at timestamptz,
        gateway_write_required boolean, pre_gateway_retryable boolean,
        request_fingerprint text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, owner_id uuid, product_id uuid,
        channel_key text, status text, failure_class text,
        operation_attempt_id uuid, remote_id text, market text,
        target_id text, marketplace_sku text, provider_resource_id text,
        currency text, price numeric, requested_publication_intent text,
        remote_visibility text, provider_status text, published_at timestamptz,
        seller_account_key text
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key, update_job_id uuid,
        update_attempt_id uuid, listing_id uuid, channel text,
        release_sha text, request_fingerprint text,
        arguments_sha256 text, request_payload_sha256 text,
        bound_at timestamptz, bound_worker_token_id uuid,
        bound_claim_token uuid, consumed_at timestamptz,
        invalidated_at timestamptz, invalidation_reason text
      );
      create function extensions.digest(p_value text, p_algorithm text)
      returns bytea language sql immutable as $$
        select decode(
          case when position('"arguments"' in p_value) > 0
            then '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d'
            else '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569'
          end,
          'hex'
        )
      $$;

      insert into sellerpilot_private.channel_operation_attempts values (
        '22457f2e-51d8-43c5-bb03-d2c1bb7fe697', 'failed', 400,
        '800551945442', '2026-09-01 08:16:15.994005+00',
        true, false,
        '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
      );
      insert into sellerpilot_private.product_listings values (
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'ddccde35-9c58-4856-b673-d7aa27ce4220',
        'ebay', 'failed', 'retryable',
        '22457f2e-51d8-43c5-bb03-d2c1bb7fe697',
        '800551945442', 'US', 'EBAY_US', 'QA-20260823-CC-001-US',
        '244042196011', 'USD', 12.90, 'live', 'unknown', null, null,
        'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      );
      insert into sellerpilot_private.channel_gateway_jobs values (
        '08e8cff9-5d7c-4992-b668-6d932aa5ff10',
        '22457f2e-51d8-43c5-bb03-d2c1bb7fe697',
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '9e7de791-e6e6-4255-8d61-5a1f9576d797',
        'ebay', 'listing.update', 'production', 'succeeded', 1,
        null, null,
        '2026-09-01 08:16:05.58709+00',
        '2026-09-01 08:16:12.740995+00',
        '2026-09-01 08:16:15.994005+00',
        '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc',
        jsonb_build_object('arguments', jsonb_build_object(
          'sellerpilotEbayExactExistingQaRecovery', jsonb_build_object(
            'contract', 'ebay_exact_existing_qa_recovery_v2'
          )
        )),
        jsonb_build_object(
          'ok', false, 'channel', 'ebay', 'operation', 'listing.update',
          'remoteId', '800551945442',
          'steps', jsonb_build_array(
            jsonb_build_object('name', 'offer-update-discovery-readback', 'ok', true, 'status', 200),
            jsonb_build_object('name', 'offer-update-preflight-readback', 'ok', true, 'status', 200),
            jsonb_build_object('name', 'inventory-item-update-preflight-readback', 'ok', true, 'status', 200),
            jsonb_build_object(
              'name', 'inventory-item-update', 'ok', false, 'status', 400,
              'data', jsonb_build_object('errors', jsonb_build_array(
                jsonb_build_object(
                  'errorId', 25718, 'domain', 'API_INVENTORY',
                  'category', 'Request',
                  'message', 'Invalid value for description. The length should be between 1 and 4000 characters.'
                )
              ))
            )
          )
        )
      );
      insert into sellerpilot_private.exact_existing_update_permits values (
        'c2e9f199-f6a7-425f-8668-7eebd5b08bb4',
        '08e8cff9-5d7c-4992-b668-6d932aa5ff10',
        '22457f2e-51d8-43c5-bb03-d2c1bb7fe697',
        '8b2cbfaf-3854-437d-b381-abfd70291354', 'ebay',
        '031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b',
        '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc',
        '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569',
        '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d',
        '2026-09-01 08:16:10+00',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '2026-09-01 08:16:12.8+00', null, null
      );
    `);
    await db.exec(proofFunction);
    const proved = await db.query(
      "select sellerpilot_private.ebay_exact_no_effect_source_is_proved() proved",
    );
    assert.equal(proved.rows[0].proved, true);

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set worker_token_id = '11111111-1111-4111-8111-111111111111'
    `);
    const unclearedTerminalToken = await db.query(
      "select sellerpilot_private.ebay_exact_no_effect_source_is_proved() proved",
    );
    assert.equal(unclearedTerminalToken.rows[0].proved, false);

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set worker_token_id = null,
             started_at = '2026-09-01 08:16:05+00'
    `);
    const roundedStart = await db.query(
      "select sellerpilot_private.ebay_exact_no_effect_source_is_proved() proved",
    );
    assert.equal(roundedStart.rows[0].proved, false);

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set started_at = '2026-09-01 08:16:05.58709+00';
      update sellerpilot_private.exact_existing_update_permits
         set bound_claim_token = null
    `);
    const missingPermitBinding = await db.query(
      "select sellerpilot_private.ebay_exact_no_effect_source_is_proved() proved",
    );
    assert.equal(missingPermitBinding.rows[0].proved, false);

    await db.exec(`
      update sellerpilot_private.exact_existing_update_permits
         set bound_claim_token = '22222222-2222-4222-8222-222222222222'
    `);

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set response_payload = jsonb_set(
           response_payload, '{steps,3,data,errors,0,errorId}', '99999'::jsonb
         )
    `);
    const wrongError = await db.query(
      "select sellerpilot_private.ebay_exact_no_effect_source_is_proved() proved",
    );
    assert.equal(wrongError.rows[0].proved, false);

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set response_payload = jsonb_set(
           jsonb_set(
             response_payload, '{steps,3,data,errors,0,errorId}', '25718'::jsonb
           ),
           '{steps}', response_payload->'steps' ||
             jsonb_build_array(jsonb_build_object(
               'name', 'offer-update', 'ok', true, 'status', 204
             ))
         )
    `);
    const laterWrite = await db.query(
      "select sellerpilot_private.ebay_exact_no_effect_source_is_proved() proved",
    );
    assert.equal(laterWrite.rows[0].proved, false);
  } finally {
    await db.close();
  }
});
