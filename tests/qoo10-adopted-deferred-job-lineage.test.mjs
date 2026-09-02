import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260902102000_fix_qoo10_adopted_deferred_job_lineage.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const sellerAccountKey =
  "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const observationSha256 = "c".repeat(64);
const prewriteSnapshotSha256 = "d".repeat(64);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

function payload() {
  return {
    arguments: {
      sellerpilotQoo10ExactLocalization: {
        contract: "qoo10_exact_localization_update_v2",
        releaseSha,
      },
      sellerpilotQoo10AdoptedLocalization: {
        contract: "qoo10_exact_adopted_live_localization_v1",
        observationSha256,
        prewriteSnapshotSha256,
      },
    },
  };
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable as $$
      select case when lower(algorithm) = 'sha256'
        then sha256(convert_to(value, 'UTF8'))
        else convert_to(md5(value || algorithm), 'UTF8')
      end
    $$;
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      attempt_id uuid not null,
      listing_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      environment text not null,
      status text not null,
      seller_account_key text not null,
      request_fingerprint text,
      request_payload jsonb not null,
      response_payload jsonb,
      error_message text,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.qoo10_exact_localization_update_permits (
      permit_id uuid primary key,
      update_job_id uuid,
      update_attempt_id uuid,
      listing_id uuid not null,
      credential_id uuid not null,
      seller_account_key text not null,
      release_sha text not null,
      request_fingerprint text not null,
      arguments_sha256 text,
      arguments_bytes integer,
      request_payload_sha256 text,
      request_payload_bytes integer,
      invalidated_at timestamptz,
      lineage_contract text,
      adoption_observation_sha256 text,
      prewrite_snapshot_sha256 text
    );
    create table
      sellerpilot_private.qoo10_exact_partial_manual_reconciliations (
        source_job_id uuid, source_attempt_id uuid, listing_id uuid,
        credential_id uuid, remote_id text, resolution text,
        provider_call_replayed boolean
      );
    create table sellerpilot_private.qoo10_exact_no_effect_reconciliations (
      source_job_id uuid, source_attempt_id uuid, listing_id uuid,
      credential_id uuid, remote_id text, resolution text,
      provider_call_replayed boolean
    );
    create table sellerpilot_private.qoo10_exact_already_live_adoptions (
      source_job_id uuid, source_attempt_id uuid, listing_id uuid,
      credential_id uuid, remote_id text, provider_status text,
      remote_visibility text, purchase_available boolean,
      provider_call_replayed boolean, external_write_count integer
    );

    create function
      sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
        value jsonb, expected_release_sha text
      ) returns boolean language sql immutable as $$
        select value#>>'{sellerpilotQoo10ExactLocalization,contract}' =
                 'qoo10_exact_localization_update_v2'
          and value#>>'{sellerpilotQoo10ExactLocalization,releaseSha}' =
                expected_release_sha
      $$;
    create function
      sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
        value jsonb, expected_release_sha text,
        expected_observation_sha256 text,
        expected_prewrite_snapshot_sha256 text
      ) returns boolean language sql immutable as $$
        select value#>>'{sellerpilotQoo10ExactLocalization,releaseSha}' =
                 expected_release_sha
          and value#>>'{sellerpilotQoo10AdoptedLocalization,contract}' =
                'qoo10_exact_adopted_live_localization_v1'
          and value#>>'{sellerpilotQoo10AdoptedLocalization,observationSha256}' =
                expected_observation_sha256
          and value#>>'{sellerpilotQoo10AdoptedLocalization,prewriteSnapshotSha256}' =
                expected_prewrite_snapshot_sha256
      $$;
  `);
  await db.exec(migration);
  await db.exec(`
    create constraint trigger guard_qoo10_exact_localization_update_job
    after insert or update on sellerpilot_private.channel_gateway_jobs
    deferrable initially deferred
    for each row execute function
      sellerpilot_private.guard_qoo10_exact_localization_update_job();
    create constraint trigger guard_exact_qoo10_adopted_localization_job
    after insert or update on sellerpilot_private.channel_gateway_jobs
    deferrable initially deferred
    for each row execute function
      sellerpilot_private.guard_exact_qoo10_adopted_localization_job();
  `);
  return db;
}

async function insertPermit(db, { permitId, expectedFingerprint }) {
  await db.query(`
    insert into sellerpilot_private.qoo10_exact_localization_update_permits(
      permit_id,listing_id,credential_id,seller_account_key,release_sha,
      request_fingerprint,lineage_contract,adoption_observation_sha256,
      prewrite_snapshot_sha256
    ) values(
      $1,$2,$3,$4,$5,$6,'qoo10_exact_already_live_adoption_v1',$7,$8
    )
  `, [
    permitId,
    listingId,
    credentialId,
    sellerAccountKey,
    releaseSha,
    expectedFingerprint,
    observationSha256,
    prewriteSnapshotSha256,
  ]);
}

async function enqueueLikeHistoricalWrapper(db, {
  jobId,
  attemptId,
  permitId,
  finalFingerprint,
}) {
  const requestPayload = JSON.stringify(payload());
  await db.exec("begin");
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs(
      id,attempt_id,listing_id,credential_id,channel,operation,environment,
      status,seller_account_key,request_fingerprint,request_payload
    ) values(
      $1,$2,$3,$4,'qoo10','listing.update','production','queued',$5,null,$6::jsonb
    )
  `, [jobId, attemptId, listingId, credentialId, sellerAccountKey, requestPayload]);
  await db.query(`
    update sellerpilot_private.channel_gateway_jobs
       set request_fingerprint=$2,updated_at=clock_timestamp()
     where id=$1
  `, [jobId, finalFingerprint]);
  await db.query(`
    update sellerpilot_private.qoo10_exact_localization_update_permits permit
       set update_job_id=$2,
           update_attempt_id=$3,
           arguments_sha256=encode(extensions.digest(
             (($4::jsonb)->'arguments')::text,'sha256'
           ),'hex'),
           arguments_bytes=octet_length((($4::jsonb)->'arguments')::text),
           request_payload_sha256=encode(extensions.digest(
             $4::jsonb::text,'sha256'
           ),'hex'),
           request_payload_bytes=octet_length($4::jsonb::text)
     where permit_id=$1
  `, [permitId, jobId, attemptId, requestPayload]);
  await db.exec("commit");
}

