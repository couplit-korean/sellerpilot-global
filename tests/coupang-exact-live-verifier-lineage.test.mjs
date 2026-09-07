import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908003000_separate_exact_coupang_live_verifier_lineage.sql",
  import.meta.url,
), "utf8");
const previousMigration = await readFile(new URL(
  "../supabase/migrations/20260907175400_smartstore_repair_adoption_recheck.sql",
  import.meta.url,
), "utf8");
const activeIndexStart = previousMigration.indexOf(
  "create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx",
);
const activeIndexEnd = previousMigration.indexOf("\n\ncreate function", activeIndexStart);
assert.ok(activeIndexStart >= 0 && activeIndexEnd > activeIndexStart);
const activeIndexPreimage = previousMigration.slice(activeIndexStart, activeIndexEnd);

const id = Object.freeze({
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  actor: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  attempt: "d771421b-f408-4f75-addd-03879393fab8",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  source: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  remote: "16375780938",
});
const sellerAccountKey = "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const requestFingerprint = "f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d";

function exactPayload(fingerprint) {
  return {
    periodicKey: `coupang-exact-live:${id.source}`,
    arguments: {
      publicationReviewSourceJobId: id.source,
      sellerpilotReadOnly: true,
      sellerpilotCoupangExactLiveReconciliation: "coupang_exact_live_get_only_v1",
      remoteId: id.remote,
      market: "KR",
      targetId: "",
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: fingerprint,
      publicationExpectedImageCount: 8,
    },
  };
}

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(String.raw`
    create role anon;create role authenticated;create role service_role;
    create schema extensions;create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(id uuid primary key);
    create table sellerpilot_private.channel_operation_attempts(id uuid primary key);
    create table sellerpilot_private.product_listings(
      id uuid primary key,market text,target_id text,updated_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,attempt_id uuid,listing_id uuid,
      channel text,operation text,environment text,request_payload jsonb,
      response_payload jsonb,status text,seller_account_key text,
      request_fingerprint text,created_by uuid,created_at timestamptz,
      updated_at timestamptz,provider_mutation_started_at timestamptz,
      write_resource_kind text,write_resource_key text
    );
    create table sellerpilot_private.coupang_exact_live_verify_runs(
      verifier_job_id uuid primary key,source_job_id uuid unique,
      source_attempt_id uuid,listing_id uuid,remote_id text,
      source_job_sha256 text,source_attempt_sha256 text,
      source_listing_sha256 text,queued_at timestamptz
    );
    create function sellerpilot_private.coupang_exact_live_source_current()
    returns boolean language sql stable as
      'select coalesce(current_setting(''sellerpilot.test_source_current'',true),''true'')=''true''';
    create function public.sellerpilot_service_enqueue_exact_coupang_live_verifier()
    returns uuid language plpgsql as 'begin raise exception ''old enqueue'';end';
    create function sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(
      sellerpilot_private.channel_gateway_jobs
    )returns boolean language sql immutable as 'select false';
    create function sellerpilot_private.qoo10_shipping_s1_activation_job_matches(
      sellerpilot_private.channel_gateway_jobs
    )returns boolean language sql immutable as 'select false';
    create function sellerpilot_private.qoo10_exact_s1_verifier_job_matches(
      sellerpilot_private.channel_gateway_jobs
    )returns boolean language sql immutable as 'select false';
    create function sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(
      sellerpilot_private.channel_gateway_jobs
    )returns boolean language sql immutable as 'select false';
    create function sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
      sellerpilot_private.channel_gateway_jobs
    )returns boolean language sql immutable as 'select false';
    create function sellerpilot_private.smartstore_existing_content_repair_job_matches(
      sellerpilot_private.channel_gateway_jobs
    )returns boolean language sql immutable as 'select false';
  `);
  await db.query("insert into sellerpilot_private.channel_credentials values($1)", [id.credential]);
  await db.query("insert into sellerpilot_private.channel_operation_attempts values($1)", [id.attempt]);
  await db.query(
    "insert into sellerpilot_private.product_listings values($1,'KR','',clock_timestamp())",
    [id.listing],
  );
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,response_payload,status,seller_account_key,request_fingerprint,
    created_by,created_at,updated_at,provider_mutation_started_at
  ) values($1,$2,$3,$4,'coupang','listing.create','production','{}','{}',
    'reconciliation_required',$5,$6,$7,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
  [id.source, id.credential, id.attempt, id.listing, sellerAccountKey,
    requestFingerprint, id.actor]);
  await db.exec(activeIndexPreimage);
  return db;
}

