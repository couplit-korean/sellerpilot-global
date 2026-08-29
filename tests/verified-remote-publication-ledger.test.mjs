import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830100000_verified_remote_publication_ledger.sql",
  import.meta.url,
);

const LISTING_ID = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const OWNER_ID = "30000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "40000000-0000-4000-8000-000000000001";
const GATEWAY_JOB_ID = "50000000-0000-4000-8000-000000000001";
const ENQUEUE_CREDENTIAL_ID = "60000000-0000-4000-8000-000000000001";
const UPDATE_ATTEMPT_ID = "70000000-0000-4000-8000-000000000001";
const STOP_ATTEMPT_ID = "70000000-0000-4000-8000-000000000002";
const REQUEST_FINGERPRINT = "a".repeat(64);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end > start, `${signature} must have a complete body`);
  return source.slice(start, end + "\n$$;".length);
}

async function snapshot(db) {
  const result = await db.query(
    `select status,
            requested_publication_intent,
            remote_visibility,
            provider_status,
            remote_resources,
            remote_created_at::text,
            published_at::text,
            last_verified_at::text,
            last_error,
            failure_class
       from sellerpilot_private.product_listings
      where id = $1`,
    [LISTING_ID],
  );
  return result.rows[0];
}

function remoteState(visibility, overrides = {}) {
  const publicationIntent = visibility === "live" || visibility === "pending_review"
    ? "live"
    : "safe_test";
  const publicationFulfilled = visibility === "live"
    || visibility === "non_public"
    || visibility === "withdrawn";
  return {
    ok: true,
    channel: "coupang",
    operation: "listing.create",
    remoteId: "remote-1",
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent,
    publicationFulfilled,
    remoteState: {
      verified: true,
      visibility,
      providerStatus: visibility === "live" ? "ACTIVE" : "UNLISTED",
      verifiedAt: "2026-08-29T20:00:00.000Z",
      createdAt: "2026-08-29T19:59:00.000Z",
      evidence: {
        verification: "exact_provider_readback",
        remoteId: "remote-1",
        identityVerified: true,
        statusVerified: true,
        localeVerified: true,
        fingerprintVerified: true,
        imageCountVerified: true,
      },
      resources: { listingId: "remote-1" },
      locale: "ko-KR",
      fingerprint: REQUEST_FINGERPRINT,
      imageCount: 8,
      ...overrides,
    },
  };
}

