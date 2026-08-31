import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831057300_retire_failed_exact_qoo10_s1_activation_permit.sql",
  import.meta.url,
);

function functionDefinition(sql, signature) {
  const start = sql.indexOf(`create function ${signature}`);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${signature}`);
  return sql.slice(start, end + 4);
}

function indexDefinition(sql, name) {
  const start = sql.indexOf(`create unique index ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = sql.indexOf(";", start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return sql.slice(start, end + 1);
}

async function scalar(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

test("573 pins the exact failed-before-provider evidence and preserves every immutable ledger", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /migration\.version = '20260831057200'/);
  assert.match(sql, /migration\.version = '20260831057300'/);
  assert.match(sql, /d32fc569d88ecf21e069e39fd451b7af207be8c0d1ac6d8bb106f3862c8ee7f9/);
  assert.match(sql, /c5286ff848adfd2e30be7376c6563f6b298d685e6daea26a7a5b2bb5e04d2260/);
  assert.equal(
    (sql.match(/968b6336c02432bd790445b90902548f6182e3b4128d2c533151d95c90347b06/g) ?? []).length,
    2,
    "572 provider-boundary fingerprint must be pinned before and after 573",
  );
  assert.match(sql, /5f72b59b4ac2dfb4601472f218d4d428/);
  assert.match(sql, /735d1bf88e8e213fb144b1099bacb068/);
  assert.match(sql, /7ec26a02-0507-4385-8da6-ccd393891556/);
  assert.match(sql, /69137e9b-b888-4f4e-9ae6-c7b262943b1b/);
  assert.match(sql, /c6554bb1d891af5367c9df3d0b3d3e5f5d092614e6d8113a4f10e3845be25db9/);
  assert.match(sql, /7312499def14d2bf03937d3e6e4a55faed7ea57867fe72dc697f9629bd0fde2a/);
  assert.match(sql, /c73b8cf53aabbbdf58c20594250dc99dc289ffdfd7b142712eedf983477c76ee/);
  assert.match(sql, /receipt\.continuation_job_id is null/);
  assert.match(sql, /select pg_catalog\.count\(\*\)[\s\S]*gateway_completion_receipts[\s\S]*= 1/);
  assert.match(sql, /attempt\.status = 'failed'/);
  assert.match(sql, /attempt\.http_status = 422/);
  assert.match(sql, /attempt\.gateway_write_required/);
  assert.match(sql, /not attempt\.pre_gateway_retryable/);
  assert.match(sql, /job\.provider_mutation_started_at is null/);
  assert.match(sql, /job\.response_payload is null/);
  assert.match(sql, /permit\.consumed_at is null/);
  assert.match(sql, /outcome\.terminal_status = 'failed'/);
  assert.match(sql, /outcome\.activation_response_sha256 is null/);
  assert.match(sql, /outcome\.provider_status is null/);
  assert.match(sql, /outcome\.remote_visibility is null/);
  assert.match(sql, /outcome\.verified_at is null/);
  assert.match(sql, /invalidation_reason = 'expired_before_claim'/);
  assert.match(sql, /invalidation_reason = 'failed_before_provider'/);

  assert.match(
    sql,
    /drop constraint qoo10_exact_s1_activation_outcomes_source_job_id_key/,
  );
  assert.match(
    sql,
    /drop constraint qoo10_exact_s1_activation_outcomes_listing_id_key/,
  );
  assert.doesNotMatch(
    sql,
    /drop constraint qoo10_exact_s1_activation_outcomes_verifier_job_id_key/,
  );
  assert.match(sql, /block_qoo10_exact_s1_activation_outcome_change/);
  assert.equal(
    sql.match(/qoo10_exact_s1_failed_before_provider_retired\(/g)?.length >= 5,
    true,
    "helper must be installed, used by both enqueue RPCs, and checked after the patch",
  );

  for (const untouched of [
    "channel_gateway_jobs",
    "channel_operation_attempts",
    "gateway_completion_receipts",
    "qoo10_exact_s1_activation_outcomes",
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`update\\s+sellerpilot_private\\.${untouched}`, "i"),
      `${untouched} must remain byte-immutable`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`delete\\s+from\\s+sellerpilot_private\\.${untouched}`, "i"),
      `${untouched} must not be deleted`,
    );
  }
  assert.equal(
    (sql.match(/update sellerpilot_private\.qoo10_exact_s1_activation_permits/g) ?? []).length,
    1,
    "only the one exact permit data row may be updated",
  );
});

