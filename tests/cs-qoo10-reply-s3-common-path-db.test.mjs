import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { qoo10ReplyS3CompletionEvidence } from "../lib/channels/cs/qoo10/reply-readback-completion.ts";

const ids = {
  owner: "20000000-0000-4000-8000-000000000001",
  credential: "20000000-0000-4000-8000-000000000002",
  ticket: "20000000-0000-4000-8000-000000000003",
  inbound: "20000000-0000-4000-8000-000000000004",
  replyJob: "20000000-0000-4000-8000-000000000005",
  delivery: "20000000-0000-4000-8000-000000000006",
  worker: "20000000-0000-4000-8000-000000000007",
  replyClaim: "20000000-0000-4000-8000-000000000008",
  readClaim: "20000000-0000-4000-8000-000000000009",
  oldTicket: "20000000-0000-4000-8000-000000000010",
  oldInbound: "20000000-0000-4000-8000-000000000011",
  oldReplyJob: "20000000-0000-4000-8000-000000000012",
  oldDelivery: "20000000-0000-4000-8000-000000000013",
  oldClaim: "20000000-0000-4000-8000-000000000014",
};
const tokenHash = "a".repeat(64);
const sellerAccountKey = "b".repeat(64);
const completionFingerprint = "c".repeat(64);
const statusSql = await readFile(new URL(
  "../supabase/migrations/20260908140419_cs_qoo10_reply_s3_status.sql", import.meta.url,
), "utf8");
const sealSql = await readFile(new URL(
  "../supabase/migrations/20260908140421_cs_qoo10_reply_s3_response_seal.sql", import.meta.url,
), "utf8");
const commonSql = await readFile(new URL(
  "../supabase/migrations/20260908145336_cs_qoo10_reply_s3_common_paths.sql", import.meta.url,
), "utf8");

function bindingDigest() {
  return createHash("sha256").update(JSON.stringify({
    inquiryType: "MSG", questionNo: "700", sequenceNo: "701",
  })).digest("hex");
}

function replyRequest(inboundKey = "qoo10:inbound:current") {
  return {
    arguments: {
      params: { inq_type: "MSG", question_no: "700", seq_no: "701", contents: "reply body" },
    },
    sellerpilotInboundKey: inboundKey,
    sellerpilotReplyFingerprint: "d".repeat(64),
    sellerpilotTicketId: ids.ticket,
  };
}

function replyResponse(digest = bindingDigest()) {
  return {
    ok: true,
    channel: "qoo10",
    operation: "inquiries.reply",
    steps: [{
      name: "SetInquiryMessage",
      ok: true,
      status: 200,
      data: {
        ResultCode: 0,
        sellerpilotReplyAcceptance: {
          contract: "sellerpilot-reply-acceptance/1",
          level: "provider_accepted",
          channel: "qoo10",
          kind: "inquiry",
          bindingDigest: digest,
        },
      },
    }],
  };
}

