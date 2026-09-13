import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {ensureEbayAccessToken} from "../lib/channels/protocols.ts";
import {validateSource,sourceCredentialId as oldId} from "../scripts/ebay-exact-listing-read-refresh.mjs";

const migration=await readFile(new URL("../supabase/migrations/20260914131500_ebay_exact_listing_read_refresh_supersession.sql",import.meta.url),"utf8");
const base=await readFile(new URL("../supabase/migrations/20260821110000_harden_oauth_rotation_and_cleanup_lints.sql",import.meta.url),"utf8");
const owner="21eb1892-0894-4f9f-b414-4c9464182dd6";
const oldJob="42f87fd2-8583-47c1-85f0-7e3ff436ad4a";
const category="d49fcf37-32b6-41f5-a822-0f9bc99b51de";
const diagnostic="1654d17e-2ef7-421d-b90f-6bf0e536e626";
const attempt="cd5e52d7-2819-48ba-adab-de0e5dbfe9ed";
const rpc="public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz)";
function payload() {return {access_token:"expired-fixture-access",refresh_token:"same-fixture-refresh",client_id:"fixture-client",client_secret:"fixture-secret",ru_name:"fixture-runame",scopes:"https://api.ebay.com/oauth/api_scope",provider_account_identity_version:"v1",provider_account_subject:"ebay:eias:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",access_token_expires_at:new Date(Date.now()-3600000).toISOString(),refresh_token_expires_at:"2028-03-13T16:44:15.612Z"};}
async function setup() {
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
      claim_token uuid,worker_token_id uuid,lease_expires_at timestamptz,error_message text);
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
  await db.query("update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=true,error_message='CS_PROVIDER_RESULT_REQUIRES_RECONCILIATION',started_at='2026-09-13T16:19:43Z',completed_at='2026-09-13T16:29:54Z' where id=$1",[oldJob]);
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