test("retired helper requires the full receipt, attempt, outcome, and no-provider matrix", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const jobId = "10000000-0000-4000-8000-000000000001";
  const attemptId = "10000000-0000-4000-8000-000000000002";
  const verifierId = "10000000-0000-4000-8000-000000000003";
  const sourceId = "10000000-0000-4000-8000-000000000004";
  const listingId = "10000000-0000-4000-8000-000000000005";
  const credentialId = "10000000-0000-4000-8000-000000000006";
  const ownerId = "10000000-0000-4000-8000-000000000007";
  const workerId = "10000000-0000-4000-8000-000000000008";
  const claimId = "10000000-0000-4000-8000-000000000009";
  const sellerKey = "seller-key";
  const resourceKey = "b".repeat(64);
  const requestPayload = { arguments: { exact: true } };

  try {
    await db.exec(`
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8') end
      $$;
      create schema sellerpilot_private;
      create table sellerpilot_private.qoo10_exact_s1_activation_permits (
        activation_job_id uuid primary key,
        activation_attempt_id uuid not null,
        verifier_job_id uuid not null,
        source_job_id uuid not null,
        listing_id uuid not null,
        credential_id uuid not null,
        owner_id uuid not null,
        remote_id text not null,
        seller_account_key text not null,
        release_sha text not null,
        activation_request_sha256 text not null,
        activation_request_bytes integer not null,
        write_resource_key text not null,
        contract text not null,
        armed_at timestamptz not null,
        expires_at timestamptz not null,
        bound_at timestamptz,
        bound_worker_token_id uuid,
        bound_claim_token uuid,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        invalidation_reason text
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_outcomes (
        activation_job_id uuid primary key,
        source_job_id uuid not null,
        verifier_job_id uuid not null unique,
        listing_id uuid not null,
        remote_id text not null,
        terminal_status text not null,
        activation_response_sha256 text,
        activation_response_bytes integer,
        provider_status text,
        remote_visibility text,
        verified_at timestamptz,
        completed_at timestamptz not null,
        contract text not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        credential_id uuid not null,
        attempt_id uuid,
        listing_id uuid,
        channel text not null,
        operation text not null,
        environment text not null,
        request_payload jsonb not null,
        response_payload jsonb,
        status text not null,
        worker_token_id uuid,
        attempt_count integer not null,
        lease_expires_at timestamptz,
        claim_token uuid,
        provider_mutation_started_at timestamptz,
        request_fingerprint text,
        write_resource_kind text,
        write_resource_key text,
        seller_account_key text,
        started_at timestamptz,
        completed_at timestamptz
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
        started_at timestamptz,
        completed_at timestamptz,
        seller_account_key text,
        gateway_write_required boolean not null,
        pre_gateway_retryable boolean not null
      );
      create table sellerpilot_private.gateway_completion_receipts (
        job_id uuid primary key,
        claim_token uuid not null,
        worker_token_id uuid not null,
        completion_fingerprint text not null,
        continuation_job_id uuid
      );
    `);
    await db.exec(functionDefinition(
      sql,
      "sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired",
    ));
    await db.exec(indexDefinition(
      sql,
      "qoo10_exact_s1_one_decisive_source_outcome",
    ));
    await db.exec(indexDefinition(
      sql,
      "qoo10_exact_s1_one_decisive_listing_outcome",
    ));

    const requestFingerprint = await scalar(
      db,
      "select encode(extensions.digest($1::jsonb::text,'sha256'),'hex') value",
      [JSON.stringify(requestPayload)],
    );
    await db.query(`
      insert into sellerpilot_private.qoo10_exact_s1_activation_permits (
        activation_job_id,activation_attempt_id,verifier_job_id,source_job_id,
        listing_id,credential_id,owner_id,remote_id,seller_account_key,
        release_sha,activation_request_sha256,activation_request_bytes,
        write_resource_key,contract,armed_at,expires_at,bound_at,
        bound_worker_token_id,bound_claim_token
      ) values (
        $1,$2,$3,$4,$5,$6,$7,'remote',$8,$9,$10,
        octet_length($11::jsonb::text),$12,'qoo10_exact_s1_activation_permit_v1',
        '2026-01-01T00:00:00Z','2026-01-01T00:02:00Z',
        '2026-01-01T00:00:30Z',$13,$14
      )
    `, [
      jobId, attemptId, verifierId, sourceId, listingId, credentialId, ownerId,
      sellerKey, "a".repeat(40), requestFingerprint,
      JSON.stringify(requestPayload), resourceKey, workerId, claimId,
    ]);
    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs values (
        $1,$2,$3,$4,'qoo10','listing.activate','production',$5::jsonb,null,
        'failed',null,1,null,null,null,$6,'listing_mutation',$7,$8,
        '2026-01-01T00:00:30Z','2026-01-01T00:01:00Z'
      )
    `, [
      jobId, credentialId, attemptId, listingId, JSON.stringify(requestPayload),
      requestFingerprint, resourceKey, sellerKey,
    ]);
    await db.query(`
      insert into sellerpilot_private.channel_operation_attempts values (
        $1,$2,$3,'qoo10','listing.activate',$4,'failed',422,
        '2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',$5,true,false
      )
    `, [attemptId, ownerId, credentialId, requestFingerprint, sellerKey]);
    await db.query(`
      insert into sellerpilot_private.gateway_completion_receipts values (
        $1,$2,$3,$4,null
      )
    `, [jobId, claimId, workerId, "c".repeat(64)]);
    await db.query(`
      insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes values (
        $1,$2,$3,$4,'remote','failed',null,null,null,null,null,
        '2026-01-01T00:01:00Z','qoo10_exact_s1_activation_outcome_v1'
      )
    `, [jobId, sourceId, verifierId, listingId]);

    const helperSql = `select
      sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired($1) value`;
    assert.equal(await scalar(db, helperSql, [jobId]), false, "active permit is not retryable");
    await db.query(`
      update sellerpilot_private.qoo10_exact_s1_activation_permits
         set invalidated_at='2026-01-01T00:03:00Z',
             invalidation_reason='failed_before_provider'
       where activation_job_id=$1
    `, [jobId]);
    assert.equal(await scalar(db, helperSql, [jobId]), true);

    const negativeCases = [
      ["update sellerpilot_private.gateway_completion_receipts set continuation_job_id=$2 where job_id=$1", jobId, "10000000-0000-4000-8000-000000000099"],
      ["update sellerpilot_private.gateway_completion_receipts set claim_token=$2 where job_id=$1", jobId, "10000000-0000-4000-8000-000000000098"],
      ["update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at='2026-01-01T00:00:40Z' where id=$1", jobId, undefined],
      ["update sellerpilot_private.qoo10_exact_s1_activation_permits set consumed_at='2026-01-01T00:00:40Z' where activation_job_id=$1", jobId, undefined],
      ["update sellerpilot_private.qoo10_exact_s1_activation_outcomes set activation_response_sha256=$2 where activation_job_id=$1", jobId, "d".repeat(64)],
      ["update sellerpilot_private.channel_operation_attempts set http_status=500 where id=$1", attemptId, undefined],
    ];
    for (const [statement, targetId, value] of negativeCases) {
      await db.exec("begin");
      await db.query(statement, value === undefined ? [targetId] : [targetId, value]);
      assert.equal(await scalar(db, helperSql, [jobId]), false, statement);
      await db.exec("rollback");
    }
  } finally {
    await db.close();
  }
});

test("payloadless retired failures coexist with one and only one decisive terminal outcome", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.qoo10_exact_s1_activation_outcomes (
        activation_job_id uuid primary key,
        source_job_id uuid not null,
        verifier_job_id uuid not null unique,
        listing_id uuid not null,
        terminal_status text not null,
        activation_response_sha256 text,
        activation_response_bytes integer,
        provider_status text,
        remote_visibility text,
        verified_at timestamptz
      );
    `);
    await db.exec(indexDefinition(
      sql,
      "qoo10_exact_s1_one_decisive_source_outcome",
    ));
    await db.exec(indexDefinition(
      sql,
      "qoo10_exact_s1_one_decisive_listing_outcome",
    ));

    const source = "20000000-0000-4000-8000-000000000001";
    const listing = "20000000-0000-4000-8000-000000000002";
    await db.query(`insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes
      values ($1,$2,$3,$4,'failed',null,null,null,null,null)`, [
      "20000000-0000-4000-8000-000000000003", source,
      "20000000-0000-4000-8000-000000000004", listing,
    ]);
    await db.query(`insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes
      values ($1,$2,$3,$4,'succeeded',$5,100,'S2','live',now())`, [
      "20000000-0000-4000-8000-000000000005", source,
      "20000000-0000-4000-8000-000000000006", listing, "a".repeat(64),
    ]);
    await assert.rejects(
      db.query(`insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes
        values ($1,$2,$3,$4,'reconciliation_required',null,null,null,null,null)`, [
        "20000000-0000-4000-8000-000000000007", source,
        "20000000-0000-4000-8000-000000000008", listing,
      ]),
      /unique|duplicate/i,
      "succeeded and reconciliation-required outcomes remain mutually terminal",
    );

    const explicitSource = "20000000-0000-4000-8000-000000000011";
    const explicitListing = "20000000-0000-4000-8000-000000000012";
    await db.query(`insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes
      values ($1,$2,$3,$4,'failed',$5,120,'S1','non_public',null)`, [
      "20000000-0000-4000-8000-000000000013", explicitSource,
      "20000000-0000-4000-8000-000000000014", explicitListing, "b".repeat(64),
    ]);
    await assert.rejects(
      db.query(`insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes
        values ($1,$2,$3,$4,'succeeded',$5,140,'S2','live',now())`, [
        "20000000-0000-4000-8000-000000000015", explicitSource,
        "20000000-0000-4000-8000-000000000016", explicitListing, "c".repeat(64),
      ]),
      /unique|duplicate/i,
      "an explicit provider no-write failure remains a decisive terminal outcome",
    );
  } finally {
    await db.close();
  }
});
