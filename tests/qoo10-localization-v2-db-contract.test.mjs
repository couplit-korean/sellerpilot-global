import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const FAC9 = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const V2_SOURCE = "11111111-1111-4111-8111-111111111111";
const ACTIVATION = "22222222-2222-4222-8222-222222222222";

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
