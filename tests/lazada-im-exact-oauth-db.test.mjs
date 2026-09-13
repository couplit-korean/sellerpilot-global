// PGlite verifies the production migration's state machine, exact payloads and
// atomic database effects. Vault encryption, native Supabase JWT claim wiring,
// provider HTTP, and the existing generic refresh/completion implementations are
// fixture boundaries; this file does not claim deployment or provider success.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationUrl = new URL("../supabase/migrations/20260913104000_lazada_im_cross_border_exact_oauth.sql", import.meta.url);
const migration = await readFile(migrationUrl, "utf8");
const db = new PGlite({ extensions: { pgcrypto } });
after(async () => db.close());

const actor = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const issuer = "33333333-3333-4333-8333-333333333333";
const credential = "44444444-4444-4444-8444-444444444444";
const workerId = "55555555-5555-4555-8555-555555555555";
const session = "66666666-6666-4666-8666-666666666666";
const tokenHash = "b".repeat(64);
const stateHash = "c".repeat(64);
const releaseSha = "a".repeat(40);
const egressHash = "d".repeat(64);
const workerVersion = `sellerpilot-cli-worker/1.61+${releaseSha}.${egressHash.slice(0, 11)}`;
const sourceExpiry = "2027-03-09T14:07:24.232Z";
const sellerKey = "2".repeat(64);
const unrelatedSellerKey = "3".repeat(64);
const unrelatedCredential = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const countryRows = [
  { country: "my", seller_id: "300872000183", user_id: "9001" },
  { country: "ph", seller_id: "501846640243", user_id: "9002" },
  { country: "sg", seller_id: "1754224042", user_id: "9003" },
  { country: "th", seller_id: "101407248667", user_id: "9004" },
  { country: "vn", seller_id: "201095728264", user_id: "9005" },
];
const sourceSecret = {
  app_key: "137451",
  app_secret: "commerce-secret-kept",
  country: "my",
  access_token: "commerce-access-kept",
  refresh_token: "commerce-refresh-kept",
  refresh_token_expires_at: sourceExpiry,
  account_platform: "seller_center",
  country_user_info: countryRows,
  provider_account_identity_version: "v1",
  provider_account_subject: "lazada:v1:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn0123456789_-",
  im_app_key: "137571",
  im_app_secret: "im-secret-kept",
  im_access_token: "old-im-access",
  im_refresh_token: "old-im-refresh",
  im_access_token_expires_at: "2026-10-01T00:00:00.000Z",
  im_refresh_token_expires_at: "2026-11-01T00:00:00.000Z",
  im_account_platform: "seller_center",
  im_country_user_info: countryRows.slice(0, 1),
  im_country_user_info_list: countryRows.slice(0, 1),
  im_identity_source: "lazada.oauth_token",
  unrelated_commerce_setting: { preserve: true },
};
const candidate = {
  ...sourceSecret,
  im_access_token: "new-im-access-token",
  im_refresh_token: "new-im-refresh-token",
  im_access_token_expires_at: "2026-10-13T00:00:00.000Z",
  im_refresh_token_expires_at: "2027-03-13T00:00:00.000Z",
  im_account_platform: "seller_center",
  im_country_user_info: countryRows,
  im_country_user_info_list: countryRows,
  im_identity_source: "lazada.oauth_token",
};

