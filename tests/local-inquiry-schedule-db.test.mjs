import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const original=await readFile(new URL('./fixtures/local-inquiry-schedule-before.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260912223510_admit_approved_local_inquiry_schedule.sql',import.meta.url),'utf8');
const id='00000000-0000-4000-8000-000000000001';
async function fixture(){
 const db=new PGlite();await db.exec(`create schema sellerpilot_private;
 create table sellerpilot_private.serverless_static_egress_policy(channel text,enabled boolean);
 create table sellerpilot_private.channel_credentials(id uuid,channel text,created_by uuid,seller_account_key text,status text,environment text,expires_at timestamptz);
 create table sellerpilot_private.ai_cli_worker_tokens(id uuid,status text,scope text,expires_at timestamptz);
 create table sellerpilot_private.local_channel_executor_routes(credential_id uuid,channel text,owner_id uuid,seller_account_key text,worker_token_id uuid,operation text,enabled boolean,approved_by uuid,approved_at timestamptz,expires_at timestamptz,release_sha text,egress_ip_sha256 text);
 create function sellerpilot_private.active_serverless_runtime_release_sha() returns text language sql as $$select repeat('a',40)$$;
 create function public.sellerpilot_310450_enqueue_periodic_sync_unsafe(text,text,jsonb,integer) returns jsonb language sql as $$select jsonb_build_object('status','delegated','channel',$1,'operation',$2,'payload',$3,'interval',$4)$$;
 insert into sellerpilot_private.channel_credentials values('${id}','temu','${id}',repeat('b',64),'active','production',now()+interval '1 day');
 insert into sellerpilot_private.ai_cli_worker_tokens values('${id}','active','gateway',now()+interval '1 day');
 insert into sellerpilot_private.local_channel_executor_routes values('${id}','temu','${id}',repeat('b',64),'${id}','inquiries.list',true,'${id}',now(),now()+interval '1 hour',repeat('a',40),repeat('c',64));`);
 await db.exec(original);return db;
}
const call=async db=>(await db.query(`select public.sellerpilot_service_enqueue_periodic_sync('temu','inquiries.list','{"periodicKey":"inquiries:history:temu","arguments":{"kind":"after_sales"}}',1440) result`)).rows[0].result;
test('approved local inquiry route removes only the stale cloud enqueue restriction',async()=>{
 const db=await fixture();try{
  assert.equal((await call(db)).status,'fixed_egress_required');await db.exec(migration);
  const result=await call(db);assert.equal(result.status,'delegated');assert.equal(result.interval,1440);assert.equal(result.payload.arguments.kind,'after_sales');
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.serverless_static_egress_policy')).rows[0].n,0);
 }finally{await db.close();}
});
test('local scheduling remains closed for stale, unapproved, mismatched and unavailable routes',async()=>{
 const db=await fixture();try{await db.exec(migration);
  for(const change of [
   "update sellerpilot_private.local_channel_executor_routes set enabled=false",
   "update sellerpilot_private.local_channel_executor_routes set expires_at=now()-interval '1 second'",
   "update sellerpilot_private.local_channel_executor_routes set approved_by=null",
   "update sellerpilot_private.local_channel_executor_routes set approved_at=null",
   "update sellerpilot_private.local_channel_executor_routes set release_sha=repeat('d',40)",
   "update sellerpilot_private.local_channel_executor_routes set egress_ip_sha256=''",
   "update sellerpilot_private.local_channel_executor_routes set seller_account_key=repeat('d',64)",
   "update sellerpilot_private.local_channel_executor_routes set owner_id=gen_random_uuid()",
   "update sellerpilot_private.local_channel_executor_routes set operation='orders.list'",
   "update sellerpilot_private.channel_credentials set status='revoked'",
   "update sellerpilot_private.channel_credentials set environment='sandbox'",
   "update sellerpilot_private.channel_credentials set expires_at=now()-interval '1 second'",
   "update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs'",
   "update sellerpilot_private.ai_cli_worker_tokens set status='revoked'",
   "update sellerpilot_private.ai_cli_worker_tokens set expires_at=now()-interval '1 second'",
  ]){await db.exec('begin');await db.exec(change);assert.equal((await call(db)).status,'fixed_egress_required',change);await db.exec('rollback');}
 }finally{await db.close();}
});
