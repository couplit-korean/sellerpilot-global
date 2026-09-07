import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908034500_retire_exact_coupang_failed_completion_receipt.sql",
  import.meta.url,
), "utf8");
const roleGuardRetryMigration = await readFile(new URL(
  "../supabase/migrations/20260908045000_recover_exact_coupang_verifier_after_role_guard.sql",
  import.meta.url,
), "utf8");

const id = Object.freeze({
  verifier: "86d2cb63-d382-4cc9-8153-654cf7ccec80",
  source: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  attempt: "d771421b-f408-4f75-addd-03879393fab8",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  credentialOwner: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  listingOwner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  worker: "71000000-0000-4000-8000-000000000001",
  tokenOwner: "71000000-0000-4000-8000-000000000002",
  sourceRoute: "71000000-0000-4000-8000-000000000003",
  approver: "71000000-0000-4000-8000-000000000004",
  oldClaim: "71000000-0000-4000-8000-000000000005",
  unrelatedJob: "71000000-0000-4000-8000-000000000006",
  unrelatedCredential: "71000000-0000-4000-8000-000000000007",
  unrelatedClaim: "71000000-0000-4000-8000-000000000008",
});

const release = "a78cc371969f4954db4bcfa986d7494631e84cfb";
const egress = "92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01";
const sellerKey = "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const completionFingerprint = "238cbf895c00819732d7f3c038de800700c26557bc2f0d55765b43e4a5a92451";
const productionJobSha = "3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370";
const productionReceiptSha = "0dd6addb8cb52743efd75c547913d92d7abfc6d4a824c4d1c76069b692dea9eb";
const secondProductionJobSha = "a1829784b6eae6ab834b9bcffe5e2ba0542d0e77d691300931f752e0c7080c79";
const productionRecoverySha = "855e30f766bc98895b247871d8d0b7017553c05821a391513eef5eac46ebbcd5";
const productionSourceRouteSha = "39bdf32ea69af37d3adf254a724b942c1d9bfbbac6f1d3d44d21fb6e0d132a33";
const productionExactRouteSha = "ebeabb6899f361e5e685523e1e6ad0adf2e9cd039b49100a2d576f95e430e446";
const productionSourceRoute = "01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8";
const productionWorker = "02955cb4-fa9f-466b-824f-b61f06276190";
const productionRequestFingerprint = "f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d";
const productionResolverSourceSha = "af8340dcac984a197adf6dd7a9f3d54b61c32cdfeb5e5d6b040827266c1c8193";