async function insertVerifier(db, {
  candidate,
  payload = exactPayload(requestFingerprint),
  account = sellerAccountKey,
  fingerprint = requestFingerprint,
  actor = id.actor,
}) {
  await db.query(
    "select set_config('sellerpilot.coupang_exact_live_verifier_enqueue',$1,false)",
    [candidate],
  );
  return db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,status,seller_account_key,request_fingerprint,created_by,
    created_at,updated_at
  ) values($1,$2,null,$3,'coupang','listing.publication.verify','production',
    $4,'queued',$5,$6,$7,clock_timestamp(),clock_timestamp())`,
  [candidate, id.credential, id.listing, payload, account, fingerprint, actor]);
}

test("forward migration contains one exact read-only lineage and no mutation/gate update", () => {
  assert.match(migration, /coupang_exact_live_verifier_job_matches/);
  assert.match(migration, /coupang_exact_live_get_only_v1/);
  assert.match(migration, /sellerpilotReadOnly/);
  assert.match(migration, /listing\.publication\.verify/);
  assert.match(migration, /provider_mutation_started_at is null/);
  assert.match(migration, /21eb1892-0894-4f9f-b414-4c9464182dd6/);
  assert.match(migration, new RegExp(sellerAccountKey));
  assert.match(migration, new RegExp(requestFingerprint));
  assert.match(migration, /immutable strict/);
  assert.match(migration,
    /coupang_exact_live_source_current\(\) is not true/);
  const gatewayInserts = migration.match(
    /insert into sellerpilot_private\.channel_gateway_jobs[^;]+;/giu,
  ) ?? [];
  assert.equal(gatewayInserts.length, 1);
  assert.match(gatewayInserts[0], /'listing\.publication\.verify'/u);
  assert.doesNotMatch(gatewayInserts[0], /'listing\.(?:create|update|activate|stop)'/u);
  assert.doesNotMatch(migration, /update sellerpilot_private\.(?:channel_gateway_jobs|channel_operation_attempts)/i);
  assert.doesNotMatch(migration, /mutation_release_gate|set_listing_channel_mutation_release_gate/);
  assert.match(migration, /pg_catalog\.md5\(definition\)<>'72d7d74fc3ad4049850c92b74a051442'/);
});

test("PGlite reproduces the default-lineage collision, then enqueues one immutable exact GET lane", async () => {
  const db = await database();
  const fingerprint = requestFingerprint;
  const payload = exactPayload(fingerprint);
  try {
    await assert.rejects(db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,status,seller_account_key,request_fingerprint,created_by,
      created_at,updated_at
    ) values(gen_random_uuid(),$1,null,$2,'coupang','listing.publication.verify',
      'production',$3,'queued',$4,$5,$6,clock_timestamp(),clock_timestamp())`,
    [id.credential, id.listing, payload, sellerAccountKey, fingerprint, id.actor]),
    /unique|duplicate/i);

    const sourceBefore = (await db.query(
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [id.source],
    )).rows[0].value;
    const attemptBefore = (await db.query(
      "select to_jsonb(attempt) value from sellerpilot_private.channel_operation_attempts attempt where id=$1",
      [id.attempt],
    )).rows[0].value;
    await db.exec(migration);
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    const [first, second] = await Promise.all([
      db.query("select public.sellerpilot_service_enqueue_exact_coupang_live_verifier() id"),
      db.query("select public.sellerpilot_service_enqueue_exact_coupang_live_verifier() id"),
    ]);
    assert.equal(first.rows[0].id, second.rows[0].id);
    const verifier = (await db.query(
      `select * from sellerpilot_private.channel_gateway_jobs
        where id=$1`, [first.rows[0].id],
    )).rows[0];
    assert.equal(verifier.operation, "listing.publication.verify");
    assert.equal(verifier.status, "queued");
    assert.equal(verifier.attempt_id, null);
    assert.equal(verifier.provider_mutation_started_at, null);
    assert.equal(verifier.write_resource_kind, null);
    assert.equal(verifier.request_payload.arguments.sellerpilotReadOnly, true);
    assert.equal(verifier.request_payload.arguments.remoteId, id.remote);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.coupang_exact_live_verify_runs",
    )).rows[0].count, 1);

    assert.deepEqual((await db.query(
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [id.source],
    )).rows[0].value, sourceBefore);
    assert.deepEqual((await db.query(
      "select to_jsonb(attempt) value from sellerpilot_private.channel_operation_attempts attempt where id=$1",
      [id.attempt],
    )).rows[0].value, attemptBefore);
    const indexDefinition = (await db.query(
      "select pg_get_indexdef('sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass) definition",
    )).rows[0].definition;
    assert.match(indexDefinition, /coupang_exact_live_verifier_job_matches/);
    assert.match(indexDefinition, /coupang_exact_live_get_only_v1/);

    const enqueueDefinition = (await db.query(
      `select pg_get_functiondef(
        'public.sellerpilot_service_enqueue_exact_coupang_live_verifier()'::regprocedure
      ) definition`,
    )).rows[0].definition;
    const credentialLock = enqueueDefinition.indexOf(
      "from sellerpilot_private.channel_credentials",
    );
    const sourceRecheck = enqueueDefinition.indexOf(
      "sellerpilot_private.coupang_exact_live_source_current()",
    );
    assert.ok(credentialLock >= 0 && sourceRecheck > credentialLock);
    assert.match(enqueueDefinition,
      /channel_credentials[^;]+for update/is);

    await assert.rejects(db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,status,seller_account_key,request_fingerprint,created_by,
      created_at,updated_at
    ) values(gen_random_uuid(),$1,null,$2,'coupang','listing.publication.verify',
      'production',$3,'queued',$4,$5,$6,clock_timestamp(),clock_timestamp())`,
    [id.credential, id.listing, payload, sellerAccountKey, fingerprint, id.actor]),
    /LINEAGE_INVALID/);

    const alteredMarker = structuredClone(payload);
    alteredMarker.arguments.sellerpilotCoupangExactLiveReconciliation =
      "coupang_exact_live_get_only_v2";
    await assert.rejects(insertVerifier(db, {
      candidate: "10000000-0000-4000-8000-000000000001",
      payload: alteredMarker,
    }), /LINEAGE_INVALID/);
    await assert.rejects(insertVerifier(db, {
      candidate: "10000000-0000-4000-8000-000000000002",
      actor: id.owner,
    }), /LINEAGE_INVALID/);
    await assert.rejects(insertVerifier(db, {
      candidate: "10000000-0000-4000-8000-000000000003",
      account: "d".repeat(64),
    }), /LINEAGE_INVALID/);
    const alteredFingerprint = "b".repeat(64);
    await assert.rejects(insertVerifier(db, {
      candidate: "10000000-0000-4000-8000-000000000004",
      fingerprint: alteredFingerprint,
      payload: exactPayload(alteredFingerprint),
    }), /LINEAGE_INVALID/);
    await db.exec("select set_config('sellerpilot.test_source_current','false',false)");
    await assert.rejects(insertVerifier(db, {
      candidate: "10000000-0000-4000-8000-000000000005",
    }), /LINEAGE_INVALID/);
    await db.exec("select set_config('sellerpilot.test_source_current','true',false)");

    const unrelated = "20000000-0000-4000-8000-000000000001";
    const unrelatedListing = "20000000-0000-4000-8000-000000000002";
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,listing_id,channel,operation,environment,request_payload,status,
      request_fingerprint,created_by,created_at,updated_at
    ) values($1,$2,$3,'coupang','listing.update','production','{}','queued',$4,$5,
      clock_timestamp(),clock_timestamp())`,
    [unrelated, id.credential, unrelatedListing, fingerprint, id.actor]);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='running' where id=$1",
      [unrelated],
    );
    assert.equal((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [unrelated],
    )).rows[0].status, "running");

    await assert.rejects(db.query(
      "update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$1",
      [verifier.id],
    ), /LINEAGE_INVALID/);
    await assert.rejects(db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,listing_id,channel,operation,environment,request_payload,status,
      request_fingerprint,created_by,created_at,updated_at
    ) values(gen_random_uuid(),$1,$2,'coupang','listing.update','production','{}',
      'queued',$3,$4,clock_timestamp(),clock_timestamp())`,
    [id.credential, id.listing, fingerprint, id.actor]), /unique|duplicate/i);
  } finally {
    await db.close();
  }
});

test("PGlite rejects a drifted active-index preimage and rolls every migration change back", async () => {
  const db = await database();
  try {
    await db.exec(`
      drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
      create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
        on sellerpilot_private.channel_gateway_jobs(listing_id)
        where listing_id is not null and status in('queued','running','reconciliation_required');
    `);
    const driftedBefore = (await db.query(
      "select pg_get_indexdef('sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass) definition",
    )).rows[0].definition;
    await assert.rejects(db.exec(migration),
      /COUPANG_EXACT_LIVE_ACTIVE_LINEAGE_PREIMAGE_DRIFT/);
    await db.exec("rollback");
    const driftedAfter = (await db.query(
      "select pg_get_indexdef('sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass) definition",
    )).rows[0].definition;
    assert.equal(driftedAfter, driftedBefore);
    assert.equal((await db.query(
      "select to_regprocedure('sellerpilot_private.coupang_exact_live_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)') value",
    )).rows[0].value, null);
    const oldEnqueue = (await db.query(
      `select pg_get_functiondef(
        'public.sellerpilot_service_enqueue_exact_coupang_live_verifier()'::regprocedure
      ) definition`,
    )).rows[0].definition;
    assert.match(oldEnqueue, /old enqueue/);
  } finally {
    await db.close();
  }
});