async function setup({ installCompletionWrapper = false } = {}) {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  await db.exec(`
    create schema sellerpilot_private;
    create table sellerpilot_private.products (
      id uuid primary key,
      status text not null,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      operation_attempt_id uuid,
      channel_key text not null default 'coupang',
      remote_id text,
      public_url text,
      requested_publication_intent text not null default 'safe_test',
      status text not null,
      remote_visibility text not null default 'unknown',
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      remote_created_at timestamptz,
      published_at timestamptz,
      last_verified_at timestamptz,
      last_error text,
      failure_class text,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      status text not null,
      request_payload jsonb not null,
      response_payload jsonb,
      request_fingerprint text,
      created_at timestamptz not null,
      started_at timestamptz,
      provider_mutation_started_at timestamptz,
      claim_token uuid,
      error_message text,
      completed_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      status text not null,
      http_status integer,
      safe_message text,
      completed_at timestamptz
    );
    create table sellerpilot_private.operation_audit (
      owner_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text,
      safe_detail jsonb not null
    );
  `);
  await db.exec(extractFunction(
    migration,
    "create or replace function sellerpilot_private.jsonb_contains_exact_scalar",
  ));
  await db.exec(extractFunction(
    migration,
    "create or replace function sellerpilot_private.apply_verified_remote_listing_completion",
  ));
  if (installCompletionWrapper) {
    await db.exec(`
      create function public.sellerpilot_11820_complete_gateway_unsafe(
        p_token_hash text,
        p_job_id uuid,
        p_claim_token uuid,
        p_status text,
        p_response_payload jsonb default null,
        p_error_message text default null
      ) returns boolean
      language plpgsql
      set search_path = ''
      as $$
      declare
        v_attempt_id uuid;
        v_listing_id uuid;
        v_result_ok boolean := false;
      begin
        if jsonb_typeof(p_response_payload) = 'object'
           and jsonb_typeof(p_response_payload->'ok') = 'boolean' then
          v_result_ok := coalesce((p_response_payload->>'ok')::boolean, false);
        end if;
        update sellerpilot_private.channel_gateway_jobs job
           set status = p_status,
               response_payload = case
                 when p_status in ('succeeded', 'reconciliation_required')
                   then p_response_payload
                 else null
               end,
               error_message = p_error_message,
               completed_at = clock_timestamp(),
               updated_at = clock_timestamp()
         where job.id = p_job_id
           and job.status = 'running'
           and job.claim_token = p_claim_token
        returning job.attempt_id, job.listing_id
             into v_attempt_id, v_listing_id;
        if not found then return false; end if;

        update sellerpilot_private.channel_operation_attempts attempt
           set status = case
                 when p_status = 'reconciliation_required'
                   then 'manual_required'
                 when p_status = 'succeeded' and v_result_ok
                   then 'succeeded'
                 else 'failed'
               end,
               http_status = case
                 when p_status = 'reconciliation_required' then 409
                 when p_status = 'succeeded' and v_result_ok then 200
                 else 422
               end,
               safe_message = coalesce(
                 nullif(p_response_payload->>'safeMessage', ''),
                 p_error_message
               ),
               completed_at = clock_timestamp()
         where attempt.id = v_attempt_id;

        if p_status = 'succeeded' and v_result_ok and v_listing_id is not null then
          update sellerpilot_private.product_listings listing
             set status = 'published',
                 remote_id = coalesce(
                   nullif(trim(p_response_payload->>'remoteId'), ''),
                   listing.remote_id
                 ),
                 public_url = coalesce(
                   nullif(trim(p_response_payload->>'publicUrl'), ''),
                   listing.public_url
                 ),
                 published_at = coalesce(listing.published_at, clock_timestamp()),
                 last_verified_at = clock_timestamp(),
                 updated_at = clock_timestamp()
           where listing.id = v_listing_id;
          update sellerpilot_private.products product
             set status = 'active', updated_at = clock_timestamp()
           where product.id = (
             select listing.product_id
               from sellerpilot_private.product_listings listing
              where listing.id = v_listing_id
           );
        end if;
        return true;
      end;
      $$;
    `);
    await db.exec(extractFunction(
      migration,
      "create or replace function public.sellerpilot_complete_channel_gateway_job",
    ));
  }
  await db.query(
    "insert into sellerpilot_private.products(id,status) values ($1,'draft')",
    [PRODUCT_ID],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id,owner_id,product_id,operation_attempt_id,channel_key,status
     ) values ($1,$2,$3,$4,'coupang','queued')`,
    [LISTING_ID, OWNER_ID, PRODUCT_ID, ATTEMPT_ID],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(id,status)
     values ($1,'running')`,
    [ATTEMPT_ID],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,attempt_id,listing_id,channel,operation,status,request_payload,
       response_payload,request_fingerprint,created_at,started_at,
       provider_mutation_started_at,claim_token
     ) values (
       $1,$2,$3,'coupang','listing.create','running','{}'::jsonb,
       null,$4,'2026-08-29T19:58:00Z','2026-08-29T19:59:00Z',
       '2026-08-29T19:59:30Z',$5
     )`,
    [GATEWAY_JOB_ID, ATTEMPT_ID, LISTING_ID, REQUEST_FINGERPRINT, ATTEMPT_ID],
  );
  return { db, migration };
}

async function priorListing(db) {
  const result = await db.query(
    "select to_jsonb(listing) as value from sellerpilot_private.product_listings listing where id=$1",
    [LISTING_ID],
  );
  return result.rows[0].value;
}

async function applyCompletion(db, {
  operation = "listing.create",
  terminalStatus = "succeeded",
  response,
  error = null,
  prior,
  priorProductStatus = "draft",
  expectedImageCount,
  requestOverrides = {},
}) {
  const listingIntent = await db.query(
    "select requested_publication_intent from sellerpilot_private.product_listings where id=$1",
    [LISTING_ID],
  ).then((result) => result.rows[0].requested_publication_intent);
  const persistedResponse = response === null ? null : {
    ...response,
    channel: "coupang",
    operation,
    ...(operation === "listing.stop" ? {} : { publicationIntent: listingIntent }),
  };
  if (persistedResponse && operation === "listing.stop") {
    delete persistedResponse.publicationIntent;
  }
  const requestArguments = {
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedFingerprint: REQUEST_FINGERPRINT,
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: expectedImageCount
      ?? (operation === "listing.create" || operation === "listing.update" ? 8 : 0),
    ...(operation === "listing.stop" ? {} : { publicationIntent: listingIntent }),
    ...requestOverrides,
  };
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set operation=$2, status=$3, request_payload=$4::jsonb,
            response_payload=$5::jsonb
      where id=$1`,
    [
      GATEWAY_JOB_ID,
      operation,
      terminalStatus,
      JSON.stringify({ arguments: requestArguments }),
      persistedResponse === null ? null : JSON.stringify(persistedResponse),
    ],
  );
  const result = await db.query(
    `select sellerpilot_private.apply_verified_remote_listing_completion(
       $1,$2,$3,$4,$5,$6::jsonb,$7
     ) as action`,
    [
      GATEWAY_JOB_ID,
      LISTING_ID,
      operation,
      terminalStatus,
      error,
      JSON.stringify(prior),
      priorProductStatus,
    ],
  );
  return result.rows[0].action;
}

