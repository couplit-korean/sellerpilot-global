import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260902111000_restore_qoo10_adopted_atomic_enqueue_binding.sql",
  import.meta.url,
), "utf8");

assert.match(
  migration,
  /public\.sp_173990_enqueue_pre/u,
);
assert.match(
  migration,
  /exact Qoo10 localization update job binding failed/u,
);

const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const sellerAccountKey =
  "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const attemptId = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const permitId = "10000000-0000-4000-8000-000000000003";
const releaseSha = "a".repeat(40);
const requestFingerprint = "b".repeat(64);
const observationSha256 = "c".repeat(64);
const prewriteSnapshotSha256 = "d".repeat(64);

function payload(overrides = {}) {
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
        ...overrides,
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

    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      request_fingerprint text not null,
      seller_account_key text not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      attempt_id uuid not null,
      listing_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      environment text not null,
      status text not null,
      attempt_count integer not null,
      seller_account_key text not null,
      request_fingerprint text,
      request_payload jsonb not null,
      provider_mutation_started_at timestamptz,
      response_payload jsonb,
      completed_at timestamptz
    );
    create table sellerpilot_private.qoo10_exact_localization_update_permits (
      permit_id uuid primary key,
      listing_id uuid not null,
      credential_id uuid not null,
      seller_account_key text not null,
      release_sha text not null,
      request_fingerprint text not null,
      expires_at timestamptz not null,
      invalidated_at timestamptz,
      update_job_id uuid,
      update_attempt_id uuid,
      arguments_sha256 text,
      arguments_bytes integer,
      request_payload_sha256 text,
      request_payload_bytes integer,
      lineage_contract text,
      adoption_observation_sha256 text,
      prewrite_snapshot_sha256 text
    );

    create function sellerpilot_private.qoo10_exact_s1_release_is_current(
      value text
    ) returns boolean language sql stable as $$
      select value = '${releaseSha}'
    $$;
    create function sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
      value jsonb, expected_release_sha text
    ) returns boolean language sql immutable as $$
      select value#>>'{sellerpilotQoo10ExactLocalization,contract}' =
               'qoo10_exact_localization_update_v2'
        and value#>>'{sellerpilotQoo10ExactLocalization,releaseSha}' =
              expected_release_sha
    $$;
    create function
      sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
        value jsonb,
        expected_release_sha text,
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

    create function public.sp_173990_enqueue_pre(
      p_listing_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_operation text,
      p_request_payload jsonb
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare
      v_fingerprint text;
    begin
      select request_fingerprint into strict v_fingerprint
        from sellerpilot_private.channel_operation_attempts
       where id = p_attempt_id;
      insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,credential_id,channel,operation,environment,
        status,attempt_count,seller_account_key,request_fingerprint,
        request_payload
      ) values(
        '${jobId}'::uuid,p_attempt_id,p_listing_id,p_credential_id,p_channel,
        p_operation,'production','queued',0,'${sellerAccountKey}',
        v_fingerprint,p_request_payload
      );
      return jsonb_build_object(
        'status','queued','job_id','${jobId}','attempt_id',p_attempt_id
      );
    end;
    $$;
  `);
  await db.exec(migration);
  await db.query(`
    insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,
      request_fingerprint,seller_account_key
    ) values($1,$2,$3,'qoo10','listing.update','running',$4,$5)
  `, [attemptId, ownerId, credentialId, requestFingerprint, sellerAccountKey]);
  return db;
}

async function insertPermit(db) {
  await db.query(`
    insert into sellerpilot_private.qoo10_exact_localization_update_permits(
      permit_id,listing_id,credential_id,seller_account_key,release_sha,
      request_fingerprint,expires_at,lineage_contract,
      adoption_observation_sha256,prewrite_snapshot_sha256
    ) values(
      $1,$2,$3,$4,$5,$6,clock_timestamp()+interval '5 minutes',
      'qoo10_exact_already_live_adoption_v1',$7,$8
    )
  `, [
    permitId,
    listingId,
    credentialId,
    sellerAccountKey,
    releaseSha,
    requestFingerprint,
    observationSha256,
    prewriteSnapshotSha256,
  ]);
}

test("Qoo10 adopted enqueue atomically binds the new job to its armed permit", async () => {
  const db = await createDatabase();
  try {
    await insertPermit(db);
    const result = await db.query(`
      select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1,$2,$3,'qoo10','listing.update',$4::jsonb
      ) as result
    `, [listingId, credentialId, attemptId, JSON.stringify(payload())]);
    assert.equal(result.rows[0].result.status, "queued");
    assert.equal(result.rows[0].result.job_id, jobId);

    assert.deepEqual((await db.query(`
      select permit.update_job_id,permit.update_attempt_id,
             permit.arguments_sha256 is not null as arguments_bound,
             permit.request_payload_sha256 is not null as payload_bound,
             (select count(*)::integer
                from sellerpilot_private.channel_gateway_jobs) as job_count
        from sellerpilot_private.qoo10_exact_localization_update_permits permit
       where permit.permit_id=$1
    `, [permitId])).rows[0], {
      update_job_id: jobId,
      update_attempt_id: attemptId,
      arguments_bound: true,
      payload_bound: true,
      job_count: 1,
    });
  } finally {
    await db.close();
  }
});

test("Qoo10 adopted enqueue fails before creating a job when lineage changed", async () => {
  const db = await createDatabase();
  try {
    await insertPermit(db);
    await assert.rejects(
      db.query(`
        select public.sellerpilot_service_enqueue_listing_gateway_job(
          $1,$2,$3,'qoo10','listing.update',$4::jsonb
        )
      `, [
        listingId,
        credentialId,
        attemptId,
        JSON.stringify(payload({ observationSha256: "e".repeat(64) })),
      ]),
      /exact Qoo10 localization update permit missing/u,
    );
    assert.equal((await db.query(`
      select count(*)::integer as count
        from sellerpilot_private.channel_gateway_jobs
    `)).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
