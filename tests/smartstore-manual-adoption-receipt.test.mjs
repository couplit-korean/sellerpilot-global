import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Isolated SQL contract tests only. Production request/response preimages are
// NOT copied into tests. Only the two pinned payload hashes are replaced with
// hashes computed by PostgreSQL for this explicit synthetic fixture.
const migration = await readFile(new URL('../supabase/migrations/20260907103000_exact_smartstore_manual_adoption_receipt.sql', import.meta.url), 'utf8');
const owner = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c';
const product = '1ed4acfc-7603-48ec-a638-241131e59358';
const listing = '7b260562-1e41-4ddc-8509-cb78dc7292c5';
const job = '66147e5d-0479-4c51-896e-97e782af99e1';
const attempt = '0d2c492e-2025-4717-bb3f-0fd2b886fd4f';
const credential = '2aa76829-3d63-4842-9c3e-622acd3d0d2f';
const account = 'a'.repeat(64);
const fingerprint = '7ca96928ee67fa1285c74754ec65ca45807861836afa23c34bec17c52a8aabea';
const request = { arguments: { publicationIntent: 'live', sellerpilotExternalDetail: { productId: product }, body: { originProduct: { detailAttribute: { sellerCodeInfo: { sellerManagementCode: 'AUTO-780720401E2D4E4EA45F' } } } } } };
const response = { ok: false, channel: 'smartstore', operation: 'listing.create', steps: [
  { name: 'listing-image-upload', ok: true, status: 200, data: { sellerpilotMutation: 'accepted' } },
  { name: 'product-create', ok: false, status: 400, data: { code: 'BAD_REQUEST', invalidInputs: [{ name: 'originProduct.detailAttribute.unitCapacity.unitPriceYn', type: 'Required.product.unitPriceYn' }] } },
] };

function observation() { return {
  contract: 'smartstore_manual_sale_observation_v1', profileName: 'CHANGHEE', sellerAccountKey: account,
  originProductNo: '13688607602', channelProductNo: '13749310594', sellerSku: 'AUTO-780720401E2D4E4EA45F',
  publicUrl: 'https://smartstore.naver.com/coupletseoul/products/13749310594', sellingState: '판매중',
  currency: 'KRW', price: 3190, stock: 10, userApproved: true, purchaseAvailable: true,
  approvedAt: new Date(Date.now() - 120000).toISOString(), observedAt: new Date(Date.now() - 60000).toISOString(),
  approvalEvidenceSha256: 'b'.repeat(64), sellerCenterEvidenceSha256: 'c'.repeat(64), publicEvidenceSha256: 'd'.repeat(64),
}; }
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$ select auth.uid()='${owner}'::uuid $$;
    create table sellerpilot_private.products(id uuid primary key,owner_id uuid,sku text,status text,demo boolean,updated_at timestamptz,product_facts jsonb);
    create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid,channel text,environment text,status text,version int,expires_at timestamptz,seller_account_key text);
    create table sellerpilot_private.channel_operation_attempts(id uuid primary key,owner_id uuid,credential_id uuid,channel text,operation text,status text,http_status int,remote_id text,pre_gateway_retryable boolean,request_fingerprint text,seller_account_key text);
    create table sellerpilot_private.product_listings(id uuid primary key,owner_id uuid,product_id uuid,channel_key text,status text,failure_class text,remote_visibility text,remote_id text,published_at timestamptz,provider_status text,operation_attempt_id uuid,requested_publication_intent text,seller_account_key text);
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,attempt_id uuid,listing_id uuid,credential_id uuid,created_by uuid,channel text,environment text,operation text,status text,attempt_count int,provider_mutation_started_at timestamptz,completed_at timestamptz,request_payload jsonb,response_payload jsonb,request_fingerprint text,seller_account_key text);
    insert into sellerpilot_private.products values('${product}','${owner}','AUTO-780720401E2D4E4EA45F','active',false,'2026-09-06T13:08:23.846181Z','{"unchanged":true}');
    insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','smartstore','production','active',1,null,'${account}');
    insert into sellerpilot_private.channel_operation_attempts values('${attempt}','${owner}','${credential}','smartstore','listing.create','manual_required',409,null,false,'${fingerprint}','${account}');
    insert into sellerpilot_private.product_listings values('${listing}','${owner}','${product}','smartstore','failed','external_action','unknown',null,null,null,'${attempt}','live','${account}');
    select set_config('request.jwt.claim.sub','${owner}',false);
  `);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,$3,$4,$5,'smartstore','production','listing.create','reconciliation_required',1,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '119 minutes',$6,$7,$8,$9)`, [job, attempt, listing, credential, owner, JSON.stringify(request), JSON.stringify(response), fingerprint, account]);
  const hashes = (await db.query(`select encode(sha256(convert_to(request_payload::text,'UTF8')),'hex') request_hash,encode(sha256(convert_to(response_payload::text,'UTF8')),'hex') response_hash from sellerpilot_private.channel_gateway_jobs`)).rows[0];
  const sql = migration.replaceAll('d4c2d09c56eceed36b63bc984b17efd2d42c1d412e4a098d15b91dcafad896d1', hashes.request_hash)
    .replaceAll('bd22dc02ef6daa4b513565c6fe9a247cd98f1f55d1e9eabb2dcc7f9e1e98cbbf', hashes.response_hash);
  await db.exec(sql);
  return db;
}
const record = async (db, value = observation()) => (await db.query('select public.sellerpilot_record_exact_smartstore_manual_adoption($1::jsonb) result', [JSON.stringify(value)])).rows[0].result;
async function snapshots(db) {
  const out = {};
  for (const table of ['channel_gateway_jobs', 'channel_operation_attempts', 'product_listings', 'products', 'channel_credentials']) out[table] = (await db.query(`select to_jsonb(t) row from sellerpilot_private.${table} t order by id`)).rows;
  return out;
}
async function count(db) { return Number((await db.query('select count(*) n from sellerpilot_private.smartstore_manual_adoption_receipts')).rows[0].n); }

