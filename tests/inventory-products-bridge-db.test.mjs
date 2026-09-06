import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const sql = async (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const owner = '10000000-0000-0000-0000-000000000001';
const product = '20000000-0000-0000-0000-000000000001';
const original = await sql('20260903100000_inventory_ledger.sql');
const hardened = await sql('20260905130000_reject_inventory_idempotency_conflicts.sql');
const bridge = await sql('20260905141000_products_authoritative_inventory_bridge.sql');
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema sellerpilot_private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select '${owner}'::uuid$$;
      create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select true$$;
      create table sellerpilot_private.admin_users(user_id uuid primary key);
      create table sellerpilot_private.products(id uuid primary key,owner_id uuid,sku text,created_at timestamptz default now(),updated_at timestamptz default now(),on_hand integer not null,reserved integer not null,demo boolean default false,status text default 'active',reorder_point integer default 0,product_facts jsonb default '{}', unique(owner_id,sku));
      create table sellerpilot_private.commerce_orders(id uuid primary key,product_id uuid,demo boolean default false,status text);
      create table sellerpilot_private.operation_audit(id bigint generated always as identity primary key,owner_id uuid,action text,entity_type text,entity_id text,safe_detail jsonb);
      create table sellerpilot_private.channel_operation_attempts(id uuid primary key);
      create table sellerpilot_private.channel_gateway_jobs(id uuid primary key default gen_random_uuid(),listing_id uuid,operation text,status text);
      create table sellerpilot_private.product_listings(id uuid primary key,owner_id uuid,product_id uuid,channel_key text,market text,target_id text,remote_id text,status text,updated_at timestamptz default now());
      insert into auth.users values('${owner}'); insert into sellerpilot_private.admin_users values('${owner}');
      insert into sellerpilot_private.products(id,owner_id,sku,on_hand,reserved) values('${product}','${owner}','TEST-SKU',1,0);
    `);
    await db.exec(original);
    await db.exec(hardened);
    await db.exec(await sql('20260819150000_inventory_sync_ledger.sql'));
    await db.exec(await sql('20260826090600_isolate_inventory_sync_generations.sql'));
    await db.exec(await readFile(new URL('./fixtures/inventory-live-generation-guard.sql', import.meta.url), 'utf8'));
    // Retain the actual product_facts stock trigger without unrelated AI dependencies.
    const facts = await sql('20260825011500_preserve_authoritative_inventory.sql');
    await db.exec(facts.slice(facts.indexOf('create or replace function sellerpilot_private.sync_product_fact_stock()'), facts.indexOf('create or replace function public.sellerpilot_list_registration_activity')));
    await db.exec(bridge);
    return db;
  } catch(e) { await db.close(); throw e; }
}
const proposal = async (db) => (await db.query('select public.sellerpilot_service_inventory_bootstrap_source($1::uuid,$2::uuid,$3) result',[product,owner,'TEST-SKU'])).rows[0].result;
const bootstrap = async (db,p) => (await db.query('select public.sellerpilot_service_bootstrap_product_inventory($1::uuid,$2::uuid,$3,$4,$5::integer,$6::integer) result',[p.productId,p.ownerId,p.sku,p.sourceFingerprint,p.onHand,p.reserved])).rows[0].result;
async function snapshot(db) {
  const result = {};
  for (const table of ['products','inventory_items','inventory_ledger','inventory_reservations','inventory_product_bindings','inventory_sync_runs','inventory_sync_items','channel_gateway_jobs','operation_audit']) result[table]=(await db.query(`select to_jsonb(t) row from sellerpilot_private.${table} t order by to_jsonb(t)::text`)).rows;
  return result;
}
async function rejectsUnchanged(db,fn,pattern) {
  const before=await snapshot(db); await assert.rejects(fn,pattern); assert.deepEqual(await snapshot(db),before);
}

test('exact source bootstrap is opt-in, preserves stock, and replays without appending',async()=>{
 const db=await fixture(); try {
  assert.equal((await db.query('select count(*) n from sellerpilot_private.inventory_items')).rows[0].n,0);
  const p=await proposal(db); assert.equal(p.onHand,1); assert.equal(p.reserved,0);
  assert.equal((await bootstrap(db,p)).replayed,false);
  const before=await snapshot(db); assert.equal((await bootstrap(db,p)).replayed,true); assert.deepEqual(await snapshot(db),before);
  assert.equal(before.inventory_ledger.length,1); assert.equal(before.inventory_reservations.length,0);
 }finally{await db.close();}
});

test('real legacy inventory sync RPC mirrors products and ledger atomically, retaining stock facts and stable retry',async()=>{
 const db=await fixture(); try {
  const p=await proposal(db); await bootstrap(db,p);
  const sync=()=>db.query("select public.sellerpilot_start_inventory_sync($1::uuid,5,'bridge-test-stable-request')",[product]);
  await sync();
  const before=await snapshot(db);
  assert.equal(before.products[0].row.on_hand,5); assert.equal(before.products[0].row.product_facts.stock,5);
  assert.equal(before.inventory_items[0].row.on_hand,5); assert.equal(before.inventory_items[0].row.ledger_seq,2);
  assert.equal(before.inventory_ledger.length,2);
  await sync(); assert.deepEqual(await snapshot(db),before);
  assert.equal((await bootstrap(db,p)).replayed,true); assert.deepEqual(await snapshot(db),before);
  await db.query('update sellerpilot_private.products set on_hand=0 where id=$1::uuid',[product]);
  const zero=await snapshot(db); assert.equal(zero.inventory_items[0].row.on_hand,0); assert.equal(zero.inventory_ledger.length,3);
 }finally{await db.close();}
});

test('source identity, fingerprint, reserved and existing ledger conflicts are fail-closed',async()=>{
 const db=await fixture(); try {
  const p=await proposal(db);
  for(const bad of [{...p,sku:'OTHER'},{...p,ownerId:product},{...p,sourceFingerprint:'a'.repeat(64)},{...p,reserved:1},{...p,onHand:8}]) await rejectsUnchanged(db,()=>bootstrap(db,bad),/INVENTORY_/);
  await db.query('update sellerpilot_private.products set on_hand=2 where id=$1::uuid',[product]);
  await rejectsUnchanged(db,()=>bootstrap(db,p),/SOURCE_CHANGED/);
  const current=await proposal(db);
  await db.query("select public.sellerpilot_inventory_receipt($1::uuid,'TEST-SKU',2,'existing-ledger-stock')",[owner]);
  await rejectsUnchanged(db,()=>bootstrap(db,current),/REQUIRES_RECONCILIATION/);
 }finally{await db.close();}
});

test('bound native receipt/reserve/return/adjust and reserved or identity writes cannot create a second authority',async()=>{
 const db=await fixture(); try {
  await bootstrap(db,await proposal(db));
  for(const query of [
   `select public.sellerpilot_inventory_receipt('${owner}','TEST-SKU',1,'blocked-receipt-key')`,
   `select public.sellerpilot_inventory_reserve('${owner}','TEST-SKU','shopee','ORDER','LINE',1)`,
   `select public.sellerpilot_inventory_return_received('${owner}','TEST-SKU',1,'blocked-return-key')`,
   `select public.sellerpilot_inventory_adjust('TEST-SKU',7,'test','blocked-adjust-key')`,
   `update sellerpilot_private.products set reserved=1 where id='${product}'`,
   `update sellerpilot_private.products set sku='OTHER' where id='${product}'`,
   `update sellerpilot_private.inventory_items set on_hand=9 where product_id='${product}'`,
   `delete from sellerpilot_private.inventory_ledger`,
  ]) await rejectsUnchanged(db,()=>db.exec(query),/INVENTORY_/);
 }finally{await db.close();}
});

test('mirror failure rolls back the original product RPC, sync jobs, audit and fact changes',async()=>{
 const db=await fixture();try {
  await bootstrap(db,await proposal(db));
  await db.exec(`create function sellerpilot_private.reject_test_mirror() returns trigger language plpgsql as $$begin raise exception 'TEST_MIRROR_REJECTED'; end$$; create trigger z_test_reject before insert on sellerpilot_private.inventory_ledger for each row execute function sellerpilot_private.reject_test_mirror();`);
  await rejectsUnchanged(db,()=>db.query("select public.sellerpilot_start_inventory_sync($1::uuid,6,'bridge-failing-request')",[product]),/TEST_MIRROR_REJECTED/);
 }finally{await db.close();}
});

test('only service role can preview/bootstrap; migration does not broaden existing RPC ACL',async()=>{
 const db=await fixture();try {
  const p=await proposal(db);
  for(const role of ['anon','authenticated']) {
   await db.exec(`set role ${role}`);
   await assert.rejects(()=>proposal(db),e=>e.code==='42501'); await assert.rejects(()=>bootstrap(db,p),e=>e.code==='42501');
   await db.exec('reset role');
  }
  await db.exec('set role service_role'); assert.equal((await bootstrap(db,p)).replayed,false);
  await db.exec('reset role');
  const acl=(await db.query("select has_function_privilege('authenticated','public.sellerpilot_inventory_reserve(uuid,text,text,text,text,integer)','EXECUTE') allowed")).rows[0];assert.equal(acl.allowed,false);
 }finally{await db.close();}
});

test('orders needing reconciliation block bootstrap; cancelled order does not fabricate reservations',async()=>{
 const db=await fixture();try {
  await db.exec(`insert into sellerpilot_private.commerce_orders values('30000000-0000-0000-0000-000000000001','${product}',false,'paid')`);
  const p=await proposal(db);
  await rejectsUnchanged(db,()=>bootstrap(db,p),/REQUIRES_RECONCILIATION/);
  await db.exec("update sellerpilot_private.commerce_orders set status='cancelled'");
  assert.equal((await bootstrap(db,p)).replayed,false);
  assert.equal((await snapshot(db)).inventory_reservations.length,0);
 }finally{await db.close();}
});

test('unbound SKUs retain native ledger behavior and bound events cannot be moved to them',async()=>{
 const db=await fixture();try {
  await bootstrap(db,await proposal(db));
  await db.query("select public.sellerpilot_inventory_receipt($1::uuid,'UNBOUND-SKU',3,'unbound-receipt-key')",[owner]);
  await rejectsUnchanged(db,()=>db.exec("update sellerpilot_private.inventory_ledger set item_id=(select id from sellerpilot_private.inventory_items where sku='UNBOUND-SKU') where idempotency_key like 'products-bootstrap:%'"),/INVENTORY_/);
  await db.query("select public.sellerpilot_inventory_reserve($1::uuid,'UNBOUND-SKU','shopee','ORDER','LINE',1)",[owner]);
  const p=(await db.query("select on_hand,reserved from sellerpilot_private.inventory_items where sku='UNBOUND-SKU'")).rows[0];
  assert.deepEqual(p,{on_hand:3,reserved:1});
 }finally{await db.close();}
});

test('pending channel stock generation prevents bootstrap until reconciled',async()=>{
 const db=await fixture();try {
  const p=await proposal(db);
  await db.exec(`insert into sellerpilot_private.inventory_sync_runs(owner_id,product_id,idempotency_key,requested_on_hand,available_quantity) values('${owner}','${product}','preexisting-sync-run',1,1)`);
  await rejectsUnchanged(db,()=>bootstrap(db,p),/REQUIRES_RECONCILIATION/);
 }finally{await db.close();}
});

for (const kind of ['run-reconciliation_required','item-pending','item-running','item-reconciliation_required','gateway-queued','gateway-running','gateway-reconciliation_required']) {
 test(`bootstrap rejects ${kind}, including a state change after source preview`,async()=>{
  const db=await fixture();try {
   const p=await proposal(db);
   const [type,status]=kind.split('-');
   const listing='40000000-0000-0000-0000-000000000001';
   await db.exec(`insert into sellerpilot_private.product_listings(id,owner_id,product_id,channel_key,market,target_id,remote_id,status) values('${listing}','${owner}','${product}','lazada','MY','MY','REMOTE','published')`);
   if(type==='gateway') {
    await db.query("insert into sellerpilot_private.channel_gateway_jobs(listing_id,operation,status) values($1,'inventory.update',$2)",[listing,status]);
   } else {
    const run=(await db.query(`insert into sellerpilot_private.inventory_sync_runs(owner_id,product_id,idempotency_key,requested_on_hand,available_quantity,status) values($1,$2,'reconciliation-fixture',1,1,$3) returning id`,[owner,product,type==='run'?status:'failed'])).rows[0].id;
    if(type==='item') await db.query(`insert into sellerpilot_private.inventory_sync_items(run_id,owner_id,product_id,listing_id,channel,market,target_id,remote_id,requested_quantity,status) values($1,$2,$3,$4,'lazada','MY','MY','REMOTE',1,$5)`,[run,owner,product,listing,status]);
   }
   await rejectsUnchanged(db,()=>bootstrap(db,p),/REQUIRES_RECONCILIATION/);
   if(kind==='item-reconciliation_required'||type==='gateway') {
    await rejectsUnchanged(db,()=>db.query("select public.sellerpilot_start_inventory_sync($1,7,'operational-guard-chain')",[product]),/inventory remote write must complete or reconcile/);
   }
  }finally{await db.close();}
 });
}

test('fixture loads exact current guard and bootstrap retains predicate SHARE locks until commit',async()=>{
 const db=await fixture();try {
  const hash=(await db.query("select md5(prosrc) hash from pg_proc where proname='guard_inventory_write_generation'")).rows[0].hash;
  assert.equal(hash,'67f6f545198ab0a7e1e2e57473cc9e5c');
  const syncHash=(await db.query("select md5(prosrc) hash from pg_proc where proname='sellerpilot_start_inventory_sync'")).rows[0].hash;
  assert.equal(syncHash,'3a17102e3dbb5da80ed8c48447a355b3');
  // PGlite is a single backend: verify the actual parsed lock contract here;
  // this is not a claim of native multi-session concurrency execution.
  const body=(await db.query("select prosrc from pg_proc where proname='sellerpilot_service_bootstrap_product_inventory'")).rows[0].prosrc;
  assert.match(body,/lock table[\s\S]*inventory_sync_runs[\s\S]*inventory_sync_items[\s\S]*channel_gateway_jobs[\s\S]*product_listings[\s\S]*commerce_orders[\s\S]*in share mode nowait/i);
  assert.ok(body.indexOf('for update')<body.indexOf('lock table'));
  assert.ok(body.indexOf('lock table')<body.indexOf('select * into b'));
  const p=await proposal(db);
  await db.exec('begin');
  await bootstrap(db,p);
  const locks=(await db.query(`select c.relname from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace where n.nspname='sellerpilot_private' and l.mode='ShareLock' and l.granted order by c.relname`)).rows.map(x=>x.relname);
  assert.deepEqual(locks,['channel_gateway_jobs','commerce_orders','inventory_sync_items','inventory_sync_runs','product_listings']);
  await db.exec('commit');
 }finally{await db.close();}
});

test('a clean bootstrap replay cannot bypass newly reopened reconciliation',async()=>{
 const db=await fixture();try {
  const p=await proposal(db);await bootstrap(db,p);
  await db.exec(`insert into sellerpilot_private.inventory_sync_runs(owner_id,product_id,idempotency_key,requested_on_hand,available_quantity,status) values('${owner}','${product}','reopened-generation',1,1,'reconciliation_required')`);
  await rejectsUnchanged(db,()=>bootstrap(db,p),/REQUIRES_RECONCILIATION/);
 }finally{await db.close();}
});

test('migration refuses an absent or disabled operational generation guard',async()=>{
 const db=await fixture();try {
  const preimage=bridge.match(/do \$operational_guard_preimage\$[\s\S]*?\$operational_guard_preimage\$;/)?.[0];assert.ok(preimage);
  await db.exec('alter table sellerpilot_private.inventory_sync_runs disable trigger guard_inventory_write_generation');
  await assert.rejects(()=>db.exec(preimage),/OPERATIONAL_GUARD_PREIMAGE_MISMATCH/);
  await db.exec('drop trigger guard_inventory_write_generation on sellerpilot_private.inventory_sync_runs;drop function sellerpilot_private.guard_inventory_write_generation()');
  await assert.rejects(()=>db.exec(preimage),/OPERATIONAL_GUARD_PREIMAGE_MISMATCH/);
 }finally{await db.close();}
});

const productResourceWrites = ['listing.create','listing.update','listing.stop','listing.activate','price.update','inventory.update'];
for (const operation of productResourceWrites) {
 test(`bootstrap blocks every unresolved ${operation} generation on its listing`,async()=>{
  const db=await fixture();try {
   const p=await proposal(db);
   const listing='40000000-0000-0000-0000-000000000011';
   // Draft/zero-remote create rows must remain protected too; no published filter.
   await db.query(`insert into sellerpilot_private.product_listings(id,owner_id,product_id,channel_key,market,target_id,remote_id,status) values($1,$2,$3,'lazada','MY','MY','','draft')`,[listing,owner,product]);
   for(const status of ['queued','running','reconciliation_required']) {
    const job=(await db.query('insert into sellerpilot_private.channel_gateway_jobs(listing_id,operation,status) values($1,$2,$3) returning id',[listing,operation,status])).rows[0].id;
    await rejectsUnchanged(db,()=>bootstrap(db,p),/REQUIRES_RECONCILIATION/);
    await db.query('delete from sellerpilot_private.channel_gateway_jobs where id=$1',[job]);
   }
   assert.equal((await bootstrap(db,p)).replayed,false);
   // A bound replay must apply the same source-resource fence.
   await db.query("insert into sellerpilot_private.channel_gateway_jobs(listing_id,operation,status) values($1,$2,'reconciliation_required')",[listing,operation]);
   await rejectsUnchanged(db,()=>bootstrap(db,p),/REQUIRES_RECONCILIATION/);
  }finally{await db.close();}
 });
}

test('read-only jobs, terminal writes and other-product jobs do not fail bootstrap eligibility',async()=>{
 const db=await fixture();try {
  const p=await proposal(db);
  const other='20000000-0000-0000-0000-000000000022';
  const localListing='40000000-0000-0000-0000-000000000021',otherListing='40000000-0000-0000-0000-000000000022';
  await db.query(`insert into sellerpilot_private.products(id,owner_id,sku,on_hand,reserved) values($1,$2,'OTHER-SKU',3,0)`,[other,owner]);
  for(const [id,pid] of [[localListing,product],[otherListing,other]]) await db.query(`insert into sellerpilot_private.product_listings(id,owner_id,product_id,channel_key,market,target_id,remote_id,status) values($1,$2,$3,'lazada','MY','MY','REMOTE','published')`,[id,owner,pid]);
  for(const status of ['queued','running','reconciliation_required']) {
   for(const operation of ['listing.publication.verify','orders.get','categories.list']) await db.query('insert into sellerpilot_private.channel_gateway_jobs(listing_id,operation,status) values($1,$2,$3)',[localListing,operation,status]);
   for(const operation of productResourceWrites) await db.query('insert into sellerpilot_private.channel_gateway_jobs(listing_id,operation,status) values($1,$2,$3)',[otherListing,operation,status]);
  }
  for(const operation of productResourceWrites) for(const status of ['succeeded','failed']) await db.query('insert into sellerpilot_private.channel_gateway_jobs(listing_id,operation,status) values($1,$2,$3)',[localListing,operation,status]);
  const jobsBefore=(await db.query('select * from sellerpilot_private.channel_gateway_jobs order by id')).rows;
  assert.equal((await bootstrap(db,p)).replayed,false);
  assert.equal((await bootstrap(db,p)).replayed,true);
  assert.deepEqual((await db.query('select * from sellerpilot_private.channel_gateway_jobs order by id')).rows,jobsBefore);
 }finally{await db.close();}
});

test('bootstrap operation fence exactly covers current source-defined product-resource writes',async()=>{
 const operationSource=await readFile(new URL('../lib/channels/operations.ts',import.meta.url),'utf8');
 const names=operationSource.match(/export const channelOperationNames = \[([\s\S]*?)\] as const/)?.[1];
 const writes=operationSource.match(/export const writeChannelOperations = new Set<ChannelOperationName>\(\[([\s\S]*?)\]\)/)?.[1];
 assert.ok(names);assert.ok(writes);
 const literals=value=>[...value.matchAll(/"([a-z.]+)"/g)].map(x=>x[1]);
 const sourceProductWrites=literals(writes).filter(x=>/^(listing|price|inventory)\./.test(x));
 assert.deepEqual(sourceProductWrites,productResourceWrites);
 assert.ok(productResourceWrites.every(x=>literals(names).includes(x)));
 const sqlOperations=bridge.match(/j\.operation in \(([\s\S]*?)\)/)?.[1];assert.ok(sqlOperations);
 assert.deepEqual([...sqlOperations.matchAll(/'([a-z.]+)'/g)].map(x=>x[1]),productResourceWrites);
 // The Lazada field contract explicitly routes inventory edits through listing.update.
 const editSource=await readFile(new URL('../lib/channels/listing-update.ts',import.meta.url),'utf8');
 assert.match(editSource,/inventory: fieldSupport\("supported", "listing.update", \["request.Request.Product.Skus.Sku\[\].quantity"\]/);
});
