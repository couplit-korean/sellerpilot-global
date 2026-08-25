import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN_ID = "40404b44-f364-4c52-98ca-9d6f7371d3a1";
const TOKEN_HASH = "9".repeat(64);
const LINEAGE_MIGRATION = "20260825111810_harden_inquiry_reply_account_lineage.sql";
const PRE_LINEAGE_MIGRATION = "20260825111800_bind_listing_seller_accounts.sql";

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
as $$ select convert_to(md5(value || algorithm), 'UTF8') $$;
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
