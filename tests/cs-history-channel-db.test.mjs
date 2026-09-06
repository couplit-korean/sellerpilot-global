import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '00000000-0000-4000-8000-000000000001';
const smart = '00000000-0000-4000-8000-000000000002';
const coupang = '00000000-0000-4000-8000-000000000003';
const source = await readFile(new URL('../supabase/migrations/20260828145900_durable_korean_inquiry_history_backfill.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260907100000_scope_cs_history_by_channel.sql', import.meta.url), 'utf8');
function definition(name) {
  const start = source.indexOf(`create function ${name}(`);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema extensions;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
    create function extensions.digest(value text, algorithm text) returns bytea language sql immutable as $$ select sha256(convert_to(value,'UTF8')) $$;
    create table sellerpilot_private.channel_credentials(id uuid primary key, channel text, environment text default 'production', status text default 'active', expires_at timestamptz, version int default 1, created_by uuid);
    create table sellerpilot_private.serverless_static_egress_policy(channel text primary key, enabled boolean);
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key default gen_random_uuid(), credential_id uuid, channel text, operation text, request_payload jsonb, status text default 'queued', created_at timestamptz default now(), updated_at timestamptz default now(), worker_token_id uuid, claim_token uuid, lease_expires_at timestamptz, completed_at timestamptz, error_message text, attempt_count int default 0, credential_refresh_in_flight boolean default false, credential_refresh_recovery_vault_id uuid);
    create function public.sellerpilot_service_enqueue_periodic_sync(p_channel text,p_operation text,p_payload jsonb,p_minutes int) returns jsonb language plpgsql as $$declare j uuid; begin
      insert into sellerpilot_private.channel_gateway_jobs(credential_id,channel,operation,request_payload)
      select id,p_channel,p_operation,p_payload from sellerpilot_private.channel_credentials where channel=p_channel and status='active' order by version desc limit 1 returning id into j;
      return jsonb_build_object('status','queued','jobId',j); end$$;
    select set_config('request.jwt.claim.sub','${owner}',false);
  `);
  // Replay the real run schema/helpers. Only the upstream API enqueue is a test double.
  await db.exec(source.slice(source.indexOf('create table sellerpilot_private.inquiry_history_backfill_runs'), source.indexOf('create function sellerpilot_private.refresh_inquiry_history_backfill_run')));
  await db.exec(`alter table sellerpilot_private.inquiry_history_backfill_runs add column blocked_reason text;`);
  await db.exec(definition('sellerpilot_private.enqueue_inquiry_history_backfill_item'));
  await db.exec(migration);
  await db.exec(await readFile(new URL("../supabase/migrations/20260907105000_select_past_cs_history_windows.sql", import.meta.url),"utf8"));
  await db.exec(`insert into sellerpilot_private.channel_credentials(id,channel,created_by) values ('${smart}','smartstore','${owner}'); insert into sellerpilot_private.serverless_static_egress_policy values ('smartstore',true),('coupang',false);`);
  return db;
}
const start = async (db, channels, days = 30) => (await db.query('select public.sellerpilot_start_inquiry_history_backfill_v2($1::text[],$2::int) as result',[channels,days])).rows[0].result;

test('Smartstore history is independent of missing Coupang credential and disabled policy', async () => {
  const db=await fixture(); try {
    const run=await start(db,['smartstore']);
    assert.deepEqual(run.channels,['smartstore']); assert.equal(run.expectedInitialJobs,2); assert.equal(run.totalJobs,2); assert.equal(run.status,'queued');
    const jobs=(await db.query('select * from sellerpilot_private.channel_gateway_jobs')).rows;
    assert.deepEqual(jobs.map(j=>j.channel),['smartstore','smartstore']);
    assert.ok(jobs.every(j=>j.credential_id===smart));
    assert.ok(jobs.every(j=>!('answered' in j.request_payload.arguments.query)));
    assert.equal((await start(db,['smartstore'])).runId,run.runId);
    assert.equal((await db.query('select count(*)::int as n from sellerpilot_private.channel_gateway_jobs')).rows[0].n,2);
    await db.exec(`update sellerpilot_private.channel_gateway_jobs set status='succeeded'`);
    const complete=await start(db,['smartstore']); assert.equal(complete.status,'succeeded'); assert.equal(complete.progressPercent,100);
  } finally {await db.close();}
});
test('requested disabled channels still fail closed, including the legacy two-channel RPC',async()=>{
 const db=await fixture();try{
  await assert.rejects(start(db,['coupang']),/STATIC_EGRESS_REQUIRED/);
  await assert.rejects(start(db,['smartstore','coupang']),/STATIC_EGRESS_REQUIRED/);
  await assert.rejects(db.query('select public.sellerpilot_start_inquiry_history_backfill(30)'),/STATIC_EGRESS_REQUIRED/);
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.channel_gateway_jobs')).rows[0].n,0);
 }finally{await db.close();}
});
test('Coupang-only scopes all five daily-window read types without Smartstore jobs',async()=>{
 const db=await fixture();try{
  await db.exec(`update sellerpilot_private.serverless_static_egress_policy set enabled=true where channel='coupang';insert into sellerpilot_private.channel_credentials(id,channel,created_by) values ('${coupang}','coupang','${owner}');`);
  const run=await start(db,['coupang']);assert.deepEqual(run.channels,['coupang']);assert.equal(run.totalJobs,25);
  const both=await start(db,['smartstore','coupang']);assert.equal(both.totalJobs,27);assert.deepEqual(both.channels,['coupang','smartstore']);
 }finally{await db.close();}
});
test('invalid scopes, nonadmin, expired credentials and privilege grants',async()=>{
 const db=await fixture();try{
  for(const channels of [[],['smartstore','smartstore'],['shopee'],[null],null]) await assert.rejects(start(db,channels));
  for(const days of [0,6,31,null]) await assert.rejects(start(db,['smartstore'],days));
  await db.exec(`select set_config('request.jwt.claim.sub','',false)`);await assert.rejects(start(db,['smartstore']),/administrator/);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);update sellerpilot_private.channel_credentials set expires_at=now()-interval '1 second'`);
  await assert.rejects(start(db,['smartstore']),/must be active/);
  const grants=(await db.query(`select has_function_privilege('authenticated','public.sellerpilot_start_inquiry_history_backfill_v2(text[],integer)','execute') as admin,has_function_privilege('anon','public.sellerpilot_start_inquiry_history_backfill_v2(text[],integer)','execute') as anon,has_function_privilege('service_role','public.sellerpilot_start_inquiry_history_backfill_v2(text[],integer)','execute') as service`)).rows[0];
  assert.deepEqual(grants,{admin:true,anon:false,service:false});
 }finally{await db.close();}
});
test('failed reads resume; cancelled/reconciliation/exhausted jobs never retry',async()=>{
 const db=await fixture();try{
  const run=await start(db,['smartstore']);
  await db.exec(`update sellerpilot_private.channel_gateway_jobs set status='failed',attempt_count=1;`);
  await db.query('select sellerpilot_private.refresh_inquiry_history_backfill_run($1)',[run.runId]);
  assert.equal((await start(db,['smartstore'])).retriedJobs,2);
  await db.exec(`update sellerpilot_private.channel_gateway_jobs set status='failed',attempt_count=4;`);
  await db.query('select sellerpilot_private.refresh_inquiry_history_backfill_run($1)',[run.runId]);
  assert.equal((await start(db,['smartstore'])).retriedJobs,0);
  for(const status of ['cancelled','reconciliation_required']){
   await db.query('update sellerpilot_private.channel_gateway_jobs set status=$1,attempt_count=0',[status]);
   await db.query('select sellerpilot_private.refresh_inquiry_history_backfill_run($1)',[run.runId]);
   assert.equal((await start(db,['smartstore'])).retriedJobs,0);
  }
 }finally{await db.close();}
});
test('credential rotation gets a different run; cross-owner joint scope is rejected',async()=>{
 const db=await fixture();try{
  const old=await start(db,['smartstore']);
  await db.exec(`update sellerpilot_private.channel_credentials set status='revoked';insert into sellerpilot_private.channel_credentials(id,channel,created_by,version) values (gen_random_uuid(),'smartstore','${owner}',2);`);
  assert.notEqual((await start(db,['smartstore'])).runId,old.runId);
  await db.exec(`update sellerpilot_private.serverless_static_egress_policy set enabled=true where channel='coupang';insert into sellerpilot_private.channel_credentials(id,channel,created_by) values ('${coupang}','coupang',gen_random_uuid());`);
  await assert.rejects(start(db,['coupang','smartstore']),/owners do not match/);
 }finally{await db.close();}
});


