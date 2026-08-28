import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const GATEWAY_HASH = "c".repeat(64);
const SCHEDULER_HASH = "d".repeat(64);
const AI_HASH = "a".repeat(64);
const LEGACY_HASH = "b".repeat(64);
const PERSISTENT_GATEWAY_HASH = "f".repeat(64);
const PERSISTENT_SCHEDULER_HASH = "1".repeat(64);
const WAKE_SECRET = "w".repeat(43);
const SELLER_KEY = "e".repeat(64);

const compatibilitySql = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema auth;
create table auth.users (id uuid primary key);
create schema sellerpilot_private;
create table sellerpilot_private.admin_users (
  user_id uuid primary key references auth.users(id),
  display_name text not null,
  created_at timestamptz not null default now()
);
create table sellerpilot_private.ai_cli_worker_tokens (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  token_hash text not null unique,
  fingerprint text not null,
  status text not null,
  scope text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  last_version text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  rotation_set_id uuid,
  activation_expires_at timestamptz,
  activated_at timestamptz
);
create unique index ai_cli_worker_one_active_per_scope_idx
  on sellerpilot_private.ai_cli_worker_tokens (scope)
  where status = 'active';
create table sellerpilot_private.ai_cli_audit (
  id bigint generated always as identity primary key,
  action text not null,
  actor_user_id uuid references auth.users(id),
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
  safe_detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text,
  description text,
  created_at timestamptz not null default now()
);
create view vault.decrypted_secrets as
select id, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default ''
)
returns uuid
language plpgsql
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into vault.secrets (id, secret, name, description)
  values (v_id, new_secret, new_name, new_description);
  return v_id;
end;
$$;
create function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null
)
returns void
language sql
as $$
  update vault.secrets
     set secret = coalesce($2, secret),
         name = coalesce($3, name),
         description = coalesce($4, description)
   where id = $1
$$;

create table sellerpilot_private.channel_credentials (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  environment text not null,
  vault_secret_id uuid not null,
  status text not null,
  expires_at timestamptz,
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
);
create table sellerpilot_private.channel_gateway_jobs (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id),
  channel text not null,
  operation text not null,
  environment text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  status text not null default 'queued',
  error_message text,
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
  claim_token uuid,
  attempt_count integer not null default 0,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  seller_account_key text,
  credential_refresh_in_flight boolean not null default false,
  credential_refresh_recovery_vault_id uuid,
  prepared_credential_id uuid,
  oauth_exchange_completed boolean not null default false,
  provider_mutation_started_at timestamptz
);
create table sellerpilot_private.gateway_completion_receipts (
  job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id),
  completion_fingerprint text not null default repeat('0', 64),
  continuation_job_id uuid,
  created_at timestamptz not null default now()
);

create function sellerpilot_private.worker_token_has_scope(
  p_token_hash text,
  p_scope text,
  p_require_active boolean default true
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.scope = p_scope
       and (not p_require_active or (
         token.status = 'active' and token.expires_at > now()
       ))
  )
$$;
create function public.sellerpilot_claim_channel_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
as $$
begin
  if not sellerpilot_private.worker_token_has_scope(
    p_token_hash, 'gateway', true
  ) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  return null;
end;
$$;
create function public.sellerpilot_touch_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_worker_version text default null
)
returns text
language plpgsql
security definer
as $$
begin
  update sellerpilot_private.channel_gateway_jobs job
     set lease_expires_at = now() + interval '15 minutes'
    from sellerpilot_private.ai_cli_worker_tokens token
   where job.id = p_job_id
     and job.worker_token_id = token.id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > now()
     and token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > now();
  if found then return 'running'; end if;
  return 'ownership_lost';
end;
$$;
create function public.sellerpilot_service_begin_gateway_credential_refresh(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = job.worker_token_id
     where job.id = p_job_id
       and job.claim_token = p_claim_token
       and job.status = 'running'
       and job.lease_expires_at > now()
       and job.channel = 'ebay'
       and token.token_hash = p_token_hash
       and token.status = 'active'
       and token.expires_at > now()
  )
