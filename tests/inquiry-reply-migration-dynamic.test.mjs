import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN_ID = "40404b44-f364-4c52-98ca-9d6f7371d3a1";
const TOKEN_HASH = "9".repeat(64);
const LINEAGE_MIGRATION = "20260825111810_harden_inquiry_reply_account_lineage.sql";
const PRE_LINEAGE_MIGRATION = "20260825111800_bind_listing_seller_accounts.sql";
const EBAY_ASQ_MIGRATION = "20260828141000_enable_ebay_asq_inquiry_reply_lineage.sql";
const EBAY_ASQ_SITE_MIGRATION = "20260828144000_bind_ebay_asq_marketplace_and_rate_limit.sql";
const SERVERLESS_CS_MIGRATIONS = new Set([
  "20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql",
  "20260828145700_schedule_serverless_cs_wakeup.sql",
  // These four forward migrations depend on the dedicated serverless runtime
  // created by 145600. This fixture intentionally excludes that runtime, so
  // its dependent prioritization, gates, and cleanup stay excluded as a unit.
  "20260828145900_durable_korean_inquiry_history_backfill.sql",
  "20260828145950_extend_serverless_cs_qoo10_inquiries.sql",
  "20260828200500_gate_serverless_static_egress.sql",
  "20260828201500_cleanup_static_egress_queued_reads.sql",
]);

const supabaseCompatibilityLayer = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text,
  description text,
  created_at timestamptz not null default now()
);
create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default ''
)
returns uuid
language plpgsql
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into vault.secrets (id, secret, name, description)
  values (v_id, new_secret, new_name, new_description);
  return v_id;
end;
$$;
create or replace view vault.decrypted_secrets as
select id, secret as decrypted_secret from vault.secrets;
create or replace function vault.delete_secret(secret_id uuid)
returns void
language sql
as $$ delete from vault.secrets where id = secret_id $$;
create or replace function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null
)
returns void
language sql
as $$
  update vault.secrets
     set secret = coalesce(new_secret, secret),
         name = coalesce(new_name, name),
         description = coalesce(new_description, description)
   where id = secret_id
$$;

create schema if not exists net;
create table if not exists net.http_request_queue (
  id bigint generated always as identity primary key,
  url text not null,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds integer
);
create table if not exists net._http_response (
  id bigint primary key,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz not null default now()
);
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb,
  timeout_milliseconds integer default 1000
)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into net.http_request_queue (
    url, body, params, headers, timeout_milliseconds
  ) values (
    $1, $2, $3, $4, $5
  ) returning id into v_id;
  return v_id;
end;
$$;
create or replace function net.http_get(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 1000
)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into net.http_request_queue (
    url, body, params, headers, timeout_milliseconds
  ) values (
    $1, null, $2, $3, $4
  ) returning id into v_id;
  return v_id;
end;
$$;

create schema if not exists cron;
create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create table if not exists cron.job_run_details (
  runid bigint generated always as identity primary key,
  jobid bigint not null,
  end_time timestamptz
);
create or replace function cron.schedule(
  job_name text,
  job_schedule text,
  job_command text
)
returns bigint
language plpgsql
as $$
declare v_job_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, job_schedule, job_command)
  on conflict (jobname) do update
    set schedule = excluded.schedule,
        command = excluded.command
  returning jobid into v_job_id;
  return v_job_id;
end;
$$;
create or replace function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
)
returns void
language sql
as $$
  update cron.job
     set schedule = coalesce($2, cron.job.schedule),
         command = coalesce($3, cron.job.command),
         active = coalesce($6, cron.job.active)
   where jobid = $1
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(path text)
returns text[]
language sql
immutable
as $$ select string_to_array(path, '/') $$;

create schema if not exists extensions;
create or replace function extensions.digest(value text, algorithm text)
returns bytea
language sql
immutable
as $$
  select case when lower(algorithm) = 'sha256'
    then sha256(convert_to(value, 'UTF8'))
    else convert_to(md5(value || algorithm), 'UTF8') end
