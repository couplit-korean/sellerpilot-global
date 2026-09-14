import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
const migration=await readFile(new URL("../supabase/migrations/20260914153000_ebay_v210_confirmed_refresh_store.sql",import.meta.url),"utf8");
const base=await readFile(new URL("../supabase/migrations/20260821110000_harden_oauth_rotation_and_cleanup_lints.sql",import.meta.url),"utf8");
// Real deployed gateway CHECK definitions; preserve even the uncertain flight invariant.
const liveGatewayChecks=[
  {
    "conname": "channel_gateway_jobs_attempt_count_check",
    "definition": "CHECK (((attempt_count >= 0) AND (attempt_count <= 6)))"
  },
  {
    "conname": "channel_gateway_jobs_channel_check",
    "definition": "CHECK ((channel = ANY (ARRAY['qoo10'::text, 'shopee'::text, 'lazada'::text, 'coupang'::text, 'elevenst'::text, 'smartstore'::text, 'ebay'::text, 'temu'::text])))"
  },
  {
    "conname": "channel_gateway_jobs_credential_recovery_state_check",
    "definition": "CHECK ((((credential_refresh_recovery_vault_id IS NULL) AND (credential_refresh_recovery_fingerprint IS NULL) AND (credential_refresh_recovery_staged_at IS NULL)) OR ((credential_refresh_recovery_vault_id IS NOT NULL) AND (credential_refresh_recovery_fingerprint ~ '^[a-f0-9]{64}$'::text) AND (credential_refresh_recovery_staged_at IS NOT NULL))))"
  },
  {
    "conname": "channel_gateway_jobs_credential_refresh_flight_check",
    "definition": "CHECK ((credential_refresh_in_flight = (credential_refresh_started_at IS NOT NULL)))"
  },
  {
    "conname": "channel_gateway_jobs_credential_refresh_state_check",
    "definition": "CHECK ((((prepared_credential_id IS NULL) AND (credential_refresh_fingerprint IS NULL) AND (credential_refresh_prepared_at IS NULL)) OR ((prepared_credential_id IS NOT NULL) AND (credential_refresh_fingerprint ~ '^[a-f0-9]{64}$'::text) AND (credential_refresh_prepared_at IS NOT NULL))))"
  },
  {
    "conname": "channel_gateway_jobs_ebay_publication_recovery_claim_coun_check",
    "definition": "CHECK (((ebay_publication_recovery_claim_count >= 0) AND (ebay_publication_recovery_claim_count <= 2)))"
  },
  {
    "conname": "channel_gateway_jobs_environment_check",
    "definition": "CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text])))"
  },
  {
    "conname": "channel_gateway_jobs_oauth_completion_state_check",
    "definition": "CHECK (((NOT oauth_exchange_completed) OR ((operation = 'oauth.exchange'::text) AND (prepared_credential_id IS NOT NULL) AND (credential_refresh_in_flight = false) AND (credential_refresh_recovery_vault_id IS NULL))))"
  },
  {
    "conname": "channel_gateway_jobs_oauth_request_state_check",
    "definition": "CHECK ((((operation <> 'oauth.exchange'::text) AND (oauth_request_vault_id IS NULL) AND (oauth_request_fingerprint IS NULL) AND (oauth_source_credential_id IS NULL)) OR ((operation = 'oauth.exchange'::text) AND (oauth_request_fingerprint ~ '^[a-f0-9]{64}$'::text) AND (oauth_source_credential_id IS NOT NULL) AND ((status <> ALL (ARRAY['queued'::text, 'running'::text])) OR (oauth_request_vault_id IS NOT NULL)))))"
  },
  {
    "conname": "channel_gateway_jobs_operation_check",
    "definition": "CHECK ((operation = ANY (ARRAY['oauth.exchange'::text, 'shops.get'::text, 'diagnostic.test'::text, 'competitor.search'::text, 'categories.list'::text, 'categories.suggest'::text, 'categories.attributes'::text, 'categories.validate'::text, 'listing.create'::text, 'listing.update'::text, 'listing.stop'::text, 'listing.activate'::text, 'listing.lineage.verify'::text, 'listing.publication.verify'::text, 'price.update'::text, 'inventory.update'::text, 'orders.list'::text, 'orders.get'::text, 'inquiries.list'::text, 'inquiries.reply'::text, 'shipment.acknowledge'::text, 'shipment.confirm'::text]))) NOT VALID"
  },
  {
    "conname": "channel_gateway_jobs_rate_limit_count_check",
    "definition": "CHECK (((rate_limit_count >= 0) AND (rate_limit_count <= 1000)))"
  },
  {
    "conname": "channel_gateway_jobs_request_payload_check",
    "definition": "CHECK (((jsonb_typeof(request_payload) = 'object'::text) AND (octet_length((request_payload)::text) <= 128000)))"
  },
  {
    "conname": "channel_gateway_jobs_response_payload_check",
    "definition": "CHECK (((response_payload IS NULL) OR ((jsonb_typeof(response_payload) = 'object'::text) AND (octet_length((response_payload)::text) <= 1000000))))"
  },
  {
    "conname": "channel_gateway_jobs_running_claim_token_check",
    "definition": "CHECK (((status <> 'running'::text) OR (claim_token IS NOT NULL)))"
  },
  {
    "conname": "channel_gateway_jobs_seller_account_key_check",
    "definition": "CHECK (((seller_account_key IS NULL) OR (seller_account_key ~ '^[a-f0-9]{64}$'::text)))"
  },
  {
    "conname": "channel_gateway_jobs_status_check",
    "definition": "CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'reconciliation_required'::text])))"
  },
  {
    "conname": "channel_gateway_jobs_write_resource_check",
    "definition": "CHECK ((((write_resource_kind IS NULL) AND (write_resource_key IS NULL) AND (request_fingerprint IS NULL) AND (inventory_item_id IS NULL) AND (order_id IS NULL) AND (shipment_carrier IS NULL) AND (shipment_tracking IS NULL)) OR ((operation = 'listing.publication.verify'::text) AND (write_resource_kind IS NULL) AND (write_resource_key IS NULL) AND (request_fingerprint ~ '^[a-f0-9]{64}$'::text) AND (inventory_item_id IS NULL) AND (order_id IS NULL) AND (shipment_carrier IS NULL) AND (shipment_tracking IS NULL)) OR ((write_resource_kind = ANY (ARRAY['listing_mutation'::text, 'order_shipment'::text])) AND (write_resource_key ~ '^[a-f0-9]{64}$'::text) AND (request_fingerprint ~ '^[a-f0-9]{64}$'::text) AND ((shipment_carrier IS NULL) OR ((length(shipment_carrier) >= 1) AND (length(shipment_carrier) <= 40))) AND ((shipment_tracking IS NULL) OR (length(shipment_tracking) <= 100)))))"
  }
];

