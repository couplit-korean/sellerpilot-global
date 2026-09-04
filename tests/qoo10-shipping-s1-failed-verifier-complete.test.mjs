import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const baseUrl = new URL(
  "../supabase/migrations/20260905003000_recover_exact_qoo10_shipping_normalization_s1.sql",
  import.meta.url,
);
const followUpUrl = new URL(
  "../supabase/migrations/20260905014100_allow_qoo10_shipping_s1_failed_verifier_complete.sql",
  import.meta.url,
);

const VERIFIER_JOB_ID = "457b4481-0a66-4a76-89a0-884087d0c22e";

function replaceDefinition(sql, signature) {
  const start = sql.indexOf(`create or replace function ${signature}`);
  assert.notEqual(start, -1, `missing replace ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated replace ${signature}`);
  return sql.slice(start, end + 4);
}

test("follow-up SQL only lifts failed-verifier 55000 and keeps 03000 history", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const base = await readFile(baseUrl, "utf8");
  assert.match(followUp, /20260905003000/);
  assert.match(followUp, /Do not rewrite that applied history/);
  assert.match(
    followUp,
    /create or replace function public.sellerpilot_service_complete_gateway_transaction/,
  );
  assert.match(followUp, /if v_job_status = 'succeeded'/);
  assert.match(followUp, /perform sellerpilot_private.record_qoo10_shipping_s1_observation/);
  assert.match(followUp, /sellerpilot_090500_complete_before_qoo10_shipping_s1/);
  assert.doesNotMatch(followUp, /687852dc-36de-4049-b170-bdf7839ccf2f/);
  assert.doesNotMatch(followUp, /089467c1-cadb-4d31-93a8-d5882c46d753/);
  assert.doesNotMatch(followUp, /enqueue_qoo10_shipping_s1_activation/);
  assert.doesNotMatch(base, /20260905014100/);
});

test("failed verifier complete persists when observation is false; succeeded still 55000", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        operation text not null,
        status text not null
      );
      create table sellerpilot_private.qoo10_shipping_s1_verifier_runs (
        verifier_job_id uuid primary key
      );
      create table sellerpilot_private.qoo10_shipping_s1_activation_permits (
        activation_job_id uuid primary key
      );
      create function public.sellerpilot_090500_complete_before_qoo10_shipping_s1(
        p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text,
        p_response_payload jsonb default null, p_error_message text default null,
        p_credential_refresh jsonb default null, p_normalized_orders jsonb default null,
        p_normalized_inquiries jsonb default null, p_diagnostic jsonb default null
      ) returns jsonb language plpgsql as $$
      begin
        update sellerpilot_private.channel_gateway_jobs
           set status = p_status
         where id = p_job_id;
        return jsonb_build_object('status', 'completed');
      end;
      $$;
      create function sellerpilot_private.record_qoo10_shipping_s1_observation(p_job_id uuid)
      returns boolean language plpgsql as $$
      begin
        return false;
      end;
      $$;
      create function sellerpilot_private.record_qoo10_shipping_s1_activation_outcome(p_job_id uuid)
      returns boolean language plpgsql as $$
      begin
        return true;
      end;
      $$;
      insert into sellerpilot_private.channel_gateway_jobs(id, operation, status)
      values ('${VERIFIER_JOB_ID}'::uuid, 'listing.publication.verify', 'running');
      insert into sellerpilot_private.qoo10_shipping_s1_verifier_runs(verifier_job_id)
      values ('${VERIFIER_JOB_ID}'::uuid);
    `);
    await db.exec(replaceDefinition(
      followUp,
      "public.sellerpilot_service_complete_gateway_transaction",
    ));

    const failed = await db.query(
      `select public.sellerpilot_service_complete_gateway_transaction(
         'token', '${VERIFIER_JOB_ID}'::uuid,
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'failed'
       ) as result`,
    );
    const failedJob = await db.query(
      `select status from sellerpilot_private.channel_gateway_jobs
        where id = '${VERIFIER_JOB_ID}'::uuid`,
    );
    assert.equal(failed.rows[0].result.status, "completed");
    assert.equal(failedJob.rows[0].status, "failed");

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set status = 'running'
       where id = '${VERIFIER_JOB_ID}'::uuid
    `);
    let succeededCode = null;
    try {
      await db.query(
        `select public.sellerpilot_service_complete_gateway_transaction(
           'token', '${VERIFIER_JOB_ID}'::uuid,
           'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'succeeded'
         )`,
      );
    } catch (error) {
      succeededCode = error?.code ?? error?.cause?.code ?? String(error);
    }
    assert.match(String(succeededCode), /55000|observation was not recorded/);
    const afterSucceeded = await db.query(
      `select status from sellerpilot_private.channel_gateway_jobs
        where id = '${VERIFIER_JOB_ID}'::uuid`,
    );
    assert.equal(afterSucceeded.rows[0].status, "running");
  } finally {
    await db.close();
  }
});