async function completeThroughVerifiedWrapper(db, response) {
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set request_payload=$2::jsonb
      where id=$1`,
    [
      GATEWAY_JOB_ID,
      JSON.stringify({
        arguments: {
          publicationIntent: "safe_test",
          publicationStateContract: "verified_remote_state_v1",
          publicationExpectedFingerprint: REQUEST_FINGERPRINT,
          publicationExpectedLocale: "ko-KR",
          publicationExpectedImageCount: 8,
        },
      }),
    ],
  );
  return db.query(
    `select public.sellerpilot_complete_channel_gateway_job(
       $1,$2,$3,'succeeded',$4::jsonb,null
     ) as completed`,
    ["b".repeat(64), GATEWAY_JOB_ID, ATTEMPT_ID, JSON.stringify(response)],
  ).then((result) => result.rows[0].completed);
}

async function completionSnapshot(db) {
  const job = await db.query(
    `select status,error_message from sellerpilot_private.channel_gateway_jobs
      where id=$1`,
    [GATEWAY_JOB_ID],
  ).then((result) => result.rows[0]);
  const attempt = await db.query(
    `select status,http_status,safe_message
       from sellerpilot_private.channel_operation_attempts where id=$1`,
    [ATTEMPT_ID],
  ).then((result) => result.rows[0]);
  return { job, attempt, listing: await snapshot(db) };
}

async function setupVerifiedEnqueueContract() {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  await db.exec(`
    create schema sellerpilot_private;
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      channel_key text not null,
      requested_publication_intent text not null,
      operation_attempt_id uuid,
      remote_visibility text not null default 'unknown',
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      remote_created_at timestamptz,
      published_at timestamptz,
      last_verified_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      request_fingerprint text not null
    );
    create table sellerpilot_private.enqueue_contract_calls (
      id bigint generated always as identity primary key,
      kind text not null,
      operation text not null,
      request_payload jsonb not null,
      request_fingerprint text
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      status text not null default 'queued',
      request_payload jsonb not null,
      request_fingerprint text,
      write_resource_kind text,
      write_resource_key text,
      inventory_item_id uuid,
      order_id uuid,
      shipment_carrier text,
      shipment_tracking text,
      updated_at timestamptz not null default clock_timestamp(),
      constraint channel_gateway_jobs_write_resource_check check (
        (
          write_resource_kind is null
          and write_resource_key is null
          and request_fingerprint is null
          and inventory_item_id is null
          and order_id is null
          and shipment_carrier is null
          and shipment_tracking is null
        ) or (
          listing_id is not null
          and operation in ('listing.create', 'listing.update', 'listing.stop')
          and write_resource_kind is null
          and write_resource_key is null
          and request_fingerprint ~ '^[a-f0-9]{64}$'
          and inventory_item_id is null
          and order_id is null
          and shipment_carrier is null
          and shipment_tracking is null
        )
      )
    );
    create function public.sellerpilot_301000_reserve_listing_pre_intent(
      p_product_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_market text,
      p_target_id text,
      p_currency text,
      p_price numeric,
      p_request_fingerprint text,
      p_request_payload jsonb
    ) returns jsonb language plpgsql set search_path = '' as $$
    declare
      v_job_id uuid := gen_random_uuid();
    begin
      insert into sellerpilot_private.enqueue_contract_calls(
        kind, operation, request_payload, request_fingerprint
      ) values (
        'create', 'listing.create', p_request_payload, p_request_fingerprint
      );
      insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,channel,operation,request_payload,
        request_fingerprint
      ) values (
        v_job_id,p_attempt_id,'${LISTING_ID}',p_channel,'listing.create',
        p_request_payload,p_request_fingerprint
      );
      return jsonb_build_object(
        'status', 'queued',
        'reused', true,
        'job_id', v_job_id,
        'listing_id', '${LISTING_ID}'
      );
    end;
    $$;
    create function public.sellerpilot_301000_enqueue_listing_pre_intent(
      p_listing_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_operation text,
      p_request_payload jsonb
    ) returns jsonb language plpgsql set search_path = '' as $$
    declare
      v_job_id uuid := gen_random_uuid();
    begin
      insert into sellerpilot_private.enqueue_contract_calls(
        kind, operation, request_payload, request_fingerprint
      ) values (
        'existing', p_operation, p_request_payload,
        p_request_payload#>>'{arguments,publicationExpectedFingerprint}'
      );
      select job.id
        into v_job_id
        from sellerpilot_private.channel_gateway_jobs job
       where job.attempt_id = p_attempt_id
         and job.operation = p_operation
         and job.status in ('queued', 'running')
       limit 1;
      if not found then
        v_job_id := gen_random_uuid();
        insert into sellerpilot_private.channel_gateway_jobs(
          id,attempt_id,listing_id,channel,operation,request_payload,
          request_fingerprint
        ) values (
          v_job_id,p_attempt_id,p_listing_id,p_channel,p_operation,
          p_request_payload,null
        );
      end if;
      return jsonb_build_object('status', 'queued', 'job_id', v_job_id);
    end;
    $$;
  `);
  await db.exec(extractFunction(
    migration,
    "create function sellerpilot_private.assert_verified_listing_enqueue_contract",
  ));
  await db.exec(extractFunction(
    migration,
    "create function public.sellerpilot_service_reserve_and_enqueue_listing_create",
  ));
  await db.exec(extractFunction(
    migration,
    "create function public.sellerpilot_service_enqueue_listing_gateway_job",
  ));
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id,channel_key,requested_publication_intent
     ) values ($1,'coupang','safe_test')`,
    [LISTING_ID],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id,credential_id,channel,operation,status,request_fingerprint
     ) values
       ($1,$3,'coupang','listing.update','running',$4),
       ($2,$3,'coupang','listing.stop','running',$5)`,
    [
      UPDATE_ATTEMPT_ID,
      STOP_ATTEMPT_ID,
      ENQUEUE_CREDENTIAL_ID,
      "4".repeat(64),
      "5".repeat(64),
    ],
  );
  return db;
}

function verifiedEnqueuePayload({
  operation,
  fingerprint,
  intent = "safe_test",
  imageCount = operation === "listing.stop" ? 0 : 8,
  locale = "ko-KR",
}) {
  return {
    arguments: {
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: locale,
      publicationExpectedFingerprint: fingerprint,
      publicationExpectedImageCount: imageCount,
      ...(operation === "listing.stop" ? {} : { publicationIntent: intent }),
    },
  };
}

test("migration defines private bounded remote-state columns and service-only completion boundaries", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /requested_publication_intent text not null default 'safe_test'/);
  assert.match(migration, /remote_visibility in \([\s\S]*'non_public'[\s\S]*'pending_review'[\s\S]*'live'[\s\S]*'withdrawn'[\s\S]*'rejected'/);
  assert.match(migration, /jsonb_typeof\(remote_resources\) = 'object'[\s\S]*octet_length\(remote_resources::text\) <= 65536/);
  assert.match(migration, /jsonb_typeof\(v_state->'verified'\) = 'boolean'/);
  assert.match(migration, /v_evidence->'identityVerified'/);
  assert.match(migration, /publication_verification_boundary/);
  assert.match(migration, /v_job_boundary_at := v_job\.provider_mutation_started_at/);
  assert.match(migration, /v_verified_at >= v_job_boundary_at/);
  assert.match(migration, /jsonb_contains_exact_scalar\(\s*v_resources,\s*v_response_remote_id/);
  assert.match(migration, /v_expected_locale = v_locale/);
  assert.match(migration, /v_job\.request_fingerprint = v_fingerprint/);
  assert.match(migration, /v_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(migration, /v_image_count between 0 and 64/);
  assert.match(migration, /assert_verified_listing_enqueue_contract/);
  assert.match(migration, /v_expected_image_count_text <> '8'/);
  assert.match(migration, /p_operation = 'listing\.stop'[\s\S]*v_expected_image_count_text <> '0'/);
  assert.match(migration, /set request_fingerprint = v_request_fingerprint/);
  assert.match(migration, /channel_gateway_jobs_write_resource_check[\s\S]*\) not valid;/);
  assert.match(migration, /to service_role;/);
  assert.match(migration, /sellerpilot_get_product_publish_context[\s\S]*to authenticated;/);
  assert.match(migration, /legacy_publication_result/);
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,180}apply_verified_remote_listing_completion/);
});

test("legacy failed rows with remote evidence become manual readback fences", async (t) => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema sellerpilot_private;
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      status text not null,
      remote_id text,
      requested_publication_intent text not null default 'safe_test',
      remote_visibility text not null default 'unknown',
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      remote_created_at timestamptz,
      published_at timestamptz,
      last_verified_at timestamptz,
      failure_class text,
      last_error text,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.operation_audit (
      owner_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text,
      safe_detail jsonb not null
    );
    insert into sellerpilot_private.product_listings (
      id, owner_id, status, remote_id, requested_publication_intent,
      remote_visibility, provider_status, remote_resources,
      remote_created_at, published_at, last_verified_at,
      failure_class, last_error, updated_at
    ) values
      ('81000000-0000-4000-8000-000000000001', '${OWNER_ID}', 'failed',
       'legacy-remote-1', 'safe_test', 'unknown', null, '{}'::jsonb,
       null, '2026-08-28T12:00:00Z', '2026-08-29T12:00:00Z',
       'retryable', 'old retry', '2026-08-29T13:00:00Z'),
      ('81000000-0000-4000-8000-000000000002', '${OWNER_ID}', 'failed',
       'legacy-remote-2', 'safe_test', 'unknown', null, '{}'::jsonb,
       null, null, '2026-08-29T12:00:00Z',
       'retryable', 'old retry', '2026-08-29T13:00:00Z');
  `);

  const historical = migration.indexOf("-- Historical `published`");
  assert.ok(historical >= 0);
  const start = migration.indexOf(
    "insert into sellerpilot_private.operation_audit (",
    historical,
  );
  const end = migration.indexOf(
    "select pg_catalog.set_config(\n  'sellerpilot.remote_publication_backfill',\n  '',",
    start,
  );
  assert.ok(start >= 0 && end > start);
  await db.exec(migration.slice(start, end));

  const rows = await db.query(`
    select id::text, status, remote_id, requested_publication_intent,
           remote_visibility, published_at::text, last_verified_at::text,
           failure_class, last_error, updated_at::text
      from sellerpilot_private.product_listings
     order by id
  `).then((result) => result.rows);
  assert.deepEqual(rows.map((row) => ({
    id: row.id,
    status: row.status,
    remote_id: row.remote_id,
    requested_publication_intent: row.requested_publication_intent,
    remote_visibility: row.remote_visibility,
    published_at: row.published_at,
    last_verified_at: row.last_verified_at,
    failure_class: row.failure_class,
  })), [
    {
      id: "81000000-0000-4000-8000-000000000001",
      status: "failed",
      remote_id: "legacy-remote-1",
      requested_publication_intent: "live",
      remote_visibility: "unknown",
      published_at: null,
      last_verified_at: null,
      failure_class: "external_action",
    },
    {
      id: "81000000-0000-4000-8000-000000000002",
      status: "failed",
      remote_id: "legacy-remote-2",
      requested_publication_intent: "live",
      remote_visibility: "unknown",
      published_at: null,
      last_verified_at: null,
      failure_class: "external_action",
    },
  ]);
  assert.ok(rows.every((row) => row.last_error.includes("판매자센터 재조회")));
  assert.ok(rows.every((row) => Date.parse(row.updated_at) > Date.parse("2026-08-29T13:00:00Z")));
  const audits = await db.query(`
    select action, safe_detail
      from sellerpilot_private.operation_audit
     order by entity_id
  `).then((result) => result.rows);
  assert.equal(audits.length, 2);
  assert.ok(audits.every((row) => row.action === "listing_legacy_publication_downgraded"));
  assert.equal(audits[0].safe_detail.prior_status, "failed");
  assert.equal(audits[0].safe_detail.had_remote_identity, true);
});

