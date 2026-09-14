import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const migration = await readFile(new URL(
  '../supabase/migrations/20260914182000_ebay_narangd_reconciliation_release_resolution.sql',
  import.meta.url,
), 'utf8');
const sourceId = '81f79abf-ed3f-44cd-a445-fe76e2dcba65';
const otherId = '11111111-1111-4111-8111-111111111111';
const listingId = 'b66bdb38-a9e2-4883-a147-5122659eec88';
const attemptId = '51ccc22f-36d3-4032-9125-d712cdb59f46';
const productId = 'c0bdb493-6447-41bf-af0a-46a3da7a75a8';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, status text, channel text, operation text,
      provider_mutation_started_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key, owner_id uuid, status text, channel text, operation text
    );
    create table sellerpilot_private.products(id uuid primary key, owner_id uuid, sku text, value text);
    create table sellerpilot_private.product_listings(
      id uuid primary key, product_id uuid, owner_id uuid, operation_attempt_id uuid,
      channel_key text, status text, remote_id text, marketplace_sku text,
      provider_resource_id text, seller_account_key text,
      remote_visibility text, provider_status text, failure_class text,
      remote_resources jsonb
    );
    create table sellerpilot_private.ebay_narangd_offer_repair_receipts(
      id uuid primary key, listing_id uuid, product_id uuid, source_job_id uuid,
      source_attempt_id uuid, seller_account_key text, remote_listing_id text,
      offer_id text, marketplace_sku text, marketplace_id text,
      offer_status text, listing_status text, inventory_put_status int,
      publish_status int, inventory_readback_status int, offer_readback_status int,
      verified_receipt_digest text, receipt_file_sha256 text,
      provider_mutation_performed boolean, buyer_visible_verified boolean,
      source_job_before jsonb, source_attempt_before jsonb, product_before jsonb,
      expected_resources jsonb
    );
    create function sellerpilot_private.ebay_narangd_offer_repair_remote_resources(uuid)
      returns jsonb language sql stable as $$
        select expected_resources from sellerpilot_private.ebay_narangd_offer_repair_receipts where id=$1
      $$;
    create function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
      returns boolean language sql stable as $$select $1='${otherId}'::uuid$$;
    insert into sellerpilot_private.channel_gateway_jobs values
      ('${sourceId}','reconciliation_required','ebay','listing.create',now()),
      ('${otherId}','reconciliation_required','smartstore','listing.create',now());
    insert into sellerpilot_private.channel_operation_attempts values
      ('${attemptId}','768ce4ac-0ef2-4e01-89dc-05aa4fa8543c','manual_required','ebay','listing.create');
    insert into sellerpilot_private.products values(
      '${productId}','768ce4ac-0ef2-4e01-89dc-05aa4fa8543c','AUTO-00BF58A2E8434FF09667','unchanged'
    );
  `);
  const resources = {contract: 'ebay_narangd_offer_repair_receipt_v1', resources: {
    listingId: '800659240462', offerId: '265437447011', sku: 'AUTO-00BF58A2E8434FF09667-US', marketplaceId: 'EBAY_US',
  }};
  await db.query(`insert into sellerpilot_private.product_listings values(
    $1,$2,'768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',$3,'ebay','published','800659240462','AUTO-00BF58A2E8434FF09667-US',
    '265437447011',repeat('c',64),'live','ACTIVE',null,$4)`, [listingId, productId, attemptId, resources]);
  const snapshots = (await db.query(`select
    (select to_jsonb(x) from sellerpilot_private.channel_gateway_jobs x where id=$1) job,
    (select to_jsonb(x) from sellerpilot_private.channel_operation_attempts x) attempt,
    (select to_jsonb(x) from sellerpilot_private.products x) product`, [sourceId])).rows[0];
  await db.query(`insert into sellerpilot_private.ebay_narangd_offer_repair_receipts values(
    gen_random_uuid(),$1,$2,$3,$4,repeat('c',64),'800659240462','265437447011',
    'AUTO-00BF58A2E8434FF09667-US','EBAY_US','PUBLISHED','ACTIVE',204,200,200,200,
    '2267faf785338ba10317e11565076cbe347cebb324d44ceb3cde272de5421fb8',
    '2a5d145af53f26299e7837ee01da0815a27d11349d3aa0abd0eda4ea4bad1b2a',
    true,false,$5,$6,$7,$8)`, [listingId, productId, sourceId, attemptId,
    snapshots.job, snapshots.attempt, snapshots.product, resources]);
  const resolverHash = (await db.query(`select md5(prosrc) h from pg_proc
    where oid='sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure`)).rows[0].h;
  await db.exec(migration.replace('36929a92795ac77eac6984c76fa762de', resolverHash));
  return db;
}

test('verified eBay receipt removes only source 81f from the standard unresolved count', async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) ok`, [sourceId])).rows[0].ok, true);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) ok`, [otherId])).rows[0].ok, true);
    const unsafe = (await db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs job
      where job.status='reconciliation_required'
        and not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)`)).rows[0].n;
    assert.equal(unsafe, 0);
    await db.exec(`update sellerpilot_private.products set value='authorized one-day shipping edit';
      update sellerpilot_private.product_listings
         set status='paused',provider_status='UPDATED',remote_visibility='non_public',
             failure_class='later_state',remote_resources='{"later":"verified"}'::jsonb`);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) ok`, [sourceId])).rows[0].ok, true);
    await db.exec('begin');
    await db.query(`update sellerpilot_private.product_listings set remote_id='wrong' where id=$1`, [listingId]);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) ok`, [sourceId])).rows[0].ok, false);
    await db.exec('rollback');
    await db.exec('begin');
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='succeeded' where id=$1`, [sourceId]);
    assert.equal((await db.query(`select sellerpilot_private.listing_mutation_reconciliation_resolved($1) ok`, [sourceId])).rows[0].ok, false);
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('release wrapper is read-only, exact and preserves the predecessor result', () => {
  assert.match(migration, /listing_mutation_reconciliation_resolved_before_ebay_narangd_repair/);
  assert.match(migration, new RegExp(sourceId));
  assert.doesNotMatch(migration, /update\s|delete\s+from|insert\s+into/i);
  assert.doesNotMatch(migration, /session_replication_role|disable trigger/i);
});
