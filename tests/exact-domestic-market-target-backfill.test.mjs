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
const coupangAttemptId = "8f285511-3a86-401e-8f91-1ab9715d311e";
const elevenstAttemptId = "84957a46-4a90-43bb-a9b6-e4f2be984b58";
const unrelatedListingId = "10000000-0000-4000-8000-000000000003";
const coupangCredentialId = "32de2968-d4b7-4fda-a84b-16a7ce0257cc";
const elevenstCredentialId = "b2dd0ff7-4420-495f-aead-a45857fb3bfe";
const coupangJobId = "5ad52ae1-abfc-4133-a8ed-3c9c8e528559";
const elevenstJobId = "f7927a29-46b2-4d77-90da-759c79c50bc7";
const coupangSellerKey = "c".repeat(64);
const elevenstSellerKey = "e".repeat(64);
const coupangFingerprint = "1".repeat(64);
const elevenstFingerprint = "2".repeat(64);

async function installLineageGuards(db) {
  await db.exec(`
    create or replace function sellerpilot_private.guard_attempt_seller_lineage()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
    declare
      v_credential_key text;
    begin
      select credential.seller_account_key
        into v_credential_key
        from sellerpilot_private.channel_credentials credential
       where credential.id = new.credential_id
         and credential.channel = new.channel;
      if not found then
        raise exception 'attempt credential lineage unavailable';
      end if;
      if old.seller_account_key is not null
         and new.seller_account_key is distinct from old.seller_account_key then
        raise exception 'attempt seller lineage is immutable';
      end if;
      if new.seller_account_key is distinct from old.seller_account_key then
        if old.seller_account_key is not null
           or old.status <> 'running'
           or new.seller_account_key is distinct from v_credential_key then
          raise exception 'attempt seller lineage is immutable';
        end if;
      end if;
      return new;
    end;
    $$;
    create trigger guard_attempt_seller_lineage
    before insert or update on sellerpilot_private.channel_operation_attempts
    for each row execute function
      sellerpilot_private.guard_attempt_seller_lineage();

    create or replace function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
    declare
      v_attempt record;
      v_credential_key text;
    begin
      if new.operation_attempt_id is not null then
        select attempt.id, attempt.credential_id, attempt.channel,
               attempt.operation, attempt.status,
               attempt.seller_account_key
          into v_attempt
          from sellerpilot_private.channel_operation_attempts attempt
         where attempt.id = new.operation_attempt_id;
        if found then
          select credential.seller_account_key
            into v_credential_key
            from sellerpilot_private.channel_credentials credential
           where credential.id = v_attempt.credential_id
             and credential.channel = v_attempt.channel;
          if v_attempt.channel <> new.channel_key then
            raise exception 'product listing attempt channel mismatch';
          end if;
          if v_attempt.operation = 'listing.create'
             and old.seller_account_key is not null
             and (
               v_attempt.seller_account_key is null
               or old.seller_account_key is distinct from
                  v_attempt.seller_account_key
               or old.seller_account_key is distinct from v_credential_key
             ) then
            raise exception 'product listing seller account mismatch';
          end if;
        end if;
      end if;
      return new;
    end;
    $$;
    create trigger guard_product_listing_seller_lineage
    before update on sellerpilot_private.product_listings
    for each row execute function
      sellerpilot_private.guard_product_listing_seller_lineage();
  `);
}