async function database({ seed = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(String.raw`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key, token_hash text, scope text, status text,
      expires_at timestamptz, last_seen_at timestamptz, last_version text,
      created_by uuid
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, channel text, environment text, status text,
      expires_at timestamptz, last_check_status text, seller_account_key text,
      seller_account_key_source text, created_by uuid
    );
    create table sellerpilot_private.local_channel_executor_routes(
      id uuid primary key, owner_id uuid, channel text, operation text,
      credential_id uuid, seller_account_key text, worker_token_id uuid,
      release_sha text, egress_ip_sha256 text, approved_by uuid,
      approved_at timestamptz, expires_at timestamptz, enabled boolean
    );
    create table sellerpilot_private.serverless_static_egress_policy(
      channel text primary key, enabled boolean
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key, owner_id uuid
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key, owner_id uuid
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid, attempt_id uuid, listing_id uuid,
      channel text, operation text, environment text, request_payload jsonb,
      response_payload jsonb, status text, seller_account_key text,
      request_fingerprint text, created_by uuid, created_at timestamptz,
      updated_at timestamptz,
      started_at timestamptz, completed_at timestamptz, error_message text,
      provider_mutation_started_at timestamptz, write_resource_kind text,
      write_resource_key text, credential_refresh_in_flight boolean,
      credential_refresh_started_at timestamptz,
      credential_refresh_recovery_vault_id uuid, prepared_credential_id uuid,
      oauth_provider_call_started_at timestamptz,
      oauth_exchange_completed boolean, worker_token_id uuid,
      claim_token uuid, lease_expires_at timestamptz, attempt_count integer,
      preparation_failure_count integer default 0
    );
    create table sellerpilot_private.coupang_exact_live_verify_runs(
      verifier_job_id uuid primary key, source_job_id uuid,
      source_attempt_id uuid, listing_id uuid, remote_id text,
      source_job_sha256 text, source_attempt_sha256 text,
      source_listing_sha256 text
    );
    create table sellerpilot_private.coupang_exact_live_verify_receipts(
      verifier_job_id uuid primary key
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key, claim_token uuid not null,
      worker_token_id uuid not null, completion_fingerprint text not null,
      continuation_job_id uuid, created_at timestamptz not null
    );
    create table sellerpilot_private.coupang_exact_live_local_claim_routes(
      job_id uuid primary key, credential_id uuid, worker_token_id uuid,
      owner_id uuid, channel text, operation text, seller_account_key text,
      source_read_route_id uuid, release_sha text, egress_ip_sha256 text,
      activated_by uuid, activated_at timestamptz, expires_at timestamptz
    );
    create table sellerpilot_private.fixture_state(
      singleton boolean primary key default true, source_current boolean not null
    );
    insert into sellerpilot_private.fixture_state values(true, true);
    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable set search_path='' as
    $$ select '${release}'::text $$;
    create function sellerpilot_private.coupang_exact_live_source_current()
    returns boolean language sql stable set search_path='' as
    $$ select source_current from sellerpilot_private.fixture_state where singleton $$;
    create function sellerpilot_private.coupang_exact_live_verifier_job_matches(
      job sellerpilot_private.channel_gateway_jobs
    ) returns boolean language sql immutable strict set search_path='' as $$
      select job.id = '${id.verifier}'::uuid
        and job.channel = 'coupang'
        and job.operation = 'listing.publication.verify'
        and job.environment = 'production'
        and job.attempt_id is null
        and job.provider_mutation_started_at is null
        and job.write_resource_kind is null
        and job.write_resource_key is null
    $$;
  `);

  if (!seed) return db;
  await db.exec(String.raw`
    insert into sellerpilot_private.admin_users(user_id) values
      ('${id.credentialOwner}'), ('${id.listingOwner}'),
      ('${id.tokenOwner}'), ('${id.approver}');
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${id.worker}', '${"c".repeat(64)}', 'gateway', 'active',
      clock_timestamp() + interval '1 day', clock_timestamp(),
      'sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}',
      '${id.tokenOwner}'
    );
    insert into sellerpilot_private.channel_credentials values(
      '${id.credential}', 'coupang', 'production', 'active',
      clock_timestamp() + interval '1 day', 'passed', '${sellerKey}',
      'provider_certified_v1', '${id.credentialOwner}'
    );
    insert into sellerpilot_private.channel_credentials values(
      '${id.unrelatedCredential}', 'coupang', 'production', 'active',
      clock_timestamp() + interval '1 day', 'passed', '${sellerKey}',
      'provider_certified_v1', '${id.credentialOwner}'
    );
    insert into sellerpilot_private.local_channel_executor_routes values(
      '${id.sourceRoute}', '${id.listingOwner}', 'coupang',
      'categories.validate', '${id.credential}', '${sellerKey}', '${id.worker}',
      '${release}', '${egress}', '${id.approver}',
      clock_timestamp() - interval '1 hour',
      clock_timestamp() + interval '1 day', true
    );
    insert into sellerpilot_private.serverless_static_egress_policy
      values('coupang', false);
    insert into sellerpilot_private.channel_operation_attempts
      values('${id.attempt}', '${id.listingOwner}');
    insert into sellerpilot_private.product_listings
      values('${id.listing}', '${id.listingOwner}');
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${id.verifier}', '${id.credential}', null, '${id.listing}',
      'coupang', 'listing.publication.verify', 'production',
      '{"arguments":{"sellerpilotReadOnly":true}}', null, 'failed',
      '${sellerKey}', '${"d".repeat(64)}', '${id.credentialOwner}',
      '2026-09-07 17:00:00+00', '2026-09-07 18:50:21.332045+00',
      '2026-09-07 17:29:56.708853+00',
      '2026-09-07 18:50:21.332045+00',
      'Channel worker lease expired four times.', null, null, null,
      false, null, null, null, null, false, null, null, null, 4, 0
    );
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${id.source}', '${id.credential}', '${id.attempt}', '${id.listing}',
      'coupang', 'listing.create', 'production', '{}', '{"ok":true}', 'succeeded',
      '${sellerKey}', '${"1".repeat(64)}', '${id.credentialOwner}',
      '2026-09-07 16:00:00+00', '2026-09-07 17:00:00+00',
      '2026-09-07 16:10:00+00', '2026-09-07 17:00:00+00', null,
      '2026-09-07 16:20:00+00', 'listing_mutation', '${id.listing}',
      false, null, null, null, null, false, null, null, null, 1, 0
    );
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${id.unrelatedJob}', '${id.unrelatedCredential}', null, null,
      'coupang', 'categories.validate', 'production', '{}', null, 'succeeded',
      '${sellerKey}', '${"e".repeat(64)}', '${id.credentialOwner}',
      clock_timestamp(), clock_timestamp(),
      clock_timestamp(), clock_timestamp(), null, null, null, null,
      false, null, null, null, null, false, null, null, null, 1, 0
    );
    insert into sellerpilot_private.coupang_exact_live_verify_runs
    select '${id.verifier}', '${id.source}', '${id.attempt}', '${id.listing}',
      '16375780938',
      encode(extensions.digest(to_jsonb(source_job)::text, 'sha256'), 'hex'),
      (select encode(extensions.digest(to_jsonb(attempt)::text, 'sha256'), 'hex')
         from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id='${id.attempt}'),
      (select encode(extensions.digest(to_jsonb(listing)::text, 'sha256'), 'hex')
         from sellerpilot_private.product_listings listing
        where listing.id='${id.listing}')
      from sellerpilot_private.channel_gateway_jobs source_job
     where source_job.id='${id.source}';
    insert into sellerpilot_private.gateway_completion_receipts values(
      '${id.verifier}', '${id.oldClaim}', '${id.worker}',
      '${completionFingerprint}', null,
      '2026-09-07 17:45:15.146245+00'
    );
    insert into sellerpilot_private.gateway_completion_receipts values(
      '${id.unrelatedJob}', '${id.unrelatedClaim}', '${id.worker}',
      '${"f".repeat(64)}', null, clock_timestamp() - interval '1 hour'
    );
    insert into sellerpilot_private.coupang_exact_live_local_claim_routes values(
      '${id.verifier}', '${id.credential}', '${id.worker}', '${id.listingOwner}',
      'coupang', 'listing.publication.verify', '${sellerKey}',
      '${id.sourceRoute}', '${release}', '${egress}', '${id.credentialOwner}',
      clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day'
    );
  `);
  return db;
}

async function renderedMigration(db) {
  const { rows: [{ job_sha, receipt_sha }] } = await db.query(String.raw`
    select
      (select encode(extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex')
         from sellerpilot_private.channel_gateway_jobs job
        where id = '${id.verifier}') as job_sha,
      (select encode(extensions.digest(to_jsonb(receipt)::text, 'sha256'), 'hex')
         from sellerpilot_private.gateway_completion_receipts receipt
        where job_id = '${id.verifier}') as receipt_sha
  `);
  return migration
    .replaceAll(productionJobSha, job_sha)
    .replaceAll(productionReceiptSha, receipt_sha);
}

async function renderedRoleGuardRetry(db) {
  await db.exec(String.raw`
    update sellerpilot_private.local_channel_executor_routes
       set expires_at=clock_timestamp()-interval '1 minute'
     where id='${id.sourceRoute}';
    update sellerpilot_private.coupang_exact_live_local_claim_routes
       set expires_at=clock_timestamp()-interval '1 minute'
     where job_id='${id.verifier}';
    update sellerpilot_private.channel_gateway_jobs
       set status='failed', attempt_count=4,
           started_at='2026-09-07 19:12:17.050487+00',
           completed_at='2026-09-07 19:27:22.398549+00',
           updated_at='2026-09-07 19:27:22.398549+00',
           error_message='Channel worker lease expired four times.'
     where id='${id.verifier}';
    create or replace function
    public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)
    returns boolean language sql security definer set search_path=''
    as $$ select false $$;
  `);
  const { rows: [hashes] } = await db.query(String.raw`
    select
      (select encode(extensions.digest(to_jsonb(job)::text,'sha256'),'hex')
         from sellerpilot_private.channel_gateway_jobs job
        where id='${id.verifier}') as job_sha,
      (select encode(extensions.digest(to_jsonb(recovery)::text,'sha256'),'hex')
         from sellerpilot_private.coupang_exact_live_completion_recoveries recovery
        where verifier_job_id='${id.verifier}') as recovery_sha,
      (select recovery.failed_job_sha256
         from sellerpilot_private.coupang_exact_live_completion_recoveries recovery
        where verifier_job_id='${id.verifier}') as initial_job_sha,
      (select encode(extensions.digest(to_jsonb(route)::text,'sha256'),'hex')
         from sellerpilot_private.local_channel_executor_routes route
        where id='${id.sourceRoute}') as source_route_sha,
      (select encode(extensions.digest(to_jsonb(route)::text,'sha256'),'hex')
         from sellerpilot_private.coupang_exact_live_local_claim_routes route
        where job_id='${id.verifier}') as exact_route_sha,
      (select encode(extensions.digest(p.prosrc::bytea,'sha256'),'hex')
         from pg_catalog.pg_proc p
        where p.oid=
          'public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)'::regprocedure)
        as resolver_source_sha
  `);
  return roleGuardRetryMigration
    .replaceAll(secondProductionJobSha, hashes.job_sha)
    .replaceAll(productionRecoverySha, hashes.recovery_sha)
    .replaceAll(productionJobSha, hashes.initial_job_sha)
    .replaceAll(productionSourceRouteSha, hashes.source_route_sha)
    .replaceAll(productionExactRouteSha, hashes.exact_route_sha)
    .replaceAll(productionSourceRoute, id.sourceRoute)
    .replaceAll(productionWorker, id.worker)
    .replaceAll(productionRequestFingerprint, "d".repeat(64))
    .replaceAll(productionResolverSourceSha, hashes.resolver_source_sha);
}

test("migration is exact, immutable, GET-only and pins the production preimage", () => {
  assert.match(migration, /failed_job_sha256[\s\S]*3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370/);
  assert.match(migration, /retired_completion_sha256[\s\S]*0dd6addb8cb52743efd75c547913d92d7abfc6d4a824c4d1c76069b692dea9eb/);
  assert.match(migration, /status = 'queued'[\s\S]*attempt_count = 3/);
  assert.match(migration, /provider_mutation_started_at is not null/);
  assert.match(migration, /write_resource_kind is not null/);
  assert.match(migration, /exact_route\.release_sha is distinct from[\s\S]*a78cc371969f4954db4bcfa986d7494631e84cfb/);
  assert.doesNotMatch(migration, /listing\.(create|update|stop)|provider_mutation_started_at\s*=/);
});

test("role-guard retry is exact-row-only, GET-only and pins every production preimage", () => {
  for (const digest of [
    secondProductionJobSha,
    productionRecoverySha,
    productionSourceRouteSha,
    productionExactRouteSha,
    productionResolverSourceSha,
  ]) assert.ok(roleGuardRetryMigration.includes(digest), digest);
  assert.match(roleGuardRetryMigration, /status = 'queued'[\s\S]*attempt_count = 3/);
  assert.match(roleGuardRetryMigration, /refreshed_expiry := clock_timestamp\(\) \+ interval '20 minutes'/);
  assert.match(roleGuardRetryMigration, /worker\.last_seen_at is null/);
  assert.match(roleGuardRetryMigration, /worker\.expires_at <= refreshed_expiry/);
  assert.match(roleGuardRetryMigration, /credential\.expires_at is not null[\s\S]*credential\.expires_at <= refreshed_expiry/);
  assert.match(roleGuardRetryMigration, /serverless_static_egress_policy/);
  assert.match(roleGuardRetryMigration, /sellerpilot_service_resolve_exact_coupang_live_verifier\(uuid\)'::regprocedure/);
  assert.match(roleGuardRetryMigration, /to_jsonb\(source_job\)[\s\S]*run\.source_job_sha256/);
  assert.doesNotMatch(
    roleGuardRetryMigration,
    /listing\.(create|update|stop)|provider_mutation_started_at\s*=|write_resource_(?:kind|key)\s*=/,
  );
});

test("empty database is a repeatable no-op", async () => {
  const db = await database({ seed: false });
  await db.exec(migration);
  await db.exec(migration);
  const { rows: [{ count }] } = await db.query(
    "select count(*)::int as count from sellerpilot_private.coupang_exact_live_completion_recoveries",
  );
  assert.equal(count, 0);
  await db.close();
});

test("archives exact failed job and stale receipt before recovering one attempt", async () => {
  const db = await database();
  const rendered = await renderedMigration(db);
  const { rows: [beforeJob] } = await db.query(
    `select to_jsonb(job) as row from sellerpilot_private.channel_gateway_jobs job where id='${id.verifier}'`,
  );
  const { rows: [beforeReceipt] } = await db.query(
    `select to_jsonb(receipt) as row from sellerpilot_private.gateway_completion_receipts receipt where job_id='${id.verifier}'`,
  );
  const { rows: [unrelatedBefore] } = await db.query(
    `select to_jsonb(receipt) as row from sellerpilot_private.gateway_completion_receipts receipt where job_id='${id.unrelatedJob}'`,
  );

  await db.exec(rendered);

  const { rows: [job] } = await db.query(
    `select * from sellerpilot_private.channel_gateway_jobs where id='${id.verifier}'`,
  );
  assert.equal(job.status, "queued");
  assert.equal(job.attempt_count, 3);
  for (const field of [
    "worker_token_id", "claim_token", "lease_expires_at", "started_at",
    "completed_at", "error_message", "response_payload",
    "provider_mutation_started_at", "write_resource_kind", "write_resource_key",
  ]) assert.equal(job[field], null, field);

  const { rows: [recovery] } = await db.query(
    `select * from sellerpilot_private.coupang_exact_live_completion_recoveries where verifier_job_id='${id.verifier}'`,
  );
  assert.deepEqual(recovery.failed_job_snapshot, beforeJob.row);
  assert.deepEqual(recovery.retired_completion_snapshot, beforeReceipt.row);
  assert.equal(recovery.retired_claim_token, id.oldClaim);
  assert.equal(recovery.provider_mutation_performed, false);
  const { rows: [{ count: retiredCount }] } = await db.query(
    `select count(*)::int as count from sellerpilot_private.gateway_completion_receipts where job_id='${id.verifier}'`,
  );
  assert.equal(retiredCount, 0);
  const { rows: [unrelatedAfter] } = await db.query(
    `select to_jsonb(receipt) as row from sellerpilot_private.gateway_completion_receipts receipt where job_id='${id.unrelatedJob}'`,
  );
  assert.deepEqual(unrelatedAfter.row, unrelatedBefore.row);

  await assert.rejects(
    db.exec(`update sellerpilot_private.coupang_exact_live_completion_recoveries set contract='x' where verifier_job_id='${id.verifier}'`),
    /COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_IMMUTABLE/,
  );
  await assert.rejects(
    db.exec(`delete from sellerpilot_private.coupang_exact_live_completion_recoveries where verifier_job_id='${id.verifier}'`),
    /COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_IMMUTABLE/,
  );
  await db.exec(rendered);
  await db.close();
});

test("job, receipt, source and route drift each fail closed without deleting evidence", async () => {
  const cases = [
    ["job mutation", `update sellerpilot_private.channel_gateway_jobs set response_payload='{}' where id='${id.verifier}'`],
    ["receipt mutation", `update sellerpilot_private.gateway_completion_receipts set claim_token='71000000-0000-4000-8000-000000000099' where job_id='${id.verifier}'`],
    ["source drift", "update sellerpilot_private.fixture_state set source_current=false"],
    ["route drift", `update sellerpilot_private.coupang_exact_live_local_claim_routes set release_sha='${"9".repeat(40)}' where job_id='${id.verifier}'`],
  ];
  for (const [name, mutation] of cases) {
    const db = await database();
    const rendered = await renderedMigration(db);
    await db.exec(mutation);
    await assert.rejects(db.exec(rendered), /COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_/i, name);
    await db.exec("rollback");
    const { rows: [{ receipts }] } = await db.query(
      `select count(*)::int as receipts from sellerpilot_private.gateway_completion_receipts where job_id='${id.verifier}'`,
    );
    const { rows: [{ recovery_table: recoveryTable }] } = await db.query(
      "select to_regclass('sellerpilot_private.coupang_exact_live_completion_recoveries')::text as recovery_table",
    );
    const { rows: [{ status, attempt_count: attempts }] } = await db.query(
      `select status,attempt_count from sellerpilot_private.channel_gateway_jobs where id='${id.verifier}'`,
    );
    assert.equal(receipts, 1, name);
    assert.equal(recoveryTable, null, name);
    assert.equal(status, "failed", name);
    assert.equal(attempts, 4, name);
    await db.close();
  }
});

test("role-guard recovery preserves attempt four, refreshes exact routes and queues one GET-only retry", async () => {
  const db = await database();
  await db.exec(await renderedMigration(db));
  const rendered = await renderedRoleGuardRetry(db);
  const { rows: [before] } = await db.query(String.raw`
    select
      (select to_jsonb(job) from sellerpilot_private.channel_gateway_jobs job
        where id='${id.verifier}') as job,
      (select expires_at from sellerpilot_private.local_channel_executor_routes
        where id='${id.sourceRoute}') as source_expiry,
      (select expires_at from sellerpilot_private.coupang_exact_live_local_claim_routes
        where job_id='${id.verifier}') as exact_expiry
  `);

  await db.exec(rendered);

  const { rows: [after] } = await db.query(String.raw`
    select
      (select to_jsonb(job) from sellerpilot_private.channel_gateway_jobs job
        where id='${id.verifier}') as job,
      (select to_jsonb(recovery)
         from sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries recovery
        where verifier_job_id='${id.verifier}') as recovery,
      (select expires_at from sellerpilot_private.local_channel_executor_routes
        where id='${id.sourceRoute}') as source_expiry,
      (select expires_at from sellerpilot_private.coupang_exact_live_local_claim_routes
        where job_id='${id.verifier}') as exact_expiry
  `);
  assert.deepEqual(after.recovery.failed_job_snapshot, before.job);
  assert.equal(after.recovery.provider_mutation_performed, false);
  assert.equal(after.job.status, "queued");
  assert.equal(after.job.attempt_count, 3);
  assert.equal(after.job.response_payload, null);
  assert.equal(after.job.provider_mutation_started_at, null);
  assert.ok(after.source_expiry > before.source_expiry);
  assert.equal(after.source_expiry.getTime(), after.exact_expiry.getTime());

  await db.exec(rendered);
  await assert.rejects(
    db.exec(`update sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries set contract='x' where verifier_job_id='${id.verifier}'`),
    /COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_RECOVERY_IMMUTABLE/,
  );
  await db.close();
});

test("role-guard recovery rolls back its ledger and route refresh on exact job drift", async () => {
  const db = await database();
  await db.exec(await renderedMigration(db));
  const rendered = await renderedRoleGuardRetry(db);
  const { rows: [{ expires_at: expiryBefore }] } = await db.query(
    `select expires_at from sellerpilot_private.local_channel_executor_routes where id='${id.sourceRoute}'`,
  );
  await db.exec(
    `update sellerpilot_private.channel_gateway_jobs set response_payload='{}' where id='${id.verifier}'`,
  );
  await assert.rejects(
    db.exec(rendered),
    /COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_JOB_DRIFT/,
  );
  await db.exec("rollback");
  const { rows: [{ recovery_table: recoveryTable }] } = await db.query(
    "select to_regclass('sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries')::text as recovery_table",
  );
  const { rows: [{ expires_at: expiryAfter }] } = await db.query(
    `select expires_at from sellerpilot_private.local_channel_executor_routes where id='${id.sourceRoute}'`,
  );
  assert.equal(recoveryTable, null);
  assert.equal(expiryAfter.getTime(), expiryBefore.getTime());
  await db.close();
});

test("role-guard recovery fails closed when a claim prerequisite drifts", async () => {
  const cases = [
    ["credential expired", `update sellerpilot_private.channel_credentials set expires_at=clock_timestamp()+interval '5 minutes' where id='${id.credential}'`],
    ["credential seller binding", `update sellerpilot_private.channel_credentials set seller_account_key_source='manual' where id='${id.credential}'`],
    ["worker missing heartbeat", `update sellerpilot_private.ai_cli_worker_tokens set last_seen_at=null where id='${id.worker}'`],
    ["worker short lifetime", `update sellerpilot_private.ai_cli_worker_tokens set expires_at=clock_timestamp()+interval '5 minutes' where id='${id.worker}'`],
    ["admin ownership removed", `delete from sellerpilot_private.admin_users where user_id='${id.tokenOwner}'`],
    ["static egress reopened", `update sellerpilot_private.serverless_static_egress_policy set enabled=true where channel='coupang'`],
  ];
  for (const [name, mutation] of cases) {
    const db = await database();
    await db.exec(await renderedMigration(db));
    const rendered = await renderedRoleGuardRetry(db);
    await db.exec(mutation);
    await assert.rejects(
      db.exec(rendered),
      /COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_ROUTE_DRIFT/,
      name,
    );
    await db.exec("rollback");
    const { rows: [{ status, attempt_count: attempts }] } = await db.query(
      `select status,attempt_count from sellerpilot_private.channel_gateway_jobs where id='${id.verifier}'`,
    );
    assert.equal(status, "failed", name);
    assert.equal(attempts, 4, name);
    await db.close();
  }
});

test("role-guard recovery fails closed when immutable source binding drifts", async () => {
  const cases = [
    ["source job", `update sellerpilot_private.channel_gateway_jobs set response_payload='{"ok":false}' where id='${id.source}'`],
    ["source attempt", `update sellerpilot_private.channel_operation_attempts set owner_id='${id.credentialOwner}' where id='${id.attempt}'`],
    ["source listing", `update sellerpilot_private.product_listings set owner_id='${id.credentialOwner}' where id='${id.listing}'`],
  ];
  for (const [name, mutation] of cases) {
    const db = await database();
    await db.exec(await renderedMigration(db));
    const rendered = await renderedRoleGuardRetry(db);
    await db.exec(mutation);
    await assert.rejects(
      db.exec(rendered),
      /COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_JOB_DRIFT/,
      name,
    );
    await db.exec("rollback");
    const { rows: [{ status, attempt_count: attempts }] } = await db.query(
      `select status,attempt_count from sellerpilot_private.channel_gateway_jobs where id='${id.verifier}'`,
    );
    assert.equal(status, "failed", name);
    assert.equal(attempts, 4, name);
    await db.close();
  }
});
