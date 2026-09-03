import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationName =
  "20260901160000_reconcile_exact_coupang_unclaimed_static_egress_job.sql";
const migrationUrl = new URL(`../supabase/migrations/${migrationName}`, import.meta.url);
const migration = await readFile(migrationUrl, "utf8");

const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const jobCreatedBy = "21eb1892-0894-4f9f-b414-4c9464182dd6";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const listingId = "7ffc6e46-3173-4695-9889-5fa1529765f1";
const credentialId = "32de2968-d4b7-4fda-a84b-16a7ce0257cc";
const attemptId = "84afed0d-cc13-413d-b839-c35346f9b09f";
const jobId = "f22d0a45-c887-4e3a-b1f8-60f02627e133";
const permitId = "0c07232d-4084-42ce-af09-b6da16235465";
const releaseSha = "71afb2e6e96d6f5eef7bf6f70dea380f5d1c2e9f";
const requestFingerprint =
  "5f4e3bca5d2a82c111fa86b2838de44353fe4d11bedb34435f9912c41f71c4fb";
const productionArgumentsSha =
  "1054c64d400b65fc4214b15407a013c9b9a434fa4ac32374fb8203236954bf7b";
const productionPayloadSha =
  "7872552ce349e9101f94c80b669f6fe66aad596c92934482ad731b6080704a94";
const sellerAccountKey =
  "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const manualMessage =
  "쿠팡 API는 승인된 고정 egress가 없어 실행하지 않았습니다. 판매자 WING에서 기존 상품을 수동 수정하고 판매 상태를 확인해 주세요.";

