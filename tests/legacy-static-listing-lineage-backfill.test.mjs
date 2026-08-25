import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const backfillMigrationUrl = new URL(
  "../supabase/migrations/20260825111830_backfill_verified_static_listing_lineage.sql",
  import.meta.url,
);
const lineageMigrationUrl = new URL(
  "../supabase/migrations/20260825111800_bind_listing_seller_accounts.sql",
  import.meta.url,
);

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const STATIC_KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end > start, `${signature} must have a complete body`);
  return source.slice(start, end + "\n$$;".length);
}

async function setupFixture(db, lineageMigration) {
  const readbackFunction = extractFunction(
    lineageMigration,
    "create or replace function sellerpilot_private.gateway_listing_create_readback_verified",
  );

  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      seller_account_key text,
      seller_account_key_source text not null,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      request_fingerprint text not null,
      status text not null,
      remote_id text,
      seller_account_key text
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      channel_key text not null,
      status text not null,
      remote_id text,
      marketplace_sku text,
      operation_attempt_id uuid,
      seller_account_key text
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
      request_fingerprint text,
      response_payload jsonb,
      status text not null,
      seller_account_key text,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    );
    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      safe_detail jsonb not null,
      created_at timestamptz not null default now()
    );

    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      return new;
    end;
    $$;
    create trigger guard_product_listing_seller_lineage
    before update on sellerpilot_private.product_listings
    for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();
  `);
  await db.exec(readbackFunction);
}

function readbackStep(channel) {
  return {
    qoo10: "detail-image-readback",
    elevenst: "product-readback",
    coupang: "listing-readback",
    smartstore: "product-readback",
    lazada: "listing-readback",
  }[channel] ?? "listing-readback";
}

async function seedEvidence(db, {
  index,
  channel = "qoo10",
  credentialSource = "credential_incarnation_v1",
  credentialKey = STATIC_KEY,
  credentialVerified = true,
  listingStatus = "published",
  attemptStatus = "succeeded",
  listingRemote = `remote-${index}`,
  attemptRemote = listingRemote,
  responseRemote = listingRemote,
  stepName = readbackStep(channel),
  stepOk = true,
  jobStatus = "succeeded",
  jobCount = 1,
  jobListingBound = true,
  jobRequestFingerprint = null,
  jobSellerKey = null,
  listingSellerKey = null,
}) {
  const credentialId = uuid(1000 + index);
  const attemptId = uuid(2000 + index);
  const listingId = uuid(3000 + index);
  const requestFingerprint = String((index % 9) + 1).repeat(64);

  await db.query(
    `insert into sellerpilot_private.channel_credentials(
       id, channel, environment, seller_account_key, seller_account_key_source,
       seller_account_verified_at
     ) values ($1,$2,'production',$3,$4,$5)`,
    [
      credentialId,
      channel,
      credentialKey,
      credentialSource,
      credentialVerified ? new Date().toISOString() : null,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id, owner_id, credential_id, channel, operation, request_fingerprint,
       status, remote_id, seller_account_key
     ) values ($1,$2,$3,$4,'listing.create',$5,$6,$7,null)`,
    [attemptId, OWNER_ID, credentialId, channel, requestFingerprint, attemptStatus, attemptRemote],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id, owner_id, channel_key, status, remote_id, operation_attempt_id,
       seller_account_key
     ) values ($1,$2,$3,$4,$5,$6,$7)`,
    [listingId, OWNER_ID, channel, listingStatus, listingRemote, attemptId, listingSellerKey],
  );

  for (let offset = 0; offset < jobCount; offset += 1) {
    const responsePayload = {
      ok: true,
      remoteId: responseRemote,
      steps: [{ name: stepName, ok: stepOk }],
    };
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
         id, credential_id, attempt_id, listing_id, channel, operation,
         environment, request_fingerprint, response_payload, status,
         seller_account_key, completed_at
       ) values ($1,$2,$3,$4,$5,'listing.create','production',$6,$7::jsonb,$8,$9,now())`,
      [
        uuid(40000 + (index * 10) + offset),
        credentialId,
        attemptId,
        jobListingBound ? listingId : null,
        channel,
        jobRequestFingerprint,
        JSON.stringify(responsePayload),
        jobStatus,
        jobSellerKey,
      ],
    );
  }

  return { credentialId, attemptId, listingId, requestFingerprint };
}

