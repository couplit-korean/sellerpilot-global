import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration=await readFile(new URL('../supabase/migrations/20260907233000_add_provider_rate_budgets.sql',import.meta.url),'utf8');
const liveBefore=await readFile(new URL('./fixtures/provider-rate-budget-before.sql',import.meta.url),'utf8');
const scopeRepair=await readFile(new URL('../supabase/migrations/20260912205909_bind_provider_budget_worker_scope.sql',import.meta.url),'utf8');
const credential='00000000-0000-4000-8000-000000000601';
const token='00000000-0000-4000-8000-000000000602';
const job='00000000-0000-4000-8000-000000000603';
const claim='00000000-0000-4000-8000-000000000604';

async function fixture(repair=true){
 const db=new PGlite();
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema extensions;create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
  create schema sellerpilot_private;
  create table sellerpilot_private.channel_credentials(id uuid primary key);
  create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,token_hash text,scope text,status text,expires_at timestamptz);
  create table sellerpilot_private.channel_gateway_jobs(
   id uuid primary key,credential_id uuid,channel text,operation text,request_payload jsonb,status text,
   claim_token uuid,lease_expires_at timestamptz,worker_token_id uuid,attempt_count integer default 0,
   provider_mutation_started_at timestamptz,error_message text,created_at timestamptz default now(),updated_at timestamptz default now()
  );
  create function sellerpilot_private.serverless_gateway_job_allowed(text,text) returns boolean language sql immutable as $$select true$$;
  create function public.sellerpilot_claim_serverless_gateway_job(p_token_hash text,p_worker_version text)
  returns jsonb language plpgsql as $$declare v_result jsonb;begin
   select jsonb_build_object('id',job.id) into v_result from sellerpilot_private.channel_gateway_jobs job
    where job.status = 'queued'
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     ) order by job.created_at limit 1;
   return v_result;
  end$$;
  create function public.sellerpilot_11820_claim_gateway_unsafe(p_token_hash text,p_worker_version text)
  returns jsonb language plpgsql as $$declare v_result jsonb;begin
   select jsonb_build_object('id',j.id) into v_result from sellerpilot_private.channel_gateway_jobs j
    where j.status = 'queued' order by j.created_at limit 1;
   return v_result;
  end$$;
  insert into sellerpilot_private.channel_credentials values('${credential}');
  insert into sellerpilot_private.ai_cli_worker_tokens values('${token}','token-hash','gateway','active',now()+interval '1 day');
 `);
 await db.exec(migration);
 await db.exec(liveBefore);
 if(repair)await db.exec(scopeRepair);
 return db;
}

async function insertRunning(db,id=job,claimToken=claim,attempt=1){
 await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
  id,credential_id,channel,operation,request_payload,status,claim_token,lease_expires_at,worker_token_id,attempt_count
 ) values($1,$2,'ebay','inquiries.list','{"periodicKey":"inquiries:current","arguments":{"marketplaceId":"EBAY_US"}}','running',$3,now()+interval '10 minutes',$4,$5)`,
 [id,credential,claimToken,token,attempt]);
}

test('claim source excludes jobs whose provider retry deadline is still in the future',async()=>{
 const db=await fixture();try{
  const source=(await db.query("select pg_get_functiondef('public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure) source")).rows[0].source;
  assert.match(source,/coalesce\(job\.rate_not_before, '-infinity'::(?:timestamptz|timestamp with time zone)\) <= clock_timestamp\(\)/);
  const localSource=(await db.query("select pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure) source")).rows[0].source;
  assert.match(localSource,/coalesce\(j\.rate_not_before, '-infinity'::(?:timestamptz|timestamp with time zone)\) <= clock_timestamp\(\)/);
 }finally{await db.close();}
});

