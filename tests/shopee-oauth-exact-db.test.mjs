import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const owner='11111111-1111-4111-8111-111111111111', credential='22222222-2222-4222-8222-222222222222', session='33333333-3333-4333-8333-333333333333', token='44444444-4444-4444-8444-444444444444', hash='a'.repeat(64);
const migration=await readFile(new URL('../supabase/migrations/20260906030000_shopee_exact_oauth_executor.sql',import.meta.url),'utf8');
async function fixture(){const db=new PGlite();await db.exec(`
create role anon;create role authenticated;create role service_role;create schema auth;create schema vault;create schema sellerpilot_private;
create table auth.users(id uuid primary key);create table sellerpilot_private.admin_users(user_id uuid primary key);
create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid,channel text,environment text,status text,vault_secret_id uuid,seller_account_key text,expires_at timestamptz default (now()+interval '30 days'));
create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,created_by uuid,token_hash text,scope text,status text,expires_at timestamptz);
create table sellerpilot_private.channel_gateway_jobs(id uuid primary key default gen_random_uuid(),credential_id uuid,created_by uuid,channel text,operation text,environment text,status text,attempt_count integer default 0,provider_mutation_started_at timestamptz,worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz,started_at timestamptz,updated_at timestamptz,request_payload jsonb,oauth_request_vault_id uuid,oauth_source_credential_id uuid);
create function public.sellerpilot_enqueue_channel_gateway_job(c uuid,a uuid,ch text,op text,p jsonb) returns uuid language plpgsql as $$declare result uuid;v uuid:=gen_random_uuid();begin
if exists(select 1 from sellerpilot_private.channel_gateway_jobs where credential_id=c and operation='oauth.exchange' and status='reconciliation_required') then raise exception 'EXISTING_RECON_FENCE';end if;
insert into vault.decrypted_secrets values(v,p::text);
insert into sellerpilot_private.channel_gateway_jobs(credential_id,created_by,channel,operation,environment,status,request_payload,oauth_request_vault_id,oauth_source_credential_id) values(c,'${owner}',ch,op,'production','queued','{"vaultBacked":true}',v,c) returning id into result;return result;end$$;
insert into auth.users values('${owner}');insert into sellerpilot_private.admin_users values('${owner}');
insert into sellerpilot_private.ai_cli_worker_tokens values('${token}','${owner}','${hash}','gateway','active',now()+interval '1 day');
insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','shopee','production','active','${credential}',repeat('b',64),now()+interval '30 days');
insert into vault.decrypted_secrets values('${credential}','{"partner_id":"2031489","shop_id":"1719148844","main_account_id":"123456","shop_ids":["1719148844","2","3","4","5","6","7","8"]}');
insert into sellerpilot_private.channel_gateway_jobs(credential_id,created_by,channel,operation,environment,status,request_payload) values('${credential}','${owner}','shopee','diagnostic.test','production','queued','{}'),('${credential}','${owner}','shopee','listing.create','production','reconciliation_required','{}'),('${credential}','${owner}','smartstore','inquiries.list','production','queued','{}');
`);await db.exec(migration);return db;}
async function scalar(db,sql,p=[]){return Object.values((await db.query(sql,p)).rows[0])[0];}
const admin=(db,action,request={},state=hash,who=owner)=>scalar(db,'select public.sellerpilot_shopee_exact_oauth_admin($1,$2,$3,$4,$5,$6::jsonb)',[action,who,session,credential,state,JSON.stringify(request)]);
const worker=(db,action,key=hash)=>scalar(db,'select public.sellerpilot_shopee_exact_oauth_worker($1,$2,$3)',[action,session,key]);
const binding={code:'fixture-code',mainAccountId:'123456'};
test('empty readiness, armed lease, atomic exact bind, one delivery and unrelated jobs unchanged',async()=>{const db=await fixture();try{
const before=(await db.query('select * from sellerpilot_private.channel_gateway_jobs order by id')).rows;
assert.equal((await admin(db,'prepare')).status,'executor_required');assert.equal((await admin(db,'start')).status,'executor_required');
assert.equal((await worker(db,'pulse')).status,'armed');assert.equal((await worker(db,'claim')).status,'waiting');assert.equal((await admin(db,'start')).status,'ready');
const bound=await admin(db,'bind',binding);assert.equal(bound.status,'bound');
assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where operation='oauth.exchange' and status='queued'"),0);
const claimed=await worker(db,'claim');assert.equal(claimed.status,'claimed');assert.equal(claimed.job.id,bound.jobId);assert.equal(claimed.job.credential.shop_id,'1719148844');assert.equal(claimed.job.attempt_count,1);
await assert.rejects(worker(db,'claim'),/SHOPEE_EXACT_CLAIM_EXPIRED/);await assert.rejects(admin(db,'bind',binding),/SHOPEE_EXACT_CODE_ALREADY_BOUND/);
assert.deepEqual((await db.query("select * from sellerpilot_private.channel_gateway_jobs where operation<>'oauth.exchange' order by id")).rows,before);
}finally{await db.close();}});
for(const scenario of ['wrong-state','wrong-token','wrong-owner','wrong-main','expired-ready','identity-changed','wrong-scope','recon'])test('fails closed: '+scenario,async()=>{const db=await fixture();try{
await admin(db,'prepare');await worker(db,'pulse');
if(scenario==='wrong-state')await assert.rejects(admin(db,'bind',binding,'c'.repeat(64)),/SESSION_INVALID/);
if(scenario==='wrong-token')await assert.rejects(worker(db,'claim','c'.repeat(64)),/TOKEN_INVALID/);
if(scenario==='wrong-owner')await assert.rejects(admin(db,'start',{},hash,'99999999-9999-4999-8999-999999999999'),/OWNER_REQUIRED/);
if(scenario==='wrong-main')await assert.rejects(admin(db,'bind',{...binding,mainAccountId:'999'}),/CALLBACK_IDENTITY_INVALID/);
if(scenario==='expired-ready'){await db.exec("update sellerpilot_private.shopee_exact_oauth_sessions set ready_until=now()-interval '1 second'");assert.equal((await admin(db,'bind',binding)).status,'executor_required');}
if(scenario==='identity-changed'){await db.exec("update vault.decrypted_secrets set decrypted_secret=(decrypted_secret::jsonb||'{\"main_account_id\":\"999\"}'::jsonb)::text");await assert.rejects(admin(db,'start'),/SESSION_INVALID/);}
if(scenario==='wrong-scope'){await db.exec("update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs'");await assert.rejects(worker(db,'pulse'),/TOKEN_INVALID/);}
if(scenario==='recon'){await db.exec(`insert into sellerpilot_private.channel_gateway_jobs(credential_id,operation,status)values('${credential}','oauth.exchange','reconciliation_required')`);await assert.rejects(admin(db,'bind',binding),/EXISTING_RECON_FENCE/);}
assert.equal(await scalar(db,"select count(*)::int from sellerpilot_private.channel_gateway_jobs where operation='oauth.exchange' and status='running'"),0);
}finally{await db.close();}});
test('service-only ABI and closed private tables',async()=>{const db=await fixture();try{for(const role of ['anon','authenticated'])for(const signature of ['public.sellerpilot_shopee_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb)','public.sellerpilot_shopee_exact_oauth_worker(text,uuid,text)'])assert.equal(await scalar(db,"select has_function_privilege($1,$2,'EXECUTE')",[role,signature]),false);for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar(db,"select has_table_privilege($1,'sellerpilot_private.shopee_exact_oauth_sessions','SELECT')",[role]),false);}finally{await db.close();}});