$$;
create function public.sellerpilot_service_prepare_gateway_credential_refresh(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_recovery_only boolean default false,
  p_oauth_complete boolean default false
)
returns jsonb
language sql
security definer
as $$
  select case
    when public.sellerpilot_service_begin_gateway_credential_refresh(
      p_token_hash, p_job_id, p_claim_token
    ) then jsonb_build_object('status', 'prepared', 'credential_id', (
      select credential_id from sellerpilot_private.channel_gateway_jobs
       where id = p_job_id
    ))
    else null
  end
$$;
create function public.sellerpilot_service_gateway_completion_context(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare v_result jsonb;
begin
  if p_job_id is null
     or p_claim_token is null
     or not sellerpilot_private.worker_token_has_scope(
       p_token_hash,
       'gateway',
       true
     ) then
    return null;
  end if;
  select jsonb_build_object(
    'id', job.id, 'channel', job.channel, 'operation', job.operation,
    'status', job.status, 'normalization_timestamp', job.created_at
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = job.worker_token_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and worker_token.token_hash = p_token_hash
     and worker_token.scope in ('gateway', 'legacy_combined')
     and worker_token.status = 'active'
     and worker_token.expires_at > now();
  return v_result;
end;
$$;
create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
as $$
declare v_token_id uuid;
begin
  if p_job_id is null
     or p_claim_token is null
     or not sellerpilot_private.worker_token_has_scope(
       p_token_hash,
       'gateway',
       true
     ) then
    return jsonb_build_object('status', 'ownership_lost');
  end if;
  select worker_token.id into v_token_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = job.worker_token_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and worker_token.token_hash = p_token_hash
     and worker_token.scope in ('gateway', 'legacy_combined')
     and worker_token.status = 'active'
     and worker_token.expires_at > now()
   for update of job;
  if v_token_id is null then
    return jsonb_build_object('status', 'ownership_lost');
  end if;
  insert into sellerpilot_private.gateway_completion_receipts (
    job_id, claim_token, worker_token_id
  ) values (p_job_id, p_claim_token, v_token_id);
  update sellerpilot_private.channel_gateway_jobs
     set status = p_status,
         response_payload = p_response_payload,
         error_message = p_error_message,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = now()
   where id = p_job_id;
  return jsonb_build_object('status', 'completed');
end;
$$;

create schema extensions;
create schema net;
create table net.http_request_queue (
  id bigint generated always as identity primary key,
  url text not null,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds integer
);
create table net._http_response (
  id bigint primary key,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz not null default now()
);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb,
  timeout_milliseconds integer default 1000
)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into net.http_request_queue (
    url, body, params, headers, timeout_milliseconds
  ) values ($1, $2, $3, $4, $5)
  returning id into v_id;
  return v_id;
end;
$$;

create schema cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create table cron.job_run_details (
  runid bigint generated always as identity primary key,
  jobid bigint not null,
  end_time timestamptz
);
create function cron.schedule(
  job_name text,
  job_schedule text,
  job_command text
)
returns bigint
language plpgsql
as $$
declare v_job_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values ($1, $2, $3)
  on conflict (jobname) do update
    set schedule = excluded.schedule,
        command = excluded.command
  returning jobid into v_job_id;
  return v_job_id;
end;
$$;
create function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
)
returns void
language sql
as $$
  update cron.job
     set schedule = coalesce($2, cron.job.schedule),
         command = coalesce($3, cron.job.command),
         active = coalesce($6, cron.job.active)
   where jobid = $1
