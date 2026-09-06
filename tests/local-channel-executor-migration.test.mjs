import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260907110000_general_local_channel_executor.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const release = "8".repeat(40);
const egress = "a".repeat(64);
const sellerKey = "b".repeat(64);
const content = "c".repeat(64);
const tokenHash = "d".repeat(64);
const version = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;

const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  credentialCreator: "00000000-0000-4000-8000-000000000002",
  tokenCreator: "00000000-0000-4000-8000-000000000003",
  approver: "00000000-0000-4000-8000-000000000004",
  credential: "00000000-0000-4000-8000-000000000005",
  token: "00000000-0000-4000-8000-000000000006",
  product: "00000000-0000-4000-8000-000000000007",
  externalImport: "00000000-0000-4000-8000-000000000008",
  attempt: "00000000-0000-4000-8000-000000000009",
  listing: "00000000-0000-4000-8000-000000000010",
  job: "00000000-0000-4000-8000-000000000011",
};

const fixture = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema sellerpilot_private;
create table auth.users(id uuid primary key);
create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
create table sellerpilot_private.ai_cli_worker_tokens(
 id uuid primary key, token_hash text, scope text, status text, expires_at timestamptz,
 last_seen_at timestamptz, last_version text, created_by uuid references auth.users(id)
);
create table sellerpilot_private.channel_credentials(
 id uuid primary key, channel text, environment text, status text, expires_at timestamptz,
 last_check_status text, seller_account_key text, seller_account_key_source text,
 created_by uuid references auth.users(id)
);
create table sellerpilot_private.serverless_static_egress_policy(channel text primary key,enabled boolean);
create table sellerpilot_private.products(
 id uuid primary key, owner_id uuid references auth.users(id), external_detail_import_id uuid,
 demo boolean default false, status text
);
create table sellerpilot_private.external_detail_imports(id uuid primary key,product_id uuid,owner_id uuid);
alter table sellerpilot_private.products add foreign key(external_detail_import_id)
 references sellerpilot_private.external_detail_imports(id);
create table sellerpilot_private.external_detail_approval_revisions(
 import_id uuid, revision bigint, product_id uuid, owner_id uuid, content_sha256 text,
 content_snapshot jsonb, detail_version bigint, request_sha256 text, reason text,
 previous_revision bigint, reviewed_by uuid, reviewed_at timestamptz,
 legacy_approved_product_updated_at timestamptz, primary key(import_id,revision)
);
create table sellerpilot_private.channel_operation_attempts(
 id uuid primary key, credential_id uuid, channel text, operation text, status text,
 remote_id text, owner_id uuid, seller_account_key text
);
create table sellerpilot_private.product_listings(
 id uuid primary key, product_id uuid, owner_id uuid, channel_key text,
 seller_account_key text, operation_attempt_id uuid
);
create table sellerpilot_private.channel_gateway_jobs(
 id uuid primary key, credential_id uuid, attempt_id uuid, listing_id uuid,
 channel text, operation text, environment text, status text, request_payload jsonb,
 provider_mutation_started_at timestamptz, credential_refresh_in_flight boolean default false,
 credential_refresh_recovery_vault_id uuid, prepared_credential_id uuid,
 oauth_exchange_completed boolean default false, seller_account_key text,
 worker_token_id uuid, claim_token uuid, lease_expires_at timestamptz,
 attempt_count integer default 0, created_at timestamptz default clock_timestamp()
);
create function sellerpilot_private.request_has_unambiguous_service_role_claim()
returns boolean language sql stable as $$select true$$;
create function sellerpilot_private.active_serverless_runtime_release_sha()
returns text language sql stable as $$select '${release}'::text$$;
create function sellerpilot_private.listing_mutation_release_gate_is_effective(text)
returns boolean language sql stable as $$
 select coalesce(current_setting('test.listing_gate',true),'open')='open'
$$;
create function sellerpilot_private.serverless_gateway_job_allowed(text,text)
returns boolean language sql stable as $$select true$$;
create function sellerpilot_private.external_detail_approval_revision_is_current(uuid,bigint,text)
returns boolean language sql stable as $$
 select exists(select 1 from sellerpilot_private.external_detail_approval_revisions r
  where r.import_id=$1 and r.revision=$2 and r.content_sha256=$3)
$$;
create function sellerpilot_private.external_detail_import_is_current(uuid)
returns boolean language sql stable as $$select true$$;
create function sellerpilot_private.external_detail_source_manifest(uuid)
returns jsonb language sql stable as $$
 select case when request_payload#>'{arguments,sellerpilotExternalDetail}' is null
  then null else '{}'::jsonb end
 from sellerpilot_private.channel_gateway_jobs where id=$1