test("Qoo10 adopted enqueue validates the final job after a stale deferred INSERT event", async () => {
  const db = await createDatabase();
  const permitId = "10000000-0000-4000-8000-000000000001";
  const jobId = "10000000-0000-4000-8000-000000000002";
  const attemptId = "10000000-0000-4000-8000-000000000003";
  try {
    await insertPermit(db, { permitId, expectedFingerprint: fingerprint });
    await enqueueLikeHistoricalWrapper(db, {
      permitId,
      jobId,
      attemptId,
      finalFingerprint: fingerprint,
    });
    assert.deepEqual((await db.query(`
      select job.request_fingerprint,permit.update_job_id,
             permit.update_attempt_id,
             (select count(*)::integer
                from sellerpilot_private.channel_gateway_jobs) job_count
        from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.qoo10_exact_localization_update_permits permit
          on permit.update_job_id=job.id
       where job.id=$1
    `, [jobId])).rows[0], {
      request_fingerprint: fingerprint,
      update_job_id: jobId,
      update_attempt_id: attemptId,
      job_count: 1,
    });
  } finally {
    await db.close();
  }
});

test("Qoo10 adopted enqueue still fails closed on a final fingerprint mismatch", async () => {
  const db = await createDatabase();
  const permitId = "20000000-0000-4000-8000-000000000001";
  const jobId = "20000000-0000-4000-8000-000000000002";
  const attemptId = "20000000-0000-4000-8000-000000000003";
  try {
    await insertPermit(db, { permitId, expectedFingerprint: fingerprint });
    await assert.rejects(
      enqueueLikeHistoricalWrapper(db, {
        permitId,
        jobId,
        attemptId,
        finalFingerprint: "e".repeat(64),
      }),
      /exact Qoo10 localization update job lineage invalid/u,
    );
    await db.exec("rollback").catch(() => undefined);
    assert.equal((await db.query(`
      select count(*)::integer job_count
        from sellerpilot_private.channel_gateway_jobs
    `)).rows[0].job_count, 0);
  } finally {
    await db.close();
  }
});

