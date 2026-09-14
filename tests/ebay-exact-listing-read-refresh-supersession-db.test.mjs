import assert from "node:assert/strict";
import {readFile,mkdtemp,rm,stat,writeFile,chmod,symlink,link,unlink} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {ensureEbayAccessToken} from "../lib/channels/protocols.ts";
import {validateSource,sourceCredentialId as oldId,writeConfirmedRefreshEvidence,readConfirmedRefreshEvidence,validateConfirmedRefresh,safeStoreError} from "../scripts/ebay-exact-listing-read-refresh.mjs";

const migration=await readFile(new URL("../supabase/migrations/20260914131500_ebay_exact_listing_read_refresh_supersession.sql",import.meta.url),"utf8");
const base=await readFile(new URL("../supabase/migrations/20260821110000_harden_oauth_rotation_and_cleanup_lints.sql",import.meta.url),"utf8");
// All 17 deployed channel_gateway_jobs CHECK definitions, read 2026-09-14.
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
const owner="21eb1892-0894-4f9f-b414-4c9464182dd6";
const oldJob="42f87fd2-8583-47c1-85f0-7e3ff436ad4a";
const category="d49fcf37-32b6-41f5-a822-0f9bc99b51de";
const diagnostic="1654d17e-2ef7-421d-b90f-6bf0e536e626";
const attempt="cd5e52d7-2819-48ba-adab-de0e5dbfe9ed";
const rpc="public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz)";
function payload() {return {access_token:"expired-fixture-access",refresh_token:"same-fixture-refresh",client_id:"fixture-client",client_secret:"fixture-secret",ru_name:"fixture-runame",scopes:"https://api.ebay.com/oauth/api_scope",provider_account_identity_version:"v1",provider_account_subject:"ebay:eias:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",access_token_expires_at:new Date(Date.now()-3600000).toISOString(),refresh_token_expires_at:"2028-03-13T16:44:15.612Z"};}
async function setup({currentChecks=false}={}) {
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
  if(currentChecks)for(const check of liveGatewayChecks) {
    assert.match(check.conname,/^[a-z0-9_]+$/);
    await db.exec(`alter table sellerpilot_private.channel_gateway_jobs add constraint ${check.conname} ${check.definition}`);
  }
  const start=base.indexOf("create or replace function public.sellerpilot_service_refresh_ebay(");
  assert.ok(start>=0);
  await db.exec(base.slice(start,base.indexOf("$$;",start)+3));
  await db.exec(`revoke all on function public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz) from public;grant execute on function public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz) to service_role`);
  const p=payload();
  await db.query("insert into vault.decrypted_secrets values($1,$2)",[oldId,JSON.stringify(p)]);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query(`insert into sellerpilot_private.channel_credentials(id,channel,environment,version,status,created_by,vault_secret_id,expires_at) values($1,'ebay','production',209,'active',$2,$1,'2028-03-13')`,[oldId,owner]);
  await db.exec("select set_config('request.jwt.claim.role','',false)");
  for(const [id,operation,status,aid] of [[oldJob,"inquiries.list","reconciliation_required",null],[category,"categories.suggest","queued",attempt],[diagnostic,"diagnostic.test","queued",null]]) {
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,created_by,seller_account_key,attempt_id)
      select $1,id,channel,environment,$2,$3,created_by,seller_account_key,$4 from sellerpilot_private.channel_credentials where id=$5`,[id,operation,status,aid,oldId]);
  }
  await db.query("update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=true,credential_refresh_started_at='2026-09-13T16:19:44.510642Z',error_message='CS_PROVIDER_RESULT_REQUIRES_RECONCILIATION',started_at='2026-09-13T16:19:43Z',completed_at='2026-09-13T16:29:54Z' where id=$1",[oldJob]);
  await db.query(`insert into sellerpilot_private.channel_operation_attempts select $1,id,created_by,channel,'categories.suggest','running',null,seller_account_key from sellerpilot_private.channel_credentials where id=$2`,[attempt,oldId]);
  // Existing 310 reads remain queued; only normal credential retarget applies.
  // No test or migration claims, cancels or sends any of those operations.
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,created_by,seller_account_key)
    select gen_random_uuid(),id,channel,environment,case when n=310 then 'orders.list' else 'inquiries.list' end,'queued',created_by,seller_account_key
      from sellerpilot_private.channel_credentials cross join generate_series(1,310) n where id=$1`,[oldId]);
  const hashes=(await db.query("select proname,md5(prosrc) h from pg_proc where proname in ('sellerpilot_service_refresh_ebay','sellerpilot_183000_claim_serverless_gateway_unsafe')")).rows;
  const map=Object.fromEntries(hashes.map(r=>[r.proname,r.h]));
  // Replace only fixture preimages and synthetic request hashes. All new SQL,
  // grants, store and final readback predicates run intact; existing functions stay unchanged.
  const sql=migration.replace("c1fb7e1a17930e6d6b5ed390ae3cf6ca",map.sellerpilot_service_refresh_ebay)
    .replace("805c08c3a73270392247723a31a30015",map.sellerpilot_183000_claim_serverless_gateway_unsafe)
    .replaceAll("b38ca4ed4dc71a8742726af8cda10957","99914b932bd37a50b983c5e7c90ae93b")
    .replaceAll("da030658def38a3c2939366c1eebafa5","99914b932bd37a50b983c5e7c90ae93b");
  return {db,p,sql};
}
async function save(db,p,changes={}) {
  const next={...p,access_token:"new-confirmed-fixture-access",access_token_expires_at:new Date(Date.now()+7200000).toISOString(),ebay_user_id:"official-current-display-name",...changes};
  await db.exec("set role service_role");
  try {return (await db.query("select public.sellerpilot_service_store_ebay_exact_listing_refresh($1,$2,$3) result",[oldId,next,new Date().toISOString()])).rows[0].result;}
  finally {await db.exec("reset role").catch(()=>{});}
}
async function eligible(db){return (await db.query("select public.sellerpilot_183000_claim_serverless_gateway_unsafe('fixture','fixture') ids")).rows[0].ids.sort();}
test("confirmed refresh restores normal eligibility without changing claimant or old inquiry outcome",async()=>{
  const {db,p,sql}=await setup();try {
    const definitions=(await db.query("select proname,pg_get_functiondef(oid) def from pg_proc where proname in ('sellerpilot_service_refresh_ebay','sellerpilot_183000_claim_serverless_gateway_unsafe') order by proname")).rows;
    const before=(await db.query("select to_jsonb(j) row from sellerpilot_private.channel_gateway_jobs j where id=$1",[oldJob])).rows[0].row;
    assert.deepEqual(await eligible(db),[]);
    await db.exec(sql);
    assert.deepEqual((await db.query("select proname,pg_get_functiondef(oid) def from pg_proc where proname in ('sellerpilot_service_refresh_ebay','sellerpilot_183000_claim_serverless_gateway_unsafe') order by proname")).rows,definitions);
    assert.deepEqual(await eligible(db),[]);
    const saved=await save(db,p);
    assert.equal(saved.version,210);assert.equal(saved.forcedProviderJobsStarted,0);
    assert.equal(saved.automaticQueuedCredentialRebinds,311);
    assert.equal((await eligible(db)).length,312);
    const after=(await db.query("select to_jsonb(j) row from sellerpilot_private.channel_gateway_jobs j where id=$1",[oldJob])).rows[0].row;
    assert.deepEqual(after,{...before,credential_refresh_in_flight:false});
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status='queued' and credential_id=$1",[saved.credentialId])).rows[0].n,312);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status in ('running','cancelled','succeeded')")).rows[0].n,0);
    assert.equal((await db.query("select credential_id from sellerpilot_private.channel_operation_attempts where id=$1",[attempt])).rows[0].credential_id,saved.credentialId);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.operation_audit where action='ebay_confirmed_refresh_supersession'")).rows[0].n,1);
    assert.equal((await db.query("select current_setting('request.jwt.claim.role',true) role")).rows[0].role,"");
    // Later standard preparation is eligible too; there is no two-job allowlist.
    await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status) values(gen_random_uuid(),$1,'ebay','production','categories.attributes','queued')",[saved.credentialId]);
    assert.equal((await eligible(db)).length,313);
    await assert.rejects(save(db,p),/SOURCE_DRIFT/);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_credentials")).rows[0].n,2);
    // Another unresolved refresh continues to enforce the unchanged fence.
    await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,credential_refresh_in_flight) values(gen_random_uuid(),$1,'ebay','production','inquiries.list','reconciliation_required',true)",[saved.credentialId]);
    assert.deepEqual(await eligible(db),[]);
  }finally{await db.close();}
});

