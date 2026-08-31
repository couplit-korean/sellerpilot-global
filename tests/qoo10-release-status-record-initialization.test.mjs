import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const EXACT_PRODUCT = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const EXACT_LISTING = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const RELEASE_SHA = "a".repeat(40);
const SOURCE_JOB = "11111111-1111-4111-8111-111111111111";
const VERIFIER_JOB = "22222222-2222-4222-8222-222222222222";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

async function releaseStatus(db) {
  return (await db.query(`
    select public.sellerpilot_service_get_exact_qoo10_localization_release_status(
      $1::uuid,$2::uuid,$3
    ) value
  `, [EXACT_PRODUCT, EXACT_LISTING, RELEASE_SHA])).rows[0].value;
}

test("Qoo10 release status returns null stages before each conditional record exists", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      do $$ begin create role anon noinherit;
        exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated noinherit;
        exception when duplicate_object then null; end $$;
      do $$ begin create role service_role noinherit;
        exception when duplicate_object then null; end $$;

      create schema sellerpilot_private;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        listing_id uuid,
        channel text,
        operation text,
        status text,
        request_payload jsonb not null default '{}'::jsonb,
        request_fingerprint text,
        response_payload jsonb,
        created_at timestamptz not null default statement_timestamp(),
        completed_at timestamptz
      );
      create table sellerpilot_private.qoo10_exact_s1_verifier_runs (
        source_job_id uuid not null,
        source_request_fingerprint text,
        verifier_job_id uuid not null,
        release_sha text not null,
        queued_at timestamptz not null default statement_timestamp()
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_permits (
        verifier_job_id uuid primary key,
        activation_job_id uuid not null,
        armed_at timestamptz,
        expires_at timestamptz,
        bound_at timestamptz,
        consumed_at timestamptz,
        invalidated_at timestamptz
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_outcomes (
        activation_job_id uuid primary key,
        terminal_status text,
        provider_status text,
        remote_visibility text,
        verified_at timestamptz,
        completed_at timestamptz
      );
      create table sellerpilot_private.qoo10_exact_localization_source_retirements (
        source_job_id uuid primary key,
        provider_call_replayed boolean not null default false
      );
      create function sellerpilot_private.qoo10_exact_s1_release_is_current(
        value text
      ) returns boolean language sql stable set search_path = '' as $$
        select value = '${RELEASE_SHA}'
      $$;
    `);

    const predecessor = await readFile(new URL(
      "../supabase/migrations/20260831144000_generalize_qoo10_exact_localization_s1_activation.sql",
      import.meta.url,
    ), "utf8");
    await db.exec(extractFunction(
      predecessor,
      "create function public.sellerpilot_service_get_exact_qoo10_localization_release_status(",
    ));

    await assert.rejects(
      releaseStatus(db),
      /record .*v_verifier.*not assigned|record .*v_verifier.*not initialized/iu,
      "the predecessor must reproduce SQLSTATE 55000 before the first v2 source",
    );

    const migration = await readFile(new URL(
      "../supabase/migrations/20260901081000_initialize_qoo10_release_status_records.sql",
      import.meta.url,
    ), "utf8");
    await db.exec(migration);

    const empty = await releaseStatus(db);
    assert.equal(empty.contract, "qoo10_exact_localization_release_status_v2");
    assert.equal(empty.releaseCurrent, true);
    assert.equal(empty.source, null);
    assert.equal(empty.verifier, null);
    assert.equal(empty.activation, null);
    assert.equal(empty.outcome, null);

    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(
        id,listing_id,channel,operation,status,request_payload,
        request_fingerprint
      ) values(
        $1,$2,'qoo10','listing.update','succeeded',
        '{"arguments":{"sellerpilotQoo10ExactLocalization":{"contract":"qoo10_exact_localization_update_v2"}}}'::jsonb,
        $3
      )
    `, [SOURCE_JOB, EXACT_LISTING, "b".repeat(64)]);
    const sourceOnly = await releaseStatus(db);
    assert.equal(sourceOnly.source.jobId, SOURCE_JOB);
    assert.equal(sourceOnly.verifier, null);
    assert.equal(sourceOnly.activation, null);
    assert.equal(sourceOnly.outcome, null);

    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(
        id,listing_id,channel,operation,status
      ) values($1,$2,'qoo10','listing.verify','succeeded')
    `, [VERIFIER_JOB, EXACT_LISTING]);
    await db.query(`
      insert into sellerpilot_private.qoo10_exact_s1_verifier_runs(
        source_job_id,source_request_fingerprint,verifier_job_id,release_sha
      ) values($1,$2,$3,$4)
    `, [SOURCE_JOB, "b".repeat(64), VERIFIER_JOB, RELEASE_SHA]);
    const verifierOnly = await releaseStatus(db);
    assert.equal(verifierOnly.verifier.jobId, VERIFIER_JOB);
    assert.equal(verifierOnly.activation, null);
    assert.equal(verifierOnly.outcome, null);

    const privileges = await db.query(`
      select role_name,
             pg_catalog.has_function_privilege(
               role_name,
               'public.sellerpilot_service_get_exact_qoo10_localization_release_status(uuid,uuid,text)',
               'EXECUTE'
             ) allowed
        from (values
          ('anon'::name),('authenticated'::name),('service_role'::name)
        ) role(role_name)
       order by role_name
    `);
    assert.deepEqual(privileges.rows, [
      { role_name: "anon", allowed: false },
      { role_name: "authenticated", allowed: false },
      { role_name: "service_role", allowed: true },
    ]);
  } finally {
    await db.close();
  }
});
