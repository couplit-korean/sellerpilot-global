import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildReplyObservationRecovery } from '../scripts/diagnostics/build-cs-reply-observation-recovery.mjs';

const migration=await readFile(new URL('../supabase/migrations/20260907232000_add_cs_reply_remote_observation.sql',import.meta.url),'utf8');
const owner='00000000-0000-4000-8000-000000000501';
const credential='00000000-0000-4000-8000-000000000502';
const ticket='00000000-0000-4000-8000-000000000503';
const job='00000000-0000-4000-8000-000000000504';
const delivery='00000000-0000-4000-8000-000000000505';
const inbound=`smartstore:${'a'.repeat(64)}`;
const fingerprint=value=>createHash('sha256').update(value.trim()).digest('hex');

async function fixture({applyMigration = db => db.exec(migration)} = {}){
 const db=new PGlite();await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
  create schema extensions;create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
  create schema sellerpilot_private;
  create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid,channel text,status text);
  create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,channel text,operation text,status text,request_payload jsonb,response_payload jsonb,provider_mutation_started_at timestamptz);
  create table sellerpilot_private.support_tickets(
    id uuid primary key,owner_id uuid,channel_key text,source_credential_id uuid,demo boolean default false,
    external_ticket_id text,reply_context jsonb default '{}',latest_inbound_key text,status text default 'waiting',
    provider_status text default 'waiting',provider_status_updated_at timestamptz,reply_delivery_status text default 'never',
    reply_delivery_error text,resolved_at timestamptz,last_delivery_job_id uuid,updated_at timestamptz default now()
  );
  create table sellerpilot_private.support_inbound_messages(
    id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,inbound_key text,
    remote_message_id text,sender_role text,body text,provider_context jsonb default '{}',received_at timestamptz,
    created_at timestamptz default now(),updated_at timestamptz default now(),unique(owner_id,channel_key,inbound_key)
  );
  create table sellerpilot_private.support_reply_deliveries(
    id uuid primary key,ticket_id uuid,owner_id uuid,gateway_job_id uuid,channel_key text,status text,
    reply_fingerprint text,provider_request_id text,provider_message_id text,safe_message text,reconciliation_reason text,
    acknowledged_at timestamptz,acknowledged_by uuid,acknowledgement_reason text,queued_at timestamptz,
    started_at timestamptz,completed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()
  );
  insert into auth.users values('${owner}');
  insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','smartstore','active');
  insert into sellerpilot_private.support_tickets(id,owner_id,channel_key,source_credential_id,external_ticket_id,
    reply_context,latest_inbound_key,last_delivery_job_id) values('${ticket}','${owner}','smartstore','${credential}',
    'customer:701','{"kind":"customer","inquiryNo":"701"}','${inbound}','${job}');
  insert into sellerpilot_private.channel_gateway_jobs values('${job}','smartstore','inquiries.reply','succeeded',
    '{"sellerpilotTicketId":"${ticket}","sellerpilotInboundKey":"${inbound}","arguments":{"kind":"customer","inquiryNo":"701","reply":"exact answer"}}',
    '{"ok":true}',now()-interval '2 minutes');
  insert into sellerpilot_private.support_reply_deliveries(id,ticket_id,owner_id,gateway_job_id,channel_key,status,
    reply_fingerprint,queued_at,completed_at) values('${delivery}','${ticket}','${owner}','${job}','smartstore','succeeded',
    '${fingerprint('exact answer')}',now()-interval '2 minutes',now()-interval '119 seconds');
 `);try { await applyMigration(db);return db; } catch(error) { await db.close();throw error; }
}

function observation(overrides={}){return [{
 contract:'sellerpilot-reply-observation/1',externalTicketId:'customer:701',
 inboundKey:`smartstore:${'b'.repeat(64)}`,remoteMessageId:'answer-702',occurredAt:new Date(Date.now()-60_000).toISOString(),
 body:'exact answer',replyFingerprint:fingerprint('exact answer'),binding:{kind:'customer',inquiryNo:'701'},...overrides,
}];}
async function observe(db,value=observation()){return (await db.query(
 "select public.sellerpilot_service_observe_inquiry_replies_v1($1,'smartstore',$2) result",
 [credential,JSON.stringify(value)])).rows[0].result;}

test('accepted reply becomes remote-observed only after exact seller echo',async()=>{
 const db=await fixture();try{
  assert.equal((await db.query('select verification_status from sellerpilot_private.support_reply_deliveries')).rows[0].verification_status,'provider_accepted');
  const result=await observe(db);assert.deepEqual(result,{contract:'sellerpilot-reply-observation-result/1',received:1,stored:1,matched:1,unmatched:0,ambiguous:0});
  const row=(await db.query('select * from sellerpilot_private.support_reply_deliveries')).rows[0];
  assert.equal(row.verification_status,'remote_observed');assert.equal(row.provider_message_id,'answer-702');assert.ok(row.remote_observed_at);
  const message=(await db.query('select * from sellerpilot_private.support_inbound_messages')).rows[0];
  assert.equal(message.sender_role,'seller');assert.equal(message.body,'exact answer');
  const current=(await db.query('select * from sellerpilot_private.support_tickets')).rows[0];
  assert.equal(current.status,'resolved');assert.equal(current.provider_status,'answered');
 }finally{await db.close();}
});

test('late echo verifies its delivery but never resolves a newer customer generation',async()=>{
 const db=await fixture();try{
  await db.exec(`update sellerpilot_private.support_tickets set latest_inbound_key='smartstore:${'c'.repeat(64)}',status='waiting',provider_status='waiting'`);
  const result=await observe(db);assert.equal(result.matched,1);
  assert.equal((await db.query('select verification_status from sellerpilot_private.support_reply_deliveries')).rows[0].verification_status,'remote_observed');
  const current=(await db.query('select status,provider_status from sellerpilot_private.support_tickets')).rows[0];
  assert.deepEqual(current,{status:'waiting',provider_status:'waiting'});
 }finally{await db.close();}
});

test('external answer or wrong recipient binding remains unmatched without inventing delivery success',async()=>{
 const db=await fixture();try{
  let result=await observe(db,observation({body:'external answer',replyFingerprint:fingerprint('external answer')}));
  assert.equal(result.stored,1);assert.equal(result.unmatched,1);assert.equal(result.matched,0);
  result=await observe(db,observation({inboundKey:`smartstore:${'d'.repeat(64)}`,remoteMessageId:'wrong-binding',binding:{kind:'customer',inquiryNo:'999'}}));
  assert.equal(result.unmatched,1);assert.equal(result.matched,0);
  assert.equal((await db.query('select verification_status from sellerpilot_private.support_reply_deliveries')).rows[0].verification_status,'provider_accepted');
 }finally{await db.close();}
});

test('body tampering and direct client execution are rejected',async()=>{
 const db=await fixture();try{
  await assert.rejects(observe(db,observation({replyFingerprint:fingerprint('other')})),/CS_REPLY_OBSERVATION_ARGUMENT_INVALID/);
  for(const role of ['anon','authenticated']) assert.equal((await db.query(
    "select has_function_privilege($1,'public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query(
    "select has_function_privilege('service_role','public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,true);
 }finally{await db.close();}
});

async function prepareWrappedRecovery(db,{missingPatchSite=false}={}) {
 await db.exec(`
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
  create function public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()
  returns jsonb language sql security definer set search_path='' as $$
   select jsonb_build_object('blockingDelivery',(
    select jsonb_build_object(${missingPatchSite ? "'legacyStatus',blocking.status," : "'status', blocking.status,"} 'id',blocking.id)
    from sellerpilot_private.support_reply_deliveries blocking limit 1))
  $$;
  create function public.sellerpilot_get_cs_workspace_snapshot()
  returns jsonb language plpgsql security definer set search_path='' as $$
  begin
   if not public.sellerpilot_is_admin() then raise exception 'admin required';end if;
   return public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe() || '{"lazadaGuard":true}'::jsonb;
  end $$;
  create function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  returns jsonb language sql security definer set search_path='' as $$select null::jsonb$$;
  revoke all on function public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe(),
   public.sellerpilot_get_cs_workspace_snapshot(),public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
   from public,anon,authenticated,service_role;
  grant execute on function public.sellerpilot_get_cs_workspace_snapshot(),
   public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid) to authenticated;
  grant execute on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid) to service_role;
 `);
 const rows=(await db.query(`select proname,prosrc from pg_proc where proname in
 ('sellerpilot_get_cs_workspace_snapshot','sellerpilot_09090000_get_cs_workspace_snapshot_unsafe','sellerpilot_get_inquiry_reply_delivery')`)).rows;
 const preimages=Object.fromEntries(rows.map(row=>[row.proname,createHash('sha256').update(row.prosrc).digest('hex')]));
 return buildReplyObservationRecovery({preimages});
}

test('late migration recovery preserves the Lazada wrapper, ACLs and exact reply evidence',async()=>{
 const db=await fixture({applyMigration:async db=>db.exec(await prepareWrappedRecovery(db))});
 try{
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}'`);
  const snapshot=(await db.query('select public.sellerpilot_get_cs_workspace_snapshot() value')).rows[0].value;
  assert.equal(snapshot.lazadaGuard,true);
  assert.equal(snapshot.blockingDelivery.verificationStatus,'provider_accepted');
  await db.exec('reset role');
  assert.equal((await observe(db)).matched,1);
  const journal=(await db.query('select statements[1] source from supabase_migrations.schema_migrations')).rows;
  assert.equal(journal.length,1);assert.equal(journal[0].source,migration);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()','execute') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('service_role','public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)','execute') allowed")).rows[0].allowed,false);
  await assert.rejects(db.exec(await buildReplyObservationRecovery()),/ALREADY_PRESENT_REVIEW_REQUIRED/);
  await db.exec('rollback');
 }finally{await db.close();}
});