$$;
`;

function withoutUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "");
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function setClaims(db, role = "authenticated", userId = ADMIN_ID) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function migrationEntries() {
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return { migrationUrl, names };
}

async function applyMigrations(db, { through } = {}) {
  const { migrationUrl, names } = await migrationEntries();
  for (const name of names) {
    if (SERVERLESS_CS_MIGRATIONS.has(name)) continue;
    const sql = await readFile(new URL(name, migrationUrl), "utf8");
    await db.exec(withoutUnavailableExtensions(sql));
    if (name === through) break;
  }
}

async function createDatabase({ through } = {}) {
  const db = new PGlite();
  await db.exec(supabaseCompatibilityLayer);
  await applyMigrations(db, { through });
  return db;
}

async function seedAdminAndCredential(db) {
  await db.query(
    "insert into auth.users (id, email) values ($1, 'cs-dynamic@example.test')",
    [ADMIN_ID],
  );
  await db.query(
    "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'CS Dynamic Test Admin')",
    [ADMIN_ID],
  );
  await setClaims(db);
  return scalar(
    db,
    `select public.sellerpilot_rotate_credential(
      'qoo10', 'production', '{"certification_key":"test-only"}'::jsonb,
      now() + interval '30 days', 90, 30, 7
    )`,
  );
}

function inquiryPayload(externalTicketId, suffix, status = "waiting") {
  return JSON.stringify([{
    externalTicketId,
    customerName: `고객 ${suffix}`,
    subject: `문의 ${suffix}`,
    message: `문의 내용 ${suffix}`,
    status,
    priority: 3,
    receivedAt: "2026-08-25T09:00:00.000Z",
  }]);
}

async function ingestTicket(db, credentialId, suffix) {
  const externalTicketId = `qoo10:MSG:${suffix}:1`;
  assert.equal(
    await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [credentialId, inquiryPayload(externalTicketId, suffix)],
    ),
    1,
  );
  return scalar(
    db,
    `select id
       from sellerpilot_private.support_tickets
      where owner_id = $1 and channel_key = 'qoo10' and external_ticket_id = $2`,
    [ADMIN_ID, externalTicketId],
  );
}

function replyPayload(questionNo, reply) {
  return JSON.stringify({
    arguments: {
      params: {
        inq_type: "MSG",
        question_no: questionNo,
        seq_no: "1",
        contents: reply,
      },
    },
  });
}

async function enqueueReply(db, ticketId, questionNo, reply) {
  return scalar(
    db,
    `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
      $1, 'qoo10', $2, $3::jsonb
    )`,
    [ticketId, reply, replyPayload(questionNo, reply)],
  );
}

async function issueWorkerToken(db) {
  await setClaims(db);
  await scalar(
    db,
    `select public.sellerpilot_issue_ai_worker_token(
      'CS dynamic worker', $1, '999999999999', now() + interval '30 days', 'gateway'
    )`,
    [TOKEN_HASH],
  );
  await setClaims(db, "service_role");
}

async function claimOnlyQueuedReply(db) {
  const claim = await scalar(
    db,
    "select public.sellerpilot_claim_channel_gateway_job($1, 'cs-dynamic/1.0')",
    [TOKEN_HASH],
  );
  assert.equal(typeof claim?.id, "string");
  assert.equal(typeof claim?.claim_token, "string");
  return claim;
}

async function completeReply(db, claim, result) {
  return scalar(
    db,
    `select public.sellerpilot_complete_channel_gateway_job(
      $1, $2, $3, 'succeeded', $4::jsonb, null
    )`,
    [TOKEN_HASH, claim.id, claim.claim_token, JSON.stringify(result)],
  );
}

test("Smartstore product and customer inquiry replies keep disjoint exact ticket identities", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      "insert into auth.users (id, email) values ($1, 'smartstore-cs@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Smartstore CS Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'smartstore', 'production',
        '{"client_id":"smartstore-test-client","client_secret":"smartstore-test-secret"}'::jsonb,
        now() + interval '30 days', 90, 30, 7
      )`,
    );

    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_ingest_inquiries(
          $1, 'smartstore', $2::jsonb
        )`,
        [credentialId, JSON.stringify([
          {
            externalTicketId: "456789",
            customerName: "상품문의 고객",
            subject: "스마트스토어 상품 문의",
            message: "상품 문의입니다.",
            status: "waiting",
            priority: 3,
            receivedAt: "2026-08-28T05:00:00.000Z",
          },
          {
            externalTicketId: "customer:987654",
            customerName: "고객문의 고객",
            subject: "스마트스토어 고객 문의",
            message: "고객 문의입니다.",
            status: "waiting",
            priority: 3,
            receivedAt: "2026-08-28T05:01:00.000Z",
          },
        ])],
      ),
      2,
    );

    const productTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where channel_key = 'smartstore' and external_ticket_id = '456789'`,
    );
    const customerTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where channel_key = 'smartstore' and external_ticket_id = 'customer:987654'`,
    );

    const productReply = "상품 문의 답변입니다.";
    const productJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'smartstore', $2::text,
        jsonb_build_object('arguments', jsonb_build_object(
          'questionId', '456789', 'reply', $2::text
        ))
      )`,
      [productTicketId, productReply],
    );
    assert.deepEqual(
      await scalar(
        db,
        "select request_payload->'arguments' from sellerpilot_private.channel_gateway_jobs where id = $1",
        [productJobId],
      ),
      { questionId: "456789", reply: productReply },
    );

    const customerReply = "고객 문의 답변입니다.";
    const customerJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'smartstore', $2::text,
        jsonb_build_object('arguments', jsonb_build_object(
          'kind', 'customer', 'inquiryNo', '987654', 'reply', $2::text
        ))
      )`,
      [customerTicketId, customerReply],
    );
    assert.deepEqual(
      await scalar(
        db,
        "select request_payload->'arguments' from sellerpilot_private.channel_gateway_jobs where id = $1",
        [customerJobId],
      ),
      { kind: "customer", inquiryNo: "987654", reply: customerReply },
    );
    assert.equal(
      await scalar(
        db,
        `select not (request_payload->'arguments' ? 'questionId')
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [customerJobId],
      ),
      true,
    );

    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'smartstore', $2::text,
          jsonb_build_object('arguments', jsonb_build_object(
            'kind', 'customer', 'inquiryNo', '456789', 'reply', $2::text
          ))
        )`,
        [customerTicketId, customerReply],
      ),
      /inquiry reply ticket payload mismatch/,
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'smartstore', $2::text,
          jsonb_build_object('arguments', jsonb_build_object(
            'kind', 'customer', 'inquiryNo', '987654',
            'questionId', '456789', 'reply', $2::text
          ))
        )`,
        [customerTicketId, customerReply],
      ),
      /SMARTSTORE_CUSTOMER_INQUIRY_REPLY_ID_MISMATCH/,
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'smartstore', $2::text,
          jsonb_build_object('arguments', jsonb_build_object(
            'questionId', 'customer:987654', 'reply', $2::text
          ))
        )`,
        [customerTicketId, customerReply],
      ),
      /SMARTSTORE_PRODUCT_INQUIRY_REPLY_ID_MISMATCH/,
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'smartstore', $2::text,
          jsonb_build_object('arguments', jsonb_build_object(
            'kind', null, 'questionId', '456789', 'reply', $2::text
          ))
        )`,
        [productTicketId, productReply],
      ),
      /SMARTSTORE_INQUIRY_REPLY_KIND_INVALID/,
    );
  } finally {
    await db.close();
  }
});

