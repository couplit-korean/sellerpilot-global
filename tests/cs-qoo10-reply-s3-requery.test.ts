import assert from "node:assert/strict";
import test from "node:test";
import {
  decideQoo10ReplyS3Requery,
  qoo10ReplyS3RequeryLineageDigest,
} from "../lib/channels/cs/qoo10/reply-readback-requery.ts";

const lineage = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  deliveryId: "00000000-0000-4000-8000-000000000003",
  replyJobId: "00000000-0000-4000-8000-000000000004",
  sellerAccountKey: "a".repeat(64),
  environment: "production" as const,
  inboundKey: "qoo10:fixture-inbound",
  searchStartAt: "20260909000000",
  searchEndAt: "20260909235959",
  target: { inquiryType: "MSG" as const, questionNo: "700", sequenceNo: "701" },
};

const base = {
  lineage,
  attemptNumber: 1,
  firstCheckedAt: "2026-09-09T00:00:00.000Z",
  lastCheckedAt: "2026-09-09T00:00:00.000Z",
};

test("Qoo10 pending readback schedules only a bounded read-only S3 requery", () => {
  const decision = decideQoo10ReplyS3Requery({
    ...base,
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  });
  assert.equal(decision.decision, "retry");
  if (decision.decision !== "retry") return;
  assert.equal(decision.nextAttemptNumber, 2);
  assert.equal(decision.delaySeconds, 60);
  assert.equal(decision.retryAt, "2026-09-09T00:01:00.000Z");
  assert.equal(decision.operation, "inquiries.list");
  assert.equal(decision.arguments.params.proc_status, "S3");
  assert.deepEqual(decision.arguments.sellerpilotQoo10ReplyReadbackRequery, {
    contractVersion: "sellerpilot-qoo10-reply-s3-requery/1",
    attemptNumber: 2,
    lineageDigest: decision.lineageDigest,
  });
  assert.equal(decision.resendAllowed, false);
  assert.equal(decision.replyOperationAllowed, false);
  assert.equal("contents" in decision.arguments.params, false);
  assert.equal(decision.periodicKey, `inquiries:reply-readback:qoo10:${lineage.deliveryId}:attempt:2`);
});

test("Qoo10 incomplete and transport failures use the bounded backoff sequence", () => {
  const digest = qoo10ReplyS3RequeryLineageDigest(lineage);
  for (const [attemptNumber, lastCheckedAt, verification, delaySeconds] of [
    [2, "2026-09-09T00:01:00.000Z", { state: "incomplete", reason: "wrong_sequence_observed" }, 300],
    [3, "2026-09-09T00:06:00.000Z", { state: "incomplete", reason: "exact_identity_not_completed" }, 900],
    [4, "2026-09-09T00:21:00.000Z", { state: "incomplete", reason: "provider_transport_or_contract_failed" }, 3_600],
  ] as const) {
    const decision = decideQoo10ReplyS3Requery({
      ...base,
      attemptNumber,
      lastCheckedAt,
      expectedLineageDigest: digest,
      verification,
    });
    assert.equal(decision.decision, "retry");
    if (decision.decision !== "retry") continue;
    assert.equal(decision.delaySeconds, delaySeconds);
    assert.equal(decision.lineageDigest, digest);
    assert.deepEqual(decision.lineage, lineage);
    assert.equal(decision.operation, "inquiries.list");
    assert.equal(decision.resendAllowed, false);
  }
});

test("Qoo10 requery stops at the attempt and elapsed-time caps", () => {
  const digest = qoo10ReplyS3RequeryLineageDigest(lineage);
  const atAttemptCap = decideQoo10ReplyS3Requery({
    ...base,
    attemptNumber: 5,
    expectedLineageDigest: digest,
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  });
  assert.equal(atAttemptCap.decision, "stop");
  assert.equal(atAttemptCap.reason, "attempt_limit_reached");

  const atElapsedCap = decideQoo10ReplyS3Requery({
    ...base,
    attemptNumber: 2,
    lastCheckedAt: "2026-09-09T06:00:00.000Z",
    expectedLineageDigest: digest,
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  });
  assert.equal(atElapsedCap.decision, "stop");
  assert.equal(atElapsedCap.reason, "elapsed_limit_reached");
});

test("Qoo10 provider rejection retries read-only while verified observations stop", () => {
  const rejected = decideQoo10ReplyS3Requery({
    ...base,
    verification: { state: "incomplete", reason: "provider_rejected" },
  });
  assert.equal(rejected.decision, "retry");
  assert.equal(rejected.resendAllowed, false);
  assert.equal(rejected.replyOperationAllowed, false);

  const verified = decideQoo10ReplyS3Requery({
    ...base,
    verification: { state: "verified", reason: "exact_s3_status_observed" },
  });
  assert.equal(verified.decision, "stop");
  assert.equal(verified.reason, "already_verified");
  assert.equal(verified.resendAllowed, false);
  assert.equal(verified.replyOperationAllowed, false);
});

test("Qoo10 retry lineage proof is mandatory after the initial check and mismatch fails closed", () => {
  const withoutProof = decideQoo10ReplyS3Requery({
    ...base,
    attemptNumber: 2,
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  });
  assert.equal(withoutProof.decision, "stop");
  assert.equal(withoutProof.reason, "lineage_proof_required");

  for (const changedLineage of [
    { ...lineage, credentialId: "00000000-0000-4000-8000-000000000009" },
    { ...lineage, sellerAccountKey: "b".repeat(64) },
    { ...lineage, replyJobId: "00000000-0000-4000-8000-000000000010" },
    { ...lineage, target: { ...lineage.target, questionNo: "999" } },
    { ...lineage, searchEndAt: "20260910235959" },
  ]) {
    const mismatch = decideQoo10ReplyS3Requery({
      ...base,
      lineage: changedLineage,
      attemptNumber: 2,
      expectedLineageDigest: qoo10ReplyS3RequeryLineageDigest(lineage),
      verification: { state: "pending", reason: "exact_s3_not_observed" },
    });
    assert.equal(mismatch.decision, "stop");
    assert.equal(mismatch.reason, "lineage_mismatch");
  }
});

test("Qoo10 requery rejects invalid identity, time, target, and digest inputs", () => {
  assert.throws(() => decideQoo10ReplyS3Requery({
    ...base,
    lineage: { ...lineage, credentialId: "not-a-uuid" },
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  }), /QOO10_REPLY_REQUERY_LINEAGE_INVALID/u);
  assert.throws(() => decideQoo10ReplyS3Requery({
    ...base,
    firstCheckedAt: "invalid",
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  }), /QOO10_REPLY_REQUERY_TIME_INVALID/u);
  assert.throws(() => decideQoo10ReplyS3Requery({
    ...base,
    lineage: { ...lineage, target: { ...lineage.target, sequenceNo: "bad" } },
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  }), /QOO10_REPLY_READBACK_TARGET_INVALID/u);
  assert.throws(() => decideQoo10ReplyS3Requery({
    ...base,
    attemptNumber: 2,
    expectedLineageDigest: "bad",
    verification: { state: "pending", reason: "exact_s3_not_observed" },
  }), /QOO10_REPLY_REQUERY_DIGEST_INVALID/u);
});