async function createBase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select '${ids.owner}'::uuid $$;
    create schema extensions;
    create function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable
    as $$ select sha256(convert_to(value,'UTF8')) $$;
    create schema sellerpilot_private;
    create function public.sellerpilot_is_admin() returns boolean
    language sql stable as $$ select true $$;

    create table sellerpilot_private.channel_credentials (
      id uuid primary key,channel text not null,environment text not null,
      created_by uuid not null,status text not null,expires_at timestamptz,
      seller_account_key text
    );
    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key,token_hash text not null,scope text not null,status text not null,
      expires_at timestamptz not null,created_by uuid not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),credential_id uuid not null,
      attempt_id uuid,channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null default '{}'::jsonb,response_payload jsonb,
      status text not null default 'queued',error_message text,created_by uuid not null,
      seller_account_key text,completed_at timestamptz,updated_at timestamptz not null default clock_timestamp(),
      created_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.gateway_completion_receipts (
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
      claim_token uuid not null,worker_token_id uuid not null
        references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
      completion_fingerprint text not null,continuation_job_id uuid,
      created_at timestamptz not null default clock_timestamp(),
      unique(job_id,claim_token)
    );
    create table sellerpilot_private.support_tickets (
      id uuid primary key,owner_id uuid not null,source_credential_id uuid not null,
      channel_key text not null,ticket_kind text not null,latest_inbound_key text not null,
      seller_account_key text not null,demo boolean not null default false,
      last_delivery_job_id uuid
    );
    create table sellerpilot_private.support_inbound_messages (
      id uuid primary key,ticket_id uuid not null,owner_id uuid not null,
      channel_key text not null,inbound_key text not null,sender_role text not null,
      received_at timestamptz not null
    );
    create table sellerpilot_private.support_reply_deliveries (
      id uuid primary key,ticket_id uuid not null,owner_id uuid not null,
      gateway_job_id uuid not null unique,channel_key text not null,status text not null,
      verification_status text not null,verification_contract text,
      safe_message text,reconciliation_reason text,provider_request_id text,
      provider_message_id text,provider_accepted_at timestamptz,remote_observed_at timestamptz,
      queued_at timestamptz not null,started_at timestamptz,completed_at timestamptz,
      updated_at timestamptz not null
    );

    create function public.sellerpilot_service_gateway_completion_context(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns jsonb language sql security definer set search_path='' as $$
      select jsonb_build_object(
        'id',job.id,'credential_id',job.credential_id,'channel',job.channel,
        'operation',job.operation,'status',case when job.status='queued' then 'running' else job.status end
      ) from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id
    $$;
    revoke all on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
      from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
      to service_role;

    create function public.sellerpilot_get_cs_workspace_snapshot()
    returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object(
        'delivery',(select jsonb_build_object(
          'verificationContract', d.verification_contract,
          'status', d.status) from sellerpilot_private.support_reply_deliveries d limit 1),
        'blockingDelivery',(select jsonb_build_object(
          'verificationContract', blocking.verification_contract,
          'status', blocking.status) from sellerpilot_private.support_reply_deliveries blocking limit 1)
      )
    $$;
  `);
  await db.query(`insert into sellerpilot_private.channel_credentials values
    ($1,'qoo10','production',$2,'active',null,$3)`, [ids.credential, ids.owner, sellerAccountKey]);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens values
    ($1,$2,'gateway','active','2099-01-01T00:00:00Z',$3)`, [ids.worker, tokenHash, ids.owner]);
  await db.exec(statusSql);
  await db.exec(sealSql);
  return db;
}

