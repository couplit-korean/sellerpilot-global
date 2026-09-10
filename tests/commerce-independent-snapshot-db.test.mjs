import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const source = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = await source('20260908171055_isolate_commerce_workspace_snapshot.sql');
const owner = '00000000-0000-4000-8000-000000000001';
const admin = '00000000-0000-4000-8000-000000000002';
const product = '00000000-0000-4000-8000-000000000101';
const job = '00000000-0000-4000-8000-000000000201';
async function fixture() {
 const db = new PGlite();
 await db.exec(`
 create role anon; create role authenticated;
 create schema auth; create schema sellerpilot_private;
 create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 create function public.sellerpilot_is_admin() returns boolean language sql stable as 'select auth.uid() in (''${owner}''::uuid,''${admin}''::uuid)';
 create table sellerpilot_private.channels(key text,code text,name text,market text,color text,status text,sort_order int);
 create table sellerpilot_private.channel_credentials(channel text,environment text,status text,expires_at timestamptz,version int,last_check_status text);
 create table sellerpilot_private.products(id uuid,owner_id uuid,external_code text,sku text,name text,description text,source_url text,image_url text,ai_job_id uuid,status text,on_hand int,reserved int,cost_krw numeric,reorder_point int,demo boolean default false,updated_at timestamptz);
 create table sellerpilot_private.ai_cli_jobs(id uuid,status text,result_payload jsonb);
 create table sellerpilot_private.product_listings(id uuid,product_id uuid,owner_id uuid,channel_key text,market text,status text,failure_class text,last_error text,sold_30d int,revenue_30d_krw numeric,updated_at timestamptz);
 create table sellerpilot_private.commerce_orders(id uuid,external_order_id text,channel_key text,customer_name text,product_id uuid,product_name text,quantity int,amount numeric,currency text,amount_krw numeric,status text,ordered_at timestamptz,shipped_at timestamptz,delivered_at timestamptz,last_seen_at timestamptz,carrier_code text,shipping_carrier text,tracking_number text,settlement_status text,settlement_amount numeric,settlement_currency text,settled_at timestamptz,settlement_rate_krw numeric,reference_rate_krw numeric,updated_at timestamptz,demo boolean default false);
 create table sellerpilot_private.channel_operation_attempts(channel text,operation text,status text,started_at timestamptz);
 insert into sellerpilot_private.channels values ('elevenst','11','11st','KR','#fff','active',1);
 insert into sellerpilot_private.channel_credentials values ('elevenst','production','active',null,1,'passed');
 insert into sellerpilot_private.ai_cli_jobs values ('${job}','succeeded','{"hero_storage_path":"fixture/hero.png"}');
 insert into sellerpilot_private.products values ('${product}','${owner}','SP1','SKU1','Fixture product','Description',null,null,'${job}','active',8,6,10000,3,false,now());
 insert into sellerpilot_private.product_listings values ('00000000-0000-4000-8000-000000000301','${product}','${owner}','elevenst','KR','published',null,null,99,99999,now());
 insert into sellerpilot_private.commerce_orders(id,external_order_id,channel_key,customer_name,product_id,product_name,quantity,amount,currency,amount_krw,status,ordered_at,last_seen_at,shipping_carrier,tracking_number,settlement_status,settlement_amount,settlement_currency,settlement_rate_krw,reference_rate_krw,updated_at)
 values ('00000000-0000-4000-8000-000000000401','remote-order','elevenst','Fixture customer','${product}','Fixture product',2,40000,'KRW',40000,'ready_to_ship',now(),now(),'CJ','fixture-tracking','expected',39000,'KRW',97,100,now());
 insert into sellerpilot_private.channel_operation_attempts values ('elevenst','listing.create','succeeded',now()-interval '1 hour'),('elevenst','inquiries.list','failed',now());
 `);
 await db.exec(migration);
 return db;
}
test('Commerce snapshot runs without any CS tables or functions and preserves shared-admin sales, stock, asset and settlement facts', async () => {
 const db = await fixture();
 try {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}';`);
  const value = (await db.query('select public.sellerpilot_get_commerce_snapshot() value')).rows[0].value;
  assert.equal(value.contract,'sellerpilot-commerce-snapshot/1');
  assert.equal(value.products.length,1);
  assert.equal(value.products[0].available,2);
  assert.equal(value.products[0].status,'low_stock');
  assert.equal(value.products[0].aiHeroPath,'fixture/hero.png');
  assert.equal(value.products[0].sold30d,2);
  assert.equal(value.products[0].revenue30dKrw,40000);
  assert.deepEqual(value.products[0].listingChannels,['11']);
  assert.equal(value.summary.sold30d,2);
  assert.equal(value.summary.settlementRiskCount,1);
  assert.equal(value.orders[0].carrierCode,'CJ');
  assert.equal(value.orders[0].trackingNumber,'fixture-tracking');
  assert.equal(value.orders[0].exchangeLossPercent,3);
  assert.equal(value.channelMetrics[0].failedAttemptCount,0);
  assert.ok(Date.parse(value.generatedAt)-Date.parse(value.channelMetrics[0].lastOperationAt)>3500000);
  assert.equal('tickets' in value,false);
  assert.equal('openTicketCount' in value.summary,false);
 } finally { await db.close(); }
});
test('Commerce RPC denies anon and non-admin sessions',async()=>{
 const db = await fixture();
 try {
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.sellerpilot_get_commerce_snapshot()'),/permission denied/);
  await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");
  await assert.rejects(db.query('select public.sellerpilot_get_commerce_snapshot()'),/administrator access required/);
 } finally { await db.close(); }
});