test("official helper ebay_user_id additions or changes are allowed, immutable user_id and grant fields are not",async()=>{
  const {db,p,sql}=await setup();try {
    await db.exec(sql);
    for(const changes of [{user_id:"unrelated-field-change"},{refresh_token:"changed"},{scopes:"expanded"},{provider_account_subject:"ebay:eias:other"},{client_secret:"changed"},{access_token_expires_at:null},{access_token_expires_at:"2000-01-01"}]) {
      await assert.rejects(save(db,p,changes),/PROVIDER_PROOF_INVALID/);
      assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_credentials")).rows[0].n,1);
    }
    const saved=await save(db,p,{ebay_user_id:"same-EIAS-new-username"});
    assert.ok(saved.credentialId);
    const fresh=(await db.query("select d.decrypted_secret::jsonb p from vault.decrypted_secrets d join sellerpilot_private.channel_credentials c on c.vault_secret_id=d.id where c.id=$1",[saved.credentialId])).rows[0].p;
    assert.equal(fresh.ebay_user_id,"same-EIAS-new-username");
    assert.equal(fresh.provider_account_subject,p.provider_account_subject);
    const protocol=await readFile(new URL("../lib/channels/protocols.ts",import.meta.url),"utf8");
    assert.match(protocol,/providerAccount\.userId \? \{ ebay_user_id: providerAccount\.userId \}/);
  }finally{await db.close();}
});

