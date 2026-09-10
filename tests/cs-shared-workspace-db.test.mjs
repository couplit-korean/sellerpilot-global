import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const operator='00000000-0000-4000-8000-000000000001';
const creator='00000000-0000-4000-8000-000000000002';
const outsider='00000000-0000-4000-8000-000000000003';
const ticket='00000000-0000-4000-8000-000000000004';
const migration=await readFile(new URL('../supabase/migrations/20260907180100_restore_shared_admin_cs_reads.sql',import.meta.url),'utf8');
const signatures=[
 'public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz)',
 'public.sellerpilot_search_cs_archive(text,text,text,date,date,integer,timestamptz,uuid,timestamptz)',
 'public.sellerpilot_list_owned_ebay_message_accounts()',
];
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema sellerpilot_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table sellerpilot_private.admin_users(user_id uuid primary key);
 insert into sellerpilot_private.admin_users values('${operator}');
 create table sellerpilot_private.support_tickets(id uuid primary key default gen_random_uuid(),owner_id uuid,channel_key text default 'ebay',external_ticket_id text default 'native',customer_name text default 'Synthetic',subject text default 'Original subject',message text default 'legacy original',status text default 'waiting',received_at timestamptz default '2026-09-01T00:00:00Z',updated_at timestamptz default now(),demo boolean default false,reply_gateway_job_id uuid);
 create table sellerpilot_private.support_inbound_messages(id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text default 'ebay',sender_role text default 'customer',body text,received_at timestamptz default '2026-09-01T00:00:00Z',created_at timestamptz default now(),remote_message_id text,provider_context jsonb default '{}');
 create table sellerpilot_private.support_reply_deliveries(id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text default 'ebay',status text default 'succeeded',queued_at timestamptz default '2026-09-01T00:00:01Z',created_at timestamptz default now(),gateway_job_id uuid,provider_message_id text);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,channel text,operation text,request_payload jsonb);
 create table sellerpilot_private.channel_credentials(id uuid primary key default gen_random_uuid(),created_by uuid,channel text,environment text,version integer,status text,seller_account_key text,seller_account_key_source text);
 insert into sellerpilot_private.support_tickets(id,owner_id) values('${ticket}','${creator}');
 insert into sellerpilot_private.channel_credentials(created_by,channel,environment,version,status,seller_account_key,seller_account_key_source) values
 ('${creator}','ebay','production',1,'active','synthetic-seller-key','provider_certified_v1'),
 ('${creator}','ebay','production',0,'revoked','old-key','provider_certified_v1'),
 ('${creator}','qoo10','production',1,'active','different-channel','provider_certified_v1');
 select set_config('request.jwt.claim.sub','${operator}',false);`);
 for(const name of ['support_tickets','support_inbound_messages','support_reply_deliveries','channel_gateway_jobs','channel_credentials','admin_users']) await db.exec(`alter table sellerpilot_private.${name} enable row level security;revoke all on sellerpilot_private.${name} from public,anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('./fixtures/shared-cs-live-policy-20260907.sql',import.meta.url),'utf8'));
 for(const name of ['20260907101000_read_cs_conversation_timeline.sql','20260907102000_project_unsequenced_cs_answers.sql','20260907103000_search_cs_archive.sql','20260907120000_read_owned_ebay_message_accounts.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
 return db;
}
async function timeline(db,limit=50,cursor=null){return (await db.query('select public.sellerpilot_get_cs_conversation($1,$2,$3,$4,$5) result',[ticket,limit,cursor?.beforeTime??null,cursor?.beforeKey??null,cursor?.asOf??null])).rows[0].result;}
async function search(db,query=''){return (await db.query('select public.sellerpilot_search_cs_archive($1) result',[query])).rows[0].result;}
async function accounts(db){return (await db.query('select * from public.sellerpilot_list_owned_ebay_message_accounts()')).rows;}
async function message(db,body,owner=creator,channel='ebay'){await db.query('insert into sellerpilot_private.support_inbound_messages(ticket_id,owner_id,channel_key,body)values($1,$2,$3,$4)',[ticket,owner,channel,body]);}

test('shared administrator can read creator-owned CS without reassigning rows or credential ownership',async()=>{
 const db=await fixture();try{
  await db.exec('set role authenticated');
  assert.equal(await timeline(db),null);assert.equal((await search(db)).tickets.length,0);assert.equal((await accounts(db)).length,0);
  await db.exec('reset role');await db.exec(migration);await db.exec('set role authenticated');
  assert.equal((await timeline(db)).messages[0].body,'legacy original');assert.equal((await search(db)).tickets[0].id,ticket);
  assert.equal((await accounts(db)).length,1);assert.equal((await accounts(db))[0].seller_account_key,'synthetic-seller-key');
  await assert.rejects(db.query('select * from sellerpilot_private.channel_credentials'),/permission denied/);
  await assert.rejects(db.query('select * from sellerpilot_private.support_tickets'),/permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query('select owner_id from sellerpilot_private.support_tickets')).rows[0].owner_id,creator);
  assert.ok((await db.query('select created_by from sellerpilot_private.channel_credentials')).rows.every(row=>row.created_by===creator));
 }finally{await db.close();}
});

