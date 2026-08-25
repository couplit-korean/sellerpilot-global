import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260825111820_serialize_gateway_ledger_transactions.sql",
  import.meta.url,
);

const ADMIN_A = "10000000-0000-4000-8000-000000000001";
const ADMIN_B = "10000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const BLOCKED_PRODUCT_ID = "20000000-0000-4000-8000-000000000002";
const CREDENTIAL_ID = "30000000-0000-4000-8000-000000000001";
const ATTEMPT_A = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_B = "40000000-0000-4000-8000-000000000002";
const ATTEMPT_C = "40000000-0000-4000-8000-000000000003";
const ATTEMPT_D = "40000000-0000-4000-8000-000000000004";
const OLD_ATTEMPT = "40000000-0000-4000-8000-000000000005";
const BLOCKED_LISTING_ID = "50000000-0000-4000-8000-000000000002";
const OLD_JOB_ID = "60000000-0000-4000-8000-000000000002";
const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);
const FINGERPRINT_C = "c".repeat(64);
const FINGERPRINT_D = "d".repeat(64);

function extractAtomicFunction(migration) {
  const start = migration.indexOf(
    "create or replace function public.sellerpilot_service_reserve_and_enqueue_listing_create",
  );
  assert.ok(start >= 0, "atomic listing.create function must exist");
  const end = migration.indexOf("\n$$;", start);
  assert.ok(end > start, "atomic listing.create function must have a complete body");
  return migration.slice(start, end + "\n$$;".length);
}

function extractRequiredBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} must exist`);
  return match[0];
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function listingSnapshot(db, listingId) {
  return (await db.query(
    `select id::text,
            owner_id::text,
            product_id::text,
            channel_key,
            market,
            target_id,
            status,
            currency,
            price::text,
            remote_id,
            operation_attempt_id::text,
            failure_class,
            last_error,
            seller_account_key,
            published_at::text,
            updated_at::text
       from sellerpilot_private.product_listings
      where id = $1`,
    [listingId],
  )).rows[0];
}

async function reserve(db, {
  productId = PRODUCT_ID,
  attemptId,
  targetId = "shop-1",
  currency,
  price,
  fingerprint,
}) {
  return scalar(
    db,
    `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
      $1, $2, $3, 'shopee', 'my', $4, $5, $6::numeric, $7, $8::jsonb
    )`,
    [
      productId,
      CREDENTIAL_ID,
      attemptId,
      targetId,
      currency,
      price,
      fingerprint,
      JSON.stringify({ arguments: { shopId: targetId, title: "safe" } }),
    ],
  );
}

async function setupAtomicFixture(db, migration) {
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;

    create table sellerpilot_private.admin_users (
      user_id uuid primary key
    );
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      demo boolean not null default false,
      status text not null
    );
    create table sellerpilot_private.product_category_assignments (
      owner_id uuid not null,
      product_id uuid not null,
      channel text not null,
      market text not null default '',
      status text not null,
      is_leaf boolean not null,
      missing_required_attributes jsonb not null default '[]'::jsonb,
      confirmed_at timestamptz
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      created_by uuid not null
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      request_fingerprint text not null,
      status text not null,
      http_status integer,
      safe_message text,
      completed_at timestamptz
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      market text not null default '',
      target_id text not null default '',
      status text not null,
      currency text not null,
      price numeric(14,2) not null,
      remote_id text,
      operation_attempt_id uuid,
      failure_class text,
      last_error text,
      seller_account_key text,
      published_at timestamptz,
      updated_at timestamptz not null default now(),
      unique (owner_id, product_id, channel_key, market, target_id)
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null,
      request_fingerprint text,
      response_payload jsonb,
      error_message text,
      status text not null default 'queued',
      created_by uuid not null,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    );
    create table sellerpilot_private.operation_audit (
      owner_id uuid not null,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      safe_detail jsonb not null
    );
  `);
  await db.exec(extractAtomicFunction(migration));

  await db.query("insert into sellerpilot_private.admin_users(user_id) values ($1), ($2)", [ADMIN_A, ADMIN_B]);
  await db.query(
    "insert into sellerpilot_private.products(id,owner_id,status) values ($1,$3,'ready'), ($2,$3,'ready')",
    [PRODUCT_ID, BLOCKED_PRODUCT_ID, ADMIN_A],
  );
  await db.query(
    `insert into sellerpilot_private.product_category_assignments(
       owner_id,product_id,channel,market,status,is_leaf,missing_required_attributes,confirmed_at
     ) values
       ($1,$2,'shopee','MY','confirmed',true,'[]'::jsonb,now()),
       ($1,$3,'shopee','MY','confirmed',true,'[]'::jsonb,now())`,
    [ADMIN_A, PRODUCT_ID, BLOCKED_PRODUCT_ID],
  );
  await db.query(
    "insert into sellerpilot_private.channel_credentials(id,channel,environment,status,created_by) values ($1,'shopee','production','active',$2)",
    [CREDENTIAL_ID, ADMIN_A],
  );
  for (const [attemptId, fingerprint, status] of [
    [ATTEMPT_A, FINGERPRINT_A, "running"],
    [ATTEMPT_B, FINGERPRINT_B, "running"],
    [ATTEMPT_C, FINGERPRINT_C, "running"],
    [ATTEMPT_D, FINGERPRINT_D, "running"],
    [OLD_ATTEMPT, "e".repeat(64), "manual_required"],
  ]) {
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts(
         id,owner_id,credential_id,channel,operation,request_fingerprint,status
       ) values ($1,$2,$3,'shopee','listing.create',$4,$5)`,
      [attemptId, ADMIN_B, CREDENTIAL_ID, fingerprint, status],
    );
  }
}

test("atomic listing.create preserves the first attempt's ledger reservation", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await setupAtomicFixture(db, migration);

    const first = await reserve(db, {
      attemptId: ATTEMPT_A,
      currency: "usd",
      price: 12.34,
      fingerprint: FINGERPRINT_A,
    });
    assert.equal(first.status, "queued");
    assert.equal(first.attempt_id, ATTEMPT_A);
    assert.equal(first.reused, false);
    assert.equal(typeof first.listing_id, "string");
    assert.equal(typeof first.job_id, "string");

    const firstSnapshot = await listingSnapshot(db, first.listing_id);
    assert.equal(firstSnapshot.owner_id, ADMIN_A, "shared-admin attempt must not take product ownership");
    assert.equal(firstSnapshot.operation_attempt_id, ATTEMPT_A);
    assert.equal(firstSnapshot.currency, "USD");
    assert.equal(firstSnapshot.price, "12.34");
    assert.deepEqual(
      (await db.query(
        `select listing_id::text, attempt_id::text, credential_id::text, request_fingerprint, status
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [first.job_id],
      )).rows[0],
      {
        listing_id: first.listing_id,
        attempt_id: ATTEMPT_A,
        credential_id: CREDENTIAL_ID,
        request_fingerprint: FINGERPRINT_A,
        status: "queued",
      },
    );

    const exactRetry = await reserve(db, {
      attemptId: ATTEMPT_A,
      currency: "usd",
      price: 12.34,
      fingerprint: FINGERPRINT_A,
    });
    assert.equal(exactRetry.status, "in_progress");
    assert.equal(exactRetry.reused, true);
    assert.equal(exactRetry.job_id, first.job_id);
    assert.equal(exactRetry.listing_id, first.listing_id);

    const conflict = await reserve(db, {
      attemptId: ATTEMPT_B,
      currency: "eur",
      price: 999.99,
      fingerprint: FINGERPRINT_B,
    });
    assert.equal(conflict.status, "in_progress");
    assert.equal(conflict.attempt_id, ATTEMPT_A);
    assert.equal(conflict.conflict_attempt_id, ATTEMPT_B);
    assert.equal(conflict.job_id, first.job_id);
    assert.deepEqual(await listingSnapshot(db, first.listing_id), firstSnapshot);
    assert.deepEqual(
      (await db.query(
        "select status,http_status from sellerpilot_private.channel_operation_attempts where id=$1",
        [ATTEMPT_B],
      )).rows[0],
      { status: "failed", http_status: 409 },
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"),
      1,
    );

    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='succeeded',completed_at=now() where id=$1",
      [first.job_id],
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set status='published',remote_id='remote-123',seller_account_key=$2,
              published_at='2026-08-25T00:00:00Z'
        where id=$1`,
      [first.listing_id, "f".repeat(64)],
    );
    const publishedBefore = await listingSnapshot(db, first.listing_id);
    const remoteExists = await reserve(db, {
      attemptId: ATTEMPT_C,
      currency: "jpy",
      price: 77777,
      fingerprint: FINGERPRINT_C,
    });
    assert.equal(remoteExists.status, "remote_exists");
    assert.equal(remoteExists.listing_id, first.listing_id);
    assert.deepEqual(await listingSnapshot(db, first.listing_id), publishedBefore);
    assert.deepEqual(
      (await db.query(
        "select status,http_status from sellerpilot_private.channel_operation_attempts where id=$1",
        [ATTEMPT_C],
      )).rows[0],
      { status: "failed", http_status: 409 },
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"),
      1,
    );
  } finally {
    await db.close();
  }
});

test("external_action create remains blocked without changing its listing ledger", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await setupAtomicFixture(db, migration);
    await db.query(
      `insert into sellerpilot_private.product_listings(
         id,owner_id,product_id,channel_key,market,target_id,status,currency,price,
         operation_attempt_id,failure_class,last_error,seller_account_key
       ) values ($1,$2,$3,'shopee','MY','shop-2','failed','KRW',314.15,$4,
         'external_action','provider outcome unknown',$5)`,
      [BLOCKED_LISTING_ID, ADMIN_A, BLOCKED_PRODUCT_ID, OLD_ATTEMPT, "9".repeat(64)],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,request_fingerprint,status,created_by,completed_at
       ) values ($1,$2,$3,$4,'shopee','listing.create','production','{}'::jsonb,$5,
         'failed',$6,now())`,
      [OLD_JOB_ID, CREDENTIAL_ID, OLD_ATTEMPT, BLOCKED_LISTING_ID, "e".repeat(64), ADMIN_A],
    );
    const before = await listingSnapshot(db, BLOCKED_LISTING_ID);
    const jobCountBefore = await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs");

    const blocked = await reserve(db, {
      productId: BLOCKED_PRODUCT_ID,
      attemptId: ATTEMPT_D,
      targetId: "shop-2",
      currency: "JPY",
      price: 88888,
      fingerprint: FINGERPRINT_D,
    });
    assert.equal(blocked.status, "manual_required");
    assert.equal(blocked.job_id, OLD_JOB_ID);
    assert.equal(blocked.listing_id, BLOCKED_LISTING_ID);
    assert.deepEqual(await listingSnapshot(db, BLOCKED_LISTING_ID), before);
    assert.deepEqual(
      (await db.query(
        "select status,http_status from sellerpilot_private.channel_operation_attempts where id=$1",
        [ATTEMPT_D],
      )).rows[0],
      { status: "manual_required", http_status: 409 },
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"),
      jobCountBefore,
    );
  } finally {
    await db.close();
  }
});