async function scalar(sql, params = []) {
  return Object.values((await db.query(sql, params)).rows[0])[0];
}
async function serviceRpc(sql, params = []) {
  await db.exec("set role service_role");
  try {
    return await scalar(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function rejectsCode(run, code) {
  await assert.rejects(run, (error) => String(error.message).includes(code));
}

await db.exec(`
  set check_function_bodies = off;
  create schema extensions;
  create extension pgcrypto with schema extensions;
  create schema auth;
  create schema vault;
  create schema sellerpilot_private;
  do $$begin create role anon; exception when duplicate_object then null; end$$;
  do $$begin create role authenticated; exception when duplicate_object then null; end$$;
  do $$begin create role service_role; exception when duplicate_object then null; end$$;

  create table auth.users(id uuid primary key);
  create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
  create table vault.secrets(
    id uuid primary key default gen_random_uuid(), secret text not null,
    name text, description text, created_at timestamptz default clock_timestamp()
  );
  create view vault.decrypted_secrets as
    select id,secret as decrypted_secret,name,description,created_at from vault.secrets;
  create function vault.create_secret(new_secret text,new_name text,new_description text,new_key_id uuid default null)
  returns uuid language plpgsql as $$declare v_id uuid;begin
    insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description)
    returning id into v_id; return v_id;
  end$$;

  create table sellerpilot_private.channel_credentials(
    id uuid primary key default gen_random_uuid(), channel text not null,
    environment text not null,status text not null,vault_secret_id uuid not null references vault.secrets(id),
    created_by uuid not null references auth.users(id),expires_at timestamptz,version integer not null,
    fingerprint text not null,seller_account_key text,seller_account_key_source text,
    seller_account_verified_at timestamptz
  );
  create table sellerpilot_private.ai_cli_worker_tokens(
    id uuid primary key,token_hash text not null unique,scope text not null,status text not null,
    created_by uuid not null references auth.users(id),expires_at timestamptz not null,
    last_seen_at timestamptz,last_version text
  );
  create table sellerpilot_private.channel_gateway_jobs(
    id uuid primary key default gen_random_uuid(),credential_id uuid not null references sellerpilot_private.channel_credentials(id),
    created_by uuid not null references auth.users(id),channel text not null,environment text not null,
    operation text not null,status text not null default 'queued',attempt_count integer not null default 0,
    request_payload jsonb not null default '{}'::jsonb,response_payload jsonb,error_message text,
    worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),claim_token uuid,
    lease_expires_at timestamptz,created_at timestamptz not null default clock_timestamp(),
    started_at timestamptz,updated_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
    provider_mutation_started_at timestamptz,oauth_source_credential_id uuid,
    oauth_request_vault_id uuid,oauth_request_fingerprint text,
    credential_refresh_in_flight boolean not null default false,
    credential_refresh_started_at timestamptz,credential_refresh_recovery_vault_id uuid,
    oauth_provider_call_started_at timestamptz,oauth_exchange_completed boolean not null default false,
    prepared_credential_id uuid
  );
  create table sellerpilot_private.local_channel_executor_routes(
    id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
    channel text not null,operation text not null,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
    seller_account_key text not null,worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id),
    release_sha text not null,egress_ip_sha256 text not null,approved_by uuid not null references auth.users(id),
    approved_at timestamptz not null,expires_at timestamptz not null,enabled boolean not null,
    created_at timestamptz not null default clock_timestamp(),
    unique(owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,egress_ip_sha256)
  );
  create unique index local_channel_executor_one_active_route_idx
    on sellerpilot_private.local_channel_executor_routes(owner_id,channel,operation,credential_id) where enabled;
  create table sellerpilot_private.gateway_completion_receipts(
    job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
    claim_token uuid not null,worker_token_id uuid not null,completion_fingerprint text not null,
    created_at timestamptz not null default clock_timestamp()
  );
  create table sellerpilot_private.cs_credential_capability_bindings(
    id uuid primary key default gen_random_uuid(),credential_id uuid not null references sellerpilot_private.channel_credentials(id),
    channel text not null,operation text not null,country text not null,
    app_fingerprint text not null,token_fingerprint text not null,target_fingerprint text not null,
    status text not null,verified_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id),
    verified_at timestamptz not null,expires_at timestamptz,created_at timestamptz default clock_timestamp(),
    updated_at timestamptz not null,
    unique(credential_id,operation,country,app_fingerprint,token_fingerprint,target_fingerprint)
  );

  create function sellerpilot_private.worker_token_has_scope(p_hash text,p_scope text,p_require boolean)
  returns boolean language sql stable as $$
    select exists(select 1 from sellerpilot_private.ai_cli_worker_tokens
      where token_hash=p_hash and scope=p_scope and status='active' and expires_at>clock_timestamp())
  $$;
  create function sellerpilot_private.active_serverless_runtime_release_sha()
  returns text language sql stable as $$select '${releaseSha}'::text$$;
  -- Exact live helper body read back on 2026-09-13; unlike the generic
  -- refresh/completion fixture boundaries below, capability derivation is real.
  create function sellerpilot_private.lazada_im_secret_binding(p_secret jsonb,p_country text)
  returns jsonb language plpgsql immutable set search_path='' as $$
  declare v_country text:=lower(p_country);v_im jsonb;v_main jsonb;v_seller text;
  begin
   if v_country not in('my','sg','ph','th','vn','id')
    or p_secret->>'im_identity_source' is distinct from 'lazada.oauth_token'
    or jsonb_typeof(p_secret->'im_country_user_info') is distinct from 'array'
    or jsonb_typeof(p_secret->'country_user_info') is distinct from 'array'
    or coalesce(p_secret->>'im_app_key','')='' or coalesce(p_secret->>'im_access_token','')=''
    or coalesce(p_secret->>'im_refresh_token','')='' then return null;end if;
   for v_im in select value from jsonb_array_elements(p_secret->'im_country_user_info') loop
    if coalesce(v_im->>'seller_id','')!~'^[1-9][0-9]{0,31}$'
      or not exists(select 1 from jsonb_array_elements(p_secret->'country_user_info') m
        where lower(m->>'country')=lower(v_im->>'country') and m->>'seller_id'=v_im->>'seller_id') then return null;end if;
    if lower(v_im->>'country')=v_country then
     if v_seller is not null and v_seller<>v_im->>'seller_id' then return null;end if;
     v_seller:=v_im->>'seller_id';
    end if;
   end loop;
   if v_seller is null then return null;end if;
   return jsonb_build_object('contract','sellerpilot-lazada-im-capability/1','country',upper(v_country),'sellerId',v_seller,
    'appFingerprint',encode(extensions.digest(p_secret->>'im_app_key','sha256'),'hex'),
    'tokenFingerprint',encode(extensions.digest((p_secret->>'im_access_token')||E'\\x1f'||(p_secret->>'im_refresh_token'),'sha256'),'hex'),
    'targetFingerprint',encode(extensions.digest(v_country||':'||v_seller,'sha256'),'hex'));
  end$$;
  create function public.sellerpilot_service_begin_gateway_credential_refresh(text,uuid,uuid)
  returns boolean language plpgsql security definer as $$begin
    update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=true,
      credential_refresh_started_at=coalesce(credential_refresh_started_at,clock_timestamp())
    where id=$2 and claim_token=$3 and status='running'; return found;
  end$$;
  create function public.sellerpilot_service_prepare_gateway_credential_refresh(
    p_hash text,p_job uuid,p_claim uuid,p_secret jsonb,p_expiry timestamptz,
    p_recovery boolean,p_complete boolean
  ) returns jsonb language plpgsql security definer as $$declare old_row sellerpilot_private.channel_credentials%rowtype;
    new_id uuid:=gen_random_uuid();vault_id uuid;begin
    select c.* into old_row from sellerpilot_private.channel_credentials c join sellerpilot_private.channel_gateway_jobs j
      on j.credential_id=c.id where j.id=p_job and j.claim_token=p_claim and j.status='running' for update of c;
    if not found or p_recovery or not p_complete then return jsonb_build_object('status','invalid');end if;
    vault_id:=vault.create_secret(p_secret::text,'fixture-prepared-'||new_id::text,'PGlite boundary');
    update sellerpilot_private.channel_credentials set status='revoked' where id=old_row.id;
    insert into sellerpilot_private.channel_credentials(id,channel,environment,status,vault_secret_id,created_by,
      expires_at,version,fingerprint,seller_account_key,seller_account_key_source,seller_account_verified_at)
    values(new_id,old_row.channel,old_row.environment,'active',vault_id,old_row.created_by,p_expiry,
      old_row.version+1,'prepared-fingerprint',old_row.seller_account_key,'provider_certified_v1',clock_timestamp());
    update sellerpilot_private.channel_gateway_jobs set credential_id=new_id,prepared_credential_id=new_id,
      oauth_exchange_completed=true,credential_refresh_in_flight=false where id=p_job;
    return jsonb_build_object('status','prepared','credential_id',new_id);
  end$$;
  create function public.sellerpilot_service_complete_gateway_transaction(
    p_hash text,p_job uuid,p_claim uuid,p_status text,p_response jsonb,p_error text,
    p_refresh jsonb,p_orders jsonb,p_inquiries jsonb,p_diagnostic jsonb
  ) returns jsonb language plpgsql security definer as $$declare token_id uuid;begin
    select id into token_id from sellerpilot_private.ai_cli_worker_tokens where token_hash=p_hash;
    update sellerpilot_private.channel_gateway_jobs set status=p_status,response_payload=p_response,
      error_message=p_error,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_job and claim_token=p_claim and status='running';
    if not found then return null;end if;
    insert into sellerpilot_private.gateway_completion_receipts(job_id,claim_token,worker_token_id,completion_fingerprint)
    values(p_job,p_claim,token_id,encode(extensions.digest(coalesce(p_response,'{}'::jsonb)::text,'sha256'),'hex'));
    return jsonb_build_object('status','completed');
  end$$;
  set check_function_bodies = on;
`);

await db.query("insert into auth.users(id) values($1),($2),($3)", [actor, owner, issuer]);
await db.query("insert into sellerpilot_private.admin_users(user_id) values($1),($2),($3)", [actor, owner, issuer]);
await db.query("insert into vault.secrets(id,secret,name) values($1,$2,'source')", [credential, JSON.stringify(sourceSecret)]);
await db.query(`insert into sellerpilot_private.channel_credentials(
  id,channel,environment,status,vault_secret_id,created_by,expires_at,version,fingerprint,
  seller_account_key,seller_account_key_source,seller_account_verified_at
) values($1,'lazada','production','active',$1,$2,$3,7,
  'source-fingerprint',$4,'provider_certified_v1',clock_timestamp())`, [credential, owner, sourceExpiry, sellerKey]);
await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens(
  id,token_hash,scope,status,created_by,expires_at,last_seen_at,last_version
) values($1,$2,'gateway','active',$3,'2027-04-01T00:00:00Z',clock_timestamp(),$4)`, [workerId, tokenHash, issuer, workerVersion]);
await db.query(`insert into sellerpilot_private.local_channel_executor_routes(
  owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,
  egress_ip_sha256,approved_by,approved_at,expires_at,enabled
) select $1,'lazada',operation,$2,$3,$4,$5,$6,$7,
  clock_timestamp()-interval '1 day','2027-04-01T00:00:00Z',true
  from unnest(array['diagnostic.test','inquiries.list','orders.list']) operation`,
[owner, credential, sellerKey, workerId, releaseSha, egressHash, actor]);
await db.query("insert into vault.secrets(id,secret,name) values($1,$2,'unrelated-source')",
  [unrelatedCredential, JSON.stringify(sourceSecret)]);
await db.query(`insert into sellerpilot_private.channel_credentials(
  id,channel,environment,status,vault_secret_id,created_by,expires_at,version,fingerprint,
  seller_account_key,seller_account_key_source,seller_account_verified_at
) values($1,'lazada','production','active',$1,$2,$3,6,'unrelated-fingerprint',$4,
  'provider_certified_v1',clock_timestamp())`, [unrelatedCredential, owner, sourceExpiry, unrelatedSellerKey]);
await db.query(`insert into sellerpilot_private.local_channel_executor_routes(
  owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,
  egress_ip_sha256,approved_by,approved_at,expires_at,enabled
) values($1,'lazada','diagnostic.test',$2,$3,$4,$5,$6,$7,
  clock_timestamp()-interval '2 days','2027-04-01T00:00:00Z',true)`,
[owner, unrelatedCredential, unrelatedSellerKey, workerId, releaseSha, egressHash, actor]);

async function seedSourceAndReachProvider({ credentialId, sessionId, state, code, version }) {
  await db.query("insert into vault.secrets(id,secret,name) values($1,$2,$3)",
    [credentialId, JSON.stringify(sourceSecret), `source-${version}`]);
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,channel,environment,status,vault_secret_id,created_by,expires_at,version,fingerprint,
    seller_account_key,seller_account_key_source,seller_account_verified_at
  ) values($1,'lazada','production','active',$1,$2,$6,$3,$4,
    $5,'provider_certified_v1',clock_timestamp())`,
  [credentialId, owner, version, `source-fingerprint-${version}`, String(version % 10).repeat(64), sourceExpiry]);
  await db.query(`insert into sellerpilot_private.local_channel_executor_routes(
    owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,
    egress_ip_sha256,approved_by,approved_at,expires_at,enabled
  ) values($1,'lazada','diagnostic.test',$2,$3,$4,$5,$6,$7,
    clock_timestamp()-interval '1 day','2027-04-01T00:00:00Z',true)`,
  [owner, credentialId, String(version % 10).repeat(64), workerId, releaseSha, egressHash, actor]);
  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_admin('prepare',$1,$2,$3,$4,'{}')",
    [actor, sessionId, credentialId, state],
  )).status, "executor_required");
  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('pulse',$1,$2,null,null,$3::jsonb)",
    [sessionId, tokenHash, JSON.stringify({ releaseSha, egressIpSha256: egressHash, workerVersion })],
  )).status, "armed");
  const bound = await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_admin('bind',$1,$2,$3,$4,$5::jsonb)",
    [actor, sessionId, credentialId, state, JSON.stringify({ code, country: "cb" })],
  );
  const claimed = await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('claim',$1,$2,null,null,'{}')",
    [sessionId, tokenHash],
  );
  const jobId = bound.jobId;
  const claim = claimed.job.claim_token;
  await serviceRpc("select public.sellerpilot_lazada_im_exact_oauth_worker('begin',$1,$2,$3,$4,'{}')",
    [sessionId, tokenHash, jobId, claim]);
  await serviceRpc("select public.sellerpilot_lazada_im_exact_oauth_worker('provider',$1,$2,$3,$4,'{}')",
    [sessionId, tokenHash, jobId, claim]);
  return { jobId, claim };
}

