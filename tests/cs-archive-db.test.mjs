import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;create schema sellerpilot_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select auth.uid() is not null$$;
 create table sellerpilot_private.support_tickets(id uuid primary key default gen_random_uuid(),owner_id uuid default '${owner}',channel_key text default 'smartstore',external_ticket_id text,customer_name text default 'Synthetic',subject text default 'subject',message text default 'question',status text default 'waiting',received_at timestamptz default '2026-09-01T00:00:00Z',updated_at timestamptz default now(),demo boolean default false);
 create table sellerpilot_private.support_inbound_messages(ticket_id uuid,owner_id uuid default '${owner}',channel_key text default 'smartstore',body text,provider_context jsonb default '{}',created_at timestamptz default now());
 create table sellerpilot_private.support_reply_deliveries(ticket_id uuid,owner_id uuid default '${owner}',channel_key text default 'smartstore',gateway_job_id uuid,created_at timestamptz default now());
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,channel text,operation text,request_payload jsonb);
 select set_config('request.jwt.claim.sub','${owner}',false);
 `);await db.exec(await readFile(new URL('../supabase/migrations/20260907103000_search_cs_archive.sql',import.meta.url),'utf8'));return db;
}
async function seed(db,values={}){const {externalId='ticket',channel='smartstore',status='waiting',at='2026-09-01T00:00:00Z',ownedBy=owner,demo=false,message='question'}=values;
 return (await db.query('insert into sellerpilot_private.support_tickets(external_ticket_id,channel_key,status,received_at,owner_id,demo,message)values($1,$2,$3,$4,$5,$6,$7)returning id',[externalId,channel,status,at,ownedBy,demo,message])).rows[0].id;
}
async function search(db,{query='',channel=null,status=null,from=null,to=null,limit=25,cursor=null}={}){
 return (await db.query('select public.sellerpilot_search_cs_archive($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[query,channel,status,from,to,limit,cursor?.beforeTime??null,cursor?.beforeId??null,cursor?.asOf??null])).rows[0].result;
}
test('archive pages beyond the recent list cap without duplicates at equal times',async()=>{
 const db=await fixture();try{
 for(let i=0;i<61;i++)await seed(db,{externalId:`old-${i}`});
 let p=await search(db),ids=p.tickets.map(t=>t.id);assert.equal(p.tickets.length,25);
 await seed(db,{externalId:'late'});
 while(p.nextCursor){p=await search(db,{cursor:p.nextCursor});ids.push(...p.tickets.map(t=>t.id));}
 assert.equal(ids.length,61);assert.equal(new Set(ids).size,61);
 }finally{await db.close();}
});
test('archive isolates owner and demo records and has no anonymous or service execution privilege',async()=>{
 const db=await fixture();try{
 await seed(db);await seed(db,{ownedBy:other});await seed(db,{demo:true});assert.equal((await search(db)).tickets.length,1);
 await db.exec("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(search(db),/administrator/);
 for(const role of ['anon','service_role'])assert.equal((await db.query(`select has_function_privilege($1,'public.sellerpilot_search_cs_archive(text,text,text,date,date,integer,timestamptz,uuid,timestamptz)','EXECUTE') permitted`,[role])).rows[0].permitted,false);
 }finally{await db.close();}
});
test('archive channel status and inclusive Korean date boundaries are exact',async()=>{
 const db=await fixture();try{
 await seed(db,{externalId:'before',at:'2026-08-31T14:59:59Z'});await seed(db,{externalId:'start',at:'2026-08-31T15:00:00Z'});
 await seed(db,{externalId:'end',at:'2026-09-01T14:59:59.999Z'});await seed(db,{externalId:'after',at:'2026-09-01T15:00:00Z'});
 await seed(db,{channel:'qoo10'});await seed(db,{status:'resolved'});
 assert.deepEqual((await search(db,{channel:'smartstore',status:'waiting',from:'2026-09-01',to:'2026-09-01'})).tickets.map(t=>t.externalId),['end','start']);
 }finally{await db.close();}
});
test('archive finds original inbound, undated and sent answer content with ticket-owner-channel lineage',async()=>{
 const db=await fixture();try{
 const ticket=await seed(db),second=await seed(db,{externalId:'second'});
 await db.query("insert into sellerpilot_private.support_inbound_messages(ticket_id,body,provider_context)values($1,'historic response',$2)",[ticket,{unsequencedAnswers:[{body:'undated answer'}],secret:'not exposed'}]);
 assert.equal((await search(db,{query:'historic response'})).tickets[0].id,ticket);assert.equal((await search(db,{query:'undated answer'})).tickets[0].id,ticket);
 const job='00000000-0000-4000-8000-000000000009';
 await db.query("insert into sellerpilot_private.channel_gateway_jobs values($1,'smartstore','inquiries.reply',$2)",[job,{sellerpilotTicketId:ticket,arguments:{reply:'sent archive answer'}}]);
 await db.query('insert into sellerpilot_private.support_reply_deliveries(ticket_id,gateway_job_id)values($1,$2)',[ticket,job]);
 assert.equal((await search(db,{query:'sent archive answer'})).tickets.length,1);
 await db.query('update sellerpilot_private.channel_gateway_jobs set request_payload=$1',[{sellerpilotTicketId:second,arguments:{reply:'sent archive answer'}}]);
 assert.equal((await search(db,{query:'sent archive answer'})).tickets.length,0);
 await db.query('update sellerpilot_private.support_inbound_messages set owner_id=$1',[other]);assert.equal((await search(db,{query:'historic response'})).tickets.length,0);
 assert.equal(JSON.stringify(await search(db)).includes('not exposed'),false);
 }finally{await db.close();}
});
test('archive escapes wildcard input and validates filters/cursors before returning data',async()=>{
 const db=await fixture();try{
 await seed(db,{message:'literal 100%_done\\ok'});await seed(db,{message:'100XXdone ok'});
 assert.equal((await search(db,{query:'100%_done\\ok'})).tickets.length,1);
 for(const args of [{query:'x'.repeat(121)},{channel:'unknown'},{status:'unknown'},{limit:0},{limit:51},{from:'2026-09-02',to:'2026-09-01'},{cursor:{beforeTime:'2026-09-01T00:00:00Z'}}])await assert.rejects(search(db,args),/invalid archive/);
 }finally{await db.close();}
});