test("final service-role enqueue wrappers reject contract bypasses before delegating", async (t) => {
  const db = await setupVerifiedEnqueueContract();
  t.after(() => db.close());
  const createFingerprint = "3".repeat(64);
  const validCreate = verifiedEnqueuePayload({
    operation: "listing.create",
    fingerprint: createFingerprint,
  });
  const createSql = `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
    $1,$2,$3,'coupang','','','KRW',1000,$4,$5::jsonb
  )`;

  assert.equal((await db.query(createSql, [
    PRODUCT_ID,
    ENQUEUE_CREDENTIAL_ID,
    ATTEMPT_ID,
    createFingerprint,
    JSON.stringify(validCreate),
  ])).rows[0].sellerpilot_service_reserve_and_enqueue_listing_create.status, "queued");

  const invalidCreates = [
    { arguments: { ...validCreate.arguments, publicationStateContract: undefined } },
    verifiedEnqueuePayload({ operation: "listing.create", fingerprint: "9".repeat(64) }),
    verifiedEnqueuePayload({ operation: "listing.create", fingerprint: createFingerprint, imageCount: 0 }),
    { arguments: { ...validCreate.arguments, publicationIntent: undefined } },
    verifiedEnqueuePayload({ operation: "listing.create", fingerprint: createFingerprint, locale: "ko_KR" }),
  ];
  for (const payload of invalidCreates) {
    await assert.rejects(
      db.query(createSql, [
        PRODUCT_ID,
        ENQUEUE_CREDENTIAL_ID,
        ATTEMPT_ID,
        createFingerprint,
        JSON.stringify(payload),
      ]),
      /invalid verified listing publication/,
    );
  }

  const existingSql = `select public.sellerpilot_service_enqueue_listing_gateway_job(
    $1,$2,$3,'coupang',$4,$5::jsonb
  )`;
  const updatePayload = verifiedEnqueuePayload({
    operation: "listing.update",
    fingerprint: "4".repeat(64),
  });
  delete updatePayload.arguments.publicationIntent;
  assert.equal((await db.query(existingSql, [
    LISTING_ID,
    ENQUEUE_CREDENTIAL_ID,
    UPDATE_ATTEMPT_ID,
    "listing.update",
    JSON.stringify(updatePayload),
  ])).rows[0].sellerpilot_service_enqueue_listing_gateway_job.status, "queued");
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs set status='running'
      where attempt_id=$1`,
    [UPDATE_ATTEMPT_ID],
  );
  assert.equal((await db.query(existingSql, [
    LISTING_ID,
    ENQUEUE_CREDENTIAL_ID,
    UPDATE_ATTEMPT_ID,
    "listing.update",
    JSON.stringify(updatePayload),
  ])).rows[0].sellerpilot_service_enqueue_listing_gateway_job.status, "queued");

  await assert.rejects(
    db.query(existingSql, [
      LISTING_ID,
      ENQUEUE_CREDENTIAL_ID,
      UPDATE_ATTEMPT_ID,
      "listing.update",
      JSON.stringify(verifiedEnqueuePayload({
        operation: "listing.update",
        fingerprint: "4".repeat(64),
        intent: "live",
      })),
    ]),
    /listing update publication intent mismatch/,
  );
  for (const payload of [
    verifiedEnqueuePayload({ operation: "listing.update", fingerprint: "6".repeat(64) }),
    verifiedEnqueuePayload({ operation: "listing.update", fingerprint: "4".repeat(64), imageCount: 0 }),
  ]) {
    await assert.rejects(
      db.query(existingSql, [
        LISTING_ID,
        ENQUEUE_CREDENTIAL_ID,
        UPDATE_ATTEMPT_ID,
        "listing.update",
        JSON.stringify(payload),
      ]),
      /invalid verified listing publication/,
    );
  }

  const validStop = verifiedEnqueuePayload({
    operation: "listing.stop",
    fingerprint: "5".repeat(64),
  });
  assert.equal((await db.query(existingSql, [
    LISTING_ID,
    ENQUEUE_CREDENTIAL_ID,
    STOP_ATTEMPT_ID,
    "listing.stop",
    JSON.stringify(validStop),
  ])).rows[0].sellerpilot_service_enqueue_listing_gateway_job.status, "queued");
  await assert.rejects(
    db.query(existingSql, [
      LISTING_ID,
      ENQUEUE_CREDENTIAL_ID,
      STOP_ATTEMPT_ID,
      "listing.stop",
      JSON.stringify({
        arguments: { ...validStop.arguments, publicationIntent: "safe_test" },
      }),
    ]),
    /listing stop publication intent is forbidden/,
  );
  await assert.rejects(
    db.query(existingSql, [
      LISTING_ID,
      ENQUEUE_CREDENTIAL_ID,
      STOP_ATTEMPT_ID,
      "listing.stop",
      JSON.stringify(verifiedEnqueuePayload({
        operation: "listing.stop",
        fingerprint: "5".repeat(64),
        imageCount: 8,
      })),
    ]),
    /invalid verified listing publication image count/,
  );

  const calls = await db.query(
    `select kind,operation,request_payload
       from sellerpilot_private.enqueue_contract_calls order by id`,
  ).then((result) => result.rows);
  assert.equal(calls.length, 4, "rejected inputs never reach a legacy enqueue predecessor");
  assert.equal(calls[1].request_payload.arguments.publicationIntent, "safe_test");
  assert.equal(calls[2].request_payload.arguments.publicationIntent, "safe_test");
  assert.equal(
    Object.hasOwn(calls[3].request_payload.arguments, "publicationIntent"),
    false,
  );
  assert.deepEqual(
    await db.query(
      `select operation,request_fingerprint
         from sellerpilot_private.channel_gateway_jobs order by operation`,
    ).then((result) => result.rows),
    [
      { operation: "listing.create", request_fingerprint: "3".repeat(64) },
      { operation: "listing.stop", request_fingerprint: "5".repeat(64) },
      { operation: "listing.update", request_fingerprint: "4".repeat(64) },
    ],
  );
});

test("completion wrapper rejects readback captured after claim but before provider mutation", async (t) => {
  const { db } = await setup({ installCompletionWrapper: true });
  t.after(() => db.close());

  const completed = await completeThroughVerifiedWrapper(
    db,
    remoteState("non_public", { verifiedAt: "2026-08-29T19:59:29.999Z" }),
  );
  assert.equal(completed, true);

  const state = await completionSnapshot(db);
  assert.equal(state.job.status, "reconciliation_required");
  assert.match(state.job.error_message, /검증된 게시 상태/);
  assert.equal(state.attempt.status, "manual_required");
  assert.equal(state.attempt.http_status, 409);
  assert.match(state.attempt.safe_message, /검증된 게시 상태/);
  assert.equal(state.listing.status, "failed");
  assert.equal(state.listing.remote_visibility, "unknown");
  assert.equal(state.listing.failure_class, "external_action");
});

test("completion wrapper accepts readback exactly on the provider-mutation boundary", async (t) => {
  const { db } = await setup({ installCompletionWrapper: true });
  t.after(() => db.close());

  const completed = await completeThroughVerifiedWrapper(
    db,
    remoteState("non_public", { verifiedAt: "2026-08-29T19:59:30.000Z" }),
  );
  assert.equal(completed, true);

  const state = await completionSnapshot(db);
  assert.equal(state.job.status, "succeeded");
  assert.equal(state.job.error_message, null);
  assert.equal(state.attempt.status, "succeeded");
  assert.equal(state.attempt.http_status, 200);
  assert.equal(state.listing.status, "paused");
  assert.equal(state.listing.remote_visibility, "non_public");
  assert.equal(state.listing.failure_class, null);
});

test("duplicate listing success replays exact verified state and never labels a missing listing legacy", async (t) => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema sellerpilot_private;
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      operation_attempt_id uuid,
      channel_key text not null,
      requested_publication_intent text not null,
      remote_visibility text not null,
      provider_status text,
      remote_resources jsonb not null,
      remote_created_at timestamptz,
      last_verified_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      status text not null,
      request_payload jsonb not null,
      response_payload jsonb,
      created_at timestamptz not null default clock_timestamp()
    );
    create function public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
      uuid, text, text, text, text
    ) returns jsonb language sql as $$
      select jsonb_build_object(
        'attempt_id', '${ATTEMPT_ID}',
        'status', 'succeeded',
        'duplicate', true,
        'remote_id', 'remote-1',
        'safe_message', 'done'
      )
    $$;
  `);
  await db.exec(extractFunction(
    migration,
    "create function public.sellerpilot_claim_channel_operation",
  ));
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id, operation_attempt_id, channel_key, requested_publication_intent,
       remote_visibility, provider_status, remote_resources, last_verified_at
     ) values ($1,$2,'coupang','safe_test','non_public','TEMP_SAVED',$3::jsonb,$4)`,
    [
      LISTING_ID,
      ATTEMPT_ID,
      JSON.stringify({
        resources: { listingId: "remote-1" },
        verification: {
          verifiedAt: "2026-08-29T20:00:00.000Z",
          evidence: { verification: "exact_provider_readback" },
          locale: "ko-KR",
          fingerprint: "a".repeat(64),
          imageCount: 8,
        },
      }),
      "2026-08-29T20:00:00.000Z",
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       attempt_id, listing_id, channel, operation, status,
       request_payload, response_payload
     ) values (
       $1,$2,'coupang','listing.create','succeeded',$3::jsonb,$4::jsonb
     )`,
    [
      ATTEMPT_ID,
      LISTING_ID,
      JSON.stringify({
        arguments: {
          publicationIntent: "safe_test",
          publicationStateContract: "verified_remote_state_v1",
        },
      }),
      JSON.stringify(remoteState("non_public")),
    ],
  );

  const verified = await db.query(
    `select public.sellerpilot_claim_channel_operation(
       gen_random_uuid(),'coupang','listing.create','duplicate-key-0001',$1
     ) as value`,
    ["a".repeat(64)],
  ).then((result) => result.rows[0].value);
  assert.equal(verified.publication_intent, "safe_test");
  assert.equal(verified.legacy_publication_result, false);
  assert.equal(verified.listing_id, LISTING_ID);
  assert.equal(verified.remote_state.verified, true);
  assert.equal(verified.remote_state.visibility, "non_public");
  assert.equal(verified.remote_state.providerStatus, "UNLISTED");
  assert.equal(verified.remote_state.createdAt, "2026-08-29T19:59:00.000Z");
  assert.equal(verified.remote_state.imageCount, 8);

  await db.query(
    `update sellerpilot_private.product_listings
        set operation_attempt_id=gen_random_uuid(), provider_status='MUTATED'
      where id=$1`,
    [LISTING_ID],
  );
  const immutableReplay = await db.query(
    `select public.sellerpilot_claim_channel_operation(
       gen_random_uuid(),'coupang','listing.create','duplicate-key-0001',$1
     ) as value`,
    ["a".repeat(64)],
  ).then((result) => result.rows[0].value);
  assert.equal(immutableReplay.remote_state.providerStatus, "UNLISTED");
  assert.equal(immutableReplay.remote_state.visibility, "non_public");

  await db.query("delete from sellerpilot_private.product_listings where id=$1", [LISTING_ID]);
  const missing = await db.query(
    `select public.sellerpilot_claim_channel_operation(
       gen_random_uuid(),'coupang','listing.create','duplicate-key-0001',$1
     ) as value`,
    ["a".repeat(64)],
  ).then((result) => result.rows[0].value);
  assert.equal(missing.publication_intent, "invalid");
  assert.equal(missing.remote_state, null);
  assert.equal(missing.legacy_publication_result, false);
});