test("wrong provider facts and source/target drift roll back without a new credential or queue mutation",async()=>{
  const {db,p,sql}=await setup();try {
    await db.exec(sql);
    for(const patch of [{refresh_token:"different"},{scopes:"expanded"},{provider_account_subject:"ebay:eias:other"},{client_secret:"different"}]) {
      await assert.rejects(save(db,{...p,...patch}),/PROVIDER_PROOF_INVALID/);
      assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_credentials")).rows[0].n,1);
    }
    for(const mutation of [
      `update sellerpilot_private.channel_gateway_jobs set attempt_count=1 where id='${category}'`,
      `update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=now() where id='${oldJob}'`,
      `update sellerpilot_private.channel_gateway_jobs set seller_account_key='different-seller' where id='${oldJob}'`,
      "update sellerpilot_private.channel_credentials set version=211",
    ]) {
      await db.exec("begin");await db.exec(mutation);await assert.rejects(save(db,p),/DRIFT/);await db.exec("rollback");
    }
    // A late identity/attempt mismatch must roll back the existing service saver.
    await db.exec(`update sellerpilot_private.channel_operation_attempts set status='cancelled'`);
    await assert.rejects(save(db,p),/ATTEMPT_DRIFT/);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_credentials")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where credential_id=$1",[oldId])).rows[0].n,313);
  }finally{await db.close();}
});

test("actual ensureEbayAccessToken output with GetUser ebay_user_id persists unchanged",async()=>{
  for(const previousName of [undefined,"previous-name"]) {
    const {db,p,sql}=await setup();const realFetch=globalThis.fetch;
    try {
      if(previousName) {p.ebay_user_id=previousName;await db.query("update vault.decrypted_secrets set decrypted_secret=$1 where id=$2",[JSON.stringify(p),oldId]);}
      await db.exec(sql);let calls=0;
      globalThis.fetch=async(url,init)=>{
        calls++;
        if(String(url)==="https://api.ebay.com/identity/v1/oauth2/token") {
          assert.equal(new URLSearchParams(init.body).get("grant_type"),"refresh_token");
          assert.equal(new URLSearchParams(init.body).get("refresh_token"),p.refresh_token);
          return new Response(JSON.stringify({access_token:"official-fixture-issued-access",expires_in:7200,token_type:"User Access Token"}),{status:200,headers:{"content-type":"application/json"}});
        }
        assert.equal(String(url),"https://api.ebay.com/ws/api.dll");
        assert.equal(init.headers["x-ebay-api-call-name"],"GetUser");
        return new Response(`<GetUserResponse><Ack>Success</Ack><User><UserID>current-name</UserID><EIASToken>${p.provider_account_subject.slice("ebay:eias:".length)}</EIASToken></User></GetUserResponse>`,{status:200});
      };
      const ensured=await ensureEbayAccessToken(p,"production",undefined,undefined,undefined,true);
      globalThis.fetch=realFetch;
      assert.equal(calls,2);assert.equal(ensured.payload.ebay_user_id,"current-name");
      const saved=await save(db,p,ensured.payload);
      assert.equal(saved.version,210);
    }finally{globalThis.fetch=realFetch;await db.close();}
  }
});

