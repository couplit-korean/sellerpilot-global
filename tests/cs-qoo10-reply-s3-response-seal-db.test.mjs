import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  credential: "10000000-0000-4000-8000-000000000002",
  ticket: "10000000-0000-4000-8000-000000000003",
  replyJob: "10000000-0000-4000-8000-000000000004",
  delivery: "10000000-0000-4000-8000-000000000005",
  readJob: "10000000-0000-4000-8000-000000000006",
  worker: "10000000-0000-4000-8000-000000000007",
  claim: "10000000-0000-4000-8000-000000000008",
  otherJob: "10000000-0000-4000-8000-000000000009",
  otherClaim: "10000000-0000-4000-8000-000000000010",
};
const tokenHash = "d".repeat(64);
const sellerAccountKey = "e".repeat(64);
const completionFingerprint = "f".repeat(64);
const statusProposal = await readFile(new URL(
  "../supabase/migrations/20260908140419_cs_qoo10_reply_s3_status.sql",
  import.meta.url,
), "utf8");
const sealProposal = await readFile(new URL(
  "../supabase/migrations/20260908140421_cs_qoo10_reply_s3_response_seal.sql",
  import.meta.url,
), "utf8");

function replyRequest() {
  return {
    arguments: {
      params: { inq_type: "MSG", question_no: "700", seq_no: "701", contents: "fixture" },
    },
    sellerpilotInboundKey: "qoo10:fixture-inbound",
  };
}

function readRequest(withMarker = true) {
  return {
    arguments: {
      params: {
        search_start_dt: "20260908000000",
        search_end_dt: "20260908235959",
        proc_status: "S3",
      },
      ...(withMarker ? {
        sellerpilotQoo10ReplyReadback: {
          contractVersion: "sellerpilot-qoo10-reply-readback/1",
          deliveryId: ids.delivery,
          inquiryType: "MSG",
          questionNo: "700",
          sequenceNo: "701",
        },
      } : {}),
    },
  };
}

function providerResponse(rows = [{
  INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "701", STATUS: "S3",
}]) {
  return {
    ok: true,
    channel: "qoo10",
    operation: "inquiries.list",
    steps: [{
      name: "GetInquiryMessage",
      ok: true,
      status: 200,
      data: { ResultCode: 0, ResultObject: rows },
    }],
    safeMessage: "fixture only",
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable
    as $$ select sha256(convert_to(value,'UTF8')) $$;
    create schema sellerpilot_private;
    create table sellerpilot_private.support_tickets (
      id uuid primary key,owner_id uuid not null,source_credential_id uuid not null,
      latest_inbound_key text not null,seller_account_key text not null
    );
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
      id uuid primary key,credential_id uuid not null,channel text not null,
      operation text not null,environment text not null,status text not null,
      request_payload jsonb not null,response_payload jsonb,error_message text,
      created_by uuid not null,seller_account_key text,completed_at timestamptz,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.gateway_completion_receipts (
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
      claim_token uuid not null,worker_token_id uuid not null
        references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
      completion_fingerprint text not null,continuation_job_id uuid,
      created_at timestamptz not null default clock_timestamp(),
      unique(job_id,claim_token)
    );
    create table sellerpilot_private.support_reply_deliveries (
      id uuid primary key,ticket_id uuid not null,owner_id uuid not null,
      gateway_job_id uuid not null,channel_key text not null,status text not null,
      verification_status text not null,updated_at timestamptz not null
    );
  `);
  await db.exec(statusProposal);
  await db.exec(sealProposal);
  await db.query(`
    insert into sellerpilot_private.channel_credentials values
      ($1,'qoo10','production',$2,'active',null,$3)
  `, [ids.credential, ids.owner, sellerAccountKey]);
  await db.query(`
    insert into sellerpilot_private.ai_cli_worker_tokens values
      ($1,$2,'gateway','active',clock_timestamp() + interval '1 hour',$3)
  `, [ids.worker, tokenHash, ids.owner]);
  await db.query(`
    insert into sellerpilot_private.support_tickets values ($1,$2,$3,$4,$5)
  `, [ids.ticket, ids.owner, ids.credential, "qoo10:fixture-inbound", sellerAccountKey]);
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs (
      id,credential_id,channel,operation,environment,status,request_payload,response_payload,
      error_message,created_by,seller_account_key,completed_at,updated_at
    ) values
      ($1,$2,'qoo10','inquiries.reply','production','succeeded',$3::jsonb,null,
       null,$6,$7,'2026-09-08T10:00:00Z','2026-09-08T10:00:00Z'),
      ($4,$2,'qoo10','inquiries.list','production','succeeded',$5::jsonb,$8::jsonb,
       null,$6,$7,'2026-09-08T10:01:00Z','2026-09-08T10:01:00Z')
  `, [
    ids.replyJob, ids.credential, JSON.stringify(replyRequest()),
    ids.readJob, JSON.stringify(readRequest()), ids.owner, sellerAccountKey,
    JSON.stringify(providerResponse()),
  ]);
  await db.query(`
    insert into sellerpilot_private.support_reply_deliveries values
      ($1,$2,$3,$4,'qoo10','succeeded','provider_accepted','2026-09-08T10:00:00Z')
  `, [ids.delivery, ids.ticket, ids.owner, ids.replyJob]);
  await db.query(`
    insert into sellerpilot_private.gateway_completion_receipts (
      job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
    ) values ($1,$2,$3,$4,null)
  `, [ids.readJob, ids.claim, ids.worker, completionFingerprint]);
  return db;
}

