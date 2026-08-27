import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828004000_persist_terminal_image_failure_context.sql",
  import.meta.url,
);
const TOKEN_HASH = "a".repeat(64);
const TOKEN_ID = "10000000-0000-4000-8000-000000000001";
const STUDIO_JOB_ID = "20000000-0000-4000-8000-000000000001";
const RESEARCH_JOB_ID = "20000000-0000-4000-8000-000000000002";
const LEGACY_RECEIPT_JOB_ID = "20000000-0000-4000-8000-000000000003";
const LEGACY_RECEIPT_CLAIM = "30000000-0000-4000-8000-000000000003";
const ATOMIC_ROLLBACK_JOB_ID = "20000000-0000-4000-8000-000000000004";
const ATOMIC_CURRENT_CLAIM = "30000000-0000-4000-8000-000000000004";
const ATOMIC_OLD_CLAIM = "30000000-0000-4000-8000-000000000005";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

function failureContext({ generation = 1, digest = "b".repeat(64) } = {}) {
  return {
    version: 1,
    generation,
    entries: [{
      role: "detail-context",
      width: 1200,
      height: 1500,
      failureDimensions: ["overall-layout", "camera"],
      semanticSignature: {
        locationKeys: ["breakfast-table"],
        momentKeys: ["morning-light"],
        surfaceKeys: ["oak-surface"],
        cameraKeys: ["eye-level"],
        paletteKeys: ["warm-neutral"],
        spatialDepthKeys: ["foreground-bowl"],
        cueKeys: ["linen-napkin"],
      },
      rejectedAssetLineage: {
        attempt: 4,
        digest,
        topologySignature: "c".repeat(64),
        conflictingAssetIds: ["previous:detail-context"],
      },
    }],
  };
}

const fixtureSql = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
create schema extensions;
create schema sellerpilot_private;
create or replace function extensions.digest(value text, algorithm text)
returns bytea language sql immutable
as $$ select convert_to(md5(value || algorithm), 'UTF8') $$;

create table sellerpilot_private.ai_cli_worker_tokens (
  id uuid primary key,
  token_hash text not null unique,
  scope text not null,
  status text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  last_version text
);
create table sellerpilot_private.ai_cli_jobs (
  id uuid primary key,
  kind text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  status text not null default 'queued',
  error_message text,
  created_by uuid,
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  preparation_failure_count integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
create table sellerpilot_private.ai_job_completion_receipts (
  job_id uuid primary key references sellerpilot_private.ai_cli_jobs(id) on delete cascade,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id),
  claim_token uuid not null,
  status text not null,
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  unique (job_id, claim_token)
);

create or replace function sellerpilot_private.worker_token_has_scope(
  p_token_hash text,
  p_scope text,
  p_allow_legacy boolean default false
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and (token.scope = p_scope or (p_allow_legacy and token.scope = 'legacy_combined'))
  )
$$;
create or replace function sellerpilot_private.ai_completion_fingerprint(
  p_status text,
  p_result_payload jsonb,
  p_error_message text
)
returns text language sql immutable set search_path = ''
as $$
  select encode(extensions.digest(jsonb_build_object(
    'status', p_status,
    'result', case when p_status = 'succeeded' then p_result_payload else null end,
    'error', case when p_status = 'failed' then left(coalesce(p_error_message, 'CLI worker failed.'), 500) else null end
  )::text, 'sha256'), 'hex')
$$;

