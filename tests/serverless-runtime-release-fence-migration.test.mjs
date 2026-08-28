import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828210000_non_cs_release_integrity.sql",
  import.meta.url,
);

const LEGACY_HASH = "a".repeat(64);
const AI_HASH = "b".repeat(64);
const GATEWAY_HASH = "c".repeat(64);
const SCHEDULER_HASH = "d".repeat(64);

function strictWorkerScopeFence(migration) {
  const start = migration.indexOf("-- BEGIN:strict-worker-scope-final-fence");
  const end = migration.indexOf("-- END:strict-worker-scope-final-fence", start);
  assert.ok(start >= 0 && end > start, "strict worker-scope fence must be present");
  return migration.slice(start, end + "-- END:strict-worker-scope-final-fence".length);
}

async function scalar(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

async function createStrictScopeDb() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

    create schema sellerpilot_private;
    create schema vault;

    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key default gen_random_uuid(),
      token_hash text not null unique,
      status text not null check (status in ('pending', 'active', 'revoked')),
      scope text not null,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      last_seen_at timestamptz,
      last_version text
    );
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key default gen_random_uuid(),
      kind text not null default 'product_studio',
      status text not null,
      error_message text,
      worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
      claim_token uuid,
      lease_expires_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.ai_cli_audit (
      action text not null,
      worker_token_id uuid,
      job_id uuid,
      safe_detail jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key default gen_random_uuid(),
      status text not null,
      http_status integer,
      safe_message text,
      completed_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null,
      attempt_id uuid,
      channel text not null,
      operation text not null,
      attempt_count integer not null default 0 check (attempt_count between 0 and 6),
      status text not null check (status in (
        'queued', 'running', 'succeeded', 'failed', 'cancelled',
        'reconciliation_required'
      )),
      worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
      claim_token uuid,
      lease_expires_at timestamptz,
      completed_at timestamptz,
      error_message text,
      response_payload jsonb,
      oauth_request_vault_id uuid,
      oauth_exchange_completed boolean not null default false,
      credential_refresh_in_flight boolean not null default false,
      prepared_credential_id uuid,
      credential_refresh_recovery_vault_id uuid,
      provider_mutation_started_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.product_listings (
      operation_attempt_id uuid,
      status text,
      last_error text,
      failure_class text,
      updated_at timestamptz
    );
    create table vault.secrets (
      id uuid primary key default gen_random_uuid(),
      secret text not null
    );

    create function sellerpilot_private.gateway_job_requires_reconciliation(
      p_operation text,
      p_credential_refresh_in_flight boolean,
      p_prepared_credential_id uuid,
      p_credential_refresh_recovery_vault_id uuid,
      p_oauth_exchange_completed boolean,
      p_provider_mutation_started_at timestamptz
    )
    returns boolean
    language sql
    immutable
    as $$
      select coalesce(p_credential_refresh_in_flight, false)
        or p_credential_refresh_recovery_vault_id is not null
        or p_provider_mutation_started_at is not null
        or (
          p_operation = 'oauth.exchange'
          and p_prepared_credential_id is not null
          and not coalesce(p_oauth_exchange_completed, false)
        )
        or p_operation in (
          'listing.create', 'listing.update', 'listing.stop',
          'price.update', 'inventory.update', 'inquiries.reply',
          'shipment.acknowledge', 'shipment.confirm'
        )
    $$;

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
        select 1
          from sellerpilot_private.ai_cli_worker_tokens token
         where token.token_hash = p_token_hash
           and token.scope in (p_scope, 'legacy_combined')
           and (
             not p_require_active
             or (token.status = 'active' and token.expires_at > clock_timestamp())
           )
      )
    $$;

    create function public.sellerpilot_service_mark_channel_sync(
      p_credential_id uuid,
      p_channel text,
      p_data_type text,
      p_status text,
      p_error text default null
    )
    returns boolean
    language sql
    as $$ select true $$;
  `);
  return db;
}

test("durable mutation markers share one fail-closed recovery and activation predicate", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const helperStart = migration.indexOf(
    "create or replace function sellerpilot_private.gateway_job_requires_reconciliation",
  );
  const helperEnd = migration.indexOf(
    "revoke all on function sellerpilot_private.gateway_job_requires_reconciliation",
    helperStart,
  );
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = migration.slice(helperStart, helperEnd);
  assert.match(helper, /coalesce\(p_credential_refresh_in_flight, false\)/);
  assert.match(helper, /p_credential_refresh_recovery_vault_id is not null/);
  assert.match(helper, /p_provider_mutation_started_at is not null/);
  assert.match(helper, /p_prepared_credential_id is not null[\s\S]*p_oauth_exchange_completed/);

  const reaper = migration.slice(
    migration.indexOf("-- BEGIN:stale-channel-gateway-reaper"),
    migration.indexOf("-- END:stale-channel-gateway-reaper"),
  );
  const activation = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_service_activate_serverless_runtime"),
    migration.indexOf("create or replace function public.sellerpilot_service_serverless_cs_wakeup_status"),
  );
  const status = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_service_serverless_cs_wakeup_status"),
    migration.indexOf("revoke all on function sellerpilot_private.set_serverless_runtime_schedules_active"),
  );
  assert.match(reaper, /gateway_job_requires_reconciliation\(/);
  assert.match(activation, /job\.status in \('queued', 'running'\)[\s\S]*gateway_job_requires_reconciliation\(/);
  assert.ok((status.match(/gateway_job_requires_reconciliation\(/g) ?? []).length >= 2);

  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private;");
    await db.exec(helper);
    const risky = async (values) => {
      const result = await db.query(
        `select sellerpilot_private.gateway_job_requires_reconciliation(
          $1::text, $2::boolean, $3::uuid, $4::uuid, $5::boolean, $6::timestamptz
        ) as risky`,
        values,
      );
      return result.rows[0].risky;
    };
    assert.equal(await risky(["orders.list", false, null, null, false, null]), false);
    assert.equal(await risky(["orders.list", true, null, null, false, null]), true);
    assert.equal(await risky([
      "orders.list",
      false,
      null,
      "11111111-1111-4111-8111-111111111111",
      false,
      null,
    ]), true);
    assert.equal(await risky([
      "orders.list",
      false,
      null,
      null,
      false,
      "2026-08-29T00:00:00Z",
    ]), true);
    assert.equal(await risky(["inventory.update", false, null, null, false, null]), true);
  } finally {
    await db.close();
  }
});

test("final migration installs an exact scope boundary without the earlier retirement migration", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const fence = strictWorkerScopeFence(migration);
  const gatewayCompletionScope = migration.slice(
    migration.indexOf(
      "create or replace function sellerpilot_private.worker_token_may_complete_gateway_job",
    ),
    migration.indexOf(
      "revoke all on function sellerpilot_private.worker_token_may_complete_gateway_job",
    ),
  );
  const productClaim = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_claim_product_ai_job"),
    migration.indexOf(
      "revoke all on function\n  public.sellerpilot_claim_product_ai_job",
    ),
  );

  const tokenRotationLock = fence.indexOf("pg_advisory_xact_lock(193674993, 821065043)");
  const tokenTableLock = fence.indexOf(
    "lock table sellerpilot_private.ai_cli_worker_tokens in access exclusive mode",
  );
  const leaseTransition = fence.indexOf("for v_ai_job in");
  const tokenRevocation = fence.indexOf("with revoked as");
  const strictConstraint = fence.indexOf(
    "ai_cli_worker_tokens_no_active_legacy_combined_check",
  );
  const exactHelper = fence.indexOf(
    "create or replace function sellerpilot_private.worker_token_has_scope",
  );
  assert.ok(tokenRotationLock >= 0);
  assert.doesNotMatch(fence, /821065042/);
  assert.ok(tokenTableLock > tokenRotationLock);
  assert.ok(leaseTransition > tokenTableLock);
  assert.ok(tokenRevocation > leaseTransition);
  assert.ok(strictConstraint > tokenRevocation);
  assert.ok(exactHelper > strictConstraint);

  assert.match(fence, /job\.status = 'running'[\s\S]*set status = 'failed'/);
  assert.match(fence, /v_status := 'reconciliation_required'/);
  assert.match(fence, /v_status := 'queued'/);
  assert.match(fence, /v_status := 'succeeded'/);
  assert.match(fence, /v_gateway_job\.attempt_count >= 4[\s\S]*v_status := 'failed'/);
  assert.match(
    fence,
    /check \(scope <> 'legacy_combined' or status <> 'active'\) not valid/,
  );
  const helper = fence.slice(exactHelper, fence.indexOf(
    "revoke all on function sellerpilot_private.worker_token_has_scope",
    exactHelper,
  ));
  assert.match(helper, /token\.scope = p_scope/);
  assert.doesNotMatch(helper, /token\.scope\s+in\s*\([^)]*legacy_combined/);
  assert.match(gatewayCompletionScope, /token\.scope = 'gateway'/);
  assert.doesNotMatch(gatewayCompletionScope, /legacy_combined/);
  assert.match(productClaim, /token\.scope = 'ai'/);
  assert.doesNotMatch(productClaim, /legacy_combined/);
  assert.match(fence, /token\.scope = 'scheduler'/);
});

test("strict final fence preserves the observed queued-only runtime while retiring legacy auth", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await createStrictScopeDb();
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         token_hash, status, scope, expires_at
       ) values
         ($1, 'active', 'legacy_combined', clock_timestamp() + interval '1 day'),
         ($2, 'active', 'serverless_cs', clock_timestamp() + interval '1 day'),
         ($3, 'active', 'serverless_cs_scheduler', clock_timestamp() + interval '1 day')`,
      [LEGACY_HASH, "e".repeat(64), "f".repeat(64)],
    );
    for (let index = 0; index < 17; index += 1) {
      await db.query(
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, channel, operation, status
         ) values ($1, 'qoo10', 'orders.list', 'queued')`,
        [`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`],
      );
    }

    await db.exec(strictWorkerScopeFence(migration));

    assert.deepEqual(
      (await db.query(
        `select scope, status
           from sellerpilot_private.ai_cli_worker_tokens
          order by scope`,
      )).rows,
      [
        { scope: "legacy_combined", status: "revoked" },
        { scope: "serverless_cs", status: "active" },
        { scope: "serverless_cs_scheduler", status: "active" },
      ],
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where status = 'queued'",
      ),
      17,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where status <> 'queued'",
      ),
      0,
    );
  } finally {
    await db.close();
  }
});

test("strict final fence terminalizes live legacy leases without aborting", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await createStrictScopeDb();
  const legacyTokenId = "10000000-0000-4000-8000-000000000001";
  const aiTokenId = "20000000-0000-4000-8000-000000000001";
  const gatewayTokenId = "30000000-0000-4000-8000-000000000001";
  const schedulerTokenId = "40000000-0000-4000-8000-000000000001";
  const aiJobId = "50000000-0000-4000-8000-000000000001";
  const readJobId = "60000000-0000-4000-8000-000000000001";
  const writeJobId = "70000000-0000-4000-8000-000000000001";
  const oauthJobId = "80000000-0000-4000-8000-000000000001";
  const attemptId = "90000000-0000-4000-8000-000000000001";
  const maxReadJobId = "65000000-0000-4000-8000-000000000001";
  const maxAttemptId = "95000000-0000-4000-8000-000000000001";
  try {
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         id, token_hash, status, scope, expires_at
       ) values
         ($1, $2, 'active', 'legacy_combined', clock_timestamp() + interval '1 day'),
         ($3, $4, 'active', 'ai', clock_timestamp() + interval '1 day'),
         ($5, $6, 'active', 'gateway', clock_timestamp() + interval '1 day'),
         ($7, $8, 'active', 'scheduler', clock_timestamp() + interval '1 day')`,
      [
        legacyTokenId, LEGACY_HASH,
        aiTokenId, AI_HASH,
        gatewayTokenId, GATEWAY_HASH,
        schedulerTokenId, SCHEDULER_HASH,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, status, worker_token_id, claim_token, lease_expires_at
       ) values ($1, 'running', $2, $3, clock_timestamp() + interval '15 minutes')`,
      [aiJobId, legacyTokenId, "51000000-0000-4000-8000-000000000001"],
    );
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts (id, status)
       values ($1, 'running'), ($2, 'running')`,
      [attemptId, maxAttemptId],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         operation_attempt_id, status, updated_at
       ) values ($1, 'queued', clock_timestamp())`,
      [attemptId],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, attempt_id, channel, operation, status,
         worker_token_id, claim_token, lease_expires_at, attempt_count,
         oauth_exchange_completed, credential_refresh_in_flight
       ) values
         ($1, $2, null, 'qoo10', 'orders.list', 'running', $3, $4,
          clock_timestamp() + interval '15 minutes', 1, false, false),
         ($5, $6, $7, 'qoo10', 'listing.create', 'running', $3, $8,
          clock_timestamp() + interval '15 minutes', 1, false, false),
         ($9, $10, null, 'ebay', 'oauth.exchange', 'running', $3, $11,
          clock_timestamp() + interval '15 minutes', 1, true, false),
         ($12, $13, $14, 'qoo10', 'orders.list', 'running', $3, $15,
          clock_timestamp() + interval '15 minutes', 4, false, false)`,
      [
        readJobId, "61000000-0000-4000-8000-000000000001",
        legacyTokenId, "62000000-0000-4000-8000-000000000001",
        writeJobId, "71000000-0000-4000-8000-000000000001", attemptId,
        "72000000-0000-4000-8000-000000000001",
        oauthJobId, "81000000-0000-4000-8000-000000000001",
        "82000000-0000-4000-8000-000000000001",
        maxReadJobId, "66000000-0000-4000-8000-000000000001", maxAttemptId,
        "67000000-0000-4000-8000-000000000001",
      ],
    );

    await db.exec(strictWorkerScopeFence(migration));

    assert.deepEqual(
      (await db.query(
        `select status, worker_token_id, claim_token, lease_expires_at
           from sellerpilot_private.ai_cli_jobs
          where id = $1`,
        [aiJobId],
      )).rows,
      [{ status: "failed", worker_token_id: null, claim_token: null, lease_expires_at: null }],
    );
    assert.deepEqual(
      (await db.query(
        `select id::text as id, status, worker_token_id, claim_token, lease_expires_at
           from sellerpilot_private.channel_gateway_jobs
          order by id`,
      )).rows,
      [
        { id: readJobId, status: "queued", worker_token_id: null, claim_token: null, lease_expires_at: null },
        { id: maxReadJobId, status: "failed", worker_token_id: null, claim_token: null, lease_expires_at: null },
        { id: writeJobId, status: "reconciliation_required", worker_token_id: null, claim_token: null, lease_expires_at: null },
        { id: oauthJobId, status: "succeeded", worker_token_id: null, claim_token: null, lease_expires_at: null },
      ],
    );
    assert.deepEqual(
      (await db.query(
        `select id::text as id, status, http_status
           from sellerpilot_private.channel_operation_attempts
          where id in ($1, $2)
          order by id`,
        [attemptId, maxAttemptId],
      )).rows,
      [
        { id: attemptId, status: "manual_required", http_status: 409 },
        { id: maxAttemptId, status: "failed", http_status: 503 },
      ],
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.ai_cli_worker_tokens where id = $1",
        [legacyTokenId],
      ),
      "revoked",
    );
    for (const [tokenHash, scope] of [
      [LEGACY_HASH, "ai"],
      [LEGACY_HASH, "gateway"],
      [LEGACY_HASH, "scheduler"],
    ]) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.worker_token_has_scope($1, $2, true)",
          [tokenHash, scope],
        ),
        false,
      );
    }
    for (const [tokenHash, scope] of [
      [AI_HASH, "ai"],
      [GATEWAY_HASH, "gateway"],
      [SCHEDULER_HASH, "scheduler"],
    ]) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.worker_token_has_scope($1, $2, true)",
          [tokenHash, scope],
        ),
        true,
      );
    }
    await db.exec(strictWorkerScopeFence(migration));
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_audit
          where safe_detail->>'reason' = 'legacy_combined_release_retirement'`,
      ),
      2,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where status = 'running'",
      ),
      0,
    );
    await assert.rejects(
      db.query(
        "update sellerpilot_private.ai_cli_worker_tokens set status = 'active' where id = $1",
        [legacyTokenId],
      ),
      /ai_cli_worker_tokens_no_active_legacy_combined_check/,
    );
    await db.exec("rollback").catch(() => undefined);
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_audit
          where safe_detail->>'reason' = 'legacy_combined_release_retirement'`,
      ),
      2,
    );
  } finally {
    await db.close();
  }
});