test("verified safe-test readback is paused and never receives published_at", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  const prior = await priorListing(db);
  await db.query(
    `update sellerpilot_private.product_listings
        set status='published', remote_id='remote-1', published_at=clock_timestamp()
      where id=$1`,
    [LISTING_ID],
  );
  await db.query("update sellerpilot_private.products set status='active' where id=$1", [PRODUCT_ID]);

  const action = await applyCompletion(db, {
    response: remoteState("non_public"),
    prior,
  });
  assert.equal(action, "listing_remote_non_public_verified");
  const listing = await snapshot(db);
  assert.equal(listing.status, "paused");
  assert.equal(listing.requested_publication_intent, "safe_test");
  assert.equal(listing.remote_visibility, "non_public");
  assert.equal(listing.provider_status, "UNLISTED");
  assert.equal(listing.published_at, null);
  assert.equal(listing.failure_class, null);
  assert.equal(listing.remote_resources.resources.listingId, "remote-1");
  assert.equal(listing.remote_resources.verification.locale, "ko-KR");
  assert.equal(
    await db.query("select status from sellerpilot_private.products where id=$1", [PRODUCT_ID]).then((result) => result.rows[0].status),
    "draft",
  );
});

test("only matching live intent plus verified live readback activates a product", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  await db.query(
    "update sellerpilot_private.product_listings set requested_publication_intent='live' where id=$1",
    [LISTING_ID],
  );
  const prior = await priorListing(db);
  await db.query(
    `update sellerpilot_private.product_listings
        set status='published', remote_id='remote-1', published_at=clock_timestamp()
      where id=$1`,
    [LISTING_ID],
  );
  const response = remoteState("live");
  response.publicationIntent = "live";

  const action = await applyCompletion(db, { response, prior });
  assert.equal(action, "listing_remote_live_verified");
  const listing = await snapshot(db);
  assert.equal(listing.status, "published");
  assert.equal(listing.remote_visibility, "live");
  assert.ok(listing.published_at);
  assert.ok(listing.last_verified_at);
  assert.equal(
    await db.query("select status from sellerpilot_private.products where id=$1", [PRODUCT_ID]).then((result) => result.rows[0].status),
    "active",
  );
});