$$;
`;

function stripUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

test("serverless CS bootstrap, filtered claim, and paused pg_net wake remain secret-safe", async () => {
  const db = new PGlite();
  try {
    await db.exec(compatibilitySql);
    await db.query("insert into auth.users (id) values ($1)", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Serverless Test Admin')",
      [ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values
       ('AI remains untouched', $1, 'AAAAAAAAAAAA', 'active', 'ai', now() + interval '30 days', $3),
       ('Legacy remains untouched', $2, 'BBBBBBBBBBBB', 'active', 'legacy_combined', now() + interval '30 days', $3),
       ('Gateway remains untouched', $4, 'FFFFFFFFFFFF', 'active', 'gateway', now() + interval '30 days', $3),
       ('Scheduler remains untouched', $5, '111111111111', 'active', 'scheduler', now() + interval '30 days', $3)`,
      [AI_HASH, LEGACY_HASH, ADMIN_ID, PERSISTENT_GATEWAY_HASH, PERSISTENT_SCHEDULER_HASH],
    );

    const claimMigration = await readFile(
      new URL("../supabase/migrations/20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql", import.meta.url),
      "utf8",
    );
    await db.exec(claimMigration);
    const qoo10ExtensionMigration = await readFile(
      new URL("../supabase/migrations/20260828145950_extend_serverless_cs_qoo10_inquiries.sql", import.meta.url),
      "utf8",
    );
    await db.exec(qoo10ExtensionMigration);

    const bootstrap = await scalar(
      db,
      `select public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
        $1, 'CCCCCCCCCCCC', $2, 'DDDDDDDDDDDD', $3
      )`,
      [GATEWAY_HASH, SCHEDULER_HASH, WAKE_SECRET],
    );
    assert.deepEqual(Object.keys(bootstrap).sort(), ["configured", "fingerprints", "version"]);
    assert.deepEqual(bootstrap.fingerprints, {
      gateway: "CCCCCCCCCCCC",
      scheduler: "DDDDDDDDDDDD",
    });
    assert.equal(bootstrap.configured, true);

    assert.deepEqual(
      (await db.query(
        `select scope, status, token_hash, fingerprint,
                expires_at > now() + interval '364 days' as renewed
           from sellerpilot_private.ai_cli_worker_tokens
          order by scope`,
      )).rows,
      [
        { scope: "ai", status: "active", token_hash: AI_HASH, fingerprint: "AAAAAAAAAAAA", renewed: false },
        { scope: "gateway", status: "active", token_hash: PERSISTENT_GATEWAY_HASH, fingerprint: "FFFFFFFFFFFF", renewed: false },
        { scope: "legacy_combined", status: "active", token_hash: LEGACY_HASH, fingerprint: "BBBBBBBBBBBB", renewed: false },
        { scope: "scheduler", status: "active", token_hash: PERSISTENT_SCHEDULER_HASH, fingerprint: "111111111111", renewed: false },
        { scope: "serverless_cs", status: "active", token_hash: GATEWAY_HASH, fingerprint: "CCCCCCCCCCCC", renewed: true },
        { scope: "serverless_cs_scheduler", status: "active", token_hash: SCHEDULER_HASH, fingerprint: "DDDDDDDDDDDD", renewed: true },
      ],
    );
    assert.deepEqual(
      (await db.query(
        "select name, secret from vault.secrets where name = 'sellerpilot_serverless_cs_wake_v1'",
      )).rows,
      [{ name: "sellerpilot_serverless_cs_wake_v1", secret: WAKE_SECRET }],
    );

    await scalar(
      db,
      `select public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
        $1, 'CCCCCCCCCCCC', $2, 'DDDDDDDDDDDD', $3
      )`,
      [GATEWAY_HASH, SCHEDULER_HASH, WAKE_SECRET],
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.ai_cli_worker_tokens where scope in ('serverless_cs', 'serverless_cs_scheduler')",
      ),
      2,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.ai_cli_audit where action = 'token_issued' and safe_detail->>'reason' = 'serverless_runtime_bootstrap_or_renewal'",
      ),
      4,
    );

    const credentials = {};
    for (const channel of ["elevenst", "ebay", "coupang", "smartstore", "qoo10"]) {
      const vaultId = await scalar(
        db,
        "select vault.create_secret($1, $2, 'test credential')",
        [JSON.stringify({ channel, apiKey: `safe-${channel}` }), `credential-${channel}`],
      );
      credentials[channel] = await scalar(
        db,
        `insert into sellerpilot_private.channel_credentials (
           channel, environment, vault_secret_id, status, seller_account_key,
           seller_account_key_source, seller_account_verified_at
         ) values ($1, 'production', $2, 'active', $3,
           case when $1 = 'ebay' then 'provider_certified_v1' else 'credential_incarnation_v1' end,
           now()) returning id`,
        [channel, vaultId, SELLER_KEY],
      );
    }

    const elevenstJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, seller_account_key,
         created_at
       ) values ($1, 'elevenst', 'inquiries.list', 'production', $2, now() - interval '10 minutes')
       returning id`,
      [credentials.elevenst, SELLER_KEY],
    );
    const ebayJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, seller_account_key,
         created_at
       ) values ($1, 'ebay', 'inquiries.list', 'production', $2, now() - interval '5 minutes')
       returning id`,
      [credentials.ebay, SELLER_KEY],
    );
    const coupangJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, seller_account_key,
         request_payload, created_at
       ) values ($1, 'coupang', 'inquiries.reply', 'production', $2,
         '{"sellerpilotTicketId":"22222222-2222-4222-8222-222222222222"}'::jsonb,
         now() - interval '4 minutes') returning id`,
      [credentials.coupang, SELLER_KEY],
    );
    const qoo10ListJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, seller_account_key,
         request_payload, created_at
       ) values ($1, 'qoo10', 'inquiries.list', 'production', $2,
         '{"arguments":{"params":{"search_start_dt":"20260822","search_end_dt":"20260828","proc_status":"S1"}}}'::jsonb,
         now() - interval '3 minutes') returning id`,
      [credentials.qoo10, SELLER_KEY],
    );
    const qoo10ReplyJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, seller_account_key,
         request_payload, created_at
       ) values ($1, 'qoo10', 'inquiries.reply', 'production', $2,
         '{"sellerpilotTicketId":"44444444-4444-4444-8444-444444444444","arguments":{"params":{"inq_type":"MSG","question_no":"12345678","seq_no":"87654321","contents":"bounded test reply"}}}'::jsonb,
         now() - interval '2 minutes') returning id`,
      [credentials.qoo10, SELLER_KEY],
    );
    const gatewayTokenId = await scalar(
      db,
      "select id from sellerpilot_private.ai_cli_worker_tokens where token_hash = $1",
      [GATEWAY_HASH],
    );
    const expiredReplyJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, seller_account_key,
         request_payload, status, worker_token_id, claim_token, attempt_count,
         lease_expires_at, started_at, provider_mutation_started_at
       ) values ($1, 'smartstore', 'inquiries.reply', 'production', $2,
         '{"sellerpilotTicketId":"33333333-3333-4333-8333-333333333333"}'::jsonb,
         'running', $3, gen_random_uuid(), 1, now() - interval '1 minute',
         now() - interval '16 minutes', now() - interval '15 minutes') returning id`,
      [credentials.smartstore, SELLER_KEY, gatewayTokenId],
    );

    await assert.rejects(
      scalar(db, "select public.sellerpilot_claim_serverless_cs_job($1, 'test/wrong-scope')", [AI_HASH]),
      /invalid worker token/,
    );
    await assert.rejects(
      scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'test/generic-must-reject')", [GATEWAY_HASH]),
      /invalid worker token/,
    );
    const ebayClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_cs_job($1, 'test/serverless-cs')",
      [GATEWAY_HASH],
    );
    assert.equal(ebayClaim.id, ebayJobId);
    assert.equal(ebayClaim.channel, "ebay");
    assert.equal(ebayClaim.operation, "inquiries.list");
    assert.match(ebayClaim.claim_token, /^[0-9a-f-]{36}$/);
    assert.deepEqual(ebayClaim.credential, { channel: "ebay", apiKey: "safe-ebay" });
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_serverless_cs_job($1, $2, $3, 'test/touch')",
        [GATEWAY_HASH, ebayClaim.id, ebayClaim.claim_token],
      ),
      "running",
    );
    const completionContext = await scalar(
      db,
      "select public.sellerpilot_service_serverless_cs_completion_context($1, $2, $3)",
      [GATEWAY_HASH, ebayClaim.id, ebayClaim.claim_token],
    );
    assert.equal(completionContext.channel, "ebay");
    assert.equal(completionContext.operation, "inquiries.list");
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id = $1", [expiredReplyJobId]),
      "reconciliation_required",
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id = $1", [elevenstJobId]),
      "queued",
    );

    assert.equal(
      (await scalar(
        db,
        `select public.sellerpilot_service_complete_serverless_cs_transaction(
          $1, $2, $3, 'failed', null, 'bounded test failure',
          null, null, null, null
        )`,
        [GATEWAY_HASH, ebayJobId, ebayClaim.claim_token],
      )).status,
      "completed",
    );
    const aliasClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ebay_asq_serverless_job($1, 'test/compat-alias')",
      [GATEWAY_HASH],
    );
    assert.equal(aliasClaim.id, coupangJobId);
    assert.equal(aliasClaim.channel, "coupang");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_serverless_cs_provider_mutation($1, $2, $3)",
        [GATEWAY_HASH, aliasClaim.id, aliasClaim.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select provider_mutation_started_at is not null from sellerpilot_private.channel_gateway_jobs where id = $1",
        [aliasClaim.id],
      ),
      true,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where status = 'running'"),
      1,
    );

    const qoo10ListClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_cs_job($1, 'test/qoo10-list')",
      [GATEWAY_HASH],
    );
    assert.equal(qoo10ListClaim.id, qoo10ListJobId);
    assert.equal(qoo10ListClaim.channel, "qoo10");
    assert.equal(qoo10ListClaim.operation, "inquiries.list");
    assert.deepEqual(qoo10ListClaim.request.arguments.params, {
      proc_status: "S1",
      search_end_dt: "20260828",
      search_start_dt: "20260822",
    });
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_cs_job($1, 'test/qoo10-same-channel-fence')",
        [GATEWAY_HASH],
      ),
      null,
    );
    assert.equal(
      (await scalar(
        db,
        `select public.sellerpilot_service_complete_serverless_cs_transaction(
          $1, $2, $3, 'failed', null, 'bounded qoo10 read test failure',
          null, null, null, null
        )`,
        [GATEWAY_HASH, qoo10ListJobId, qoo10ListClaim.claim_token],
      )).status,
      "completed",
    );

    const qoo10ReplyClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_cs_job($1, 'test/qoo10-reply')",
      [GATEWAY_HASH],
    );
    assert.equal(qoo10ReplyClaim.id, qoo10ReplyJobId);
    assert.equal(qoo10ReplyClaim.channel, "qoo10");
    assert.equal(qoo10ReplyClaim.operation, "inquiries.reply");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_serverless_cs_provider_mutation($1, $2, $3)",
        [GATEWAY_HASH, qoo10ReplyClaim.id, qoo10ReplyClaim.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select provider_mutation_started_at is not null from sellerpilot_private.channel_gateway_jobs where id = $1",
        [qoo10ReplyClaim.id],
      ),
      true,
    );

    const scheduleMigration = stripUnavailableExtensions(await readFile(
      new URL("../supabase/migrations/20260828145700_schedule_serverless_cs_wakeup.sql", import.meta.url),
      "utf8",
    ));
    await db.exec(scheduleMigration);
    const cronJob = (await db.query(
      "select schedule, command, active from cron.job where jobname = 'sellerpilot-serverless-cs-wake-v1'",
    )).rows[0];
    assert.deepEqual(cronJob, {
      schedule: "* * * * *",
      command: "select sellerpilot_private.schedule_serverless_cs_wakeup();",
      active: false,
    });
    assert.doesNotMatch(cronJob.command, /bearer|authorization|w{8}/i);
    assert.equal(
      await scalar(db, "select has_schema_privilege('service_role', 'net', 'USAGE')"),
      false,
    );
    assert.equal(
      await scalar(db, "select has_schema_privilege('authenticated', 'cron', 'USAGE')"),
      false,
    );

    const firstWakeId = await scalar(
      db,
      "select sellerpilot_private.schedule_serverless_cs_wakeup()",
    );
    assert.equal(firstWakeId, 1);
    assert.equal(
      await scalar(db, "select sellerpilot_private.schedule_serverless_cs_wakeup()"),
      null,
    );
    assert.deepEqual(
      (await db.query(
        "select url, headers->>'Authorization' as authorization, timeout_milliseconds from net.http_request_queue where id = $1",
        [firstWakeId],
      )).rows,
      [{
        url: "https://sellerpilot-global.vercel.app/api/internal/channel-gateway-drain",
        authorization: `Bearer ${WAKE_SECRET}`,
        timeout_milliseconds: 240000,
      }],
    );

    await db.query(
      "insert into net._http_response (id, status_code, timed_out) values ($1, 200, false)",
      [firstWakeId],
    );
    const secondWakeId = await scalar(
      db,
      "select sellerpilot_private.schedule_serverless_cs_wakeup()",
    );
    assert.equal(secondWakeId, 2);
    assert.equal(
      await scalar(db, "select outcome from sellerpilot_private.serverless_cs_wake_requests where request_id = $1", [firstWakeId]),
      "delivered",
    );

    await db.query(
      "insert into net._http_response (id, status_code, timed_out) values ($1, 401, false)",
      [secondWakeId],
    );
    assert.equal(
      await scalar(db, "select sellerpilot_private.schedule_serverless_cs_wakeup()"),
      null,
    );
    assert.deepEqual(
      (await db.query(
        `select outcome, http_status, safe_error_code
           from sellerpilot_private.serverless_cs_wake_requests
          where request_id = $1`,
        [secondWakeId],
      )).rows,
      [{ outcome: "permanent_failure", http_status: 401, safe_error_code: "wake_auth_rejected" }],
    );
    assert.equal(
      await scalar(db, "select active from cron.job where jobname = 'sellerpilot-serverless-cs-wake-v1'"),
      false,
    );

    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_set_serverless_cs_wakeup_active(true)",
      )).active,
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select outcome from sellerpilot_private.serverless_cs_wake_requests where request_id = $1",
        [secondWakeId],
      ),
      "permanent_failure_acknowledged",
    );
    assert.equal(
      await scalar(db, "select sellerpilot_private.schedule_serverless_cs_wakeup()"),
      3,
    );
    assert.equal(
      (await scalar(db, "select public.sellerpilot_service_serverless_cs_wakeup_status()" )).active,
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_claim_serverless_cs_job(text,text)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_service_set_serverless_cs_wakeup_active(boolean)', 'EXECUTE')",
      ),
      false,
    );

    await db.query(
      "insert into net._http_response (id, status_code, timed_out) values (3, 200, false)",
    );
    await db.query(
      "delete from vault.secrets where name = 'sellerpilot_serverless_cs_wake_v1'",
    );
    assert.equal(
      await scalar(db, "select sellerpilot_private.schedule_serverless_cs_wakeup()"),
      null,
    );
    assert.equal(
      await scalar(db, "select active from cron.job where jobname = 'sellerpilot-serverless-cs-wake-v1'"),
      false,
    );
  } finally {
    await db.close();
  }
});
