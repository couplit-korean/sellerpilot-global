import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "00000000-0000-4000-8000-000000000001";
const otherOwner = "00000000-0000-4000-8000-000000000009";
const credential = "00000000-0000-4000-8000-000000000002";
const otherCredential = "00000000-0000-4000-8000-000000000010";
const ticket = "00000000-0000-4000-8000-000000000003";
const replyJob = "00000000-0000-4000-8000-000000000004";
const delivery = "00000000-0000-4000-8000-000000000005";
const readJob = "00000000-0000-4000-8000-000000000006";
const worker = "00000000-0000-4000-8000-000000000007";
const claim = "00000000-0000-4000-8000-000000000008";
const tokenHash = "a".repeat(64);
const sellerAccountKey = "b".repeat(64);
const proposal = await readFile(new URL(
  "../supabase/migrations/20260908140419_cs_qoo10_reply_s3_status.sql",
  import.meta.url,
), "utf8");

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
    create schema sellerpilot_private;
    create table sellerpilot_private.support_tickets (
      id uuid primary key,
      owner_id uuid not null,
      source_credential_id uuid not null,
      latest_inbound_key text not null,
      seller_account_key text not null
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      created_by uuid not null,
      status text not null,
      expires_at timestamptz,
      seller_account_key text
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      environment text not null,
      status text not null,
      request_payload jsonb not null,
      response_payload jsonb,
      error_message text,
      created_by uuid not null,
      seller_account_key text,
      completed_at timestamptz,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.support_reply_deliveries (
      id uuid primary key,
      ticket_id uuid not null,
      owner_id uuid not null,
      gateway_job_id uuid not null,
      channel_key text not null,
      status text not null,
      verification_status text not null,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key,
      token_hash text not null,
      scope text not null,
      status text not null,
      expires_at timestamptz not null,
      created_by uuid not null
    );
    create table sellerpilot_private.gateway_completion_receipts (
      job_id uuid primary key,
      claim_token uuid not null,
      worker_token_id uuid not null,
      completion_fingerprint text not null,
      created_at timestamptz not null
    );
  `);
  await db.exec(proposal);
  await db.query(`
    insert into sellerpilot_private.channel_credentials (
      id,channel,environment,created_by,status,expires_at,seller_account_key
    ) values
      ($1,'qoo10','production',$3,'active',null,$4),
      ($2,'qoo10','production',$3,'active',null,$4)
  `, [credential, otherCredential, owner, sellerAccountKey]);
  await db.query(`insert into sellerpilot_private.support_tickets values ($1,$2,$3,$4,$5)`, [
    ticket, owner, credential, "qoo10:fixture-inbound", sellerAccountKey,
  ]);
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs (
      id,credential_id,channel,operation,environment,status,request_payload,
      response_payload,error_message,created_by,seller_account_key,completed_at,updated_at
    ) values
      ($1,$2,'qoo10','inquiries.reply','production','succeeded',$3::jsonb,
       null,null,$6,$7,'2026-09-08T10:00:00Z','2026-09-08T10:00:00Z'),
      ($4,$2,'qoo10','inquiries.list','production','succeeded',$5::jsonb,
       $8::jsonb,null,$6,$7,'2026-09-08T10:01:00Z','2026-09-08T10:01:00Z')
  `, [
    replyJob, credential, JSON.stringify({
      arguments: { params: { inq_type: "MSG", question_no: "700", seq_no: "701", contents: "fixture" } },
      sellerpilotInboundKey: "qoo10:fixture-inbound",
    }),
    readJob, JSON.stringify({
      arguments: {
        params: { search_start_dt: "20260908000000", search_end_dt: "20260908235959", proc_status: "S3" },
        sellerpilotQoo10ReplyReadback: {
          contractVersion: "sellerpilot-qoo10-reply-readback/1",
          deliveryId: delivery,
          inquiryType: "MSG",
          questionNo: "700",
          sequenceNo: "701",
        },
      },
    }),
    owner,
    sellerAccountKey,
    JSON.stringify(providerResponse()),
  ]);
  await db.query(`
    insert into sellerpilot_private.support_reply_deliveries values
      ($1,$2,$3,$4,'qoo10','succeeded','provider_accepted','2026-09-08T10:00:00Z')
  `, [delivery, ticket, owner, replyJob]);
  await db.query(`
    insert into sellerpilot_private.ai_cli_worker_tokens values
      ($1,$2,'gateway','active','2026-09-09T00:00:00Z',$3)
  `, [worker, tokenHash, owner]);
  await db.query(`
    insert into sellerpilot_private.gateway_completion_receipts values
      ($1,$2,$3,$4,'2026-09-08T10:01:01Z')
  `, [readJob, claim, worker, "c".repeat(64)]);
  return db;
}

