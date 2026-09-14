import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const before=JSON.parse(await readFile(new URL('./fixtures/local-category-read-before.json',import.meta.url),'utf8'));
const migration=await readFile(new URL('../supabase/migrations/20260914081000_local_category_read_routes.sql',import.meta.url),'utf8');
const lazadaMigration=await readFile(new URL('../supabase/migrations/20260914085500_lazada_local_category_reads.sql',import.meta.url),'utf8');
const u=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const release='a'.repeat(40),ip='b'.repeat(64),version=`sellerpilot-cli-worker/1.61+${release}.${ip.slice(0,11)}`;
async function setup(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema sellerpilot_private;create schema vault;
 create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,token_hash text,status text,expires_at timestamptz);
 create table sellerpilot_private.channel_credentials(id uuid primary key,channel text,environment text,status text,expires_at timestamptz,seller_account_key text,vault_secret_id uuid);
 create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
 create table sellerpilot_private.local_channel_executor_routes(id uuid primary key,channel text,operation text,credential_id uuid,worker_token_id uuid,enabled boolean,approved_by uuid,approved_at timestamptz,expires_at timestamptz,release_sha text,egress_ip_sha256 text,seller_account_key text, constraint local_channel_executor_routes_operation_check ${before.constraint.definition});
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,channel text,operation text,environment text default 'production',status text default 'queued',rate_not_before timestamptz,created_at timestamptz default now(),request_payload jsonb default '{}',worker_token_id uuid,claim_token uuid,attempt_count int default 0,lease_expires_at timestamptz,started_at timestamptz,error_message text,updated_at timestamptz);
 create function sellerpilot_private.active_serverless_runtime_release_sha() returns text language sql as $$select repeat('a',40)$$;
 create function sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text) returns boolean language sql as $$select sellerpilot_private.local_channel_executor_read_bootstrap_allowed($1,$2,$3,$4,$5,$6)$$;
 ` .replace(/create function sellerpilot_private.local_channel_executor_job_allowed[\s\S]*?\$\$;/,''));
 for(const f of before.functions){await db.exec(f.definition);await db.exec(`revoke all on function ${f.signature} from public,anon,authenticated,service_role;`);}
 await db.exec(`create function sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text) returns boolean language sql as $$select sellerpilot_private.local_channel_executor_read_bootstrap_allowed($1,$2,$3,$4,$5,$6)$$;
 insert into sellerpilot_private.ai_cli_worker_tokens values('${u(1)}','good','active',now()+interval '1 hour');
 insert into vault.decrypted_secrets values('${u(2)}','{"fixture":true}');`);
 return db;
}
async function seed(db,n,channel,operation){
 await db.query(`insert into sellerpilot_private.channel_credentials values($1,$2,'production','active',now()+interval '1 hour','seller',$3)`,[u(n),channel,u(2)]);
 await db.query(`insert into sellerpilot_private.local_channel_executor_routes values($1,$2,$3,$4,$5,true,$5,now(),now()+interval '1 hour',$6,$7,'seller')`,[u(n+100),channel,operation,u(n),u(1),release,ip]);
 await db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,operation) values($1,$2,$3,$4)`,[u(n+200),u(n),channel,operation]);
}
const claim=async(db,args=['good',version,release,ip])=>(await db.query('select sellerpilot_private.claim_local_channel_executor_read_job($1,$2,$3,$4) result',args)).rows[0].result;

test('exact live function/constraint guards apply, nine category reads claim and rollback preserves queued work',async()=>{
 const db=await setup();try{
  const acl=(await db.query("select oid::regprocedure::text signature,proacl::text acl from pg_proc where pronamespace='sellerpilot_private'::regnamespace order by 1")).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query("select oid::regprocedure::text signature,proacl::text acl from pg_proc where pronamespace='sellerpilot_private'::regnamespace order by 1")).rows,acl);
  let n=10;
  for(const channel of ['coupang','elevenst','temu'])for(const op of ['categories.suggest','categories.attributes','categories.validate']){
   await db.exec('begin');await seed(db,n,channel,op);const result=await claim(db);
   assert.equal(result.id,u(n+200));assert.equal(result.operation,op);assert.equal(result.attempt_count,1);assert.deepEqual(result.credential,{fixture:true});
   assert.equal(await claim(db),null);await db.exec('rollback');assert.equal((await db.query('select count(*)::int n from sellerpilot_private.channel_gateway_jobs')).rows[0].n,0);n++;
  }
  await assert.rejects(db.query(`insert into sellerpilot_private.local_channel_executor_routes(id,channel,operation) values($1,'ebay','categories.suggest')`,[u(99)]),e=>e.code==='23514');
  await assert.rejects(db.query(`insert into sellerpilot_private.local_channel_executor_routes(id,channel,operation) values($1,'temu','categories.update')`,[u(99)]),e=>e.code==='23514');
 }finally{await db.close();}
});

