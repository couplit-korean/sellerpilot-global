import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated local fixture: apply the original inventory migration unchanged.
// No live connections, compatibility rewrites, history skips or external writes.
const original = await readFile(new URL('../supabase/migrations/20260903100000_inventory_ledger.sql', import.meta.url), 'utf8');
const patch = await readFile(new URL('../supabase/migrations/20260905130000_reject_inventory_idempotency_conflicts.sql', import.meta.url), 'utf8');
const owner = '10000000-0000-0000-0000-000000000001';
const reserveSig = 'public.sellerpilot_inventory_reserve(uuid,text,text,text,text,integer)';
const returnSig = 'public.sellerpilot_inventory_return_received(uuid,text,integer,text,text,text,text)';
const reserveSql = `select public.sellerpilot_inventory_reserve($1::uuid,'TEST-SKU',$2,$3,$4,$5::integer) as result`;
const returnSql = `select public.sellerpilot_inventory_return_received($1::uuid,'TEST-SKU',$2::integer,$3,$4,$5,$6) as result`;

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema sellerpilot_private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create function public.sellerpilot_is_admin() returns boolean language sql stable as $$ select true $$;
      create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users);
      create table sellerpilot_private.products(id uuid primary key, owner_id uuid, sku text, created_at timestamptz default now(), on_hand integer, reserved integer);
      create table sellerpilot_private.operation_audit(id bigint generated always as identity primary key, owner_id uuid, action text, entity_type text, entity_id text, safe_detail jsonb);
      insert into auth.users values ('${owner}');
      insert into sellerpilot_private.admin_users values ('${owner}');
      insert into sellerpilot_private.products values ('20000000-0000-0000-0000-000000000001','${owner}','TEST-SKU',now(),77,3);
    `);
    await db.exec(original);
    await db.query(`select public.sellerpilot_inventory_receipt($1::uuid,'TEST-SKU',100,'fixture-initial-receipt')`, [owner]);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function reserve(db, quantity = 2, channel = 'shopee', order = 'ORDER-1', line = 'LINE-1') {
  return (await db.query(reserveSql, [owner, channel, order, line, quantity])).rows[0].result;
}
async function receiveReturn(db, quantity = 2, channel = 'shopee', order = 'ORDER-1', line = 'LINE-1', key = 'return-request-1') {
  return (await db.query(returnSql, [owner, quantity, key, channel, order, line])).rows[0].result;
}
async function snapshot(db) {
  const state = {};
  for (const table of ['inventory_items', 'inventory_ledger', 'inventory_reservations', 'operation_audit', 'products']) {
    state[table] = (await db.query(`select to_jsonb(t) as row from sellerpilot_private.${table} t order by id`)).rows;
  }
  return state;
}
async function functions(db) {
  return (await db.query(`select oid, proname, prosrc, proacl::text, proowner, proconfig, prosecdef, proargdefaults::text from pg_proc where oid in ($1::regprocedure,$2::regprocedure) order by proname`, [reserveSig, returnSig])).rows;
}
async function conflictUnchanged(db, action) {
  const before = await snapshot(db);
  await assert.rejects(action, (error) => error.code === '22023' && /IDEMPOTENCY_CONFLICT/.test(error.message));
  assert.deepEqual(await snapshot(db), before, 'rejection must not touch items, events, reservations, audit or products');
}

test('original reproduces silent reserve/return payload conflicts; patch rejects them atomically', async () => {
  const db = await fixture();
  try {
    await reserve(db);
    await receiveReturn(db);
    assert.equal((await reserve(db, 5)).replayed, true);
    assert.equal((await receiveReturn(db, 5, 'lazada', 'OTHER')).replayed, true);
    const before = await snapshot(db);
    await db.exec(patch);
    assert.deepEqual(await snapshot(db), before, 'migration itself never mutates inventory');
    await conflictUnchanged(db, () => reserve(db, 5));
    for (const args of [[5], [2, 'lazada'], [2, 'shopee', 'OTHER'], [2, 'shopee', 'ORDER-1', 'OTHER'], [2, null, null, null]]) {
      await conflictUnchanged(db, () => receiveReturn(db, ...args));
    }
    assert.equal((await reserve(db)).replayed, true);
    assert.equal((await receiveReturn(db)).replayed, true);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test('new events succeed; normalized identical retries and null-reference retries are no-ops', async () => {
  const db = await fixture();
  try {
    await db.exec(patch);
    assert.equal((await reserve(db)).replayed, false);
    assert.equal((await receiveReturn(db)).replayed, false);
    const before = await snapshot(db);
    assert.equal((await reserve(db, 2, ' SHOPEE ', ' ORDER-1 ', ' LINE-1 ')).replayed, true);
    assert.equal((await receiveReturn(db, 2, ' SHOPEE ', ' ORDER-1 ', ' LINE-1 ')).replayed, true);
    assert.deepEqual(await snapshot(db), before);
    assert.equal((await receiveReturn(db, 1, null, null, null, 'return-unbound-key')).replayed, false);
    const unbound = await snapshot(db);
    assert.equal((await receiveReturn(db, 1, null, null, null, 'return-unbound-key')).replayed, true);
    assert.deepEqual(await snapshot(db), unbound);
    await conflictUnchanged(db, () => receiveReturn(db, 1, 'shopee', 'ORDER-1', 'LINE-1', 'return-unbound-key'));
    // Reserve keys include the order and channel: distinct references are new reservations, not key conflicts.
    assert.equal((await reserve(db, 1, 'lazada')).replayed, false);
    assert.equal((await reserve(db, 1, 'shopee', 'OTHER')).replayed, false);
  } finally { await db.close(); }
});

test('ACL, ownership, SECURITY DEFINER and empty search_path remain exact; only service_role can invoke', async () => {
  const db = await fixture();
  try {
    const before = await functions(db);
    await db.exec(patch);
    const after = await functions(db);
    const metadata = (row) => { const copy = { ...row }; delete copy.prosrc; return copy; };
    assert.deepEqual(after.map(metadata), before.map(metadata));
    for (let i = 0; i < before.length; i++) {
      const guard = / {4}if exists \(\n {6}select 1 from sellerpilot_private\.inventory_ledger l[\s\S]*?raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';\n {4}end if;\n/;
      assert.match(after[i].prosrc, guard);
      const inputGuard = / {2}-- inventory reference preflight begin\n[\s\S]*? {2}-- inventory reference preflight end\n/;
      assert.match(after[i].prosrc, inputGuard);
      assert.equal(after[i].prosrc.replace(guard, '').replace(inputGuard, ''), before[i].prosrc, 'only conflict and preflight guards change the body');
    }
    for (const signature of [reserveSig, returnSig]) {
      const rows = (await db.query(`select has_function_privilege('anon',$1,'EXECUTE') as anon, has_function_privilege('authenticated',$1,'EXECUTE') as authenticated, has_function_privilege('service_role',$1,'EXECUTE') as service`, [signature])).rows;
      assert.deepEqual(rows, [{ anon: false, authenticated: false, service: true }]);
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => reserve(db), (e) => e.code === '42501');
      await assert.rejects(() => receiveReturn(db), (e) => e.code === '42501');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await reserve(db)).replayed, false);
    assert.equal((await receiveReturn(db)).replayed, false);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('later function preimage drift rolls back the earlier function patch and leaves all data unchanged', async () => {
  const db = await fixture();
  try {
    const definition = (await db.query(`select pg_get_functiondef($1::regprocedure) as definition`, [returnSig])).rows[0].definition;
    await db.exec(definition.replace('검수 후 반품 재입고', 'changed preimage'));
    const before = await functions(db);
    const data = await snapshot(db);
    await assert.rejects(() => db.exec(patch), /return_received preimage or execution contract mismatch/);
    await db.exec('rollback');
    assert.deepEqual(await functions(db), before);
    assert.deepEqual(await snapshot(db), data);
  } finally { await db.close(); }
});

for (const change of ['missing', 'unsafe-acl', 'unsafe-search-path', 'changed-default', 'already-applied']) {
  test(`migration fails closed for ${change}`, async () => {
    const db = await fixture();
    try {
      if (change === 'missing') await db.exec(`drop function ${returnSig}`);
      if (change === 'unsafe-acl') await db.exec(`grant execute on function ${returnSig} to authenticated`);
      if (change === 'unsafe-search-path') await db.exec(`alter function ${returnSig} set search_path = public`);
      if (change === 'changed-default') {
        const definition = (await db.query(`select pg_get_functiondef($1::regprocedure) as definition`, [returnSig])).rows[0].definition;
        assert.match(definition, /DEFAULT NULL::text/);
        await db.exec(definition.replace('DEFAULT NULL::text', "DEFAULT 'shopee'::text"));
      }
      if (change === 'already-applied') await db.exec(patch);
      const before = await snapshot(db);
      const definitions = (await db.query(`select proname, prosrc, proacl::text, proconfig from pg_proc where proname in ('sellerpilot_inventory_reserve','sellerpilot_inventory_return_received') order by proname`)).rows;
      await assert.rejects(() => db.exec(patch), /preimage or execution contract mismatch/);
      await db.exec('rollback');
      assert.deepEqual(await snapshot(db), before);
      assert.deepEqual((await db.query(`select proname, prosrc, proacl::text, proconfig from pg_proc where proname in ('sellerpilot_inventory_reserve','sellerpilot_inventory_return_received') order by proname`)).rows, definitions);
    } finally { await db.close(); }
  });
}

async function invalidReferenceUnchanged(db, action) {
  const before = await snapshot(db);
  await assert.rejects(action, (e) => e.code === '22023' && /INVALID_ORDER_REFERENCE/.test(e.message));
  assert.deepEqual(await snapshot(db), before);
}

test('ambiguous colon references and partial returns fail before writing or replaying', async () => {
  const db = await fixture();
  try {
    // Historical ambiguous rows remain untouched; neither partition may replay them.
    await reserve(db, 2, 'shopee', 'A:B', 'C');
    await receiveReturn(db, 2, 'shopee', 'A:B', 'C', 'historical-colon');
    await receiveReturn(db, 2, 'shopee', 'OLD-ORDER', null, 'historical-partial');
    const before = await snapshot(db);
    await db.exec(patch);
    assert.deepEqual(await snapshot(db), before);
    for (const [order, line] of [['A:B', 'C'], ['A', 'B:C']]) {
      await invalidReferenceUnchanged(db, () => reserve(db, 2, 'shopee', order, line));
      await invalidReferenceUnchanged(db, () => receiveReturn(db, 2, 'shopee', order, line, 'historical-colon'));
      await invalidReferenceUnchanged(db, () => receiveReturn(db, 2, 'shopee', order, line, 'new-colon-key'));
    }
    for (const refs of [['shopee', null, null], [null, 'ORDER', null], [null, null, 'LINE'], ['shopee', 'ORDER', null], ['shopee', null, 'LINE'], [null, 'ORDER', 'LINE'], ['shopee', 'ORDER', '   ']]) {
      await invalidReferenceUnchanged(db, () => receiveReturn(db, 2, ...refs, 'new-partial-key'));
      await invalidReferenceUnchanged(db, () => receiveReturn(db, 2, ...refs, 'historical-partial'));
    }
  } finally { await db.close(); }
});

test('composite key boundary is checked before writes; 240 characters and normal retries are preserved', async () => {
  const db = await fixture();
  try {
    await db.exec(patch);
    for (const char of ['L', '😀']) {
      const line = char.repeat(231); // shopee:O: = 9 PostgreSQL characters
      assert.equal((await reserve(db, 1, 'shopee', 'O', line)).replayed, false);
      const before = await snapshot(db);
      assert.equal((await reserve(db, 1, ' SHOPEE ', ' O ', ` ${line} `)).replayed, true);
      assert.deepEqual(await snapshot(db), before);
      await invalidReferenceUnchanged(db, () => reserve(db, 1, 'shopee', 'O', char.repeat(232)));
      const key = char === 'L' ? 'boundary-return-ascii' : 'boundary-return-unicode';
      assert.equal((await receiveReturn(db, 1, 'shopee', 'O', line, key)).replayed, false);
      assert.equal((await receiveReturn(db, 1, 'shopee', 'O', line, key)).replayed, true);
      await invalidReferenceUnchanged(db, () => receiveReturn(db, 1, 'shopee', 'O', char.repeat(232), key));
    }
    const lengths = (await db.query(`select length(order_key) as key_length,length(order_line_key) as line_length from sellerpilot_private.inventory_reservations where external_order_id='O'`)).rows;
    assert.deepEqual(lengths, [{ key_length: 240, line_length: 231 }, { key_length: 240, line_length: 231 }]);
    const first = await receiveReturn(db, 1, null, null, null, 'no-reference-key');
    assert.equal(first.replayed, false);
    const before = await snapshot(db);
    assert.equal((await receiveReturn(db, 1, ' ', ' ', ' ', ' no-reference-key ')).replayed, true);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test('explicit NULL quantity is rejected by preflight for both fresh and existing keys without writes', async () => {
  const db = await fixture();
  try {
    await reserve(db);
    await receiveReturn(db);
    await db.exec(patch);
    for (const action of [
      () => reserve(db, null), () => reserve(db, null, 'shopee', 'FRESH', 'LINE'),
      () => receiveReturn(db, null), () => receiveReturn(db, null, null, null, null, 'fresh-null-return'),
    ]) {
      const before = await snapshot(db);
      await assert.rejects(action, (e) => e.code === '22023' && /INVALID_QUANTITY/.test(e.message));
      assert.deepEqual(await snapshot(db), before);
    }
  } finally { await db.close(); }
});