test('shared reads still reject nonmember authenticated users, removed admins, anonymous and service role',async()=>{
 const db=await fixture();try{
  await db.exec(migration);await db.exec('set role authenticated');
  for(const id of [outsider,'']){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
   await assert.rejects(timeline(db),/administrator/);await assert.rejects(search(db),/administrator/);await assert.rejects(accounts(db),/administrator/);
  }
  await db.exec('reset role');await db.exec('delete from sellerpilot_private.admin_users');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[operator]);await db.exec('set role authenticated');
  await assert.rejects(accounts(db),/administrator/);await db.exec('reset role');
  for(const role of ['anon','service_role'])for(const signature of signatures)assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,signature])).rows[0].allowed,false);
 }finally{await db.close();}
});

test('shared timeline and search retain exact ticket-owner-channel and outbound job bindings',async()=>{
 const db=await fixture();try{
  await db.exec(migration);await message(db,'original question');await message(db,'foreign owner body',operator);await message(db,'wrong channel body',creator,'qoo10');
  const job='00000000-0000-4000-8000-000000000005';
  await db.query("insert into sellerpilot_private.channel_gateway_jobs values($1,'ebay','inquiries.reply',$2)",[job,{sellerpilotTicketId:ticket,arguments:{reply:'sent original'}}]);
  await db.query('insert into sellerpilot_private.support_reply_deliveries(ticket_id,owner_id,gateway_job_id)values($1,$2,$3)',[ticket,creator,job]);
  await db.exec('set role authenticated');
  assert.deepEqual((await timeline(db)).messages.map(m=>m.body),['sent original','original question']);
  assert.equal((await search(db,'foreign owner body')).tickets.length,0);assert.equal((await search(db,'wrong channel body')).tickets.length,0);
  assert.equal((await search(db,'sent original')).tickets.length,1);
  await db.exec('reset role');await db.query('update sellerpilot_private.channel_gateway_jobs set request_payload=$1',[{sellerpilotTicketId:outsider,arguments:{reply:'sent original'}}]);
  await db.exec('set role authenticated');assert.equal((await timeline(db)).messages.length,1);assert.equal((await search(db,'sent original')).tickets.length,0);
  await db.exec('reset role');await db.exec('update sellerpilot_private.support_tickets set demo=true');await db.exec('set role authenticated');
  assert.equal(await timeline(db),null);assert.equal((await search(db)).tickets.length,0);
 }finally{await db.close();}
});

test('shared same-time pagination retains every original and excludes subsequent inserts',async()=>{
 const db=await fixture();try{
  await db.exec(migration);for(let i=0;i<7;i++)await message(db,`original-${i}`);
  let page=await timeline(db,2);const entries=[...page.messages];await message(db,'late');
  while(page.nextCursor){page=await timeline(db,2,page.nextCursor);entries.push(...page.messages);}
  assert.equal(entries.length,7);assert.equal(new Set(entries.map(m=>m.key)).size,7);assert.ok(entries.every(m=>m.body!=='late'));
 }finally{await db.close();}
});

test('migration rejects changed policy or CS preimages atomically without widening any reader',async()=>{
 for(const target of ['public.sellerpilot_is_admin()','public.sellerpilot_search_cs_archive(text,text,text,date,date,integer,timestamptz,uuid,timestamptz)']){
  const db=await fixture();try{
   const definition=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[target])).rows[0].definition;
   await db.exec(definition.replace('AS $function$','AS $function$\n-- changed policy fixture'));
   await assert.rejects(db.exec(migration),/CS_SHARED_(WORKSPACE_POLICY|READ_PREIMAGE)_REVIEW_REQUIRED/);await db.exec('rollback');
   assert.equal((await accounts(db)).length,0);assert.equal(await timeline(db),null);
  }finally{await db.close();}
 }
});