test("privileges, repeat apply and preimage drift fail closed",async()=>{
  const {db,sql}=await setup();try {
    await db.exec(sql);
    for(const role of ["anon","authenticated"])assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,rpc])).rows[0].ok,false);
    assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') ok",[rpc])).rows[0].ok,true);
    await assert.rejects(db.exec(sql),/ALREADY_DEFINED/);await db.exec("rollback");
  }finally{await db.close();}
  const other=await setup();try {
    await other.db.exec("create or replace function public.sellerpilot_service_refresh_ebay(p_credential_id uuid,p_secret_payload jsonb,p_expires_at timestamptz) returns uuid language sql as $$select $1$$");
    await assert.rejects(other.db.exec(other.sql),/PREIMAGE_DRIFT/);await other.db.exec("rollback");
    assert.equal((await other.db.query("select to_regprocedure($1) f",[rpc])).rows[0].f,null);
  }finally{await other.db.close();}
});

test("operator source validation never upgrades a changed account or an already refreshed token",()=>{
  const s={id:oldId,version:209,status:"active",created_by:owner,channel:"ebay",environment:"production",seller_account_key_source:"provider_certified_v1",identity_verified:true,payload:payload()};
  assert.equal(validateSource(s),s.payload);
  for(const patch of [{version:210},{status:"revoked"},{created_by:oldId},{identity_verified:false}])assert.throws(()=>validateSource({...s,...patch}),/SOURCE_DRIFT/);
  assert.throws(()=>validateSource({...s,payload:{...s.payload,access_token_expires_at:"2099-01-01"}}),/TOKEN_STATE_INVALID/);
  assert.throws(()=>validateSource({...s,payload:{...s.payload,refresh_token_expires_at:"2000-01-01"}}),/TOKEN_STATE_INVALID/);
});