$$;
create function public.sellerpilot_11820_claim_gateway_unsafe(
 p_token_hash text,p_worker_version text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token_id uuid;v_job_id uuid;v_result jsonb;
begin
 select id into v_token_id from sellerpilot_private.ai_cli_worker_tokens
 where token_hash=p_token_hash and status='active' and expires_at>clock_timestamp();
 select j.id into v_job_id
 from sellerpilot_private.channel_gateway_jobs j
 join sellerpilot_private.channel_credentials c on c.id=j.credential_id and c.status='active'
   where j.status = 'queued'
     and (
       coalesce(current_setting('sellerpilot.local_gateway_recovery_lane', true), '')
         is distinct from 'enabled'
       or (j.channel='coupang' and j.operation='categories.validate')
     )
     and not (
       sellerpilot_private.serverless_gateway_job_allowed(j.channel,j.operation)
       and j.channel in ('coupang','smartstore')
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running
        where running.channel=j.channel and running.status='running'
     )
 order by j.created_at,j.id for update of j,c skip locked limit 1;
 if v_job_id is null then return null;end if;
 select jsonb_build_object('id',j.id,'channel',j.channel,'operation',j.operation)
 into v_result from sellerpilot_private.channel_gateway_jobs j where j.id=v_job_id;
 return v_result;
end$$;
create function public.sellerpilot_11840_claim_gateway_unsafe(
 p_token_hash text,p_worker_version text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return public.sellerpilot_11820_claim_gateway_unsafe(p_token_hash,p_worker_version);
end$$;
create function public.sellerpilot_260826_claim_gateway_unscoped(
 p_token_hash text,p_worker_version text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return public.sellerpilot_11840_claim_gateway_unsafe(p_token_hash,p_worker_version);
end$$;
create function public.sellerpilot_claim_channel_gateway_job(
 p_token_hash text,p_worker_version text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 update sellerpilot_private.ai_cli_worker_tokens set last_seen_at=clock_timestamp(),
  last_version=p_worker_version where token_hash=p_token_hash;
 return public.sellerpilot_260826_claim_gateway_unscoped(p_token_hash,p_worker_version);
end$$;
`;

async function createDatabase() {
  const db = new PGlite();
  await db.exec(fixture);
  await db.exec(migration);
  return db;
}

async function seedAllowedListing(db) {
  await db.exec(`
insert into auth.users(id) values
 ('${ids.owner}'),('${ids.credentialCreator}'),('${ids.tokenCreator}'),('${ids.approver}');
insert into sellerpilot_private.admin_users(user_id) select id from auth.users;
insert into sellerpilot_private.ai_cli_worker_tokens values(
 '${ids.token}','${tokenHash}','gateway','active',clock_timestamp()+interval '1 day',
 clock_timestamp(),'${version}','${ids.tokenCreator}'
);
insert into sellerpilot_private.channel_credentials values(
 '${ids.credential}','coupang','production','active',clock_timestamp()+interval '1 day',
 'passed','${sellerKey}','credential_incarnation_v1','${ids.credentialCreator}'
);
insert into sellerpilot_private.serverless_static_egress_policy values('coupang',false);
insert into sellerpilot_private.external_detail_imports values(
 '${ids.externalImport}','${ids.product}','${ids.owner}'
);
insert into sellerpilot_private.products values(
 '${ids.product}','${ids.owner}','${ids.externalImport}',false,'active'
);
insert into sellerpilot_private.external_detail_approval_revisions values(
 '${ids.externalImport}',1,'${ids.product}','${ids.owner}','${content}',
 '{}'::jsonb,1,'${"e".repeat(64)}','initial_approval',null,'${ids.approver}',
 clock_timestamp(),clock_timestamp()
);
insert into sellerpilot_private.channel_operation_attempts values(
 '${ids.attempt}','${ids.credential}','coupang','listing.create','running',null,
 '${ids.owner}','${sellerKey}'
);
insert into sellerpilot_private.product_listings values(
 '${ids.listing}','${ids.product}','${ids.owner}','coupang','${sellerKey}','${ids.attempt}'
);
insert into sellerpilot_private.channel_gateway_jobs values(
 '${ids.job}','${ids.credential}','${ids.attempt}','${ids.listing}',
 'coupang','listing.create','production','queued',
 jsonb_build_object('arguments',jsonb_build_object('sellerpilotExternalDetail',
  jsonb_build_object('contract','sellerpilot_external_detail_channel_v1',
   'productId','${ids.product}','ownerId','${ids.owner}','channel','coupang',
   'importId','${ids.externalImport}','approvalRevision',1,'contentSha256','${content}'))),
 null,false,null,null,false,'${sellerKey}',null,null,null,0,clock_timestamp()
);
insert into sellerpilot_private.local_channel_executor_routes(
 owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,
 release_sha,egress_ip_sha256,approved_by,approved_at,expires_at,enabled
) values(
 '${ids.owner}','coupang','listing.create','${ids.credential}','${sellerKey}','${ids.token}',
 '${release}','${egress}','${ids.approver}',clock_timestamp(),clock_timestamp()+interval '1 hour',true
);
`);
}

test("migration installs an empty, operation-scoped lane and preserves the original running fence", async () => {
  const db = await createDatabase();
  try {
    const routes = await db.query("select count(*)::int as count from sellerpilot_private.local_channel_executor_routes");
    assert.equal(routes.rows[0].count, 0);
    const definition = await db.query(
      "select pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure) as source",
    );
    assert.match(definition.rows[0].source, /local_channel_executor_job_allowed/u);
    assert.match(definition.rows[0].source, /channel_gateway_jobs running/u);
    assert.match(definition.rows[0].source, /sellerpilot\.local_gateway_recovery_lane/u);
    assert.doesNotMatch(migration, /j\.id\s*=\s*'[0-9a-f-]{36}'::uuid/iu);
  } finally {
    await db.close();
  }
});

test("different admin identities remain explicitly bound while current approval can claim", async () => {
  const db = await createDatabase();
  try {
    await seedAllowedListing(db);
    const readiness = await db.query(
      `select public.sellerpilot_service_local_channel_executor_readiness(
        $1,$2,$3,$4,$5,$6,$7,$8
      ) as result`,
      [ids.owner, "coupang", "listing.create", ids.credential, ids.product, release, 1, content],
    );
    assert.equal(readiness.rows[0].result.ready, true);
    assert.equal(readiness.rows[0].result.access, "write");
    const claimed = await db.query(
      "select public.sellerpilot_claim_local_channel_executor_job($1,$2,$3,$4) as result",
      [tokenHash, version, release, egress],
    );
    assert.equal(claimed.rows[0].result.id, ids.job);
    assert.equal(claimed.rows[0].result.operation, "listing.create");
  } finally {
    await db.close();
  }
});

test("stale egress, release, or immutable approval fails closed", async () => {
  const db = await createDatabase();
  try {
    await seedAllowedListing(db);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_claim_local_channel_executor_job($1,$2,$3,$4) as result",
        [tokenHash, version, release, "f".repeat(64)],
      ),
      /invalid local channel executor attestation/u,
    );
    await db.exec(`delete from sellerpilot_private.external_detail_approval_revisions`);
    const staleApproval = await db.query(
      `select public.sellerpilot_service_local_channel_executor_readiness(
        $1,$2,$3,$4,$5,$6,$7,$8
      ) as result`,
      [ids.owner, "coupang", "listing.create", ids.credential, ids.product, release, 1, content],
    );
    assert.equal(staleApproval.rows[0].result, null);
  } finally {
    await db.close();
  }
});

test("read-only category metadata stays available when only the listing mutation gate is closed", async () => {
  const db = await createDatabase();
  try {
    await seedAllowedListing(db);
    await db.exec(`
insert into sellerpilot_private.local_channel_executor_routes(
 owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,
 release_sha,egress_ip_sha256,approved_by,approved_at,expires_at,enabled
) values(
 '${ids.owner}','coupang','categories.attributes','${ids.credential}','${sellerKey}','${ids.token}',
 '${release}','${egress}','${ids.approver}',clock_timestamp(),clock_timestamp()+interval '1 hour',true
);
insert into sellerpilot_private.channel_operation_attempts values(
 '00000000-0000-4000-8000-000000000012','${ids.credential}','coupang',
 'categories.attributes','running',null,'${ids.owner}','${sellerKey}'
);
insert into sellerpilot_private.channel_gateway_jobs values(
 '00000000-0000-4000-8000-000000000013','${ids.credential}',
 '00000000-0000-4000-8000-000000000012',null,'coupang','categories.attributes',
 'production','queued','{}'::jsonb,null,false,null,null,false,'${sellerKey}',
 null,null,null,0,clock_timestamp()+interval '1 second'
);
select set_config('test.listing_gate','closed',false);
`);
    const readiness = await db.query(
      `select public.sellerpilot_service_local_channel_executor_readiness(
        $1,$2,$3,$4,$5,$6,$7,$8
      ) as result`,
      [ids.owner, "coupang", "categories.attributes", ids.credential, ids.product, release, null, null],
    );
    assert.equal(readiness.rows[0].result.ready, true);
    assert.equal(readiness.rows[0].result.access, "read");
    const claimed = await db.query(
      "select public.sellerpilot_claim_local_channel_executor_job($1,$2,$3,$4) as result",
      [tokenHash, version, release, egress],
    );
    assert.equal(claimed.rows[0].result.operation, "categories.attributes");
  } finally {
    await db.close();
  }
});

test("the local lane cannot consume pre-existing Coupang order or inquiry backlog", async () => {
  const db = await createDatabase();
  try {
    await seedAllowedListing(db);
    await db.exec(`
delete from sellerpilot_private.channel_gateway_jobs;
delete from sellerpilot_private.local_channel_executor_routes;
update sellerpilot_private.channel_operation_attempts
 set operation='orders.list' where id='${ids.attempt}';
insert into sellerpilot_private.channel_gateway_jobs values(
 '${ids.job}','${ids.credential}','${ids.attempt}',null,
 'coupang','orders.list','production','queued','{}'::jsonb,
 null,false,null,null,false,'${sellerKey}',null,null,null,0,clock_timestamp()
);
`);
    const claimed = await db.query(
      "select public.sellerpilot_claim_local_channel_executor_job($1,$2,$3,$4) as result",
      [tokenHash, version, release, egress],
    );
    assert.equal(claimed.rows[0].result, null);
  } finally {
    await db.close();
  }
});