test('serverless CS owner can reserve, wait and report 429 without weakening write reconciliation',async()=>{
 const db=await fixture(false);try{
  await insertRunning(db);
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs'");
  await assert.rejects(db.query("select public.sellerpilot_service_reserve_provider_rate_budget_v1('token-hash',$1,$2)",[job,claim]),e=>e.code==='42501');
  await db.exec(scopeRepair);
  const reserve=(await db.query("select public.sellerpilot_service_reserve_provider_rate_budget_v1('token-hash',$1,$2) result",[job,claim])).rows[0].result;
  assert.equal(reserve.status,'reserved');
  const wait=(await db.query("select public.sellerpilot_service_reserve_provider_request_rate_budget_v1('token-hash',$1,$2) result",[job,claim])).rows[0].result;
  assert.equal(wait.status,'waiting');
  await db.query("update sellerpilot_private.channel_gateway_jobs set operation='inquiries.reply',provider_mutation_started_at=now()");
  const limited=(await db.query("select public.sellerpilot_service_report_provider_rate_limit_v1('token-hash',$1,$2,30) result",[job,claim])).rows[0].result;
  assert.equal(limited.status,'recorded');
  assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs')).rows[0].status,'running');
 }finally{await db.close();}
});

test('another valid worker, scheduler, expired token and stale claim cannot spend the job budget',async()=>{
 const db=await fixture();try{
  await insertRunning(db);
  await db.exec("insert into sellerpilot_private.ai_cli_worker_tokens values('00000000-0000-4000-8000-000000000699','other','gateway','active',now()+interval '1 hour')");
  for(const fn of ['reserve_provider_rate_budget','reserve_provider_request_rate_budget','report_provider_rate_limit']){
   const sql=`select public.sellerpilot_service_${fn}_v1($1,$2,$3)`;
   await assert.rejects(db.query(sql,['other',job,claim]),e=>e.code==='40001');
   await assert.rejects(db.query(sql,['token-hash',job,job]),e=>e.code==='40001');
   await db.exec("update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs_scheduler' where token_hash='token-hash'");
   await assert.rejects(db.query(sql,['token-hash',job,claim]),e=>e.code==='42501');
   await db.exec("update sellerpilot_private.ai_cli_worker_tokens set scope='gateway',expires_at=now()-interval '1 hour' where token_hash='token-hash'");
   await assert.rejects(db.query(sql,['token-hash',job,claim]),e=>e.code==='42501');
   await db.exec("update sellerpilot_private.ai_cli_worker_tokens set expires_at=now()+interval '1 hour' where token_hash='token-hash'");
  }
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.provider_rate_budgets')).rows[0].n,0);
 }finally{await db.close();}
});