test('category claim retains route approval, seller, credential, token, release, egress, expiry and channel lock gates',async()=>{
 const db=await setup();try{await db.exec(migration);await seed(db,10,'temu','categories.suggest');
  for(const change of ["update sellerpilot_private.local_channel_executor_routes set enabled=false","update sellerpilot_private.local_channel_executor_routes set approved_by=null","update sellerpilot_private.local_channel_executor_routes set expires_at=now()-interval '1 second'","update sellerpilot_private.local_channel_executor_routes set seller_account_key='other'","update sellerpilot_private.channel_credentials set status='revoked'","update sellerpilot_private.channel_credentials set expires_at=now()-interval '1 second'","update sellerpilot_private.channel_gateway_jobs set rate_not_before=now()+interval '1 hour'"]){await db.exec('begin');await db.exec(change);assert.equal(await claim(db),null);await db.exec('rollback');}
  for(const args of [['good',version,'c'.repeat(40),ip],['good',version,release,'d'.repeat(64)],['good','wrong',release,ip]])assert.equal(await claim(db,args),null);
  await assert.rejects(claim(db,['wrong',version,release,ip]),e=>e.code==='42501');
  await db.exec('begin');await db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,channel,operation,status) values($1,'temu','orders.list','running')`,[u(999)]);assert.equal(await claim(db),null);await db.exec('rollback');
  await db.exec('begin');await db.exec('delete from vault.decrypted_secrets');await assert.rejects(claim(db),/LOCAL_READ_CREDENTIAL_UNAVAILABLE/);await db.exec('rollback');
  assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs')).rows[0].status,'queued');
 }finally{await db.close();}
});

test('migration rejects changed function or constraint and rolls every partial definition update back',async()=>{
 for(const target of ['function','constraint']){const db=await setup();try{
  if(target==='function')await db.exec(`create or replace function sellerpilot_private.local_channel_executor_access(p_channel text,p_operation text) returns text language sql as $$select null::text$$`);
  else await db.exec('alter table sellerpilot_private.local_channel_executor_routes drop constraint local_channel_executor_routes_operation_check;alter table sellerpilot_private.local_channel_executor_routes add constraint local_channel_executor_routes_operation_check check(true)');
  const old=(await db.query("select md5(pg_get_functiondef('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)'::regprocedure)) h")).rows[0].h;
  await assert.rejects(db.exec(migration),/LOCAL_CATEGORY_READ_.*PREIMAGE_CHANGED/);await db.exec('rollback');
  assert.equal((await db.query("select md5(pg_get_functiondef('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)'::regprocedure)) h")).rows[0].h,old);
 }finally{await db.close();}}
});

test('Lazada forward migration admits three reads only after an explicit matching route, preserving previous channels',async()=>{
 const db=await setup();try{
  await db.exec(migration);
  const acl=(await db.query("select oid::regprocedure::text signature,proacl::text acl from pg_proc where pronamespace='sellerpilot_private'::regnamespace order by 1")).rows;
  await db.exec(lazadaMigration);
  assert.deepEqual((await db.query("select oid::regprocedure::text signature,proacl::text acl from pg_proc where pronamespace='sellerpilot_private'::regnamespace order by 1")).rows,acl);
  let n=20;
  for(const channel of ['lazada','coupang','elevenst','temu'])for(const operation of ['categories.suggest','categories.attributes','categories.validate']){
   await db.exec('begin');await seed(db,n,channel,operation);
   await db.exec('savepoint missing_route');await db.exec('delete from sellerpilot_private.local_channel_executor_routes');
   assert.equal(await claim(db),null);await db.exec('rollback to missing_route');
   const result=await claim(db);assert.equal(result.id,u(n+200));assert.equal(result.operation,operation);assert.equal(result.attempt_count,1);
   await db.exec('rollback');n++;
  }
  for(const operation of ['categories.list','categories.update'])await assert.rejects(db.query('insert into sellerpilot_private.local_channel_executor_routes(id,channel,operation) values($1,$2,$3)',[u(99),'lazada',operation]),e=>e.code==='23514');
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.channel_gateway_jobs')).rows[0].n,0);
 }finally{await db.close();}
});

test('Lazada category reads retain approval, seller, credential, rate, release and IP gates',async()=>{
 const db=await setup();try{
  await db.exec(migration);await db.exec(lazadaMigration);await seed(db,10,'lazada','categories.suggest');
  for(const change of ["update sellerpilot_private.local_channel_executor_routes set enabled=false","update sellerpilot_private.local_channel_executor_routes set approved_by=null","update sellerpilot_private.local_channel_executor_routes set expires_at=now()-interval '1 second'","update sellerpilot_private.local_channel_executor_routes set seller_account_key='other'","update sellerpilot_private.local_channel_executor_routes set worker_token_id=null","update sellerpilot_private.channel_credentials set status='revoked'","update sellerpilot_private.channel_credentials set expires_at=now()-interval '1 second'","update sellerpilot_private.channel_gateway_jobs set rate_not_before=now()+interval '1 hour'"]){await db.exec('begin');await db.exec(change);assert.equal(await claim(db),null);await db.exec('rollback');}
  for(const args of [['good',version,'c'.repeat(40),ip],['good',version,release,'d'.repeat(64)],['good','wrong',release,ip]])assert.equal(await claim(db,args),null);
  assert.equal((await db.query('select attempt_count from sellerpilot_private.channel_gateway_jobs')).rows[0].attempt_count,0);
  assert.equal((await claim(db)).id,u(210));
 }finally{await db.close();}
});

test('Lazada forward migration fails closed on preimage drift and rolls back partial patches',async()=>{
 for(const target of ['function','constraint']){const db=await setup();try{
  await db.exec(migration);
  if(target==='function')await db.exec('create or replace function sellerpilot_private.local_channel_executor_access(p_channel text,p_operation text) returns text language sql as $$select null::text$$');
  else await db.exec('alter table sellerpilot_private.local_channel_executor_routes drop constraint local_channel_executor_routes_operation_check;alter table sellerpilot_private.local_channel_executor_routes add constraint local_channel_executor_routes_operation_check check(true)');
  const old=(await db.query("select md5(pg_get_functiondef('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)'::regprocedure)) h")).rows[0].h;
  await assert.rejects(db.exec(lazadaMigration),/LAZADA_LOCAL_CATEGORY_.*PREIMAGE_CHANGED/);await db.exec('rollback');
  assert.equal((await db.query("select md5(pg_get_functiondef('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)'::regprocedure)) h")).rows[0].h,old);
 }finally{await db.close();}}
});
