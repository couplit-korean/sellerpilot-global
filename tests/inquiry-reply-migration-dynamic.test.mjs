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
// This reduced CS fixture last passed on dda5386 and intentionally omits
// the serverless claimant chain. Pin its exact schema horizon; production
// overlay replay remains covered by the separate full migration suite.
const CS_FIXTURE_SCHEMA_THROUGH = "20260901174000_require_exact_smartstore_stock_one.sql";
const FIXTURE_EXCLUDED_MIGRATIONS = new Set([
  "20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql",
  "20260828145700_schedule_serverless_cs_wakeup.sql",
  // These four forward migrations depend on the dedicated serverless runtime
  // created by 145600. This fixture intentionally excludes that runtime, so
  // its dependent prioritization, gates, and cleanup stay excluded as a unit.
  "20260828145900_durable_korean_inquiry_history_backfill.sql",
  "20260828145950_extend_serverless_cs_qoo10_inquiries.sql",
  "20260828200500_gate_serverless_static_egress.sql",
  "20260828201500_cleanup_static_egress_queued_reads.sql",
  // The Smartstore release is a forward composition over the excluded static
  // egress chain and must not be applied to this intentionally reduced fixture.
  // Its corrective restore is the inverse composition over that same marker,
  // so applying the restore without the release is intentionally impossible
  // and must remain excluded as the same atomic fixture unit.
  "20260831145000_release_smartstore_from_static_egress.sql",
  "20260901120000_restore_smartstore_static_egress_fence.sql",
  // The exact Qoo10 claim-priority patch pins the complete production
  // serverless claimant chain that this intentionally reduced CS fixture omits.
  "20260831057100_prioritize_exact_qoo10_s1_activation_claim.sql",
  // Production-specific competitor queue retirement and its follow-up lineage
  // fence are independent of inquiry ingestion and reply delivery contracts.
  "20260831131500_retire_pre_v3_competitor_search_queue.sql",
  "20260831132000_competitor_identity_lineage_fence.sql",
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

async function applyMigrations(db, { through = CS_FIXTURE_SCHEMA_THROUGH } = {}) {
  const { migrationUrl, names } = await migrationEntries();
  assert.ok(names.includes(through), "the exact historical CS fixture schema must exist");
  for (const name of names) {
    if (name > through) break;
    if (FIXTURE_EXCLUDED_MIGRATIONS.has(name)) continue;
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
    providerStatus: status === "resolved" ? "answered" : "waiting",
    priority: 3,
    receivedAt: "2026-08-25T09:00:00.000Z",
    remoteMessageId: `message-${suffix}`,
    inboundKey: `qoo10:test:${suffix}`,
    providerContext: { inquiryType: "MSG", questionNo: suffix, sequenceNo: "1" },
    replyContext: { inquiryType: "MSG", questionNo: suffix, sequenceNo: "1" },
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
    sellerpilotExpectedInboundKey: `qoo10:test:${questionNo}`,
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
    assert.equal(await scalar(db, "select has_function_privilege('anon', 'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)', 'EXECUTE')"), false);
    assert.equal(await scalar(db, "select has_function_privilege('authenticated', 'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)', 'EXECUTE')"), false);
    assert.equal(await scalar(db, "select has_function_privilege('service_role', 'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)', 'EXECUTE')"), true);
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
            providerStatus: "waiting",
            priority: 3,
            receivedAt: "2026-08-28T05:00:00.000Z",
            remoteMessageId: "456789",
            inboundKey: "smartstore:test:product:456789",
            providerContext: { kind: "product", questionId: "456789" },
            replyContext: { kind: "product", questionId: "456789" },
          },
          {
            externalTicketId: "customer:987654",
            customerName: "고객문의 고객",
            subject: "스마트스토어 고객 문의",
            message: "고객 문의입니다.",
            status: "waiting",
            providerStatus: "waiting",
            priority: 3,
            receivedAt: "2026-08-28T05:01:00.000Z",
            remoteMessageId: "987654",
            inboundKey: "smartstore:test:customer:987654",
            providerContext: { kind: "customer", inquiryNo: "987654" },
            replyContext: { kind: "customer", inquiryNo: "987654" },
          },
        ])],
      ),
      2,
    );

    const productTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where channel_key = 'smartstore' and external_ticket_id = 'smartstore:product-qna:456789'`,
    );
    const customerTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where channel_key = 'smartstore' and external_ticket_id = 'customer:987654'`,
    );
    await db.query(
      "update sellerpilot_private.serverless_static_egress_policy set enabled = true where channel = 'smartstore'",
    );

    const productReply = "상품 문의 답변입니다.";
    const productJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'smartstore', $2::text,
        jsonb_build_object('sellerpilotExpectedInboundKey', 'smartstore:test:product:456789', 'arguments', jsonb_build_object(
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
        jsonb_build_object('sellerpilotExpectedInboundKey', 'smartstore:test:customer:987654', 'arguments', jsonb_build_object(
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
          jsonb_build_object('sellerpilotExpectedInboundKey', 'smartstore:test:customer:987654', 'arguments', jsonb_build_object(
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
          jsonb_build_object('sellerpilotExpectedInboundKey', 'smartstore:test:customer:987654', 'arguments', jsonb_build_object(
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
          jsonb_build_object('sellerpilotExpectedInboundKey', 'smartstore:test:customer:987654', 'arguments', jsonb_build_object(
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
          jsonb_build_object('sellerpilotExpectedInboundKey', 'smartstore:test:product:456789', 'arguments', jsonb_build_object(
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
      `select status, provider_status, reply_delivery_status, reply_draft,
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
        `select status, provider_status, reply_delivery_status, reply_draft,
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

test("a replayed stable inbound identity cannot move the current ticket behind a newer message", async () => {
  const db = await createDatabase();
  try {
    const credentialId = await seedAdminAndCredential(db);
    await setClaims(db, "service_role");
    const externalTicketId = "qoo10:MSG:ordering:1";
    const message = ({ key, remoteId, body, receivedAt, questionNo }) => JSON.stringify([{
      externalTicketId,
      customerName: `고객 ${key}`,
      subject: `문의 ${key}`,
      message: body,
      status: "waiting",
      providerStatus: "waiting",
      priority: 3,
      receivedAt,
      remoteMessageId: remoteId,
      inboundKey: key,
      providerContext: { inquiryType: "MSG", questionNo, sequenceNo: "1" },
      replyContext: { inquiryType: "MSG", questionNo, sequenceNo: "1" },
    }]);
    const inboundA = "qoo10:test:ordering:A";
    const inboundB = "qoo10:test:ordering:B";

    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [credentialId, message({
        key: inboundA,
        remoteId: "ordering-A",
        body: "A at nine",
        receivedAt: "2026-08-25T09:00:00.000Z",
        questionNo: "ordering-A",
      })],
    ), 1);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [credentialId, message({
        key: inboundB,
        remoteId: "ordering-B",
        body: "B at ten",
        receivedAt: "2026-08-25T10:00:00.000Z",
        questionNo: "ordering-B",
      })],
    ), 1);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [credentialId, message({
        key: inboundA,
        remoteId: "ordering-A",
        body: "A replayed with a later fallback timestamp",
        receivedAt: "2026-08-25T11:00:00.000Z",
        questionNo: "ordering-A",
      })],
    ), 1);

    assert.deepEqual((await db.query(
      `select latest_inbound_key, message, received_at::text as received_at,
              provider_context->>'questionNo' as question_no
         from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'qoo10' and external_ticket_id = $2`,
      [ADMIN_ID, externalTicketId],
    )).rows, [{
      latest_inbound_key: inboundB,
      message: "B at ten",
      received_at: "2026-08-25 10:00:00+00",
      question_no: "ordering-B",
    }]);
    assert.deepEqual((await db.query(
      `select inbound_key, received_at::text as received_at
         from sellerpilot_private.support_inbound_messages
        where owner_id = $1 and channel_key = 'qoo10'
          and inbound_key in ($2, $3)
        order by inbound_key`,
      [ADMIN_ID, inboundA, inboundB],
    )).rows, [
      { inbound_key: inboundA, received_at: "2026-08-25 09:00:00+00" },
      { inbound_key: inboundB, received_at: "2026-08-25 10:00:00+00" },
    ]);
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
        `select status, provider_status, reply_delivery_status, resolved_at is not null as has_resolved_at
           from sellerpilot_private.support_tickets where id = $1`,
        [ticketId],
      )).rows,
      [{ status: "waiting", provider_status: "answered", reply_delivery_status: "failed", has_resolved_at: false }],
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

    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
        [credentialId, inquiryPayload("qoo10:MSG:10003:1", "10003", "resolved")],
      ),
      1,
    );
    await setClaims(db, "authenticated");
    assert.deepEqual((await db.query(
      "select provider_status, reply_delivery_status from sellerpilot_private.support_tickets where id = $1",
      [ticketId],
    )).rows, [{ provider_status: "answered", reply_delivery_status: "sending" }]);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_update_ticket($1, 'resolved', '채널 확인 완료', 'qoo10:test:10003')",
      [ticketId],
    ), true);
    assert.deepEqual((await db.query(
      `select status, provider_status, reply_delivery_status, reply_delivery_error,
              last_delivery_job_id::text as last_delivery_job_id
         from sellerpilot_private.support_tickets where id = $1`,
      [ticketId],
    )).rows, [{
      status: "resolved",
      provider_status: "answered",
      reply_delivery_status: "never",
      reply_delivery_error: null,
      last_delivery_job_id: null,
    }]);
    assert.deepEqual((await db.query(
      `select status, acknowledged_at is not null as acknowledged,
              acknowledgement_reason
         from sellerpilot_private.support_reply_deliveries
        where gateway_job_id = $1`,
      [jobId],
    )).rows, [{
      status: "reconciliation_required",
      acknowledged: true,
      acknowledgement_reason: "provider_status:answered",
    }]);
    const acknowledgedWorkspace = await scalar(db, "select public.sellerpilot_get_cs_workspace_snapshot()");
    const acknowledgedTicket = acknowledgedWorkspace.tickets.find((ticket) => ticket.ticketId === ticketId);
    assert.equal(acknowledgedTicket.delivery, null);
    assert.equal(acknowledgedTicket.blockingDelivery, null);
    assert.equal(acknowledgedWorkspace.summary.reconciliationRequired, 0);
    assert.equal(acknowledgedWorkspace.summary.blocking, 0);

    const nextTicketId = await ingestTicket(db, credentialId, "10004");
    const nextJobId = await enqueueReply(db, nextTicketId, "10004", "다음 문의 답변입니다.");
    const nextClaim = await claimOnlyQueuedReply(db);
    assert.equal(nextClaim.id, nextJobId);
  } finally {
    await db.close();
  }
});

