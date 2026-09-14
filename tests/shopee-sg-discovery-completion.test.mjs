import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {completeExistingShopeeDiscovery} from '../lib/product-registration/shopee/discovery-job-completion.ts';
const migration=await readFile(new URL('../supabase/migrations/20260914164000_shopee_sg_discovery_job_read.sql',import.meta.url),'utf8');
const checks=JSON.parse(await readFile(new URL('./fixtures/shopee-sg-discovery-gateway-checks.json',import.meta.url),'utf8'));
const actor='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',owner='5286e97b-40aa-406f-9690-5697cf28cbb0',id='e71683b7-113e-4f84-970e-1ca85868ff62',jobId='39c870a8-2ab1-4c73-b859-a2d0b7f2a107',targetId='1719148844';
const successor='10000000-0000-4000-8000-000000000001',vault='10000000-0000-4000-8000-000000000002';
const secret=()=>({provider_account_subject:'shopee:main:4940266',provider_account_identity_version:'v1',shopee_targets:[{type:'shop',id:targetId,access_token:'PRIVATE_TOKEN',access_token_expires_at:new Date(Date.now()+3600000).toISOString()}]});
const response=()=>({ok:true,channel:'shopee',operation:'shops.get',steps:[{ok:true,name:'shop-info',status:200,data:{shop_id:Number(targetId),shop_name:'fixture.sg',region:'SG',status:'NORMAL',access_token:'DO_NOT_RETURN'}}]});
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema sellerpilot_private;create schema vault;
 create function sellerpilot_private.request_has_unambiguous_service_role_claim() returns boolean language sql as $$select current_setting('request.jwt.claim.role',true)='service_role'$$;
 create table sellerpilot_private.admin_users(user_id uuid primary key);
 create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
 create table sellerpilot_private.channel_credentials(id uuid primary key,version int,status text,channel text,environment text,created_by uuid,seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,expires_at timestamptz,vault_secret_id uuid);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,created_by uuid,credential_id uuid,attempt_id uuid,channel text,environment text,operation text,status text,request_payload jsonb,response_payload jsonb,seller_account_key text,created_at timestamptz default now(),completed_at timestamptz,prepared_credential_id uuid,credential_refresh_prepared_at timestamptz,
 attempt_count int default 0,credential_refresh_recovery_vault_id uuid,credential_refresh_recovery_fingerprint text,credential_refresh_recovery_staged_at timestamptz,credential_refresh_in_flight boolean default false,credential_refresh_started_at timestamptz,credential_refresh_fingerprint text,ebay_publication_recovery_claim_count int default 0,oauth_exchange_completed boolean default false,oauth_request_vault_id uuid,oauth_request_fingerprint text,oauth_source_credential_id uuid,rate_limit_count int default 0,claim_token uuid,write_resource_kind text,write_resource_key text,request_fingerprint text,inventory_item_id uuid,order_id uuid,shipment_carrier text,shipment_tracking text);
 select set_config('request.jwt.claim.role','service_role',false);`);
 for(let i=0;i<checks.length;i++)await db.exec(`alter table sellerpilot_private.channel_gateway_jobs add constraint live_${i} ${checks[i]}`);
 await db.query('insert into sellerpilot_private.admin_users values($1),($2)',[actor,owner]);
 await db.query('insert into vault.decrypted_secrets values($1,$2)',[vault,JSON.stringify(secret())]);
 await db.query("insert into sellerpilot_private.channel_credentials values($1,91,'active','shopee','production',$2,$3,'provider_certified_v1',now(),now()+interval '1 year',$4)",[id,owner,'a'.repeat(64),vault]);
 await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,created_by,credential_id,channel,environment,operation,status,request_payload,seller_account_key) values($1,$2,$3,'shopee','production','shops.get','queued',$4,$5)",[jobId,owner,id,{shopId:targetId},'a'.repeat(64)]);
 await db.exec(migration);
 const read=async(credential=id,version=91,who=actor,target=targetId)=>(await db.query('select public.sellerpilot_service_read_shopee_sg_discovery($1,$2,$3,$4) as result',[who,credential,version,target])).rows[0].result;
 return {db,read};
}
test('real shared-admin queued job is discoverable without its lost client ID; exact deployed CHECKs and no writes',async()=>{
 const {db,read}=await setup();try{
 const before=(await db.query('select to_jsonb(j) j from sellerpilot_private.channel_gateway_jobs j')).rows;
 const value=await read();assert.equal(value.status,'queued');assert.equal(value.job.id,jobId);assert.equal(value.actorId,actor);assert.equal(value.job.ownerId,owner);
 assert.equal(value.credentialVersion,91);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_TOKEN|vault_secret|secret_key/);
 assert.deepEqual((await db.query('select to_jsonb(j) j from sellerpilot_private.channel_gateway_jobs j')).rows,before);
 assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='sellerpilot_private.channel_gateway_jobs'::regclass and contype='c'")).rows[0].n,17);
 const denied=(await db.query("select has_function_privilege('authenticated','public.sellerpilot_service_read_shopee_sg_discovery(uuid,uuid,integer,text)','execute') v")).rows[0].v;assert.equal(denied,false);
 await assert.rejects(read(id,91,successor),/ACCESS_DENIED/);await assert.rejects(read(id,92),/CREDENTIAL_CHANGED/);await assert.rejects(read(id,91,actor,'9999'),/TARGET_NOT_AUTHORIZED/);
 await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");await assert.rejects(read(),/ACCESS_DENIED/);
 }finally{await db.close();}
});
test('succeeded exact receipt is redacted then existing cache store preserves actual completion time; queued never stores',async()=>{
 const {db,read}=await setup();try{
 const calls=[];const snapshot={credentialId:id,version:91,secretPayload:secret()};
 const rpc=async(name,args)=>{calls.push({name,args});if(name==='sellerpilot_service_read_shopee_sg_discovery')return {data:await read(),error:null};
 assert.equal(name,'sellerpilot_service_upsert_shopee_market_target_v2');return {data:{contractVersion:2,credentialId:id,credentialVersion:91,targetId,marketCode:'SG'},error:null};};
 assert.equal((await completeExistingShopeeDiscovery({actorId:actor,snapshot,targetId,rpc})).status,202);assert.equal(calls.length,1);
 await db.query("update sellerpilot_private.channel_gateway_jobs set status='succeeded',completed_at=now()-interval '5 seconds',response_payload=$1",[response()]);
 const readback=await read();assert.doesNotMatch(JSON.stringify(readback),/DO_NOT_RETURN|PRIVATE_TOKEN/);
 const result=await completeExistingShopeeDiscovery({actorId:actor,snapshot,targetId,rpc});assert.equal(result.status,200);assert.equal(result.body.targets[0].displayName,'fixture.sg');
 assert.equal(Date.parse(calls.at(-1).args.p_observed_at),Date.parse(readback.job.completedAt));assert.equal(calls.at(-1).args.p_owner_id,actor);
 const wrong=structuredClone(readback);wrong.job.request.shopId='999';await assert.rejects(completeExistingShopeeDiscovery({actorId:actor,snapshot,targetId,rpc:async()=>({data:wrong,error:null})}),/RECEIPT_INVALID/);
 const old=structuredClone(readback);old.job.completedAt=new Date(Date.now()-601000).toISOString();let reads=0;
 assert.equal((await completeExistingShopeeDiscovery({actorId:actor,snapshot,targetId,rpc:async()=>{reads++;return {data:old,error:null};}})).body.code,'SHOPEE_TARGET_DISCOVERY_RECEIPT_EXPIRED');assert.equal(reads,1);
 }finally{await db.close();}
});
test('only exact same-account prepared successor is accepted, never unrelated credentials or altered profile',async()=>{
 const {db,read}=await setup();try{
 await db.query("update sellerpilot_private.channel_credentials set status='revoked'");
 await db.query("insert into sellerpilot_private.channel_credentials select $1,92,'active',channel,environment,created_by,seller_account_key,seller_account_key_source,seller_account_verified_at,expires_at,vault_secret_id from sellerpilot_private.channel_credentials where id=$2",[successor,id]);
 assert.equal((await read(successor,92)).status,'none');
 await db.query("update sellerpilot_private.channel_gateway_jobs set prepared_credential_id=$1,credential_refresh_prepared_at=now(),credential_refresh_fingerprint=$2,status='succeeded',completed_at=now(),response_payload=$3",[successor,'b'.repeat(64),response()]);
 assert.equal((await read(successor,92)).job.sourceCredentialVersion,91);
 await db.query("update sellerpilot_private.channel_gateway_jobs set response_payload=$1",[{...response(),operation:'inquiries.list'}]);await assert.rejects(read(successor,92),/RECEIPT_INVALID/);
 }finally{await db.close();}
});
test('exact target, owner and environment cannot be substituted; failed and reconciliation stay blocked',async()=>{
 const {db,read}=await setup();try{
 const baseline=(await db.query('select request_payload from sellerpilot_private.channel_gateway_jobs')).rows[0].request_payload;
 for(const sql of ["request_payload='{"+'"shopId":"9999"'+"}'::jsonb",`created_by='${actor}'`,"environment='sandbox'"]){
  await db.exec('begin');await db.exec('update sellerpilot_private.channel_gateway_jobs set '+sql);assert.equal((await read()).status,'none');await db.exec('rollback');
 }
 for(const status of ['failed','reconciliation_required']){
  await db.query('update sellerpilot_private.channel_gateway_jobs set status=$1',[status]);
  const result=await completeExistingShopeeDiscovery({actorId:actor,snapshot:{credentialId:id,version:91,secretPayload:secret()},targetId,rpc:async()=>({data:await read(),error:null})});
  assert.equal(result.status,409);assert.equal(result.body.pending,true);
 }
 assert.deepEqual((await db.query('select request_payload from sellerpilot_private.channel_gateway_jobs')).rows[0].request_payload,baseline);
 }finally{await db.close();}
});

test('renewal permits only the exact expired successful read; pending, failed and unrelated jobs cannot pass',async()=>{
 const {canRenewExpiredShopeeDiscovery}=await import('../lib/product-registration/shopee/discovery-job-completion.ts');
 const old={status:409,body:{code:'SHOPEE_TARGET_DISCOVERY_RECEIPT_EXPIRED',refreshable:true,jobId}};
 assert.equal(canRenewExpiredShopeeDiscovery(old,jobId),true);
 for(const candidate of [null,{status:202,body:old.body},{status:409,body:{...old.body,code:'SHOPEE_TARGET_DISCOVERY_PENDING'}},{status:409,body:{...old.body,refreshable:false}}])assert.equal(canRenewExpiredShopeeDiscovery(candidate,jobId),false);
 assert.equal(canRenewExpiredShopeeDiscovery(old,successor),false);assert.equal(canRenewExpiredShopeeDiscovery(old),false);
});
