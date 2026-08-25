import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260825104700_prevent_duplicate_listing_gateway_writes.sql",
  import.meta.url,
);
const gatewayUrl = new URL("../lib/channels/gateway.ts", import.meta.url);
const adminRouteUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

const ADMIN_A = "10000000-0000-4000-8000-000000000001";
const ADMIN_B = "10000000-0000-4000-8000-000000000002";
const LISTING_ID = "20000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "30000000-0000-4000-8000-000000000001";
const ATTEMPT_A = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_B = "40000000-0000-4000-8000-000000000002";
const ATTEMPT_C = "40000000-0000-4000-8000-000000000003";
const QOO10_LISTING_ID = "21000000-0000-4000-8000-000000000001";
const QOO10_CREDENTIAL_ID = "31000000-0000-4000-8000-000000000001";
const QOO10_ATTEMPT_ID = "41000000-0000-4000-8000-000000000001";
const EBAY_LISTING_ID = "22000000-0000-4000-8000-000000000001";
const EBAY_CREDENTIAL_ID = "32000000-0000-4000-8000-000000000001";
const EBAY_ATTEMPT_ID = "42000000-0000-4000-8000-000000000001";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

test("listing gateway enqueue serializes shared-admin writes and fences unresolved outcomes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;
      create schema sellerpilot_private;

      create table sellerpilot_private.admin_users (
        user_id uuid primary key
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
        status text not null,
        http_status integer,
        safe_message text,
        completed_at timestamptz
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key,
        owner_id uuid not null,
        channel_key text not null,
        operation_attempt_id uuid,
        remote_id text,
        status text not null,
        last_error text,
        failure_class text,
        updated_at timestamptz not null default now()
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key default gen_random_uuid(),
        credential_id uuid not null,
        attempt_id uuid,
        channel text not null,
        operation text not null,
        environment text not null,
        request_payload jsonb not null,
        response_payload jsonb,
        error_message text,
        status text not null default 'queued' check (
          status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')
        ),
        created_by uuid not null,
        created_at timestamptz not null default now()
      );
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.query("insert into sellerpilot_private.admin_users(user_id) values ($1), ($2)", [ADMIN_A, ADMIN_B]);
    await db.query(
      "insert into sellerpilot_private.channel_credentials(id,channel,environment,status,created_by) values ($1,'shopee','production','active',$2)",
      [CREDENTIAL_ID, ADMIN_A],
    );
    await db.query(
      "insert into sellerpilot_private.product_listings(id,owner_id,channel_key,status) values ($1,$2,'shopee','queued')",
      [LISTING_ID, ADMIN_A],
    );
    for (const attemptId of [ATTEMPT_A, ATTEMPT_B, ATTEMPT_C]) {
      await db.query(
        "insert into sellerpilot_private.channel_operation_attempts(id,owner_id,credential_id,channel,operation,status) values ($1,$2,$3,'shopee','listing.create','running')",
        [attemptId, ADMIN_B, CREDENTIAL_ID],
      );
    }

    const enqueueSql = `select public.sellerpilot_service_enqueue_listing_gateway_job(
      $1, $2, $3, 'shopee', 'listing.create', '{"arguments":{"body":{"name":"safe"}}}'::jsonb
    )`;
    const first = await scalar(db, enqueueSql, [LISTING_ID, CREDENTIAL_ID, ATTEMPT_A]);
    assert.equal(first.status, "queued");
    assert.equal(first.reused, false);

    const exactRetry = await scalar(db, enqueueSql, [LISTING_ID, CREDENTIAL_ID, ATTEMPT_A]);
    assert.equal(exactRetry.status, "queued");
    assert.equal(exactRetry.reused, true);
    assert.equal(exactRetry.job_id, first.job_id);

    const conflictingAttempt = await scalar(db, enqueueSql, [LISTING_ID, CREDENTIAL_ID, ATTEMPT_B]);
    assert.equal(conflictingAttempt.status, "in_progress");
    assert.equal(conflictingAttempt.job_id, first.job_id);
    assert.equal(conflictingAttempt.attempt_id, ATTEMPT_A);
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_operation_attempts where id=$1", [ATTEMPT_B]),
      "failed",
    );
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"), 1);

    for (const [channel, listingId, credentialId, attemptId] of [
      ["qoo10", QOO10_LISTING_ID, QOO10_CREDENTIAL_ID, QOO10_ATTEMPT_ID],
      ["ebay", EBAY_LISTING_ID, EBAY_CREDENTIAL_ID, EBAY_ATTEMPT_ID],
    ]) {
      await db.query(
        "insert into sellerpilot_private.channel_credentials(id,channel,environment,status,created_by) values ($1,$2,'production','active',$3)",
        [credentialId, channel, ADMIN_A],
      );
      await db.query(
        "insert into sellerpilot_private.product_listings(id,owner_id,channel_key,status) values ($1,$2,$3,'queued')",
        [listingId, ADMIN_A, channel],
      );
      await db.query(
        "insert into sellerpilot_private.channel_operation_attempts(id,owner_id,credential_id,channel,operation,status) values ($1,$2,$3,$4,'listing.create','running')",
        [attemptId, ADMIN_B, credentialId, channel],
      );
      const result = await scalar(db, `select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1, $2, $3, $4, 'listing.create', '{"arguments":{"body":{"name":"safe"}}}'::jsonb
      )`, [listingId, credentialId, attemptId, channel]);
      assert.equal(result.status, "queued", channel);
      assert.equal(result.reused, false, channel);
    }
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"), 3);

    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='reconciliation_required', error_message='provider outcome unknown' where id=$1",
      [first.job_id],
    );
    // Simulate the earlier prepare RPC resetting presentation fields before the
    // listing-aware enqueue obtains its lock. The fence must restore the safe state.
    await db.query(
      "update sellerpilot_private.product_listings set status='queued', remote_id='provider-created-123', last_error=null, failure_class=null where id=$1",
      [LISTING_ID],
    );
    const unresolved = await scalar(db, enqueueSql, [LISTING_ID, CREDENTIAL_ID, ATTEMPT_C]);
    assert.equal(unresolved.status, "reconciliation_required");
    assert.equal(unresolved.job_id, first.job_id);
    assert.deepEqual(
      (await db.query(
        "select status, failure_class, operation_attempt_id::text as operation_attempt_id from sellerpilot_private.product_listings where id=$1",
        [LISTING_ID],
      )).rows[0],
      { status: "failed", failure_class: "external_action", operation_attempt_id: ATTEMPT_A },
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_operation_attempts where id=$1", [ATTEMPT_C]),
      "manual_required",
    );
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"), 3);

    await assert.rejects(
      db.query(
        "select public.sellerpilot_enqueue_channel_gateway_job($1,$2,'shopee','listing.create','{}'::jsonb)",
        [CREDENTIAL_ID, ATTEMPT_A],
      ),
      /invalid channel gateway job/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_enqueue_channel_gateway_job($1,$2,'shopee','listing.stop','{}'::jsonb)",
        [CREDENTIAL_ID, ATTEMPT_A],
      ),
      /invalid channel gateway job/,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated','public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)','execute')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role','public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)','execute')",
      ),
      true,
    );
  } finally {
    await db.close();
  }
});

