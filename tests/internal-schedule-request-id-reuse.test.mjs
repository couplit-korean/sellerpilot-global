import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const history=await readFile(new URL('../supabase/migrations/20260828210000_non_cs_release_integrity.sql',import.meta.url),'utf8');
const patch=await readFile(new URL('../supabase/migrations/20260913020457_archive_reused_internal_schedule_request_ids.sql',import.meta.url),'utf8');
const start=history.indexOf('create or replace function sellerpilot_private.schedule_internal_route(');
const definition=history.slice(start,history.indexOf('\n$$;',start)+4);
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema sellerpilot_private;create schema cron;create schema net;create schema vault;
 create table cron.job(jobid bigint,jobname text,active boolean);
 create table cron.job_run_details(jobid bigint,end_time timestamptz);
 insert into cron.job values(1,'sellerpilot-channel-sync-v1',true),(2,'sellerpilot-product-research-v1',true);
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text,created_at timestamptz default now());
 create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets;
 insert into vault.secrets(name,secret) values('sellerpilot_serverless_cs_wake_v1',repeat('w',43));
 create table net._http_response(id bigint,created timestamptz,status_code integer);
 create table net.test_requests(id bigint,url text);
 create function net.http_get(url text,headers jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.test_requests values(1487,url);return 1487;end$$;
 create function sellerpilot_private.reconcile_internal_schedule_requests(text) returns void language sql as $$select$$;
 `);
 const tableStart=history.indexOf('create table if not exists sellerpilot_private.internal_schedule_requests (');
 await db.exec(history.slice(tableStart,history.indexOf('create or replace function sellerpilot_private.reconcile_internal_schedule_requests(',tableStart)));
 await db.exec(definition);
 return db;
}
test('resolved ID reuse archives the old route and receipt, then tracks only the current request',async()=>{
 const db=await fixture();try{
  await db.exec(`insert into sellerpilot_private.internal_schedule_requests(request_id,route_key,requested_at,resolved_at,outcome,http_status,timed_out)
   values(1487,'product_research',now()-interval '1 day',now()-interval '23 hours','delivered',200,false);
   insert into net._http_response values(1487,now()-interval '1 day',200);`);
  await assert.rejects(db.query("select sellerpilot_private.schedule_internal_route('channel_sync')"),/duplicate key/);
  assert.equal((await db.query('select count(*)::int n from net.test_requests')).rows[0].n,0);
  await db.exec(patch);
  assert.equal((await db.query("select sellerpilot_private.schedule_internal_route('channel_sync') id")).rows[0].id,1487);
  assert.deepEqual((await db.query('select route_key,outcome,http_status,resolved_at from sellerpilot_private.internal_schedule_requests')).rows,[{route_key:'channel_sync',outcome:'queued',http_status:null,resolved_at:null}]);
  assert.deepEqual((await db.query('select route_key,outcome,http_status,archive_reason from sellerpilot_private.internal_schedule_request_archives')).rows,[{route_key:'product_research',outcome:'delivered',http_status:200,archive_reason:'pg_net_request_id_reused'}]);
  assert.equal((await db.query('select count(*)::int n from net._http_response')).rows[0].n,0);
  assert.equal((await db.query("select sellerpilot_private.schedule_internal_route('channel_sync') id")).rows[0].id,null);
  assert.equal((await db.query('select count(*)::int n from net.test_requests')).rows[0].n,1);
  const acl=(await db.query("select relrowsecurity rls,has_table_privilege('anon',oid,'select') anon,has_table_privilege('authenticated',oid,'select') authenticated,has_table_privilege('service_role',oid,'select') service from pg_class where oid='sellerpilot_private.internal_schedule_request_archives'::regclass")).rows[0];
  assert.deepEqual(acl,{rls:true,anon:false,authenticated:false,service:false});
 }finally{await db.close();}
});
test('a reused ID that is still queued for another route cannot overwrite or enqueue a duplicate request',async()=>{
 const db=await fixture();try{
  await db.exec(patch);
  await db.exec("insert into sellerpilot_private.internal_schedule_requests(request_id,route_key) values(1487,'product_research')");
  await assert.rejects(db.query("select sellerpilot_private.schedule_internal_route('channel_sync')"),/INTERNAL_SCHEDULE_REQUEST_ID_IN_FLIGHT/);
  assert.equal((await db.query('select count(*)::int n from net.test_requests')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.internal_schedule_request_archives')).rows[0].n,0);
  assert.deepEqual((await db.query('select route_key,outcome from sellerpilot_private.internal_schedule_requests')).rows,[{route_key:'product_research',outcome:'queued'}]);
 }finally{await db.close();}
});
