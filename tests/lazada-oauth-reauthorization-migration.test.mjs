import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration183Url = new URL(
  "../supabase/migrations/20260830183000_allow_fresh_lazada_oauth_past_safe_refresh_reconciliation.sql",
  import.meta.url,
);
const migration203Url = new URL(
  "../supabase/migrations/20260830203000_record_lazada_oauth_provider_call_boundary.sql",
  import.meta.url,
);
const migration204Url = new URL(
  "../supabase/migrations/20260830204000_allow_fresh_lazada_oauth_past_oauth_reconciliation.sql",
  import.meta.url,
);

const OLD_JOB_ID = "faee01e1-2d68-4f99-951c-15684822fc43";
const SOURCE_CREDENTIAL_ID = "e39f346d-c2b0-4d58-966d-aae98ee4efc4";
const SOURCE_VAULT_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "20000000-0000-4000-8000-000000000001";
const WORKER_TOKEN_ID = "30000000-0000-4000-8000-000000000001";
const TOKEN_HASH = "a".repeat(64);
const OLD_CODE = "legacy-one-time-code-never-reuse";
const FRESH_CODE = "fresh-one-time-code-for-reauthorization";
const SELLER_ACCOUNT_KEY = "b".repeat(64);
const OTHER_LEGACY_JOB_ID = "faee01e1-2d68-4f99-951c-15684822fc44";