test("personal-data pruning removes CS bodies while retaining a minimal delivery outcome", async () => {
  const db = await createDatabase();
  try {
    const credentialId = await seedAdminAndCredential(db);
    await issueWorkerToken(db);
    const ticketId = await ingestTicket(db, credentialId, "privacy-1");
    const jobId = await enqueueReply(db, ticketId, "privacy-1", "개인정보가 포함된 답변");
    const claim = await claimOnlyQueuedReply(db);
    assert.equal(claim.id, jobId);
    assert.equal(await completeReply(db, claim, {
      ok: true,
      channel: "qoo10",
      operation: "inquiries.reply",
      safeMessage: "PII provider message",
      remoteId: "PII-REMOTE-ID",
    }), true);

    await db.query(
      `update sellerpilot_private.support_tickets
          set customer_name = 'PII buyer', subject = 'PII subject', message = 'PII body',
              translated_message = 'PII translation', reply_draft = 'PII draft',
              reply_context = '{"customerEmail":"pii@example.test"}'::jsonb,
              provider_context = '{"providerUser":"PII-user"}'::jsonb,
              external_order_reference = 'PII-ORDER',
              resolved_at = now() - interval '40 days', updated_at = now() - interval '40 days'
        where id = $1`,
      [ticketId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_at = now() - interval '40 days', started_at = now() - interval '40 days',
              completed_at = now() - interval '40 days', updated_at = now() - interval '40 days'
        where id = $1`,
      [jobId],
    );
    await db.query(
      `update sellerpilot_private.support_reply_deliveries
          set provider_request_id = 'PII-REQUEST', provider_message_id = 'PII-MESSAGE',
              safe_message = 'PII safe message', updated_at = now() - interval '40 days'
        where gateway_job_id = $1`,
      [jobId],
    );
    await db.query(
      `insert into sellerpilot_private.support_pending_seller_messages(
         owner_id, credential_id, seller_account_key, channel_key, external_ticket_id,
         inbound_key, remote_message_id, body, received_at
       ) values ($1, $2, $3, 'lazada', 'privacy-session', 'privacy-pending',
         'PII-message-id', 'PII pending body', now() - interval '40 days')`,
      [ADMIN_ID, credentialId, "a".repeat(64)],
    );

    await setClaims(db, "service_role");
    const result = await scalar(
      db,
      "select public.sellerpilot_prune_personal_data(now() - interval '30 days')",
    );
    assert.equal(result.ticketsAnonymized, 1);
    assert.equal(result.inboundMessagesDeleted, 1);
    assert.equal(result.pendingSellerMessagesDeleted, 1);
    assert.equal(result.deliveriesRedacted, 1);
    assert.equal(result.gatewayJobsDeleted, 1);
    assert.deepEqual((await db.query(
      `select customer_name, subject, message, translated_message, reply_draft,
              reply_context, provider_context, external_order_reference, latest_inbound_key
         from sellerpilot_private.support_tickets where id = $1`,
      [ticketId],
    )).rows, [{
      customer_name: "[개인정보 삭제됨]",
      subject: "[개인정보 삭제됨]",
      message: "[개인정보 삭제됨]",
      translated_message: null,
      reply_draft: null,
      reply_context: {},
      provider_context: {},
      external_order_reference: null,
      latest_inbound_key: null,
    }]);
    assert.equal(await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.support_inbound_messages where ticket_id = $1",
      [ticketId],
    ), 0);
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.support_pending_seller_messages"), 0);
    assert.equal(await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where id = $1",
      [jobId],
    ), 0);
    const delivery = (await db.query(
      `select gateway_job_id::text as gateway_job_id, status, reply_fingerprint,
              provider_request_id, provider_message_id, safe_message
         from sellerpilot_private.support_reply_deliveries where ticket_id = $1`,
      [ticketId],
    )).rows[0];
    assert.equal(delivery.gateway_job_id, null);
    assert.equal(delivery.status, "succeeded");
    assert.match(delivery.reply_fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(delivery.provider_request_id, null);
    assert.equal(delivery.provider_message_id, null);
    assert.equal(delivery.safe_message, null);
  } finally {
    await db.close();
  }
});

test("a Lazada seller-first event survives credential rotation within the same certified account", async () => {
  const db = await createDatabase();
  try {
    await seedAdminAndCredential(db);
    const providerSubject = `lazada:v1:${"A".repeat(60)}`;
    const rotateLazada = async (version) => {
      await setClaims(db, "service_role");
      return scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          'lazada', 'production', $1::jsonb,
          now() + interval '180 days', 90, 30, 0
        )`,
        [JSON.stringify({
          app_key: "lazada-cs-app",
          app_secret: "lazada-cs-secret",
          country: "my",
          access_token: `lazada-access-${version}`,
          refresh_token: `lazada-refresh-${version}`,
          provider_account_subject: providerSubject,
          provider_account_identity_version: "v1",
        })],
      );
    };
    const firstCredentialId = await rotateLazada(1);
    const sellerEvent = JSON.stringify([{
      externalTicketId: "lazada-session-rotation",
      customerName: "Lazada buyer",
      subject: "Lazada IM",
      message: "Seller answered first",
      senderRole: "seller",
      status: "resolved",
      providerStatus: "answered",
      priority: 3,
      receivedAt: "2026-08-25T09:00:00.000Z",
      remoteMessageId: "seller-message-rotation",
      inboundKey: "lazada:test:seller-message-rotation",
      providerContext: { sessionId: "lazada-session-rotation" },
      replyContext: { sessionId: "lazada-session-rotation" },
    }]);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'lazada', $2::jsonb)",
      [firstCredentialId, sellerEvent],
    ), 0);
    assert.equal(await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.support_pending_seller_messages",
    ), 1);

    const secondCredentialId = await rotateLazada(2);
    assert.notEqual(secondCredentialId, firstCredentialId);
    assert.equal(await scalar(
      db,
      `select first.seller_account_key = second.seller_account_key
         from sellerpilot_private.channel_credentials first
         join sellerpilot_private.channel_credentials second on second.id = $2
        where first.id = $1
          and first.seller_account_key_source = 'provider_certified_v1'
          and second.seller_account_key_source = 'provider_certified_v1'`,
      [firstCredentialId, secondCredentialId],
    ), true);
    const buyerEvent = JSON.stringify([{
      externalTicketId: "lazada-session-rotation",
      customerName: "Lazada buyer",
      subject: "Lazada IM",
      message: "Buyer message after seller event",
      senderRole: "customer",
      status: "waiting",
      providerStatus: "waiting",
      priority: 3,
      receivedAt: "2026-08-25T10:00:00.000Z",
      remoteMessageId: "buyer-message-rotation",
      inboundKey: "lazada:test:buyer-message-rotation",
      providerContext: { sessionId: "lazada-session-rotation" },
      replyContext: { sessionId: "lazada-session-rotation" },
    }]);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'lazada', $2::jsonb)",
      [secondCredentialId, buyerEvent],
    ), 1);
    assert.equal(await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.support_pending_seller_messages",
    ), 0);
    assert.deepEqual((await db.query(
      `select ticket.provider_status, ticket.latest_inbound_key,
              count(*) filter (where message.sender_role = 'seller')::integer as seller_messages,
              count(*) filter (where message.sender_role = 'customer')::integer as customer_messages
         from sellerpilot_private.support_tickets ticket
         join sellerpilot_private.support_inbound_messages message on message.ticket_id = ticket.id
        where ticket.source_credential_id = $1
          and ticket.external_ticket_id = 'lazada-session-rotation'
        group by ticket.id`,
      [secondCredentialId],
    )).rows, [{
      provider_status: "waiting",
      latest_inbound_key: "lazada:test:buyer-message-rotation",
      seller_messages: 1,
      customer_messages: 1,
    }]);
  } finally {
    await db.close();
  }
});