test("gateway timeout, reconciliation, API, and workbench states stay distinct", async () => {
  const [gateway, adminRoute, workbench, migration] = await Promise.all([
    readFile(gatewayUrl, "utf8"),
    readFile(adminRouteUrl, "utf8"),
    readFile(workbenchUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(gateway, /job\?\.status === "reconciliation_required"[\s\S]*ChannelGatewayReconciliationRequiredError/);
  assert.match(gateway, /throw new ChannelGatewayInProgressError\(jobId, attemptId, "CHANNEL_GATEWAY_TIMEOUT"\)/);
  assert.match(gateway, /sellerpilot_service_enqueue_listing_gateway_job/);
  assert.match(adminRoute, /ChannelGatewayReconciliationRequiredError[\s\S]*manualRequired: true,[\s\S]*reconciliationRequired: true/);
  assert.match(adminRoute, /ChannelGatewayInProgressError[\s\S]*inProgress: true,[\s\S]*reconciliationRequired: false/);
  assert.match(adminRoute, /claim\.status === "running"[\s\S]*status: 202/);
  assert.match(adminRoute, /const usesChannelGateway = channel === "ebay"/);
  assert.match(adminRoute, /\(\(listingGatewayOperation \|\| writeChannelOperations\.has\(operation\)\) && channel === "qoo10"\)/);

  assert.match(workbench, /response\.status === 202 && payload\.inProgress === true/);
  assert.match(workbench, /phase: "queued"/);
  assert.match(workbench, /payload\.manualRequired === true \|\| payload\.reconciliationRequired === true/);
  assert.match(workbench, /phase: "blocked"/);
  assert.match(workbench, /window\.setTimeout\(\(\) => void poll\(\), 5_000\)/);
  assert.match(workbench, /pollCount >= 60/);
  assert.match(workbench, /window\.clearTimeout\(timer\)/);
  assert.match(workbench, /result\.phase === "queued"[\s\S]*result\.phase === "blocked"/);
  assert.match(workbench, /\["queued", "publishing"\]\.includes\(listing\.status\)/);
  assert.match(workbench, /retryGeneration = previousResult\?\.phase === "failed"/);
  assert.match(workbench, /listing\?\.operationAttemptId \?\? "initial"/);
  assert.match(workbench, /idempotencyKey = `listing:\$\{productId\}:\$\{channel\}:/);

  assert.match(migration, /for update;[\s\S]*sellerpilot_private\.channel_gateway_jobs/);
  assert.match(migration, /status in \('queued', 'running', 'reconciliation_required'\)/);
  assert.match(migration, /failure_class = 'external_action'/);
  assert.match(migration, /p_operation in \('listing\.create', 'listing\.update', 'listing\.stop'\)/);
  assert.match(migration, /p_channel not in \('qoo10',[\s\S]*'ebay'/);
  assert.doesNotMatch(migration, /v_attempt_owner_id\s*<>\s*v_listing\.owner_id/);
  assert.match(migration, /sellerpilot_private\.admin_users a where a\.user_id = v_attempt_owner_id/);
  assert.match(migration, /sellerpilot_private\.admin_users a where a\.user_id = v_listing\.owner_id/);
  assert.match(migration, /This conflicting attempt never reached the provider[\s\S]*set status = 'failed'/);
});
