import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const migration = await readFile(new URL(
  '../supabase/migrations/20260914180000_ebay_narangd_verified_offer_repair_lineage.sql',
  import.meta.url,
), 'utf8');

const id = {
  listing: 'b66bdb38-a9e2-4883-a147-5122659eec88',
  product: 'c0bdb493-6447-41bf-af0a-46a3da7a75a8',
  job: '81f79abf-ed3f-44cd-a445-fe76e2dcba65',
  attempt: '51ccc22f-36d3-4032-9125-d712cdb59f46',
  sourceCredential: '2843e4d5-200f-46b9-b4c8-b38489c7787c',
  activeCredential: '374cd5d4-89dc-402b-bed4-067d4dbbe836',
  owner: '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
  jobCreator: '21eb1892-0894-4f9f-b414-4c9464182dd6',
  credentialCreator: '11111111-1111-4111-8111-111111111111',
};
const sellerKey = 'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f';
const verifiedDigest = '2267faf785338ba10317e11565076cbe347cebb324d44ceb3cde272de5421fb8';
const fileDigest = '2a5d145af53f26299e7837ee01da0815a27d11349d3aa0abd0eda4ea4bad1b2a';

async function setup({missingAdmin = null, listingPatch = ''} = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.products(
      id uuid primary key, owner_id uuid not null, sku text, updated_at timestamptz
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid, channel text, environment text,
      status text, expires_at timestamptz, seller_account_key text,
      seller_account_key_source text, seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key, owner_id uuid, credential_id uuid, channel text,
      operation text, status text, remote_id text, request_fingerprint text,
      seller_account_key text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid, attempt_id uuid, listing_id uuid,
      channel text, operation text, environment text, status text,
      provider_mutation_started_at timestamptz, seller_account_key text,
      request_fingerprint text, request_payload jsonb, response_payload jsonb,
      created_by uuid, updated_at timestamptz, completed_at timestamptz
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key, product_id uuid, owner_id uuid, channel_key text,
      status text, remote_id text, market text, target_id text,
      marketplace_sku text, provider_resource_id text, remote_resources jsonb,
      remote_visibility text, provider_status text, published_at timestamptz,
      last_verified_at timestamptz, last_error text, failure_class text,
      seller_account_key text, requested_publication_intent text,
      operation_attempt_id uuid, public_url text, remote_created_at timestamptz,
      currency text, price numeric, updated_at timestamptz
    );
    create table sellerpilot_private.provider_listing_lineage_attestations(listing_id uuid);
    create table sellerpilot_private.operation_audit(
      owner_id uuid, action text, entity_type text, entity_id text, safe_detail jsonb
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
      returns boolean language sql as $$select true$$;
    create function sellerpilot_private.guard_immutable_ebay_offer_identity()
      returns trigger language plpgsql as $$begin raise exception 'baseline immutable guard'; end$$;
    create function sellerpilot_private.guard_product_listing_seller_lineage()
      returns trigger language plpgsql as $$begin raise exception 'baseline lineage guard'; end$$;
    create function sellerpilot_private.guard_verified_ebay_listing_sku_recovery()
      returns trigger language plpgsql as $$begin raise exception 'baseline sku guard'; end$$;
    create trigger guard_immutable_ebay_offer_identity before update on sellerpilot_private.product_listings
      for each row execute function sellerpilot_private.guard_immutable_ebay_offer_identity();
    create trigger guard_product_listing_seller_lineage before update on sellerpilot_private.product_listings
      for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();
    create trigger guard_verified_ebay_listing_sku_recovery before update on sellerpilot_private.product_listings
      for each row execute function sellerpilot_private.guard_verified_ebay_listing_sku_recovery();
    insert into sellerpilot_private.products values(
      '${id.product}','${id.owner}','AUTO-00BF58A2E8434FF09667','2026-09-14T06:23:40.356589Z'
    );
    insert into sellerpilot_private.channel_credentials values
      ('${id.sourceCredential}','${id.jobCreator}','ebay','production','revoked',
       '2028-03-13T16:44:15.612Z','${sellerKey}','provider_certified_v1','2026-09-14T04:34:28Z'),
      ('${id.activeCredential}','${id.credentialCreator}','ebay','production','active',
       '2028-03-13T16:44:15.612Z','${sellerKey}','provider_certified_v1','2026-09-14T06:29:44Z');
    insert into sellerpilot_private.channel_operation_attempts values(
      '${id.attempt}','${id.owner}','${id.sourceCredential}','ebay','listing.create',
      'manual_required','265437447011',repeat('f',64),'${sellerKey}'
    );
    insert into sellerpilot_private.product_listings values(
      '${id.listing}','${id.product}','${id.owner}','ebay','failed','265437447011',
      'US','EBAY_US',null,null,'{}','unknown',null,null,null,
      'manual review','external_action',null,'live','${id.attempt}',null,null,
      'USD',2.25,'2026-09-14T06:23:40.35063Z'
    );
  `);
  const steps = [
    {name: 'listing-create-configuration-preflight', ok: true, status: 200},
    {name: 'inventory-create-lineage-preflight', ok: true, status: 404},
    {name: 'offer-create-lineage-preflight', ok: true, status: 404},
    {name: 'inventory-item', ok: true, status: 204},
    {name: 'inventory-image-readback', ok: true, status: 200, data: {sku: 'AUTO-00BF58A2E8434FF09667-US'}},
    {name: 'offer', ok: true, status: 201, data: {offerId: '265437447011'}},
    {name: 'offer-detail-image-readback', ok: true, status: 200,
      data: {offerId: '265437447011', sku: 'AUTO-00BF58A2E8434FF09667-US', status: 'UNPUBLISHED'}},
    {name: 'publish', ok: false, status: 400,
      data: {errors: [{errorId: 25002, domain: 'API_INVENTORY'}]}},
  ];
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values(
    $1,$2,$3,$4,'ebay','listing.create','production','reconciliation_required',
    now(),$5,repeat('f',64),$6,$7,$8,now(),now())`, [
    id.job, id.sourceCredential, id.attempt, id.listing, sellerKey,
    {arguments: {sku: 'AUTO-00BF58A2E8434FF09667-US', offer: {marketplaceId: 'EBAY_US', categoryId: '179188'}}},
    {ok: false, steps}, id.jobCreator,
  ]);
  for (const admin of [id.owner, id.jobCreator, id.credentialCreator]) {
    if (admin !== missingAdmin) await db.query('insert into sellerpilot_private.admin_users values($1)', [admin]);
  }
  if (listingPatch) await db.exec(`alter table sellerpilot_private.product_listings disable trigger all; ${listingPatch}; alter table sellerpilot_private.product_listings enable trigger all;`);
  const hashes = (await db.query(`select
    md5((select to_jsonb(x)::text from sellerpilot_private.product_listings x)) listing,
    md5((select to_jsonb(x)::text from sellerpilot_private.channel_gateway_jobs x)) job,
    md5((select to_jsonb(x)::text from sellerpilot_private.channel_operation_attempts x)) attempt,
    md5((select to_jsonb(x)::text from sellerpilot_private.products x)) product,
    (select md5(prosrc) from pg_proc where oid='sellerpilot_private.guard_immutable_ebay_offer_identity()'::regprocedure) immutable_guard,
    (select md5(prosrc) from pg_proc where oid='sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure) lineage_guard,
    (select md5(prosrc) from pg_proc where oid='sellerpilot_private.guard_verified_ebay_listing_sku_recovery()'::regprocedure) sku_guard`)).rows[0];
  const sql = migration
    .replace('3d0b5fee29130c9f067870b7606d1c8f', hashes.immutable_guard)
    .replace('38e1a8cf1ece02889810c2a6da2696d0', hashes.lineage_guard)
    .replace('b1b18c0e2699cb783f4c5e7d278efa25', hashes.sku_guard);
  await db.exec(sql);
  return {db, hashes};
}