test("safe-test exposure is fenced even when exact readback proves it is live", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  const prior = await priorListing(db);
  await db.query(
    `update sellerpilot_private.product_listings
        set status='published', remote_id='remote-1', published_at=clock_timestamp()
      where id=$1`,
    [LISTING_ID],
  );

  const response = remoteState("live");
  response.ok = false;
  response.publicationFulfilled = false;
  const action = await applyCompletion(db, {
    terminalStatus: "reconciliation_required",
    response,
    error: "safe-test item is unexpectedly live",
    prior,
  });
  assert.equal(action, "listing_safe_test_exposure_detected");
  const listing = await snapshot(db);
  assert.equal(listing.status, "failed");
  assert.equal(listing.remote_visibility, "live");
  assert.equal(listing.published_at, null);
  assert.equal(listing.failure_class, "external_action");
});

test("missing normalized evidence becomes manual reconciliation, not publication", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  const prior = await priorListing(db);
  await db.query(
    `update sellerpilot_private.product_listings
        set status='published', remote_id='remote-1', published_at=clock_timestamp()
      where id=$1`,
    [LISTING_ID],
  );
  const response = remoteState("non_public", { evidence: {} });

  const action = await applyCompletion(db, { response, prior });
  assert.equal(action, "listing_remote_state_unverified");
  const listing = await snapshot(db);
  assert.equal(listing.status, "failed");
  assert.equal(listing.remote_visibility, "unknown");
  assert.equal(listing.published_at, null);
  assert.equal(listing.failure_class, "external_action");
});

