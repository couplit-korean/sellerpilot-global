import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const before = await readFile(new URL('./fixtures/daily-inquiry-repair-before.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260912221516_allow_bounded_daily_inquiry_repair.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001';
async function fixture() {
  const db = new PGlite();
  await db.exec(`create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(id uuid primary key,channel text,environment text,status text,expires_at timestamptz,version integer,created_by uuid,created_at timestamptz default now(),seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz);
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,attempt_id uuid,channel text,operation text,environment text,request_payload jsonb,created_by uuid,status text default 'queued',created_at timestamptz default now(),completed_at timestamptz,updated_at timestamptz,seller_account_key text,attempt_count integer default 0,worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz,started_at timestamptz,provider_mutation_started_at timestamptz,error_message text);
    create table sellerpilot_private.channel_sync_state(owner_id uuid,channel_key text,data_type text,status text,imported_count integer,last_started_at timestamptz,last_error text,updated_at timestamptz,unique(owner_id,channel_key,data_type));
    create table sellerpilot_private.operation_audit(owner_id uuid,action text,entity_type text,entity_id text,safe_detail jsonb);
    create table sellerpilot_private.serverless_static_egress_policy(channel text,enabled boolean);
    insert into sellerpilot_private.serverless_static_egress_policy values('coupang',true),('smartstore',true),('temu',true);
  `);
  await db.exec(before);
  return db;
}
const call = async (db, { channel = 'qoo10', operation = 'inquiries.list', key = 'inquiries:history:test', minutes = 1440 } = {}) => (await db.query('select public.sellerpilot_310450_enqueue_periodic_sync_unsafe($1,$2,$3,$4) as result', [channel, operation, {periodicKey: key, arguments: {}}, minutes])).rows[0].result;
async function credential(db, channel) {
  return (await db.query(`insert into sellerpilot_private.channel_credentials(id,channel,environment,status,version,created_by,seller_account_key,seller_account_key_source,seller_account_verified_at) values(gen_random_uuid(),$1,'production','active',1,$2,repeat('a',64),'provider_certified_v1',now()) returning id`, [channel,owner])).rows[0].id;
}

test('reproduces the live daily interval rejection and repairs the exact definitions', async () => {
  const db = await fixture();
  try {
    await assert.rejects(call(db), /invalid periodic channel sync/);
    await db.exec(migration);
    for (const channel of ['qoo10','shopee','coupang','smartstore','ebay','elevenst','temu']) {
      assert.equal((await call(db,{channel})).status,'not_connected');
    }
    for (const args of [{operation:'orders.list'},{key:'inquiries:current'}, {minutes:1441},{minutes:0},{operation:'inquiries.reply'}]) {
      await assert.rejects(call(db,args), /invalid periodic channel sync/);
    }
  } finally { await db.close(); }
});

for (const channel of ['qoo10','ebay']) test(`${channel} keeps daily cooldown, durable pending and reconciliation exclusion`, async () => {
  const db = await fixture();
  try {
    await db.exec(migration); await credential(db,channel);
    const queued=await call(db,{channel}); assert.equal(queued.status,'queued');
    assert.equal((await call(db,{channel})).status,'already_pending');
    const stored=(await db.query('select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1',[queued.jobId])).rows[0].request_payload;
    assert.match(stored.periodicKey,/^inquiries:history:/);
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='succeeded',created_at=now()-interval '3 hours' where id=$1",[queued.jobId]);
    assert.equal((await call(db,{channel})).status,'already_pending');
    await db.query("update sellerpilot_private.channel_gateway_jobs set created_at=now()-interval '25 hours',status='reconciliation_required' where id=$1",[queued.jobId]);
    assert.equal((await call(db,{channel})).status,'reconciliation_required');
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='succeeded' where id=$1",[queued.jobId]);
    assert.equal((await call(db,{channel})).status,'queued');
  } finally { await db.close(); }
});

test('refuses drift instead of replacing an unreviewed production body', async () => {
  const db=await fixture();
  try {
    await db.exec(`create or replace function public.sellerpilot_enqueue_periodic_sync_without_identity_gate(p_channel text,p_operation text,p_request_payload jsonb,p_min_interval_minutes integer default 5) returns jsonb language sql as $$select '{}'::jsonb$$;`);
    await assert.rejects(db.exec(migration),/DAILY_INQUIRY_REPAIR_PREIMAGE_MISMATCH/);
  } finally {await db.close();}
});
