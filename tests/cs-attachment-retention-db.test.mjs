import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=await readFile(new URL('../supabase/migrations/20260907234000_add_cs_attachment_retention_ledger.sql',import.meta.url),'utf8');
const owner='00000000-0000-4000-8000-000000000701';
const message='00000000-0000-4000-8000-000000000702';
async function fixture(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
 create schema extensions;create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
 create schema sellerpilot_private;create table sellerpilot_private.support_inbound_messages(
  id uuid primary key,owner_id uuid,channel_key text,provider_context jsonb,created_at timestamptz default now(),updated_at timestamptz default now()
 );
 insert into sellerpilot_private.support_inbound_messages(id,owner_id,channel_key,provider_context) values(
  '${message}','${owner}','ebay','{"nativeMedia":{"photo":"https://files.example.test/a.jpg?Expires=1788739200","bad":"https://user:secret@files.example.test/x.jpg","script":"javascript:alert(1)"}}'
 );
 `);await db.exec(migration);return db;}

test('existing and refreshed native media create a bounded private URL evidence ledger',async()=>{const db=await fixture();try{
 let rows=(await db.query('select * from sellerpilot_private.cs_attachment_evidence')).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].source_url,'https://files.example.test/a.jpg?Expires=1788739200');assert.ok(rows[0].source_expires_at);
 await db.query("update sellerpilot_private.support_inbound_messages set provider_context=$1 where id=$2",[{nativeMedia:{photo:'https://files.example.test/new.jpg'}},message]);
 rows=(await db.query('select * from sellerpilot_private.cs_attachment_evidence')).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].source_url,'https://files.example.test/new.jpg');assert.equal(rows[0].source_expires_at,null);
}finally{await db.close();}});

test('admin health states URL-only retention honestly and hides the private table',async()=>{const db=await fixture();try{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
 const result=(await db.query('select public.sellerpilot_read_cs_attachment_health_v1() result')).rows[0].result;
 assert.equal(result.contract,'sellerpilot-cs-attachment-health/1');
 const ebay=result.attachments.find(row=>row.channel==='ebay');assert.equal(ebay.privateCopyImplemented,false);assert.equal(ebay.retentionPolicy,'provider_url_only');assert.equal(ebay.total,1);
 await assert.rejects(db.query('select * from sellerpilot_private.cs_attachment_evidence'),/permission denied/);
}finally{await db.close();}});