test("uncertain provider write always clears publication proof and requires reconciliation", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  const prior = await priorListing(db);
  await db.query(
    `update sellerpilot_private.product_listings
        set status='failed', remote_id='remote-1', published_at=clock_timestamp()
      where id=$1`,
    [LISTING_ID],
  );
  await db.query("update sellerpilot_private.products set status='active' where id=$1", [PRODUCT_ID]);

  const action = await applyCompletion(db, {
    terminalStatus: "reconciliation_required",
    response: remoteState("non_public"),
    error: "provider outcome unknown",
    prior,
    priorProductStatus: "active",
  });
  assert.equal(action, "listing_remote_state_reconciliation_required");
  const listing = await snapshot(db);
  assert.equal(listing.status, "failed");
  assert.equal(listing.remote_visibility, "unknown");
  assert.equal(listing.published_at, null);
  assert.equal(listing.failure_class, "external_action");
  assert.equal(
    await db.query("select status from sellerpilot_private.products where id=$1", [PRODUCT_ID]).then((result) => result.rows[0].status),
    "draft",
  );
});

test("definite update rejection preserves an already verified live listing", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  await db.query(
    `update sellerpilot_private.product_listings
        set requested_publication_intent='live', status='published',
            remote_id='remote-1', remote_visibility='live',
            provider_status='ACTIVE', published_at='2026-08-29T03:00:00Z',
            last_verified_at='2026-08-29T03:05:00Z'
      where id=$1`,
    [LISTING_ID],
  );
  await db.query("update sellerpilot_private.products set status='active' where id=$1", [PRODUCT_ID]);
  const prior = await priorListing(db);
  await db.query(
    "update sellerpilot_private.product_listings set status='failed', last_error='provider rejected' where id=$1",
    [LISTING_ID],
  );

  const action = await applyCompletion(db, {
    operation: "listing.update",
    terminalStatus: "failed",
    response: null,
    error: "provider rejected before write",
    prior,
    priorProductStatus: "active",
  });
  assert.equal(action, "listing_remote_state_preserved_after_rejection");
  const listing = await snapshot(db);
  assert.equal(listing.status, "failed");
  assert.equal(listing.remote_visibility, "live");
  assert.equal(listing.published_at, "2026-08-29 03:00:00+00");
  assert.equal(listing.failure_class, "retryable");
  assert.equal(
    await db.query("select status from sellerpilot_private.products where id=$1", [PRODUCT_ID]).then((result) => result.rows[0].status),
    "active",
  );
  assert.equal(
    await db.query(
      `select count(*)::integer as value
         from sellerpilot_private.product_listings
        where product_id=$1
          and requested_publication_intent='live'
          and remote_visibility='live'
          and published_at is not null`,
      [PRODUCT_ID],
    ).then((result) => result.rows[0].value),
    1,
  );
});