test("inquiry reply gateway deduplicates, conflicts, and atomically resolves a successful ticket", async () => {
  const db = await createDatabase();
  try {
    const credentialId = await seedAdminAndCredential(db);
    await setClaims(db, "service_role");
    const ticketId = await ingestTicket(db, credentialId, "10001");
    const reply = "확인 후 처리했습니다.";

    const firstJobId = await enqueueReply(db, ticketId, "10001", reply);
    const duplicateJobId = await enqueueReply(db, ticketId, "10001", reply);
    assert.equal(duplicateJobId, firstJobId);
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation = 'inquiries.reply' and request_payload->>'sellerpilotTicketId' = $1",
        [ticketId],
      ),
      1,
    );
    await assert.rejects(
      enqueueReply(db, ticketId, "10001", "서로 다른 답변입니다."),
      /INQUIRY_REPLY_CONFLICT/,
    );

    await issueWorkerToken(db);
    const claim = await claimOnlyQueuedReply(db);
    assert.equal(claim.id, firstJobId);
    assert.equal(
      await scalar(db, "select reply_delivery_status from sellerpilot_private.support_tickets where id = $1", [ticketId]),
      "sending",
    );

    assert.equal(await completeReply(db, claim, {
      ok: true,
      channel: "qoo10",
      operation: "inquiries.reply",
      safeMessage: "Qoo10 답변 전송 완료",
    }), true);
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status, reply_delivery_error,
                reply_draft, reply_gateway_job_id::text as reply_gateway_job_id,
                resolved_at is not null as has_resolved_at
           from sellerpilot_private.support_tickets
          where id = $1`,
        [ticketId],
      )).rows,
      [{
        status: "resolved",
        reply_delivery_status: "succeeded",
        reply_delivery_error: null,
        reply_draft: reply,
        reply_gateway_job_id: firstJobId,
        has_resolved_at: true,
      }],
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.operation_audit where action = 'ticket_reply_delivered' and entity_id = $1",
        [ticketId],
      ),
      1,
    );

    const resolvedBeforeStaleSync = (await db.query(
      `select status, reply_delivery_status, reply_draft,
              reply_gateway_job_id::text as reply_gateway_job_id,
              resolved_at::text as resolved_at
         from sellerpilot_private.support_tickets where id = $1`,
      [ticketId],
    )).rows[0];
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
        [credentialId, inquiryPayload("qoo10:MSG:10001:1", "10001")],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status, reply_draft,
                reply_gateway_job_id::text as reply_gateway_job_id,
                resolved_at::text as resolved_at
           from sellerpilot_private.support_tickets where id = $1`,
        [ticketId],
      )).rows[0],
      resolvedBeforeStaleSync,
    );

    // The durable delivery state is sufficient for a legacy row whose exact
    // gateway link was not retained.
    await db.query(
      "update sellerpilot_private.support_tickets set reply_gateway_job_id = null where id = $1",
      [ticketId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
        [credentialId, inquiryPayload("qoo10:MSG:10001:1", "10001")],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status,
                reply_gateway_job_id::text as reply_gateway_job_id,
                resolved_at::text as resolved_at
           from sellerpilot_private.support_tickets where id = $1`,
        [ticketId],
      )).rows,
      [{
        status: "resolved",
        reply_delivery_status: "succeeded",
        reply_gateway_job_id: null,
        resolved_at: resolvedBeforeStaleSync.resolved_at,
      }],
    );

    // The exact gateway binding is independently sufficient even if a stale
    // legacy field does not carry the new delivery-status proof.
    await db.query(
      `update sellerpilot_private.support_tickets
          set reply_delivery_status = 'never', reply_gateway_job_id = $2
        where id = $1`,
      [ticketId, firstJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
        [credentialId, inquiryPayload("qoo10:MSG:10001:1", "10001")],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status,
                reply_gateway_job_id::text as reply_gateway_job_id,
                resolved_at::text as resolved_at
           from sellerpilot_private.support_tickets where id = $1`,
        [ticketId],
      )).rows,
      [{
        status: "resolved",
        reply_delivery_status: "never",
        reply_gateway_job_id: firstJobId,
        resolved_at: resolvedBeforeStaleSync.resolved_at,
      }],
    );
  } finally {
    await db.close();
  }
});