async function insertReplyLineage(db, input = {}) {
  const ticket = input.ticket ?? ids.ticket;
  const inbound = input.inbound ?? ids.inbound;
  const replyJob = input.replyJob ?? ids.replyJob;
  const delivery = input.delivery ?? ids.delivery;
  const inboundKey = input.inboundKey ?? "qoo10:inbound:current";
  const digest = input.digest ?? bindingDigest();
  await db.query(`insert into sellerpilot_private.support_tickets values
    ($1,$2,$3,'qoo10','conversation',$4,$5,false,$6)`, [
    ticket, ids.owner, ids.credential, inboundKey, sellerAccountKey, replyJob,
  ]);
  await db.query(`insert into sellerpilot_private.support_inbound_messages values
    ($1,$2,$3,'qoo10',$4,'customer','2026-09-07T15:30:00Z')`, [
    inbound, ticket, ids.owner, inboundKey,
  ]);
  const request = replyRequest(inboundKey);
  request.sellerpilotTicketId = ticket;
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,response_payload,status,
    created_by,seller_account_key,completed_at,updated_at,created_at
  ) values($1,$2,'qoo10','inquiries.reply','production',$3::jsonb,$4::jsonb,'succeeded',
    $5,$6,'2026-09-08T10:00:00Z','2026-09-08T10:00:00Z','2026-09-08T09:59:00Z')`, [
    replyJob, ids.credential, JSON.stringify(request), JSON.stringify(replyResponse(digest)),
    ids.owner, sellerAccountKey,
  ]);
  await db.query(`insert into sellerpilot_private.support_reply_deliveries(
    id,ticket_id,owner_id,gateway_job_id,channel_key,status,verification_status,
    verification_contract,provider_accepted_at,queued_at,completed_at,updated_at
  ) values($1,$2,$3,$4,'qoo10','succeeded','provider_accepted',
    'sellerpilot-reply-acceptance/1','2026-09-08T10:00:00Z','2026-09-08T09:59:00Z',
    '2026-09-08T10:00:00Z','2026-09-08T10:00:00Z')`, [delivery, ticket, ids.owner, replyJob]);
}

async function receipt(db, jobId, claimToken) {
  await db.query(`insert into sellerpilot_private.gateway_completion_receipts(
    job_id,claim_token,worker_token_id,completion_fingerprint
  ) values($1,$2,$3,$4)`, [jobId, claimToken, ids.worker, completionFingerprint]);
}

test("009 does not backfill old receipts and enqueues an exact S3 child with a fixed JST window in the new ACK transaction", async () => {
  const db = await createBase();
  try {
    await insertReplyLineage(db, {
      ticket: ids.oldTicket,
      inbound: ids.oldInbound,
      replyJob: ids.oldReplyJob,
      delivery: ids.oldDelivery,
      inboundKey: "qoo10:inbound:old",
    });
    await receipt(db, ids.oldReplyJob, ids.oldClaim);
    await db.exec(commonSql);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.qoo10_reply_s3_readback_enqueues`)).rows[0].count, 0);

    await insertReplyLineage(db);
    await db.exec("begin");
    await receipt(db, ids.replyJob, ids.replyClaim);
    const queuedInside = (await db.query(`select e.*,job.*
      from sellerpilot_private.qoo10_reply_s3_readback_enqueues e
      join sellerpilot_private.channel_gateway_jobs job on job.id=e.readback_job_id
      where e.delivery_id=$1`, [ids.delivery])).rows[0];
    assert.equal(queuedInside.search_start_dt, "20260908000000");
    assert.equal(queuedInside.search_end_dt, "20260908235959");
    assert.equal(queuedInside.channel, "qoo10");
    assert.equal(queuedInside.operation, "inquiries.list");
    assert.equal(queuedInside.status, "queued");
    assert.equal(queuedInside.credential_id, ids.credential);
    assert.equal(queuedInside.created_by, ids.owner);
    assert.equal(queuedInside.seller_account_key, sellerAccountKey);
    assert.equal(queuedInside.request_payload.periodicKey, `inquiries:reply-readback:qoo10:${ids.delivery}`);
    assert.deepEqual(queuedInside.request_payload.arguments.params, {
      proc_status: "S3", search_end_dt: "20260908235959", search_start_dt: "20260908000000",
    });
    assert.equal(queuedInside.request_payload.arguments.sellerpilotQoo10ReplyReadback.sequenceNo, "701");
    assert.doesNotMatch(JSON.stringify(queuedInside.request_payload), /reply body/u);
    await db.exec("commit");

    const context = (await db.query(`select public.sellerpilot_service_gateway_completion_context(
      $1,$2,$3
    ) value`, [tokenHash, queuedInside.readback_job_id, ids.readClaim])).rows[0].value;
    assert.equal(context.qoo10ReplyReadback.deliveryId, ids.delivery);
    assert.equal(context.request, undefined);
  } finally {
    await db.close();
  }
});