test('channel-wide budget coordinates different credentials and operation lanes',async()=>{
 const db=await fixture();try{
  await insertRunning(db);
  let receipt=(await db.query("select public.sellerpilot_service_reserve_provider_rate_budget_v1('token-hash',$1,$2) result",[job,claim])).rows[0].result;
  assert.equal(receipt.status,'reserved');
  const credential2='00000000-0000-4000-8000-000000000609';
  const job2='00000000-0000-4000-8000-000000000610';
  const claim2='00000000-0000-4000-8000-000000000611';
  await db.query('insert into sellerpilot_private.channel_credentials values($1)',[credential2]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
   id,credential_id,channel,operation,request_payload,status,claim_token,lease_expires_at,worker_token_id,attempt_count
  ) values($1,$2,'ebay','inquiries.reply','{}','running',$3,now()+interval '10 minutes',$4,1)`,
  [job2,credential2,claim2,token]);
  receipt=(await db.query("select public.sellerpilot_service_reserve_provider_rate_budget_v1('token-hash',$1,$2) result",[job2,claim2])).rows[0].result;
  assert.equal(receipt.status,'deferred');
  assert.equal((await db.query("select count(*)::int count from sellerpilot_private.provider_rate_budgets")).rows[0].count,2);
  assert.equal((await db.query("select count(*)::int count from sellerpilot_private.provider_global_rate_budgets where channel='ebay'")).rows[0].count,1);
 }finally{await db.close();}
});

test('reservation is isolated by operation lane and defers a second same-scope call without spending an attempt',async()=>{
 const db=await fixture();try{
  await insertRunning(db);
  let receipt=(await db.query("select public.sellerpilot_service_reserve_provider_rate_budget_v1('token-hash',$1,$2) result",[job,claim])).rows[0].result;
  assert.equal(receipt.status,'reserved');assert.equal(receipt.operationLane,'cs_current');
  const second='00000000-0000-4000-8000-000000000605',secondClaim='00000000-0000-4000-8000-000000000606';
  await insertRunning(db,second,secondClaim,1);
  receipt=(await db.query("select public.sellerpilot_service_reserve_provider_rate_budget_v1('token-hash',$1,$2) result",[second,secondClaim])).rows[0].result;
  assert.equal(receipt.status,'deferred');
  const row=(await db.query('select status,attempt_count,rate_not_before from sellerpilot_private.channel_gateway_jobs where id=$1',[second])).rows[0];
  assert.equal(row.status,'queued');assert.equal(row.attempt_count,0);assert.ok(row.rate_not_before);
 }finally{await db.close();}
});

test('provider 429 requeues only safe reads and keeps writes for ordinary reconciliation handling',async()=>{
 const db=await fixture();try{
  await insertRunning(db);
  let receipt=(await db.query("select public.sellerpilot_service_report_provider_rate_limit_v1('token-hash',$1,$2,37) result",[job,claim])).rows[0].result;
  assert.equal(receipt.status,'deferred');assert.equal(receipt.retryAfterSeconds,37);
  const write='00000000-0000-4000-8000-000000000607',writeClaim='00000000-0000-4000-8000-000000000608';
  await insertRunning(db,write,writeClaim,1);
  await db.query("update sellerpilot_private.channel_gateway_jobs set operation='inquiries.reply',provider_mutation_started_at=now() where id=$1",[write]);
  receipt=(await db.query("select public.sellerpilot_service_report_provider_rate_limit_v1('token-hash',$1,$2,11) result",[write,writeClaim])).rows[0].result;
  assert.equal(receipt.status,'recorded');
  assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs where id=$1',[write])).rows[0].status,'running');
 }finally{await db.close();}
});

test('every additional provider request waits in-place without releasing job ownership',async()=>{
 const db=await fixture();try{
  await insertRunning(db);
  await db.query("select public.sellerpilot_service_reserve_provider_rate_budget_v1('token-hash',$1,$2)",[job,claim]);
  let receipt=(await db.query("select public.sellerpilot_service_reserve_provider_request_rate_budget_v1('token-hash',$1,$2) result",[job,claim])).rows[0].result;
  assert.equal(receipt.status,'waiting');assert.ok(receipt.retryAfterMs>=1);assert.ok(receipt.retryAfterMs<=60000);
  assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs where id=$1',[job])).rows[0].status,'running');
  await db.query("update sellerpilot_private.provider_rate_budgets set next_allowed_at=clock_timestamp()-interval '1 millisecond'");
  await db.query("update sellerpilot_private.provider_global_rate_budgets set next_allowed_at=clock_timestamp()-interval '1 millisecond'");
  receipt=(await db.query("select public.sellerpilot_service_reserve_provider_request_rate_budget_v1('token-hash',$1,$2) result",[job,claim])).rows[0].result;
  assert.equal(receipt.status,'reserved');assert.equal(receipt.retryAfterMs,0);
 }finally{await db.close();}
});

test('rate ledger and mutating RPCs have service-only access',async()=>{
 const db=await fixture();try{
  for(const role of ['anon','authenticated']) assert.equal((await db.query(
   "select has_function_privilege($1,'public.sellerpilot_service_reserve_provider_rate_budget_v1(text,uuid,uuid)','EXECUTE') ok",[role])).rows[0].ok,false);
  for(const role of ['anon','authenticated']) assert.equal((await db.query(
   "select has_function_privilege($1,'public.sellerpilot_service_reserve_provider_request_rate_budget_v1(text,uuid,uuid)','EXECUTE') ok",[role])).rows[0].ok,false);
  assert.equal((await db.query("select has_table_privilege('service_role','sellerpilot_private.provider_rate_budgets','SELECT') ok")).rows[0].ok,false);
  assert.equal((await db.query("select has_table_privilege('service_role','sellerpilot_private.provider_global_rate_budgets','SELECT') ok")).rows[0].ok,false);
 }finally{await db.close();}
});