test("a deterministic provider rejection marks the ticket failed instead of leaving it sending", async () => {
  const db = await createDatabase();
  try {
    const credentialId = await seedAdminAndCredential(db);
    await issueWorkerToken(db);
    const ticketId = await ingestTicket(db, credentialId, "10002");
    const jobId = await enqueueReply(db, ticketId, "10002", "확인했습니다.");
    const claim = await claimOnlyQueuedReply(db);
    assert.equal(claim.id, jobId);

    assert.equal(await completeReply(db, claim, {
      ok: false,
      channel: "qoo10",
      operation: "inquiries.reply",
      safeMessage: "판매채널이 답변을 거절했습니다.",
      steps: [{ name: "inquiry-reply", ok: false, status: 422, data: {} }],
    }), true);
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status, reply_delivery_error
           from sellerpilot_private.support_tickets where id = $1`,
        [ticketId],
      )).rows,
      [{
        status: "waiting",
        reply_delivery_status: "failed",
        reply_delivery_error: "판매채널이 답변을 거절했습니다.",
      }],
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id = $1", [jobId]),
      "succeeded",
    );

    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
        [credentialId, inquiryPayload("qoo10:MSG:10002:1", "10002")],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        "select status, reply_delivery_status from sellerpilot_private.support_tickets where id = $1",
        [ticketId],
      )).rows,
      [{ status: "waiting", reply_delivery_status: "failed" }],
    );

    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
        [credentialId, inquiryPayload("qoo10:MSG:10002:1", "10002", "resolved")],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status, resolved_at is not null as has_resolved_at
           from sellerpilot_private.support_tickets where id = $1`,
        [ticketId],
      )).rows,
      [{ status: "resolved", reply_delivery_status: "failed", has_resolved_at: true }],
    );
  } finally {
    await db.close();
  }
});

test("terminal ticket-ledger mismatch persists reconciliation and does not poison later gateway claims", async () => {
  const db = await createDatabase();
  try {
    const credentialId = await seedAdminAndCredential(db);
    await issueWorkerToken(db);
    const ticketId = await ingestTicket(db, credentialId, "10003");
    const jobId = await enqueueReply(db, ticketId, "10003", "처리했습니다.");
    const claim = await claimOnlyQueuedReply(db);
    assert.equal(claim.id, jobId);

    await db.query(
      "update sellerpilot_private.support_tickets set reply_gateway_job_id = null where id = $1",
      [ticketId],
    );
    assert.equal(await completeReply(db, claim, {
      ok: true,
      channel: "qoo10",
      operation: "inquiries.reply",
      safeMessage: "원격에서는 답변을 접수했습니다.",
    }), true);
    assert.deepEqual(
      (await db.query(
        "select status, error_message from sellerpilot_private.channel_gateway_jobs where id = $1",
        [jobId],
      )).rows,
      [{
        status: "reconciliation_required",
        error_message: "Inquiry reply was accepted remotely but its ticket ledger no longer matches.",
      }],
    );

    const nextTicketId = await ingestTicket(db, credentialId, "10004");
    const nextJobId = await enqueueReply(db, nextTicketId, "10004", "다음 문의 답변입니다.");
    const nextClaim = await claimOnlyQueuedReply(db);
    assert.equal(nextClaim.id, nextJobId);
  } finally {
    await db.close();
  }
});