test("an AI support draft is generation-bound and a stale completion is discarded", async () => {
  const db = await createDatabase();
  try {
    assert.equal(await scalar(
      db,
      "select has_function_privilege('authenticated', 'public.sellerpilot_complete_ai_job_with_image_context(text,uuid,uuid,text,jsonb,text,jsonb)', 'EXECUTE')",
    ), false);
    assert.equal(await scalar(
      db,
      "select has_function_privilege('service_role', 'public.sellerpilot_complete_ai_job_with_image_context(text,uuid,uuid,text,jsonb,text,jsonb)', 'EXECUTE')",
    ), true);
    assert.equal(await scalar(
      db,
      "select has_function_privilege('service_role', 'public.sellerpilot_31033000_complete_ai_job_with_image_context_unsafe(text,uuid,uuid,text,jsonb,text,jsonb)', 'EXECUTE')",
    ), false);
    const credentialId = await seedAdminAndCredential(db);
    await setClaims(db, "service_role");
    const externalTicketId = "qoo10:MSG:support-draft:1";
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [credentialId, inquiryPayload(externalTicketId, "support-draft-a")],
    ), 1);
    const ticketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'qoo10' and external_ticket_id = $2`,
      [ADMIN_ID, externalTicketId],
    );
    const aiJobId = "77777777-7777-4777-8777-777777777777";
    await setClaims(db, "authenticated");
    assert.equal(await scalar(
      db,
      `select public.sellerpilot_create_support_reply_job(
        $1, $2, 'qoo10:test:support-draft-a', 'ko-KR', 'polite'
      )`,
      [aiJobId, ticketId],
    ), aiJobId);
    assert.equal(await scalar(
      db,
      "select request_payload->>'sellerpilotInboundKey' from sellerpilot_private.ai_cli_jobs where id = $1",
      [aiJobId],
    ), "qoo10:test:support-draft-a");

    const aiTokenHash = "8".repeat(64);
    await scalar(
      db,
      `select public.sellerpilot_issue_ai_worker_token(
        'CS draft worker', $1, '888888888888', now() + interval '30 days', 'ai'
      )`,
      [aiTokenHash],
    );
    await setClaims(db, "service_role");
    const claim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'cs-dynamic/support-reply')",
      [aiTokenHash],
    );
    assert.equal(claim.id, aiJobId);
    assert.equal(claim.request.sellerpilotInboundKey, "qoo10:test:support-draft-a");

    const nextInbound = JSON.parse(inquiryPayload(externalTicketId, "support-draft-b"));
    nextInbound[0].receivedAt = "2026-08-25T10:00:00.000Z";
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [credentialId, JSON.stringify(nextInbound)],
    ), 1);
    assert.equal(await scalar(
      db,
      `select public.sellerpilot_complete_ai_job_with_image_context(
        $1, $2, $3, 'succeeded', $4::jsonb, null, null
      )`,
      [aiTokenHash, aiJobId, claim.claim_token, JSON.stringify({
        mode: "support-reply",
        targetLocale: "ko-KR",
        draft: "새 문의가 오기 전에 작성된 오래된 답변 초안입니다.",
        sourceSummary: "old inbound",
        cautions: [],
      })],
    ), true);
    assert.deepEqual((await db.query(
      `select status, result_payload, error_message
         from sellerpilot_private.ai_cli_jobs where id = $1`,
      [aiJobId],
    )).rows, [{
      status: "failed",
      result_payload: null,
      error_message: "새 고객 메시지가 도착해 이전 문의의 AI 답변 초안을 폐기했습니다.",
    }]);
    assert.deepEqual((await db.query(
      `select latest_inbound_key, reply_draft
         from sellerpilot_private.support_tickets where id = $1`,
      [ticketId],
    )).rows, [{
      latest_inbound_key: "qoo10:test:support-draft-b",
      reply_draft: null,
    }]);
  } finally {
    await db.close();
  }
});

test("a Temu after-sales revision reopens a manually resolved ticket and fences the stale tab", async () => {
  const db = await createDatabase();
  try {
    await seedAdminAndCredential(db);
    await setClaims(db, "authenticated");
    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'temu', 'production',
        '{"app_key":"temu-cs-app","app_secret":"temu-cs-secret","access_token":"temu-cs-access"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const externalTicketId = "aftersales:AFTER-SALES-REVISION";
    const payload = ({ inboundKey, remoteMessageId, group, receivedAt }) => JSON.stringify([{
      externalTicketId,
      customerName: "Temu 구매자",
      subject: "반품·환불 요청",
      message: `Temu 상태 ${group}`,
      status: "waiting",
      providerStatus: "waiting",
      priority: 2,
      receivedAt,
      remoteMessageId,
      inboundKey,
      ticketKind: "after_sales",
      providerContext: {
        afterSalesSn: "AFTER-SALES-REVISION",
        statusGroup: group,
        availableOperations: group === "1" ? ["return"] : ["approve"],
      },
    }]);
    const inboundOne = "temu:test:revision-one";
    const inboundTwo = "temu:test:revision-two";
    await setClaims(db, "service_role");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'temu', $2::jsonb)",
      [credentialId, payload({
        inboundKey: inboundOne,
        remoteMessageId: "AFTER-SALES-REVISION:revision-one",
        group: "1",
        receivedAt: "2026-08-25T09:00:00.000Z",
      })],
    ), 1);
    const ticketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'temu' and external_ticket_id = $2`,
      [ADMIN_ID, externalTicketId],
    );
    await setClaims(db, "authenticated");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_update_ticket($1, 'resolved', '판매자센터 확인', $2)",
      [ticketId, inboundOne],
    ), true);

    await setClaims(db, "service_role");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'temu', $2::jsonb)",
      [credentialId, payload({
        inboundKey: inboundTwo,
        remoteMessageId: "AFTER-SALES-REVISION:revision-two",
        group: "2",
        receivedAt: "2026-08-25T10:00:00.000Z",
      })],
    ), 1);
    assert.deepEqual((await db.query(
      `select status, provider_status, latest_inbound_key, resolved_at
         from sellerpilot_private.support_tickets where id = $1`,
      [ticketId],
    )).rows, [{
      status: "waiting",
      provider_status: "waiting",
      latest_inbound_key: inboundTwo,
      resolved_at: null,
    }]);
    await setClaims(db, "authenticated");
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_update_ticket($1, 'resolved', '오래된 탭', $2)",
        [ticketId, inboundOne],
      ),
      /INQUIRY_CONTEXT_STALE/,
    );

    await setClaims(db, "service_role");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'temu', $2::jsonb)",
      [credentialId, payload({
        inboundKey: inboundTwo,
        remoteMessageId: "AFTER-SALES-REVISION:revision-two",
        group: "2",
        receivedAt: "2026-08-25T11:00:00.000Z",
      })],
    ), 1);
    assert.deepEqual((await db.query(
      `select status, latest_inbound_key,
              (select count(*)::integer from sellerpilot_private.support_inbound_messages message
                where message.ticket_id = ticket.id) as inbound_count
         from sellerpilot_private.support_tickets ticket where id = $1`,
      [ticketId],
    )).rows, [{
      status: "waiting",
      latest_inbound_key: inboundTwo,
      inbound_count: 2,
    }]);
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
    providerStatus: "waiting",
    priority: 3,
    receivedAt: "2026-08-28T01:00:00.000Z",
    remoteMessageId: parent,
    inboundKey: `ebay:test:${parent}`,
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
    expectedParent = parent,
  } = {}) => JSON.stringify({
    sellerpilotExpectedInboundKey: `ebay:test:${expectedParent}`,
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
        [ticket.id, reply, replyPayload({ parent: "MSG-188559-v1", expectedParent: parentMessageId })],
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
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1, $2, $3)",
        ["f".repeat(64), claim.id, claim.claim_token],
      ),
      /invalid worker token/,
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


