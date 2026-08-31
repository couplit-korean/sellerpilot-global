import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831057200_allow_exact_qoo10_s1_activation_provider_boundary.sql",
  import.meta.url,
);

async function scalar(db, sql, parameters = []) {
  return (await db.query(sql, parameters)).rows[0]?.value;
}

test("572 changes only the exact S1 serverless provider marker", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, 1);
  assert.match(
    sql,
    /create or replace function public\.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate/,
  );
  assert.match(
    sql,
    /job\.operation in \([\s\S]*'listing\.create'[\s\S]*'inquiries\.reply'[\s\S]*'shipment\.confirm'[\s\S]*or \([\s\S]*job\.operation = 'listing\.activate'[\s\S]*exact_qoo10_s1_activation_provider_allowed/,
  );
  for (const fence of [
    "serverless_cs_job_is_owned",
    "serverless_gateway_job_allowed",
    "job.status = 'running'",
    "job.claim_token = p_claim_token",
    "job.lease_expires_at > clock_timestamp()",
    "token.id = job.worker_token_id",
    "token.token_hash = p_token_hash",
    "token.scope = 'serverless_cs'",
    "token.status = 'active'",
    "token.expires_at > clock_timestamp()",
  ]) assert.ok(sql.includes(fence), `missing fence: ${fence}`);
  assert.match(sql, /migration\.version = '20260831057100'/);
  assert.match(sql, /migration\.version = '20260831057200'/);
  assert.match(
    sql,
    /revoke all on function[\s\S]*sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(sql, /alter function[\s\S]*rename to/);
  assert.doesNotMatch(sql, /grant execute[\s\S]*sellerpilot_300950/);
  assert.doesNotMatch(sql, /7ec26a02-0507-4385-8da6-ccd393891556/);
});

test("572 serverless chain admits one live exact permit and preserves all fences", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const boundary = sql.match(
    /create or replace function public\.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate\([\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(boundary, "patched provider marker must be extractable");

  const db = new PGlite();
  const worker = "30000000-0000-4000-8000-000000000001";
  const claim = "30000000-0000-4000-8000-000000000002";
  const wrongClaim = "30000000-0000-4000-8000-000000000003";
  const activation = "30000000-0000-4000-8000-000000000004";
  const inquiry = "30000000-0000-4000-8000-000000000005";
  const tokenHash = "9".repeat(64);
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.ai_cli_worker_tokens (
        id uuid primary key, token_hash text not null, scope text not null,
        status text not null, expires_at timestamptz not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, channel text not null, operation text not null,
        status text not null, worker_token_id uuid, claim_token uuid,
        lease_expires_at timestamptz, provider_mutation_started_at timestamptz,
        updated_at timestamptz not null default clock_timestamp()
      );
      create table sellerpilot_private.exact_activation_permits (
        job_id uuid primary key, claim_token uuid not null,
        valid boolean not null, consumed_at timestamptz
      );
      create function sellerpilot_private.serverless_cs_job_is_owned(
        hash text,job_id uuid,claim_id uuid,before_provider boolean
      ) returns boolean language sql stable set search_path='' as $$
        select exists (
          select 1 from sellerpilot_private.channel_gateway_jobs job
          join sellerpilot_private.ai_cli_worker_tokens token
            on token.id=job.worker_token_id
          where job.id=job_id and job.status='running'
            and job.claim_token=claim_id and job.lease_expires_at>clock_timestamp()
            and token.token_hash=hash and token.scope='serverless_cs'
            and token.status='active' and token.expires_at>clock_timestamp()
            and (not before_provider or job.provider_mutation_started_at is null)
        )
      $$;
      create function sellerpilot_private.serverless_gateway_job_allowed(
        channel_name text,operation_name text
      ) returns boolean language sql immutable set search_path='' as $$
        select case when operation_name='listing.activate'
          then channel_name='qoo10'
          else operation_name in (
            'listing.create','listing.update','listing.stop','inventory.update',
            'inquiries.reply','shipment.acknowledge','shipment.confirm'
          ) end
      $$;
      create function sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
        job_id uuid,claim_id uuid
      ) returns boolean language sql stable set search_path='' as $$
        select exists (
          select 1 from sellerpilot_private.exact_activation_permits permit
          join sellerpilot_private.channel_gateway_jobs job on job.id=permit.job_id
          where permit.job_id=job_id and permit.claim_token=claim_id
            and permit.valid and permit.consumed_at is null
            and job.channel='qoo10' and job.operation='listing.activate'
            and job.status='running' and job.claim_token=claim_id
            and job.lease_expires_at>clock_timestamp()
            and job.provider_mutation_started_at is null
        )
      $$;
      create function sellerpilot_private.consume_exact_qoo10_s1_activation_provider(
        p_job_id uuid,p_claim_id uuid
      ) returns boolean language plpgsql set search_path='' as $$
      begin
        update sellerpilot_private.exact_activation_permits permit
           set valid=false,consumed_at=clock_timestamp()
         where permit.job_id=p_job_id and permit.claim_token=p_claim_id
           and permit.valid and permit.consumed_at is null
           and exists (select 1 from sellerpilot_private.channel_gateway_jobs job
                        where job.id=p_job_id
                          and job.provider_mutation_started_at is not null);
        return found;
      end $$;
    `);
    await db.exec(boundary);
    await db.exec(`
      create function public.sellerpilot_056700_begin_serverless_before_qoo10_s1_activation(
        hash text,job_id uuid,claim_id uuid
      ) returns boolean language sql security definer set search_path='' as $$
        select public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
          hash,job_id,claim_id
        )
      $$;
      create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
        hash text,job_id uuid,claim_id uuid
      ) returns boolean language plpgsql security definer set search_path='' as $$
      declare operation_name text; started boolean;
      begin
        select operation into operation_name
          from sellerpilot_private.channel_gateway_jobs where id=job_id;
        if operation_name='listing.activate'
           and not sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
             job_id,claim_id
           ) then return false; end if;
        started := public.sellerpilot_056700_begin_serverless_before_qoo10_s1_activation(
          hash,job_id,claim_id
        );
        if operation_name='listing.activate' and started
           and not sellerpilot_private.consume_exact_qoo10_s1_activation_provider(
             job_id,claim_id
           ) then raise exception 'permit consumption failed'; end if;
        return started;
      end $$;
    `);
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens
       values ($1,$2,'serverless_cs','active',clock_timestamp()+interval '1 hour')`,
      [worker, tokenHash],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs values
       ($1,'qoo10','listing.activate','running',$2,$3,
        clock_timestamp()+interval '5 minutes',null,clock_timestamp()),
       ($4,'coupang','inquiries.reply','running',$2,$3,
        clock_timestamp()+interval '5 minutes',null,clock_timestamp())`,
      [activation, worker, claim, inquiry],
    );
    await db.query(
      "insert into sellerpilot_private.exact_activation_permits values ($1,$2,true,null)",
      [activation, claim],
    );
    const begin = (claimId = claim, hash = tokenHash) => scalar(
      db,
      "select public.sellerpilot_service_begin_serverless_gateway_provider_mutation($1,$2,$3) value",
      [hash, activation, claimId],
    );
    assert.equal(await begin(wrongClaim), false);
    assert.equal(await begin(claim, "8".repeat(64)), false, "token hash remains bound");
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set scope='gateway' where id=$1",
      [worker],
    );
    assert.equal(await begin(), false, "token scope remains fail-closed");
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs',expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [worker],
    );
    assert.equal(await begin(), false, "token expiry remains fail-closed");
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set expires_at=clock_timestamp()+interval '1 hour' where id=$1",
      [worker],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [activation],
    );
    assert.equal(await begin(), false, "lease expiry remains fail-closed");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1",
      [activation],
    );
    await db.query(
      "update sellerpilot_private.exact_activation_permits set valid=false where job_id=$1",
      [activation],
    );
    assert.equal(await begin(), false, "invalid permit remains fail-closed");
    await db.query(
      "update sellerpilot_private.exact_activation_permits set valid=true where job_id=$1",
      [activation],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set channel='coupang' where id=$1",
      [activation],
    );
    assert.equal(await begin(), false, "non-Qoo10 listing.activate remains blocked");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set channel='qoo10' where id=$1",
      [activation],
    );
    assert.equal(await begin(), true, "live exact permit crosses once");
    assert.equal(await begin(), false, "consumed permit cannot cross twice");
    assert.deepEqual(
      (await db.query(
        `select job.provider_mutation_started_at is not null started,
                permit.consumed_at is not null consumed,permit.valid
           from sellerpilot_private.channel_gateway_jobs job
           join sellerpilot_private.exact_activation_permits permit
             on permit.job_id=job.id where job.id=$1`,
        [activation],
      )).rows,
      [{ started: true, consumed: true, valid: false }],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_serverless_gateway_provider_mutation($1,$2,$3) value",
        [tokenHash, inquiry, claim],
      ),
      true,
      "existing inquiries.reply provider writes remain admitted",
    );
  } finally {
    await db.close();
  }
});