async function record(db, state, reason, matchingRows, contentObserved = false, resendAllowed = false) {
  return (await db.query(`
    select public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
      $1,$2,$3,$4,$5,$6,$7,$8,$9
    ) result
  `, [tokenHash, readJob, claim, delivery, state, reason, matchingRows, contentObserved, resendAllowed])).rows[0].result;
}

async function setProviderResponse(db, response) {
  await db.query(`
    update sellerpilot_private.channel_gateway_jobs set response_payload=$2::jsonb where id=$1
  `, [readJob, JSON.stringify(response)]);
}

async function deliveryEvidence(db) {
  return (await db.query(`
    select verification_status,qoo10_s3_status_observed,qoo10_s3_status_observed_at,
           qoo10_s3_last_checked_at,qoo10_s3_readback_state,qoo10_s3_readback_reason,
           qoo10_s3_matching_rows,qoo10_s3_verification_contract,
           qoo10_reply_content_observed,qoo10_automatic_resend_allowed
      from sellerpilot_private.support_reply_deliveries where id=$1
  `, [delivery])).rows[0];
}

test("Qoo10 S3 RPC records status-only evidence without generic remote_observed", async () => {
  const db = await fixture();
  try {
    const first = await record(db, "verified", "exact_s3_status_observed", 1);
    assert.deepEqual(first, {
      contract: "sellerpilot-qoo10-s3-readback-result/1",
      deliveryId: delivery,
      state: "verified",
      reason: "exact_s3_status_observed",
      statusObserved: true,
      replyContentObserved: false,
      automaticResendAllowed: false,
      genericVerificationStatus: "provider_accepted",
    });
    const before = (await db.query(`select * from sellerpilot_private.support_reply_deliveries where id=$1`, [delivery])).rows[0];
    assert.equal(before.verification_status, "provider_accepted");
    assert.equal(before.qoo10_s3_status_observed, true);
    assert.equal(before.qoo10_reply_content_observed, false);
    assert.equal(before.qoo10_automatic_resend_allowed, false);

    const replay = await record(db, "verified", "exact_s3_status_observed", 1);
    const after = (await db.query(`select * from sellerpilot_private.support_reply_deliveries where id=$1`, [delivery])).rows[0];
    assert.equal(replay.genericVerificationStatus, "provider_accepted");
    assert.equal(after.qoo10_s3_status_observed_at.toISOString(), before.qoo10_s3_status_observed_at.toISOString());
    assert.equal(after.verification_status, "provider_accepted");
  } finally {
    await db.close();
  }
});

test("Qoo10 pending S3 status never enables resend or body-observed verification", async () => {
  const db = await fixture();
  try {
    await setProviderResponse(db, providerResponse([]));
    const result = await record(db, "pending", "exact_s3_not_observed", 0);
    assert.equal(result.statusObserved, false);
    assert.equal(result.replyContentObserved, false);
    assert.equal(result.automaticResendAllowed, false);
    assert.equal(result.genericVerificationStatus, "provider_accepted");
    await assert.rejects(
      record(db, "pending", "exact_s3_not_observed", 0, true, false),
      /QOO10_REPLY_S3_READBACK_ARGUMENT_INVALID/u,
    );
    await assert.rejects(
      record(db, "pending", "exact_s3_not_observed", 0, false, true),
      /QOO10_REPLY_S3_READBACK_ARGUMENT_INVALID/u,
    );
  } finally {
    await db.close();
  }
});

