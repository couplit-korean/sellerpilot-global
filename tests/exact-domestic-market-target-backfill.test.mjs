import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901081500_backfill_exact_domestic_market_targets.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const otherOwnerId = "10000000-0000-4000-8000-000000000001";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const otherProductId = "10000000-0000-4000-8000-000000000002";
const coupangListingId = "7ffc6e46-3173-4695-9889-5fa1529765f1";
const elevenstListingId = "363f3b81-f364-4f22-af4e-4920199904d0";
const unrelatedListingId = "10000000-0000-4000-8000-000000000003";
const coupangCredentialId = "32de2968-d4b7-4fda-a84b-16a7ce0257cc";
const elevenstCredentialId = "b2dd0ff7-4420-495f-aead-a45857fb3bfe";
const coupangSellerKey = "c".repeat(64);
const elevenstSellerKey = "e".repeat(64);

async function createDatabase({ withExactRows = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema sellerpilot_private;
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      sku text not null,
      on_hand integer not null,
      demo boolean not null,
      status text not null
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      created_by uuid not null,
      channel text not null,
      environment text not null,
      version integer not null,
      fingerprint text not null,
      status text not null,
      expires_at timestamptz,
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz,
      last_checked_at timestamptz,
      last_check_status text
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      remote_id text,
      market text not null default '',
      target_id text not null default '',
      marketplace_sku text,
      currency text not null,
      price numeric not null,
      seller_account_key text,
      status text not null,
      failure_class text,
      requested_publication_intent text,
      remote_visibility text,
      provider_status text,
      published_at timestamptz,
      updated_at timestamptz not null default '2026-08-31T00:00:00Z',
      unique (owner_id, product_id, channel_key, market, target_id)
    );
  `);
  if (!withExactRows) return db;

  await db.query(
    `insert into sellerpilot_private.products
       (id,owner_id,sku,on_hand,demo,status)
     values ($1,$2,'QA-20260823-CC-001',1,false,'draft'),
            ($3,$2,'NEAR-MISS-SKU',1,false,'draft')`,
    [productId, ownerId, otherProductId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials (
       id,created_by,channel,environment,version,fingerprint,status,
       expires_at,seller_account_key,seller_account_key_source,
       seller_account_verified_at,last_checked_at,last_check_status
     ) values
       ($1,$2,'coupang','production',7,'ABCDEF123456','active',null,$3,
        'credential_incarnation_v1',clock_timestamp(),clock_timestamp(),'passed'),
       ($4,$2,'elevenst','production',2,'654321FEDCBA','active',null,$5,
        'credential_incarnation_v1',clock_timestamp(),clock_timestamp(),'passed')`,
    [
      coupangCredentialId,
      ownerId,
      coupangSellerKey,
      elevenstCredentialId,
      elevenstSellerKey,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,market,target_id,
       marketplace_sku,currency,price,seller_account_key,status,failure_class,
       requested_publication_intent,remote_visibility,provider_status,published_at
     ) values
       ($1,$2,$3,'coupang','16356981734','','',null,'KRW',5000,$4,
        'failed','external_action','live','unknown',null,null),
       ($5,$2,$3,'elevenst','9573255804','','','QA-20260823-CC-001','KRW',5000,$6,
        'failed','external_action','live','unknown',null,null),
       ($7,$2,$3,'coupang','unrelated-remote','ZZ','OTHER',null,'KRW',9000,$4,
        'failed','external_action','live','unknown',null,null)`,
    [
      coupangListingId,
      ownerId,
      productId,
      coupangSellerKey,
      elevenstListingId,
      elevenstSellerKey,
      unrelatedListingId,
    ],
  );
  return db;
}

async function listings(db) {
  return (await db.query(
    `select id,owner_id,product_id,channel_key,remote_id,market,target_id,
            marketplace_sku,currency,price::text,seller_account_key,status,
            failure_class,requested_publication_intent,remote_visibility,
            provider_status,published_at,updated_at
       from sellerpilot_private.product_listings
      order by id`,
  )).rows;
}

test("exact domestic market-target backfill is tuple-scoped and does not loosen permits", () => {
  assert.match(migration, /20260901081500|908150001/u);
  assert.match(migration, new RegExp(coupangListingId, "u"));
  assert.match(migration, new RegExp(elevenstListingId, "u"));
  assert.match(migration, new RegExp(coupangCredentialId, "u"));
  assert.match(migration, new RegExp(elevenstCredentialId, "u"));
  assert.match(migration, new RegExp(ownerId, "u"));
  assert.match(migration, new RegExp(productId, "u"));
  assert.match(migration, /remote_id = '16356981734'/u);
  assert.match(migration, /remote_id = '9573255804'/u);
  assert.match(migration, /sku is distinct from 'QA-20260823-CC-001'/u);
  assert.match(migration, /on_hand is distinct from 1/u);
  assert.match(migration, /currency is distinct from 'KRW'/u);
  assert.match(migration, /price is distinct from 5000/u);
  assert.match(migration, /seller_account_key is distinct from/u);
  assert.match(migration, /market = '' and v_coupang_listing\.target_id = ''/u);
  assert.match(migration, /market = 'KR' and v_coupang_listing\.target_id = 'KR'/u);
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into\s+)?sellerpilot_private\.exact_existing_update_permits/iu,
  );
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into\s+)?sellerpilot_private\.listing_mutation_release_gate/iu,
  );
});

test("only the two exact blank identities become KR/KR and replay is idempotent", async () => {
  const db = await createDatabase();
  try {
    const before = await listings(db);
    await db.exec(migration);
    const after = await listings(db);
    assert.equal(after.length, before.length);

    for (const row of after) {
      const original = before.find((candidate) => candidate.id === row.id);
      assert.ok(original);
      if (row.id === coupangListingId || row.id === elevenstListingId) {
        assert.equal(row.market, "KR");
        assert.equal(row.target_id, "KR");
        assert.deepEqual(
          { ...row, market: original.market, target_id: original.target_id },
          original,
        );
      } else {
        assert.deepEqual(row, original, "unrelated listing must not mutate");
      }
    }

    const firstPostimage = await listings(db);
    await db.exec(migration);
    assert.deepEqual(await listings(db), firstPostimage);
  } finally {
    await db.close();
  }
});

test("a fresh schema with neither production listing replays without manufacturing rows", async () => {
  const db = await createDatabase({ withExactRows: false });
  try {
    await db.exec(migration);
    assert.deepEqual(await listings(db), []);
  } finally {
    await db.close();
  }
});

const nearMisses = [
  ["owner", `update sellerpilot_private.product_listings set owner_id='${otherOwnerId}' where id='${coupangListingId}'`],
  ["product", `update sellerpilot_private.product_listings set product_id='${otherProductId}' where id='${coupangListingId}'`],
  ["channel", `update sellerpilot_private.product_listings set channel_key='smartstore' where id='${coupangListingId}'`],
  ["remote id", `update sellerpilot_private.product_listings set remote_id='16356981735' where id='${coupangListingId}'`],
  ["SKU", `update sellerpilot_private.products set sku='QA-20260823-CC-002' where id='${productId}'`],
  ["currency", `update sellerpilot_private.product_listings set currency='USD' where id='${coupangListingId}'`],
  ["price", `update sellerpilot_private.product_listings set price=5001 where id='${coupangListingId}'`],
  ["stock", `update sellerpilot_private.products set on_hand=2 where id='${productId}'`],
  ["listing lineage", `update sellerpilot_private.product_listings set seller_account_key='${"f".repeat(64)}' where id='${coupangListingId}'`],
  ["credential owner", `update sellerpilot_private.channel_credentials set created_by='${otherOwnerId}' where id='${coupangCredentialId}'`],
  ["credential lineage", `update sellerpilot_private.channel_credentials set seller_account_key='${"a".repeat(64)}' where id='${coupangCredentialId}'`],
  ["credential lineage source", `update sellerpilot_private.channel_credentials set seller_account_key_source='provider_certified_v1' where id='${coupangCredentialId}'`],
  ["half-filled market", `update sellerpilot_private.product_listings set market='KR',target_id='' where id='${coupangListingId}'`],
  ["half-filled target", `update sellerpilot_private.product_listings set market='',target_id='KR' where id='${coupangListingId}'`],
  ["foreign market", `update sellerpilot_private.product_listings set market='US',target_id='US' where id='${coupangListingId}'`],
  ["11st remote id", `update sellerpilot_private.product_listings set remote_id='9573255805' where id='${elevenstListingId}'`],
  ["11st SKU", `update sellerpilot_private.product_listings set marketplace_sku='QA-20260823-CC-002' where id='${elevenstListingId}'`],
  ["11st credential version", `update sellerpilot_private.channel_credentials set version=3 where id='${elevenstCredentialId}'`],
  ["11st credential lineage", `update sellerpilot_private.channel_credentials set seller_account_key='${"b".repeat(64)}' where id='${elevenstCredentialId}'`],
  ["11st half-filled market", `update sellerpilot_private.product_listings set market='KR',target_id='' where id='${elevenstListingId}'`],
];

for (const [name, mutate] of nearMisses) {
  test(`near-miss ${name} aborts atomically with zero listing mutation`, async () => {
    const db = await createDatabase();
    try {
      await db.exec(mutate);
      const before = await listings(db);
      await assert.rejects(
        db.exec(migration),
        /EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH/,
      );
      await db.exec("rollback");
      assert.deepEqual(await listings(db), before);
    } finally {
      await db.close();
    }
  });
}

test("a partial production tuple aborts without updating the surviving row", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      "delete from sellerpilot_private.product_listings where id=$1",
      [elevenstListingId],
    );
    const before = await listings(db);
    await assert.rejects(
      db.exec(migration),
      /EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_INCOMPLETE/,
    );
    await db.exec("rollback");
    assert.deepEqual(await listings(db), before);
  } finally {
    await db.close();
  }
});

test("an existing KR/KR collision aborts before either exact row changes", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id,owner_id,product_id,channel_key,remote_id,market,target_id,
         currency,price,seller_account_key,status,failure_class,
         requested_publication_intent,remote_visibility
       ) values ($1,$2,$3,'coupang','collision','KR','KR','KRW',5000,$4,
                 'failed','external_action','live','unknown')`,
      [
        "10000000-0000-4000-8000-000000000004",
        ownerId,
        productId,
        coupangSellerKey,
      ],
    );
    const before = await listings(db);
    await assert.rejects(
      db.exec(migration),
      /EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_CONFLICT/,
    );
    await db.exec("rollback");
    assert.deepEqual(await listings(db), before);
  } finally {
    await db.close();
  }
});