test('installation does not record adoption; authenticated receipt preserves all original rows and is idempotent', async () => {
  const db = await fixture();
  try {
    assert.equal(await count(db), 0);
    const before = await snapshots(db), obs = observation();
    await db.exec('set role authenticated');
    const result = await record(db, obs);
    assert.equal(result.apiCreateSucceeded, false); assert.equal(result.sourcePreserved, true);
    assert.equal(result.createBlocked, true); assert.equal(result.contentVerified, false);
    const again = await record(db, obs); assert.equal(again.reused, true); assert.equal(again.receiptId, result.receiptId);
    const read = (await db.query('select public.sellerpilot_get_exact_smartstore_manual_adoption($1) result', [product])).rows[0].result;
    assert.equal(read.originProductNo, '13688607602'); assert.equal(read.channelProductNo, '13749310594');
    await db.exec('reset role');
    assert.equal(await count(db), 1); assert.deepEqual(await snapshots(db), before);
    await assert.rejects(() => record(db, { ...obs, stock: 11 }), /RECEIPT_CONFLICT/);
    assert.equal(await count(db), 1);
  } finally { await db.close(); }
});

test('source snapshot replay is stable across caller timezones', async () => {
  const db = await fixture();
  try {
    const obs = observation();
    await db.query('select set_config($1,$2,false)', ['timezone', 'Asia/Seoul']);
    const first = await record(db, obs);
    await db.query('select set_config($1,$2,false)', ['timezone', 'America/New_York']);
    const replay = await record(db, obs);
    assert.equal(replay.reused, true);
    assert.equal(replay.receiptId, first.receiptId);
    assert.equal(await count(db), 1);
  } finally { await db.close(); }
});

for (const [label, change, expected] of [
  ['wrong owner', db => db.exec("select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)"), /OWNER_REQUIRED/],
  ['credential drift', db => db.exec('update sellerpilot_private.channel_credentials set version=2'), /TUPLE_DRIFT/],
  ['seller account drift', db => db.exec("update sellerpilot_private.channel_credentials set seller_account_key=repeat('e',64)"), /TUPLE_DRIFT/],
  ['request drift', db => db.exec("update sellerpilot_private.channel_gateway_jobs set request_payload=request_payload||'{\"tampered\":true}'::jsonb"), /TUPLE_DRIFT/],
  ['response drift', db => db.exec("update sellerpilot_private.channel_gateway_jobs set response_payload='{}'"), /TUPLE_DRIFT/],
  ['existing remote ID', db => db.exec("update sellerpilot_private.product_listings set remote_id='13688607602'"), /TUPLE_DRIFT/],
  ['attempt no longer manual', db => db.exec("update sellerpilot_private.channel_operation_attempts set status='succeeded'"), /TUPLE_DRIFT/],
  ['null product eligibility', db => db.exec('update sellerpilot_private.products set demo=null,status=null'), /TUPLE_DRIFT/],
  ['competing mutation', db => db.exec(`insert into sellerpilot_private.channel_gateway_jobs(id,listing_id,channel,operation,status)values(gen_random_uuid(),'${listing}','smartstore','inventory.update','running')`), /COMPETING/],
]) test(`fails closed for ${label}`, async () => {
  const db = await fixture(); try { await change(db); const before = await snapshots(db); await assert.rejects(() => record(db), expected); assert.equal(await count(db),0); assert.deepEqual(await snapshots(db),before); } finally { await db.close(); }
});