test("migration installs only the two service RPCs and documents the exact proof", async () => {
  await db.exec(migration);
  const signatures = (await db.query(`select proname,pg_get_function_identity_arguments(p.oid) arguments
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and proname like 'sellerpilot_lazada_im_exact_oauth_%' order by proname`)).rows;
  assert.deepEqual(signatures.map((row) => row.proname), [
    "sellerpilot_lazada_im_exact_oauth_admin",
    "sellerpilot_lazada_im_exact_oauth_worker",
  ]);
  assert.equal(signatures[0].arguments,
    "p_action text, p_actor uuid, p_session uuid, p_credential uuid, p_state_hash text, p_request jsonb");
  assert.equal(signatures[1].arguments,
    "p_action text, p_session uuid, p_token_hash text, p_job uuid, p_claim uuid, p_payload jsonb");
  assert.equal(await scalar(`select has_function_privilege('service_role',
    'public.sellerpilot_lazada_im_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb)','execute')`), true);
  assert.equal(await scalar(`select has_function_privilege('authenticated',
    'public.sellerpilot_lazada_im_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb)','execute')`), false);
  assert.match(migration, /sellerpilot-lazada-im-cb-/u);
  assert.match(migration, /complete accepts exactly \{result:\{ok:true/u);
  assert.match(migration, /'running',1/u);
  assert.doesNotMatch(migration, /'queued',1/u);
});

test("exact IM flow preserves commerce, seals one provider call, and activates five country capabilities", async () => {
  const prepare = await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_admin('prepare',$1,$2,$3,$4,$5::jsonb)",
    [actor, session, credential, stateHash, "{}"],
  );
  assert.equal(prepare.status, "executor_required");

  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_admin('start',$1,$2,$3,$4,'{}')",
    [actor, session, credential, stateHash],
  )).status, "executor_required");

  const attestation = { releaseSha, egressIpSha256: egressHash, workerVersion };
  await db.query("delete from sellerpilot_private.local_channel_executor_routes where credential_id=$1", [credential]);
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('pulse',$1,$2,null,null,$3::jsonb)",
    [session, tokenHash, JSON.stringify(attestation)],
  ), "LAZADA_IM_EXACT_ATTESTATION_INVALID");
  await db.query(`insert into sellerpilot_private.local_channel_executor_routes(
    owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,
    egress_ip_sha256,approved_by,approved_at,expires_at,enabled
  ) select $1,'lazada',operation,$2,$3,$4,$5,$6,$7,
    clock_timestamp()-interval '1 day','2027-04-01T00:00:00Z',true
    from unnest(array['diagnostic.test','inquiries.list','orders.list']) operation`,
  [owner, credential, sellerKey, workerId, releaseSha, egressHash, actor]);
  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('pulse',$1,$2,null,null,$3::jsonb)",
    [session, tokenHash, JSON.stringify(attestation)],
  )).status, "armed");
  const otherEgress = "1".repeat(64);
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('pulse',$1,$2,null,null,$3::jsonb)",
    [session, tokenHash, JSON.stringify({
      releaseSha, egressIpSha256: otherEgress,
      workerVersion: `sellerpilot-cli-worker/1.61+${releaseSha}.${otherEgress.slice(0, 11)}`,
    })],
  ), "LAZADA_IM_EXACT_ATTESTATION_INVALID");
  assert.equal(await scalar("select egress_ip_sha256 from sellerpilot_private.lazada_im_exact_oauth_sessions where id=$1", [session]), egressHash,
    "first authenticated pulse binding must be immutable");
  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_admin('start',$1,$2,$3,$4,'{}')",
    [actor, session, credential, stateHash],
  )).status, "ready");

  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_admin('bind',$1,$2,$3,$4,$5::jsonb)",
    [actor, session, credential, stateHash, JSON.stringify({ code: "0_137451_wrong", country: "cb" })],
  ), "LAZADA_IM_EXACT_CALLBACK_INVALID");
  const bound = await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_admin('bind',$1,$2,$3,$4,$5::jsonb)",
    [actor, session, credential, stateHash, JSON.stringify({ code: "0_137571_one-time-code", country: "cb" })],
  );
  assert.equal(bound.status, "bound");
  const jobId = bound.jobId;
  assert.equal(await scalar("select count(*) from sellerpilot_private.channel_gateway_jobs where id=$1 and status='queued'", [jobId]), 0);
  assert.equal(await scalar("select name from vault.secrets where name like 'sellerpilot-lazada-im-cb-%' order by created_at limit 1"), `sellerpilot-lazada-im-cb-${jobId}`);

  const claimed = await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('claim',$1,$2,null,null,'{}')",
    [session, tokenHash],
  );
  assert.equal(claimed.status, "claimed");
  assert.deepEqual(claimed.job.request, {
    code: "0_137571_one-time-code",
    country: "cb",
    lazadaImExactSession: session,
    oauthPurpose: "im_cross_border",
    codeDelivery: "single",
  });
  const claim = claimed.job.claim_token;
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('claim',$1,$2,null,null,'{}')",
    [session, tokenHash],
  ), "LAZADA_IM_EXACT_CODE_ALREADY_DELIVERED");

  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('heartbeat',$1,$2,$3,$4,'{}')",
    [session, tokenHash, jobId, claim],
  )).status, "running");
  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('begin',$1,$2,$3,$4,'{}')",
    [session, tokenHash, jobId, claim],
  )).status, "in_flight");
  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('provider',$1,$2,$3,$4,'{}')",
    [session, tokenHash, jobId, claim],
  )).status, "provider_started");
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('provider',$1,$2,$3,$4,'{}')",
    [session, tokenHash, jobId, claim],
  ), "LAZADA_IM_EXACT_PROVIDER_RETRY_FORBIDDEN");

  const refreshExpiry = sourceExpiry;
  const recoveryStage = { refresh: { payload: candidate, expiresAt: refreshExpiry, recoveryOnly: true } };
  const activeBeforeRecovery = await scalar("select count(*) from sellerpilot_private.channel_credentials where status='active'");
  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('stage',$1,$2,$3,$4,$5::jsonb)",
    [session, tokenHash, jobId, claim, JSON.stringify(recoveryStage)],
  )).status, "recovery_preserved");
  assert.equal(await scalar("select count(*) from sellerpilot_private.channel_credentials where status='active'"), activeBeforeRecovery,
    "recovery-only stage must not activate a candidate");
  assert.equal(await scalar("select count(*) from vault.secrets where name=$1", [`sellerpilot-lazada-im-cb-recovery-${jobId}`]), 1);

  assert.equal((await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('begin',$1,$2,$3,$4,'{}')",
    [session, tokenHash, jobId, claim],
  )).status, "in_flight", "second begin is a storage boundary, not a provider replay");
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('stage',$1,$2,$3,$4,$5::jsonb)",
    [session, tokenHash, jobId, claim, JSON.stringify({
      refresh: { payload: candidate, expiresAt: "2027-03-10T14:07:24.232Z", recoveryOnly: false },
    })],
  ), "LAZADA_IM_EXACT_COMMERCE_EXPIRY_CHANGED");
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('stage',$1,$2,$3,$4,$5::jsonb)",
    [session, tokenHash, jobId, claim, JSON.stringify({
      refresh: { payload: { ...candidate, access_token: "commerce-mutated" }, expiresAt: refreshExpiry, recoveryOnly: false },
    })],
  ), "LAZADA_IM_EXACT_CANDIDATE_INVALID");
  const staged = await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('stage',$1,$2,$3,$4,$5::jsonb)",
    [session, tokenHash, jobId, claim, JSON.stringify({ refresh: { payload: candidate, expiresAt: refreshExpiry, recoveryOnly: false } })],
  );
  assert.equal(staged.status, "prepared");
  const preparedCredential = staged.credentialId;
  assert.equal(await scalar("select count(*) from sellerpilot_private.local_channel_executor_routes where credential_id=$1", [preparedCredential]), 0,
    "generic refresh must not be mistaken for fixed-egress approval carryover");
  const routeProjection = `select owner_id,channel,operation,seller_account_key,worker_token_id,
    release_sha,egress_ip_sha256,approved_by,approved_at,expires_at
    from sellerpilot_private.local_channel_executor_routes where credential_id=$1
      and worker_token_id=$2 and release_sha=$3 and egress_ip_sha256=$4
    order by operation`;
  const sourceRoutesBefore = (await db.query(routeProjection, [credential, workerId, releaseSha, egressHash])).rows;
  assert.equal(sourceRoutesBefore.length, 3);
  const unrelatedRouteBefore = await scalar("select to_jsonb(r) from sellerpilot_private.local_channel_executor_routes r where credential_id=$1", [unrelatedCredential]);
  assert.equal(await scalar(`select count(*) from sellerpilot_private.cs_credential_capability_bindings
    where credential_id=$1 and status='active'`, [preparedCredential]), 0,
  "the prepared active credential is unusable by ordinary CS until exact completion records capabilities");
  assert.equal(await scalar("select count(*) from sellerpilot_private.lazada_im_exact_oauth_readbacks where session_id=$1", [session]), 0);

  const persisted = await scalar(`select v.decrypted_secret::jsonb from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets v on v.id=c.vault_secret_id where c.id=$1`, [preparedCredential]);
  for (const key of Object.keys(sourceSecret).filter((key) => ![
    "im_access_token", "im_refresh_token", "im_access_token_expires_at", "im_refresh_token_expires_at",
    "im_account_platform", "im_country_user_info", "im_country_user_info_list", "im_identity_source",
  ].includes(key))) assert.deepEqual(persisted[key], sourceSecret[key], `commerce key ${key} changed`);

  const readbacks = countryRows.map(({ country, seller_id: sellerId }, index) => ({
    country, sellerId, httpStatus: 200, providerCode: "0", remoteRequestId: `im-readback-${index + 1}`,
  }));
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('complete',$1,$2,$3,$4,$5::jsonb)",
    [session, tokenHash, jobId, claim, JSON.stringify({ result: {
      ok: true, channel: "lazada", operation: "oauth.exchange", readbacks: readbacks.slice(0, 4),
    } })],
  ), "LAZADA_IM_EXACT_RESULT_INVALID");
  assert.equal(await scalar("select status from sellerpilot_private.channel_gateway_jobs where id=$1", [jobId]), "running");

  await db.query("update sellerpilot_private.channel_credentials set seller_account_key=$2 where id=$1",
    [preparedCredential, "4".repeat(64)]);
  await rejectsCode(() => serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('complete',$1,$2,$3,$4,$5::jsonb)",
    [session, tokenHash, jobId, claim, JSON.stringify({ result: {
      ok: true, channel: "lazada", operation: "oauth.exchange", readbacks,
    } })],
  ), "LAZADA_IM_EXACT_ACTIVE_TOKEN_MISMATCH");
  assert.equal(await scalar("select status from sellerpilot_private.channel_gateway_jobs where id=$1", [jobId]), "running");
  assert.equal(await scalar("select count(*) from sellerpilot_private.local_channel_executor_routes where credential_id=$1", [preparedCredential]), 0);
  await db.query("update sellerpilot_private.channel_credentials set seller_account_key=$2 where id=$1",
    [preparedCredential, sellerKey]);

  const completed = await serviceRpc(
    "select public.sellerpilot_lazada_im_exact_oauth_worker('complete',$1,$2,$3,$4,$5::jsonb)",
    [session, tokenHash, jobId, claim, JSON.stringify({ result: {
      ok: true, channel: "lazada", operation: "oauth.exchange", readbacks,
    } })],
  );
  assert.deepEqual(completed, { status: "completed", credentialId: preparedCredential, countries: 5 });
  assert.deepEqual((await db.query(routeProjection, [preparedCredential, workerId, releaseSha, egressHash])).rows,
    sourceRoutesBefore, "route scope and original approval fields changed during carryover");
  assert.equal(await scalar("select count(*) from sellerpilot_private.local_channel_executor_routes where credential_id=$1 and enabled", [preparedCredential]), 3);
  assert.equal(await scalar("select count(*) from sellerpilot_private.local_channel_executor_routes where credential_id=$1 and enabled", [credential]), 0);
  assert.deepEqual(await scalar("select to_jsonb(r) from sellerpilot_private.local_channel_executor_routes r where credential_id=$1", [unrelatedCredential]),
    unrelatedRouteBefore, "unrelated approved route changed");
  assert.equal(await scalar("select status from sellerpilot_private.channel_gateway_jobs where id=$1", [jobId]), "succeeded");
  assert.equal(await scalar("select count(*) from sellerpilot_private.lazada_im_exact_oauth_readbacks where session_id=$1", [session]), 5);
  assert.equal(await scalar("select count(*) from sellerpilot_private.cs_credential_capability_bindings where credential_id=$1 and status='active'", [preparedCredential]), 5);
  assert.equal(await scalar("select count(distinct token_fingerprint) from sellerpilot_private.cs_credential_capability_bindings where credential_id=$1", [preparedCredential]), 1);
  assert.deepEqual((await db.query(`select country from sellerpilot_private.cs_credential_capability_bindings
    where credential_id=$1 order by country`, [preparedCredential])).rows.map((row) => row.country), ["MY", "PH", "SG", "TH", "VN"]);
  assert.equal(await scalar("select phase from sellerpilot_private.lazada_im_exact_oauth_sessions where id=$1", [session]), "completed");
  assert.deepEqual((await db.query(`select event_type from sellerpilot_private.lazada_im_exact_oauth_events
    where session_id=$1 order by id`, [session])).rows.map((row) => row.event_type), [
    "prepared", "armed", "code_bound", "code_delivered", "provider_started",
    "recovery_preserved", "candidate_prepared", "completed",
  ]);

  const malformedCases = [
    {
      credentialId: "77777777-7777-4777-8777-777777777777",
      sessionId: "77777777-7777-4777-8777-777777777778",
      state: "e".repeat(64), version: 21, code: "0_137571_wrong-seller",
      payload: { ...candidate, im_country_user_info: countryRows.map((row) =>
        row.country === "ph" ? { ...row, seller_id: "999999999" } : row) },
    },
    {
      credentialId: "88888888-8888-4888-8888-888888888888",
      sessionId: "88888888-8888-4888-8888-888888888889",
      state: "f".repeat(64), version: 22, code: "0_137571_missing-country",
      payload: { ...candidate, im_country_user_info: countryRows.slice(0, 4), im_country_user_info_list: countryRows.slice(0, 4) },
    },
    {
      credentialId: "99999999-9999-4999-8999-999999999999",
      sessionId: "99999999-9999-4999-8999-999999999990",
      state: "0".repeat(64), version: 23, code: "0_137571_bad-expiry",
      payload: { ...candidate, im_access_token_expires_at: "not-a-time" },
    },
  ];
  for (const item of malformedCases) {
    const { jobId: malformedJob, claim: malformedClaim } = await seedSourceAndReachProvider(item);
    const activeBefore = await scalar("select count(*) from sellerpilot_private.channel_credentials where status='active'");
    assert.equal((await serviceRpc(
      "select public.sellerpilot_lazada_im_exact_oauth_worker('stage',$1,$2,$3,$4,$5::jsonb)",
      [item.sessionId, tokenHash, malformedJob, malformedClaim, JSON.stringify({
        refresh: { payload: item.payload, expiresAt: refreshExpiry, recoveryOnly: true },
      })],
    )).status, "recovery_preserved", `${item.code} raw response was not preserved`);
    assert.deepEqual(await scalar(`select v.decrypted_secret::jsonb
      from sellerpilot_private.lazada_im_exact_oauth_sessions s
      join vault.decrypted_secrets v on v.id=s.recovery_vault_id where s.id=$1`, [item.sessionId]), item.payload);
    await assert.rejects(() => serviceRpc(
      "select public.sellerpilot_lazada_im_exact_oauth_worker('stage',$1,$2,$3,$4,$5::jsonb)",
      [item.sessionId, tokenHash, malformedJob, malformedClaim, JSON.stringify({
        refresh: { payload: item.payload, expiresAt: refreshExpiry, recoveryOnly: false },
      })],
    ));
    assert.equal(await scalar("select count(*) from sellerpilot_private.channel_credentials where status='active'"), activeBefore,
      `${item.code} malformed recovery activated a credential`);
    assert.equal(await scalar("select prepared_credential_id is null from sellerpilot_private.lazada_im_exact_oauth_sessions where id=$1", [item.sessionId]), true);
  }
});