test("atomic create is service-only and legacy prepare RPCs are fully revoked", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await setupAtomicFixture(db, migration);
    await db.exec(`
      create function public.sellerpilot_prepare_product_market_listing(
        uuid,text,text,text,text,text,numeric
      ) returns uuid language sql as 'select null::uuid';
      create function public.sellerpilot_prepare_product_listing(
        uuid,text,text,text,numeric
      ) returns uuid language sql as 'select null::uuid';
      grant execute on function public.sellerpilot_prepare_product_market_listing(
        uuid,text,text,text,text,text,numeric
      ) to authenticated, service_role;
      grant execute on function public.sellerpilot_prepare_product_listing(
        uuid,text,text,text,numeric
      ) to authenticated, service_role;
    `);

    const legacyRevokes = extractRequiredBlock(
      migration,
      /revoke all on function public\.sellerpilot_prepare_product_market_listing\([\s\S]*?\) from public, anon, authenticated, service_role;\s*revoke all on function public\.sellerpilot_prepare_product_listing\([\s\S]*?\) from public, anon, authenticated, service_role;/,
      "legacy prepare revokes",
    );
    const atomicPrivileges = extractRequiredBlock(
      migration,
      /revoke all on function public\.sellerpilot_service_reserve_and_enqueue_listing_create\([\s\S]*?\) from public, anon, authenticated;\s*grant execute on function public\.sellerpilot_service_reserve_and_enqueue_listing_create\([\s\S]*?\) to service_role;/,
      "atomic create privileges",
    );
    await db.exec(legacyRevokes);
    await db.exec(atomicPrivileges);

    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated','public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)','execute')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role','public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)','execute')",
      ),
      true,
    );
    for (const role of ["authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          `select has_function_privilege('${role}','public.sellerpilot_prepare_product_market_listing(uuid,text,text,text,text,text,numeric)','execute')`,
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          `select has_function_privilege('${role}','public.sellerpilot_prepare_product_listing(uuid,text,text,text,numeric)','execute')`,
        ),
        false,
      );
    }
  } finally {
    await db.close();
  }
});

test("atomic migration orders every listing.create fence before ledger mutation", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const body = extractAtomicFunction(migration);
  const reserveInsert = body.indexOf("insert into sellerpilot_private.product_listings");
  const listingLock = body.indexOf("from sellerpilot_private.product_listings listing", reserveInsert);
  const activeJobFence = body.indexOf("select job.id, job.attempt_id", listingLock);
  const remoteFence = body.indexOf("v_listing.remote_id", activeJobFence);
  const externalActionFence = body.indexOf("v_listing.failure_class = 'external_action'", remoteFence);
  const ledgerMutation = body.indexOf("update sellerpilot_private.product_listings listing", externalActionFence);
  const jobInsert = body.indexOf("insert into sellerpilot_private.channel_gateway_jobs", ledgerMutation);

  assert.ok(reserveInsert >= 0);
  assert.ok(listingLock > reserveInsert);
  assert.ok(activeJobFence > listingLock);
  assert.ok(remoteFence > activeJobFence);
  assert.ok(externalActionFence > remoteFence);
  assert.ok(ledgerMutation > externalActionFence);
  assert.ok(jobInsert > ledgerMutation);
  assert.match(body, /pg_catalog\.pg_advisory_xact_lock\(193674993, 821065042\)/);
  assert.match(body, /attempt\.request_fingerprint = p_request_fingerprint/);
  assert.match(body, /'conflict_attempt_id',[\s\S]*p_attempt_id/);
  assert.match(body, /'listing_id', v_listing\.id/);
});