test("legacy Lazada reply RPCs are unavailable to authenticated and service roles", async () => {
  const db = await createDatabase();
  try {
    const signatures = [
      "public.sellerpilot_service_claim_lazada_reply(uuid,uuid,text)",
      "public.sellerpilot_service_begin_lazada_reply(uuid,text)",
      "public.sellerpilot_service_complete_lazada_reply(uuid,text,text,text,text)",
    ];
    for (const signature of signatures) {
      assert.equal(
        await scalar(db, "select has_function_privilege('authenticated', $1, 'EXECUTE')", [signature]),
        false,
      );
      assert.equal(
        await scalar(db, "select has_function_privilege('service_role', $1, 'EXECUTE')", [signature]),
        false,
      );
    }

    const source = await readFile(
      new URL(`../supabase/migrations/${LINEAGE_MIGRATION}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /revoke all on function public\.sellerpilot_service_claim_lazada_reply\(uuid, uuid, text\)[\s\S]*?service_role;/);
    assert.match(source, /revoke all on function public\.sellerpilot_service_begin_lazada_reply\(uuid, text\)[\s\S]*?service_role;/);
    assert.match(source, /revoke all on function public\.sellerpilot_service_complete_lazada_reply\(uuid, text, text, text, text\)[\s\S]*?service_role;/);
  } finally {
    await db.close();
  }
});

async function insertPreLineageReplyJob(db, credentialId, { status, responsePayload = null }) {
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       credential_id, attempt_id, channel, operation, environment,
       request_payload, response_payload, status, created_by, completed_at
     ) values (
       $1, null, 'qoo10', 'inquiries.reply', 'production',
       '{"arguments":{"reply":"historical reply without ticket metadata"}}'::jsonb,
       $2::jsonb, $3, $4,
       case when $3 = 'succeeded' then now() else null end
     )`,
    [credentialId, responsePayload === null ? null : JSON.stringify(responsePayload), status, ADMIN_ID],
  );
}

test("lineage rollout rejects a metadata-less active inquiry reply before enabling new enqueue", async () => {
  const db = await createDatabase({ through: PRE_LINEAGE_MIGRATION });
  try {
    const credentialId = await seedAdminAndCredential(db);
    await insertPreLineageReplyJob(db, credentialId, { status: "queued" });
    const source = await readFile(
      new URL(`../supabase/migrations/${LINEAGE_MIGRATION}`, import.meta.url),
      "utf8",
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(source)),
      /active inquiry reply jobs must drain before account-lineage rollout/,
    );
  } finally {
    await db.close();
  }
});

test("lineage rollout rejects a metadata-less historical remote success for manual reconciliation", async () => {
  const db = await createDatabase({ through: PRE_LINEAGE_MIGRATION });
  try {
    const credentialId = await seedAdminAndCredential(db);
    await insertPreLineageReplyJob(db, credentialId, {
      status: "succeeded",
      responsePayload: { ok: true, channel: "qoo10", operation: "inquiries.reply" },
    });
    const source = await readFile(
      new URL(`../supabase/migrations/${LINEAGE_MIGRATION}`, import.meta.url),
      "utf8",
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(source)),
      /historical inquiry reply jobs require manual reconciliation/,
    );
  } finally {
    await db.close();
  }
});

test("eBay ASQ reply lineage is provider-certified, exact, idempotent, and atomically resolved", async () => {
  const db = await createDatabase();
  const itemId = "110005795324";
  const parentMessageId = "MSG-188558-v1";
  const recipientId = "v1|buyer public:user_123";
  const marketplaceId = "EBAY_US";
  const externalTicketId = `ebay:${parentMessageId}`;
  const reply = "Thanks for your question. This item is available.";

  const inquiry = ({
    external = externalTicketId,
    item = itemId,
    parent = parentMessageId,
    recipient = recipientId,
    includeContext = true,
  } = {}) => JSON.stringify([{
    externalTicketId: external,
    customerName: "eBay buyer",
    subject: "Ask Seller a Question",
    message: "Is this item still available?",
    status: "waiting",
    priority: 3,
    receivedAt: "2026-08-28T01:00:00.000Z",
    ...(includeContext ? {
      replyContext: {
        itemId: item,
        parentMessageId: parent,
        recipientId: recipient,
        marketplaceId,
        ignoredProviderField: "must not persist",
      },
    } : {}),
  }]);

  const replyPayload = ({
    item = itemId,
    parent = parentMessageId,
    recipient = recipientId,
    body = reply,
  } = {}) => JSON.stringify({
    arguments: {
      itemId: item,
      parentMessageId: parent,
      recipientId: recipient,
      marketplaceId,
      reply: body,
    },
  });

  const rotateEbayCredential = async ({
    attested,
    suffix,
    environment = "sandbox",
    providerSubject = "ebay:eias:TEST-EIAS-ASQ-ACCOUNT",
  }) => {
    await setClaims(db, attested ? "service_role" : "authenticated");
    return scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'ebay', $2, $1::jsonb,
        now() + interval '30 days', 90, 30, 7
      )`,
      [JSON.stringify({
        client_id: `ebay-client-${suffix}`,
        client_secret: `ebay-secret-${suffix}`,
        ru_name: "sellerpilot-oauth-redirect",
        access_token: `ebay-access-token-${suffix}`,
        refresh_token: `ebay-refresh-token-${suffix}`,
        ...(attested ? {
          provider_account_identity_version: "v1",
          provider_account_subject: providerSubject,
        } : {}),
      }), environment],
    );
  };

  try {
    await seedAdminAndCredential(db);

    const unattestedCredentialId = await rotateEbayCredential({
      attested: false,
      suffix: "unattested",
    });
    await setClaims(db, "service_role");
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [unattestedCredentialId, inquiry()],
      ),
      /INQUIRY_SELLER_LINEAGE_UNATTESTED/,
    );

    const sourceCredentialId = await rotateEbayCredential({
      attested: true,
      suffix: "source",
      environment: "production",
    });
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [sourceCredentialId, inquiry()],
      ),
      1,
    );

    const ticket = (await db.query(
      `select id::text as id, external_ticket_id, reply_context,
              source_credential_id::text as source_credential_id,
              seller_account_key
         from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'ebay'
          and reply_context->>'parentMessageId' = $2`,
      [ADMIN_ID, parentMessageId],
    )).rows[0];
    assert.match(ticket.external_ticket_id, /^ebay:[a-f0-9]{64}$/);
    assert.notEqual(ticket.external_ticket_id, externalTicketId);
    assert.equal(ticket.source_credential_id, sourceCredentialId);
    assert.deepEqual(ticket.reply_context, {
      itemId,
      parentMessageId,
      recipientId,
      marketplaceId,
    });

    const secondAccountCredentialId = await rotateEbayCredential({
      attested: true,
      suffix: "second-account",
      environment: "production",
      providerSubject: "ebay:eias:SECOND-ASQ-ACCOUNT",
    });
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [secondAccountCredentialId, inquiry()],
      ),
      1,
    );
    const accountScopedTickets = (await db.query(
      `select external_ticket_id, seller_account_key
         from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'ebay'
          and reply_context->>'parentMessageId' = $2
        order by external_ticket_id`,
      [ADMIN_ID, parentMessageId],
    )).rows;
    assert.equal(accountScopedTickets.length, 2);
    assert.notEqual(accountScopedTickets[0].external_ticket_id, accountScopedTickets[1].external_ticket_id);
    assert.notEqual(accountScopedTickets[0].seller_account_key, accountScopedTickets[1].seller_account_key);

    // A partial provider read cannot erase or create a reply route.
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [sourceCredentialId, inquiry({ includeContext: false })],
      ),
      0,
    );
    assert.deepEqual(
      await scalar(
        db,
        "select reply_context from sellerpilot_private.support_tickets where id = $1",
        [ticket.id],
      ),
      { itemId, parentMessageId, recipientId, marketplaceId },
    );

    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [sourceCredentialId, inquiry({ recipient: "different_buyer" })],
      ),
      /INQUIRY_REPLY_CONTEXT_MISMATCH/,
    );

    const invalidExternalTicketId = "ebay:MSG-188559-v1";
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [sourceCredentialId, inquiry({
          external: invalidExternalTicketId,
          parent: "MSG-188559-v1",
          recipient: "buyer\nid",
        })],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.support_tickets
          where owner_id = $1 and channel_key = 'ebay'
            and reply_context->>'parentMessageId' = 'MSG-188559-v1'`,
        [ADMIN_ID],
      ),
      0,
    );

    const activeCredentialId = await rotateEbayCredential({
      attested: true,
      suffix: "active-rotation",
      environment: "production",
    });
    await setClaims(db, "service_role");

    const firstJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'ebay', $2, $3::jsonb
      )`,
      [ticket.id, reply, replyPayload()],
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [ticket.id, reply, replyPayload()],
      ),
      firstJobId,
    );

    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [ticket.id, "A different reply", replyPayload({ body: "A different reply" })],
      ),
      /INQUIRY_REPLY_CONFLICT/,
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [ticket.id, reply, replyPayload({ item: "110005795325" })],
      ),
      /eBay ASQ context mismatch/,
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [ticket.id, reply, replyPayload({ parent: "MSG-188559-v1" })],
      ),
      /eBay ASQ context mismatch/,
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [ticket.id, reply, replyPayload({ recipient: "another_buyer" })],
      ),
      /eBay ASQ context mismatch/,
    );
    const oversizedReply = "x".repeat(2001);
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [ticket.id, oversizedReply, replyPayload({ body: oversizedReply })],
      ),
      /invalid inquiry reply gateway job/,
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [ticket.id, "Use <b>HTML</b>", replyPayload({ body: "Use <b>HTML</b>" })],
      ),
      /invalid inquiry reply gateway job/,
    );

    const job = (await db.query(
      `select credential_id::text as credential_id, channel, operation,
              request_payload, seller_account_key
         from sellerpilot_private.channel_gateway_jobs where id = $1`,
      [firstJobId],
    )).rows[0];
    assert.equal(job.credential_id, activeCredentialId);
    assert.equal(job.channel, "ebay");
    assert.equal(job.operation, "inquiries.reply");
    assert.equal(job.seller_account_key, ticket.seller_account_key);
    assert.deepEqual(job.request_payload.arguments, {
      itemId,
      parentMessageId,
      recipientId,
      marketplaceId,
      reply,
    });
    assert.equal(job.request_payload.sellerpilotTicketId, ticket.id);
    assert.match(job.request_payload.sellerpilotReplyFingerprint, /^[a-f0-9]{64}$/);
    const credentialStates = (await db.query(
      `select id::text as id, status, seller_account_key_source
         from sellerpilot_private.channel_credentials
        where id in ($1, $2)`,
      [sourceCredentialId, activeCredentialId],
    )).rows;
    assert.deepEqual(
      credentialStates.find((row) => row.id === sourceCredentialId),
      {
        id: sourceCredentialId,
        status: "grace",
        seller_account_key_source: "provider_certified_v1",
      },
    );
    assert.deepEqual(
      credentialStates.find((row) => row.id === activeCredentialId),
      {
        id: activeCredentialId,
        status: "active",
        seller_account_key_source: "provider_certified_v1",
      },
    );

    await issueWorkerToken(db);
    const claim = await claimOnlyQueuedReply(db);
    assert.equal(claim.id, firstJobId);
    assert.equal(claim.channel, "ebay");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1, $2, $3)",
        ["f".repeat(64), claim.id, claim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1, $2, $3)",
        [TOKEN_HASH, claim.id, claim.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select provider_mutation_started_at is not null from sellerpilot_private.channel_gateway_jobs where id = $1",
        [claim.id],
      ),
      true,
    );
    assert.equal(await completeReply(db, claim, {
      ok: true,
      channel: "ebay",
      operation: "inquiries.reply",
      safeMessage: "eBay ASQ reply accepted",
    }), true);
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status, reply_draft,
                resolved_at is not null as has_resolved_at,
                reply_context
           from sellerpilot_private.support_tickets where id = $1`,
        [ticket.id],
      )).rows,
      [{
        status: "resolved",
        reply_delivery_status: "succeeded",
        reply_draft: reply,
        has_resolved_at: true,
        reply_context: { itemId, parentMessageId, recipientId, marketplaceId },
      }],
    );

    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [sourceCredentialId, inquiry()],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select status, reply_delivery_status, reply_context
           from sellerpilot_private.support_tickets where id = $1`,
        [ticket.id],
      )).rows,
      [{
        status: "resolved",
        reply_delivery_status: "succeeded",
        reply_context: { itemId, parentMessageId, recipientId, marketplaceId },
      }],
    );

    const boundaryParentMessageId = "MSG-2000-BODY-BOUNDARY";
    const boundaryTicketId = await (async () => {
      const payload = inquiry({
        external: `ebay:${boundaryParentMessageId}`,
        parent: boundaryParentMessageId,
      });
      assert.equal(
        await scalar(
          db,
          "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
          [activeCredentialId, payload],
        ),
        1,
      );
      return scalar(
        db,
        `select id from sellerpilot_private.support_tickets
          where owner_id = $1 and channel_key = 'ebay'
            and reply_context->>'parentMessageId' = $2
            and seller_account_key = (
              select seller_account_key
                from sellerpilot_private.channel_credentials where id = $3
            )`,
        [ADMIN_ID, boundaryParentMessageId, activeCredentialId],
      );
    })();
    const boundaryReply = "x".repeat(2000);
    const boundaryJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'ebay', $2, $3::jsonb
      )`,
      [boundaryTicketId, boundaryReply, replyPayload({
        parent: boundaryParentMessageId,
        body: boundaryReply,
      })],
    );
    assert.equal(
      await scalar(
        db,
        "select operation from sellerpilot_private.channel_gateway_jobs where id = $1",
        [boundaryJobId],
      ),
      "inquiries.reply",
    );

    const cooldownClaim = await claimOnlyQueuedReply(db);
    assert.equal(cooldownClaim.id, boundaryJobId);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1, $2, $3)",
        [TOKEN_HASH, cooldownClaim.id, cooldownClaim.claim_token],
      ),
      true,
    );
    assert.equal(await completeReply(db, cooldownClaim, {
      ok: false,
      channel: "ebay",
      operation: "inquiries.reply",
      steps: [{
        name: "inquiry-reply",
        ok: false,
        status: 429,
        data: {
          Ack: "Failure",
          code: "FAILURE",
          errors: [{
            errorCode: "HTTP_429",
            classification: "SystemError",
            severity: "Error",
            message: "eBay Trading API rate limit exceeded.",
          }],
        },
      }],
      safeMessage: "eBay inquiries.reply 작업이 원격 오류로 종료됐습니다.",
    }), true);
    assert.deepEqual(
      await scalar(
        db,
        "select response_payload->'steps'->0 from sellerpilot_private.channel_gateway_jobs where id = $1",
        [boundaryJobId],
      ),
      {
        name: "inquiry-reply",
        ok: false,
        status: 429,
        data: {
          Ack: "Failure",
          code: "FAILURE",
          errors: [{
            errorCode: "HTTP_429",
            classification: "SystemError",
            severity: "Error",
            message: "eBay Trading API rate limit exceeded.",
          }],
        },
      },
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set started_at = clock_timestamp() - interval '61 seconds',
              provider_mutation_started_at = clock_timestamp() - interval '61 seconds',
              completed_at = clock_timestamp() - interval '61 seconds'
        where id = $1`,
      [boundaryJobId],
    );

    const cooldownParentMessageId = "MSG-PROVIDER-COOLDOWN-BLOCK";
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [activeCredentialId, inquiry({
          external: `ebay:${cooldownParentMessageId}`,
          parent: cooldownParentMessageId,
        })],
      ),
      1,
    );
    const cooldownTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'ebay'
          and reply_context->>'parentMessageId' = $2
          and seller_account_key = (
            select seller_account_key
              from sellerpilot_private.channel_credentials where id = $3
          )`,
      [ADMIN_ID, cooldownParentMessageId, activeCredentialId],
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [cooldownTicketId, reply, replyPayload({ parent: cooldownParentMessageId })],
      ),
      /EBAY_ASQ_PROVIDER_COOLDOWN_100_SECONDS/,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set started_at = clock_timestamp() - interval '101 seconds',
              provider_mutation_started_at = clock_timestamp() - interval '101 seconds',
              completed_at = clock_timestamp() - interval '101 seconds'
        where id = $1`,
      [boundaryJobId],
    );

    await setClaims(db, "authenticated");
    assert.deepEqual(
      (await db.query(
        `select environment, seller_account_key_source,
                seller_account_verified_at is not null as seller_account_verified,
                reply_context
           from public.sellerpilot_get_ticket_reply_dispatch_context($1)`,
        [ticket.id],
      )).rows,
      [{
        environment: "production",
        seller_account_key_source: "provider_certified_v1",
        seller_account_verified: true,
        reply_context: { itemId, parentMessageId, recipientId, marketplaceId },
      }],
    );

    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, attempt_id, channel, operation, environment,
         request_payload, status, created_by, started_at, completed_at
       )
       select $1, null, 'ebay', 'inquiries.reply', 'production',
              jsonb_build_object(
                'arguments', jsonb_build_object('reply', 'rate-window-ledger-row'),
                'sellerpilotTicketId', gen_random_uuid()
              ),
              'failed', $2, clock_timestamp(), clock_timestamp()
         from generate_series(1, 74)`,
      [activeCredentialId, ADMIN_ID],
    );

    const rateParentMessageId = "MSG-RATE-WINDOW-BLOCK";
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [activeCredentialId, inquiry({
          external: `ebay:${rateParentMessageId}`,
          parent: rateParentMessageId,
        })],
      ),
      1,
    );
    const rateTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'ebay'
          and reply_context->>'parentMessageId' = $2
          and seller_account_key = (
            select seller_account_key
              from sellerpilot_private.channel_credentials where id = $3
          )`,
      [ADMIN_ID, rateParentMessageId, activeCredentialId],
    );
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          $1, 'ebay', $2, $3::jsonb
        )`,
        [rateTicketId, reply, replyPayload({ parent: rateParentMessageId })],
      ),
      /EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS/,
    );

    const sandboxParentMessageId = "MSG-SANDBOX-REPLY-ALLOWED";
    const sandboxCredentialId = await rotateEbayCredential({
      attested: true,
      suffix: "sandbox-reply-allowed",
      environment: "sandbox",
    });
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'ebay', $2::jsonb)",
        [sandboxCredentialId, inquiry({
          external: `ebay:${sandboxParentMessageId}`,
          parent: sandboxParentMessageId,
        })],
      ),
      1,
    );
    const sandboxTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'ebay'
          and reply_context->>'parentMessageId' = $2
          and seller_account_key = (
            select seller_account_key
              from sellerpilot_private.channel_credentials where id = $3
          )`,
      [ADMIN_ID, sandboxParentMessageId, sandboxCredentialId],
    );
    const sandboxReplyJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'ebay', $2, $3::jsonb
      )`,
      [sandboxTicketId, reply, replyPayload({
        parent: sandboxParentMessageId,
      })],
    );
    assert.deepEqual(
      (await db.query(
        `select environment, seller_account_key
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [sandboxReplyJobId],
      )).rows,
      [{ environment: "sandbox", seller_account_key: await scalar(
        db,
        "select seller_account_key from sellerpilot_private.channel_credentials where id = $1",
        [sandboxCredentialId],
      ) }],
    );

    const source = await readFile(
      new URL(`../supabase/migrations/${EBAY_ASQ_MIGRATION}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /p_channel <> 'ebay'[\s\S]*sellerpilot_11820_enqueue_reply_unsafe/);
    assert.match(source, /length\(v_reply\) > 2000/);
    assert.match(source, /seller_account_key_source = 'provider_certified_v1'/);
    const siteSource = await readFile(
      new URL(`../supabase/migrations/${EBAY_ASQ_SITE_MIGRATION}`, import.meta.url),
      "utf8",
    );
    assert.match(siteSource, /seller_account_verified_at is not null/);
    assert.doesNotMatch(siteSource, /EBAY_ASQ_SANDBOX_REPLY_UNSUPPORTED/);
    assert.match(siteSource, /c\.environment = v_source_credential\.environment/);
    assert.match(siteSource, /EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS/);
  } finally {
    await db.close();
  }
});
