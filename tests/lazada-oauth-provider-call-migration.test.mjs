import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830203000_record_lazada_oauth_provider_call_boundary.sql",
  import.meta.url,
);
const TOKEN_HASH = "a".repeat(64);
const JOB_ID = "faee01e1-2d68-4f99-951c-15684822fc43";
const CLAIM_TOKEN = "99d45dd4-b36b-4da9-a269-8ee65720a3ac";
const SOURCE_CREDENTIAL_ID = "e39f346d-c2b0-4d58-966d-aae98ee4efc4";
const OAUTH_VAULT_ID = "2dcc24f9-c3a8-466e-bc42-e3af6ba7ea20";

async function scalar(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      channel text not null,
      operation text not null,
      status text not null,
      claim_token uuid,
      lease_expires_at timestamptz,
      started_at timestamptz,
      credential_refresh_in_flight boolean not null default false,
      credential_refresh_started_at timestamptz,
      oauth_exchange_completed boolean not null default false,
      prepared_credential_id uuid,
      credential_refresh_recovery_vault_id uuid,
      provider_mutation_started_at timestamptz,
      oauth_source_credential_id uuid,
      oauth_request_vault_id uuid,
      oauth_request_fingerprint text,
      request_payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default clock_timestamp()
    );

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
      select p_token_hash = '${TOKEN_HASH}'
         and exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs job
            where job.id = p_job_id
              and job.status = 'running'
              and job.claim_token = p_claim_token
              and job.lease_expires_at > clock_timestamp()
         )
    $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

test("the Lazada OAuth marker is additive, secret-free and privilege-scoped", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /add column if not exists oauth_provider_call_started_at timestamptz/);
  assert.match(migration, /job\.channel = 'lazada'/);
  assert.match(migration, /job\.operation = 'oauth\.exchange'/);
  assert.match(migration, /job\.credential_refresh_in_flight/);
  assert.match(migration, /job\.started_at <= job\.credential_refresh_started_at/);
  assert.match(migration, /job\.credential_refresh_started_at <= coalesce/);
  assert.match(migration, /job\.oauth_request_vault_id is not null/);
  assert.match(migration, /job\.request_payload = jsonb_build_object\('vaultBacked', true\)/);
  assert.match(migration, /job\.provider_mutation_started_at is null/);
  assert.doesNotMatch(migration, /access_token|refresh_token|authorization code value|request_id|account@/i);

  const db = await fixture();
  try {
    assert.equal(await scalar(
      db,
      `select has_function_privilege(
        'anon',
        'public.sellerpilot_service_mark_lazada_oauth_provider_call_started(text,uuid,uuid)',
        'execute'
      )`,
    ), false);
    assert.equal(await scalar(
      db,
      `select has_function_privilege(
        'authenticated',
        'public.sellerpilot_service_mark_lazada_oauth_provider_call_started(text,uuid,uuid)',
        'execute'
      )`,
    ), false);
    assert.equal(await scalar(
      db,
      `select has_function_privilege(
        'service_role',
        'public.sellerpilot_service_mark_lazada_oauth_provider_call_started(text,uuid,uuid)',
        'execute'
      )`,
    ), true);
  } finally {
    await db.close();
  }
});

test("only an owned, fenced and Vault-backed Lazada OAuth job receives the durable marker", async () => {
  const db = await fixture();
  try {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, channel, operation, status, claim_token, lease_expires_at,
         started_at,
         credential_refresh_in_flight, credential_refresh_started_at,
         oauth_source_credential_id, oauth_request_vault_id,
         oauth_request_fingerprint, request_payload
       ) values (
         $1, 'lazada', 'oauth.exchange', 'running', $2,
         clock_timestamp() + interval '10 minutes',
         clock_timestamp() - interval '1 minute', true, clock_timestamp(),
         $3, $4, $5, jsonb_build_object('vaultBacked', true)
       )`,
      [JOB_ID, CLAIM_TOKEN, SOURCE_CREDENTIAL_ID, OAUTH_VAULT_ID, "b".repeat(64)],
    );

    await db.exec("set role service_role");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_mark_lazada_oauth_provider_call_started($1,$2,$3)",
      [TOKEN_HASH, JOB_ID, CLAIM_TOKEN],
    ), true);
    await db.exec("reset role");
    const firstStartedAt = await scalar(
      db,
      "select oauth_provider_call_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [JOB_ID],
    );
    assert.ok(firstStartedAt);
    await db.exec("set role service_role");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_mark_lazada_oauth_provider_call_started($1,$2,$3)",
      [TOKEN_HASH, JOB_ID, CLAIM_TOKEN],
    ), true);
    await db.exec("reset role");
    assert.equal(String(await scalar(
      db,
      "select oauth_provider_call_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [JOB_ID],
    )), String(firstStartedAt));

    const row = (await db.query(
      `select oauth_provider_call_started_at is not null as marked,
              provider_mutation_started_at is null as legacy_marker_untouched,
              request_payload
         from sellerpilot_private.channel_gateway_jobs
        where id=$1`,
      [JOB_ID],
    )).rows[0];
    assert.deepEqual(row, {
      marked: true,
      legacy_marker_untouched: true,
      request_payload: { vaultBacked: true },
    });

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set oauth_provider_call_started_at=null,
              started_at=clock_timestamp(),
              credential_refresh_started_at=clock_timestamp() - interval '1 second'
        where id=$1`,
      [JOB_ID],
    );
    await db.exec("set role service_role");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_mark_lazada_oauth_provider_call_started($1,$2,$3)",
      [TOKEN_HASH, JOB_ID, CLAIM_TOKEN],
    ), false);
    await db.exec("reset role");
    assert.equal(await scalar(
      db,
      "select oauth_provider_call_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [JOB_ID],
    ), null);
  } finally {
    await db.close();
  }
});