async function record(db, state = "verified", reason = "exact_s3_status_observed", rows = 1) {
  return (await db.query(`
    select public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
      $1,$2,$3,$4,$5,$6,$7,false,false
    ) result
  `, [tokenHash, ids.readJob, ids.claim, ids.delivery, state, reason, rows])).rows[0].result;
}

async function evidence(db) {
  return (await db.query(`
    select verification_status,qoo10_s3_status_observed,qoo10_s3_readback_state,
           qoo10_s3_readback_reason,qoo10_reply_content_observed,
           qoo10_automatic_resend_allowed
      from sellerpilot_private.support_reply_deliveries where id=$1
  `, [ids.delivery])).rows[0];
}

test("Qoo10 S3 completion receipt seals request and response before status recording", async () => {
  const db = await fixture();
  try {
    const seal = (await db.query(`
      select seal.*,
             seal.request_sha256=sellerpilot_private.qoo10_reply_s3_json_sha256(job.request_payload) request_matches,
             seal.response_sha256=sellerpilot_private.qoo10_reply_s3_json_sha256(job.response_payload) response_matches
        from sellerpilot_private.qoo10_reply_s3_completion_seals seal
        join sellerpilot_private.channel_gateway_jobs job on job.id=seal.job_id
       where seal.job_id=$1
    `, [ids.readJob])).rows[0];
    assert.equal(seal.claim_token, ids.claim);
    assert.equal(seal.worker_token_id, ids.worker);
    assert.equal(seal.request_matches, true);
    assert.equal(seal.response_matches, true);
    const result = await record(db);
    assert.equal(result.state, "verified");
    assert.equal(result.genericVerificationStatus, "provider_accepted");
    assert.equal(result.replyContentObserved, false);
    assert.equal(result.automaticResendAllowed, false);
  } finally {
    await db.close();
  }
});

test("Qoo10 sealed readback job rejects request, response, lineage, terminal, and delete changes", async () => {
  const mutations = [
    `update sellerpilot_private.channel_gateway_jobs set request_payload='{}' where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set response_payload='{}' where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set credential_id=gen_random_uuid() where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set channel='shopee' where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set operation='orders.list' where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set environment='sandbox' where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set status='failed' where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set created_by=gen_random_uuid() where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set seller_account_key=repeat('0',64) where id='${ids.readJob}'`,
    `update sellerpilot_private.channel_gateway_jobs set completed_at=completed_at+interval '1 second' where id='${ids.readJob}'`,
    `delete from sellerpilot_private.channel_gateway_jobs where id='${ids.readJob}'`,
  ];
  for (const mutation of mutations) {
    const db = await fixture();
    try {
      await assert.rejects(db.exec(mutation), /QOO10_REPLY_S3_SEALED_JOB_IMMUTABLE/u);
      assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.readJob])).rows[0].count, 1);
      assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [ids.readJob])).rows[0].count, 1);
    } finally {
      await db.close();
    }
  }
});

test("Qoo10 receipt and seal rows are immutable after the seal is created", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      db.query(`update sellerpilot_private.gateway_completion_receipts set completion_fingerprint=$2 where job_id=$1`, [ids.readJob, "0".repeat(64)]),
      /QOO10_REPLY_S3_COMPLETION_RECEIPT_IMMUTABLE/u,
    );
    await assert.rejects(
      db.query(`delete from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [ids.readJob]),
      /QOO10_REPLY_S3_COMPLETION_RECEIPT_IMMUTABLE/u,
    );
    await assert.rejects(
      db.query(`update sellerpilot_private.qoo10_reply_s3_completion_seals set response_sha256=$2 where job_id=$1`, [ids.readJob, "0".repeat(64)]),
      /QOO10_REPLY_S3_COMPLETION_SEAL_IMMUTABLE/u,
    );
    await assert.rejects(
      db.query(`delete from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [ids.readJob]),
      /QOO10_REPLY_S3_COMPLETION_SEAL_IMMUTABLE/u,
    );
  } finally {
    await db.close();
  }
});