test('past history window preserves the exact old date range and does not expand Smartstore to today',async()=>{
 const db=await fixture();try{
  const begin=async(end)=>(await db.query("select public.sellerpilot_start_inquiry_history_backfill_v3(array['smartstore'],30,$1::date) result",[end])).rows[0].result;
  const run=await begin('2024-02-29');assert.equal(run.fromDate,'2024-01-31');assert.equal(run.toDate,'2024-02-29');assert.equal(run.totalJobs,2);
  const jobs=(await db.query('select request_payload from sellerpilot_private.channel_gateway_jobs')).rows.map(row=>row.request_payload.arguments);
  assert.equal(jobs.find(job=>job.kind==='product').query.fromDate,'2024-01-31T00:00:00.000+09:00');
  assert.equal(jobs.find(job=>job.kind==='product').query.toDate,'2024-02-29T23:59:59.999+09:00');
  assert.equal(jobs.find(job=>job.kind==='customer').query.endSearchDate,'2024-02-29');
  assert.equal((await begin('2024-02-29')).runId,run.runId);
  assert.notEqual((await begin('2024-01-30')).runId,run.runId);
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.channel_gateway_jobs')).rows[0].n,4);
 }finally{await db.close();}
});
test('current history keeps its legacy request key and past Coupang windows remain seven days or shorter',async()=>{
 const db=await fixture();try{
  const legacy=await start(db,['smartstore']);
  const current=(await db.query("select public.sellerpilot_start_inquiry_history_backfill_v3(array['smartstore'],30,(now() at time zone 'Asia/Seoul')::date) result")).rows[0].result;
  assert.equal(current.runId,legacy.runId);
  await db.exec(`update sellerpilot_private.serverless_static_egress_policy set enabled=true where channel='coupang';insert into sellerpilot_private.channel_credentials(id,channel,created_by) values ('${coupang}','coupang','${owner}');`);
  const run=(await db.query("select public.sellerpilot_start_inquiry_history_backfill_v3(array['coupang'],30,date '2024-02-29') result")).rows[0].result;
  assert.equal(run.totalJobs,25);
  const jobs=(await db.query("select request_payload from sellerpilot_private.channel_gateway_jobs where channel='coupang'")).rows;
  for(const job of jobs){const q=job.request_payload.arguments.query;assert.ok(q.inquiryStartAt>='2024-01-31');assert.ok(q.inquiryEndAt<='2024-02-29');assert.ok(Date.parse(q.inquiryEndAt)-Date.parse(q.inquiryStartAt)<=6*86400000);}
 }finally{await db.close();}
});
test('historical end date rejects future and unsupported early dates without enqueuing, and remains admin only',async()=>{
 const db=await fixture();try{
  for(const date of ['1999-12-31','9999-01-01'])await assert.rejects(db.query("select public.sellerpilot_start_inquiry_history_backfill_v3(array['smartstore'],30,$1::date)",[date]),/invalid inquiry history end date/);
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.channel_gateway_jobs')).rows[0].n,0);
  const grants=(await db.query("select has_function_privilege('anon','public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)','execute') a,has_function_privilege('service_role','public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)','execute') s")).rows[0];assert.deepEqual(grants,{a:false,s:false});
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(db.query("select public.sellerpilot_start_inquiry_history_backfill_v3(array['smartstore'],30,date '2024-02-29')"),/administrator/);
 }finally{await db.close();}
});