async function reconcile(db, hashes, digest = verifiedDigest, file = fileDigest) {
  return (await db.query(
    'select public.sellerpilot_service_reconcile_ebay_narangd_offer_repair($1,$2,$3,$4,$5,$6) result',
    [digest, file, hashes.listing, hashes.job, hashes.attempt, hashes.product],
  )).rows[0].result;
}

test('exact receipt publishes the real Listing identity while source and product rows remain byte-identical', async () => {
  const {db, hashes} = await setup();
  try {
    const before = (await db.query(`select
      (select to_jsonb(x) from sellerpilot_private.channel_gateway_jobs x) job,
      (select to_jsonb(x) from sellerpilot_private.channel_operation_attempts x) attempt,
      (select to_jsonb(x) from sellerpilot_private.products x) product`)).rows[0];
    const result = await reconcile(db, hashes);
    assert.equal(result.status, 'reconciled');
    const row = (await db.query('select * from sellerpilot_private.product_listings')).rows[0];
    assert.equal(row.remote_id, '800659240462');
    assert.equal(row.provider_resource_id, '265437447011');
    assert.equal(row.marketplace_sku, 'AUTO-00BF58A2E8434FF09667-US');
    assert.equal(row.status, 'published');
    assert.equal(row.remote_visibility, 'live');
    assert.equal(row.provider_status, 'ACTIVE');
    assert.equal(row.seller_account_key, sellerKey);
    assert.equal(row.operation_attempt_id, id.attempt);
    assert.equal(row.remote_resources.resources.listingId, '800659240462');
    assert.equal(row.remote_resources.resources.offerId, '265437447011');
    assert.equal(row.remote_resources.verification.verifiedReceiptDigest, verifiedDigest);
    assert.equal(row.remote_resources.buyerVisibleVerified, false);
    const after = (await db.query(`select
      (select to_jsonb(x) from sellerpilot_private.channel_gateway_jobs x) job,
      (select to_jsonb(x) from sellerpilot_private.channel_operation_attempts x) attempt,
      (select to_jsonb(x) from sellerpilot_private.products x) product`)).rows[0];
    assert.deepEqual(after, before);
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.operation_audit')).rows[0].n, 1);
    assert.equal((await reconcile(db, hashes)).status, 'already_reconciled');
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.operation_audit')).rows[0].n, 1);
    await assert.rejects(db.exec(`update sellerpilot_private.channel_gateway_jobs set status='succeeded'`), /source evidence is immutable/);
    await assert.rejects(db.exec(`update sellerpilot_private.channel_operation_attempts set status='succeeded'`), /source evidence is immutable/);
    await assert.rejects(db.exec(`update sellerpilot_private.product_listings set price=3`), /baseline|invalid exact/);
  } finally { await db.close(); }
});

