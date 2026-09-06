import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const ticket='00000000-0000-4000-8000-000000000003';
const migration=await readFile(new URL('../supabase/migrations/20260907101000_read_cs_conversation_timeline.sql',import.meta.url),'utf8');
async function fixture(){
 const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;create schema sellerpilot_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select auth.uid() is not null$$;
 create table sellerpilot_private.support_tickets(id uuid primary key,owner_id uuid,channel_key text,demo boolean default false,message text,received_at timestamptz default now());
 create table sellerpilot_private.support_inbound_messages(id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,sender_role text,body text,received_at timestamptz,created_at timestamptz default now(),remote_message_id text);
 create table sellerpilot_private.support_reply_deliveries(id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,status text,queued_at timestamptz,created_at timestamptz default now(),gateway_job_id uuid,provider_message_id text);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,channel text,operation text,request_payload jsonb);
 insert into sellerpilot_private.support_tickets(id,owner_id,channel_key,message) values('${ticket}','${owner}','smartstore','legacy original');
 select set_config('request.jwt.claim.sub','${owner}',false);
 `);await db.exec(migration);return db;
}
async function page(db,{limit=50,cursor=null}={}){return (await db.query('select public.sellerpilot_get_cs_conversation($1,$2,$3,$4,$5) as result',[ticket,limit,cursor?.beforeTime??null,cursor?.beforeKey??null,cursor?.asOf??null])).rows[0].result;}
async function inbound(db,role,body,at='2026-09-01T12:00:00Z',remote=null){return db.query(`insert into sellerpilot_private.support_inbound_messages(ticket_id,owner_id,channel_key,sender_role,body,received_at,remote_message_id) values($1,$2,'smartstore',$3,$4,$5,$6)`,[ticket,owner,role,body,at,remote]);}
async function delivery(db,status,remote=null,channel='smartstore'){
 const j=(await db.query('select gen_random_uuid() as id')).rows[0].id;
 const args=channel==='qoo10'?{params:{contents:'sent reply'}}:{reply:'sent reply'};
 await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,'inquiries.reply',$3)`,[j,channel,{sellerpilotTicketId:ticket,arguments:args}]);
 await db.query(`insert into sellerpilot_private.support_reply_deliveries(ticket_id,owner_id,channel_key,status,queued_at,gateway_job_id,provider_message_id) values($1,$2,$3,$4,'2026-09-01T12:00:01Z',$5,$6)`,[ticket,owner,channel,status,j,remote]);
}
test('timeline includes customer, external seller and queued/accepted replies without calling ACK remote verified',async()=>{
 const db=await fixture();try{
 await inbound(db,'customer','question');await inbound(db,'seller','external answer','2026-09-01T12:00:00.5Z');await delivery(db,'succeeded');await delivery(db,'queued');
 const result=await page(db);assert.equal(result.messages.length,4);assert.equal(result.nextCursor,null);
 assert.equal(result.messages.filter(m=>m.deliveryStatus==='provider_accepted').length,1);
 assert.equal(result.messages.filter(m=>m.deliveryStatus==='queued').length,1);
 assert.ok(result.messages.every(m=>!('provider_context' in m)));
 }finally{await db.close();}
});
test('same-time cursor pages have no omissions or duplicates and exclude later inserts',async()=>{
 const db=await fixture();try{
 for(let i=0;i<7;i++)await inbound(db,'customer',`message-${i}`);
 const first=await page(db,{limit:2});const seen=[...first.messages];let cursor=first.nextCursor;
 await inbound(db,'customer','late insert with old timestamp');
 while(cursor){const next=await page(db,{limit:2,cursor});seen.push(...next.messages);cursor=next.nextCursor;}
 assert.equal(seen.length,7);assert.equal(new Set(seen.map(m=>m.key)).size,7);assert.ok(!seen.some(m=>m.body.startsWith('late insert')));
 assert.equal((await page(db)).messages.length,8);
 }finally{await db.close();}
});
test('seller echo deduplication uses remote ID on the same ticket and owner',async()=>{
 const db=await fixture();try{
 await inbound(db,'customer','question');await delivery(db,'succeeded','remote-1');await inbound(db,'seller','sent reply','2026-09-01T12:00:01Z','remote-1');
 assert.equal((await page(db)).messages.length,2);
 await db.query('update sellerpilot_private.support_inbound_messages set owner_id=$1 where sender_role=$2',[other,'seller']);
 assert.equal((await page(db)).messages.filter(m=>m.source==='sellerpilot').length,1);
 }finally{await db.close();}
});
test('owner isolation, demo filtering and no service-role privilege',async()=>{
 const db=await fixture();try{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal(await page(db),null);
 await db.exec(`select set_config('request.jwt.claim.sub','',false)`);await assert.rejects(page(db),/administrator/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('update sellerpilot_private.support_tickets set demo=true');assert.equal(await page(db),null);
 assert.equal((await db.query(`select has_function_privilege('service_role','public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz)','execute') allowed`)).rows[0].allowed,false);
 }finally{await db.close();}
});
test('legacy original is displayed once; Qoo10 outbound body is read from its native payload',async()=>{
 const db=await fixture();try{
 assert.equal((await page(db)).messages[0].body,'legacy original');
 await db.exec("update sellerpilot_private.support_tickets set channel_key='qoo10'");await delivery(db,'succeeded',null,'qoo10');
 assert.ok((await page(db)).messages.some(m=>m.body==='sent reply'));
 }finally{await db.close();}
});
test('invalid pagination is rejected and missing outbound bodies are not invented',async()=>{
 const db=await fixture();try{
 for(const limit of [0,101,null])await assert.rejects(page(db,{limit}),/invalid conversation cursor/);
 await assert.rejects(page(db,{cursor:{beforeTime:'2026-01-01T00:00:00Z',beforeKey:null}}),/invalid conversation cursor/);
 await delivery(db,'failed');await db.exec("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_build_object('sellerpilotTicketId',request_payload->>'sellerpilotTicketId')");
 assert.equal((await page(db)).messages.find(m=>m.source==='sellerpilot').body,null);
 }finally{await db.close();}
});
