// Verification limits: current exported business-function DDL, real table
// constraints/triggers, gateway completion cleanup, receipts and general reaper
// run in PGlite/WASM. Vault encryption is a synthetic storage adapter. Historic
// synthetic seed rows load before current insert-lineage triggers are enabled.
// Adversarial corruption uses rollback-only fixture writes, never production.
// This is NOT native PostgreSQL ownership/ACL/native-extension validation,
// multi-connection race proof, real provider OAuth/network, deployment or E2E.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {tsImport} from 'tsx/esm/api';
const {runLazadaExactJob}=await tsImport('../lib/channels/lazada-oauth-exact.ts',import.meta.url);
import {unseal} from '../scripts/db-baseline-export.mjs';
const folder=process.env.SELLERPILOT_BASELINE_FOLDER??'/Users/kimchangheemac/.aside/u/0/backups/sellerpilot/20260905-974d4cb-v4/';
const baseline=unseal(await readFile(folder+'baseline.enc','utf8'),await readFile(folder+'baseline.key'));
const migration=await readFile(new URL('../supabase/migrations/20260906060000_lazada_exact_oauth_executor.sql',import.meta.url),'utf8');
const shopee300Url=new URL('../supabase/migrations/20260906030000_shopee_exact_oauth_executor.sql',import.meta.url);
const lazada500Url=new URL('../supabase/migrations/20260906050000_bind_lazada_oauth_to_authoritative_seller.sql',import.meta.url);
const shopee300=await readFile(shopee300Url,'utf8'),lazada500=await readFile(lazada500Url,'utf8');
after(async()=>{
 assert.equal(await readFile(shopee300Url,'utf8'),shopee300,'BC_300_CHANGED_DURING_RUN_RETEST_FINAL_VERSION');
 assert.equal(await readFile(lazada500Url,'utf8'),lazada500,'FROZEN_500_CHANGED_DURING_RUN');
 assert.equal(await readFile(new URL('../supabase/migrations/20260906060000_lazada_exact_oauth_executor.sql',import.meta.url),'utf8'),migration,'FROZEN_600_CHANGED_DURING_RUN');
});
const owner='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',credential='e54fa95d-ddfd-414f-82e9-636a0d9ab07c',session='33333333-3333-4333-8333-333333333333',token='02955cb4-fa9f-466b-824f-b61f06276190',hash='a'.repeat(64);
async function scalar(db,sql,p=[]){return Object.values((await db.query(sql,p)).rows[0])[0];}
const genericDefinitionSql="select pg_get_functiondef('public.sellerpilot_claim_channel_gateway_job(text,text)'::regprocedure)";
const reaperDefinitionSql="select pg_get_functiondef('public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)'::regprocedure)";
const shopeeDefinitionsSql="select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,md5(pg_get_functiondef(p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','sellerpilot_private') and p.proname like '%shopee_exact%' order by 1,2,3";
async function fixture({executionActor="11111111-1111-4111-8111-111111111111",workerIssuer=executionActor}={}){
 const db=new PGlite({extensions:{pgcrypto}});
 try {
 await db.exec('set check_function_bodies=off; create schema extensions; create extension pgcrypto with schema extensions; create schema vault;');
 for(const role of baseline.roles){if(role.name==='postgres')continue;await db.exec(`do $$begin create role "${role.name.replaceAll('"','""')}";exception when duplicate_object then null;end$$;`);}
 // Function-body composition fixture, not a native ownership/ACL restore.
 const selected=o=>/^(public|sellerpilot_private|auth)(\.|$)/.test(o.identity);
 for(const kind of ['schema','enum','sequence','table','function','default','constraint','index','foreign-key','trigger','policy','rls']){
  for(const o of baseline.objects.filter(o=>o.kind===kind&&selected(o))){
   if(kind==='constraint'&&/ADD CONSTRAINT .* TRIGGER /.test(o.ddl)) {
    assert.ok(baseline.objects.some(t=>t.kind==='trigger'&&t.identity===o.identity));
    continue; // Same constraint is restored by its complete CREATE CONSTRAINT TRIGGER.
   }
   // Captured bundle omits the composite referenced unique index. This FK
   // belongs only to tracx, is never executed here, and is not invented/repaired.
   if(kind==='foreign-key'&&o.ddl.includes('ADD CONSTRAINT tracx_order_bindings_order_owner_fkey')) continue;
   const sql=o.ddl;
   try{await db.exec(sql);}catch(e){throw Error(`preimage ${kind} ${o.identity}: ${e.message}`);}
  }
 }
 // Supabase Vault encryption extension is unavailable in WASM. Only its storage
 // adapter is emulated; every SellerPilot business function remains preimage DDL.
 await db.exec(`create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text,description text,created_at timestamptz default now(),updated_at timestamptz default now());
 create view vault.decrypted_secrets as select *,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid language plpgsql as $$declare v uuid;begin insert into vault.secrets(secret,name,description)values(new_secret,new_name,new_description)returning id into v;return v;end$$;
 create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void language sql as $$update vault.secrets set secret=coalesce(new_secret,secret),name=coalesce(new_name,name),description=coalesce(new_description,description) where id=secret_id$$;
 create function vault.delete_secret(secret_id uuid) returns void language sql as $$delete from vault.secrets where id=secret_id$$;
 insert into auth.users(id)values('${owner}'),('11111111-1111-4111-8111-111111111111');insert into sellerpilot_private.admin_users(user_id,display_name)values('${owner}','Fixture owner'),('11111111-1111-4111-8111-111111111111','Shared admin actor');
 insert into auth.users(id) values('${workerIssuer}') on conflict do nothing;
 insert into vault.secrets(id,secret) values('${credential}','{"app_key":"137451","app_secret":"fixture-commerce","country":"my","access_token":"fixture-old","refresh_token":"fixture-old-refresh","im_app_key":"137571","im_app_secret":"fixture-im","im_access_token":"fixture-im-token"}');
 alter table sellerpilot_private.channel_credentials disable trigger user;
 insert into sellerpilot_private.channel_credentials(id,channel,environment,status,vault_secret_id,created_by,expires_at,version,fingerprint,seller_account_key_source) values('${credential}','lazada','production','active','${credential}','${owner}',now()+interval '90 days',5,'fixturekey12','legacy_unattested');
 alter table sellerpilot_private.channel_credentials enable trigger user;
 insert into sellerpilot_private.ai_cli_worker_tokens(id,token_hash,scope,status,created_by,expires_at,label,fingerprint)values('${token}','${hash}','gateway','active','${workerIssuer}','2026-11-28T07:41:58.603499+00:00'::timestamptz,'Fixture exact worker','fixturekey12');`);
 // Restore this exact function's captured owner/revoke/grants, not a made-up
 // ACL or a modified business body. Broader native restore remains unproven.
 for(const entry of baseline.objects.filter(o=>['owner','revoke','grant'].includes(o.kind)&&o.ddl.includes('sellerpilot_service_reap_stale_channel_gateway_jobs(')))await db.exec(entry.ddl);
 await db.exec(shopee300);
 const sharedContractSql="select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,md5(pg_get_functiondef(p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('worker_token_has_scope','worker_token_may_complete_gateway_job','sellerpilot_service_gateway_completion_context','sellerpilot_service_complete_gateway_transaction','sellerpilot_11820_complete_gateway_unsafe') and n.nspname in('public','sellerpilot_private') order by 1,2,3";
 const originalSharedContract=(await db.query(sharedContractSql)).rows;
 const genericAfter300=await scalar(db,genericDefinitionSql);
 const reaperAfter300=await scalar(db,reaperDefinitionSql);
 const shopeeAfter300=(await db.query(shopeeDefinitionsSql)).rows;
 await db.exec(lazada500);
 // Seed pre-existing historical rows before enabling current insert-lineage hooks.
 // This changes fixture loading only, not any business function definition.
 await db.exec('alter table sellerpilot_private.channel_gateway_jobs disable trigger user');
 await db.exec(`      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,oauth_source_credential_id,created_by,channel,
        environment,operation,status,error_message,attempt_count,
        request_payload,started_at,credential_refresh_started_at,
        completed_at,updated_at,credential_refresh_in_flight,
        oauth_request_fingerprint
      ) values(
        'faee01e1-2d68-4f99-951c-15684822fc43','e54fa95d-ddfd-414f-82e9-636a0d9ab07c',
        'e54fa95d-ddfd-414f-82e9-636a0d9ab07c','768ce4ac-0ef2-4e01-89dc-05aa4fa8543c','lazada','production',
        'oauth.exchange','reconciliation_required',
        'serverless_cs_execution_failed',1,'{"vaultBacked":true}',
        '2026-08-30 10:24:04.769695+00',
        '2026-08-30 10:24:05.519322+00',
        '2026-08-30 10:24:07.333213+00',
        '2026-08-30 10:24:07.333213+00',true,
        '8a0f1f27e3b168ace4dd70a416b898caa92ef5ac4725fc08e1ea798fb28a6bfa'
      ),(
        'a976573f-a150-4061-a1c6-5e8e4880ba2b','e54fa95d-ddfd-414f-82e9-636a0d9ab07c',null,'768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'lazada','production','orders.list','reconciliation_required',
        'serverless_cs_execution_failed',1,
        jsonb_build_object(
          'arguments',jsonb_build_object(
            'queryParams',jsonb_build_object(
              'limit','50','created_after','2026-08-16T09:16:01.458Z',
              'sort_direction','DESC'
            )
          ),'periodicKey','orders'
        ),
        '2026-08-30 09:16:03.961623+00',
        '2026-08-30 09:16:05.208278+00',
        '2026-08-30 09:16:06.920132+00',
        '2026-08-30 09:16:06.920132+00',true,null
      );
      insert into sellerpilot_private.gateway_completion_receipts(job_id,claim_token,worker_token_id,completion_fingerprint,created_at) values
        ('faee01e1-2d68-4f99-951c-15684822fc43','11111111-1111-4111-8111-111111111111',
         '02955cb4-fa9f-466b-824f-b61f06276190',sellerpilot_private.gateway_completion_fingerprint('reconciliation_required',null,'serverless_cs_execution_failed',null,null,null,null),
         '2026-08-30 10:24:07.470146+00'),
        ('a976573f-a150-4061-a1c6-5e8e4880ba2b','31111111-1111-4111-8111-111111111111',
         '02955cb4-fa9f-466b-824f-b61f06276190',sellerpilot_private.gateway_completion_fingerprint('reconciliation_required',null,'serverless_cs_execution_failed',null,null,null,null),
         '2026-08-30 09:16:07.032446+00');

      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,oauth_source_credential_id,created_by,channel,
        environment,operation,status,error_message,attempt_count,
        request_payload,created_at,started_at,credential_refresh_started_at,
        oauth_provider_call_started_at,completed_at,updated_at,
        credential_refresh_in_flight,oauth_request_fingerprint
      ) values(
        'd917f08b-1283-456e-930a-6042ec0b24a7','e54fa95d-ddfd-414f-82e9-636a0d9ab07c',
        'e54fa95d-ddfd-414f-82e9-636a0d9ab07c','768ce4ac-0ef2-4e01-89dc-05aa4fa8543c','lazada','production',
        'oauth.exchange','reconciliation_required',
        'LAZADA_OAUTH_PROVIDER_FAILURE:ISV:UNRECOGNIZED',1,
        '{"vaultBacked":true}',
        '2026-09-02 01:10:22.458355+00',
        '2026-09-02 01:11:06.769536+00',
        '2026-09-02 01:11:14.013743+00',
        '2026-09-02 01:11:14.3005+00',
        '2026-09-02 01:11:15.504797+00',
        '2026-09-02 01:11:15.504797+00',true,
        '663295c1520473aa753929d06e9e791e59b2059a73c706355086e52762b81681'
      );
      insert into sellerpilot_private.gateway_completion_receipts(job_id,claim_token,worker_token_id,completion_fingerprint,created_at) values(
        'd917f08b-1283-456e-930a-6042ec0b24a7',
        '51111111-1111-4111-8111-111111111111',
        '02955cb4-fa9f-466b-824f-b61f06276190',
        'bfd9d9e768f23c0073eb656d24f1f2785a0904cdb62a98c0b465b63b0fc69198',
        '2026-09-02 01:11:15.728629+00'
      );
`);
 await db.exec('alter table sellerpilot_private.channel_gateway_jobs enable trigger user');
 assert.equal(await scalar(db,"select sellerpilot_private.lazada_exact_three_blockers_intact($1,$2,'production')",[credential,owner]),true);
 await db.exec(migration);
 assert.equal(await scalar(db,genericDefinitionSql),genericAfter300,'500/600 must preserve generic claim/reaper installed alongside 300');
 assert.equal(await scalar(db,reaperDefinitionSql),reaperAfter300,'500/600 must preserve the scheduled reaper installed alongside 300');
 assert.deepEqual((await db.query(shopeeDefinitionsSql)).rows,shopeeAfter300,'500/600 must preserve every Shopee exact function');
 assert.deepEqual((await db.query(sharedContractSql)).rows,originalSharedContract,'shared token/context/complete bodies must remain original');
 return db;
 }catch(error){await db.close();throw error;}
}
const actor='11111111-1111-4111-8111-111111111111';
async function rpc(db,sql,args){await db.exec('set role service_role');try{return await scalar(db,sql,args);}finally{await db.exec('reset role');}}
test('actual preimage controller: atomic reserve, Vault restoration, shared actor, no general claim and no code replay',async()=>{
 const db=await fixture();try{
 const admin=(action,body={})=>rpc(db,'select public.sellerpilot_lazada_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',[action,actor,session,credential,hash,JSON.stringify(body)]);
 const worker=body=>rpc(db,'select public.sellerpilot_lazada_exact_oauth_worker($1,$2,$3,$4,$5,$6::jsonb)',[body.action,session,hash,body.jobId??null,body.claimToken??null,JSON.stringify(body.payload??{})]);
 assert.equal((await admin('prepare')).status,'executor_required');assert.equal((await admin('start')).status,'executor_required');assert.equal((await worker({action:'pulse'})).status,'armed');assert.equal((await admin('start')).status,'ready');
 const bound=await admin('bind',{code:'0_137451_fixture_code',country:'my'});assert.equal(bound.status,'bound');
 const row=(await db.query('select status,created_by,request_payload from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId])).rows[0];assert.equal(row.status,'running');assert.equal(row.created_by,owner);assert.deepEqual(row.request_payload,{vaultBacked:true});
 const claim=await worker({action:'claim'});assert.equal(claim.job.request.code,'0_137451_fixture_code');await assert.rejects(worker({action:'claim'}),/ALREADY_DELIVERED/);
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 const originalFetch=globalThis.fetch;let exchanges=0;globalThis.fetch=async url=>{assert.equal(new URL(url).pathname,'/rest/auth/token/create');exchanges++;return Response.json({code:'0',access_token:'fixture-new',refresh_token:'fixture-new-refresh',expires_in:360000,refresh_expires_in:720000,country:'my',account_platform:'seller_center',country_user_info:[{country:'my',seller_id:'300872000183',user_id:'900001',short_code:'MY4NNISR2D'}]});};
 try{
  const done=await runLazadaExactJob(claim.job,session,worker);assert.equal(done.status,'readback_ready');assert.equal(exchanges,1);
  assert.equal(await scalar(db,'select status from sellerpilot_private.channel_credentials where id=$1',[credential]),'revoked');
  const read=await worker({action:'claim'});assert.equal(read.job.id,done.jobId);assert.equal(read.job.operation,'shops.get');
  const result=await runLazadaExactJob(read.job,session,worker,async(url,init)=>{assert.equal(new URL(url).pathname,'/rest/seller/get');assert.equal(init.method,'GET');return Response.json({code:'0',data:{seller_id:'300872000183',short_code:'MY4NNISR2D',status:'ACTIVE'}});});
  assert.equal(result.status,'completed');assert.equal(exchanges,1);
  assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where id in('a976573f-a150-4061-a1c6-5e8e4880ba2b','d917f08b-1283-456e-930a-6042ec0b24a7','faee01e1-2d68-4f99-951c-15684822fc43') and status='cancelled'"),3);
  assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.channel_gateway_jobs where id in($1,$2) and worker_token_id is null and claim_token is null and lease_expires_at is null',[bound.jobId,done.jobId]),2);
  assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.lazada_exact_claims e join sellerpilot_private.gateway_completion_receipts r on r.job_id=e.job_id and r.claim_token=e.claim_token and r.worker_token_id=e.worker_token_id'),2);
  assert.equal(await scalar(db,'select bool_and(sellerpilot_private.lazada_exact_completed_job_bound(job_id)) from sellerpilot_private.lazada_exact_claims'),true);
  assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where id in('a976573f-a150-4061-a1c6-5e8e4880ba2b','d917f08b-1283-456e-930a-6042ec0b24a7','faee01e1-2d68-4f99-951c-15684822fc43') and credential_id=$1 and created_by=$2 and seller_account_key is null",[credential,owner]),3);
  const auditSql="select count(*)::int from sellerpilot_private.operation_audit where action in('lazada_refresh_reconciliation_superseded_after_seller_readback','lazada_provider_failure_reconciliation_superseded_after_seller_readback','lazada_oauth_reconciliation_superseded_after_readback','lazada_oauth_reconciliation_superseded_after_seller_readback')";
  assert.equal(await scalar(db,auditSql),3);
  await db.exec('update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp()');
  assert.equal(await scalar(db,auditSql),3);
  await assert.rejects(worker({action:'complete',jobId:done.jobId,claimToken:read.job.claim_token,payload:{}}),/SESSION_INVALID/);
  await assert.rejects(db.exec('delete from sellerpilot_private.lazada_exact_completions'),/EVIDENCE_IMMUTABLE/);
  for(const kind of ['result','request','receipt','lease','owner','version','issuer']){
   await db.exec('begin');
   // Adversarial corruption test only: production ACLs/immutability already
   // reject these writes. Every production proof function remains unchanged.
   if(kind==='result'){await db.exec('alter table sellerpilot_private.channel_gateway_jobs disable trigger user');await db.query("update sellerpilot_private.channel_gateway_jobs set response_payload=response_payload||'{\"tampered\":true}'::jsonb where id=$1",[done.jobId]);}
   if(kind==='request'){await db.exec('alter table sellerpilot_private.channel_gateway_jobs disable trigger user');await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload='{\"country\":\"sg\"}'::jsonb where id=$1",[done.jobId]);}
   if(kind==='receipt'){await db.exec('alter table sellerpilot_private.gateway_completion_receipts disable trigger user');await db.query('update sellerpilot_private.gateway_completion_receipts set claim_token=$1 where job_id=$2',[token,done.jobId]);}
   if(kind==='lease'){await db.exec('alter table sellerpilot_private.lazada_exact_completions disable trigger user');await db.query("update sellerpilot_private.lazada_exact_completions set lease_checked_at=now()-interval '2 hours',lease_expires_at=now()-interval '1 hour' where job_id=$1",[done.jobId]);}
   if(kind==='owner'){await db.exec('alter table sellerpilot_private.lazada_exact_oauth_sessions disable trigger user');await db.query('update sellerpilot_private.lazada_exact_oauth_sessions set owner_id=$1',[actor]);}
   if(kind==='issuer')await db.query('update sellerpilot_private.ai_cli_worker_tokens set created_by=$1',[owner]);
   if(kind==='version'){await db.exec('alter table sellerpilot_private.channel_credentials disable trigger user');await db.query('update sellerpilot_private.channel_credentials set version=7 where id=$1',[read.job.credential_id]);}
   assert.equal(await scalar(db,'select sellerpilot_private.lazada_exact_completed_job_bound($1)',[done.jobId]),false,kind);
   await db.exec('rollback');
  }
  assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.gateway_completion_receipts where job_id in($1,$2)',[bound.jobId,done.jobId]),2);
 }finally{globalThis.fetch=originalFetch;}
 }finally{await db.close();}
});

async function boundFixture(){
 const db=await fixture();
 const admin=(action,body={},who=actor,state=hash)=>rpc(db,'select public.sellerpilot_lazada_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',[action,who,session,credential,state,JSON.stringify(body)]);
 const worker=body=>rpc(db,'select public.sellerpilot_lazada_exact_oauth_worker($1,$2,$3,$4,$5,$6::jsonb)',[body.action,session,hash,body.jobId??null,body.claimToken??null,JSON.stringify(body.payload??{})]);
 await admin('prepare');await worker({action:'pulse'});return {db,admin,worker};
}
for(const scenario of ['wrong-actor','wrong-state','stale-readiness','wrong-app','immutable-session','immutable-claim','expired-before-delivery','expired-after-delivery','revoked-worker'])test('exact failure/reaper: '+scenario,async()=>{
 const {db,admin,worker}=await boundFixture();try{
 if(scenario==='wrong-actor'){await assert.rejects(admin('start',{},owner),/SESSION_INVALID/);return;}
 if(scenario==='wrong-state'){await assert.rejects(admin('start',{},actor,'b'.repeat(64)),/SESSION_INVALID/);return;}
 if(scenario==='stale-readiness'){await db.query("update sellerpilot_private.lazada_exact_oauth_sessions set ready_until=clock_timestamp()-interval '1 second' where id=$1",[session]);assert.equal((await admin('bind',{code:'fixture-code',country:'my'})).status,'executor_required');assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.lazada_exact_claims'),0);return;}
 if(scenario==='wrong-app'){await assert.rejects(admin('bind',{code:'0_137571_fixture_code',country:'my'}),/CALLBACK_INVALID/);return;}
 if(scenario==='immutable-session'){await assert.rejects(db.query('update sellerpilot_private.lazada_exact_oauth_sessions set owner_id=$1',[actor]),/IDENTITY_IMMUTABLE/);return;}
 const bound=await admin('bind',{code:'0_137451_fixture_code',country:'my'});
 if(scenario==='immutable-claim'){await assert.rejects(db.query('update sellerpilot_private.lazada_exact_claims set claim_token=$1',[token]),/EVIDENCE_IMMUTABLE/);await assert.rejects(db.exec('delete from sellerpilot_private.lazada_exact_claims'),/EVIDENCE_IMMUTABLE/);return;}
 const claim=scenario==='expired-before-delivery'?null:(await worker({action:'claim'})).job;
 if(scenario==='revoked-worker'){await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='revoked',revoked_at=now() where id=$1",[token]);await assert.rejects(worker({action:'heartbeat',jobId:bound.jobId,claimToken:claim.claim_token}),/TOKEN_INVALID/);return;}
 await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[bound.jobId]);
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 assert.equal(await scalar(db,'select status from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId]),'reconciliation_required');
 await assert.rejects(worker(claim?{action:'heartbeat',jobId:bound.jobId,claimToken:claim.claim_token}:{action:'claim'}),/CLAIM_INVALID/);
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where id in('a976573f-a150-4061-a1c6-5e8e4880ba2b','d917f08b-1283-456e-930a-6042ec0b24a7','faee01e1-2d68-4f99-951c-15684822fc43') and status='reconciliation_required'"),3);
 }finally{await db.close();}
});

test('readback reservation expiry never resurrects under current general reaper',async()=>{
 const {db,admin,worker}=await boundFixture();const original=globalThis.fetch;try{
 await admin('bind',{code:'0_137451_fixture_read_expiry',country:'my'});const claim=(await worker({action:'claim'})).job;
 globalThis.fetch=async()=>Response.json({code:'0',access_token:'fixture-new',refresh_token:'fixture-new-refresh',expires_in:360000,refresh_expires_in:720000,country:'my',account_platform:'seller_center',country_user_info:[{country:'my',seller_id:'300872000183',user_id:'900001'}]});
 const done=await runLazadaExactJob(claim,session,worker);assert.equal(done.status,'readback_ready');
 const read=(await worker({action:'claim'})).job;
 await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[read.id]);
 for(let i=0;i<2;i++)assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 assert.equal(await scalar(db,'select status from sellerpilot_private.channel_gateway_jobs where id=$1',[read.id]),'reconciliation_required');
 await assert.rejects(worker({action:'heartbeat',jobId:read.id,claimToken:read.claim_token}),/CLAIM_INVALID/);
 assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.lazada_exact_completions'),1);
 assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where id in('a976573f-a150-4061-a1c6-5e8e4880ba2b','d917f08b-1283-456e-930a-6042ec0b24a7','faee01e1-2d68-4f99-951c-15684822fc43') and status='reconciliation_required'"),3);
 }finally{globalThis.fetch=original;await db.close();}
});
test('Vault code tampering is rejected before code delivery or provider call',async()=>{
 const {db,admin,worker}=await boundFixture();try{
 const bound=await admin('bind',{code:'0_137451_fixture_code',country:'my'});
 await db.query("update vault.secrets set secret=jsonb_set(secret::jsonb,'{code}','\"0_137451_other_fixture\"')::text where id=(select oauth_request_vault_id from sellerpilot_private.channel_gateway_jobs where id=$1)",[bound.jobId]);
 await assert.rejects(worker({action:'claim'}),/VAULT_CODE_INVALID/);
 assert.equal(await scalar(db,'select delivered_oauth from sellerpilot_private.lazada_exact_oauth_sessions where id=$1',[session]),false);
 }finally{await db.close();}
});

for(const reaperDriver of ['generic','scheduled'])for(const shopeeOwner of [actor,owner])test(`300→500→600 ${reaperDriver} reaper; simultaneous exact isolation; Shopee owner ${shopeeOwner===actor?'same':'different'} from actor`,async()=>{
 const {db,admin,worker}=await boundFixture();try{
 const sc='55555555-5555-4555-8555-555555555555',ss='66666666-6666-4666-8666-666666666666';
 await db.query("insert into vault.secrets(id,secret) values($1,$2)",[sc,JSON.stringify({partner_id:'2031489',partner_key:'fixture-shopee-key',shop_id:'1719148844',main_account_id:'123456',shop_ids:['1719148844','2','3','4','5','6','7','8']})]);
 await db.query("insert into sellerpilot_private.channel_credentials(id,channel,environment,status,vault_secret_id,created_by,expires_at,version,fingerprint,seller_account_key_source) values($1,'shopee','production','active',$1,$2,now()+interval '30 days',1,'fixture-shopee','legacy_unattested')",[sc,shopeeOwner]);
 const sa=(action,body={})=>rpc(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',[action,actor,ss,sc,'b'.repeat(64),JSON.stringify(body)]);
 const sw=action=>rpc(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',[action,ss,hash]);
 await sa('prepare');await sw('pulse');const sb=await sa('bind',{code:'fixture-shopee-composition',mainAccountId:'123456'});
 const lb=await admin('bind',{code:'0_137451_fixture_composition',country:'my'});
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 const sh=(await sw('claim')).job,la=(await worker({action:'claim'})).job;
 assert.equal(sh.id,sb.jobId);assert.equal(sh.channel,'shopee');assert.equal(la.id,lb.jobId);assert.equal(la.channel,'lazada');
 assert.notEqual(sh.claim_token,la.claim_token);
 assert.equal(await scalar(db,'select created_by from sellerpilot_private.channel_gateway_jobs where id=$1',[sh.id]),shopeeOwner);
 await assert.rejects(worker({action:'heartbeat',jobId:sh.id,claimToken:sh.claim_token}),/CLAIM_INVALID/);
 await assert.rejects(rpc(db,'select public.sellerpilot_shopee_exact_oauth_heartbeat($1,$2,$3,$4)',[ss,hash,la.id,la.claim_token]),/SESSION_INVALID/);
 assert.equal((await worker({action:'heartbeat',jobId:la.id,claimToken:la.claim_token})).status,'running');
 assert.equal((await rpc(db,'select public.sellerpilot_shopee_exact_oauth_heartbeat($1,$2,$3,$4)',[ss,hash,sh.id,sh.claim_token])).status,'running');
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 await assert.rejects(sw('claim'),/CLAIM_EXPIRED|ALREADY_DELIVERED/);await assert.rejects(worker({action:'claim'}),/ALREADY_DELIVERED/);
 await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[sh.id]);
 if(reaperDriver==='scheduled')await rpc(db,'select public.sellerpilot_service_reap_stale_channel_gateway_jobs($1)',[100]);
 const reclaimed=await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']);
 if(reclaimed!==null)console.log('BC_SHOPEE_EXPIRY_DIAGNOSTIC',JSON.stringify({sameJob:reclaimed.id===sh.id,channel:reclaimed.channel,operation:reclaimed.operation,attemptCount:reclaimed.attempt_count,sameFixtureCode:reclaimed.request?.code==='fixture-shopee-composition'}));
 assert.equal(reclaimed===null,true,'BC_SHOPEE_300_P1_EXPIRED_EXACT_CODE_REDELIVERED');
 assert.ok(['reconciliation_required','failed','cancelled'].includes(await scalar(db,'select status from sellerpilot_private.channel_gateway_jobs where id=$1',[sh.id])),'expired Shopee exact work must be terminal, not requeued');
 assert.equal((await worker({action:'heartbeat',jobId:la.id,claimToken:la.claim_token})).status,'running');
 }finally{await db.close();}
});

for(const {executionActor,workerIssuer} of [{executionActor:owner,workerIssuer:owner},{executionActor:owner,workerIssuer:'7f448e38-f86f-4749-bc5f-cecf6d0723e5'},{executionActor:actor,workerIssuer:'7f448e38-f86f-4749-bc5f-cecf6d0723e5'}])test(`Lazada source owner 768; actor ${executionActor===owner?'768':'shared 111'}; worker issuer ${workerIssuer===owner?'768':'observed 7f'}`,async()=>{
 const db=await fixture({executionActor,workerIssuer});const original=globalThis.fetch;try{
 const a=(action,body={})=>rpc(db,'select public.sellerpilot_lazada_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',[action,executionActor,session,credential,hash,JSON.stringify(body)]);
 const w=body=>rpc(db,'select public.sellerpilot_lazada_exact_oauth_worker($1,$2,$3,$4,$5,$6::jsonb)',[body.action,session,hash,body.jobId??null,body.claimToken??null,JSON.stringify(body.payload??{})]);
 const tokenBefore=(await db.query('select id,created_by,scope,status,expires_at,token_hash from sellerpilot_private.ai_cli_worker_tokens')).rows;
 assert.equal(tokenBefore.length,1);assert.equal(tokenBefore[0].id,token);assert.equal(tokenBefore[0].created_by,workerIssuer);
 assert.equal(await scalar(db,"select sellerpilot_private.worker_token_has_scope($1,'gateway',true)",[hash]),true);
 assert.equal(await scalar(db,"select sellerpilot_private.worker_token_has_scope($1,'gateway',true)",['f'.repeat(64)]),false);
 await a('prepare');await w({action:'pulse'});await a('bind',{code:'0_137451_fixture_owner_actor',country:'my'});
 assert.deepEqual((await db.query('select actor_id,owner_id,worker_issuer_id,worker_token_id from sellerpilot_private.lazada_exact_oauth_sessions')).rows,[{actor_id:executionActor,owner_id:owner,worker_issuer_id:workerIssuer,worker_token_id:token}]);
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 let exchanges=0;globalThis.fetch=async()=>{exchanges++;return Response.json({code:'0',access_token:'fixture-new',refresh_token:'fixture-new-refresh',expires_in:360000,refresh_expires_in:720000,country:'my',account_platform:'seller_center',country_user_info:[{country:'my',seller_id:'300872000183',user_id:'900001'}]});};
 const originalClaim=(await w({action:'claim'})).job;
 await db.exec('begin');
 const context=await rpc(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',[hash,originalClaim.id,originalClaim.claim_token]);
 assert.equal(context.status,'running');assert.equal(context.credential_id,credential);
 assert.equal(await rpc(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',['f'.repeat(64),originalClaim.id,originalClaim.claim_token]),null);
 await db.exec('rollback');
 assert.equal(await scalar(db,'select sellerpilot_private.worker_token_may_complete_gateway_job($1,$2,$3)',[hash,originalClaim.id,originalClaim.claim_token]),true);
 const oauth=await runLazadaExactJob(originalClaim,session,w);assert.equal(oauth.status,'readback_ready');
 const read=(await w({action:'claim'})).job;
 const completed=await runLazadaExactJob(read,session,w,async()=>Response.json({code:'0',data:{seller_id:'300872000183',short_code:'MY4NNISR2D',status:'ACTIVE'}}));
 assert.equal(completed.status,'completed');assert.equal(exchanges,1);
 assert.deepEqual((await db.query('select id,created_by,scope,status,expires_at,token_hash from sellerpilot_private.ai_cli_worker_tokens')).rows,tokenBefore,'no token creation, reassignment or mutation');
 assert.equal(await scalar(db,'select bool_and(worker_issuer_id=$1) from sellerpilot_private.lazada_exact_claims',[workerIssuer]),true);
 const replayContext=await rpc(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',[hash,originalClaim.id,originalClaim.claim_token]);assert.equal(replayContext.status,'completed_replay');
 assert.equal(await scalar(db,'select bool_and(sellerpilot_private.lazada_exact_completed_job_bound(job_id)) from sellerpilot_private.lazada_exact_claims'),true);
 assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.lazada_exact_claims e join sellerpilot_private.channel_gateway_jobs j on j.id=e.job_id join sellerpilot_private.gateway_completion_receipts r on r.job_id=e.job_id and r.claim_token=e.claim_token and r.worker_token_id=e.worker_token_id where j.claim_token is null and j.worker_token_id is null'),2);
 assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where id in('a976573f-a150-4061-a1c6-5e8e4880ba2b','d917f08b-1283-456e-930a-6042ec0b24a7','faee01e1-2d68-4f99-951c-15684822fc43') and status='cancelled' and credential_id=$1 and created_by=$2 and seller_account_key is null",[credential,owner]),3);
 }finally{globalThis.fetch=original;await db.close();}
});

test('post300 scheduled reaper preserves Lazada expiry fencing and historical three blockers',async()=>{
 const {db,admin,worker}=await boundFixture();try{
 const bound=await admin('bind',{code:'0_137451_fixture_scheduled_expiry',country:'my'});
 await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[bound.jobId]);
 await rpc(db,'select public.sellerpilot_service_reap_stale_channel_gateway_jobs($1)',[100]);
 assert.equal(await scalar(db,'select status from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId]),'reconciliation_required');
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 await assert.rejects(worker({action:'claim'}),/CLAIM_INVALID/);
 assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where id in('a976573f-a150-4061-a1c6-5e8e4880ba2b','d917f08b-1283-456e-930a-6042ec0b24a7','faee01e1-2d68-4f99-951c-15684822fc43') and status='reconciliation_required' and credential_id=$1 and seller_account_key is null",[credential]),3);
 }finally{await db.close();}
});
for(const invalid of ['unknown-hash','ai-scope','scheduler-scope','serverless-scope','revoked','expired','issuer-changed-after-binding'])test('observed issuer workspace capability fails closed: '+invalid,async()=>{
 const db=await fixture({executionActor:owner,workerIssuer:'7f448e38-f86f-4749-bc5f-cecf6d0723e5'});try{
 await rpc(db,'select public.sellerpilot_lazada_exact_oauth_admin($1,$2,$3,$4,$5)',['prepare',owner,session,credential,hash]);
 const pulse=h=>rpc(db,'select public.sellerpilot_lazada_exact_oauth_worker($1,$2,$3)',['pulse',session,h]);
 if(invalid==='issuer-changed-after-binding'){
  assert.equal((await pulse(hash)).status,'armed');
  await assert.rejects(db.query('update sellerpilot_private.lazada_exact_oauth_sessions set worker_issuer_id=$1',[owner]),/IDENTITY_IMMUTABLE/);
  // Adversarial fixture metadata mutation. No production token is modified.
  await db.query('update sellerpilot_private.ai_cli_worker_tokens set created_by=$1',[owner]);
 }else if(invalid.endsWith('-scope')){
  await db.query('update sellerpilot_private.ai_cli_worker_tokens set scope=$1',[{'ai-scope':'ai','scheduler-scope':'scheduler','serverless-scope':'serverless_cs'}[invalid]]);
 }else if(invalid==='revoked')await db.exec("update sellerpilot_private.ai_cli_worker_tokens set status='revoked',revoked_at=clock_timestamp()");
 else if(invalid==='expired')await db.exec("update sellerpilot_private.ai_cli_worker_tokens set expires_at=clock_timestamp()-interval '1 second'");
 await assert.rejects(pulse(invalid==='unknown-hash'?'f'.repeat(64):hash),/TOKEN_INVALID/);
 assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.lazada_exact_claims'),0);
 assert.doesNotMatch(migration,/(?:insert\s+into|update|delete\s+from)\s+sellerpilot_private\.ai_cli_worker_tokens\b/i);
 }finally{await db.close();}
});
