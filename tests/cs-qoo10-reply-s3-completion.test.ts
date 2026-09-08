import assert from "node:assert/strict";
import test from "node:test";
import {
  qoo10ReplyS3CompletionEvidence,
  qoo10ReplyS3ReadbackContext,
  qoo10ReplyS3StatusRpcArguments,
  qoo10ReplyS3StoredEvidenceContract,
} from "../lib/channels/cs/qoo10/reply-readback-completion.ts";
import type { ChannelOperationResult } from "../lib/channels/operations.ts";

const deliveryId = "123e4567-e89b-42d3-a456-426614174000";
const marker = {
  contractVersion: "sellerpilot-qoo10-reply-readback/1" as const,
  deliveryId,
  inquiryType: "MSG" as const,
  questionNo: "700",
  sequenceNo: "701",
};

function result(rows: Record<string, unknown>[], resultCode: string | number = 0): ChannelOperationResult {
  return {
    ok: String(resultCode) === "0",
    channel: "qoo10",
    operation: "inquiries.list",
    steps: [{
      name: "GetInquiryMessage",
      ok: String(resultCode) === "0",
      status: 200,
      data: { ResultCode: resultCode, ResultObject: rows },
    }],
    safeMessage: "provider message that must not be stored",
  };
}

test("reads the same marker from remote completion context and serverless job request", () => {
  assert.deepEqual(qoo10ReplyS3ReadbackContext({ qoo10ReplyReadback: marker }), marker);
  assert.deepEqual(qoo10ReplyS3ReadbackContext({
    arguments: { sellerpilotQoo10ReplyReadback: marker },
  }), marker);
  assert.equal(qoo10ReplyS3ReadbackContext({ arguments: {} }), null);
  assert.throws(() => qoo10ReplyS3ReadbackContext({
    qoo10ReplyReadback: { ...marker, deliveryId: "not-a-uuid" },
  }), /QOO10_REPLY_READBACK_CONTEXT_INVALID/u);
});

test("stores only exact question identity/status fields and verifies exact S3", () => {
  const completion = qoo10ReplyS3CompletionEvidence({
    context: marker,
    result: result([
      {
        INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "701", STATUS: "S3",
        CONTENTS: "고객 및 판매자 본문", CUST_NM: "buyer-name", EMAIL: "buyer@example.com",
      },
      {
        INQ_TYPE: "HELP", QUESTION_NO: "999", SEQ_NO: "111", STATUS: "S3",
        CONTENTS: "unrelated inquiry",
      },
    ]),
  });
  assert.deepEqual(completion.verification, {
    state: "verified",
    reason: "exact_s3_status_observed",
    resendAllowed: false,
    replyContentObserved: false,
    matchingRows: 1,
  });
  assert.deepEqual(completion.storedResponse?.steps[0]?.data, {
    ResultCode: 0,
    ResultObject: [{
      INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "701", STATUS: "S3",
    }],
    sellerpilotMarker: qoo10ReplyS3StoredEvidenceContract,
  });
  const serialized = JSON.stringify(completion.storedResponse);
  assert.doesNotMatch(serialized, /고객|buyer-name|buyer@example|unrelated inquiry/u);
});

test("preserves wrong-sequence evidence without retaining bodies", () => {
  const completion = qoo10ReplyS3CompletionEvidence({
    context: marker,
    result: result([{ INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "702", STATUS: "S3", CONTENTS: "secret" }]),
  });
  assert.equal(completion.verification.state, "incomplete");
  assert.equal(completion.verification.reason, "wrong_sequence_observed");
  assert.equal(completion.verification.matchingRows, 0);
  assert.doesNotMatch(JSON.stringify(completion.storedResponse), /secret/u);
});

test("empty result is pending, provider rejection is incomplete, and absent result is transport failure", () => {
  assert.deepEqual(qoo10ReplyS3CompletionEvidence({ context: marker, result: result([]) }).verification, {
    state: "pending",
    reason: "exact_s3_not_observed",
    resendAllowed: false,
    replyContentObserved: false,
    matchingRows: 0,
  });
  assert.equal(
    qoo10ReplyS3CompletionEvidence({ context: marker, result: result([], "-1") }).verification.reason,
    "provider_rejected",
  );
  assert.deepEqual(qoo10ReplyS3CompletionEvidence({ context: marker }).verification, {
    state: "incomplete",
    reason: "provider_transport_or_contract_failed",
    resendAllowed: false,
    replyContentObserved: false,
    matchingRows: 0,
  });
});

test("malformed successful provider rows fail closed and RPC arguments never permit content or resend claims", () => {
  const malformed = result([]);
  malformed.steps[0]!.data.ResultObject = { unexpected: [] };
  const completion = qoo10ReplyS3CompletionEvidence({ context: marker, result: malformed });
  assert.equal(completion.verification.reason, "provider_transport_or_contract_failed");
  assert.equal(completion.storedResponse?.steps[0]?.name, "qoo10-s3-readback-invalid");
  assert.deepEqual(qoo10ReplyS3StatusRpcArguments({
    tokenHash: "a".repeat(64),
    jobId: "123e4567-e89b-42d3-a456-426614174001",
    claimToken: "123e4567-e89b-42d3-a456-426614174002",
    context: marker,
    verification: completion.verification,
  }), {
    p_token_hash: "a".repeat(64),
    p_job_id: "123e4567-e89b-42d3-a456-426614174001",
    p_claim_token: "123e4567-e89b-42d3-a456-426614174002",
    p_delivery_id: deliveryId,
    p_state: "incomplete",
    p_reason: "provider_transport_or_contract_failed",
    p_matching_rows: 0,
    p_reply_content_observed: false,
    p_resend_allowed: false,
  });
});
