import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const FAC9 = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const V2_SOURCE = "11111111-1111-4111-8111-111111111111";
const ACTIVATION = "22222222-2222-4222-8222-222222222222";
const EXACT_LISTING = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const EXACT_PRODUCT = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const EXACT_CREDENTIAL = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const EXACT_OWNER = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const EXACT_ATTEMPT = "33333333-3333-4333-8333-333333333333";
const EXACT_RELEASE = "a".repeat(40);
const EXACT_FINGERPRINT = "b".repeat(64);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

test("Qoo10 fac9 and replacement reconciliation remain open until the exact S2 outcome", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm)='sha256'
          then sha256(convert_to(value,'UTF8'))
          else convert_to(md5(value||algorithm),'UTF8') end
      $$;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        status text,
        operation text,
        request_payload jsonb not null default '{}'::jsonb,
        response_payload jsonb
      );
      create table sellerpilot_private.qoo10_exact_localization_source_retirements (
        source_job_id uuid primary key,
        replacement_contract text not null,
        provider_call_replayed boolean not null
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_outcomes (
        source_job_id uuid not null,
        activation_job_id uuid not null,
        terminal_status text not null,
        provider_status text,
        remote_visibility text,
        activation_response_sha256 text
      );
    `);
    const migration = await readFile(new URL(
      "../supabase/migrations/20260831144000_generalize_qoo10_exact_localization_s1_activation.sql",
      import.meta.url,
    ), "utf8");
    await db.exec(extractFunction(
      migration,
      "create or replace function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(",
    ));

    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(id,status,operation)
      values($1,'reconciliation_required','listing.update')
    `, [FAC9]);
    await db.query(`
      insert into sellerpilot_private.qoo10_exact_localization_source_retirements
        (source_job_id,replacement_contract,provider_call_replayed)
      values($1,'qoo10_exact_localization_update_v2',false)
    `, [FAC9]);
    assert.equal((await db.query(
      "select sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved($1) value",
      [FAC9],
    )).rows[0].value, false);

    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(
        id,status,operation,request_payload
      ) values(
        $1,'reconciliation_required','listing.update',
        '{"arguments":{"sellerpilotQoo10ExactLocalization":{"contract":"qoo10_exact_localization_update_v2"}}}'::jsonb
      )
    `, [V2_SOURCE]);
    assert.equal((await db.query(`
      select count(*)::integer value
        from sellerpilot_private.channel_gateway_jobs job
       where job.status='reconciliation_required'
         and not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
    `)).rows[0].value, 2);

    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(
        id,status,operation,response_payload
      ) values($1,'succeeded','listing.activate','{}'::jsonb)
    `, [ACTIVATION]);
    await db.query(`
      insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes(
        source_job_id,activation_job_id,terminal_status,provider_status,
        remote_visibility,activation_response_sha256
      ) values(
        $2,$1,'failed',null,null,null
      )
    `, [ACTIVATION, V2_SOURCE]);
    assert.equal((await db.query(`
      select count(*)::integer value
        from sellerpilot_private.channel_gateway_jobs job
       where job.status='reconciliation_required'
         and not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
    `)).rows[0].value, 2, "failed activation must not discount either source");

    await db.query(`
      update sellerpilot_private.qoo10_exact_s1_activation_outcomes
         set terminal_status='succeeded',provider_status='S2',
             remote_visibility='live',
             activation_response_sha256=encode(
               extensions.digest('{}','sha256'),'hex'
             )
       where activation_job_id=$1
    `, [ACTIVATION]);
    assert.equal((await db.query(`
      select count(*)::integer value
        from sellerpilot_private.channel_gateway_jobs job
       where job.status='reconciliation_required'
         and not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
    `)).rows[0].value, 0, "one exact S2/live outcome resolves fac9 and its replacement");
  } finally {
    await db.close();
  }
});

