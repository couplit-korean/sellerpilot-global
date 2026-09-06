import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration = await readFile(new URL('../supabase/migrations/20260905140000_preserve_unordered_lazada_messages.sql', import.meta.url), 'utf8');
const preimages = await readFile(new URL('./fixtures/cs140-reviewed-live-preimages.sql', import.meta.url), 'utf8');
const pins = JSON.parse(await readFile(new URL('./fixtures/cs140-reviewed-live-preimages.json', import.meta.url), 'utf8'));
// Catalog-only negative/ACL fixture with exact current source definitions.
// Full native behavior uses the historical-schema + exact overlay tests.
async function catalog() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create schema sellerpilot_private; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.channels(key text primary key);
    insert into sellerpilot_private.channels values('lazada');
    create table sellerpilot_private.channel_credentials(id uuid,created_by uuid,seller_account_key text,seller_account_key_source text,channel text,status text);
    create table sellerpilot_private.support_tickets(id uuid,source_credential_id uuid,external_ticket_id text);
    create table sellerpilot_private.support_inbound_messages(ticket_id uuid,owner_id uuid,channel_key text,remote_message_id text,body text,sender_role text);`);
  await db.exec(await readFile(new URL('./fixtures/cs140-reviewed-live-dependencies.sql',import.meta.url),'utf8'));
  await db.exec(preimages);
  return db;
}
async function digest(db, signature) {
  return (await db.query("select encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash from pg_proc where oid=$1::regprocedure", [signature])).rows[0].hash;
}
test('exact reviewed readback prosrc pins match and renamed definitions remain byte-identical', async () => {
  const db = await catalog();
  try {
    for (const pin of pins.functions) assert.equal(await digest(db, pin.signature), pin.sha256);
    await db.exec(migration);
    for (const pin of pins.functions) {
      const renamed=pin.signature.replace(pin.name,pin.name.includes('ingest')?'sellerpilot_202609051400_ingest_inquiries':'sellerpilot_202609051400_prune_personal_data');
      assert.equal(await digest(db,renamed),pin.sha256);
      assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed",[renamed])).rows[0].allowed,false);
    }
  } finally { await db.close(); }
});
for (const [label, alteration] of [
  ['changed source body', preimages.replace('v_non_lazada_seller_events jsonb', 'v_non_lazada_seller_events /* negative fixture */ jsonb')],
  ['extra anon grant', 'grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) to anon'],
  ['missing service grant', 'revoke execute on function public.sellerpilot_prune_personal_data(timestamptz) from service_role'],
  ['unsafe search path', 'alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) set search_path=public'],
]) test(`review gate rejects ${label} before DDL`, async()=>{
  const db=await catalog();try{
    await db.exec(alteration);
    await assert.rejects(db.exec(migration), /LAZADA_QUARANTINE_LIVE_DEFINITION_REVIEW_REQUIRED/);
    await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('sellerpilot_private.lazada_unordered_messages') name")).rows[0].name,null);
  }finally{await db.close();}
});
test('new quarantine boundary preserves exact unordered seller original without invoking normal native ingest',async()=>{
 const db=await catalog();try{
  await db.exec(migration);
  const owner='00000000-0000-4000-8000-000000000001',credential='00000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users values($1)',[owner]);
  await db.query("insert into sellerpilot_private.channel_credentials values($1,$2,$3,'provider_certified_v1','lazada','active')",[credential,owner,'a'.repeat(64)]);
  const body='  SYNTHETIC seller original 원문\n';
  const payload=[{externalTicketId:'lazada-im:synthetic-session',remoteMessageId:'synthetic-message',message:body,senderRole:'seller',orderingStatus:'unverified',receivedAt:''}];
  const receipt=(await db.query('select public.sellerpilot_service_ingest_lazada_inquiries_v2($1,$2::jsonb) receipt',[credential,JSON.stringify(payload)])).rows[0].receipt;
  assert.equal(receipt.quarantinedCount,1);assert.equal(receipt.normalCount,0);
  assert.deepEqual((await db.query('select sender_role,body from sellerpilot_private.lazada_unordered_messages')).rows,[{sender_role:'seller',body}]);
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.support_inbound_messages')).rows[0].n,0);
 }finally{await db.close();}
});
test('checked-in exact definitions contain only code and expected reviewed literal hashes',()=>{
 assert.doesNotMatch(preimages,/https?:\/\/|eyJ[a-zA-Z0-9_-]{20,}|(?:access_token|refresh_token|app_secret)\s*[:=]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
 assert.match(preimages,/p_channel <> 'lazada'[\s\S]*v_non_lazada_seller_events/);
 assert.match(preimages,/v_sender_role, v_inquiry->>'message'/);
 assert.match(preimages,/support_ticket_deletions[\s\S]*support_message_deletions/);
 assert.doesNotMatch(migration,/position\('v_seller_events'/);
 for(const pin of pins.functions)assert.ok(migration.includes(pin.sha256));
 assert.equal(createHash('sha256').update('not an approved body').digest('hex')===pins.functions[0].sha256,false);
});

test('review gate rejects dependency EXECUTE broadening before DDL',async()=>{
 const db=await catalog();try{
  await db.exec('grant execute on function public.sellerpilot_0902_ingest_inquiries_unsafe(uuid,text,jsonb) to service_role');
  await assert.rejects(db.exec(migration),/LAZADA_QUARANTINE_DEPENDENCY_REVIEW_REQUIRED/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('sellerpilot_private.lazada_unordered_messages') name")).rows[0].name,null);
 }finally{await db.close();}
});
test('dependency checked-in prosrc MD5/SHA256 exactly match parent readback and contain no live data',async()=>{
 const source=await readFile(new URL('./fixtures/cs140-reviewed-live-dependencies.sql',import.meta.url),'utf8');
 const manifest=JSON.parse(await readFile(new URL('./fixtures/cs140-reviewed-live-dependencies.json',import.meta.url),'utf8'));
 const db=await catalog();try{
  for(const pin of manifest){const signature=pin.signature.startsWith('sellerpilot_private.')?pin.signature:'public.'+pin.signature;
    assert.equal(await digest(db,signature),pin.sha256);
    assert.equal((await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[signature])).rows[0].hash,pin.md5);
  }
 }finally{await db.close();}
 assert.doesNotMatch(source,/https?:\/\/|eyJ[a-zA-Z0-9_-]{20,}|(?:access_token|refresh_token|app_secret)\s*[:=]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});
