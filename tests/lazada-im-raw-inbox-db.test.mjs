import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const source = await readFile(new URL('../supabase/migrations/20260907210000_persist_lazada_im_raw_inbox.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000101';
const credential = '00000000-0000-4000-8000-000000000102';

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
  await db.exec(source);
  return db;
}

async function store(db, raw) {
  return (await db.query(
    "select public.sellerpilot_service_store_lazada_im_raw_event_v1($1,$2,'webhook') result",
    [credential, raw],
  )).rows[0].result;
}

test('raw inbox stores exact signed bytes once and never extends replay retention', async () => {
  const db = await fixture();
  try {
    const raw = '{ "seller_id":"2001", "data":{"content":{"imgUrl":"https://fixture.invalid/a.png"}} }\n';
    const first = await store(db, raw);
    assert.equal(first.contract, 'lazada_im_raw_inbox_v1');
    assert.equal(first.status, 'stored');
    assert.equal(first.processingStatus, 'pending');
    const before = (await db.query('select * from sellerpilot_private.lazada_im_raw_inbox')).rows[0];
    const replay = await store(db, raw);
    assert.equal(replay.status, 'duplicate');
    assert.equal(replay.id, first.id);
    assert.deepEqual((await db.query('select * from sellerpilot_private.lazada_im_raw_inbox')).rows[0], before);
    assert.equal(before.raw_body, raw);
  } finally {
    await db.close();
  }
});

test('normalization is credential-bound, idempotent and rejects unsupported statuses', async () => {
  const db = await fixture();
  try {
    const receipt = await store(db, '{"seller_id":"2001"}');
    const marked = (await db.query(
      "select public.sellerpilot_service_mark_lazada_im_raw_event_v1($1,$2,'normalized') result",
      [credential, receipt.id],
    )).rows[0].result;
    assert.equal(marked.status, 'normalized');
    await db.query(
      "select public.sellerpilot_service_mark_lazada_im_raw_event_v1($1,$2,'normalized')",
      [credential, receipt.id],
    );
    assert.equal((await db.query('select processing_status from sellerpilot_private.lazada_im_raw_inbox')).rows[0].processing_status, 'normalized');
    await assert.rejects(
      db.query("select public.sellerpilot_service_mark_lazada_im_raw_event_v1($1,$2,'pending')", [credential, receipt.id]),
      /LAZADA_IM_RAW_STATUS_INVALID/,
    );
  } finally {
    await db.close();
  }
});

test('malformed bodies and inactive credentials fail before storage', async () => {
  const db = await fixture();
  try {
    await assert.rejects(store(db, 'not-json'), /LAZADA_IM_RAW_BODY_INVALID/);
    await assert.rejects(store(db, '[]'), /LAZADA_IM_RAW_BODY_INVALID/);
    await db.exec("update sellerpilot_private.channel_credentials set status='revoked'");
    await assert.rejects(store(db, '{}'), /active channel credential required/);
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.lazada_im_raw_inbox')).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('raw rows remain private and retention pruning deletes only expired receipts', async () => {
  const db = await fixture();
  try {
    await store(db, '{"message_id":"old"}');
    await store(db, '{"message_id":"new"}');
    await db.exec("update sellerpilot_private.lazada_im_raw_inbox set first_observed_at=now()-interval '31 days',expires_at=now()-interval '1 day' where raw_body like '%old%'");
    assert.equal((await db.query('select public.sellerpilot_service_prune_lazada_im_raw_inbox_v1() n')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.lazada_im_raw_inbox')).rows[0].n, 1);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const access = (await db.query(
        "select has_table_privilege($1,'sellerpilot_private.lazada_im_raw_inbox','SELECT') direct, has_function_privilege($1,'public.sellerpilot_service_store_lazada_im_raw_event_v1(uuid,text,text)','EXECUTE') rpc, has_function_privilege($1,'public.sellerpilot_read_lazada_im_raw_inbox_v1(timestamptz,uuid,timestamptz)','EXECUTE') reader",
        [role],
      )).rows[0];
      assert.equal(access.direct, false);
      assert.equal(access.rpc, role === 'service_role');
      assert.equal(access.reader, role === 'authenticated');
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='sellerpilot_private.lazada_im_raw_inbox'::regclass")).rows[0].relrowsecurity, true);
  } finally {
    await db.close();
  }
});

test('authenticated administrator can page exact retained bodies without direct table access', async () => {
  const db = await fixture();
  try {
    const raw = '{"message_id":"admin-visible","content":{"type":"image"}}';
    await store(db, raw);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    const page = (await db.query('select public.sellerpilot_read_lazada_im_raw_inbox_v1() result')).rows[0].result;
    assert.equal(page.contract, 'lazada_im_raw_read_v1');
    assert.equal(page.events.length, 1);
    assert.equal(page.events[0].rawBody, raw);
    assert.equal(page.events[0].sourceKind, 'webhook');
    assert.equal(page.events[0].processingStatus, 'pending');
    await assert.rejects(db.query('select * from sellerpilot_private.lazada_im_raw_inbox'), /permission denied/);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});
