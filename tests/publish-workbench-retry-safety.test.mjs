import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260825104800_expose_listing_attempt_generation.sql",
  import.meta.url,
);
const preGatewayRetryMigrationUrl = new URL(
  "../supabase/migrations/20260830212500_retry_failed_pre_gateway_listing_attempts.sql",
  import.meta.url,
);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);
const channelOperationsRouteUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const LISTING_ID = "30000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "40000000-0000-4000-8000-000000000001";
const PREWRITE_ATTEMPT_ID = "40000000-0000-4000-8000-000000000002";
const PROVIDER_ATTEMPT_ID = "40000000-0000-4000-8000-000000000003";
const JOB_BACKED_ATTEMPT_ID = "40000000-0000-4000-8000-000000000004";
const LEGACY_RUNNING_ATTEMPT_ID = "40000000-0000-4000-8000-000000000005";
const IMAGE_TIMEOUT_ATTEMPT_ID = "40000000-0000-4000-8000-000000000006";
const REMOTE_ID_ATTEMPT_ID = "40000000-0000-4000-8000-000000000007";
const CREDENTIAL_ID = "50000000-0000-4000-8000-000000000001";
const REQUEST_FINGERPRINT = "a".repeat(64);

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

test("publish context exposes the exact listing attempt used as retry generation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;
      create schema auth;
      create schema sellerpilot_private;

      create function auth.uid() returns uuid language sql stable as
        'select ''${USER_ID}''::uuid';
      create function public.sellerpilot_is_admin() returns boolean language sql stable as
        'select true';

      create table sellerpilot_private.product_listings (
        id uuid primary key,
        product_id uuid not null,
        published_at timestamptz,
        operation_attempt_id uuid
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key,
        channel text not null,
        status text not null,
        expires_at timestamptz
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key default gen_random_uuid(),
        owner_id uuid not null,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        idempotency_key text not null,
        request_fingerprint text not null,
        status text not null default 'running',
        http_status integer,
        remote_id text,
        safe_message text,
        started_at timestamptz not null default now(),
        completed_at timestamptz,
        unique (channel, operation, idempotency_key)
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key default gen_random_uuid(),
        attempt_id uuid
      );

      create function public.sellerpilot_get_product_publish_context_pre_published_identity(p_product_id uuid)
      returns jsonb language sql stable as $fn$
        select jsonb_build_object(
          'listings', jsonb_build_array(jsonb_build_object(
            'id', '${LISTING_ID}',
            'channel', 'shopee',
            'market', '',
            'targetId', '',
            'status', 'failed',
            'failureClass', 'retryable'
          ))
        )
      $fn$;

      insert into sellerpilot_private.product_listings (
        id, product_id, published_at, operation_attempt_id
      ) values (
        '${LISTING_ID}', '${PRODUCT_ID}', null, '${ATTEMPT_ID}'
      );
      insert into sellerpilot_private.channel_credentials (id, channel, status)
      values ('${CREDENTIAL_ID}', 'shopee', 'active');
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.exec(`
      alter function public.sellerpilot_claim_channel_operation(
        uuid, text, text, text, text
      ) rename to sellerpilot_301000_claim_channel_operation_pre_remote_state;
      create function public.sellerpilot_claim_channel_operation(
        p_credential_id uuid,
        p_channel text,
        p_operation text,
        p_idempotency_key text,
        p_request_fingerprint text
      ) returns jsonb language sql security definer set search_path = '' as $fn$
        select public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
          p_credential_id, p_channel, p_operation, p_idempotency_key,
          p_request_fingerprint
        ) || jsonb_build_object('publication_wrapper_preserved', true)
      $fn$;
    `);
    await db.exec(await readFile(preGatewayRetryMigrationUrl, "utf8"));
    const context = await scalar(
      db,
      "select public.sellerpilot_get_product_publish_context($1)",
      [PRODUCT_ID],
    );
    assert.equal(context.listings[0].operationAttemptId, ATTEMPT_ID);
    assert.equal(context.listings[0].publishedAt, null);
    assert.equal(context.listings[0].failureClass, "retryable");

    const lostResponseKey = "listing-current-lost-response";
    const firstClaim = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, lostResponseKey, REQUEST_FINGERPRINT]);
    assert.equal(firstClaim.status, "running");
    assert.equal(firstClaim.duplicate, false);
    assert.equal(firstClaim.publication_wrapper_preserved, true);
    assert.equal(await scalar(
      db,
      "select gateway_write_required from sellerpilot_private.channel_operation_attempts where id=$1",
      [firstClaim.attempt_id],
    ), true);

    // The request can disappear after claim but before listing preparation and
    // gateway enqueue. A current-version marker proves no provider call can
    // have happened, so the exact request safely resumes the same attempt.
    const resumedClaim = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, lostResponseKey, REQUEST_FINGERPRINT]);
    assert.equal(resumedClaim.attempt_id, firstClaim.attempt_id);
    assert.equal(resumedClaim.status, "running");
    assert.equal(resumedClaim.duplicate, false);

    await db.query("insert into sellerpilot_private.channel_gateway_jobs(attempt_id) values ($1)", [firstClaim.attempt_id]);
    const fencedClaim = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, lostResponseKey, REQUEST_FINGERPRINT]);
    assert.equal(fencedClaim.attempt_id, firstClaim.attempt_id);
    assert.equal(fencedClaim.status, "running");
    assert.equal(fencedClaim.duplicate, true);

    const legacyKey = "listing-legacy-running-attempt";
    await db.query(`insert into sellerpilot_private.channel_operation_attempts (
      id, owner_id, credential_id, channel, operation, idempotency_key,
      request_fingerprint, status
    ) values ($1,$2,$3,'shopee','listing.create',$4,$5,'running')`, [
      LEGACY_RUNNING_ATTEMPT_ID,
      USER_ID,
      CREDENTIAL_ID,
      legacyKey,
      REQUEST_FINGERPRINT,
    ]);
    const legacyClaim = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, legacyKey, REQUEST_FINGERPRINT]);
    assert.equal(legacyClaim.attempt_id, LEGACY_RUNNING_ATTEMPT_ID);
    assert.equal(legacyClaim.duplicate, true);

    const prewriteKey = "listing-prewrite-safe-retry";
    await db.query(`insert into sellerpilot_private.channel_operation_attempts (
      id, owner_id, credential_id, channel, operation, idempotency_key,
      request_fingerprint, status, http_status, safe_message, completed_at
    ) values ($1,$2,$3,'shopee','listing.create',$4,$5,'failed',409,
      '상품·카테고리·채널 연결 사전조건을 충족하지 못했습니다.',now())`, [
      PREWRITE_ATTEMPT_ID,
      USER_ID,
      CREDENTIAL_ID,
      prewriteKey,
      REQUEST_FINGERPRINT,
    ]);
    const revived = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, prewriteKey, REQUEST_FINGERPRINT]);
    assert.equal(revived.attempt_id, PREWRITE_ATTEMPT_ID);
    assert.equal(revived.status, "running");
    assert.equal(revived.duplicate, false);
    assert.deepEqual(
      (await db.query("select status,http_status,safe_message,completed_at from sellerpilot_private.channel_operation_attempts where id=$1", [PREWRITE_ATTEMPT_ID])).rows[0],
      { status: "running", http_status: null, safe_message: null, completed_at: null },
    );

    const providerKey = "listing-provider-failure";
    await db.query(`insert into sellerpilot_private.channel_operation_attempts (
      id, owner_id, credential_id, channel, operation, idempotency_key,
      request_fingerprint, status, http_status, safe_message, completed_at
    ) values ($1,$2,$3,'shopee','listing.create',$4,$5,'failed',422,
      'Provider rejected the listing.',now())`, [
      PROVIDER_ATTEMPT_ID,
      USER_ID,
      CREDENTIAL_ID,
      providerKey,
      REQUEST_FINGERPRINT,
    ]);
    const providerFailure = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, providerKey, REQUEST_FINGERPRINT]);
    assert.equal(providerFailure.status, "failed");
    assert.equal(providerFailure.duplicate, true);

    const imageTimeoutKey = "listing-current-image-timeout";
    await db.query(`insert into sellerpilot_private.channel_operation_attempts (
      id, owner_id, credential_id, channel, operation, idempotency_key,
      request_fingerprint, status, gateway_write_required
    ) values ($1,$2,$3,'shopee','listing.create',$4,$5,'running',true)`, [
      IMAGE_TIMEOUT_ATTEMPT_ID,
      USER_ID,
      CREDENTIAL_ID,
      imageTimeoutKey,
      REQUEST_FINGERPRINT,
    ]);
    assert.equal(await scalar(db, `select public.sellerpilot_service_fail_pre_gateway_channel_operation(
      $1,422,'판매채널 응답 제한시간(15초)을 초과했습니다.'
    )`, [IMAGE_TIMEOUT_ATTEMPT_ID]), true);
    const imageTimeoutRetry = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, imageTimeoutKey, REQUEST_FINGERPRINT]);
    assert.equal(imageTimeoutRetry.attempt_id, IMAGE_TIMEOUT_ATTEMPT_ID);
    assert.equal(imageTimeoutRetry.status, "running");
    assert.equal(imageTimeoutRetry.duplicate, false);
    assert.deepEqual(
      (await db.query("select status,http_status,safe_message,completed_at,gateway_write_required,pre_gateway_retryable from sellerpilot_private.channel_operation_attempts where id=$1", [IMAGE_TIMEOUT_ATTEMPT_ID])).rows[0],
      {
        status: "running",
        http_status: null,
        safe_message: null,
        completed_at: null,
        gateway_write_required: true,
        pre_gateway_retryable: false,
      },
    );
    await assert.rejects(
      () => scalar(db, `select public.sellerpilot_claim_channel_operation(
        $1,'shopee','listing.create',$2,$3
      )`, [CREDENTIAL_ID, imageTimeoutKey, "b".repeat(64)]),
      /idempotency key payload mismatch/,
    );

    const remoteIdKey = "listing-current-remote-id-failure";
    await db.query(`insert into sellerpilot_private.channel_operation_attempts (
      id, owner_id, credential_id, channel, operation, idempotency_key,
      request_fingerprint, status, http_status, remote_id, safe_message,
      completed_at, gateway_write_required
    ) values ($1,$2,$3,'shopee','listing.create',$4,$5,'failed',422,
      'provider-remote-id','provider outcome failed',now(),true)`, [
      REMOTE_ID_ATTEMPT_ID,
      USER_ID,
      CREDENTIAL_ID,
      remoteIdKey,
      REQUEST_FINGERPRINT,
    ]);
    const remoteIdFailure = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, remoteIdKey, REQUEST_FINGERPRINT]);
    assert.equal(remoteIdFailure.status, "failed");
    assert.equal(remoteIdFailure.duplicate, true);

    const jobBackedKey = "listing-job-backed-failure";
    await db.query(`insert into sellerpilot_private.channel_operation_attempts (
      id, owner_id, credential_id, channel, operation, idempotency_key,
      request_fingerprint, status, http_status, safe_message, completed_at,
      gateway_write_required
    ) values ($1,$2,$3,'shopee','listing.create',$4,$5,'failed',409,
      '판매채널 응답 제한시간(15초)을 초과했습니다.',now(),true)`, [
      JOB_BACKED_ATTEMPT_ID,
      USER_ID,
      CREDENTIAL_ID,
      jobBackedKey,
      REQUEST_FINGERPRINT,
    ]);
    await db.query("insert into sellerpilot_private.channel_gateway_jobs(attempt_id) values ($1)", [JOB_BACKED_ATTEMPT_ID]);
    const jobBacked = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, jobBackedKey, REQUEST_FINGERPRINT]);
    assert.equal(jobBacked.status, "failed");
    assert.equal(jobBacked.duplicate, true);
    await db.query("delete from sellerpilot_private.channel_gateway_jobs where attempt_id=$1", [JOB_BACKED_ATTEMPT_ID]);
    const prunedJobBacked = await scalar(db, `select public.sellerpilot_claim_channel_operation(
      $1,'shopee','listing.create',$2,$3
    )`, [CREDENTIAL_ID, jobBackedKey, REQUEST_FINGERPRINT]);
    assert.equal(prunedJobBacked.status, "failed");
    assert.equal(prunedJobBacked.duplicate, true);
  } finally {
    await db.close();
  }
});

