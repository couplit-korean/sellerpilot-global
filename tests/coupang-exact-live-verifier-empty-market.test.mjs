import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const lineageMigration = await readFile(new URL(
  "../supabase/migrations/20260908003000_separate_exact_coupang_live_verifier_lineage.sql",
  import.meta.url,
), "utf8");
const marketMigration = await readFile(new URL(
  "../supabase/migrations/20260908004500_fix_exact_coupang_live_verifier_empty_market.sql",
  import.meta.url,
), "utf8");
const previousMigration = await readFile(new URL(
  "../supabase/migrations/20260907175400_smartstore_repair_adoption_recheck.sql",
  import.meta.url,
), "utf8");
const indexStart = previousMigration.indexOf(
  "create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx",
);
const indexEnd = previousMigration.indexOf("\n\ncreate function", indexStart);
assert.ok(indexStart >= 0 && indexEnd > indexStart);
const indexPreimage = previousMigration.slice(indexStart, indexEnd);

const exact = Object.freeze({
  actor: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  attempt: "d771421b-f408-4f75-addd-03879393fab8",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  source: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  remote: "16375780938",
  account: "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd",
  fingerprint: "f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d",
});

function payload(market) {
  return {
    periodicKey: `coupang-exact-live:${exact.source}`,
    arguments: {
      publicationReviewSourceJobId: exact.source,
      sellerpilotReadOnly: true,
      sellerpilotCoupangExactLiveReconciliation: "coupang_exact_live_get_only_v1",
      remoteId: exact.remote,
      market,
      targetId: "",
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: exact.fingerprint,
      publicationExpectedImageCount: 8,
    },
  };
}

async function fixture() {
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
    create table sellerpilot_private.coupang_exact_live_verify_receipts(
      verifier_job_id uuid primary key
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
  await db.query("insert into sellerpilot_private.channel_credentials values($1)",
    [exact.credential]);
  await db.query("insert into sellerpilot_private.channel_operation_attempts values($1)",
    [exact.attempt]);
  await db.query(
    "insert into sellerpilot_private.product_listings values($1,'','',clock_timestamp())",
    [exact.listing],
  );
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,response_payload,status,seller_account_key,request_fingerprint,
    created_by,created_at,updated_at,provider_mutation_started_at
  ) values($1,$2,$3,$4,'coupang','listing.create','production','{}','{}',
    'reconciliation_required',$5,$6,$7,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
  [exact.source, exact.credential, exact.attempt, exact.listing,
    exact.account, exact.fingerprint, exact.actor]);
  await db.exec(indexPreimage);
  await db.exec(lineageMigration);
  return db;
}

async function directVerifier(db, candidate, market, requestPayload = payload(market)) {
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
  [candidate, exact.credential, exact.listing, requestPayload, exact.account,
    exact.fingerprint, exact.actor]);
}