async function createDatabase({ withExactRows = true, withGuards = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
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
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      idempotency_key text not null,
      request_fingerprint text not null,
      status text not null,
      http_status integer,
      remote_id text,
      safe_message text,
      started_at timestamptz not null default clock_timestamp(),
      completed_at timestamptz,
      seller_account_key text
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
      operation_attempt_id uuid,
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
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb not null default '{}'::jsonb,
      status text not null,
      request_fingerprint text,
      seller_account_key text
    );
    create function sellerpilot_private.gateway_listing_create_readback_verified(
      p_channel text,
      p_response_payload jsonb
    ) returns boolean
    language sql
    immutable
    set search_path = ''
    as $$
      select coalesce((p_response_payload->>'ok')::boolean, false)
        and nullif(trim(p_response_payload->>'remoteId'), '') is not null
        and jsonb_typeof(p_response_payload->'steps') = 'array'
        and exists (
          select 1
            from jsonb_array_elements(p_response_payload->'steps') step
           where case p_channel
             when 'coupang' then lower(coalesce(step->>'name', '')) =
                                  'listing-readback'
             when 'elevenst' then lower(coalesce(step->>'name', '')) =
                                   'product-readback'
             else false
           end
             and coalesce((step->>'ok')::boolean, false)
        )
        and not exists (
          select 1
            from jsonb_array_elements(p_response_payload->'steps') step
           where coalesce((step->>'ok')::boolean, false) = false
        )
    $$;
  `);
  if (!withExactRows) {
    if (withGuards) await installLineageGuards(db);
    return db;
  }

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
       ($1,$6,'coupang','production',7,'ABCDEF123456','active',null,$3,
        'credential_incarnation_v1',clock_timestamp(),clock_timestamp(),'passed'),
       ($4,$2,'elevenst','production',2,'654321FEDCBA','active',null,$5,
        'credential_incarnation_v1',clock_timestamp(),clock_timestamp(),'passed')`,
    [
      coupangCredentialId,
      ownerId,
      coupangSellerKey,
      elevenstCredentialId,
      elevenstSellerKey,
      otherOwnerId,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,idempotency_key,
       request_fingerprint,status,http_status,remote_id,completed_at,
       seller_account_key
     ) values
       ($1,$2,$3,'coupang','listing.create',
        'coupang-legacy-create-attempt',$4,'succeeded',200,
        '16356981734',clock_timestamp(),null),
       ($5,$2,$6,'elevenst','listing.create',
        'elevenst-legacy-create-attempt',$7,'succeeded',200,
        '9573255804',clock_timestamp(),null)`,
    [
      coupangAttemptId,
      ownerId,
      coupangCredentialId,
      coupangFingerprint,
      elevenstAttemptId,
      elevenstCredentialId,
      elevenstFingerprint,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,market,target_id,
       marketplace_sku,currency,price,operation_attempt_id,seller_account_key,
       status,failure_class,requested_publication_intent,remote_visibility,
       provider_status,published_at
     ) values
       ($1,$2,$3,'coupang','16356981734','','',null,'KRW',5000,$4,$5,
        'failed','external_action','live','unknown',null,null),
       ($6,$2,$3,'elevenst','9573255804','','',null,
        'KRW',5000,$7,$8,
        'failed','external_action','live','unknown',null,null),
       ($9,$2,$3,'coupang','unrelated-remote','ZZ','OTHER',null,'KRW',
        9000,null,$5,
        'failed','external_action','live','unknown',null,null)`,
    [
      coupangListingId,
      ownerId,
      productId,
      coupangAttemptId,
      coupangSellerKey,
      elevenstListingId,
      elevenstAttemptId,
      elevenstSellerKey,
      unrelatedListingId,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,status,request_fingerprint,
       seller_account_key
     ) values
       ($1,$2,$3,null,'coupang','listing.create','production','{}'::jsonb,
        $4::jsonb,'succeeded',$5,null),
       ($6,$7,$8,null,'elevenst','listing.create','production','{}'::jsonb,
        $9::jsonb,'succeeded',$10,null)`,
    [
      coupangJobId,
      coupangCredentialId,
      coupangAttemptId,
      JSON.stringify({
        ok: true,
        remoteId: "16356981734",
        steps: [{ name: "listing-readback", ok: true }],
      }),
      coupangFingerprint,
      elevenstJobId,
      elevenstCredentialId,
      elevenstAttemptId,
      JSON.stringify({
        ok: true,
        remoteId: "9573255804",
        steps: [{ name: "product-readback", ok: true }],
      }),
      elevenstFingerprint,
    ],
  );
  if (withGuards) await installLineageGuards(db);
  return db;
}

async function listings(db) {
  return (await db.query(
    `select id,owner_id,product_id,channel_key,remote_id,market,target_id,
            marketplace_sku,currency,price::text,operation_attempt_id,
            seller_account_key,status,failure_class,
            requested_publication_intent,remote_visibility,provider_status,
            published_at,updated_at
       from sellerpilot_private.product_listings
      order by id`,
  )).rows;
}

async function attempts(db) {
  return (await db.query(
    `select id,owner_id,credential_id,channel,operation,idempotency_key,
            request_fingerprint,status,http_status,remote_id,safe_message,
            started_at,completed_at,seller_account_key
       from sellerpilot_private.channel_operation_attempts
      order by id`,
  )).rows;
}

test("exact domestic market-target backfill is tuple-scoped and does not loosen permits", () => {
  assert.match(migration, /20260901081500|908150001/u);
  assert.match(migration, new RegExp(coupangListingId, "u"));
  assert.match(migration, new RegExp(elevenstListingId, "u"));
  assert.match(migration, new RegExp(coupangAttemptId, "u"));
  assert.match(migration, new RegExp(elevenstAttemptId, "u"));
  assert.match(migration, new RegExp(coupangCredentialId, "u"));
  assert.match(migration, new RegExp(elevenstCredentialId, "u"));
  assert.match(migration, new RegExp(coupangJobId, "u"));
  assert.match(migration, new RegExp(elevenstJobId, "u"));
  assert.match(migration, new RegExp(ownerId, "u"));
  assert.match(migration, new RegExp(productId, "u"));
  assert.match(migration, /remote_id = '16356981734'/u);
  assert.match(migration, /remote_id = '9573255804'/u);
  assert.match(migration, /sku is distinct from 'QA-20260823-CC-001'/u);
  assert.match(migration, /on_hand is distinct from 1/u);
  assert.match(migration, /currency is distinct from 'KRW'/u);
  assert.match(migration, /price is distinct from 5000/u);
  assert.match(migration, /seller_account_key is distinct from/u);
  assert.match(
    migration,
    /sellerpilot\.exact_domestic_attempt_lineage_backfill/u,
  );
  assert.match(
    migration,
    /exact domestic attempt lineage backfill may only bind seller account key/u,
  );
  assert.doesNotMatch(migration, /disable\s+trigger/iu);
  assert.doesNotMatch(migration, /drop\s+trigger/iu);
  assert.doesNotMatch(
    migration,
    /v_coupang_credential\.created_by is distinct from v_owner_id/u,
    "Coupang static credentials are shared across approved workspace admins",
  );
  assert.match(
    migration,
    /v_elevenst_credential\.created_by is distinct from v_owner_id/u,
    "11st keeps its already-matching exact owner condition",
  );
  assert.match(migration, /market = '' and v_coupang_listing\.target_id = ''/u);
  assert.match(migration, /market = 'KR' and v_coupang_listing\.target_id = 'KR'/u);
  assert.match(
    migration,
    /v_elevenst_listing\.marketplace_sku is not null/u,
    "the exact production 11st ledger keeps a NULL marketplace_sku",
  );
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
    const attemptsBefore = await attempts(db);
    assert.ok(
      attemptsBefore.every((attempt) => attempt.seller_account_key === null),
      "the production regression requires legacy succeeded attempts with NULL lineage",
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_operation_attempts
            set seller_account_key=$2
          where id=$1`,
        [coupangAttemptId, coupangSellerKey],
      ),
      /attempt seller lineage is immutable/,
      "a caller cannot bind a terminal attempt without the exact maintenance proof",
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.product_listings
            set market='KR',target_id='KR'
          where id=$1`,
        [coupangListingId],
      ),
      /product listing seller account mismatch/,
      "the unchanged production guard must reproduce the original blocker",
    );
    assert.deepEqual(await listings(db), before);
    const coupangCredentialBefore = (await db.query(
      "select created_by from sellerpilot_private.channel_credentials where id=$1",
      [coupangCredentialId],
    )).rows[0];
    assert.equal(coupangCredentialBefore.created_by, otherOwnerId);
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

    const attemptsAfter = await attempts(db);
    assert.deepEqual(
      attemptsAfter.map((attempt) => ({
        id: attempt.id,
        seller_account_key: attempt.seller_account_key,
      })),
      [
        { id: elevenstAttemptId, seller_account_key: elevenstSellerKey },
        { id: coupangAttemptId, seller_account_key: coupangSellerKey },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    for (const row of attemptsAfter) {
      const original = attemptsBefore.find((candidate) => candidate.id === row.id);
      assert.ok(original);
      assert.deepEqual(
        { ...row, seller_account_key: original.seller_account_key },
        original,
        "attempt repair may change only seller_account_key",
      );
    }
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_operation_attempts
            set seller_account_key=$2
          where id=$1`,
        [coupangAttemptId, "f".repeat(64)],
      ),
      /attempt seller lineage is immutable/,
      "the newly proven attempt lineage remains immutable",
    );

    const firstPostimage = await listings(db);
    const firstAttemptPostimage = await attempts(db);
    await db.exec(migration);
    assert.deepEqual(await listings(db), firstPostimage);
    assert.deepEqual(await attempts(db), firstAttemptPostimage);
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

