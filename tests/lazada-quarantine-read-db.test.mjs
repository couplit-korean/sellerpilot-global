import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const sql=await readFile(new URL('../supabase/migrations/20260907060844_read_lazada_quarantine.sql',import.meta.url),'utf8');
const owner='00000000-0000-4000-8000-000000000001',operator='00000000-0000-4000-8000-000000000002';
async function setup(apply=true){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema sellerpilot_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table sellerpilot_private.admin_users(user_id uuid primary key);
 create table sellerpilot_private.lazada_unordered_messages(owner_id uuid,seller_account_key text,external_ticket_id text,remote_message_id text,body_digest text,sender_role text,body text,observed_at timestamptz,expires_at timestamptz);
 alter table sellerpilot_private.lazada_unordered_messages enable row level security;
 create table sellerpilot_private.lazada_unordered_dedup(owner_id uuid,identity_digest text,conflicted boolean);
 create table sellerpilot_private.support_ticket_deletions(owner_id uuid,channel_key text,external_ticket_fingerprint text);
 create function sellerpilot_private.support_deletion_fingerprint(uuid,text,text) returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(jsonb_build_array($1,$2,$3)::text,'UTF8')),'hex')$$;
 `);
 const policies=await readFile(new URL('./fixtures/shared-cs-live-policy-20260907.sql',import.meta.url),'utf8');
 await db.exec(policies.slice(0,policies.indexOf('CREATE OR REPLACE FUNCTION public.sellerpilot_get_operations_snapshot')));
 await db.query('insert into sellerpilot_private.admin_users values($1)',[operator]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[operator]);
 if(apply)await db.exec(sql);
 return db;
}
async function add(db,id,options={}){
 await db.query(`insert into sellerpilot_private.lazada_unordered_messages values($1,repeat('a',64),$2,$3,$4,$5,$6,$7,$8)`,[
 owner,options.session??'lazada-im:session',id,options.digest??id,options.role??'customer',options.body??'  Original\n<script>literal</script>',
 options.observed??new Date(Date.now()-60000).toISOString(),options.expires??new Date(Date.now()+60000).toISOString()]);
}
async function read(db,cursor){
 return (await db.query('select public.sellerpilot_read_lazada_quarantine($1,$2,$3) p',[cursor?.beforeTime??null,cursor?.beforeKey??null,cursor?.asOf??null])).rows[0].p;
}
test('approved administrator different from original owner reads exact text; no owner or account secrets exposed',async()=>{
 const db=await setup();try{
  await add(db,'native');await db.exec('set role authenticated');const p=await read(db);
  assert.equal(p.messages.length,1);assert.equal(p.messages[0].body,'  Original\n<script>literal</script>');
  assert.equal(p.messages[0].senderRole,'customer');assert.equal(p.messages[0].reason,'unverified');
  assert.equal(p.messages[0].owner_id,undefined);assert.equal(p.messages[0].seller_account_key,undefined);
  assert.equal(p.messages[0].receivedAt,undefined);assert.equal(p.nextCursor,null);
 }finally{await db.close();}
});
test('same-time pagination retains all variants once and excludes messages observed after snapshot',async()=>{
 const db=await setup();try{
  const observed=new Date(Date.now()-60000).toISOString();
  for(let i=0;i<53;i++)await add(db,`id-${i}`,{observed});
  const first=await read(db);assert.equal(first.messages.length,25);assert.ok(first.nextCursor);
  await add(db,'later',{observed:new Date(Date.parse(first.asOf)+1).toISOString()});
  const second=await read(db,first.nextCursor);const third=await read(db,second.nextCursor);
  assert.equal(second.messages.length,25);assert.equal(third.messages.length,3);assert.equal(third.nextCursor,null);
  const all=[...first.messages,...second.messages,...third.messages];assert.equal(new Set(all.map(x=>x.key)).size,53);
  assert.equal(all.some(x=>x.messageId==='later'),false);
 }finally{await db.close();}
});
test('expiry and deletion are enforced on every read even for a retained page cursor',async()=>{
 const db=await setup();try{
  await add(db,'old',{expires:new Date(Date.now()-1000).toISOString()});await add(db,'deleted',{session:'lazada-im:deleted'});await add(db,'visible');
  await db.query("insert into sellerpilot_private.support_ticket_deletions values($1,'lazada',sellerpilot_private.support_deletion_fingerprint($1,'lazada','lazada-im:deleted'))",[owner]);
  const p=await read(db);assert.deepEqual(p.messages.map(x=>x.messageId),['visible']);
  await db.exec("update sellerpilot_private.lazada_unordered_messages set expires_at=now()-interval '1 second'");
  assert.equal((await read(db)).messages.length,0);
 }finally{await db.close();}
});
test('conflict reason joins exact owner/account/session/message identity',async()=>{
 const db=await setup();try{
  await add(db,'native');
  await db.query("insert into sellerpilot_private.lazada_unordered_dedup values($1,encode(sha256(convert_to(jsonb_build_array($1::uuid,repeat('a',64),'lazada-im:session','native')::text,'UTF8')),'hex'),true)",[operator]);
  assert.equal((await read(db)).messages[0].reason,'unverified');
  await db.query("insert into sellerpilot_private.lazada_unordered_dedup values($1,encode(sha256(convert_to(jsonb_build_array($1::uuid,repeat('a',64),'lazada-im:session','native')::text,'UTF8')),'hex'),true)",[owner]);
  assert.equal((await read(db)).messages[0].reason,'conflict');
 }finally{await db.close();}
});
test('nonmember, removed admin, null uid, anon and service calls denied; direct tables remain inaccessible',async()=>{
 const db=await setup();try{
  for(const role of ['anon','service_role']){await db.exec(`set role ${role}`);await assert.rejects(read(db),/permission denied/);await db.exec('reset role');}
  for(const uid of [owner,'']){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');await assert.rejects(read(db),/administrator required/);await assert.rejects(db.query('select * from sellerpilot_private.lazada_unordered_messages'),/permission denied/);await db.exec('reset role');}
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[operator]);await db.exec('delete from sellerpilot_private.admin_users;set role authenticated');await assert.rejects(read(db),/administrator required/);
 }finally{await db.close();}
});
test('invalid cursors and modified authorization preimage fail closed',async()=>{
 const db=await setup();try{
  for(const cursor of [{beforeKey:'bad'},{beforeTime:new Date().toISOString()},{beforeTime:'infinity',beforeKey:'a'.repeat(64),asOf:new Date().toISOString()},{asOf:'2099-01-01T00:00:00Z'}])await assert.rejects(read(db,cursor),/invalid quarantine cursor/);
 }finally{await db.close();}
 const changed=await setup(false);try{
  await changed.exec("create or replace function public.sellerpilot_is_admin() returns boolean language sql as $$select true$$");
  await assert.rejects(changed.exec(sql),/CS_QUARANTINE_ADMIN_POLICY_REVIEW_REQUIRED/);await changed.exec('rollback');
  assert.equal((await changed.query("select to_regprocedure('public.sellerpilot_read_lazada_quarantine(timestamptz,text,timestamptz)') f")).rows[0].f,null);
 }finally{await changed.close();}
});
