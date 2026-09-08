import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const baseSource = await readFile(new URL('../supabase/migrations/20260907210000_persist_lazada_im_raw_inbox.sql', import.meta.url), 'utf8');
const reprocessSource = await readFile(new URL('../supabase/migrations/20260907230000_add_lazada_im_raw_reprocessing_ledger.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000301';
const credential = '00000000-0000-4000-8000-000000000302';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
    create schema sellerpilot_private;
    create schema extensions;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      created_by uuid not null references auth.users(id),
      channel text not null,
      status text not null
    );
  `);
  await db.query('insert into auth.users values($1)', [owner]);
  await db.query("insert into sellerpilot_private.channel_credentials values($1,$2,'lazada','active')", [credential, owner]);
  await db.exec(baseSource);
  await db.exec(reprocessSource);
  return db;
}

async function store(db, raw, sourceKind = 'webhook') {
  return (await db.query(
    'select public.sellerpilot_service_store_lazada_im_raw_event_v1($1,$2,$3) result',
    [credential, raw, sourceKind],
  )).rows[0].result;
}

async function claim(db) {
  return (await db.query('select public.sellerpilot_service_claim_lazada_im_raw_v1(5,120) result')).rows[0].result;
}

async function complete(db, id, token, outcome, errorCode = null) {
  return (await db.query(
    "select public.sellerpilot_service_complete_lazada_im_raw_v1($1,$2,$3,'lazada-im-parser/1',$4) result",
    [id, token, outcome, errorCode],
  )).rows[0].result;
}

test('claim lease prevents double processing and completion requires its exact live token', async () => {
  const db = await fixture();
  try {
    const receipt = await store(db, '{"message_id":"claim-once"}');
    const first = await claim(db);
    assert.equal(first.contract, 'lazada_im_raw_claim_v1');
    assert.equal(first.receipts.length, 1);
    assert.equal(first.receipts[0].id, receipt.id);
    assert.equal(first.receipts[0].attemptCount, 1);
    assert.equal((await claim(db)).receipts.length, 0);
    await assert.rejects(
      complete(db, receipt.id, '00000000-0000-4000-8000-000000000399', 'normalized'),
      /LAZADA_IM_RAW_LIVE_CLAIM_REQUIRED/,
    );
    const completed = await complete(db, receipt.id, first.claimToken, 'normalized');
    assert.equal(completed.status, 'normalized');
    const outcome = (await db.query('select * from sellerpilot_private.lazada_im_raw_outcomes')).rows[0];
    assert.equal(outcome.final_status, 'normalized');
    assert.equal(outcome.raw_body_bytes, Buffer.byteLength('{"message_id":"claim-once"}'));
    assert.equal(Object.hasOwn(outcome, 'raw_body'), false);
  } finally { await db.close(); }
});

test('transient failures back off and the fifth failed attempt becomes terminal evidence', async () => {
  const db = await fixture();
  try {
    const receipt = await store(db, '{"message_id":"retry-five"}');
    for (let attempt = 1; attempt <= 5; attempt++) {
      const batch = await claim(db);
      assert.equal(batch.receipts[0].attemptCount, attempt);
      const result = await complete(db, receipt.id, batch.claimToken, 'retry', 'RAW_INGEST_UNAVAILABLE');
      assert.equal(result.status, attempt === 5 ? 'failed' : 'pending');
      if (attempt < 5) {
        const row = (await db.query('select next_attempt_at,last_attempt_at from sellerpilot_private.lazada_im_raw_inbox where id=$1', [receipt.id])).rows[0];
        assert.ok(row.next_attempt_at > row.last_attempt_at);
        await db.query('update sellerpilot_private.lazada_im_raw_inbox set next_attempt_at=now() where id=$1', [receipt.id]);
      }
    }
    assert.equal((await claim(db)).receipts.length, 0);
    const row = (await db.query('select processing_status,attempt_count,claim_token from sellerpilot_private.lazada_im_raw_inbox where id=$1', [receipt.id])).rows[0];
    assert.deepEqual(row, { processing_status: 'failed', attempt_count: 5, claim_token: null });
    assert.equal((await db.query('select final_status,error_code from sellerpilot_private.lazada_im_raw_outcomes')).rows[0].final_status, 'failed');
  } finally { await db.close(); }
});

test('retention pruning records body-free evidence for unprocessed expiry', async () => {
  const db = await fixture();
  try {
    const receipt = await store(db, '{"message_id":"expired-pending"}');
    await db.query("update sellerpilot_private.lazada_im_raw_inbox set first_observed_at=now()-interval '31 days',expires_at=now()-interval '1 day' where id=$1", [receipt.id]);
    const result = (await db.query('select public.sellerpilot_service_prune_lazada_im_raw_inbox_v1() result')).rows[0].result;
    assert.deepEqual(result, { contract: 'lazada_im_raw_prune_v2', rawDeleted: 1, outcomesRecorded: 1, outcomesDeleted: 0 });
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.lazada_im_raw_inbox')).rows[0].n, 0);
    const outcome = (await db.query('select final_status,error_code,raw_body_bytes from sellerpilot_private.lazada_im_raw_outcomes')).rows[0];
    assert.deepEqual(outcome, {
      final_status: 'expired_unprocessed',
      error_code: 'RAW_RETENTION_EXPIRED',
      raw_body_bytes: Buffer.byteLength('{"message_id":"expired-pending"}'),
    });
  } finally { await db.close(); }
});

test('health is admin-only while raw tables and service mutations remain role-scoped', async () => {
  const db = await fixture();
  try {
    await store(db, '{"message_id":"health"}');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const access = (await db.query(
        "select has_table_privilege($1,'sellerpilot_private.lazada_im_raw_outcomes','SELECT') direct, has_function_privilege($1,'public.sellerpilot_service_claim_lazada_im_raw_v1(integer,integer)','EXECUTE') claim, has_function_privilege($1,'public.sellerpilot_service_complete_lazada_im_raw_v1(uuid,uuid,text,text,text)','EXECUTE') complete, has_function_privilege($1,'public.sellerpilot_read_lazada_im_raw_health_v1()','EXECUTE') health",
        [role],
      )).rows[0];
      assert.equal(access.direct, false);
      assert.equal(access.claim, role === 'service_role');
      assert.equal(access.complete, role === 'service_role');
      assert.equal(access.health, role === 'authenticated');
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    const health = (await db.query('select public.sellerpilot_read_lazada_im_raw_health_v1() result')).rows[0].result;
    assert.equal(health.contract, 'lazada_im_raw_health_v1');
    assert.equal(health.capacity, 5000);
    assert.equal(health.capacityScope, 'owner');
    assert.equal(health.retained, 1);
    assert.equal(health.retainedBytes, Buffer.byteLength('{"message_id":"health"}'));
    assert.equal(health.maximumOwnerRetained, 1);
    assert.equal(health.pending, 1);
    await assert.rejects(db.query('select * from sellerpilot_private.lazada_im_raw_outcomes'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('raw receipt enforces exact 256KB and per-owner 5,000-row boundaries', async () => {
  const db = await fixture();
  try {
    const exact = `{"x":"${'a'.repeat(255_992)}"}`;
    assert.equal(Buffer.byteLength(exact), 256_000);
    assert.equal((await store(db, exact)).status, 'stored');
    await assert.rejects(store(db, `${exact} `), /LAZADA_IM_RAW_BODY_INVALID/);
    await db.exec(`
      insert into sellerpilot_private.lazada_im_raw_inbox(
        owner_id,credential_id,source_kind,delivery_digest,raw_body
      )
      select '${owner}', '${credential}', 'webhook', lpad(to_hex(value),64,'0'),
             jsonb_build_object('seed',value)::text
        from generate_series(1,4998) value;
    `);
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.lazada_im_raw_inbox')).rows[0].n, 4999);
    assert.equal((await store(db, '{"message_id":"row-5000"}')).status, 'stored');
    const over = await store(db, '{"message_id":"row-5001"}');
    assert.equal(over.status, 'capacity');
    assert.equal(over.retryAfterSeconds, 300);
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.lazada_im_raw_inbox')).rows[0].n, 5000);
  } finally { await db.close(); }
});