test("the deferred-row fix preserves the exact already-live source retirement", async () => {
  const db = await createDatabase();
  const jobId = "30000000-0000-4000-8000-000000000001";
  const attemptId = "30000000-0000-4000-8000-000000000002";
  const requestPayload = JSON.stringify({
    arguments: {
      sellerpilotQoo10ExactLocalization: {
        contract: "qoo10_exact_localization_update_v2",
        releaseSha,
      },
    },
  });
  try {
    await db.exec(`
      alter table sellerpilot_private.channel_gateway_jobs
        disable trigger user;
    `);
    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,credential_id,channel,operation,environment,
        status,seller_account_key,request_fingerprint,request_payload
      ) values(
        $1,$2,$3,$4,'qoo10','listing.update','production',
        'reconciliation_required',$5,null,$6::jsonb
      )
    `, [
      jobId,
      attemptId,
      listingId,
      credentialId,
      sellerAccountKey,
      requestPayload,
    ]);
    await db.exec(`
      alter table sellerpilot_private.channel_gateway_jobs
        enable trigger user;
    `);
    await db.exec("begin");
    await db.query(
      "select set_config('sellerpilot.qoo10_already_live_adopt_source',$1,true)",
      [jobId],
    );
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set status='failed',
             error_message='adopted already-live readback; no provider replay',
             updated_at=clock_timestamp()
       where id=$1
    `, [jobId]);
    await assert.rejects(
      db.exec("commit"),
      /exact Qoo10 localization update job lineage invalid/u,
    );
    await db.exec("rollback").catch(() => undefined);

    await db.query(`
      insert into sellerpilot_private.qoo10_exact_already_live_adoptions(
        source_job_id,source_attempt_id,listing_id,credential_id,remote_id,
        provider_status,remote_visibility,purchase_available,
        provider_call_replayed,external_write_count
      ) values($1,$2,$3,$4,'1217336970','S2','live',true,false,0)
    `, [jobId, attemptId, listingId, credentialId]);

    await db.exec("begin");
    await db.query(
      "select set_config('sellerpilot.qoo10_already_live_adopt_source',$1,true)",
      [jobId],
    );
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set status='failed',
             error_message='adopted already-live readback; no provider replay',
             updated_at=clock_timestamp()
       where id=$1
    `, [jobId]);
    await db.exec("commit");

    assert.deepEqual((await db.query(`
      select status,error_message
        from sellerpilot_private.channel_gateway_jobs
       where id=$1
    `, [jobId])).rows[0], {
      status: "failed",
      error_message: "adopted already-live readback; no provider replay",
    });
  } finally {
    await db.close();
  }
});

test("the forward migration only replaces guards and never manufactures operations", () => {
  const baseGuard = extractFunction(
    migration,
    "sellerpilot_private.guard_qoo10_exact_localization_update_job()",
  );
  const adoptedGuard = extractFunction(
    migration,
    "sellerpilot_private.guard_exact_qoo10_adopted_localization_job()",
  );
  assert.match(baseGuard, /current_job\.id = new\.id/u);
  assert.match(baseGuard, /sellerpilot\.qoo10_already_live_adopt_source/u);
  assert.match(baseGuard, /qoo10_exact_already_live_adoptions/u);
  assert.match(baseGuard, /permit\.request_fingerprint = v_job\.request_fingerprint/u);
  assert.doesNotMatch(
    baseGuard,
    /permit\.request_fingerprint = new\.request_fingerprint/u,
  );
  assert.match(adoptedGuard, /current_job\.id = new\.id/u);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.(?:channel_gateway_jobs|channel_operation_attempts|provider_call)/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.(?:product_listings|qoo10_exact_localization_update_permits)/iu,
  );
});