create or replace function public.sellerpilot_260826_claim_ai_job_unscoped(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job record;
  v_claim_token uuid := gen_random_uuid();
begin
  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then raise exception 'invalid worker token'; end if;
  select job.id, job.kind, job.request_payload into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.status = 'queued' and job.available_at <= clock_timestamp()
   order by job.available_at, job.id
   limit 1
   for update skip locked;
  if not found then return null; end if;
  update sellerpilot_private.ai_cli_jobs job
     set status = 'running', worker_token_id = v_token_id,
         claim_token = v_claim_token,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         attempt_count = job.attempt_count + 1,
         started_at = coalesce(job.started_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where job.id = v_job.id;
  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(), last_version = p_worker_version
   where token.id = v_token_id;
  return jsonb_build_object(
    'id', v_job.id,
    'kind', v_job.kind,
    'request', v_job.request_payload,
    'claim_token', v_claim_token
  );
end;
$$;
create or replace function public.sellerpilot_claim_ai_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb language sql security definer set search_path = ''
as $$ select public.sellerpilot_260826_claim_ai_job_unscoped(p_token_hash, p_worker_version) $$;

create or replace function public.sellerpilot_260826_complete_ai_job_once(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_result_payload jsonb default null,
  p_error_message text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_token_id uuid;
  v_updated integer;
begin
  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then raise exception 'invalid worker token'; end if;
  update sellerpilot_private.ai_cli_jobs job
     set status = p_status,
         result_payload = case when p_status = 'succeeded' then p_result_payload else null end,
         error_message = case when p_status = 'failed' then p_error_message else null end,
         claim_token = null, lease_expires_at = null,
         completed_at = clock_timestamp(), updated_at = clock_timestamp()
   where job.id = p_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_retry_ai_job(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_updated integer;
begin
  update sellerpilot_private.ai_cli_jobs job
     set status = 'queued', result_payload = null, error_message = null,
         worker_token_id = null, claim_token = null, lease_expires_at = null,
         available_at = clock_timestamp(), started_at = null,
         completed_at = null, updated_at = clock_timestamp()
   where job.id = p_id and job.status = 'failed';
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    delete from sellerpilot_private.ai_job_completion_receipts receipt where receipt.job_id = p_id;
  end if;
  return v_updated = 1;
end;
$$;
`;

test("terminal image failure context survives fenced same-ID retries and clears only on success", async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.query(
      "insert into sellerpilot_private.ai_cli_worker_tokens(id,token_hash,scope,status,expires_at) values ($1,$2,'ai','active',now()+interval '1 day')",
      [TOKEN_ID, TOKEN_HASH],
    );
    const oldNullContextFingerprint = await scalar(
      db,
      "select sellerpilot_private.ai_completion_fingerprint('failed',null,'legacy 1.53 failure')",
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.ai_completion_fingerprint_with_image_context('failed',null,'legacy 1.53 failure',null)",
      ),
      oldNullContextFingerprint,
      "a context-null 1.54 completion must retain the exact 1.53 receipt fingerprint",
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(
         id,kind,status,worker_token_id,completed_at
       ) values ($1,'product_research','failed',$2,now())`,
      [LEGACY_RECEIPT_JOB_ID, TOKEN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.ai_job_completion_receipts(
         job_id,worker_token_id,claim_token,status,completion_fingerprint
       ) values ($1,$2,$3,'failed',$4)`,
      [LEGACY_RECEIPT_JOB_ID, TOKEN_ID, LEGACY_RECEIPT_CLAIM, oldNullContextFingerprint],
    );
    await db.exec("set role service_role");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'legacy 1.53 failure',null)",
      [TOKEN_HASH, LEGACY_RECEIPT_JOB_ID, LEGACY_RECEIPT_CLAIM],
    ), true);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'changed legacy failure',null)",
      [TOKEN_HASH, LEGACY_RECEIPT_JOB_ID, LEGACY_RECEIPT_CLAIM],
    ), false);
    await db.exec("reset role");

    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(
         id,kind,status,worker_token_id,claim_token,lease_expires_at,started_at
       ) values ($1,'product_studio','running',$2,$3,now()+interval '15 minutes',now())`,
      [ATOMIC_ROLLBACK_JOB_ID, TOKEN_ID, ATOMIC_CURRENT_CLAIM],
    );
    await db.query(
      `insert into sellerpilot_private.ai_job_completion_receipts(
         job_id,worker_token_id,claim_token,status,completion_fingerprint
       ) values ($1,$2,$3,'failed',$4)`,
      [ATOMIC_ROLLBACK_JOB_ID, TOKEN_ID, ATOMIC_OLD_CLAIM, oldNullContextFingerprint],
    );
    await db.exec("set role service_role");
    await assert.rejects(
      db.query(
        "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'image quality rejected',$4::jsonb)",
        [TOKEN_HASH, ATOMIC_ROLLBACK_JOB_ID, ATOMIC_CURRENT_CLAIM, JSON.stringify(failureContext())],
      ),
      /duplicate key value|unique constraint/,
    );
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query(
        `select status,claim_token::text,terminal_image_failure_context
           from sellerpilot_private.ai_cli_jobs where id=$1`,
        [ATOMIC_ROLLBACK_JOB_ID],
      )).rows,
      [{
        status: "running",
        claim_token: ATOMIC_CURRENT_CLAIM,
        terminal_image_failure_context: null,
      }],
      "an error after the delegated completion must roll back status and context together",
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs(id,kind,available_at)
       values ($1,'product_studio',now()-interval '1 minute'),
              ($2,'product_research',now()+interval '1 hour')`,
      [STUDIO_JOB_ID, RESEARCH_JOB_ID],
    );

    await db.exec("set role service_role");
    const firstClaim = await scalar(db, "select public.sellerpilot_claim_ai_job($1, 'migration-test/1.54')", [TOKEN_HASH]);
    const context = failureContext();
    assert.equal(firstClaim.id, STUDIO_JOB_ID);
    assert.equal(firstClaim.terminal_image_failure_context, undefined);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'image quality rejected',$4::jsonb)",
      [TOKEN_HASH, STUDIO_JOB_ID, firstClaim.claim_token, JSON.stringify(context)],
    ), true);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'image quality rejected',$4::jsonb)",
      [TOKEN_HASH, STUDIO_JOB_ID, firstClaim.claim_token, JSON.stringify(context)],
    ), true, "an exact completion replay must be idempotent");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'image quality rejected',$4::jsonb)",
      [TOKEN_HASH, STUDIO_JOB_ID, firstClaim.claim_token, JSON.stringify(failureContext({ generation: 2 }))],
    ), false, "a changed structured context must not match the original receipt");
    await db.exec("reset role");

    assert.deepEqual(
      await scalar(db, "select terminal_image_failure_context from sellerpilot_private.ai_cli_jobs where id=$1", [STUDIO_JOB_ID]),
      context,
    );
    assert.equal(await scalar(db, "select public.sellerpilot_retry_ai_job($1)", [STUDIO_JOB_ID]), true);
    await db.exec("set role service_role");
    const secondClaim = await scalar(db, "select public.sellerpilot_claim_ai_job($1, 'migration-test/1.54')", [TOKEN_HASH]);
    assert.equal(secondClaim.id, STUDIO_JOB_ID);
    assert.deepEqual(secondClaim.terminal_image_failure_context, context);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'network failure',null)",
      [TOKEN_HASH, STUDIO_JOB_ID, secondClaim.claim_token],
    ), true);
    await db.exec("reset role");
    assert.deepEqual(
      await scalar(db, "select terminal_image_failure_context from sellerpilot_private.ai_cli_jobs where id=$1", [STUDIO_JOB_ID]),
      context,
      "a non-image failure must preserve the last image-quality context",
    );

    assert.equal(await scalar(db, "select public.sellerpilot_retry_ai_job($1)", [STUDIO_JOB_ID]), true);
    await db.exec("set role service_role");
    const thirdClaim = await scalar(db, "select public.sellerpilot_claim_ai_job($1, 'migration-test/1.54')", [TOKEN_HASH]);
    assert.deepEqual(thirdClaim.terminal_image_failure_context, context);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'succeeded',$4::jsonb,null,null)",
      [TOKEN_HASH, STUDIO_JOB_ID, thirdClaim.claim_token, JSON.stringify({ mode: "test" })],
    ), true);
    await db.exec("reset role");
    assert.equal(
      await scalar(db, "select terminal_image_failure_context is null from sellerpilot_private.ai_cli_jobs where id=$1", [STUDIO_JOB_ID]),
      true,
    );

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set available_at=now()-interval '1 minute' where id=$1",
      [RESEARCH_JOB_ID],
    );
    await db.exec("set role service_role");
    const researchClaim = await scalar(db, "select public.sellerpilot_claim_ai_job($1, 'migration-test/1.54')", [TOKEN_HASH]);
    assert.equal(researchClaim.id, RESEARCH_JOB_ID);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'not an image job',$4::jsonb)",
        [TOKEN_HASH, RESEARCH_JOB_ID, researchClaim.claim_token, JSON.stringify(context)],
      ),
      /not allowed for this job kind/,
    );
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'stale claim',$4::jsonb)",
      [TOKEN_HASH, RESEARCH_JOB_ID, "30000000-0000-4000-8000-000000000001", JSON.stringify(context)],
    ), false);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'unsafe',$4::jsonb)",
        [TOKEN_HASH, RESEARCH_JOB_ID, researchClaim.claim_token, JSON.stringify({ ...context, signedUrl: "https://private.test/secret" })],
      ),
      /invalid terminal image failure context/,
    );
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_complete_ai_job_with_image_context($1,$2,$3,'failed',null,'ordinary research failure',null)",
      [TOKEN_HASH, RESEARCH_JOB_ID, researchClaim.claim_token],
    ), true, "non-image jobs can still complete without image context");
  } finally {
    await db.exec("reset role").catch(() => {});
    await db.close();
  }
});