test("confirmed response survives STORE failure with private authenticated evidence; tamper or drift cannot resume",async()=>{
  const directory=await mkdtemp("/private/tmp/sellerpilot-ebay-evidence-test-");
  const source={id:oldId,version:209,status:"active",created_by:owner,channel:"ebay",environment:"production",seller_account_key_source:"provider_certified_v1",identity_verified:true,payload:payload()};
  const serviceKey="fixture-service-key-never-a-real-secret";
  const options={source,serviceKey,directory};
  try {
    assert.equal(await readConfirmedRefreshEvidence(options),null);
    const next={...source.payload,access_token:"fixture-issued-token-for-store-only",access_token_expires_at:new Date(Date.now()+7200000).toISOString(),ebay_user_id:"verified-name"};
    const verifiedAt=new Date().toISOString();
    const saved=await writeConfirmedRefreshEvidence({...options,payload:next,verifiedAt});
    assert.equal((await stat(saved.path)).mode&0o777,0o600);
    assert.equal((await stat(directory)).mode&0o777,0o700);
    assert.equal((await stat(saved.path)).nlink,1);
    const evidence=await readConfirmedRefreshEvidence(options);
    assert.deepEqual(evidence.payload,next);assert.equal(evidence.verifiedAt,verifiedAt);
    await assert.rejects(writeConfirmedRefreshEvidence({...options,payload:next,verifiedAt}),/EXISTS_USE_RESUME_STORE/);
    await assert.rejects(readConfirmedRefreshEvidence({...options,serviceKey:"different-fixture-service-key"}),/EVIDENCE_INVALID/);
    await assert.rejects(readConfirmedRefreshEvidence({...options,source:{...source,version:210}}),/SOURCE_DRIFT/);
    assert.throws(()=>validateConfirmedRefresh(source,evidence,Date.now()+601000),/PROOF_EXPIRED/);
    const original=await readFile(saved.path,"utf8");
    const changed=JSON.parse(original);changed.body=changed.body.replace("verified-name","forged-name");
    changed.digest=createHash("sha256").update(changed.body).digest("hex");
    await writeFile(saved.path,JSON.stringify(changed));
    await assert.rejects(readConfirmedRefreshEvidence(options),/EVIDENCE_INVALID/);
    await writeFile(saved.path,original);
    await chmod(saved.path,0o644);await assert.rejects(readConfirmedRefreshEvidence(options),/EVIDENCE_INVALID/);await chmod(saved.path,0o600);
    const other=join(directory,"hardlink");await link(saved.path,other);
    await assert.rejects(readConfirmedRefreshEvidence(options),/EVIDENCE_INVALID/);await unlink(other);
    await unlink(saved.path);await writeFile(other,original,{mode:0o600});await symlink(other,saved.path);
    await assert.rejects(readConfirmedRefreshEvidence(options),/EVIDENCE_INVALID/);
    assert.deepEqual((await readFile(other,"utf8")),original);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("STORE error classification emits static diagnostics without SQL, tokens or arbitrary server text",()=>{
  assert.match(safeStoreError(500,{code:"42702",message:'column reference "credential_id" is ambiguous'}),/42702_AMBIGUOUS_COLUMN/);
  assert.match(safeStoreError(500,{code:"P0001",message:"EBAY_EXACT_READ_REFRESH_ATTEMPT_DRIFT"}),/ATTEMPT_DRIFT/);
  const result=safeStoreError(500,{code:"P0001",message:"SQL secret-access-token fixture",details:"select token",hint:"private refresh token"});
  assert.match(result,/P0001_DATABASE_EXCEPTION/);assert.doesNotMatch(result,/secret|token|select|private/);
  assert.doesNotMatch(safeStoreError(500,{code:"private-secret",message:"credential plaintext"}),/private-secret|plaintext/);
});

test("forward patch accepts actual shared admin attempt without rewriting either owner, and rejects revoked access",async()=>{
  const {db,p,sql}=await setup();const actor="768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  try {
    await db.exec(sql);
    await db.exec(`create schema auth;create table sellerpilot_private.admin_users(user_id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;`);
    const adminBase=await readFile(new URL("../supabase/migrations/20260816060000_channel_credentials_and_roles.sql",import.meta.url),"utf8");
    const adminStart=adminBase.indexOf("create or replace function public.sellerpilot_is_admin()");
    assert.ok(adminStart>=0);await db.exec(adminBase.slice(adminStart,adminBase.indexOf("$$;",adminStart)+3));
    await db.exec(await readFile(new URL("../supabase/migrations/20260906010000_verify_channel_credential_owner.sql",import.meta.url),"utf8"));
    await db.query("insert into sellerpilot_private.admin_users values($1),($2)",[actor,owner]);
    await db.query("update sellerpilot_private.channel_operation_attempts set owner_id=$1 where id=$2",[actor,attempt]);
    // Execute the existing official shared-admin proof with the actual fixture
    // actor; no production impersonation is added to the service-only patch.
    await db.query("select set_config('test.uid',$1,false)",[actor]);await db.exec("set role authenticated");
    const proof=(await db.query("select public.sellerpilot_verify_channel_credential_owner_v1($1,'ebay','production') p",[oldId])).rows[0].p;
    assert.equal(proof.actorId,actor);assert.equal(proof.credentialOwnerId,owner);await db.exec("reset role");
    await assert.rejects(save(db,p),/ATTEMPT_DRIFT/);
    const forward=await readFile(new URL("../supabase/migrations/20260914132500_ebay_exact_refresh_shared_admin_attempt.sql",import.meta.url),"utf8");
    const h=(await db.query("select md5(prosrc) h from pg_proc where oid=$1::regprocedure",[rpc])).rows[0].h;
    const fixed=forward.replace("03ece524ce771a6820b661b788bd2cd1",h);
    const unchanged=(await db.query("select proname,pg_get_functiondef(oid) d from pg_proc where proname in ('sellerpilot_service_refresh_ebay','sellerpilot_183000_claim_serverless_gateway_unsafe') order by proname")).rows;
    await db.exec(fixed);
    assert.deepEqual((await db.query("select proname,pg_get_functiondef(oid) d from pg_proc where proname in ('sellerpilot_service_refresh_ebay','sellerpilot_183000_claim_serverless_gateway_unsafe') order by proname")).rows,unchanged);
    await db.query("delete from sellerpilot_private.admin_users where user_id=$1",[actor]);
    await assert.rejects(save(db,p),/SHARED_ADMIN_DENIED/);
    await db.query("insert into sellerpilot_private.admin_users values($1)",[actor]);
    await db.query("update sellerpilot_private.channel_operation_attempts set owner_id=$1 where id=$2",[owner,attempt]);
    await assert.rejects(save(db,p),/ATTEMPT_DRIFT/);
    await db.query("update sellerpilot_private.channel_operation_attempts set owner_id=$1 where id=$2",[actor,attempt]);
    const saved=await save(db,p);
    const actual=(await db.query("select a.owner_id,c.created_by,j.created_by job_owner from sellerpilot_private.channel_operation_attempts a join sellerpilot_private.channel_credentials c on c.id=a.credential_id join sellerpilot_private.channel_gateway_jobs j on j.attempt_id=a.id where a.id=$1",[attempt])).rows[0];
    assert.deepEqual(actual,{owner_id:actor,created_by:owner,job_owner:owner});
    assert.equal(saved.version,210);assert.equal((await eligible(db)).length,312);
    await assert.rejects(db.exec(fixed),/PREIMAGE_DRIFT/);await db.exec("rollback");
  }finally{await db.close();}
});

test("all 17 deployed CHECKs reproduce flight failure, then forward supersession preserves its timestamp in both audits",async()=>{
  const {db,p,sql}=await setup({currentChecks:true});const actor="768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  try {
    await db.exec(sql);
    await db.exec("create table sellerpilot_private.admin_users(user_id uuid primary key)");
    await db.query("insert into sellerpilot_private.admin_users values($1)",[actor]);
    await db.query("update sellerpilot_private.channel_operation_attempts set owner_id=$1 where id=$2",[actor,attempt]);
    const shared=await readFile(new URL("../supabase/migrations/20260914132500_ebay_exact_refresh_shared_admin_attempt.sql",import.meta.url),"utf8");
    let h=(await db.query("select md5(prosrc) h from pg_proc where oid=$1::regprocedure",[rpc])).rows[0].h;
    await db.exec(shared.replace("03ece524ce771a6820b661b788bd2cd1",h));
    await assert.rejects(save(db,p),error=>error.code==="23514" && error.constraint==="channel_gateway_jobs_credential_refresh_flight_check");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_credentials")).rows[0].n,1);
    const deployed=(await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='sellerpilot_private.channel_gateway_jobs'::regclass and contype='c' order by conname")).rows;
    assert.deepEqual(deployed,liveGatewayChecks);
    const flight=await readFile(new URL("../supabase/migrations/20260914133500_ebay_exact_refresh_flight_consistency.sql",import.meta.url),"utf8");
    h=(await db.query("select md5(prosrc) h from pg_proc where oid=$1::regprocedure",[rpc])).rows[0].h;
    const fixed=flight.replace("c8face602aebf60da821a0de58a9039a",h);
    const before=(await db.query("select to_jsonb(j) value from sellerpilot_private.channel_gateway_jobs j where id=$1",[oldJob])).rows[0].value;
    await db.exec(fixed);const saved=await save(db,p);
    const after=(await db.query("select to_jsonb(j) value from sellerpilot_private.channel_gateway_jobs j where id=$1",[oldJob])).rows[0].value;
    assert.deepEqual(after,{...before,credential_refresh_in_flight:false,credential_refresh_started_at:null});
    const audit=(await db.query("select safe_detail from sellerpilot_private.operation_audit where entity_id=$1",[oldJob])).rows[0].safe_detail;
    const credentialAudit=(await db.query("select safe_detail from sellerpilot_private.credential_audit where credential_id=$1 and safe_detail->>'source'='exact_confirmed_refresh_supersession_v1'",[saved.credentialId])).rows[0].safe_detail;
    assert.equal(Date.parse(audit.supersededRefreshStartedAt),Date.parse(before.credential_refresh_started_at));
    assert.equal(Date.parse(credentialAudit.supersededRefreshStartedAt),Date.parse(before.credential_refresh_started_at));
    assert.equal((await db.query("select owner_id from sellerpilot_private.channel_operation_attempts where id=$1",[attempt])).rows[0].owner_id,actor);
    assert.equal((await eligible(db)).length,312);
    await assert.rejects(db.exec(fixed),/PREIMAGE_DRIFT/);await db.exec("rollback");
  }finally{await db.close();}
});