test("Lazada normalized full history persists both roles without replacing the latest buyer", async () => {
  const { normalizeLazadaImHistory } = await import("../lib/channels/lazada-im.ts");
  const db = await createDatabase();
  try {
    await seedAdminAndCredential(db);
    await setClaims(db, "service_role");
    const credentialId = await scalar(db, `select public.sellerpilot_rotate_credential(
      'lazada', 'production', $1::jsonb, now() + interval '180 days', 90, 30, 0
    )`, [JSON.stringify({
      app_key: "lazada-cs-app", app_secret: "test-only", country: "my", access_token: "test-only",
      provider_account_subject: `lazada:v1:${"A".repeat(60)}`, provider_account_identity_version: "v1",
    })]);
    const session = { session_id: "full-history", title: "test buyer", unread_count: 0 };
    const event = (id, sender, minute) => ({
      message_id: id, from_account_type: sender, send_time: `2026-08-25T09:0${minute}:00.000Z`,
      content: { txt: id }, status: 0,
    });
    const buyer1 = event("buyer-1", 1, 0);
    const seller1 = event("seller-1", 2, 1);
    const buyer2 = event("buyer-2", 1, 2);
    const seller2 = event("seller-2", 2, 3);
    const normalize = (pages) => normalizeLazadaImHistory(pages.map((messages, index) => ({
      name: `inquiries-message:full-history:${index + 1}`,
      data: { sellerpilotSession: session, data: { message_list: messages } },
    })), "2026-08-25T10:00:00.000Z");
    const ingest = (rows) => scalar(db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'lazada', $2::jsonb)",
      [credentialId, JSON.stringify(rows)]);
    const state = async () => (await db.query(`
      select t.provider_status, t.message, latest.remote_message_id as latest_buyer,
             count(*)::integer as messages,
             count(*) filter (where m.sender_role = 'seller')::integer as seller_messages,
             count(*) filter (where m.sender_role = 'customer')::integer as customer_messages
        from sellerpilot_private.support_tickets t
        join sellerpilot_private.support_inbound_messages m on m.ticket_id = t.id
        join sellerpilot_private.support_inbound_messages latest
          on latest.ticket_id = t.id and latest.inbound_key = t.latest_inbound_key
       where t.source_credential_id = $1
       group by t.id, latest.remote_message_id`, [credentialId])).rows;
    const history = normalize([[buyer2, seller1], [seller1, buyer1]]);
    assert.equal(history.length, 3);
    await ingest(history);
    assert.deepEqual(await state(), [{ provider_status: "waiting", message: "buyer-2", latest_buyer: "buyer-2", messages: 3, seller_messages: 1, customer_messages: 2 }]);
    await ingest(history);
    assert.equal((await state())[0].messages, 3);
    // A missing old seller timestamp must not become the 10:00 collection
    // timestamp and resolve the newer 09:02 buyer. Reject the whole unsafe
    // batch rather than dropping its body or inventing a sortable timestamp.
    const missingTimePages = [[buyer2, { ...seller1, send_time: undefined }]];
    const originalMissingTimePages = structuredClone(missingTimePages);
    let timestampError;
    try {
      await ingest(normalize(missingTimePages));
    } catch (error) {
      timestampError = error;
    }
    assert.equal((await state())[0].provider_status, "waiting");
    assert.equal((await state())[0].latest_buyer, "buyer-2");
    assert.equal((await state())[0].messages, 3);
    assert.match(timestampError?.message ?? "", /LAZADA_IM_SELLER_TIMESTAMP_UNVERIFIED/);
    assert.deepEqual(missingTimePages, originalMissingTimePages);
    assert.deepEqual((await db.query(`select body from sellerpilot_private.support_inbound_messages
      where remote_message_id = 'seller-1'`)).rows, [{ body: "seller-1" }]);
    await ingest(normalize([[seller2, buyer2], [seller1, buyer1]]));
    assert.deepEqual(await state(), [{ provider_status: "answered", message: "buyer-2", latest_buyer: "buyer-2", messages: 4, seller_messages: 2, customer_messages: 2 }]);
    await ingest(normalize([[seller1, buyer1]]));
    assert.equal((await state())[0].latest_buyer, "buyer-2");
    assert.equal((await state())[0].provider_status, "answered");
    assert.deepEqual((await db.query(`select remote_message_id, sender_role, body
      from sellerpilot_private.support_inbound_messages order by received_at`)).rows, [
      { remote_message_id: "buyer-1", sender_role: "customer", body: "buyer-1" },
      { remote_message_id: "seller-1", sender_role: "seller", body: "seller-1" },
      { remote_message_id: "buyer-2", sender_role: "customer", body: "buyer-2" },
      { remote_message_id: "seller-2", sender_role: "seller", body: "seller-2" },
    ]);
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.support_reply_deliveries"), 0);
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation = 'inquiries.reply'"), 0);
  } finally {
    await db.close();
  }
});
