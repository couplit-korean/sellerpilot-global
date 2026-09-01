import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901164500_expose_ebay_serverless_listing_update.sql",
  import.meta.url,
);
const exactPermitMigrationUrl = new URL(
  "../supabase/migrations/20260901080000_allow_exact_existing_updates_through_closed_gate.sql",
  import.meta.url,
);
const providerUrl = new URL(
  "../lib/channels/serverless-gateway-provider.ts",
  import.meta.url,
);
const operationsUrl = new URL("../lib/channels/operations.ts", import.meta.url);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${signature} body must exist`);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + 3);
}

function extractTaggedDo(source, tag) {
  const marker = `$${tag}$`;
  const start = source.indexOf(`do ${marker}`);
  assert.notEqual(start, -1, `${tag} must exist`);
  const end = source.indexOf(`${marker};`, start + marker.length);
  assert.notEqual(end, -1, `${tag} end must exist`);
  return source.slice(start, end + marker.length + 1);
}

test("serverless allowlist changes only eBay listing.update", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const replacement = extractFunction(
    migration,
    "create or replace function sellerpilot_private.serverless_gateway_job_allowed(",
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create function sellerpilot_private.serverless_gateway_job_allowed_before_qoo10_s1_activation(
        p_channel text,
        p_operation text
      ) returns boolean language sql immutable as $$
        select (p_channel, p_operation) in (
          ('ebay', 'listing.create'),
          ('qoo10', 'listing.update'),
          ('shopee', 'orders.list')
        )
      $$;
      create function sellerpilot_private.serverless_gateway_job_allowed(
        p_channel text,
        p_operation text
      ) returns boolean language sql immutable as $$
        select case
          when p_operation = 'listing.activate'
            then p_channel in ('qoo10', 'temu')
          when p_operation = 'listing.publication.verify' and p_channel = 'temu'
            then true
          else sellerpilot_private.serverless_gateway_job_allowed_before_qoo10_s1_activation(
            p_channel, p_operation
          )
        end
      $$;
    `);
    const pairs = [
      ["ebay", "listing.create"],
      ["ebay", "listing.update"],
      ["ebay", "listing.stop"],
      ["qoo10", "listing.update"],
      ["qoo10", "listing.activate"],
      ["temu", "listing.activate"],
      ["temu", "listing.publication.verify"],
      ["shopee", "orders.list"],
    ];
    const allowed = async () => (await db.query(
      `select p.channel, p.operation,
              sellerpilot_private.serverless_gateway_job_allowed(
                p.channel, p.operation
              ) allowed
         from jsonb_to_recordset($1::jsonb) as p(channel text, operation text)
        order by p.channel, p.operation`,
      [JSON.stringify(pairs.map(([channel, operation]) => ({ channel, operation })))],
    )).rows;
    const before = await allowed();
    await db.exec(replacement);
    const after = await allowed();
    assert.deepEqual(
      after.filter((row, index) => row.allowed !== before[index].allowed),
      [{ channel: "ebay", operation: "listing.update", allowed: true }],
    );
  } finally {
    await db.close();
  }
});

test("expired permit recovery is exact, five-minute, one-shot, and pre-provider", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  for (const exactValue of [
    "08e8cff9-5d7c-4992-b668-6d932aa5ff10",
    "c2e9f199-f6a7-425f-8668-7eebd5b08bb4",
    "22457f2e-51d8-43c5-bb03-d2c1bb7fe697",
    "9e7de791-e6e6-4255-8d61-5a1f9576d797",
    "031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b",
    "79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc",
    "7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569",
    "35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d",
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(
    migration,
    /lock table sellerpilot_private\.channel_gateway_jobs[\s\S]*?lock table sellerpilot_private\.exact_existing_update_permits/u,
  );
  assert.match(
    migration,
    /job\.status = 'queued'[\s\S]*?job\.attempt_count = 0[\s\S]*?job\.worker_token_id is null[\s\S]*?job\.claim_token is null[\s\S]*?job\.provider_mutation_started_at is null/u,
  );
  assert.match(
    migration,
    /job\.oauth_provider_call_started_at is null[\s\S]*?permit\.expires_at <= statement_timestamp\(\)[\s\S]*?permit\.bound_at is null[\s\S]*?permit\.consumed_at is null[\s\S]*?permit\.invalidated_at is null/u,
  );
  assert.match(
    migration,
    /disable trigger guard_exact_existing_update_permit_transition[\s\S]*?set armed_at = v_rearmed_at,[\s\S]*?expires_at = v_rearmed_at \+ interval '5 minutes'[\s\S]*?enable trigger guard_exact_existing_update_permit_transition/u,
  );
  assert.match(migration, /EBAY_SERVERLESS_EXACT_REARM_ALREADY_RECORDED/u);
  assert.match(migration, /'providerCallReplayed', false/u);
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_operation_attempts/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.product_listings/iu,
  );
  assert.doesNotMatch(migration, /delete\s+from/iu);
  assert.doesNotMatch(
    migration,
    /create\s+or\s+replace\s+function\s+public\.sellerpilot_service_begin_serverless_gateway_provider_mutation/iu,
  );
});