test("invalid provider acceptance binding rolls the receipt and child enqueue back together", async () => {
  const db = await createBase();
  try {
    await db.exec(commonSql);
    await insertReplyLineage(db, { digest: "f".repeat(64) });
    await assert.rejects(
      receipt(db, ids.replyJob, ids.replyClaim),
      /QOO10_REPLY_S3_PROVIDER_ACCEPTANCE_BINDING_INVALID/u,
    );
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [ids.replyJob])).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.qoo10_reply_s3_readback_enqueues`)).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.channel_gateway_jobs
      where operation='inquiries.list'`)).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("failed or uncertain Qoo10 replies keep their completion receipt and do not enqueue S3", async () => {
  for (const terminalStatus of ["failed", "reconciliation_required"]) {
    const db = await createBase();
    try {
      await db.exec(commonSql);
      await insertReplyLineage(db);
      await db.query(`update sellerpilot_private.channel_gateway_jobs set status=$2,
        response_payload=null,completed_at='2026-09-08T10:00:00Z' where id=$1`, [
        ids.replyJob, terminalStatus,
      ]);
      await receipt(db, ids.replyJob, ids.replyClaim);
      assert.equal((await db.query(`select count(*)::integer count
        from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [ids.replyJob])).rows[0].count, 1);
      assert.equal((await db.query(`select count(*)::integer count
        from sellerpilot_private.qoo10_reply_s3_readback_enqueues`)).rows[0].count, 0);
    } finally {
      await db.close();
    }
  }
});

test("the PII-free common storedResponse shape is sealed, accepted by 007, and exposed through real read fields", async () => {
  const db = await createBase();
  try {
    await db.exec(commonSql);
    await insertReplyLineage(db);
    await receipt(db, ids.replyJob, ids.replyClaim);
    const child = (await db.query(`select job.* from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.qoo10_reply_s3_readback_enqueues e on e.readback_job_id=job.id
      where e.delivery_id=$1`, [ids.delivery])).rows[0];
    const context = child.request_payload.arguments.sellerpilotQoo10ReplyReadback;
    const prepared = qoo10ReplyS3CompletionEvidence({
      context,
      result: {
        ok: true, channel: "qoo10", operation: "inquiries.list",
        steps: [{ name: "GetInquiryMessage", ok: true, status: 200, data: {
          ResultCode: 0,
          ResultObject: [{
            INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "701", STATUS: "S3",
            CONTENTS: "must not persist", CUST_NM: "buyer-name",
          }],
        } }],
      },
    });
    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      status='succeeded',response_payload=$2::jsonb,completed_at='2026-09-08T10:01:00Z',
      updated_at='2026-09-08T10:01:00Z' where id=$1`, [
      child.id, JSON.stringify(prepared.storedResponse),
    ]);
    await receipt(db, child.id, ids.readClaim);
    const seal = (await db.query(`select * from sellerpilot_private.qoo10_reply_s3_completion_seals
      where job_id=$1`, [child.id])).rows[0];
    assert.equal(seal.terminal_status, "succeeded");
    const stored = (await db.query(`select response_payload from sellerpilot_private.channel_gateway_jobs
      where id=$1`, [child.id])).rows[0].response_payload;
    assert.equal(stored.steps[0].data.sellerpilotMarker, "sellerpilot-qoo10-s3-stored-evidence/1");
    assert.doesNotMatch(JSON.stringify(stored), /must not persist|buyer-name/u);

    const recorded = (await db.query(`select public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
      $1,$2,$3,$4,$5,$6,$7,false,false
    ) result`, [
      tokenHash, child.id, ids.readClaim, ids.delivery,
      prepared.verification.state, prepared.verification.reason, prepared.verification.matchingRows,
    ])).rows[0].result;
    assert.equal(recorded.state, "verified");
    assert.equal(recorded.genericVerificationStatus, "provider_accepted");
    assert.equal(recorded.replyContentObserved, false);
    assert.equal(recorded.automaticResendAllowed, false);

    const direct = (await db.query(`select public.sellerpilot_get_inquiry_reply_delivery($1,$2) value`, [
      ids.ticket, ids.replyJob,
    ])).rows[0].value;
    assert.equal(direct.qoo10S3StatusObserved, true);
    assert.equal(direct.qoo10S3ReadbackState, "verified");
    assert.equal(direct.qoo10S3VerificationContract, "sellerpilot-qoo10-s3-status/1");
    assert.equal(direct.qoo10ReplyContentObserved, false);
    assert.equal(direct.qoo10AutomaticResendAllowed, false);
    const workspaceDefinition = (await db.query(`select pg_get_functiondef(
      'public.sellerpilot_get_cs_workspace_snapshot()'::regprocedure
    ) value`)).rows[0].value;
    assert.match(workspaceDefinition, /qoo10S3StatusObserved/u);
    assert.match(workspaceDefinition, /qoo10AutomaticResendAllowed/u);
  } finally {
    await db.close();
  }
});