test('recovery rejects an unexpectedly public wrapper before any schema change',async()=>{
 const db=await fixture({applyMigration:async db=>{
  const sql=await prepareWrappedRecovery(db);
  await db.exec('grant execute on function public.sellerpilot_get_cs_workspace_snapshot() to anon');
  await assert.rejects(db.exec(sql),/PREIMAGE_MISMATCH/);await db.exec('rollback');
 }});
 try{
  assert.equal((await db.query("select to_regprocedure('public.sellerpilot_cs_snapshot_recovery_hold()') value")).rows[0].value,null);
  assert.equal((await db.query("select count(*)::integer count from information_schema.columns where table_schema='sellerpilot_private' and table_name='support_reply_deliveries' and column_name='verification_status'")).rows[0].count,0);
 }finally{await db.close();}
});

test('a legacy snapshot mismatch rolls back migration data and both temporary renames',async()=>{
 const db=await fixture({applyMigration:async db=>{
  const sql=await prepareWrappedRecovery(db,{missingPatchSite:true});
  await assert.rejects(db.exec(sql),/CS workspace reply verification contract mismatch/);await db.exec('rollback');
 }});
 try{
  const state=(await db.query(`select
   to_regprocedure('public.sellerpilot_get_cs_workspace_snapshot()') is not null wrapper,
   to_regprocedure('public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()') is not null base,
   to_regprocedure('public.sellerpilot_cs_snapshot_recovery_hold()') is null no_hold,
   to_regprocedure('public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)') is null no_partial_rpc,
   (select count(*)::integer from supabase_migrations.schema_migrations) journal_rows`)).rows[0];
  assert.deepEqual(state,{wrapper:true,base:true,no_hold:true,no_partial_rpc:true,journal_rows:0});
 }finally{await db.close();}
});