test("forward patch pins the live preimage and only changes exact market matching", () => {
  const matcherSql = marketMigration.match(
    /create or replace function sellerpilot_private\.coupang_exact_live_verifier_job_matches[\s\S]+?\$\$;/u,
  )?.[0];
  assert.ok(matcherSql);
  assert.match(marketMigration, /4c9eb100e6c7ac8bdcc513cdf859a0de/);
  assert.match(marketMigration, /66ed2bd8561f3b5e9d68f29837bc8785/);
  assert.match(matcherSql,
    /request_payload#>>'\{arguments,market\}'=''/);
  assert.match(matcherSql,
    /request_payload#>>'\{arguments,targetId\}'=''/);
  assert.doesNotMatch(matcherSql,
    /request_payload#>>'\{arguments,market\}'='KR'/);
  assert.match(marketMigration, /coupang_exact_live_source_current\(\) is not true/);
  assert.match(marketMigration, /coupang_exact_live_verify_runs/);
  assert.match(marketMigration, /coupang_exact_live_verify_receipts/);
  assert.match(marketMigration, /reindex index sellerpilot_private\.channel_gateway_jobs_one_active_listing_or_lineage_idx/);
  assert.doesNotMatch(marketMigration,
    /insert into sellerpilot_private\.channel_gateway_jobs/);
  assert.doesNotMatch(marketMigration,
    /mutation_release_gate|set_listing_channel_mutation_release_gate/);
});

test("PGlite applies 003000 then the patch and enqueues the empty-market verifier", async () => {
  const db = await fixture();
  try {
    const hashes = (await db.query(`select
      md5(pg_get_indexdef(
        'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass
      )) index_md5,
      md5(pg_get_functiondef(
        'sellerpilot_private.coupang_exact_live_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
      )) matcher_md5`)).rows[0];
    assert.deepEqual(hashes, {
      index_md5: "4c9eb100e6c7ac8bdcc513cdf859a0de",
      matcher_md5: "66ed2bd8561f3b5e9d68f29837bc8785",
    });
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    await assert.rejects(db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_live_verifier()",
    ), /LINEAGE_INVALID/);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.coupang_exact_live_verify_runs",
    )).rows[0].count, 0);

    await db.exec(marketMigration);
    const verifierId = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_live_verifier() id",
    )).rows[0].id;
    const verifier = (await db.query(
      "select * from sellerpilot_private.channel_gateway_jobs where id=$1",
      [verifierId],
    )).rows[0];
    assert.equal(verifier.request_payload.arguments.market, "");
    assert.equal(verifier.operation, "listing.publication.verify");
    assert.equal(verifier.provider_mutation_started_at, null);
    assert.equal((await db.query(
      "select sellerpilot_private.coupang_exact_live_verifier_job_matches(job) matched from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [verifierId],
    )).rows[0].matched, true);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.coupang_exact_live_verify_runs",
    )).rows[0].count, 1);

    await assert.rejects(directVerifier(
      db,
      "30000000-0000-4000-8000-000000000001",
      "KR",
    ), /LINEAGE_INVALID/);
    const missingTarget = payload("");
    delete missingTarget.arguments.targetId;
    await assert.rejects(directVerifier(
      db,
      "30000000-0000-4000-8000-000000000002",
      "",
      missingTarget,
    ), /LINEAGE_INVALID/);
    const nullTarget = payload("");
    nullTarget.arguments.targetId = null;
    await assert.rejects(directVerifier(
      db,
      "30000000-0000-4000-8000-000000000003",
      "",
      nullTarget,
    ), /LINEAGE_INVALID/);
  } finally {
    await db.close();
  }
});

test("PGlite rolls the patch back when its matcher preimage drifts", async () => {
  const db = await fixture();
  try {
    await db.exec(`create or replace function
      sellerpilot_private.coupang_exact_live_verifier_job_matches(
        job sellerpilot_private.channel_gateway_jobs
      ) returns boolean language sql immutable strict set search_path=''
      as 'select false'`);
    await assert.rejects(db.exec(marketMigration),
      /COUPANG_EXACT_LIVE_EMPTY_MARKET_PREIMAGE_DRIFT/);
    await db.exec("rollback");
    const matcherDefinition = (await db.query(`select pg_get_functiondef(
      'sellerpilot_private.coupang_exact_live_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
    ) definition`)).rows[0].definition;
    assert.match(matcherDefinition, /select false/);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.coupang_exact_live_verify_runs",
    )).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("PGlite rejects a second active lineage in the exact listing scope", async () => {
  const db = await fixture();
  try {
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,listing_id,channel,operation,environment,request_payload,
      status,request_fingerprint,created_by,created_at,updated_at
    ) values('40000000-0000-4000-8000-000000000001',$1,$2,'temu',
      'listing.publication.verify','production',$3,'queued',$4,$5,
      clock_timestamp(),clock_timestamp())`, [
      exact.credential,
      exact.listing,
      {
        arguments: {
          sellerpilotTemuContainmentDiscovery: {
            version: "temu_safe_test_containment_discovery_v1",
          },
          sellerpilotReadOnly: true,
        },
      },
      exact.fingerprint,
      exact.actor,
    ]);
    await assert.rejects(db.exec(marketMigration),
      /COUPANG_EXACT_LIVE_EMPTY_MARKET_SOURCE_DRIFT/);
    await db.exec("rollback");
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.channel_gateway_jobs where listing_id=$1
       and status in('queued','running','reconciliation_required')`,
    [exact.listing])).rows[0].count, 2);
  } finally {
    await db.close();
  }
});