for (const [label, change] of [
  ['SKU', o => { o.sellerSku='OTHER'; }],
  ['origin and channel numbers swapped', o => { [o.originProductNo,o.channelProductNo]=[o.channelProductNo,o.originProductNo]; }],
  ['wrong profile', o => { o.profileName='JEONGHUN'; }],
  ['missing approval', o => { o.userApproved=false; }],
  ['string approval', o => { o.userApproved='true'; }],
  ['stale observation', o => { o.observedAt=new Date(Date.now()-3600000).toISOString();o.approvedAt=new Date(Date.now()-3700000).toISOString(); }],
  ['extra content claim', o => { o.contentVerified=true; }],
  ['missing evidence digest', o => { delete o.publicEvidenceSha256; }],
]) test(`rejects observation ${label}`, async () => {
  const db = await fixture(); try { const value=observation();change(value);const before=await snapshots(db);await assert.rejects(()=>record(db,value), /SMARTSTORE_MANUAL/);assert.equal(await count(db),0);assert.deepEqual(await snapshots(db),before); } finally { await db.close(); }
});

test('receipt cannot be updated/deleted or written directly by authenticated role', async () => {
  const db=await fixture();try { await record(db);await assert.rejects(()=>db.exec('update sellerpilot_private.smartstore_manual_adoption_receipts set recorded_at=clock_timestamp()'),/IMMUTABLE/);await assert.rejects(()=>db.exec('delete from sellerpilot_private.smartstore_manual_adoption_receipts'),/IMMUTABLE/);await db.exec('set role authenticated');await assert.rejects(()=>db.exec('select * from sellerpilot_private.smartstore_manual_adoption_receipts'),/permission denied/);await db.exec('reset role');assert.equal(await count(db),1); }finally{await db.close();}
});

test('anonymous and service roles cannot invoke authenticated recording; changed historical rows prevent false preserved report', async () => {
  const db=await fixture();try {
    for(const role of ['anon','service_role']) {await db.exec(`set role ${role}`);await assert.rejects(()=>record(db),/permission denied/);await db.exec('reset role');}
    const obs=observation();await record(db,obs);
    await db.exec("update sellerpilot_private.channel_operation_attempts set http_status=500");
    await assert.rejects(()=>record(db,obs),/RECORDED_SOURCE_DRIFT/);assert.equal(await count(db),1);
  }finally{await db.close();}
});

test('DB create fence blocks same listing/product/SKU and preserves source; unrelated channels and read operations remain allowed', async () => {
  const db=await fixture();try {
    await record(db);const before=await snapshots(db);
    await assert.rejects(()=>db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,listing_id,channel,operation,status)values(gen_random_uuid(),$1,'smartstore','listing.create','queued')`,[listing]),/REMOTE_ALREADY_EXISTS/);
    await assert.rejects(()=>db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,operation,status,request_payload)values(gen_random_uuid(),$1,'smartstore','listing.create','queued',$2)`,[credential,JSON.stringify(request)]),/REMOTE_ALREADY_EXISTS/);
    await assert.rejects(()=>db.exec(`update sellerpilot_private.channel_gateway_jobs set status='queued' where id='${job}'`),/REMOTE_ALREADY_EXISTS/);
    assert.deepEqual(await snapshots(db),before);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,listing_id,channel,operation,status)values(gen_random_uuid(),$1,'smartstore','orders.list','queued')`,[listing]);
    await assert.rejects(()=>db.exec("update sellerpilot_private.channel_gateway_jobs set operation='listing.create' where operation='orders.list'"),/REMOTE_ALREADY_EXISTS/);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,listing_id,channel,operation,status)values(gen_random_uuid(),$1,'coupang','listing.create','queued')`,[listing]);
    assert.equal(await count(db),1);
  }finally{await db.close();}
});