test("Qoo10 S3 RPC rejects a readback job whose sequence differs from the reply", async () => {
  const db = await fixture();
  try {
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set request_payload=jsonb_set(request_payload,
           '{arguments,sellerpilotQoo10ReplyReadback,sequenceNo}','"999"'::jsonb)
       where id=$1
    `, [readJob]);
    await assert.rejects(
      record(db, "incomplete", "wrong_sequence_observed", 0),
      /QOO10_REPLY_S3_READBACK_TARGET_INVALID/u,
    );
    const row = (await db.query(`select * from sellerpilot_private.support_reply_deliveries where id=$1`, [delivery])).rows[0];
    assert.equal(row.verification_status, "provider_accepted");
    assert.equal(row.qoo10_s3_readback_state, null);
  } finally {
    await db.close();
  }
});

test("Qoo10 S3 RPC rejects NULL state or reason without changing delivery evidence", async () => {
  const db = await fixture();
  try {
    const before = await deliveryEvidence(db);
    for (const [state, reason, rows] of [
      ["verified", null, 1],
      [null, "exact_s3_status_observed", 1],
      ["pending", null, 0],
    ]) {
      await assert.rejects(
        record(db, state, reason, rows),
        /QOO10_REPLY_S3_READBACK_ARGUMENT_INVALID/u,
      );
      assert.deepEqual(await deliveryEvidence(db), before);
    }
  } finally {
    await db.close();
  }
});

test("Qoo10 S3 RPC derives exact status from the stored provider result", async () => {
  const db = await fixture();
  try {
    await setProviderResponse(db, providerResponse([{
      INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "999", STATUS: "S3",
    }]));
    const before = await deliveryEvidence(db);
    await assert.rejects(
      record(db, "verified", "exact_s3_status_observed", 1),
      /QOO10_REPLY_S3_READBACK_EVIDENCE_MISMATCH/u,
    );
    assert.deepEqual(await deliveryEvidence(db), before);

    const actual = await record(db, "incomplete", "wrong_sequence_observed", 0);
    assert.equal(actual.state, "incomplete");
    assert.equal(actual.reason, "wrong_sequence_observed");
    assert.equal(actual.statusObserved, false);
    assert.equal(actual.replyContentObserved, false);
    assert.equal(actual.automaticResendAllowed, false);
  } finally {
    await db.close();
  }
});

test("Qoo10 S3 consistency CHECK cannot pass an observed row with NULL state", async () => {
  const db = await fixture();
  try {
    const before = await deliveryEvidence(db);
    await assert.rejects(
      db.query(`
        update sellerpilot_private.support_reply_deliveries
           set qoo10_s3_status_observed=true,
               qoo10_s3_status_observed_at='2026-09-08T10:01:00Z',
               qoo10_s3_readback_state=null
         where id=$1
      `, [delivery]),
      /support_reply_deliveries_qoo10_s3_consistency_check/u,
    );
    assert.deepEqual(await deliveryEvidence(db), before);
  } finally {
    await db.close();
  }
});

test("Qoo10 S3 RPC is executable only by service_role", async () => {
  const db = await fixture();
  try {
    const signature = "public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(text,uuid,uuid,uuid,text,text,integer,boolean,boolean)";
    const privileges = (await db.query(`
      select has_function_privilege('anon',$1,'EXECUTE') anon,
             has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
             has_function_privilege('service_role',$1,'EXECUTE') service_role
    `, [signature])).rows[0];
    assert.deepEqual(privileges, { anon: false, authenticated: false, service_role: true });
  } finally {
    await db.close();
  }
});

test("Qoo10 S3 RPC fails closed across channel, credential, owner, and worker lineage", async () => {
  const cases = [
    ["other channel", `update sellerpilot_private.channel_gateway_jobs set channel='shopee' where id='${readJob}'`],
    ["other credential", `update sellerpilot_private.channel_gateway_jobs set credential_id='${otherCredential}' where id='${readJob}'`],
    ["other job owner", `update sellerpilot_private.channel_gateway_jobs set created_by='${otherOwner}' where id='${readJob}'`],
    ["other credential owner", `update sellerpilot_private.channel_credentials set created_by='${otherOwner}' where id='${credential}'`],
    ["other delivery owner", `update sellerpilot_private.support_reply_deliveries set owner_id='${otherOwner}' where id='${delivery}'`],
    ["wrong worker scope", `update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs' where id='${worker}'`],
    ["revoked worker", `update sellerpilot_private.ai_cli_worker_tokens set status='revoked' where id='${worker}'`],
    ["expired worker", `update sellerpilot_private.ai_cli_worker_tokens set expires_at='2026-09-07T00:00:00Z' where id='${worker}'`],
  ];
  for (const [label, mutation] of cases) {
    const db = await fixture();
    try {
      await db.exec(mutation);
      const before = await deliveryEvidence(db);
      await assert.rejects(
        record(db, "verified", "exact_s3_status_observed", 1),
        /QOO10_REPLY_S3_READBACK_LINEAGE_INVALID/u,
        label,
      );
      assert.deepEqual(await deliveryEvidence(db), before, label);
    } finally {
      await db.close();
    }
  }
});