test('receipt identity, seller evidence, administrators and source projection fail closed', async () => {
  {
    const {db, hashes} = await setup();
    try {
      await assert.rejects(reconcile(db, hashes, '0'.repeat(64)), /EXPECTATION_REQUIRED/);
      await assert.rejects(reconcile(db, {...hashes, listing: '0'.repeat(32)}), /EVIDENCE_MISMATCH/);
    } finally { await db.close(); }
  }
  for (const missingAdmin of [id.owner, id.jobCreator, id.credentialCreator]) {
    const {db, hashes} = await setup({missingAdmin});
    try { await assert.rejects(reconcile(db, hashes), /EVIDENCE_MISMATCH/); }
    finally { await db.close(); }
  }
  for (const listingPatch of [
    `update sellerpilot_private.product_listings set remote_id='wrong'`,
    `update sellerpilot_private.product_listings set status='published'`,
    `update sellerpilot_private.product_listings set marketplace_sku='wrong'`,
  ]) {
    const {db, hashes} = await setup({listingPatch});
    try { await assert.rejects(reconcile(db, hashes), /EVIDENCE_MISMATCH/); }
    finally { await db.close(); }
  }
});

test('migration uses a narrow attested trigger branch and contains no product/source status rewrite', () => {
  assert.match(migration, /ebay_narangd_offer_repair_projection_allowed/);
  assert.match(migration, /request_has_unambiguous_service_role_claim/);
  assert.doesNotMatch(migration, /session_replication_role|disable trigger/i);
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.products/i);
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.channel_gateway_jobs/i);
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.channel_operation_attempts/i);
});