const sourceId="2ba31905-9879-44c4-88be-2204776fa303";
const incidentId="c9d6431c-5418-4649-9542-f30137309bf4";
const owner="21eb1892-0894-4f9f-b414-4c9464182dd6";
const admin="768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const queued="10000000-0000-4000-8000-000000000001";
const attemptBound="10000000-0000-4000-8000-000000000002";
const rpc="public.sellerpilot_service_store_ebay_v210_confirmed_refresh(uuid,jsonb,timestamptz)";
function payload(){return {access_token:"expired-fixture-access",refresh_token:"unchanged-fixture-refresh",client_id:"fixture-client",client_secret:"fixture-secret",ru_name:"fixture-runame",scopes:"https://api.ebay.com/oauth/api_scope",provider_account_identity_version:"v1",provider_account_subject:"ebay:eias:fixture-same-seller",access_token_expires_at:new Date(Date.now()-3600000).toISOString(),refresh_token_expires_at:"2028-03-13T16:44:15.612Z"};}
async function setup(){
 const db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema sellerpilot_private;create schema vault;create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
    create function vault.create_secret(text,text,text) returns uuid language plpgsql as $$declare i uuid:=gen_random_uuid();begin insert into vault.decrypted_secrets values(i,$1);return i;end$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,version integer,status text,created_by uuid,
      vault_secret_id uuid,fingerprint text,expires_at timestamptz,rotation_interval_days integer,warning_days integer,
      last_rotated_at timestamptz,last_checked_at timestamptz,last_check_status text,last_check_message text,
      grace_ends_at timestamptz,created_at timestamptz default now(),seller_account_key text,
      seller_account_key_source text,seller_account_verified_at timestamptz);
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,channel text,environment text,operation text,status text,created_by uuid,
      seller_account_key text,attempt_id uuid,request_payload jsonb default '{}',attempt_count integer default 0,
      started_at timestamptz,completed_at timestamptz,updated_at timestamptz default now(),
      provider_mutation_started_at timestamptz,credential_refresh_in_flight boolean default false,
      credential_refresh_recovery_vault_id uuid,prepared_credential_id uuid,credential_refresh_fingerprint text,
      claim_token uuid,worker_token_id uuid,lease_expires_at timestamptz,error_message text,
      credential_refresh_started_at timestamptz,credential_refresh_prepared_at timestamptz,
      credential_refresh_recovery_fingerprint text,credential_refresh_recovery_staged_at timestamptz,
      ebay_publication_recovery_claim_count integer default 0,rate_limit_count integer default 0,
      oauth_exchange_completed boolean default false,oauth_request_vault_id uuid,oauth_request_fingerprint text,
      oauth_source_credential_id uuid,response_payload jsonb,write_resource_kind text,write_resource_key text,
      request_fingerprint text,inventory_item_id uuid,order_id uuid,shipment_carrier text,shipment_tracking text);
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,credential_id uuid,owner_id uuid,channel text,operation text,status text,
      completed_at timestamptz,seller_account_key text);
    create table sellerpilot_private.credential_audit(
      id uuid primary key default gen_random_uuid(),credential_id uuid,channel text,environment text,
      action text,actor_user_id uuid,safe_detail jsonb,occurred_at timestamptz default now());
    -- Minimal Vault fixture attestation adapter. The store and authorization
    -- helper below are the actual migration bodies, never JS mocks.
    create function sellerpilot_private.fixture_lineage() returns trigger language plpgsql as $$
    declare p jsonb;begin
      if TG_OP='INSERT' then
        select decrypted_secret::jsonb into p from vault.decrypted_secrets where id=new.vault_secret_id;
        if current_setting('request.jwt.claim.role',true)='service_role' and p->>'provider_account_identity_version'='v1' then
          new.seller_account_key:=encode(sha256(convert_to(p->>'provider_account_subject','UTF8')),'hex');
          new.seller_account_key_source:='provider_certified_v1';new.seller_account_verified_at:=now();
        end if;
      end if;return new;end$$;
    create trigger fixture_lineage before insert on sellerpilot_private.channel_credentials for each row execute function sellerpilot_private.fixture_lineage();
    create table sellerpilot_private.operation_audit(id uuid default gen_random_uuid(),owner_id uuid,action text,entity_type text,entity_id text,safe_detail jsonb,occurred_at timestamptz default now());
    -- Existing claimant fixture: the migration must leave its predicate unchanged.
    create function public.sellerpilot_183000_claim_serverless_gateway_unsafe(p_token_hash text,p_worker_version text) returns jsonb language sql as $$
      select coalesce(jsonb_agg(job.id),'[]'::jsonb) from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_credentials credential on credential.id=job.credential_id
      where job.status='queued' and credential.status='active' and not exists(
        select 1 from sellerpilot_private.channel_gateway_jobs unresolved
        join sellerpilot_private.channel_credentials unresolved_credential on unresolved_credential.id=unresolved.credential_id
        where unresolved_credential.channel=credential.channel and unresolved_credential.environment=credential.environment
          and unresolved.status = 'reconciliation_required'
          and unresolved.credential_refresh_in_flight)
    $$;
  `);

 await db.exec("create table sellerpilot_private.local_channel_executor_routes(id uuid default gen_random_uuid(),credential_id uuid,owner_id uuid,operation text,enabled boolean,expires_at timestamptz)");
 for(const check of liveGatewayChecks)await db.exec(`alter table sellerpilot_private.channel_gateway_jobs add constraint ${check.conname} ${check.definition}`);
 const start=base.indexOf("create or replace function public.sellerpilot_service_refresh_ebay(");
 assert.ok(start>=0);
 await db.exec(base.slice(start,base.indexOf("$$;",start)+3));
 const storeBefore=(await db.query("select pg_get_functiondef('public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)'::regprocedure) definition,md5(prosrc) hash from pg_proc where oid='public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)'::regprocedure")).rows[0];
 const p=payload();
 await db.query("insert into vault.decrypted_secrets values($1,$2)",[sourceId,JSON.stringify(p)]);
 await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
 await db.query("insert into sellerpilot_private.channel_credentials(id,channel,environment,version,status,created_by,vault_secret_id,expires_at) values($1,'ebay','production',210,'active',$2,$1,'2028-03-13')",[sourceId,owner]);
 await db.exec("select set_config('request.jwt.claim.role','',false)");
 for(const [id,op,status,aid,createdBy] of [[incidentId,"inquiries.list","reconciliation_required",null,owner],[queued,"diagnostic.test","queued",null,owner],[attemptBound,"categories.attributes","queued","20000000-0000-4000-8000-000000000001",admin]]){
  await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,created_by,seller_account_key,attempt_id) select $1,id,channel,environment,$2,$3,$4,seller_account_key,$5 from sellerpilot_private.channel_credentials where id=$6",[id,op,status,createdBy,aid,sourceId]);
 }
 await db.query("update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=true,credential_refresh_started_at='2026-09-14T01:56:42.694693Z',started_at='2026-09-14T01:56:41.468146Z',completed_at='2026-09-14T02:06:52.436412Z',error_message='CS_PROVIDER_RESULT_REQUIRES_RECONCILIATION' where id=$1",[incidentId]);
 // Only fixture source-function hash and synthetic request body hash differ.
 const sql=migration.replace('c1fb7e1a17930e6d6b5ed390ae3cf6ca',storeBefore.hash).replace('10bb6baa8897c779e1ad67dfad50bfe8','99914b932bd37a50b983c5e7c90ae93b');
 await db.exec(sql);
 const next={...p,access_token:"new-confirmed-fixture-access",access_token_expires_at:new Date(Date.now()+7200000).toISOString(),ebay_user_id:"current-official-display-name"};
 const proof=new Date().toISOString();
 return {db,p,next,proof,storeBefore};
}
async function call(db,next,proof){
 await db.exec('set role service_role');
 try{return (await db.query('select public.sellerpilot_service_store_ebay_v210_confirmed_refresh($1,$2,$3) result',[sourceId,next,proof])).rows[0].result;}
 finally{await db.exec('reset role');}
}
async function incident(db){return (await db.query('select to_jsonb(j) row from sellerpilot_private.channel_gateway_jobs j where id=$1',[incidentId])).rows[0].row;}
async function counts(db){return (await db.query("select (select count(*)::int from sellerpilot_private.channel_credentials) credentials,(select count(*)::int from vault.decrypted_secrets) vault,(select count(*)::int from sellerpilot_private.credential_audit) audit")).rows[0];}

test('confirmed v210 STORE preserves entire uncertain job and only retargets normal queued non-attempt jobs',async()=>{
 const {db,next,proof,storeBefore}=await setup();try{
  const before=await incident(db);const saved=await call(db,next,proof);
  assert.equal(saved.version,211);assert.equal(saved.incidentPreserved,true);assert.equal(saved.replayed,false);
  assert.equal(saved.automaticQueuedCredentialRebinds,1);assert.equal(saved.inheritedLocalRoutes,0);assert.equal(saved.forcedProviderJobsStarted,0);
  assert.deepEqual(await incident(db),before);
  const jobs=(await db.query('select id,status,credential_id,created_by from sellerpilot_private.channel_gateway_jobs order by id')).rows;
  assert.equal(jobs.find(j=>j.id===queued).credential_id,saved.credentialId);
  assert.equal(jobs.find(j=>j.id===attemptBound).credential_id,sourceId);
  assert.equal(jobs.find(j=>j.id===attemptBound).created_by,admin);
  assert.equal(jobs.filter(j=>j.status==='running').length,0);
  assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='sellerpilot_private.channel_gateway_jobs'::regclass and contype='c'")).rows[0].n,17);
  assert.equal((await db.query("select pg_get_functiondef('public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)'::regprocedure) definition")).rows[0].definition,storeBefore.definition);
 }finally{await db.close();}
});

test('lost STORE response exact replay returns same v211 without another Vault write or audit',async()=>{
 const {db,next,proof}=await setup();try{
  const first=await call(db,next,proof);const before=await counts(db);const old=await incident(db);
  const replay=await call(db,next,proof);
  assert.equal(replay.credentialId,first.credentialId);assert.equal(replay.replayed,true);
  assert.deepEqual(await counts(db),before);assert.deepEqual(await incident(db),old);
  await assert.rejects(call(db,{...next,access_token:'different-confirmed-access'},proof),/REPLAY_CONFLICT/);
  await assert.rejects(call(db,next,new Date(Date.parse(proof)-1000).toISOString()),/REPLAY_CONFLICT/);
  assert.deepEqual(await counts(db),before);
 }finally{await db.close();}
});

test('same application, refresh token, scopes and provider identity cannot be substituted',async()=>{
 const {db,next,proof}=await setup();try{
  const before=await counts(db);
  for(const key of ['client_id','client_secret','refresh_token','scopes','provider_account_subject','ru_name']){
   await assert.rejects(call(db,{...next,[key]:'different-value'},proof),/PROVIDER_PROOF_INVALID/);
  }
  await assert.rejects(call(db,{...next,ebay_user_id:''},proof),/PROVIDER_PROOF_INVALID/);
  assert.deepEqual(await counts(db),before);assert.equal((await incident(db)).credential_refresh_in_flight,true);
 }finally{await db.close();}
});

test('expired or future proof and unusable access expiration cannot STORE or replay',async()=>{
 const {db,next,proof}=await setup();try{
  for(const when of [Date.now()-601000,Date.now()+31000])await assert.rejects(call(db,next,new Date(when).toISOString()),/PROVIDER_PROOF_INVALID/);
  for(const when of [Date.now()+119000,Date.now()+3*3600000+1000])await assert.rejects(call(db,{...next,access_token_expires_at:new Date(when).toISOString()},proof),/PROVIDER_PROOF_INVALID/);
  await call(db,next,proof);
  await assert.rejects(call(db,next,new Date(Date.now()-601000).toISOString()),/PROVIDER_PROOF_INVALID/);
 }finally{await db.close();}
});

test('an active eBay job or preexisting route stops fresh STORE without granting or renewing anything',async()=>{
 const {db,next,proof}=await setup();try{
  await db.query("update sellerpilot_private.channel_gateway_jobs set status='running',claim_token=gen_random_uuid() where id=$1",[queued]);
  await assert.rejects(call(db,next,proof),/SOURCE_DRIFT/);
  await db.query("update sellerpilot_private.channel_gateway_jobs set status='queued',claim_token=null where id=$1",[queued]);
  await db.query("insert into sellerpilot_private.local_channel_executor_routes(credential_id,owner_id,operation,enabled,expires_at) values($1,$2,'diagnostic.test',false,now()-interval '1 day')",[sourceId,admin]);
  await assert.rejects(call(db,next,proof),/SOURCE_DRIFT/);
  assert.equal((await counts(db)).credentials,1);
 }finally{await db.close();}
});

test('incident drift and changed source owner fail closed, including replay after successful STORE',async()=>{
 const {db,next,proof}=await setup();try{
  await db.query('update sellerpilot_private.channel_credentials set created_by=$1 where id=$2',[admin,sourceId]);
  await assert.rejects(call(db,next,proof),/SOURCE_DRIFT/);
  await db.query('update sellerpilot_private.channel_credentials set created_by=$1 where id=$2',[owner,sourceId]);
  await call(db,next,proof);
  await db.query("update sellerpilot_private.channel_gateway_jobs set updated_at=now()+interval '1 second' where id=$1",[incidentId]);
  await assert.rejects(call(db,next,proof),/REPLAY_CONFLICT/);
 }finally{await db.close();}
});

test('unexpected lower-layer change to the preserved job aborts the whole credential transaction',async()=>{
 const {db,next,proof}=await setup();try{
  const before=await incident(db);
  await db.exec(`create function sellerpilot_private.fixture_unwanted_mutation() returns trigger language plpgsql as $$begin update sellerpilot_private.channel_gateway_jobs set updated_at=now()+interval '1 second' where id='${incidentId}';return new;end$$;
  create trigger fixture_unwanted_mutation after insert on sellerpilot_private.channel_credentials for each row execute function sellerpilot_private.fixture_unwanted_mutation();`);
  await assert.rejects(call(db,next,proof),/READBACK_FAILED/);
  assert.deepEqual(await incident(db),before);assert.equal((await counts(db)).credentials,1);
 }finally{await db.close();}
});

test('service-only ACL and 25-second function setting preserve existing global role and historical function',async()=>{
 const {db,next,proof}=await setup();try{
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(db.query('select public.sellerpilot_service_store_ebay_v210_confirmed_refresh($1,$2,$3)',[sourceId,next,proof]),/permission denied/);
   await db.exec('reset role');
  }
  const conf=(await db.query('select proconfig from pg_proc where oid=$1::regprocedure',[rpc])).rows[0].proconfig;
  assert.ok(conf.includes('statement_timeout=25s'));
  assert.equal((await db.query("select current_setting('request.jwt.claim.role',true) role")).rows[0].role,'');
 }finally{await db.close();}
});

test('a changed lower STORE definition is rejected before migration can create or replace anything',async()=>{
 const {db,storeBefore}=await setup();try{
  const invalid=migration.replace('c1fb7e1a17930e6d6b5ed390ae3cf6ca','00000000000000000000000000000000');
  await assert.rejects(db.exec(invalid),/EBAY_V210_REFRESH_PREIMAGE_DRIFT/);
  await db.exec('rollback');
  assert.equal((await db.query("select pg_get_functiondef('public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)'::regprocedure) definition")).rows[0].definition,storeBefore.definition);
  assert.equal((await counts(db)).credentials,1);
 }finally{await db.close();}
});