test("live intent pending review stays paused, inactive, and absent from publishedCount", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  await db.query(
    "update sellerpilot_private.product_listings set requested_publication_intent='live' where id=$1",
    [LISTING_ID],
  );
  const prior = await priorListing(db);
  await db.query(
    `update sellerpilot_private.product_listings
        set status='published', remote_id='remote-1', published_at=clock_timestamp()
      where id=$1`,
    [LISTING_ID],
  );
  await db.query("update sellerpilot_private.products set status='active' where id=$1", [PRODUCT_ID]);

  const response = remoteState("pending_review", { providerStatus: "PENDING_REVIEW" });
  const action = await applyCompletion(db, {
    response,
    prior,
    priorProductStatus: "active",
  });
  assert.equal(action, "listing_remote_non_public_verified");
  const listing = await snapshot(db);
  assert.equal(listing.status, "paused");
  assert.equal(listing.remote_visibility, "pending_review");
  assert.equal(listing.published_at, null);
  assert.equal(
    await db.query("select status from sellerpilot_private.products where id=$1", [PRODUCT_ID]).then((result) => result.rows[0].status),
    "draft",
  );
  assert.equal(
    await db.query(
      `select count(*)::integer as value
         from sellerpilot_private.product_listings
        where product_id=$1
          and requested_publication_intent='live'
          and remote_visibility='live'
          and published_at is not null`,
      [PRODUCT_ID],
    ).then((result) => result.rows[0].value),
    0,
  );
});

test("verified stop withdrawal pauses the listing while preserving publication history", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  await db.query(
    `update sellerpilot_private.product_listings
        set requested_publication_intent='live', status='published',
            remote_id='remote-1', remote_visibility='live',
            provider_status='ACTIVE', published_at='2026-08-29T03:00:00Z',
            last_verified_at='2026-08-29T03:05:00Z'
      where id=$1`,
    [LISTING_ID],
  );
  await db.query("update sellerpilot_private.products set status='active' where id=$1", [PRODUCT_ID]);
  const prior = await priorListing(db);
  await db.query("update sellerpilot_private.product_listings set status='paused' where id=$1", [LISTING_ID]);
  const response = remoteState("withdrawn", { providerStatus: "STOPPED" });

  const action = await applyCompletion(db, {
    operation: "listing.stop",
    response,
    prior,
    priorProductStatus: "active",
  });
  assert.equal(action, "listing_remote_non_public_verified");
  const listing = await snapshot(db);
  assert.equal(listing.status, "paused");
  assert.equal(listing.requested_publication_intent, "live");
  assert.equal(listing.remote_visibility, "withdrawn");
  assert.equal(listing.published_at, "2026-08-29 03:00:00+00");
  assert.equal(
    await db.query("select status from sellerpilot_private.products where id=$1", [PRODUCT_ID]).then((result) => result.rows[0].status),
    "draft",
  );
});

test("stop readback that remains live is fenced but keeps verified live truth", async (t) => {
  const { db } = await setup();
  t.after(() => db.close());
  await db.query(
    `update sellerpilot_private.product_listings
        set requested_publication_intent='live', status='published',
            remote_id='remote-1', remote_visibility='live',
            provider_status='ACTIVE', published_at='2026-08-29T03:00:00Z',
            last_verified_at='2026-08-29T03:05:00Z'
      where id=$1`,
    [LISTING_ID],
  );
  await db.query("update sellerpilot_private.products set status='active' where id=$1", [PRODUCT_ID]);
  const prior = await priorListing(db);
  await db.query("update sellerpilot_private.product_listings set status='failed' where id=$1", [LISTING_ID]);
  const response = remoteState("live");
  response.ok = false;
  response.publicationFulfilled = false;

  const action = await applyCompletion(db, {
    operation: "listing.stop",
    terminalStatus: "reconciliation_required",
    response,
    error: "stop readback remains live",
    prior,
    priorProductStatus: "active",
  });
  assert.equal(action, "listing_stop_remote_live_detected");
  const listing = await snapshot(db);
  assert.equal(listing.status, "failed");
  assert.equal(listing.remote_visibility, "live");
  assert.equal(listing.published_at, "2026-08-29 03:00:00+00");
  assert.equal(listing.failure_class, "external_action");
  assert.equal(
    await db.query("select status from sellerpilot_private.products where id=$1", [PRODUCT_ID]).then((result) => result.rows[0].status),
    "active",
  );
});

test("immutable job context rejects forged identity, time, locale, fingerprint, image, or byte evidence", async () => {
  const baseEvidence = remoteState("non_public").remoteState.evidence;
  const cases = [
    ["remote identity", { resources: { listingId: "different" } }],
    ["verification time", { verifiedAt: "2026-08-29T19:58:59.000Z" }],
    ["locale", { locale: "en-US" }],
    ["fingerprint", { fingerprint: "b".repeat(64) }],
    ["image count", { imageCount: 7 }],
    ["image evidence", { evidence: { ...baseEvidence, imageCountVerified: false } }],
    ["provider control", { providerStatus: "ACTIVE\nSALE" }],
    ["locale control", { locale: "ko-\nKR" }],
    ["utf8 evidence bytes", { evidence: { ...baseEvidence, note: "가".repeat(12_000) } }],
  ];

  for (const [label, override] of cases) {
    const { db } = await setup();
    try {
      const prior = await priorListing(db);
      await db.query(
        `update sellerpilot_private.product_listings
            set status='published', remote_id='remote-1', published_at=clock_timestamp()
          where id=$1`,
        [LISTING_ID],
      );
      const action = await applyCompletion(db, {
        response: remoteState("non_public", override),
        prior,
      });
      assert.equal(action, "listing_remote_state_unverified", label);
      const listing = await snapshot(db);
      assert.equal(listing.remote_visibility, "unknown", label);
      assert.equal(listing.published_at, null, label);
      assert.equal(listing.failure_class, "external_action", label);
    } finally {
      await db.close();
    }
  }
});