test("Qoo10 status wrapper detects response tampering even if the mutation trigger is bypassed", async () => {
  const db = await fixture();
  try {
    const before = await evidence(db);
    await db.exec(`alter table sellerpilot_private.channel_gateway_jobs disable trigger guard_qoo10_reply_s3_sealed_job`);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set response_payload=$2::jsonb where id=$1`, [
      ids.readJob,
      JSON.stringify(providerResponse([{ INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "999", STATUS: "S3" }])),
    ]);
    await db.exec(`alter table sellerpilot_private.channel_gateway_jobs enable trigger guard_qoo10_reply_s3_sealed_job`);
    await assert.rejects(record(db), /QOO10_REPLY_S3_READBACK_SEAL_INVALID/u);
    assert.deepEqual(await evidence(db), before);
  } finally {
    await db.close();
  }
});

test("Qoo10 completion replay keeps the seal and status result idempotent", async () => {
  const db = await fixture();
  try {
    const first = await record(db);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set updated_at=updated_at+interval '1 second' where id=$1`, [ids.readJob]);
    const second = await record(db);
    assert.deepEqual(second, first);
    assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [ids.readJob])).rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test("Other channels and ordinary Qoo10 list jobs remain outside the seal", async () => {
  const db = await fixture();
  try {
    for (const [jobId, claimToken, channel, request] of [
      [ids.otherJob, ids.otherClaim, "shopee", readRequest(false)],
      ["10000000-0000-4000-8000-000000000011", "10000000-0000-4000-8000-000000000012", "qoo10", readRequest(false)],
    ]) {
      await db.query(`
        insert into sellerpilot_private.channel_gateway_jobs (
          id,credential_id,channel,operation,environment,status,request_payload,response_payload,
          error_message,created_by,seller_account_key,completed_at,updated_at
        ) values ($1,$2,$3,'inquiries.list','production','succeeded',$4::jsonb,$5::jsonb,
          null,$6,$7,'2026-09-08T11:00:00Z','2026-09-08T11:00:00Z')
      `, [jobId, ids.credential, channel, JSON.stringify(request), JSON.stringify(providerResponse()), ids.owner, sellerAccountKey]);
      await db.query(`
        insert into sellerpilot_private.gateway_completion_receipts (
          job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
        ) values ($1,$2,$3,$4,null)
      `, [jobId, claimToken, ids.worker, completionFingerprint]);
      assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [jobId])).rows[0].count, 0);
      await db.query(`update sellerpilot_private.channel_gateway_jobs set response_payload='{}' where id=$1`, [jobId]);
    }
  } finally {
    await db.close();
  }
});

test("A Qoo10 S3 marker on another channel cannot create a completion receipt", async () => {
  const db = await fixture();
  try {
    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs (
        id,credential_id,channel,operation,environment,status,request_payload,response_payload,
        error_message,created_by,seller_account_key,completed_at,updated_at
      ) values ($1,$2,'shopee','inquiries.list','production','succeeded',$3::jsonb,$4::jsonb,
        null,$5,$6,'2026-09-08T11:00:00Z','2026-09-08T11:00:00Z')
    `, [ids.otherJob, ids.credential, JSON.stringify(readRequest()), JSON.stringify(providerResponse()), ids.owner, sellerAccountKey]);
    await assert.rejects(
      db.query(`
        insert into sellerpilot_private.gateway_completion_receipts (
          job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
        ) values ($1,$2,$3,$4,null)
      `, [ids.otherJob, ids.otherClaim, ids.worker, completionFingerprint]),
      /QOO10_REPLY_S3_SEAL_SOURCE_INVALID/u,
    );
    assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [ids.otherJob])).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [ids.otherJob])).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("Failed Qoo10 readback completion seals NULL response and records transport failure only", async () => {
  const db = await fixture();
  try {
    await db.exec(`
      alter table sellerpilot_private.channel_gateway_jobs disable trigger guard_qoo10_reply_s3_sealed_job;
      alter table sellerpilot_private.gateway_completion_receipts disable trigger guard_qoo10_reply_s3_seal_source;
      alter table sellerpilot_private.qoo10_reply_s3_completion_seals disable trigger guard_qoo10_reply_s3_seal_immutable;
    `);
    await db.query(`delete from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [ids.readJob]);
    await db.query(`delete from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [ids.readJob]);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='failed',response_payload=null where id=$1`, [ids.readJob]);
    await db.exec(`
      alter table sellerpilot_private.channel_gateway_jobs enable trigger guard_qoo10_reply_s3_sealed_job;
      alter table sellerpilot_private.gateway_completion_receipts enable trigger guard_qoo10_reply_s3_seal_source;
      alter table sellerpilot_private.qoo10_reply_s3_completion_seals enable trigger guard_qoo10_reply_s3_seal_immutable;
    `);
    await db.query(`
      insert into sellerpilot_private.gateway_completion_receipts (
        job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
      ) values ($1,$2,$3,$4,null)
    `, [ids.readJob, ids.claim, ids.worker, completionFingerprint]);
    const result = await record(db, "incomplete", "provider_transport_or_contract_failed", 0);
    assert.equal(result.state, "incomplete");
    assert.equal(result.reason, "provider_transport_or_contract_failed");
    assert.equal(result.statusObserved, false);
    assert.equal(result.automaticResendAllowed, false);
  } finally {
    await db.close();
  }
});