test("Qoo10 v2 SQL argument fence returns false for null and malformed payloads", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create function sellerpilot_private.qoo10_exact_detail_image_urls(value text)
      returns jsonb language sql immutable as $$ select '[]'::jsonb $$;
    `);
    const migration = await readFile(new URL(
      "../supabase/migrations/20260831144000_generalize_qoo10_exact_localization_s1_activation.sql",
      import.meta.url,
    ), "utf8");
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(",
    ));
    for (const [args, release] of [
      [null, "a".repeat(40)],
      [{}, "a".repeat(40)],
      [{ params: {}, sellerpilotQoo10ExactLocalization: {} }, "a".repeat(40)],
      [{ params: {}, sellerpilotQoo10ExactLocalization: {} }, null],
    ]) {
      const result = await db.query(
        "select sellerpilot_private.qoo10_exact_localization_v2_arguments_valid($1::jsonb,$2) value",
        [args === null ? null : JSON.stringify(args), release],
      );
      assert.equal(result.rows[0].value, false);
    }
  } finally {
    await db.close();
  }
});

test("Qoo10 v2 update permit is server-owned, one-use, and consumed at the provider boundary", async () => {
  const migration = await readFile(new URL(
    "../supabase/migrations/20260831144000_generalize_qoo10_exact_localization_s1_activation.sql",
    import.meta.url,
  ), "utf8");
  const route = await readFile(new URL(
    "../app/api/admin/channel-operations/route.ts",
    import.meta.url,
  ), "utf8");

  assert.match(migration, /create unique index qoo10_exact_localization_one_update_per_listing/u);
  assert.match(migration, /sellerpilot_service_arm_exact_qoo10_localization_update/u);
  assert.match(migration, /bind_exact_qoo10_localization_update_claim/u);
  assert.match(migration, /exact_qoo10_localization_update_provider_allowed/u);
  assert.match(migration, /consume_exact_qoo10_localization_update_provider/u);
  assert.match(migration, /sellerpilot_300950_begin_gateway_mutation_before_release_gate/u);
  assert.match(migration, /sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate/u);
  assert.match(
    migration,
    /qoo10_exact_localization_v2_arguments_valid\([\s\S]*?request_payload_sha256[\s\S]*?bound_claim_token/u,
  );
  assert.match(
    migration,
    /revoke all on function[\s\S]*?qoo10_exact_localization_v2_arguments_valid\(jsonb,text\)[\s\S]*?from public, anon, authenticated, service_role/u,
  );
  assert.match(
    route,
    /sellerpilot_service_arm_exact_qoo10_localization_update[\s\S]*?qoo10ExactLocalizationUpdatePermitArmed[\s\S]*?!channelReleaseGateIsEffective/u,
  );
});

test("Qoo10 v2 closed-gate enqueue bypass accepts only the armed immutable tuple", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create function sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
        value jsonb,
        release_sha text
      ) returns boolean language sql immutable as $$
        select value#>>'{sellerpilotQoo10ExactLocalization,contract}' =
                 'qoo10_exact_localization_update_v2'
          and value#>>'{sellerpilotQoo10ExactLocalization,releaseSha}' = release_sha
      $$;
      create function sellerpilot_private.qoo10_exact_s1_release_is_current(
        release_sha text
      ) returns boolean language sql immutable as $$
        select release_sha = '${EXACT_RELEASE}'
      $$;
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        status text not null,
        request_fingerprint text not null
      );
      create table sellerpilot_private.qoo10_exact_localization_update_permits (
        source_job_id uuid not null,
        listing_id uuid not null,
        product_id uuid not null,
        credential_id uuid not null,
        owner_id uuid not null,
        remote_id text not null,
        seller_account_key text not null,
        release_sha text not null,
        request_fingerprint text not null,
        update_job_id uuid,
        update_attempt_id uuid,
        arguments_sha256 text,
        request_payload_sha256 text,
        bound_at timestamptz,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        expires_at timestamptz not null
      );
    `);
    const migration = await readFile(new URL(
      "../supabase/migrations/20260831195108_reach_exact_qoo10_localization_through_closed_gate.sql",
      import.meta.url,
    ), "utf8");
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(",
    ));
    await db.query(`
      insert into sellerpilot_private.channel_operation_attempts(
        id,credential_id,channel,operation,status,request_fingerprint
      ) values($1,$2,'qoo10','listing.update','running',$3)
    `, [EXACT_ATTEMPT, EXACT_CREDENTIAL, EXACT_FINGERPRINT]);
    await db.query(`
      insert into sellerpilot_private.qoo10_exact_localization_update_permits(
        source_job_id,listing_id,product_id,credential_id,owner_id,remote_id,
        seller_account_key,release_sha,request_fingerprint,expires_at
      ) values($1,$2,$3,$4,$5,'1217336970',$6,$7,$8,statement_timestamp()+interval '5 minutes')
    `, [
      FAC9,
      EXACT_LISTING,
      EXACT_PRODUCT,
      EXACT_CREDENTIAL,
      EXACT_OWNER,
      "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46",
      EXACT_RELEASE,
      EXACT_FINGERPRINT,
    ]);
    const payload = JSON.stringify({
      arguments: {
        sellerpilotQoo10ExactLocalization: {
          contract: "qoo10_exact_localization_update_v2",
          releaseSha: EXACT_RELEASE,
        },
      },
    });
    const allowed = async ({
      listing = EXACT_LISTING,
      credential = EXACT_CREDENTIAL,
      attempt = EXACT_ATTEMPT,
      channel = "qoo10",
      operation = "listing.update",
      requestPayload = payload,
    } = {}) => (await db.query(`
      select sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(
        $1,$2,$3,$4,$5,$6::jsonb
      ) value
    `, [listing, credential, attempt, channel, operation, requestPayload])).rows[0].value;

    assert.equal(await allowed(), true);
    for (const nearMiss of [
      { listing: "44444444-4444-4444-8444-444444444444" },
      { credential: "55555555-5555-4555-8555-555555555555" },
      { attempt: "66666666-6666-4666-8666-666666666666" },
      { channel: "shopee" },
      { operation: "listing.stop" },
      { requestPayload: "{}" },
      { requestPayload: payload.replace(EXACT_RELEASE, "c".repeat(40)) },
    ]) assert.equal(await allowed(nearMiss), false);

    assert.equal(
      migration.match(/qoo10_exact_localization_enqueue_gate_bypass_allowed\(/gu)?.length,
      4,
      "the helper must stay behind its private function boundary",
    );
    assert.match(migration, /sellerpilot_31132018_enqueue_before_smartstore_exact_qa_fence/u);
    assert.match(migration, /sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence/u);
  } finally {
    await db.close();
  }
});