test("workbench advances retry generations but keeps queued and external-action listings fenced", async () => {
  const workbench = await readFile(workbenchUrl, "utf8");
  const channelOperationsRoute = await readFile(channelOperationsRouteUrl, "utf8");
  const preGatewayRetryMigration = await readFile(preGatewayRetryMigrationUrl, "utf8");

  assert.match(workbench, /\["queued", "publishing"\]\.includes\(listing\.status\)/);
  assert.match(workbench, /listing\?\.failureClass === "external_action"/);
  assert.match(workbench, /listingMutationGeneration\(listing, mutationGenerationRef\.current\.get\(mutationScope\)\)/);
  assert.doesNotMatch(workbench, /retryGeneration[\s\S]{0,160}crypto\.randomUUID\(\)/);
  assert.match(workbench, /idempotencyKey: `listing:\$\{requestedProductId\}:\$\{channel\}:\$\{await fingerprint\(mutationContract\)\}`/);
  assert.match(workbench, /mutationId: await remoteEditMutationId\(mutationContract\)/);
  assert.match(workbench, /if \(!options\.deferRefresh && isCurrentProduct\(\)\) \{[\s\S]*await load\(\);[\s\S]*onChanged\?\.\(\);/);
  assert.match(workbench, /createBoundedRequestSignal\([\s\S]*writeController\.signal[\s\S]*65_000/);
  assert.match(channelOperationsRoute, /sellerpilot_service_fail_pre_gateway_channel_operation/);
  assert.match(channelOperationsRoute, /if \(!preGatewayRetryable\) \{[\s\S]*sellerpilot_service_complete_channel_operation/);
  assert.match(preGatewayRetryMigration, /create or replace function public\.sellerpilot_301000_claim_channel_operation_pre_remote_state/);
  assert.doesNotMatch(preGatewayRetryMigration, /create or replace function public\.sellerpilot_claim_channel_operation\(/);
});
