import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const source = await readFile(new URL('../supabase/migrations/20260907190000_preserve_undated_lazada_buyers.sql',import.meta.url),'utf8');
const prior = await readFile(new URL('../supabase/migrations/20260905140000_preserve_unordered_lazada_messages.sql',import.meta.url),'utf8');
const owner='00000000-0000-4000-8000-000000000001';
const credential='00000000-0000-4000-8000-000000000002';
const account='a'.repeat(64);
const buyer=(id='native-buyer')=>({externalTicketId:'lazada-im:synthetic-session',remoteMessageId:id,message:'  ORIGINAL 고객 원문\n',senderRole:'customer',orderingStatus:'unverified',receivedAt:''});

async function fixture() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create schema sellerpilot_private; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.channels(key text primary key);
    insert into sellerpilot_private.channels values('lazada');
    create table sellerpilot_private.channel_credentials(id uuid,created_by uuid,seller_account_key text,seller_account_key_source text,channel text,status text);
    create table sellerpilot_private.support_tickets(id uuid,source_credential_id uuid,external_ticket_id text);
    create table sellerpilot_private.support_inbound_messages(ticket_id uuid,owner_id uuid,channel_key text,remote_message_id text,body text,sender_role text);`);
  for(const name of ['cs140-reviewed-live-dependencies.sql','cs140-reviewed-live-preimages.sql'])
    await db.exec(await readFile(new URL(`./fixtures/${name}`,import.meta.url),'utf8'));
  await db.exec(prior);
  await db.query('insert into auth.users values($1)',[owner]);
  await db.query("insert into sellerpilot_private.channel_credentials values($1,$2,$3,'provider_certified_v1','lazada','active')",[credential,owner,account]);
  return db;
}
async function ingest(db,rows) {
  return (await db.query('select public.sellerpilot_service_ingest_lazada_inquiries_v2($1,$2::jsonb) result',[credential,JSON.stringify(rows)])).rows[0].result;
}
async function count(db,table) {
  return (await db.query(`select count(*)::int n from sellerpilot_private.${table}`)).rows[0].n;
}

test('reviewed old DB rejects unknown buyer; extension stores exact original without a new inquiry',async()=>{
  const db=await fixture();try{
    assert.equal((await ingest(db,[buyer()])).status,'partial');
    assert.equal(await count(db,'lazada_unordered_messages'),0);
    await db.exec(source);
    const receipt=await ingest(db,[buyer()]);
    assert.equal(receipt.status,'complete');assert.equal(receipt.quarantinedCount,1);assert.equal(receipt.normalCount,0);
    assert.deepEqual((await db.query('select owner_id,sender_role,body from sellerpilot_private.lazada_unordered_messages')).rows,[{owner_id:owner,sender_role:'customer',body:buyer().message}]);
    assert.equal(await count(db,'support_tickets'),0);assert.equal(await count(db,'support_inbound_messages'),0);
    assert.equal((await db.query('select public.sellerpilot_service_lazada_quarantine_ready_v3() ready')).rows[0].ready,true);
  }finally{await db.close();}
});

test('buyer replay is idempotent and never extends original retention',async()=>{
  const db=await fixture();try{
    await db.exec(source);await ingest(db,[buyer()]);
    const before=(await db.query('select * from sellerpilot_private.lazada_unordered_messages')).rows;
    await ingest(db,[buyer()]);
    assert.deepEqual((await db.query('select * from sellerpilot_private.lazada_unordered_messages')).rows,before);
    await db.exec("update sellerpilot_private.lazada_unordered_messages set observed_at=now()-interval '8 days',expires_at=now()-interval '1 day'; update sellerpilot_private.lazada_unordered_dedup set first_observed_at=now()-interval '8 days'");
    await ingest(db,[buyer()]);
    assert.equal(await count(db,'lazada_unordered_messages'),0);
    assert.equal(await count(db,'lazada_unordered_dedup'),1);
  }finally{await db.close();}
});

test('deleted conversation cannot be resurrected by an undated buyer',async()=>{
  const db=await fixture();try{
    await db.exec(source);
    await db.query("insert into sellerpilot_private.support_ticket_deletions(owner_id,channel_key,external_ticket_fingerprint,deleted_through_at) values($1,'lazada',sellerpilot_private.support_deletion_fingerprint($1,'lazada',$2),now())",[owner,buyer().externalTicketId]);
    await ingest(db,[buyer()]);
    assert.equal(await count(db,'lazada_unordered_messages'),0);
    assert.equal(await count(db,'lazada_unordered_dedup'),0);
    assert.equal(await count(db,'support_inbound_messages'),0);
  }finally{await db.close();}
});

test('capacity and conflicting body remain partial, never normal buyer events',async()=>{
  const db=await fixture();try{
    await db.exec(source);
    await db.query("insert into sellerpilot_private.lazada_unordered_messages(owner_id,seller_account_key,external_ticket_id,remote_message_id,body_digest,sender_role,body) select $1,$2,'lazada-im:capacity','cap-'||n,repeat('b',64),'seller','synthetic' from generate_series(1,1000)n",[owner,account]);
    const full=await ingest(db,[buyer()]);assert.equal(full.status,'partial');assert.equal(full.pendingCount,1);
    await db.exec("delete from sellerpilot_private.lazada_unordered_messages where remote_message_id='cap-1'");
    assert.equal((await ingest(db,[buyer()])).status,'complete');
    await db.exec("delete from sellerpilot_private.lazada_unordered_messages where external_ticket_id='lazada-im:capacity'");
    const conflict=await ingest(db,[{...buyer(),message:'conflicting original'}]);
    assert.equal(conflict.status,'partial');assert.equal(conflict.conflictCount,1);
    assert.equal(await count(db,'lazada_unordered_messages'),2);
    assert.equal(await count(db,'support_inbound_messages'),0);
  }finally{await db.close();}
});

test('unattested identity, invalid role and fake known time never enter quarantine as trusted buyers',async()=>{
  const db=await fixture();try{
    await db.exec(source);
    for(const row of [{...buyer(),senderRole:'system'},{...buyer(),receivedAt:'2026-09-07T00:00:00Z'}])
      assert.equal((await ingest(db,[row])).status,'partial');
    await db.exec("update sellerpilot_private.channel_credentials set seller_account_key_source='legacy_unattested'");
    assert.equal((await ingest(db,[buyer()])).status,'partial');
    assert.equal(await count(db,'lazada_unordered_messages'),0);
  }finally{await db.close();}
});

test('readiness and stored customer text retain service-only RPC and no direct-table access',async()=>{
  const db=await fixture();try{
    await db.exec(source);
    for(const role of ['anon','authenticated','service_role']){
      const access=(await db.query("select has_function_privilege($1,'public.sellerpilot_service_lazada_quarantine_ready_v3()','EXECUTE') rpc,has_table_privilege($1,'sellerpilot_private.lazada_unordered_messages','SELECT') direct",[role])).rows[0];
      assert.equal(access.rpc,role==='service_role');assert.equal(access.direct,false);
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='sellerpilot_private.lazada_unordered_messages'::regclass")).rows[0].relrowsecurity,true);
  }finally{await db.close();}
});

for(const [label,change] of [
  ['source drift',"create or replace function public.sellerpilot_service_lazada_quarantine_ready() returns boolean language sql stable security definer set search_path='' as $$select false$$"],
  ['ACL broadening','grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb) to authenticated'],
  ['unsafe search path','alter function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb) set search_path=public'],
])test(`unexpected ${label} aborts before widening buyer ingestion`,async()=>{
  const db=await fixture();try{
    await db.exec(change);await assert.rejects(db.exec(source),/LAZADA_UNDATED_BUYER_PREIMAGE_REVIEW_REQUIRED/);await db.exec('rollback');
    assert.equal((await db.query("select to_regprocedure('public.sellerpilot_service_lazada_quarantine_ready_v3()') fn")).rows[0].fn,null);
    assert.equal((await ingest(db,[buyer()])).status,'partial');
  }finally{await db.close();}
});