async function createDatabase({
  insertExactRows = true,
  partiallyActiveRuntime = false,
  runtimeActive = false,
  staticEgress = false,
  policyEnabled = staticEgress,
} = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema extensions;
    create function extensions.digest(input text, algorithm text)
    returns bytea language plpgsql immutable set search_path='' as $$
    begin
      if algorithm is distinct from 'sha256' then
        raise exception 'unsupported digest algorithm';
      end if;
      return sha256(convert_to(input, 'UTF8'));
    end $$;
    create schema sellerpilot_private;
    create schema cron;
    create role anon;
    create role authenticated;
    create role service_role;

    create table sellerpilot_private.products (
      id uuid primary key, owner_id uuid not null, sku text not null,
      on_hand integer not null, demo boolean not null, status text not null
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key, channel text not null, environment text not null,
      status text not null, version integer not null, fingerprint text not null,
      seller_account_key text, seller_account_key_source text,
      seller_account_verified_at timestamptz, last_checked_at timestamptz,
      last_check_status text, expires_at timestamptz, created_by uuid not null
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key, owner_id uuid not null, credential_id uuid not null,
      channel text not null, operation text not null,
      request_fingerprint text not null, status text not null
        check (status in ('running','succeeded','failed','manual_required')),
      http_status integer, remote_id text, safe_message text,
      started_at timestamptz, completed_at timestamptz,
      gateway_write_required boolean not null,
      pre_gateway_retryable boolean not null, seller_account_key text,
      idempotency_key text
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key, owner_id uuid not null, product_id uuid not null,
      channel_key text not null, remote_id text, market text not null,
      target_id text not null, currency text not null, price numeric not null,
      status text not null check (
        status in ('draft','queued','published','failed','paused','scope_excluded')
      ),
      failure_class text check (
        failure_class is null or failure_class in ('retryable','external_action')
      ),
      requested_publication_intent text, remote_visibility text,
      provider_status text, published_at timestamptz,
      operation_attempt_id uuid, last_error text,
      remote_resources jsonb not null, marketplace_sku text,
      provider_resource_id text, public_url text, seller_account_key text,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key, credential_id uuid not null, attempt_id uuid,
      listing_id uuid, channel text not null, operation text not null,
      environment text not null, request_payload jsonb not null,
      response_payload jsonb, status text not null, error_message text,
      worker_token_id uuid, attempt_count integer not null,
      lease_expires_at timestamptz, created_by uuid not null,
      created_at timestamptz not null, started_at timestamptz,
      completed_at timestamptz, updated_at timestamptz not null,
      claim_token uuid, provider_mutation_started_at timestamptz,
      seller_account_key text, request_fingerprint text,
      credential_refresh_in_flight boolean not null default false,
      credential_refresh_started_at timestamptz,
      credential_refresh_prepared_at timestamptz,
      prepared_credential_id uuid,
      credential_refresh_recovery_vault_id uuid,
      oauth_provider_call_started_at timestamptz,
      constraint channel_gateway_jobs_status_check check (
        status in (
          'queued','running','succeeded','failed','cancelled',
          'reconciliation_required'
        )
      ),
      constraint channel_gateway_jobs_attempt_count_check check (
        attempt_count between 0 and 6
      )
    );
    create table sellerpilot_private.exact_existing_update_permits (
      permit_id uuid primary key, channel text not null, listing_id uuid not null,
      product_id uuid not null, credential_id uuid not null, owner_id uuid not null,
      market text not null, target_id text not null, remote_id text not null,
      seller_sku text not null, provider_resource_id text, currency text not null,
      price numeric not null, stock integer not null, seller_account_key text not null,
      credential_version integer not null, credential_fingerprint text not null,
      credential_account_source text not null,
      credential_verified_at timestamptz not null,
      credential_expires_at timestamptz,
      credential_last_checked_at timestamptz,
      credential_last_check_status text, snapshot_revision bigint,
      snapshot_payload_sha256 text, snapshot_source_job_id uuid,
      release_sha text not null, request_fingerprint text not null,
      armed_at timestamptz not null, expires_at timestamptz not null,
      update_job_id uuid, update_attempt_id uuid,
      arguments_sha256 text, arguments_bytes integer,
      request_payload_sha256 text, request_payload_bytes integer,
      bound_at timestamptz, bound_worker_token_id uuid,
      bound_claim_token uuid, consumed_at timestamptz,
      invalidated_at timestamptz, invalidation_reason text,
      constraint exact_existing_update_permit_binding_check check (
        invalidated_at is null and invalidation_reason is null
      )
    );
    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid, action text not null, entity_type text not null,
      entity_id text, safe_detail jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now()
    );
    create table cron.job (
      jobid bigint generated always as identity primary key,
      jobname text not null,
      schedule text not null default '* * * * *',
      command text not null default '',
      database text not null default 'postgres',
      username text not null default 'postgres',
      active boolean not null
    );
    insert into cron.job (jobname,schedule,command,database,username,active) values
      ('sellerpilot-serverless-cs-wake-v1','* * * * *',
       'select sellerpilot_private.schedule_serverless_cs_wakeup();',
       'postgres','postgres',${runtimeActive || partiallyActiveRuntime}),
      ('sellerpilot-product-research-v1','*/5 * * * *',
       'select sellerpilot_private.schedule_internal_route(''product_research'');',
       'postgres','postgres',${runtimeActive}),
      ('sellerpilot-channel-sync-v1','1-59/5 * * * *',
       'select sellerpilot_private.schedule_internal_route(''channel_sync'');',
       'postgres','postgres',${runtimeActive}),
      ('sellerpilot-competitor-prices-v1','3-59/5 * * * *',
       'select sellerpilot_private.schedule_internal_route(''competitor_prices'');',
       'postgres','postgres',${runtimeActive}),
      ('sellerpilot-kakao-notifications-v1','4-59/5 * * * *',
       'select sellerpilot_private.schedule_internal_route(''kakao_notifications'');',
       'postgres','postgres',${runtimeActive}),
      ('sellerpilot-maintenance-v1','17 18 * * *',
       'select sellerpilot_private.schedule_internal_route(''maintenance'');',
       'postgres','postgres',${runtimeActive});
    create table sellerpilot_private.serverless_static_egress_policy (
      channel text primary key,
      enabled boolean not null
    );
    insert into sellerpilot_private.serverless_static_egress_policy
      (channel,enabled) values ('coupang',${policyEnabled});

    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable set search_path='' as $$
      select ${runtimeActive ? `'${releaseSha}'::text` : "null::text"}
    $$;
    create function public.sellerpilot_service_activate_serverless_runtime(uuid,text)
    returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065060);
      return '{}'::jsonb;
    end $$;
    create function sellerpilot_private.serverless_static_egress_allowed(text)
    returns boolean language sql stable set search_path='' as $$
      select ${staticEgress ? "true" : "false"}
    $$;
    create function public.sellerpilot_service_serverless_static_egress_status()
    returns jsonb language sql stable set search_path='' as $$
      select jsonb_build_object(
        'coupang', coalesce((
          select policy.enabled
            from sellerpilot_private.serverless_static_egress_policy policy
           where policy.channel='coupang'
        ), false)
      )
    $$;
    create function public.sellerpilot_service_serverless_cs_wakeup_status()
    returns jsonb language sql stable set search_path='' as $$
      select jsonb_build_object(
        'configured', (select count(*)=6 from cron.job),
        'version', 'serverless_runtime_v2',
        'active', (select count(*) filter (where active)=6 from cron.job),
        'scheduleCount', (select count(*)::integer from cron.job),
        'activeRelease', sellerpilot_private.active_serverless_runtime_release_sha(),
        'unsafePendingMutations', (
          select count(*)::integer
            from sellerpilot_private.channel_gateway_jobs job
           where job.status in ('queued','running')
             and job.operation in (
               'listing.create','listing.update','listing.stop','price.update',
               'inventory.update','shipment.acknowledge','shipment.confirm',
               'inquiries.reply','oauth.exchange'
             )
        ),
        'reconciliationRequiredMutations', (
          select count(*)::integer
            from sellerpilot_private.channel_gateway_jobs job
           where job.status='reconciliation_required'
             and job.operation in (
               'listing.create','listing.update','listing.stop','price.update',
               'inventory.update','shipment.acknowledge','shipment.confirm',
               'inquiries.reply','oauth.exchange'
             )
        )
      )
    $$;
    create function sellerpilot_private.exact_existing_update_arguments_valid(
      text,jsonb,text,text,integer
    ) returns boolean language sql immutable set search_path='' as $$
      select true
    $$;
    create function sellerpilot_private.guard_exact_existing_update_permit_transition()
    returns trigger language plpgsql set search_path='' as $$
    begin return new; end $$;
    create trigger guard_exact_existing_update_permit_transition
      before update or delete
      on sellerpilot_private.exact_existing_update_permits
      for each row execute function
        sellerpilot_private.guard_exact_existing_update_permit_transition();
    create function sellerpilot_private.guard_exact_existing_update_job()
    returns trigger language plpgsql set search_path='' as $$
    begin return new; end $$;
    create constraint trigger guard_exact_existing_update_job
      after insert or update on sellerpilot_private.channel_gateway_jobs
      deferrable initially deferred for each row execute function
        sellerpilot_private.guard_exact_existing_update_job();
  `);

  if (!insertExactRows) return { db, migration };

  const requestPayload = {
    arguments: {
      sellerpilotCoupangExactQaRecovery: "coupang_exact_qa_recovery_v1",
      sellerProductId: "16356981734",
      sellerpilotItemMatchId: "95962393877",
      evidencePadding: "x".repeat(400),
    },
  };
  await db.query(
    `insert into sellerpilot_private.products
       (id,owner_id,sku,on_hand,demo,status)
     values ($1,$2,'QA-20260823-CC-001',1,false,'draft')`,
    [productId, ownerId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,channel,environment,status,version,fingerprint,
       seller_account_key,seller_account_key_source,
       seller_account_verified_at,last_checked_at,last_check_status,expires_at,
       created_by
     ) values (
       $1,'coupang','production','active',1,'F95F4754AFAE',$2,
       'credential_incarnation_v1','2026-08-25 11:40:32.606508+00',
       '2026-08-19 20:23:27.905445+00','passed',null,$3
     )`,
    [credentialId, sellerAccountKey, jobCreatedBy],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,request_fingerprint,status,
       http_status,remote_id,safe_message,started_at,completed_at,
       gateway_write_required,pre_gateway_retryable,seller_account_key,
       idempotency_key
     ) values (
       $1,$2,$3,'coupang','listing.update',$4,'running',null,null,null,
       '2026-09-01 05:10:24.356924+00',null,true,false,$5,
       'product-edit:ddccde35-9c58-4856-b673-d7aa27ce4220:7ffc6e46-3173-4695-9889-5fa1529765f1:e1f7beca-a124-4887-8536-6391f6aa017a'
     )`,
    [attemptId, ownerId, credentialId, requestFingerprint, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,market,target_id,currency,
       price,status,failure_class,requested_publication_intent,remote_visibility,
       provider_status,published_at,operation_attempt_id,last_error,
       remote_resources,marketplace_sku,provider_resource_id,public_url,
       seller_account_key,updated_at
     ) values (
       $1,$2,$3,'coupang','16356981734','KR','KR','KRW',5000,'queued',
       null,'live','unknown',null,null,$4,null,'{}'::jsonb,null,null,
       'https://www.coupang.com/vp/products/8596029479?vendorItemId=95962393877',
       $5,'2026-09-01 05:10:35.344034+00'
     )`,
    [listingId, ownerId, productId, attemptId, sellerAccountKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,status,error_message,worker_token_id,
       attempt_count,lease_expires_at,created_by,created_at,started_at,
       completed_at,updated_at,claim_token,provider_mutation_started_at,
       seller_account_key,request_fingerprint,credential_refresh_in_flight
     ) values (
       $1,$2,$3,$4,'coupang','listing.update','production',$5,null,'queued',
       null,null,0,null,$6,'2026-09-01 05:10:35.344034+00',null,null,
       '2026-09-01 05:10:35.344034+00',null,null,$7,$8,false
     )`,
    [
      jobId, credentialId, attemptId, listingId, requestPayload, jobCreatedBy,
      sellerAccountKey, requestFingerprint,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,channel,operation,environment,request_payload,status,
       attempt_count,created_by,created_at,updated_at
     ) values
       ('10000000-0000-4000-8000-000000000011',$1,'qoo10','listing.update',
        'production','{}'::jsonb,'reconciliation_required',1,$2,
        '2026-09-01 04:00:00+00','2026-09-01 04:00:00+00'),
       ('10000000-0000-4000-8000-000000000012',$1,'lazada','listing.update',
        'production','{}'::jsonb,'reconciliation_required',1,$2,
        '2026-09-01 04:00:00+00','2026-09-01 04:00:00+00'),
       ('10000000-0000-4000-8000-000000000013',$1,'ebay','listing.update',
        'production','{}'::jsonb,'reconciliation_required',1,$2,
        '2026-09-01 04:00:00+00','2026-09-01 04:00:00+00'),
       ('10000000-0000-4000-8000-000000000014',$1,'shopee','listing.update',
        'production','{}'::jsonb,'reconciliation_required',1,$2,
        '2026-09-01 04:00:00+00','2026-09-01 04:00:00+00')`,
    [credentialId, jobCreatedBy],
  );
  const fingerprint = (await db.query(
    `select
       encode(extensions.digest((request_payload->'arguments')::text,'sha256'),'hex') as arguments_sha,
       octet_length((request_payload->'arguments')::text)::integer as arguments_bytes,
       encode(extensions.digest(request_payload::text,'sha256'),'hex') as payload_sha,
       octet_length(request_payload::text)::integer as payload_bytes
     from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [jobId],
  )).rows[0];
  await db.query(
    `insert into sellerpilot_private.exact_existing_update_permits (
       permit_id,channel,listing_id,product_id,credential_id,owner_id,market,
       target_id,remote_id,seller_sku,provider_resource_id,currency,price,stock,
       seller_account_key,credential_version,credential_fingerprint,
       credential_account_source,credential_verified_at,credential_expires_at,
       credential_last_checked_at,credential_last_check_status,
       snapshot_revision,snapshot_payload_sha256,snapshot_source_job_id,
       release_sha,request_fingerprint,armed_at,expires_at,update_job_id,
       update_attempt_id,arguments_sha256,arguments_bytes,
       request_payload_sha256,request_payload_bytes
     ) values (
       $1,'coupang',$2,$3,$4,$5,'KR','KR','16356981734',
       'QA-20260823-CC-001','95962393877','KRW',5000,1,$6,1,
       'F95F4754AFAE','credential_incarnation_v1',
       '2026-08-25 11:40:32.606508+00',null,
       '2026-08-19 20:23:27.905445+00','passed',null,null,null,$7,$8,
       '2026-09-01 05:10:24.162179+00',
       '2026-09-01 05:15:24.162179+00',$9,$10,$11,$12,$13,$14
     )`,
    [
      permitId, listingId, productId, credentialId, ownerId, sellerAccountKey,
      releaseSha, requestFingerprint, jobId, attemptId,
      fingerprint.arguments_sha, fingerprint.arguments_bytes,
      fingerprint.payload_sha, fingerprint.payload_bytes,
    ],
  );

  const fixtureMigration = migration
    .replaceAll(productionArgumentsSha, fingerprint.arguments_sha)
    .replaceAll(productionPayloadSha, fingerprint.payload_sha)
    .replaceAll("20011", String(fingerprint.arguments_bytes))
    .replaceAll("20026", String(fingerprint.payload_bytes));
  return { db, migration: fixtureMigration };
}

test("migration is ordered after the deferred-job and Lazada target migrations", async () => {
  const migrations = (await readdir(new URL("../supabase/migrations", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const predecessor = migrations.indexOf(
    "20260901150000_fix_exact_update_deferred_job_lineage.sql",
  );
  const lazadaTargetSync = migrations.indexOf(
    "20260901151000_idempotent_lazada_target_sync.sql",
  );
  const current = migrations.indexOf(migrationName);
  assert.ok(predecessor >= 0);
  assert.ok(lazadaTargetSync > predecessor);
  assert.ok(current > lazadaTargetSync);
  // Unrelated forward migrations may follow this reconciliation migration.
});

test("migration source pins the exact production tuple and hashes", () => {
  for (const value of [
    productId, listingId, credentialId, attemptId, jobId, permitId, releaseSha,
    requestFingerprint, productionArgumentsSha, productionPayloadSha,
    sellerAccountKey, jobCreatedBy,
  ]) {
    assert.match(migration, new RegExp(value));
  }
  assert.match(migration, /attempt_count = 0/u);
  assert.match(migration, /worker_token_id is null/u);
  assert.match(migration, /claim_token is null/u);
  assert.match(migration, /lease_expires_at is null/u);
  assert.match(migration, /provider_mutation_started_at is null/u);
  assert.match(migration, /active_serverless_runtime_release_sha\(\) is null/u);
  assert.match(migration, /for update of listing, product, attempt, job, credential, permit,\s+egress_policy/u);
  assert.match(migration, /not egress_policy\.enabled/u);
  assert.match(migration, /pg_advisory_xact_lock\(193674993, 821065060\)/u);
  assert.doesNotMatch(migration, /lock table cron\.job/u);
  const schedulePreflight = migration.match(
    /-- The activation RPC uses the advisory lock[\s\S]+?select public\.sellerpilot_service_serverless_cs_wakeup_status\(\)/u,
  )?.[0];
  assert.ok(schedulePreflight);
  assert.doesNotMatch(schedulePreflight, /for update/u);
  assert.ok(
    (migration.match(/count\(distinct schedule\.jobname\)/gu) ?? []).length >= 3,
  );
  for (const commandMd5 of [
    "815889cb8db42f522fcc1cd60161ef26",
    "4c1de876b257cec6a8731d130e202373",
    "120c755989cde887b0b19653089d1997",
    "aac1259223c7043f8f099c2ff31dcb8e",
    "31fad1103e3cd103cd92af5afcbead07",
    "a4b24e5c1c85c0abdc614af475d3dd01",
  ]) {
    assert.match(migration, new RegExp(commandMd5));
  }
  assert.match(migration, /pg_get_functiondef/u);
  assert.match(
    migration,
    /sellerpilot_service_activate_serverless_runtime\(uuid,text\)/u,
  );
  assert.match(migration, /has_schema_privilege/u);
  assert.match(migration, /has_table_privilege/u);
  assert.match(migration, /lock table sellerpilot_private\.channel_gateway_jobs\s+in share row exclusive mode/u);
  assert.match(migration, /not sellerpilot_private\.serverless_static_egress_allowed\('coupang'\)/u);
});

test("the exact unclaimed job becomes a fully audited manual WING handoff", async () => {
  const { db, migration: fixtureMigration } = await createDatabase();
  try {
    await db.exec(fixtureMigration);
    const job = (await db.query(
      `select status,attempt_count,worker_token_id,claim_token,lease_expires_at,
              provider_mutation_started_at,response_payload,error_message,
              completed_at is not null as completed
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [jobId],
    )).rows[0];
    assert.deepEqual(job, {
      status: "cancelled",
      attempt_count: 0,
      worker_token_id: null,
      claim_token: null,
      lease_expires_at: null,
      provider_mutation_started_at: null,
      response_payload: null,
      error_message: manualMessage,
      completed: true,
    });
    const permit = (await db.query(
      `select update_job_id,update_attempt_id,arguments_sha256,
              request_payload_sha256,bound_at,bound_worker_token_id,
              bound_claim_token,consumed_at,invalidation_reason,
              invalidated_at is not null as invalidated
         from sellerpilot_private.exact_existing_update_permits
        where permit_id=$1`,
      [permitId],
    )).rows[0];
    assert.equal(permit.update_job_id, jobId);
    assert.equal(permit.update_attempt_id, attemptId);
    assert.match(permit.arguments_sha256, /^[a-f0-9]{64}$/u);
    assert.match(permit.request_payload_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(permit.bound_at, null);
    assert.equal(permit.bound_worker_token_id, null);
    assert.equal(permit.bound_claim_token, null);
    assert.equal(permit.consumed_at, null);
    assert.equal(permit.invalidation_reason, "unclaimed_static_egress");
    assert.equal(permit.invalidated, true);

    const attempt = (await db.query(
      `select status,http_status,safe_message,completed_at is not null as completed
         from sellerpilot_private.channel_operation_attempts where id=$1`,
      [attemptId],
    )).rows[0];
    assert.deepEqual(attempt, {
      status: "manual_required",
      http_status: 409,
      safe_message: manualMessage,
      completed: true,
    });
    const listing = (await db.query(
      `select status,failure_class,last_error,remote_id,remote_visibility,
              provider_status,published_at,operation_attempt_id
         from sellerpilot_private.product_listings where id=$1`,
      [listingId],
    )).rows[0];
    assert.deepEqual(listing, {
      status: "failed",
      failure_class: "external_action",
      last_error: manualMessage,
      remote_id: "16356981734",
      remote_visibility: "unknown",
      provider_status: null,
      published_at: null,
      operation_attempt_id: attemptId,
    });
    const audit = (await db.query(
      `select action,entity_type,entity_id,safe_detail
         from sellerpilot_private.operation_audit`,
    )).rows[0];
    assert.equal(audit.action, "coupang_unclaimed_static_egress_job_retired");
    assert.equal(audit.entity_type, "channel_gateway_job");
    assert.equal(audit.entity_id, jobId);
    assert.equal(audit.safe_detail.contract, "coupang_unclaimed_static_egress_retirement_v1");
    assert.equal(audit.safe_detail.providerCallReplayed, false);
    assert.equal(audit.safe_detail.providerMutationStarted, false);
    assert.equal(audit.safe_detail.jobCreatedBy, jobCreatedBy);
    assert.equal(audit.safe_detail.credentialCreatedBy, jobCreatedBy);
    assert.equal(audit.safe_detail.credentialVersion, 1);
    assert.equal(audit.safe_detail.credentialFingerprint, "F95F4754AFAE");
    assert.equal(audit.safe_detail.credentialAccountSource, "credential_incarnation_v1");
    assert.equal(
      audit.safe_detail.credentialVerifiedAt,
      "2026-08-25T11:40:32.606508Z",
    );
    assert.equal(
      audit.safe_detail.credentialLastCheckedAt,
      "2026-08-19T20:23:27.905445Z",
    );
    assert.equal(audit.safe_detail.credentialLastCheckStatus, "passed");
    assert.equal(audit.safe_detail.credentialExpiresAt, null);
    assert.equal(audit.safe_detail.runtimeActiveRelease, null);
    assert.equal(audit.safe_detail.runtimeSchedulesActive, false);
    assert.equal(audit.safe_detail.runtimeScheduleCount, 6);
    assert.equal(audit.safe_detail.runtimeDistinctScheduleCount, 6);
    assert.equal(audit.safe_detail.runtimeScheduleFingerprint.length, 6);
    assert.deepEqual(
      audit.safe_detail.runtimeScheduleFingerprint.map((row) => row.commandMd5),
      [
        "815889cb8db42f522fcc1cd60161ef26",
        "4c1de876b257cec6a8731d130e202373",
        "120c755989cde887b0b19653089d1997",
        "aac1259223c7043f8f099c2ff31dcb8e",
        "31fad1103e3cd103cd92af5afcbead07",
        "a4b24e5c1c85c0abdc614af475d3dd01",
      ],
    );
    assert.deepEqual(audit.safe_detail.runtimePreimage, {
      active: false,
      activeRelease: null,
      configured: true,
      distinctScheduleCount: 6,
      reconciliationRequiredMutations: 4,
      scheduleCount: 6,
      unsafePendingMutations: 1,
      version: "serverless_runtime_v2",
    });
    assert.equal(audit.safe_detail.auditPreimageCount, 0);
    assert.equal(audit.safe_detail.auditInsertExpectedCount, 1);
    assert.equal(audit.safe_detail.operatorAction, "manual_coupang_wing_update");
    const runtimePostimage = (await db.query(
      "select public.sellerpilot_service_serverless_cs_wakeup_status() as status",
    )).rows[0].status;
    assert.equal(runtimePostimage.configured, true);
    assert.equal(runtimePostimage.active, false);
    assert.equal(runtimePostimage.activeRelease, null);
    assert.equal(runtimePostimage.unsafePendingMutations, 0);
    assert.equal(runtimePostimage.reconciliationRequiredMutations, 4);
  } finally {
    await db.close();
  }
});