test("the exact production-shaped expired tuple is rearmed once without touching the job", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const rearm = extractTaggedDo(migration, "rearm_exact_ebay_unclaimed_job");
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;

      create table sellerpilot_private.products (
        id uuid primary key,
        owner_id uuid not null,
        sku text not null,
        on_hand integer not null,
        demo boolean not null,
        status text not null
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key,
        channel text not null,
        seller_account_key text not null
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key,
        owner_id uuid not null,
        credential_id uuid,
        channel text not null,
        operation text not null,
        status text not null,
        http_status integer,
        remote_id text,
        safe_message text,
        completed_at timestamptz,
        gateway_write_required boolean default false,
        pre_gateway_retryable boolean default false,
        request_fingerprint text,
        seller_account_key text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key,
        owner_id uuid not null,
        product_id uuid not null,
        channel_key text not null,
        status text not null,
        failure_class text,
        operation_attempt_id uuid,
        last_error text,
        remote_id text,
        market text,
        target_id text,
        marketplace_sku text,
        provider_resource_id text,
        currency text,
        price numeric,
        requested_publication_intent text,
        remote_visibility text,
        provider_status text,
        published_at timestamptz,
        remote_resources jsonb,
        seller_account_key text
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        credential_id uuid,
        attempt_id uuid,
        listing_id uuid,
        channel text,
        operation text,
        environment text,
        status text,
        attempt_count integer,
        worker_token_id uuid,
        claim_token uuid,
        lease_expires_at timestamptz,
        started_at timestamptz,
        completed_at timestamptz,
        provider_mutation_started_at timestamptz,
        response_payload jsonb,
        error_message text,
        credential_refresh_in_flight boolean,
        credential_refresh_started_at timestamptz,
        credential_refresh_prepared_at timestamptz,
        prepared_credential_id uuid,
        credential_refresh_recovery_vault_id uuid,
        oauth_provider_call_started_at timestamptz,
        request_fingerprint text,
        request_payload jsonb,
        seller_account_key text
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key,
        update_job_id uuid,
        update_attempt_id uuid,
        listing_id uuid,
        product_id uuid,
        credential_id uuid,
        owner_id uuid,
        seller_account_key text,
        channel text,
        release_sha text,
        request_fingerprint text,
        arguments_sha256 text,
        arguments_bytes integer,
        request_payload_sha256 text,
        request_payload_bytes integer,
        armed_at timestamptz,
        expires_at timestamptz,
        bound_at timestamptz,
        bound_worker_token_id uuid,
        bound_claim_token uuid,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        invalidation_reason text,
        stock integer
      );
      create table sellerpilot_private.operation_audit (
        owner_id uuid,
        action text,
        entity_type text,
        entity_id text,
        safe_detail jsonb,
        occurred_at timestamptz
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
      create function sellerpilot_private.ebay_exact_current_credential_is_valid(
        p_credential_id uuid,
        p_seller_account_key text
      ) returns boolean language sql stable as $$ select true $$;
      create function sellerpilot_private.exact_existing_update_release_is_current(
        p_channel text,
        p_release_sha text
      ) returns boolean language sql stable as $$ select true $$;
      create function sellerpilot_private.exact_existing_update_arguments_valid(
        p_channel text,
        p_arguments jsonb,
        p_release_sha text,
        p_request_fingerprint text,
        p_stock integer
      ) returns boolean language sql stable as $$ select true $$;
      create function sellerpilot_private.guard_exact_existing_update_permit_transition()
      returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger guard_exact_existing_update_permit_transition
        before update on sellerpilot_private.exact_existing_update_permits
        for each row execute function
          sellerpilot_private.guard_exact_existing_update_permit_transition();

      insert into sellerpilot_private.products values (
        'ddccde35-9c58-4856-b673-d7aa27ce4220',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'QA-20260823-CC-001', 7, false, 'active'
      );
      insert into sellerpilot_private.channel_credentials values (
        '9e7de791-e6e6-4255-8d61-5a1f9576d797', 'ebay',
        'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      );
      insert into sellerpilot_private.channel_operation_attempts (
        id, owner_id, channel, operation, status
      ) values (
        '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'ebay', 'listing.create', 'failed'
      );
      insert into sellerpilot_private.channel_operation_attempts values (
        '22457f2e-51d8-43c5-bb03-d2c1bb7fe697',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        '9e7de791-e6e6-4255-8d61-5a1f9576d797',
        'ebay', 'listing.update', 'running', null, null, null, null,
        true, false,
        '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc',
        'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      );
      insert into sellerpilot_private.product_listings values (
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'ddccde35-9c58-4856-b673-d7aa27ce4220',
        'ebay', 'queued', null,
        '22457f2e-51d8-43c5-bb03-d2c1bb7fe697', null,
        '800551945442', 'US', 'EBAY_US', 'QA-20260823-CC-001-US',
        '244042196011', 'USD', 12.90, 'live', 'unknown', null, null,
        '{}'::jsonb,
        'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      );
      insert into sellerpilot_private.channel_gateway_jobs values (
        '08e8cff9-5d7c-4992-b668-6d932aa5ff10',
        '9e7de791-e6e6-4255-8d61-5a1f9576d797',
        '22457f2e-51d8-43c5-bb03-d2c1bb7fe697',
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        'ebay', 'listing.update', 'production', 'queued', 0,
        null, null, null, null, null, null, null, null,
        false, null, null, null, null, null,
        '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc',
        jsonb_build_object('arguments', jsonb_build_object(
          'sellerpilotEbayExactExistingQaRecovery', jsonb_build_object(
            'contract', 'ebay_exact_existing_qa_recovery_v2',
            'listingId', '8b2cbfaf-3854-437d-b381-abfd70291354',
            'credentialId', '9e7de791-e6e6-4255-8d61-5a1f9576d797'
          )
        )),
        'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      );
      insert into sellerpilot_private.exact_existing_update_permits (
        permit_id, update_job_id, update_attempt_id, listing_id, product_id,
        credential_id, owner_id, seller_account_key, channel, release_sha,
        request_fingerprint, arguments_sha256, arguments_bytes,
        request_payload_sha256, request_payload_bytes, armed_at, expires_at,
        stock
      ) select
        'c2e9f199-f6a7-425f-8668-7eebd5b08bb4',
        job.id, job.attempt_id, job.listing_id,
        'ddccde35-9c58-4856-b673-d7aa27ce4220', job.credential_id,
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c', job.seller_account_key,
        'ebay', '031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b',
        job.request_fingerprint,
        '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569',
        octet_length((job.request_payload->'arguments')::text),
        '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d',
        octet_length(job.request_payload::text),
        '2026-09-01 07:50:52.964294+00',
        '2026-09-01 07:55:52.964294+00', 7
      from sellerpilot_private.channel_gateway_jobs job;
    `);

    await db.exec(rearm);
    const state = (await db.query(`
      select job.status,
             job.attempt_count,
             job.provider_mutation_started_at,
             job.oauth_provider_call_started_at,
             permit.expires_at = permit.armed_at + interval '5 minutes' exact_ttl,
             permit.armed_at > '2026-09-01 07:55:52.964294+00'::timestamptz rearmed,
             count(audit.*)::integer audit_count
        from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.update_job_id = job.id
        left join sellerpilot_private.operation_audit audit
          on audit.entity_id = job.id::text
       group by job.status, job.attempt_count,
                job.provider_mutation_started_at,
                job.oauth_provider_call_started_at,
                permit.expires_at, permit.armed_at
    `)).rows[0];
    assert.deepEqual(state, {
      status: "queued",
      attempt_count: 0,
      provider_mutation_started_at: null,
      oauth_provider_call_started_at: null,
      exact_ttl: true,
      rearmed: true,
      audit_count: 1,
    });
    await assert.rejects(
      db.exec(rearm),
      /EBAY_SERVERLESS_EXACT_REARM_ALREADY_RECORDED/u,
    );
  } finally {
    await db.close();
  }
});

test("the enabled pair still reaches the exact permit and delayed provider readback fences", async () => {
  const [permitMigration, provider, operations] = await Promise.all([
    readFile(exactPermitMigrationUrl, "utf8"),
    readFile(providerUrl, "utf8"),
    readFile(operationsUrl, "utf8"),
  ]);
  assert.match(
    permitMigration,
    /job\.channel in \('coupang', 'elevenst', 'ebay'\)[\s\S]*?job\.operation = 'listing\.update'/u,
  );
  assert.match(
    permitMigration,
    /sellerpilot_private\.exact_existing_update_provider_allowed\([\s\S]*?sellerpilot_private\.consume_exact_existing_update_provider\(/u,
  );
  assert.match(
    provider,
    /input\.job\.channel === "ebay" && input\.job\.operation === "listing\.update"[\s\S]*?EBAY_EXACT_EXISTING_QA_SERVER_CONTEXT_REQUIRED[\s\S]*?assertEbayExactExistingQaProviderCopyRequest/u,
  );
  assert.match(
    provider,
    /const delayedEbayExactUpdateBoundary = input\.job\.channel === "ebay"[\s\S]*?providerMutationHooks/u,
  );
  assert.match(
    operations,
    /offer-update-preflight-readback[\s\S]*?EBAY_IMMUTABLE_LISTING_IDENTITY_VERIFIED[\s\S]*?providerMutationHooks\.begin\(\)[\s\S]*?method: "PUT"/u,
  );
});
