import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';

test('native message account lookup enforces administrator and credential owner without direct table access',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema sellerpilot_private;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select current_setting('test.is_admin',true)='true'$$;
   create table sellerpilot_private.channel_credentials(id uuid primary key default gen_random_uuid(),created_by uuid,channel text,environment text,version integer,status text,seller_account_key text,seller_account_key_source text);
   alter table sellerpilot_private.channel_credentials enable row level security;
   select set_config('request.jwt.claim.sub','${owner}',false);select set_config('test.is_admin','true',false);
   insert into sellerpilot_private.channel_credentials(created_by,channel,environment,version,status,seller_account_key,seller_account_key_source) values
   ('${owner}','ebay','production',1,'active','owned-key','provider_certified_v1'),
   ('${other}','ebay','production',2,'active','foreign-key','provider_certified_v1'),
   ('${owner}','ebay','production',3,'revoked','old-key','provider_certified_v1'),
   ('${owner}','qoo10','production',1,'active','other-channel','provider_certified_v1');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260907120000_read_owned_ebay_message_accounts.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');
  const rows=(await db.query('select * from public.sellerpilot_list_owned_ebay_message_accounts()')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].seller_account_key,'owned-key');
  await assert.rejects(db.query('select * from sellerpilot_private.channel_credentials'),/permission denied/);
  await db.exec("select set_config('test.is_admin','false',false)");
  await assert.rejects(db.query('select * from public.sellerpilot_list_owned_ebay_message_accounts()'),/administrator/);
  await db.exec("select set_config('test.is_admin','true',false);select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(db.query('select * from public.sellerpilot_list_owned_ebay_message_accounts()'),/administrator/);
  await db.exec('reset role');
  for(const role of ['anon','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.sellerpilot_list_owned_ebay_message_accounts()','execute') allowed",[role])).rows[0].allowed,false);
  assert.deepEqual((await db.query("select proconfig from pg_proc where oid='public.sellerpilot_list_owned_ebay_message_accounts()'::regprocedure")).rows[0].proconfig,['search_path=""']);
 }finally{await db.close();}
});