test("normal attempt insert lineage behavior remains intact", async () => {
  const db = await createDatabase();
  try {
    await db.exec(migration);
    const insertedAttemptId = "10000000-0000-4000-8000-000000000005";
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts (
         id,owner_id,credential_id,channel,operation,idempotency_key,
         request_fingerprint,status,remote_id,seller_account_key
       ) values (
         $1,$2,$3,'coupang','listing.update',
         'new-normal-attempt-after-backfill',$4,'running','16356981734',null
       )`,
      [
        insertedAttemptId,
        ownerId,
        coupangCredentialId,
        "3".repeat(64),
      ],
    );
    assert.equal(
      (await db.query(
        `select seller_account_key
           from sellerpilot_private.channel_operation_attempts
          where id=$1`,
        [insertedAttemptId],
      )).rows[0].seller_account_key,
      coupangSellerKey,
    );
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
  ["credential channel", `update sellerpilot_private.channel_credentials set channel='smartstore' where id='${coupangCredentialId}'`],
  ["credential status", `update sellerpilot_private.channel_credentials set status='revoked' where id='${coupangCredentialId}'`],
  ["credential lineage", `update sellerpilot_private.channel_credentials set seller_account_key='${"a".repeat(64)}' where id='${coupangCredentialId}'`],
  ["credential lineage source", `update sellerpilot_private.channel_credentials set seller_account_key_source='provider_certified_v1' where id='${coupangCredentialId}'`],
  ["listing attempt", `update sellerpilot_private.product_listings set operation_attempt_id='${elevenstAttemptId}' where id='${coupangListingId}'`],
  ["attempt credential", `update sellerpilot_private.channel_operation_attempts set credential_id='${elevenstCredentialId}' where id='${coupangAttemptId}'`],
  ["attempt status", `update sellerpilot_private.channel_operation_attempts set status='failed' where id='${coupangAttemptId}'`],
  ["attempt remote", `update sellerpilot_private.channel_operation_attempts set remote_id='16356981735' where id='${coupangAttemptId}'`],
  ["attempt lineage", `update sellerpilot_private.channel_operation_attempts set seller_account_key='${"a".repeat(64)}' where id='${coupangAttemptId}'`],
  ["gateway attempt", `update sellerpilot_private.channel_gateway_jobs set attempt_id='${elevenstAttemptId}' where id='${coupangJobId}'`],
  ["gateway listing", `update sellerpilot_private.channel_gateway_jobs set listing_id='${coupangListingId}' where id='${coupangJobId}'`],
  ["gateway status", `update sellerpilot_private.channel_gateway_jobs set status='failed' where id='${coupangJobId}'`],
  ["gateway response", `update sellerpilot_private.channel_gateway_jobs set response_payload=jsonb_set(response_payload,'{remoteId}','"16356981735"'::jsonb) where id='${coupangJobId}'`],
  ["ambiguous gateway", `insert into sellerpilot_private.channel_gateway_jobs (id,credential_id,attempt_id,listing_id,channel,operation,environment,request_payload,response_payload,status,request_fingerprint,seller_account_key) select '10000000-0000-4000-8000-000000000006',credential_id,attempt_id,null,channel,operation,environment,request_payload,response_payload,status,request_fingerprint,seller_account_key from sellerpilot_private.channel_gateway_jobs where id='${coupangJobId}'`],
  ["half-filled market", `update sellerpilot_private.product_listings set market='KR',target_id='' where id='${coupangListingId}'`],
  ["half-filled target", `update sellerpilot_private.product_listings set market='',target_id='KR' where id='${coupangListingId}'`],
  ["foreign market", `update sellerpilot_private.product_listings set market='US',target_id='US' where id='${coupangListingId}'`],
  ["11st remote id", `update sellerpilot_private.product_listings set remote_id='9573255805' where id='${elevenstListingId}'`],
  ["11st populated SKU", `update sellerpilot_private.product_listings set marketplace_sku='QA-20260823-CC-001' where id='${elevenstListingId}'`],
  ["11st SKU", `update sellerpilot_private.product_listings set marketplace_sku='QA-20260823-CC-002' where id='${elevenstListingId}'`],
  ["11st credential version", `update sellerpilot_private.channel_credentials set version=3 where id='${elevenstCredentialId}'`],
  ["11st credential lineage", `update sellerpilot_private.channel_credentials set seller_account_key='${"b".repeat(64)}' where id='${elevenstCredentialId}'`],
  ["11st half-filled market", `update sellerpilot_private.product_listings set market='KR',target_id='' where id='${elevenstListingId}'`],
];

for (const [name, mutate] of nearMisses) {
  test(`near-miss ${name} aborts atomically with zero listing mutation`, async () => {
    const db = await createDatabase({ withGuards: false });
    try {
      await db.exec(mutate);
      await installLineageGuards(db);
      const before = await listings(db);
      const attemptsBefore = await attempts(db);
      await assert.rejects(
        db.exec(migration),
        /EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH/,
      );
      await db.exec("rollback");
      assert.deepEqual(await listings(db), before);
      assert.deepEqual(await attempts(db), attemptsBefore);
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

test("orphaned exact attempts and jobs cannot masquerade as a fresh replay", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `delete from sellerpilot_private.product_listings
        where id in ($1,$2)`,
      [coupangListingId, elevenstListingId],
    );
    const attemptsBefore = await attempts(db);
    await assert.rejects(
      db.exec(migration),
      /EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_INCOMPLETE/,
    );
    await db.exec("rollback");
    assert.deepEqual(await attempts(db), attemptsBefore);
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
