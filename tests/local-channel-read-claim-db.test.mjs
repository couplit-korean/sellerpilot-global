import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const before = await readFile(new URL('./fixtures/local-channel-read-claim-before.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260912204232_harden_local_channel_read_claim.sql', import.meta.url), 'utf8');
const release = 'a'.repeat(40), egress = 'b'.repeat(64);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private; create schema vault;
    create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,token_hash text,status text,expires_at timestamptz);
    create table sellerpilot_private.channel_credentials(id uuid primary key,status text,vault_secret_id uuid,seller_account_key text);
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid, channel text, environment text default 'production',
      operation text, status text default 'queued', request_payload jsonb default '{}',
      worker_token_id uuid,claim_token uuid,attempt_count int default 0,
      lease_expires_at timestamptz,rate_not_before timestamptz,started_at timestamptz,
      error_message text,updated_at timestamptz,created_at timestamptz default now()
    );
    create function sellerpilot_private.local_channel_executor_access(text,text) returns text
      language sql as $$select case when $2 in ('diagnostic.test','inquiries.list','orders.list') then 'read' else 'write' end$$;
    create function sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text) returns boolean
      language sql as $$select $4='verified-worker' and $5=repeat('a',40) and $6=repeat('b',64)$$;
    create function sellerpilot_private.test_running_guard() returns trigger language plpgsql as $$begin
      if new.status='running' and exists(select 1 from sellerpilot_private.channel_gateway_jobs
          where channel=new.channel and environment=new.environment and status='running' and id<>new.id) then
        raise exception 'channel gateway running operation already exists' using errcode='SPC02';
      end if; return new; end$$;
    create trigger same_channel_guard before update on sellerpilot_private.channel_gateway_jobs
      for each row execute function sellerpilot_private.test_running_guard();
    insert into sellerpilot_private.ai_cli_worker_tokens values('${uuid(1)}','good','active',now()+interval '1 hour');
    insert into vault.decrypted_secrets values('${uuid(2)}','{"test":true}');
    insert into sellerpilot_private.channel_credentials values('${uuid(3)}','active','${uuid(2)}','test-seller');
  `);
  await db.exec(before);
  return db;
}
const claim = async (db, options={}) => (await db.query(
  'select sellerpilot_private.claim_local_channel_executor_read_job($1,$2,$3,$4) result',
  [options.token??'good',options.version??'verified-worker',options.release??release,options.egress??egress],
)).rows[0].result;
async function job(db,n,channel,operation,extra={}) {
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs
    (id,credential_id,channel,operation,status,created_at,rate_not_before)
    values($1,$2,$3,$4,$5,now()+($6::int*interval '1 second'),$7)`,
  [uuid(n),uuid(3),channel,operation,extra.status??'queued',n,extra.defer??null]);
}

test('live defect reproduced, then busy channel is skipped and independent orders are claimed without changing active lease',async()=>{
  const db=await fixture();
  try {
    await job(db,10,'elevenst','inquiries.list',{status:'running'});
    await job(db,11,'elevenst','inquiries.list');
    await job(db,12,'smartstore','orders.list');
    await assert.rejects(claim(db),e=>e.code==='SPC02');
    const prior=(await db.query('select * from sellerpilot_private.channel_gateway_jobs where id=$1',[uuid(10)])).rows[0];
    await db.exec(migration);
    const result=await claim(db);
    assert.equal(result.id,uuid(12));assert.equal(result.operation,'orders.list');
    assert.equal(result.attempt_count,1);assert.deepEqual(result.credential,{test:true});
    assert.equal(await claim(db),null);
    assert.deepEqual((await db.query('select * from sellerpilot_private.channel_gateway_jobs where id=$1',[uuid(10)])).rows[0],prior);
    assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs where id=$1',[uuid(11)])).rows[0].status,'queued');
  } finally {await db.close();}
});

test('deferred budgets, attestation mismatch, invalid token and writes cannot enter local read lane',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    await job(db,10,'coupang','inquiries.list',{defer:'2099-01-01T00:00:00Z'});
    await job(db,11,'temu','listing.create');
    await job(db,12,'shopee','diagnostic.test');
    assert.equal(await claim(db,{release:'c'.repeat(40)}),null);
    assert.equal(await claim(db,{egress:'c'.repeat(64)}),null);
    await assert.rejects(claim(db,{token:'invalid'}),e=>e.code==='42501');
    assert.equal((await claim(db)).id,uuid(12));
    const untouched=(await db.query('select status,attempt_count from sellerpilot_private.channel_gateway_jobs where id in ($1,$2)',[uuid(10),uuid(11)])).rows;
    assert.ok(untouched.every(x=>x.status==='queued'&&x.attempt_count===0));
    const permissions=(await db.query(`select has_function_privilege('anon','sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)','execute') a,
      has_function_privilege('authenticated','sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)','execute') b,
      has_function_privilege('service_role','sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)','execute') c`)).rows[0];
    assert.deepEqual(permissions,{a:false,b:false,c:false});
  } finally {await db.close();}
});

test('missing secret rolls the claim back; migration rejects a changed preimage',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);await job(db,10,'smartstore','orders.list');
    await db.exec('delete from vault.decrypted_secrets');
    await assert.rejects(claim(db),/LOCAL_READ_CREDENTIAL_UNAVAILABLE/);
    assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs')).rows[0].status,'queued');
    await assert.rejects(db.exec(migration),/LOCAL_READ_CLAIM_PREIMAGE_CHANGED/);
    await db.exec('rollback');
  } finally {await db.close();}
});
