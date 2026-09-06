import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const historyUrl = new URL(
  "../supabase/migrations/20260828210000_non_cs_release_integrity.sql",
  import.meta.url,
);
const followUpUrl = new URL(
  "../supabase/migrations/20260905014000_archive_reused_serverless_cs_wake_request_ids.sql",
  import.meta.url,
);

const WAKE_SECRET = "w".repeat(43);

function replaceDefinition(sql, signature) {
  const start = sql.indexOf(`create or replace function ${signature}`);
  assert.notEqual(start, -1, `missing replace ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated replace ${signature}`);
  return sql.slice(start, end + 4);
}

test("follow-up archives reused pg_net ids and does not rewrite 210000 or claim jobs", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const history = await readFile(historyUrl, "utf8");
  assert.match(followUp, /20260828210000/);
  assert.match(followUp, /Do not rewrite that applied history/);
  assert.match(followUp, /serverless_cs_wake_request_archives/);
  assert.match(followUp, /unique_violation/);
  assert.match(followUp, /pg_net_request_id_reused/);
  assert.match(followUp, /outcome is distinct from 'queued'/);
  const scheduleFn = replaceDefinition(
    followUp,
    "sellerpilot_private.schedule_serverless_cs_wakeup()",
  );
  assert.match(scheduleFn, /net\.http_post\(/);
  assert.match(scheduleFn, /insert into sellerpilot_private.serverless_cs_wake_requests/);
  assert.ok(scheduleFn.indexOf("net.http_post") < scheduleFn.indexOf("unique_violation"));
  assert.doesNotMatch(followUp, /channel_gateway_jobs/i);
  assert.doesNotMatch(followUp, /sellerpilot_claim_/);
  assert.doesNotMatch(followUp, /listing\.create|listing\.update|listing\.activate/);
  assert.doesNotMatch(history, /20260905014000/);
  assert.doesNotMatch(history, /serverless_cs_wake_request_archives/);
});

test("resolved collision is archived and reset; queued collision stays fail-closed", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
      create schema if not exists sellerpilot_private;
      create schema if not exists cron;
      create schema if not exists net;
      create schema if not exists vault;
      create table cron.job (
        jobid bigint primary key,
        jobname text not null,
        active boolean not null
      );
      create table cron.job_run_details (
        jobid bigint,
        end_time timestamptz
      );
      insert into cron.job values (1, 'sellerpilot-serverless-cs-wake-v1', true);
      create table vault.secrets (
        id uuid primary key default gen_random_uuid(),
        secret text not null,
        name text,
        created_at timestamptz not null default now()
      );
      create view vault.decrypted_secrets as
      select id, secret as decrypted_secret from vault.secrets;
      insert into vault.secrets (secret, name) values ('${WAKE_SECRET}', 'sellerpilot_serverless_cs_wake_v1');
      create table net._http_response (
        id bigint primary key,
        status_code integer,
        timed_out boolean,
        error_msg text,
        created timestamptz not null default now()
      );
      create function net.http_post(
        url text,
        body jsonb default '{}'::jsonb,
        params jsonb default '{}'::jsonb,
        headers jsonb default '{}'::jsonb,
        timeout_milliseconds integer default 1000
      )
      returns bigint
      language sql
      as $$ select 1345::bigint $$;
      create table sellerpilot_private.serverless_cs_wake_requests (
        request_id bigint primary key,
        requested_at timestamptz not null default now(),
        resolved_at timestamptz,
        outcome text not null default 'queued' check (
          outcome in (
            'queued', 'delivered', 'retryable_failure', 'permanent_failure',
            'permanent_failure_acknowledged'
          )
        ),
        http_status integer,
        timed_out boolean not null default false,
        safe_error_code text
      );
      create function sellerpilot_private.reconcile_serverless_cs_wakeups()
      returns jsonb
      language sql
      as $$ select jsonb_build_object('delivered',0,'retryableFailures',0,'permanentFailures',0) $$;
      create function cron.alter_job(job_id bigint, active boolean)
      returns void
      language sql
      as $$ update cron.job set active = $2 where jobid = $1 $$;
    `);

    await db.exec(`
      create function sellerpilot_private.schedule_serverless_cs_wakeup()
      returns bigint
      language plpgsql
      as $$
      declare v_request_id bigint;
      begin
        select net.http_post('https://example.test', '{}'::jsonb) into v_request_id;
        insert into sellerpilot_private.serverless_cs_wake_requests (request_id, requested_at)
        values (v_request_id, clock_timestamp());
        return v_request_id;
      end;
      $$;
    `);
    await db.exec(`
      insert into sellerpilot_private.serverless_cs_wake_requests (
        request_id, requested_at, resolved_at, outcome, http_status, timed_out
      ) values (
        1345, '2026-08-29T03:21:00Z', '2026-08-29T03:22:00Z', 'delivered', 200, false
      );
    `);
    await assert.rejects(
      () => db.exec("select sellerpilot_private.schedule_serverless_cs_wakeup()"),
      /23505|duplicate key|unique constraint/i,
    );

    await db.exec(followUp);
    const reused = await db.query("select sellerpilot_private.schedule_serverless_cs_wakeup() as id");
    assert.equal(Number(reused.rows[0].id), 1345);
    const live = (await db.query(
      `select request_id, outcome, http_status, timed_out, safe_error_code, resolved_at
         from sellerpilot_private.serverless_cs_wake_requests
        where request_id = 1345`,
    )).rows[0];
    assert.equal(live.outcome, "queued");
    assert.equal(live.http_status, null);
    assert.equal(live.timed_out, false);
    assert.equal(live.safe_error_code, null);
    assert.equal(live.resolved_at, null);
    const archived = (await db.query(
      `select request_id, outcome, http_status, archive_reason
         from sellerpilot_private.serverless_cs_wake_request_archives
        where request_id = 1345`,
    )).rows;
    assert.equal(archived.length, 1);
    assert.equal(archived[0].outcome, "delivered");
    assert.equal(archived[0].http_status, 200);
    assert.equal(archived[0].archive_reason, "pg_net_request_id_reused");
    assert.equal(
      (await db.query("select count(*)::int as n from sellerpilot_private.serverless_cs_wake_requests")).rows[0].n,
      1,
    );
    const second = await db.query("select sellerpilot_private.schedule_serverless_cs_wakeup() as id");
    assert.equal(second.rows[0].id, null);
    assert.equal(
      (await db.query(
        "select outcome from sellerpilot_private.serverless_cs_wake_requests where request_id = 1345",
      )).rows[0].outcome,
      "queued",
    );
    assert.equal(
      (await db.query(
        "select count(*)::int as n from sellerpilot_private.serverless_cs_wake_request_archives where request_id = 1345",
      )).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