for (const drift of [
  ["attempt count", "update sellerpilot_private.channel_gateway_jobs set attempt_count=1 where id=$1", [jobId]],
  ["worker token", "update sellerpilot_private.channel_gateway_jobs set worker_token_id='10000000-0000-4000-8000-000000000001' where id=$1", [jobId]],
  ["claim token", "update sellerpilot_private.channel_gateway_jobs set claim_token='10000000-0000-4000-8000-000000000001' where id=$1", [jobId]],
  ["lease", "update sellerpilot_private.channel_gateway_jobs set lease_expires_at='2026-09-01 05:20:24+00' where id=$1", [jobId]],
  ["provider boundary", "update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$1", [jobId]],
  ["job creator", "update sellerpilot_private.channel_gateway_jobs set created_by=$2 where id=$1", [jobId, ownerId]],
  ["job created time", "update sellerpilot_private.channel_gateway_jobs set created_at=created_at + interval '1 second' where id=$1", [jobId]],
  ["credential refresh claim", "update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=true,credential_refresh_started_at=clock_timestamp() where id=$1", [jobId]],
  ["prepared credential", "update sellerpilot_private.channel_gateway_jobs set credential_refresh_prepared_at=clock_timestamp(),prepared_credential_id=$2 where id=$1", [jobId, credentialId]],
  ["credential recovery vault", "update sellerpilot_private.channel_gateway_jobs set credential_refresh_recovery_vault_id='10000000-0000-4000-8000-000000000001' where id=$1", [jobId]],
  ["OAuth provider call", "update sellerpilot_private.channel_gateway_jobs set oauth_provider_call_started_at=clock_timestamp() where id=$1", [jobId]],
  ["request fingerprint", "update sellerpilot_private.channel_gateway_jobs set request_fingerprint=$2 where id=$1", [jobId, "f".repeat(64)]],
  ["request payload", "update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,sellerProductId}','\"different\"'::jsonb) where id=$1", [jobId]],
  ["listing identity", "update sellerpilot_private.product_listings set remote_id='different' where id=$1", [listingId]],
  ["product identity", "update sellerpilot_private.products set sku='different' where id=$1", [productId]],
  ["credential fingerprint", "update sellerpilot_private.channel_credentials set fingerprint='different' where id=$1", [credentialId]],
  ["credential version", "update sellerpilot_private.channel_credentials set version=2 where id=$1", [credentialId]],
  ["credential account source", "update sellerpilot_private.channel_credentials set seller_account_key_source='different' where id=$1", [credentialId]],
  ["credential verified time", "update sellerpilot_private.channel_credentials set seller_account_verified_at=seller_account_verified_at + interval '1 second' where id=$1", [credentialId]],
  ["credential last checked time", "update sellerpilot_private.channel_credentials set last_checked_at=last_checked_at + interval '1 second' where id=$1", [credentialId]],
  ["credential last check status", "update sellerpilot_private.channel_credentials set last_check_status='failed' where id=$1", [credentialId]],
  ["credential expiry", "update sellerpilot_private.channel_credentials set expires_at='2099-09-01 05:15:24+00' where id=$1", [credentialId]],
  ["credential creator", "update sellerpilot_private.channel_credentials set created_by=$2 where id=$1", [credentialId, ownerId]],
  ["permit credential version", "update sellerpilot_private.exact_existing_update_permits set credential_version=2 where permit_id=$1", [permitId]],
  ["permit credential fingerprint", "update sellerpilot_private.exact_existing_update_permits set credential_fingerprint='different' where permit_id=$1", [permitId]],
  ["permit credential account source", "update sellerpilot_private.exact_existing_update_permits set credential_account_source='different' where permit_id=$1", [permitId]],
  ["permit credential verified time", "update sellerpilot_private.exact_existing_update_permits set credential_verified_at=credential_verified_at + interval '1 second' where permit_id=$1", [permitId]],
  ["permit credential last checked time", "update sellerpilot_private.exact_existing_update_permits set credential_last_checked_at=credential_last_checked_at + interval '1 second' where permit_id=$1", [permitId]],
  ["permit credential last check status", "update sellerpilot_private.exact_existing_update_permits set credential_last_check_status='failed' where permit_id=$1", [permitId]],
  ["permit credential expiry", "update sellerpilot_private.exact_existing_update_permits set credential_expires_at='2099-09-01 05:15:24+00' where permit_id=$1", [permitId]],
  ["release fingerprint", "update sellerpilot_private.exact_existing_update_permits set release_sha=$2 where permit_id=$1", [permitId, "f".repeat(40)]],
  ["unexpired permit", "update sellerpilot_private.exact_existing_update_permits set expires_at='2099-09-01 05:15:24+00' where permit_id=$1", [permitId]],
]) {
  test(`${drift[0]} drift aborts every retirement mutation`, async () => {
    const { db, migration: fixtureMigration } = await createDatabase();
    try {
      await db.query(drift[1], drift[2]);
      await assert.rejects(
        db.exec(fixtureMigration),
        /COUPANG_UNCLAIMED_STATIC_EGRESS_PREFLIGHT_MISMATCH/u,
      );
      await db.exec("rollback");
      const state = (await db.query(
        `select job.status as job_status,attempt.status as attempt_status,
                listing.status as listing_status,permit.invalidated_at
           from sellerpilot_private.channel_gateway_jobs job
           join sellerpilot_private.channel_operation_attempts attempt
             on attempt.id=job.attempt_id
           join sellerpilot_private.product_listings listing
             on listing.id=job.listing_id
           join sellerpilot_private.exact_existing_update_permits permit
             on permit.update_job_id=job.id
          where job.id=$1`,
        [jobId],
      )).rows[0];
      assert.equal(state.job_status, "queued");
      assert.equal(state.attempt_status, "running");
      assert.equal(state.listing_status, "queued");
      assert.equal(state.invalidated_at, null);
    } finally {
      await db.close();
    }
  });
}