async function scalar(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

async function asService(db, sql, parameters = []) {
  await db.exec("set role service_role");
  try {
    return await db.query(sql, parameters);
  } finally {
    await db.exec("reset role");
  }
}

async function fingerprint(db, code) {
  return String(await scalar(
    db,
    `select encode(extensions.digest(
       jsonb_build_object('channel', 'lazada', 'code', trim($1))::text,
       'sha256'
     ), 'hex')`,
    [code],
  ));
}

async function fixture({
  sourceIdentity = "legacy",
  oldJobId = OLD_JOB_ID,
  oldProviderMarker = false,
} = {}) {
  const sourceSellerAccountKey = sourceIdentity === "certified"
    ? SELLER_ACCOUNT_KEY
    : null;
  const sourceSellerAccountKeySource = sourceIdentity === "certified"
    ? "provider_certified_v1"
    : "legacy_unattested";
  const sourceIdentityCertified = sourceIdentity === "certified";
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema extensions;
    create schema sellerpilot_private;
    create schema vault;

    create function extensions.digest(p_value text, p_algorithm text)
    returns bytea
    language sql
    immutable
    as $$
      select decode(
        md5(p_value || ':' || p_algorithm)
          || md5(p_algorithm || ':' || p_value),
        'hex'
      )
    $$;

    create table vault.secrets (
      id uuid primary key default gen_random_uuid(),
      secret text not null,
      name text not null unique,
      description text,
      created_at timestamptz not null default clock_timestamp()
    );
    create view vault.decrypted_secrets as
      select id, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(
      p_secret text,
      p_name text,
      p_description text
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare v_id uuid := gen_random_uuid();
    begin
      insert into vault.secrets (id, secret, name, description)
      values (v_id, p_secret, p_name, p_description);
      return v_id;
    end;
    $$;

    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key,
      token_hash text not null unique,
      scope text not null,
      status text not null,
      expires_at timestamptz not null
    );

    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      vault_secret_id uuid not null,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      created_by uuid not null,
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz,
      version integer not null default 1,
      created_at timestamptz not null default clock_timestamp()
    );

    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null,
      attempt_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      status text not null default 'queued',
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,
      error_message text,
      attempt_count integer not null default 0,
      listing_id uuid,
      worker_token_id uuid,
      claim_token uuid,
      lease_expires_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      prepared_credential_id uuid,
      credential_refresh_in_flight boolean not null default false,
      credential_refresh_started_at timestamptz,
      credential_refresh_fingerprint text,
      credential_refresh_prepared_at timestamptz,
      credential_refresh_recovery_vault_id uuid,
      credential_refresh_recovery_fingerprint text,
      credential_refresh_recovery_staged_at timestamptz,
      oauth_request_vault_id uuid,
      oauth_request_fingerprint text,
      oauth_source_credential_id uuid,
      oauth_exchange_completed boolean not null default false,
      provider_mutation_started_at timestamptz,
      seller_account_key text,
      write_resource_kind text,
      write_resource_key text,
      request_fingerprint text,
      inventory_item_id uuid,
      order_id uuid,
      shipment_carrier text,
      shipment_tracking text,
      created_by uuid not null,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
    );

    create table sellerpilot_private.gateway_completion_receipts (
      job_id uuid primary key,
      claim_token uuid not null,
      worker_token_id uuid not null,
      completion_fingerprint text not null,
      created_at timestamptz not null default clock_timestamp()
    );

    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid not null,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      safe_detail jsonb not null,
      occurred_at timestamptz not null
    );

    create function sellerpilot_private.gateway_completion_fingerprint(
      p_status text,
      p_response_payload jsonb,
      p_error_message text,
      p_credential_refresh jsonb,
      p_normalized_orders jsonb,
      p_normalized_inquiries jsonb,
      p_diagnostic jsonb
    )
    returns text
    language sql
    immutable
    set search_path = ''
    as $$
      select encode(extensions.digest(
        jsonb_build_object(
          'status', p_status,
          'response', p_response_payload,
          'error', p_error_message,
          'credentialRefresh', p_credential_refresh,
          'orders', p_normalized_orders,
          'inquiries', p_normalized_inquiries,
          'diagnostic', p_diagnostic
        )::text,
        'sha256'
      ), 'hex')
    $$;

    create function sellerpilot_private.serverless_cs_job_is_owned(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid,
      p_require_current_release boolean default true
    )
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select exists (
        select 1
          from sellerpilot_private.ai_cli_worker_tokens token
          join sellerpilot_private.channel_gateway_jobs job
            on job.worker_token_id = token.id
         where token.token_hash = p_token_hash
           and token.scope = 'serverless_cs'
           and token.status = 'active'
           and token.expires_at > clock_timestamp()
           and job.id = p_job_id
           and job.status = 'running'
           and job.claim_token = p_claim_token
           and job.lease_expires_at > clock_timestamp()
      )
    $$;

    create function public.sellerpilot_enqueue_channel_gateway_job(
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_operation text,
      p_request_payload jsonb
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      if p_channel is null or p_operation is null then
        raise exception 'legacy enqueue invoked for null route';
      end if;
      if p_operation = 'oauth.exchange' and exists (
        select 1
          from sellerpilot_private.channel_gateway_jobs job
         where job.oauth_source_credential_id = p_credential_id
           and job.channel = p_channel
           and job.operation = p_operation
           and job.status in ('queued', 'running', 'reconciliation_required')
      ) then
        raise exception 'unresolved OAuth exchange already exists';
      end if;
      raise exception 'legacy enqueue invoked';
    end;
    $$;

    create function public.sellerpilot_claim_serverless_gateway_job(
      p_token_hash text,
      p_worker_version text default null
    )
    returns jsonb
    language sql
    security definer
    set search_path = ''
    as $$ select null::jsonb $$;
  `);

  await db.exec(await readFile(migration183Url, "utf8"));
  await db.exec(await readFile(migration203Url, "utf8"));
  await db.exec(await readFile(migration204Url, "utf8"));

  await db.query(
    `insert into vault.secrets (id, secret, name, description)
     values ($1, $2, 'sellerpilot_lazada_source_credential', 'test source')`,
    [
      SOURCE_VAULT_ID,
      JSON.stringify({ app_key: "137451", app_secret: "private-app-secret", country: "my" }),
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id, vault_secret_id, channel, environment, status, expires_at,
       created_by, seller_account_key, seller_account_key_source,
       seller_account_verified_at, version
     ) values (
       $1, $2, 'lazada', 'production', 'active',
       clock_timestamp() + interval '1 day', $3, $4, $5,
       case when $6::boolean then clock_timestamp() - interval '1 day'
            else null end,
       1
     )`,
    [
      SOURCE_CREDENTIAL_ID,
      SOURCE_VAULT_ID,
      OWNER_ID,
      sourceSellerAccountKey,
      sourceSellerAccountKeySource,
      sourceIdentityCertified,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.ai_cli_worker_tokens (
       id, token_hash, scope, status, expires_at
     ) values (
       $1, $2, 'serverless_cs', 'active',
       clock_timestamp() + interval '1 day'
     )`,
    [WORKER_TOKEN_ID, TOKEN_HASH],
  );

  const oldFingerprint = await fingerprint(db, OLD_CODE);
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id, credential_id, channel, operation, environment, status,
       request_payload, response_payload, error_message, attempt_count,
       started_at, completed_at, credential_refresh_in_flight,
       credential_refresh_started_at, oauth_request_vault_id,
       oauth_request_fingerprint, oauth_source_credential_id,
       oauth_exchange_completed, oauth_provider_call_started_at,
       seller_account_key, created_by,
       created_at, updated_at
     ) values (
       $1, $2, 'lazada', 'oauth.exchange', 'production',
       'reconciliation_required', jsonb_build_object('vaultBacked', true),
       null, 'serverless_cs_execution_failed', 1,
       clock_timestamp() - interval '12 minutes',
       clock_timestamp() - interval '9 minutes', true,
       clock_timestamp() - interval '11 minutes', null, $3, $2,
       false,
       case when $4::boolean then clock_timestamp() - interval '10 minutes'
            else null end,
       $5, $6,
       clock_timestamp() - interval '13 minutes',
       clock_timestamp() - interval '9 minutes'
     )`,
    [
      oldJobId,
      SOURCE_CREDENTIAL_ID,
      oldFingerprint,
      oldProviderMarker,
      sourceSellerAccountKey,
      OWNER_ID,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.gateway_completion_receipts (
       job_id, claim_token, worker_token_id, completion_fingerprint, created_at
     ) values (
       $1, $2, $3,
       sellerpilot_private.gateway_completion_fingerprint(
         'reconciliation_required', null,
         'serverless_cs_execution_failed', null, null, null, null
       ),
       clock_timestamp() - interval '8 minutes'
     )`,
    [
      oldJobId,
      "40000000-0000-4000-8000-000000000001",
      WORKER_TOKEN_ID,
    ],
  );
  return db;
}

async function enqueueFresh(db, code = FRESH_CODE) {
  const result = await asService(
    db,
    `select public.sellerpilot_enqueue_channel_gateway_job(
       $1, null, 'lazada', 'oauth.exchange', $2::jsonb
     ) as id`,
    [SOURCE_CREDENTIAL_ID, JSON.stringify({ code, country: "my" })],
  );
  return String(result.rows[0]?.id);
}

async function claimFresh(db) {
  const result = await asService(
    db,
    "select public.sellerpilot_claim_serverless_gateway_job($1, 'test-worker') as claim",
    [TOKEN_HASH],
  );
  return result.rows[0]?.claim;
}

async function markProviderCall(db, jobId, claimToken) {
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set credential_refresh_in_flight=true,
            credential_refresh_started_at=clock_timestamp(),
            updated_at=clock_timestamp()
      where id=$1 and status='running' and claim_token=$2`,
    [jobId, claimToken],
  );
  const result = await asService(
    db,
    `select public.sellerpilot_service_mark_lazada_oauth_provider_call_started(
       $1, $2, $3
     ) as marked`,
    [TOKEN_HASH, jobId, claimToken],
  );
  assert.equal(result.rows[0]?.marked, true);
}

async function stageCertifiedReplacement(
  db,
  jobId,
  claimToken,
  sellerAccountKey = SELLER_ACCOUNT_KEY,
) {
  const replacementId = "e39f346d-c2b0-4d58-966d-aae98ee4efc5";
  const replacementVaultId = "10000000-0000-4000-8000-000000000002";
  await db.query(
    `insert into vault.secrets (id, secret, name, description)
     values ($1, $2, 'sellerpilot_lazada_replacement_credential', 'test replacement')`,
    [
      replacementVaultId,
      JSON.stringify({
        app_key: "137451",
        app_secret: "private-app-secret",
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        country: "my",
      }),
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id, vault_secret_id, channel, environment, status, expires_at,
       created_by, seller_account_key, seller_account_key_source,
       seller_account_verified_at, version
     ) values (
       $1, $2, 'lazada', 'production', 'active',
       clock_timestamp() + interval '1 day', $3, $4,
       'provider_certified_v1', clock_timestamp(), 2
     )`,
    [replacementId, replacementVaultId, OWNER_ID, sellerAccountKey],
  );
  await db.query(
    "update sellerpilot_private.channel_credentials set status='revoked' where id=$1",
    [SOURCE_CREDENTIAL_ID],
  );
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set credential_id=$2,
            prepared_credential_id=$2,
            credential_refresh_prepared_at=clock_timestamp(),
            credential_refresh_in_flight=false,
            credential_refresh_started_at=null,
            oauth_exchange_completed=true,
            worker_token_id=null,
            claim_token=null,
            lease_expires_at=null
      where id=$1 and claim_token=$3`,
    [jobId, replacementId, claimToken],
  );
  return replacementId;
}

test("forward migration fences receipt evidence and keeps NULL routes delegated", async () => {
  const migration = await readFile(migration204Url, "utf8");
  assert.match(migration, /p_channel is distinct from 'lazada'/);
  assert.match(migration, /p_operation is distinct from 'oauth\.exchange'/);
  assert.match(migration, /blocker\.oauth_request_fingerprint is distinct from[\s\S]*p_new_oauth_fingerprint/);
  assert.match(migration, /gateway_completion_fingerprint\([\s\S]*'reconciliation_required'[\s\S]*blocker\.error_message/);
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.(?:product_)?listings/i);
  const enqueueBlock = migration.slice(
    migration.indexOf("create function public.sellerpilot_enqueue_channel_gateway_job"),
    migration.indexOf("-- Re-check the complete candidate"),
  );
  const claimBlock = migration.slice(
    migration.indexOf("create function public.sellerpilot_claim_serverless_gateway_job"),
    migration.indexOf("create or replace function sellerpilot_private.supersede_safe_lazada_refresh_after_oauth"),
  );
  const successBlock = migration.slice(
    migration.indexOf("create or replace function sellerpilot_private.supersede_safe_lazada_refresh_after_oauth"),
  );
  for (const block of [enqueueBlock, claimBlock, successBlock]) {
    const jobsLock = block.indexOf("lock table sellerpilot_private.channel_gateway_jobs");
    const credentialsLock = block.indexOf("lock table sellerpilot_private.channel_credentials");
    const vaultLock = block.indexOf("lock table vault.secrets");
    const receiptLock = block.indexOf("lock table sellerpilot_private.gateway_completion_receipts");
    assert.ok(jobsLock >= 0 && jobsLock < credentialsLock);
    assert.ok(credentialsLock < vaultLock);
    assert.ok(vaultLock < receiptLock);
  }
  assert.ok(
    claimBlock.indexOf("lock table sellerpilot_private.gateway_completion_receipts")
      < claimBlock.indexOf("select oauth.id"),
  );
  assert.ok(
    claimBlock.indexOf("-- Keep ordinary channel drains")
      < claimBlock.indexOf("perform pg_catalog.pg_advisory_xact_lock"),
  );

  const db = await fixture();
  try {
    for (const [channel, operation] of [[null, "oauth.exchange"], ["lazada", null]]) {
      await assert.rejects(
        asService(
          db,
          "select public.sellerpilot_enqueue_channel_gateway_job($1,null,$2,$3,$4::jsonb)",
          [SOURCE_CREDENTIAL_ID, channel, operation, JSON.stringify({ code: FRESH_CODE })],
        ),
        /legacy enqueue invoked for null route/,
      );
    }
    assert.equal(await scalar(
      db,
      "select count(*) from sellerpilot_private.channel_gateway_jobs",
    ), 1);
    assert.equal(await scalar(db, "select count(*) from vault.secrets"), 1);
  } finally {
    await db.close();
  }
});

test("service enqueue replays the old code, rejects a bad receipt, and creates one different Vault grant", async () => {
  const db = await fixture();
  try {
    const replay = await asService(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
         $1, null, 'lazada', 'oauth.exchange', $2::jsonb
       ) as id`,
      [SOURCE_CREDENTIAL_ID, JSON.stringify({ code: OLD_CODE })],
    );
    assert.equal(replay.rows[0]?.id, OLD_JOB_ID);
    assert.equal(await scalar(db, "select count(*) from vault.secrets"), 1);

    await db.query(
      `update sellerpilot_private.gateway_completion_receipts
          set completion_fingerprint=$2
        where job_id=$1`,
      [OLD_JOB_ID, "f".repeat(64)],
    );
    await assert.rejects(enqueueFresh(db), /unresolved OAuth exchange already exists/);
    assert.equal(await scalar(
      db,
      "select count(*) from sellerpilot_private.channel_gateway_jobs",
    ), 1);
    assert.equal(await scalar(db, "select count(*) from vault.secrets"), 1);

    await db.query(
      `update sellerpilot_private.gateway_completion_receipts
          set completion_fingerprint =
            sellerpilot_private.gateway_completion_fingerprint(
              'reconciliation_required', null,
              'serverless_cs_execution_failed', null, null, null, null
            )
        where job_id=$1`,
      [OLD_JOB_ID],
    );
    const freshJobId = await enqueueFresh(db);
    assert.notEqual(freshJobId, OLD_JOB_ID);
    const row = (await db.query(
      `select job.status, job.request_payload,
              job.oauth_request_fingerprint,
              secret.decrypted_secret::jsonb as oauth_request
         from sellerpilot_private.channel_gateway_jobs job
         join vault.decrypted_secrets secret
           on secret.id=job.oauth_request_vault_id
        where job.id=$1`,
      [freshJobId],
    )).rows[0];
    assert.deepEqual(row?.request_payload, { vaultBacked: true });
    assert.deepEqual(row?.oauth_request, { code: FRESH_CODE, country: "my" });
    assert.notEqual(row?.oauth_request_fingerprint, await fingerprint(db, OLD_CODE));
    assert.equal(row?.status, "queued");
    assert.equal(await scalar(db, "select count(*) from vault.secrets"), 2);

    await assert.rejects(
      enqueueFresh(db, "another-different-one-time-code"),
      /unresolved OAuth exchange already exists/,
    );
    assert.equal(await scalar(
      db,
      "select count(*) from sellerpilot_private.channel_gateway_jobs",
    ), 2);
  } finally {
    await db.close();
  }
});

test("service claim and certified success alone supersede the old OAuth uncertainty", async () => {
  const db = await fixture();
  try {
    const freshJobId = await enqueueFresh(db);
    const claim = await claimFresh(db);
    assert.equal(claim?.id, freshJobId);
    assert.equal(claim?.attempt_count, 1);
    assert.deepEqual(claim?.request, { code: FRESH_CODE, country: "my" });
    assert.equal(claim?.credential?.app_key, "137451");
    await markProviderCall(db, freshJobId, claim.claim_token);
    await stageCertifiedReplacement(db, freshJobId, claim.claim_token);

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',
              completed_at=clock_timestamp(),
              response_payload=jsonb_build_object(
                'ok', true,
                'channel', 'lazada',
                'operation', 'oauth.exchange'
              ),
              oauth_request_vault_id=null,
              updated_at=clock_timestamp()
        where id=$1 and status='running'`,
      [freshJobId],
    );

    const old = (await db.query(
      `select status, error_message, credential_refresh_in_flight,
              credential_refresh_started_at
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [OLD_JOB_ID],
    )).rows[0];
    assert.deepEqual(old, {
      status: "cancelled",
      error_message: "LAZADA_OAUTH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH",
      credential_refresh_in_flight: false,
      credential_refresh_started_at: null,
    });
    const audit = (await db.query(
      `select safe_detail
         from sellerpilot_private.operation_audit
        where action='lazada_oauth_reconciliation_superseded_by_certified_oauth'
          and entity_id=$1`,
      [OLD_JOB_ID],
    )).rows[0]?.safe_detail;
    assert.equal(audit?.credential_only_supersession, true);
    assert.equal(audit?.legacy_source_identity_exception, true);
    assert.equal(audit?.identity_continuity_verified, false);
    assert.equal(audit?.listing_identity_relinked, false);
    const auditJson = JSON.stringify(audit);
    assert.doesNotMatch(auditJson, /private-|fresh-one-time-code/i);
    assert.doesNotMatch(auditJson, new RegExp(SELLER_ACCOUNT_KEY));
  } finally {
    await db.close();
  }
});

test("a failed fresh exchange and an audit failure never hide the old uncertainty", async (t) => {
  await t.test("fresh provider failure leaves both jobs in reconciliation", async () => {
    const db = await fixture();
    try {
      const freshJobId = await enqueueFresh(db);
      const claim = await claimFresh(db);
      await markProviderCall(db, freshJobId, claim.claim_token);
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='reconciliation_required',
                error_message='LAZADA_OAUTH_PROVIDER_FAILURE:ISV:INVALID_CODE',
                completed_at=clock_timestamp(),
                worker_token_id=null,
                claim_token=null,
                lease_expires_at=null,
                oauth_request_vault_id=null,
                updated_at=clock_timestamp()
          where id=$1 and status='running'`,
        [freshJobId],
      );
      const statuses = (await db.query(
        `select id::text, status from sellerpilot_private.channel_gateway_jobs
          where id in ($1,$2) order by id`,
        [OLD_JOB_ID, freshJobId],
      )).rows;
      assert.equal(statuses.length, 2);
      assert.ok(statuses.every(({ status }) => status === "reconciliation_required"));
      assert.equal(await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit",
      ), 0);
    } finally {
      await db.close();
    }
  });

  await t.test("success payloads missing exact channel and operation keys do not supersede", async () => {
    const db = await fixture();
    try {
      const freshJobId = await enqueueFresh(db);
      const claim = await claimFresh(db);
      await markProviderCall(db, freshJobId, claim.claim_token);
      await stageCertifiedReplacement(db, freshJobId, claim.claim_token);
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='succeeded',
                completed_at=clock_timestamp(),
                response_payload=jsonb_build_object('ok', true),
                oauth_request_vault_id=null,
                updated_at=clock_timestamp()
          where id=$1 and status='running'`,
        [freshJobId],
      );
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [OLD_JOB_ID],
      ), "reconciliation_required");
      assert.equal(await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit",
      ), 0);
    } finally {
      await db.close();
    }
  });

  await t.test("a manually corrected terminal state is not treated as a provider completion", async () => {
    const db = await fixture();
    try {
      const freshJobId = await enqueueFresh(db);
      const claim = await claimFresh(db);
      await markProviderCall(db, freshJobId, claim.claim_token);
      await stageCertifiedReplacement(db, freshJobId, claim.claim_token);
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='reconciliation_required',
                completed_at=clock_timestamp(),
                error_message='LAZADA_OAUTH_PROVIDER_FAILURE:ISV:INVALID_CODE',
                oauth_request_vault_id=null,
                updated_at=clock_timestamp()
          where id=$1 and status='running'`,
        [freshJobId],
      );
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='succeeded',
                error_message=null,
                response_payload=jsonb_build_object(
                  'ok', true,
                  'channel', 'lazada',
                  'operation', 'oauth.exchange'
                ),
                updated_at=clock_timestamp()
          where id=$1 and status='reconciliation_required'`,
        [freshJobId],
      );
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [OLD_JOB_ID],
      ), "reconciliation_required");
      assert.equal(await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit",
      ), 0);
    } finally {
      await db.close();
    }
  });

  await t.test("impossible provider-to-prepared chronology does not supersede", async () => {
    const db = await fixture();
    try {
      const freshJobId = await enqueueFresh(db);
      const claim = await claimFresh(db);
      await markProviderCall(db, freshJobId, claim.claim_token);
      await stageCertifiedReplacement(db, freshJobId, claim.claim_token);
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set credential_refresh_prepared_at =
                  oauth_provider_call_started_at - interval '1 second'
          where id=$1`,
        [freshJobId],
      );
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='succeeded',
                completed_at=clock_timestamp(),
                response_payload=jsonb_build_object(
                  'ok', true,
                  'channel', 'lazada',
                  'operation', 'oauth.exchange'
                ),
                oauth_request_vault_id=null,
                updated_at=clock_timestamp()
          where id=$1 and status='running'`,
        [freshJobId],
      );
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [OLD_JOB_ID],
      ), "reconciliation_required");
    } finally {
      await db.close();
    }
  });

  await t.test("direct Vault code type and size drift cannot reach claim", async () => {
    const db = await fixture();
    try {
      const freshJobId = await enqueueFresh(db);
      const vaultId = await scalar(
        db,
        "select oauth_request_vault_id from sellerpilot_private.channel_gateway_jobs where id=$1",
        [freshJobId],
      );
      for (const [secret, codeText] of [
        [{ code: 12345678 }, "12345678"],
        [{ code: "x".repeat(8001) }, "x".repeat(8001)],
      ]) {
        await db.query(
          "update vault.secrets set secret=$2 where id=$1",
          [vaultId, JSON.stringify(secret)],
        );
        await db.query(
          `update sellerpilot_private.channel_gateway_jobs
              set oauth_request_fingerprint=$2
            where id=$1`,
          [freshJobId, await fingerprint(db, codeText)],
        );
        assert.equal(await claimFresh(db), null);
      }
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [freshJobId],
      ), "queued");
    } finally {
      await db.close();
    }
  });

  await t.test("a different provider-certified seller account does not cancel account A uncertainty", async () => {
    const db = await fixture({ sourceIdentity: "certified" });
    try {
      const freshJobId = await enqueueFresh(db);
      const claim = await claimFresh(db);
      await markProviderCall(db, freshJobId, claim.claim_token);
      await stageCertifiedReplacement(db, freshJobId, claim.claim_token, "c".repeat(64));
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='succeeded',
                completed_at=clock_timestamp(),
                response_payload=jsonb_build_object(
                  'ok', true,
                  'channel', 'lazada',
                  'operation', 'oauth.exchange'
                ),
                oauth_request_vault_id=null,
                updated_at=clock_timestamp()
          where id=$1 and status='running'`,
        [freshJobId],
      );
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [OLD_JOB_ID],
      ), "reconciliation_required");
      assert.equal(await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit",
      ), 0);
    } finally {
      await db.close();
    }
  });

  await t.test("another legacy-null OAuth blocker cannot consume a fresh seller code", async () => {
    const db = await fixture({
      oldJobId: OTHER_LEGACY_JOB_ID,
      oldProviderMarker: true,
    });
    try {
      await assert.rejects(
        enqueueFresh(db),
        /unresolved OAuth exchange already exists/,
      );
      assert.equal(await scalar(
        db,
        "select count(*) from sellerpilot_private.channel_gateway_jobs",
      ), 1);
      assert.equal(await scalar(db, "select count(*) from vault.secrets"), 1);
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [OTHER_LEGACY_JOB_ID],
      ), "reconciliation_required");
    } finally {
      await db.close();
    }
  });

  await t.test("a legacy-null read-refresh blocker is rejected before a Vault grant or OAuth job exists", async () => {
    const db = await fixture();
    try {
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set operation='orders.list',
                request_payload='{}'::jsonb,
                oauth_request_fingerprint=null,
                oauth_source_credential_id=null
          where id=$1`,
        [OLD_JOB_ID],
      );
      await db.query(
        "delete from sellerpilot_private.gateway_completion_receipts where job_id=$1",
        [OLD_JOB_ID],
      );
      await assert.rejects(
        enqueueFresh(db),
        /provider-certified Lazada source identity required/,
      );
      assert.equal(await scalar(
        db,
        "select count(*) from sellerpilot_private.channel_gateway_jobs",
      ), 1);
      assert.equal(await scalar(db, "select count(*) from vault.secrets"), 1);
    } finally {
      await db.close();
    }
  });

  await t.test("audit insertion failure rolls the blocker cancellation back", async () => {
    const db = await fixture();
    try {
      const freshJobId = await enqueueFresh(db);
      const claim = await claimFresh(db);
      await markProviderCall(db, freshJobId, claim.claim_token);
      await stageCertifiedReplacement(db, freshJobId, claim.claim_token);
      await db.exec(`
        alter table sellerpilot_private.operation_audit
          add constraint reject_oauth_supersession_audit check (
            action <> 'lazada_oauth_reconciliation_superseded_by_certified_oauth'
          );
      `);
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='succeeded',
                completed_at=clock_timestamp(),
                response_payload=jsonb_build_object(
                  'ok', true,
                  'channel', 'lazada',
                  'operation', 'oauth.exchange'
                ),
                oauth_request_vault_id=null,
                updated_at=clock_timestamp()
          where id=$1 and status='running'`,
        [freshJobId],
      );
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [freshJobId],
      ), "succeeded");
      assert.equal(await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [OLD_JOB_ID],
      ), "reconciliation_required");
      assert.equal(await scalar(
        db,
        "select credential_refresh_in_flight from sellerpilot_private.channel_gateway_jobs where id=$1",
        [OLD_JOB_ID],
      ), true);
      assert.equal(await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit",
      ), 0);
    } finally {
      await db.close();
    }
  });
});
