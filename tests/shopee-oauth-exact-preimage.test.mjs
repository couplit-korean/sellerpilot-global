import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {tsImport} from 'tsx/esm/api';
const {executeProviderOAuthExchange} = await tsImport('../lib/channels/provider-oauth-runtime.ts',import.meta.url);
import {unseal} from '../scripts/db-baseline-export.mjs';
const folder=process.env.SELLERPILOT_BASELINE_FOLDER??'/Users/kimchangheemac/.aside/u/0/backups/sellerpilot/20260905-974d4cb-v4/';
const baseline=unseal(await readFile(folder+'baseline.enc','utf8'),await readFile(folder+'baseline.key'));
const migration=await readFile(new URL('../supabase/migrations/20260906030000_shopee_exact_oauth_executor.sql',import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111',credential='22222222-2222-4222-8222-222222222222',session='33333333-3333-4333-8333-333333333333',token='44444444-4444-4444-8444-444444444444',hash='a'.repeat(64);
async function scalar(db,sql,p=[]){return Object.values((await db.query(sql,p)).rows[0])[0];}
async function fixture(){
 const db=new PGlite({extensions:{pgcrypto}});
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
 insert into auth.users(id)values('${owner}');insert into sellerpilot_private.admin_users(user_id,display_name)values('${owner}','Fixture admin');
 insert into vault.secrets(id,secret) values('${credential}','{"partner_id":"2031489","partner_key":"fixture-partner-not-live","shop_id":"1719148844","main_account_id":"123456","shop_ids":["1719148844","2","3","4","5","6","7","8"]}');
 insert into sellerpilot_private.channel_credentials(id,channel,environment,status,vault_secret_id,created_by,expires_at,version,fingerprint,seller_account_key_source) values('${credential}','shopee','production','active','${credential}','${owner}',now()+interval '30 days',1,'fixturekey12','legacy_unattested');
 insert into sellerpilot_private.ai_cli_worker_tokens(id,token_hash,scope,status,created_by,expires_at,label,fingerprint)values('${token}','${hash}','gateway','active','${owner}',now()+interval '1 day','Fixture exact worker','fixturekey12');`);
 // Restore this wrapper's captured ACL before testing its fail-closed installation pin.
 await db.exec("revoke all on function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer) from public;grant execute on function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer) to service_role");
 await db.exec(migration);
 for(const name of ['sellerpilot_service_complete_gateway_transaction','sellerpilot_11820_complete_gateway_unsafe','sellerpilot_service_gateway_completion_context']){
  const original=baseline.objects.find(o=>o.kind==='function'&&o.ddl.startsWith('CREATE OR REPLACE FUNCTION public.'+name+'('));
  const originalBody=original.ddl.match(/AS (\$[a-zA-Z0-9_]*\$)([\s\S]*?)\1/)[2];
  const actual=await scalar(db,"select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[name]);
  assert.equal(actual,createHash('md5').update(originalBody).digest('hex'),'actual completion body must not be stubbed or stripped: '+name);
 }
 return db;
}
test('current preimage enqueue preserves Vault-only OAuth code and exact claim restores it',async()=>{const db=await fixture();try{
 const admin=(action,body={})=>scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',[action,owner,session,credential,hash,JSON.stringify(body)]);
 const worker=action=>scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',[action,session,hash]);
 const beforeReadiness=(await db.query('select last_seen_at,last_version from sellerpilot_private.ai_cli_worker_tokens where id=$1',[token])).rows;
 assert.equal((await admin('prepare')).status,'executor_required');assert.equal((await admin('start')).status,'executor_required');await worker('pulse');assert.equal((await admin('start')).status,'ready');
 const bound=await admin('bind',{code:'fixture-live-preimage-code',mainAccountId:'123456'});assert.equal(bound.status,'bound');
 const row=(await db.query('select * from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId])).rows[0];assert.deepEqual(row.request_payload,{vaultBacked:true});assert.ok(row.oauth_request_vault_id);
 const claim=await worker('claim');assert.equal(claim.job.request.code,'fixture-live-preimage-code');assert.equal(claim.job.request.shopeeExactSession,session);assert.equal(claim.job.credential.shop_id,'1719148844');
 await assert.rejects(worker('claim'),/CLAIM_EXPIRED/);
 assert.deepEqual((await db.query('select last_seen_at,last_version from sellerpilot_private.ai_cli_worker_tokens where id=$1',[token])).rows,beforeReadiness);
 const metaSql='select last_version,last_seen_at from sellerpilot_private.ai_cli_worker_tokens where id=$1';
 await db.query("update sellerpilot_private.ai_cli_worker_tokens set last_version='sellerpilot-cli-worker/1.13',last_seen_at=now()-interval '2 hours' where id=$1",[token]);
 const initialMeta=(await db.query(metaSql,[token])).rows;
 // Reproduce the old bug with the real baseline touch, then restore only this
 // synthetic fixture metadata. The production runner no longer calls it.
 assert.equal(await scalar(db,'select public.sellerpilot_touch_channel_gateway_job($1,$2,$3,$4)',[hash,bound.jobId,claim.job.claim_token,'sellerpilot-shopee-exact-oauth/1']),'running');
 assert.equal((await db.query(metaSql,[token])).rows[0].last_version,'sellerpilot-shopee-exact-oauth/1');
 await db.query('update sellerpilot_private.ai_cli_worker_tokens set last_version=$1,last_seen_at=$2 where id=$3',[initialMeta[0].last_version,initialMeta[0].last_seen_at,token]);
 const beat=()=>scalar(db,'select public.sellerpilot_shopee_exact_oauth_heartbeat($1,$2,$3,$4)',[session,hash,bound.jobId,claim.job.claim_token]);
 assert.equal((await beat()).status,'running');assert.deepEqual((await db.query(metaSql,[token])).rows,initialMeta);
 // Same-token metadata updates between exact heartbeats cannot renew readiness
 // or steal the running exact job. Test both serialized write orders.
 await db.query("update sellerpilot_private.ai_cli_worker_tokens set last_version='sellerpilot-cli-worker/1.13',last_seen_at=clock_timestamp() where id=$1",[token]);
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 const racingMeta=(await db.query(metaSql,[token])).rows;
 assert.equal((await beat()).status,'running');assert.deepEqual((await db.query(metaSql,[token])).rows,racingMeta);
 await assert.rejects(scalar(db,'select public.sellerpilot_shopee_exact_oauth_heartbeat($1,$2,$3,$4)',[session,hash,bound.jobId,token]),/LEASE_LOST/);
 const originalFetch=globalThis.fetch;let lastRefresh;let stageCount=0;
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);const path=new URL(url).pathname;
  if(path==='/api/v2/auth/token/get')return Response.json({main_account_id:'123456',access_token:'fixture-main-access',refresh_token:'fixture-main-refresh',shop_id_list:['8','7','6','5','4','3','2','1719148844'],merchant_id_list:[]});
  assert.equal(path,'/api/v2/auth/access_token/get');assert.equal(body.refresh_token,'fixture-main-refresh');
  return Response.json({access_token:'fixture-shop-access-'+body.shop_id,refresh_token:'fixture-shop-refresh-'+body.shop_id,expire_in:14400});
 };
 const claimArgs=[hash,bound.jobId,claim.job.claim_token];
 try {
  const result=await executeProviderOAuthExchange(claim.job,{
   assertLeaseHealthy:async()=>assert.equal((await beat()).status,'running'),
   beginCredentialMutation:async()=>assert.equal(await scalar(db,'select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3)',claimArgs),true),
   stageCredentialRefresh:async refresh=>{
    const stage=await scalar(db,'select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4::jsonb,$5::timestamptz,$6,$7)',[...claimArgs,JSON.stringify(refresh.payload),refresh.expiresAt??null,refresh.recoveryOnly===true,refresh.oauthComplete===true]);
    assert.equal(stage.status,refresh.recoveryOnly?'recovery_preserved':'prepared');lastRefresh=refresh;stageCount++;
   },
  });
  assert.equal(lastRefresh.oauthComplete,true);assert.equal(lastRefresh.payload.shop_id,'1719148844');assert.ok(stageCount>=10);
  const storedResponse={ok:true,channel:result.channel,operation:result.operation,safeMessage:result.safeMessage};
  const completed=await scalar(db,'select public.sellerpilot_service_complete_gateway_transaction($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)',[...claimArgs,'succeeded',JSON.stringify(storedResponse),null,JSON.stringify(lastRefresh)]);
  assert.equal(completed.status,'completed');assert.deepEqual((await db.query(metaSql,[token])).rows,racingMeta);
  await assertRealCompletionCleanup(db,bound.jobId,claim.job.claim_token);
  await assert.rejects(beat(),/LEASE_LOST/);
  // The real receipt path, not nullable live-lease fields, authenticates replay.
  const replayContext=await scalar(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',claimArgs);
  assert.equal(replayContext.status,'completed_replay');
  const replay=await scalar(db,'select public.sellerpilot_service_complete_gateway_transaction($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)',[...claimArgs,'succeeded',JSON.stringify(storedResponse),null,JSON.stringify(lastRefresh)]);
  assert.equal(replay.status,'completed');
  assert.equal(await scalar(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',[hash,bound.jobId,token]),null);
  assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.gateway_completion_receipts where job_id=$1',[bound.jobId]),1);
  await assertRealCompletionCleanup(db,bound.jobId,claim.job.claim_token);
  await assert.rejects(worker('claim'),/SHOPEE_EXACT_IDENTITY_REQUIRED|SHOPEE_EXACT_CLAIM_EXPIRED/);
  await assert.rejects(admin('bind',{code:'must-not-reexchange',mainAccountId:'123456'}),/SHOPEE_EXACT_IDENTITY_REQUIRED|SHOPEE_EXACT_CODE_ALREADY_BOUND/);
  await assertRealCompletionCleanup(db,bound.jobId,claim.job.claim_token);
 }finally{globalThis.fetch=originalFetch;}
}finally{await db.close();}});

for(const scenario of ['wrong-state','wrong-owner','wrong-scope','stale-readiness','changed-identity','real-enqueue-fence'])test('preimage fail closed: '+scenario,async()=>{const db=await fixture();try{
 const admin=(action,body={},state=hash,who=owner)=>scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',[action,who,session,credential,state,JSON.stringify(body)]);
 const worker=action=>scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',[action,session,hash]);
 await admin('prepare');await worker('pulse');
 if(scenario==='wrong-state')await assert.rejects(admin('bind',{code:'fixture-code',mainAccountId:'123456'},'b'.repeat(64)),/SESSION_INVALID/);
 if(scenario==='wrong-owner')await assert.rejects(admin('start',{},hash,token),/OWNER_REQUIRED/);
 if(scenario==='wrong-scope'){await db.exec("update sellerpilot_private.ai_cli_worker_tokens set scope='ai'");await assert.rejects(worker('pulse'),/TOKEN_INVALID/);}
 if(scenario==='stale-readiness'){await db.exec("update sellerpilot_private.shopee_exact_oauth_sessions set ready_until=now()-interval '1 second'");assert.equal((await admin('bind',{code:'fixture-code',mainAccountId:'123456'})).status,'executor_required');}
 if(scenario==='changed-identity'){await db.exec("update vault.secrets set secret=(secret::jsonb||'{\"main_account_id\":\"999\"}'::jsonb)::text");await assert.rejects(admin('start'),/SESSION_INVALID/);}
 if(scenario==='real-enqueue-fence'){
  const existing=await scalar(db,"select public.sellerpilot_enqueue_channel_gateway_job($1,null,'shopee','oauth.exchange',$2::jsonb)",[credential,JSON.stringify({code:'different-fixture-code',mainAccountId:'123456'})]);
  await assert.rejects(admin('bind',{code:'fixture-code',mainAccountId:'123456'}),/unresolved OAuth exchange already exists/);
  assert.equal(await scalar(db,'select status from sellerpilot_private.channel_gateway_jobs where id=$1',[existing]),'queued');
 }
 assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where status='running'"),0);
 for(const role of ['anon','authenticated'])assert.equal(await scalar(db,"select has_function_privilege($1,'public.sellerpilot_shopee_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb)','EXECUTE')",[role]),false);
}finally{await db.close();}});

for(const failure of ['expired-lease','revoked-token'])test('exact heartbeat never revives '+failure,async()=>{const db=await fixture();try{
 await scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5)', ['prepare',owner,session,credential,hash]);
 await scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',['pulse',session,hash]);
 const bound=await scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',['bind',owner,session,credential,hash,JSON.stringify({code:'fixture-expiry-code',mainAccountId:'123456'})]);
 const claim=await scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',['claim',session,hash]);
 if(failure==='expired-lease')await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[bound.jobId]);
 else await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='revoked',revoked_at=clock_timestamp() where id=$1",[token]);
 const before=(await db.query('select * from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId])).rows;
 await assert.rejects(scalar(db,'select public.sellerpilot_shopee_exact_oauth_heartbeat($1,$2,$3,$4)',[session,hash,bound.jobId,claim.job.claim_token]),/LEASE_LOST|TOKEN_INVALID/);
 assert.deepEqual((await db.query('select * from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId])).rows,before);
 for(const role of ['anon','authenticated'])assert.equal(await scalar(db,"select has_function_privilege($1,'public.sellerpilot_shopee_exact_oauth_heartbeat(uuid,text,uuid,uuid)','EXECUTE')",[role]),false);
}finally{await db.close();}});

async function assertRealCompletionCleanup(db,jobId,deliveredClaim){
 const job=(await db.query('select status,worker_token_id,claim_token,lease_expires_at,oauth_request_vault_id,oauth_exchange_completed,credential_id,oauth_source_credential_id from sellerpilot_private.channel_gateway_jobs where id=$1',[jobId])).rows[0];
 assert.equal(job.status,'succeeded');assert.equal(job.worker_token_id,null);assert.equal(job.claim_token,null);assert.equal(job.lease_expires_at,null);assert.equal(job.oauth_request_vault_id,null);assert.equal(job.oauth_exchange_completed,true);
 assert.equal(job.oauth_source_credential_id,credential);assert.notEqual(job.credential_id,credential);
 const receipt=(await db.query('select worker_token_id,claim_token,completion_fingerprint from sellerpilot_private.gateway_completion_receipts where job_id=$1',[jobId])).rows[0];
 assert.equal(receipt.worker_token_id,token);assert.equal(receipt.claim_token,deliveredClaim);assert.match(receipt.completion_fingerprint,/^[a-f0-9]{64}$/);
 const active=(await db.query('select status,seller_account_key_source,seller_account_verified_at from sellerpilot_private.channel_credentials where id=$1',[job.credential_id])).rows[0];
 assert.equal(active.status,'active');assert.equal(active.seller_account_key_source,'provider_certified_v1');assert.ok(active.seller_account_verified_at);
 return job;
}

test('actual runner acknowledges success only after real completion has cleared nullable lease fields',async()=>{
 const db=await fixture();const priorFetch=globalThis.fetch,priorLog=console.log;
 const envNames=['SELLERPILOT_URL','SELLERPILOT_SHOPEE_EXACT_SESSION','SELLERPILOT_GATEWAY_WORKER_TOKEN'];const priorEnv=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
 const actor='66666666-6666-4666-8666-666666666666',workerOwner='77777777-7777-4777-8777-777777777777';
 const workerToken='spw_synthetic_controller_no_live_secret';const workerHash=createHash('sha256').update(workerToken).digest('hex');let boundJob,deliveredClaim,completeCalls=0,providerCodeCalls=0;const runnerLogs=[];
 try{
  await db.query('insert into auth.users(id)values($1),($2)',[actor,workerOwner]);
  await db.query('insert into sellerpilot_private.admin_users(user_id,display_name)values($1,$2)',[actor,'Shared actor']);
  await db.query('update sellerpilot_private.ai_cli_worker_tokens set token_hash=$1,created_by=$2 where id=$3',[workerHash,workerOwner,token]);
  await scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5)',['prepare',actor,session,credential,hash]);
  await scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',['pulse',session,workerHash]);
  const bound=await scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',['bind',actor,session,credential,hash,JSON.stringify({code:'fixture-controller-code',mainAccountId:'123456'})]);boundJob=bound.jobId;
  const binding=(await db.query('select owner_id,actor_id,worker_owner_id from sellerpilot_private.shopee_exact_oauth_sessions where id=$1',[session])).rows[0];assert.deepEqual(binding,{owner_id:owner,actor_id:actor,worker_owner_id:workerOwner});
  assert.equal(await scalar(db,'select created_by from sellerpilot_private.channel_gateway_jobs where id=$1',[boundJob]),owner);
  const audit=(await db.query("select owner_id,safe_detail from sellerpilot_private.operation_audit where action='shopee_exact_oauth_bound' and entity_id=$1",[boundJob])).rows[0];assert.equal(audit.owner_id,owner);assert.equal(audit.safe_detail.actor_id,actor);assert.equal(audit.safe_detail.worker_owner_id,workerOwner);
  await assert.rejects(scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5)',['start',owner,session,credential,hash]),/SESSION_INVALID/);
  process.env.SELLERPILOT_URL='https://sellerpilot-global.vercel.app';process.env.SELLERPILOT_SHOPEE_EXACT_SESSION=session;process.env.SELLERPILOT_GATEWAY_WORKER_TOKEN=workerToken;
  const {gatewayWorkerCompletionSchema}=await tsImport('../lib/channels/gateway-contract.ts',import.meta.url);
  globalThis.fetch=async(url,init={})=>{
   assert.equal(init.redirect,'error');const u=new URL(url);const body=init.body?JSON.parse(init.body):{};
   if(u.hostname==='api.ipify.org')return new Response('112.172.127.206');
   if(u.hostname==='partner.shopeemobile.com'){
    if(u.pathname==='/api/v2/auth/token/get'){providerCodeCalls++;return Response.json({main_account_id:'123456',access_token:'synthetic-main-access',refresh_token:'synthetic-main-refresh',shop_id_list:['8','7','6','5','4','3','2','1719148844'],merchant_id_list:[]});}
    assert.equal(u.pathname,'/api/v2/auth/access_token/get');return Response.json({access_token:'synthetic-access-'+body.shop_id,refresh_token:'synthetic-refresh-'+body.shop_id,expire_in:14400});
   }
   assert.equal(u.origin,process.env.SELLERPILOT_URL);assert.equal(init.headers.authorization,'Bearer '+workerToken);
   if(u.pathname.endsWith('/shopee-oauth-exact')){
    if(body.action==='heartbeat')return Response.json(await scalar(db,'select public.sellerpilot_shopee_exact_oauth_heartbeat($1,$2,$3,$4)',[session,workerHash,body.jobId,body.claimToken]));
    const response=await scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',[body.action,session,workerHash]);if(response.status==='claimed')deliveredClaim=response.job.claim_token;return Response.json(response);
   }
   const args=[workerHash,body.jobId,body.claimToken];
   if(u.pathname.endsWith('/credential-refresh')){
    if(body.action==='begin'){assert.equal(await scalar(db,'select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3)',args),true);return Response.json({status:'in_flight'});}
    const refresh=body.credentialRefresh;
    const staged=await scalar(db,'select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4::jsonb,$5::timestamptz,$6,$7)',[...args,JSON.stringify(refresh.payload),refresh.expiresAt??null,refresh.recoveryOnly===true,refresh.oauthComplete===true]);assert.equal(staged.status,refresh.recoveryOnly?'recovery_preserved':'prepared');return Response.json({status:staged.status});
   }
   assert.ok(u.pathname.endsWith('/complete'),'unexpected runtime path');completeCalls++;
   const parsed=gatewayWorkerCompletionSchema.parse(body);assert.equal(parsed.status,'succeeded');
   const context=await scalar(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',args);assert.equal(context.status,'running');
   // Mirror the inspected core route's OAuth response projection, not a success stub.
   const storedResponse={ok:true,channel:parsed.result.channel,operation:parsed.result.operation,safeMessage:parsed.result.safeMessage};
   const completion=await scalar(db,'select public.sellerpilot_service_complete_gateway_transaction($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)',[...args,parsed.status,JSON.stringify(storedResponse),null,JSON.stringify(parsed.credentialRefresh)]);assert.equal(completion.status,'completed');
   // Do not fabricate an HTTP success before the real completion's cleanup.
   await assertRealCompletionCleanup(db,boundJob,deliveredClaim);
   return Response.json({message:'actual fixture completion accepted'});
  };
  console.log=(...args)=>runnerLogs.push(args.join(' '));
  await tsImport('../scripts/shopee-oauth-exact-once.mjs',import.meta.url);
  assert.equal(completeCalls,1);assert.equal(providerCodeCalls,1);assert.equal(runnerLogs.length,1);
  const report=JSON.parse(runnerLogs[0]);assert.equal(report.status,'oauth_completed');assert.equal(report.safeReadVerified,false);assert.equal(report.jobId,boundJob);
  const finalJob=await assertRealCompletionCleanup(db,boundJob,deliveredClaim);
  assert.equal(await scalar(db,'select created_by from sellerpilot_private.channel_credentials where id=$1',[finalJob.credential_id]),owner);
  assert.equal(await scalar(db,'select created_by from sellerpilot_private.ai_cli_worker_tokens where id=$1',[token]),workerOwner);
 }finally{globalThis.fetch=priorFetch;console.log=priorLog;for(const name of envNames){if(priorEnv[name]===undefined)delete process.env[name];else process.env[name]=priorEnv[name];}await db.close();}
});

for(const reaper of ['generic-claim','scheduled-reaper'])for(const phase of ['before-delivery','delivered-no-begin','provider-in-flight'])test('exact expired '+phase+' cannot escape through '+reaper,async()=>{const db=await fixture();try{
 await scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5)',['prepare',owner,session,credential,hash]);
 await scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',['pulse',session,hash]);
 const bound=await scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',['bind',owner,session,credential,hash,JSON.stringify({code:'fixture-expired-code',mainAccountId:'123456'})]);
 const vaultId=await scalar(db,'select oauth_request_vault_id from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId]);
 if(phase!=='before-delivery'){
  const claim=await scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',['claim',session,hash]);
  if(phase==='provider-in-flight')assert.equal(await scalar(db,'select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3)',[hash,bound.jobId,claim.job.claim_token]),true);
 }
 await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[bound.jobId]);
 if(reaper==='scheduled-reaper'){const r=await scalar(db,'select public.sellerpilot_service_reap_stale_channel_gateway_jobs(100)');assert.equal(r.retried,0);assert.equal(r.reconciliationRequired,1);}
 assert.equal(await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']),null);
 const job=(await db.query('select status,attempt_count,worker_token_id,claim_token,lease_expires_at,oauth_request_vault_id,created_by from sellerpilot_private.channel_gateway_jobs where id=$1',[bound.jobId])).rows[0];
 assert.deepEqual(job,{status:'reconciliation_required',attempt_count:1,worker_token_id:null,claim_token:null,lease_expires_at:null,oauth_request_vault_id:null,created_by:owner});
 assert.equal(await scalar(db,'select count(*)::int from vault.secrets where id=$1',[vaultId]),0);
 assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where status='queued'"),0);
 assert.equal(await scalar(db,'select count(*)::int from sellerpilot_private.gateway_completion_receipts where job_id=$1',[bound.jobId]),0);
 await assert.rejects(db.query("update sellerpilot_private.channel_gateway_jobs set status='queued' where id=$1",[bound.jobId]),/TERMINAL_IMMUTABLE/);
}finally{await db.close();}});

test('real generic source still requeues and reclaims an ordinary unlinked OAuth: exact fence is scoped',async()=>{const db=await fixture();try{
 const id=await scalar(db,"select public.sellerpilot_enqueue_channel_gateway_job($1,null,'shopee','oauth.exchange',$2::jsonb)",[credential,JSON.stringify({code:'ordinary-fixture-code',mainAccountId:'123456'})]);
 const first=await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']);assert.equal(first.id,id);
 await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[id]);
 const next=await scalar(db,'select public.sellerpilot_claim_channel_gateway_job($1,$2)',[hash,'sellerpilot-cli-worker/1.13']);assert.equal(next.id,id);assert.equal(next.attempt_count,2);
}finally{await db.close();}});