for (const [label, consumedAt] of [
  ["bound", null],
  ["consumed", "2026-09-01 05:12:24+00"],
]) {
  test(`${label} permit fails closed`, async () => {
    const { db, migration: fixtureMigration } = await createDatabase();
    try {
      await db.query(
        `update sellerpilot_private.exact_existing_update_permits
            set bound_at='2026-09-01 05:11:24+00',
                bound_worker_token_id='10000000-0000-4000-8000-000000000001',
                bound_claim_token='20000000-0000-4000-8000-000000000002',
                consumed_at=$2
          where permit_id=$1`,
        [permitId, consumedAt],
      );
      await assert.rejects(
        db.exec(fixtureMigration),
        /COUPANG_UNCLAIMED_STATIC_EGRESS_PREFLIGHT_MISMATCH/u,
      );
    } finally {
      await db.close();
    }
  });
}

test("enabled Coupang static egress fails closed", async () => {
  const { db, migration: fixtureMigration } = await createDatabase({ staticEgress: true });
  try {
    await assert.rejects(
      db.exec(fixtureMigration),
      /COUPANG_UNCLAIMED_STATIC_EGRESS_PREFLIGHT_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

test("enabled Coupang policy fails closed even when the request-context helper is false", async () => {
  const { db, migration: fixtureMigration } = await createDatabase({
    policyEnabled: true,
    staticEgress: false,
  });
  try {
    await assert.rejects(
      db.exec(fixtureMigration),
      /COUPANG_UNCLAIMED_STATIC_EGRESS_PREFLIGHT_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

test("one active runtime schedule fails closed even though active release is null", async () => {
  const { db, migration: fixtureMigration } = await createDatabase({
    partiallyActiveRuntime: true,
  });
  try {
    await assert.rejects(
      db.exec(fixtureMigration),
      /COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

test("an incomplete inactive runtime schedule set fails closed", async () => {
  const { db, migration: fixtureMigration } = await createDatabase();
  try {
    await db.query(
      "delete from cron.job where jobname='sellerpilot-maintenance-v1'",
    );
    await assert.rejects(
      db.exec(fixtureMigration),
      /COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

test("six inactive rows with one missing and one duplicated schedule fail closed", async () => {
  const { db, migration: fixtureMigration } = await createDatabase();
  try {
    await db.exec(`
      delete from cron.job where jobname='sellerpilot-maintenance-v1';
      insert into cron.job (jobname,active)
      values ('sellerpilot-product-research-v1',false);
    `);
    await assert.rejects(
      db.exec(fixtureMigration),
      /COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

test("a fully active runtime fails closed", async () => {
  const { db, migration: fixtureMigration } = await createDatabase({
    runtimeActive: true,
  });
  try {
    await assert.rejects(
      db.exec(fixtureMigration),
      /COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

for (const [label, statement] of [
  ["schedule", "update cron.job set schedule='0 0 * * *' where jobid=3"],
  ["command", "update cron.job set command=command || ' ' where jobid=4"],
  ["database", "update cron.job set database='template1' where jobid=5"],
  ["username", "update cron.job set username='service_role' where jobid=6"],
  [
    "job id",
    "alter table cron.job alter column jobid drop identity; update cron.job set jobid=99 where jobid=2",
  ],
]) {
  test(`exact runtime ${label} drift fails closed`, async () => {
    const { db, migration: fixtureMigration } = await createDatabase();
    try {
      await db.exec(statement);
      await assert.rejects(
        db.exec(fixtureMigration),
        /COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH/u,
      );
    } finally {
      await db.close();
    }
  });
}

for (const [label, statement] of [
  ["schema usage", "grant usage on schema cron to anon"],
  ["insert", "grant insert on cron.job to authenticated"],
  ["update", "grant update on cron.job to service_role"],
  ["delete", "grant delete on cron.job to anon"],
]) {
  test(`effective cron ${label} privilege fails closed`, async () => {
    const { db, migration: fixtureMigration } = await createDatabase();
    try {
      await db.exec(statement);
      await assert.rejects(
        db.exec(fixtureMigration),
        /COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH/u,
      );
    } finally {
      await db.close();
    }
  });
}

test("runtime activation RPC without the advisory lock fails closed", async () => {
  const { db, migration: fixtureMigration } = await createDatabase();
  try {
    await db.exec(`
      create or replace function
        public.sellerpilot_service_activate_serverless_runtime(uuid,text)
      returns jsonb language sql security definer set search_path='' as $$
        select '{}'::jsonb
      $$;
    `);
    await assert.rejects(
      db.exec(fixtureMigration),
      /COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

for (const [label, statement, parameters] of [
  ["creator", "update sellerpilot_private.channel_gateway_jobs set created_by=$2 where id=$1", [jobId, ownerId]],
  ["created time", "update sellerpilot_private.channel_gateway_jobs set created_at=created_at + interval '1 second' where id=$1", [jobId]],
  ["refresh claim", "update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=true,credential_refresh_started_at=clock_timestamp() where id=$1", [jobId]],
  ["prepared credential", "update sellerpilot_private.channel_gateway_jobs set credential_refresh_prepared_at=clock_timestamp(),prepared_credential_id=$2 where id=$1", [jobId, credentialId]],
  ["recovery vault", "update sellerpilot_private.channel_gateway_jobs set credential_refresh_recovery_vault_id='10000000-0000-4000-8000-000000000001' where id=$1", [jobId]],
  ["OAuth provider call", "update sellerpilot_private.channel_gateway_jobs set oauth_provider_call_started_at=clock_timestamp() where id=$1", [jobId]],
]) {
  test(`terminal job rejects privileged ${label} drift`, async () => {
    const { db, migration: fixtureMigration } = await createDatabase();
    try {
      await db.exec(fixtureMigration);
      await assert.rejects(
        db.query(statement, parameters),
        /exact existing update job lineage invalid/u,
      );
    } finally {
      await db.close();
    }
  });
}

test("clean replay patches the state machine without manufacturing production rows", async () => {
  const { db, migration: fixtureMigration } = await createDatabase({ insertExactRows: false });
  try {
    await db.exec(fixtureMigration);
    const counts = (await db.query(`
      select
        (select count(*)::integer from sellerpilot_private.channel_gateway_jobs) jobs,
        (select count(*)::integer from sellerpilot_private.operation_audit) audits
    `)).rows[0];
    assert.deepEqual(counts, { jobs: 0, audits: 0 });
  } finally {
    await db.close();
  }
});