async function listingKeys(db) {
  const result = await db.query(
    `select id::text, seller_account_key, status, remote_id
       from sellerpilot_private.product_listings
      order by id`,
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

test("controlled backfill binds only unambiguous static listing.create readbacks", async () => {
  const [migration, lineageMigration] = await Promise.all([
    readFile(backfillMigrationUrl, "utf8"),
    readFile(lineageMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  await db.waitReady;

  try {
    await setupFixture(db, lineageMigration);

    const eligible = [];
    for (const [offset, channel] of ["qoo10", "elevenst", "coupang", "smartstore"].entries()) {
      eligible.push(await seedEvidence(db, {
        index: 10 + offset,
        channel,
        jobListingBound: offset !== 0,
      }));
    }
    const oauth = await seedEvidence(db, {
      index: 20,
      channel: "lazada",
      credentialSource: "provider_certified_v1",
    });
    const wrongSource = await seedEvidence(db, {
      index: 21,
      channel: "coupang",
      credentialSource: "provider_certified_v1",
    });
    const wrongRemote = await seedEvidence(db, {
      index: 22,
      responseRemote: "different-remote",
    });
    const missingReadback = await seedEvidence(db, {
      index: 23,
      stepName: "listing-create",
    });
    const ambiguous = await seedEvidence(db, {
      index: 24,
      jobCount: 2,
    });
    const failedAttempt = await seedEvidence(db, {
      index: 25,
      attemptStatus: "failed",
    });
    const notPublished = await seedEvidence(db, {
      index: 26,
      listingStatus: "paused",
    });
    const badFingerprint = await seedEvidence(db, {
      index: 27,
      jobRequestFingerprint: "f".repeat(64),
    });
    const alreadyBound = await seedEvidence(db, {
      index: 28,
      listingSellerKey: OTHER_KEY,
    });

    await db.exec(migration);

    const rows = await listingKeys(db);
    for (const evidence of eligible) {
      assert.equal(rows.get(evidence.listingId).seller_account_key, STATIC_KEY);
      assert.equal(rows.get(evidence.listingId).status, "published");
    }
    for (const evidence of [
      oauth,
      wrongSource,
      wrongRemote,
      missingReadback,
      ambiguous,
      failedAttempt,
      notPublished,
      badFingerprint,
    ]) {
      assert.equal(rows.get(evidence.listingId).seller_account_key, null);
    }
    assert.equal(rows.get(alreadyBound.listingId).seller_account_key, OTHER_KEY);

    const audit = await db.query(
      `select action, entity_id, safe_detail
         from sellerpilot_private.operation_audit
        order by entity_id`,
    );
    assert.equal(audit.rows.length, eligible.length);
    assert.ok(audit.rows.every((row) => row.action === "listing_lineage_backfilled"));
    assert.ok(audit.rows.every(
      (row) => row.safe_detail.evidence === "exact_static_listing_create_readback_v1",
    ));

    const oneShotFunction = await db.query(
      "select to_regprocedure('sellerpilot_private.backfill_verified_static_listing_lineage()') as function_name",
    );
    assert.equal(oneShotFunction.rows[0].function_name, null);
    const triggerState = await db.query(
      `select trigger.tgenabled
         from pg_trigger trigger
         join pg_class relation on relation.oid = trigger.tgrelid
         join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'sellerpilot_private'
          and relation.relname = 'product_listings'
          and trigger.tgname = 'guard_product_listing_seller_lineage'`,
    );
    assert.deepEqual(triggerState.rows, [{ tgenabled: "O" }]);
    const servicePrivilege = await db.query(
      `select has_function_privilege(
         'service_role',
         'sellerpilot_private.verified_static_listing_lineage_key(uuid)',
         'EXECUTE'
       ) as allowed`,
    );
    assert.equal(servicePrivilege.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});

test("normal writes cannot invoke the one-shot static lineage path", async () => {
  const [migration, lineageMigration] = await Promise.all([
    readFile(backfillMigrationUrl, "utf8"),
    readFile(lineageMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  await db.waitReady;

  try {
    await setupFixture(db, lineageMigration);
    await db.exec(migration);
    const later = await seedEvidence(db, { index: 50, channel: "qoo10" });

    await assert.rejects(
      db.query(
        "update sellerpilot_private.product_listings set seller_account_key = $2 where id = $1",
        [later.listingId, STATIC_KEY],
      ),
      /terminal listing seller account mismatch|verified listing create completion required/,
    );
  } finally {
    await db.close();
  }
});

test("migration keeps OAuth excluded and never disables lineage triggers", async () => {
  const [migration, lineageMigration] = await Promise.all([
    readFile(backfillMigrationUrl, "utf8"),
    readFile(lineageMigrationUrl, "utf8"),
  ]);

  assert.match(
    migration,
    /channel_key in \('coupang', 'elevenst', 'qoo10', 'smartstore'\)/,
  );
  assert.match(migration, /credential_incarnation_v1/);
  assert.match(migration, /gateway_listing_create_readback_verified/);
  assert.match(migration, /response_payload->>'remoteId'/);
  assert.match(migration, /having count\(\*\) = 1/);
  assert.match(migration, /drop function sellerpilot_private\.backfill_verified_static_listing_lineage\(\)/);
  assert.doesNotMatch(migration, /disable\s+trigger/i);
  assert.doesNotMatch(migration, /drop\s+trigger/i);
  assert.doesNotMatch(
    migration.match(/with exact_candidates[\s\S]*?\n\$\$;/)?.[0] ?? "",
    /'shopee'|'lazada'|'ebay'/,
  );

  const originalGuard = extractFunction(
    lineageMigration,
    "create or replace function sellerpilot_private.guard_product_listing_seller_lineage",
  );
  let backfillGuard = extractFunction(
    migration,
    "create or replace function sellerpilot_private.guard_product_listing_seller_lineage",
  ).replace("  v_backfill_key text;\n", "");
  const branchStart = backfillGuard.indexOf(
    "  if old.seller_account_key is null\n     and new.seller_account_key is not null",
  );
  const normalGuardStart = backfillGuard.indexOf(
    "  if old.marketplace_sku is not null",
    branchStart,
  );
  assert.ok(branchStart > 0 && normalGuardStart > branchStart);
  backfillGuard = backfillGuard.slice(0, branchStart) + backfillGuard.slice(normalGuardStart);
  assert.equal(
    backfillGuard,
    originalGuard,
    "the controlled branch must not weaken normal listing-lineage protections",
  );
});
