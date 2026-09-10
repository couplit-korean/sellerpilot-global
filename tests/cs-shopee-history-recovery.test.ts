import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertShopeeHistoryRecoveryArguments,
  buildShopeeHistoryRecoveryRequest,
  SHOPEE_HISTORY_MAX_RECOVERY_ATTEMPTS,
} from "../lib/channels/cs/shopee/history-recovery";
import { withShopeeHistoryContinuation } from "../lib/channels/cs/shopee/history-event-evidence";
import { planShopeeReturnHistory, planShopeeReviewHistory } from "../lib/channels/cs/shopee/history-plan";
import type { ShopeeHistoryCheckpoint } from "../lib/channels/cs/shopee/history-progress";

const credentialId = "00000000-0000-4000-8000-000000009001";
const shopId = "1719148844";
const failedJobId = "00000000-0000-4000-8000-000000009101";
const runId = "shopee-history-00000000000040008000000000009111";
const digest = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value), "utf8").digest("hex");

function failedJob(arguments_: Record<string, unknown>, id = failedJobId, operation = "inquiries.list") {
  return { id, credentialId, channel: "shopee", operation, status: "failed", request: { arguments: arguments_ } };
}

test("failed review recovery preserves the exact shop and opaque cursor while advancing only event sequence", () => {
  const [scope] = planShopeeReviewHistory([{ shopId, country: "SG" }]);
  const initial = {
    ...scope.arguments,
    sellerpilotShopeeScopeKey: scope.scopeKey,
    sellerpilotShopeeHistoryRunId: runId,
    sellerpilotShopeeHistorySequence: 1,
    sellerpilotShopeeInputCheckpointDigest: null,
  };
  const failedArguments = withShopeeHistoryContinuation(initial, {
    ...initial,
    cursor: "opaque+/cursor==",
    sellerpilotPaginationDepth: 1,
    sellerpilotPaginationEpoch: 0,
    sellerpilotPaginationTrail: ["a".repeat(64)],
  });
  const checkpoint: ShopeeHistoryCheckpoint = {
    kind: "product_review",
    checkpointDigest: String(failedArguments.sellerpilotShopeeInputCheckpointDigest),
    cursorDigest: digest(failedArguments.cursor),
    paginationDepth: 1,
    paginationEpoch: 0,
  };
  const recovered = buildShopeeHistoryRecoveryRequest({
    credentialId, historyRunId: runId, scope, activeCheckpoint: checkpoint,
    failedJob: failedJob(failedArguments),
    interruption: { jobId: failedJobId, sequence: 2,
      checkpointDigest: checkpoint.checkpointDigest, reason: "failed" },
  });

  assert.equal(recovered.shopId, shopId);
  assert.equal(recovered.request.arguments.cursor, failedArguments.cursor);
  assert.equal(recovered.request.arguments.sellerpilotShopeeInputCheckpointDigest,
    failedArguments.sellerpilotShopeeInputCheckpointDigest);
  assert.equal(recovered.request.arguments.sellerpilotShopeeHistorySequence, 3);
  assert.equal(recovered.recoveryAttempt, 1);
  assert.equal("continuationOf" in recovered.request, false);
  assert.equal(assertShopeeHistoryRecoveryArguments(recovered.request.arguments)?.shopId, shopId);
});

test("failed Returns recovery preserves the exact window, list page, and pending detail queue", () => {
  const [scope] = planShopeeReturnHistory([{ shopId, country: "SG" }], {
    from: 1_780_000_000, to: 1_781_296_000,
  });
  const initial = {
    ...scope.arguments,
    sellerpilotShopeeScopeKey: scope.scopeKey,
    sellerpilotShopeeHistoryRunId: runId,
    sellerpilotShopeeHistorySequence: 1,
    sellerpilotShopeeInputCheckpointDigest: null,
  };
  const failedArguments = withShopeeHistoryContinuation(initial, {
    ...initial,
    pageNo: 2,
    returnQueue: ["RETURN_11", "RETURN_12"],
    nextPageNo: 3,
    sellerpilotPaginationDepth: 1,
    sellerpilotPaginationEpoch: 0,
    sellerpilotPaginationTrail: ["b".repeat(64)],
  });
  const checkpoint: ShopeeHistoryCheckpoint = {
    kind: "return_refund",
    checkpointDigest: String(failedArguments.sellerpilotShopeeInputCheckpointDigest),
    pageNo: 2,
    pendingDetailCount: 2,
    nextListPageNo: 3,
    paginationDepth: 1,
    paginationEpoch: 0,
  };
  const recovered = buildShopeeHistoryRecoveryRequest({
    credentialId, historyRunId: runId, scope, activeCheckpoint: checkpoint,
    failedJob: failedJob(failedArguments),
    interruption: { jobId: failedJobId, sequence: 2,
      checkpointDigest: checkpoint.checkpointDigest, reason: "authorization_required" },
  });

  assert.equal(recovered.request.arguments.shopId, shopId);
  assert.equal(recovered.request.arguments.createTimeFrom, scope.arguments.createTimeFrom);
  assert.equal(recovered.request.arguments.createTimeTo, scope.arguments.createTimeTo);
  assert.equal(recovered.request.arguments.pageNo, 2);
  assert.equal(recovered.request.arguments.nextPageNo, 3);
  assert.deepEqual(recovered.request.arguments.returnQueue, ["RETURN_11", "RETURN_12"]);
});

test("scope, window, cursor, sequence, and latest failed-job mismatches fail closed", () => {
  const [scope] = planShopeeReviewHistory([{ shopId, country: "SG" }]);
  const initial = { ...scope.arguments, sellerpilotShopeeScopeKey: scope.scopeKey,
    sellerpilotShopeeHistoryRunId: runId, sellerpilotShopeeHistorySequence: 1,
    sellerpilotShopeeInputCheckpointDigest: null };
  const failedArguments = withShopeeHistoryContinuation(initial, { ...initial, cursor: "exact-cursor",
    sellerpilotPaginationDepth: 1, sellerpilotPaginationEpoch: 0,
    sellerpilotPaginationTrail: ["c".repeat(64)] });
  const checkpoint: ShopeeHistoryCheckpoint = { kind: "product_review",
    checkpointDigest: String(failedArguments.sellerpilotShopeeInputCheckpointDigest),
    cursorDigest: digest("different-cursor"), paginationDepth: 1, paginationEpoch: 0 };
  const input = { credentialId, historyRunId: runId, scope, activeCheckpoint: checkpoint,
    failedJob: failedJob(failedArguments), interruption: { jobId: failedJobId, sequence: 2,
      checkpointDigest: checkpoint.checkpointDigest, reason: "failed" as const } };

  assert.throws(() => buildShopeeHistoryRecoveryRequest(input),
    /SHOPEE_HISTORY_RECOVERY_CHECKPOINT_MISMATCH/u);
  assert.throws(() => buildShopeeHistoryRecoveryRequest({ ...input,
    interruption: { ...input.interruption, jobId: "00000000-0000-4000-8000-000000009199" } }),
  /SHOPEE_HISTORY_RECOVERY_JOB_INVALID/u);
  assert.throws(() => buildShopeeHistoryRecoveryRequest({ ...input,
    interruption: { ...input.interruption, sequence: 3 } }),
  /SHOPEE_HISTORY_RECOVERY_SCOPE_MISMATCH/u);
});

test("recovery is bounded to three failed attempts", () => {
  const [scope] = planShopeeReviewHistory([{ shopId, country: "SG" }]);
  let arguments_: Record<string, unknown> = { ...scope.arguments,
    sellerpilotShopeeScopeKey: scope.scopeKey, sellerpilotShopeeHistoryRunId: runId,
    sellerpilotShopeeHistorySequence: 1, sellerpilotShopeeInputCheckpointDigest: null };
  let jobId = failedJobId;
  for (let attempt = 1; attempt <= SHOPEE_HISTORY_MAX_RECOVERY_ATTEMPTS; attempt += 1) {
    const recovered = buildShopeeHistoryRecoveryRequest({ credentialId, historyRunId: runId,
      scope, activeCheckpoint: null,
      failedJob: failedJob(arguments_, jobId), interruption: { jobId,
        sequence: Number(arguments_.sellerpilotShopeeHistorySequence), checkpointDigest: null, reason: "failed" } });
    assert.equal(recovered.recoveryAttempt, attempt);
    arguments_ = recovered.request.arguments;
    jobId = `00000000-0000-4000-8000-00000000910${attempt + 1}`;
  }
  assert.throws(() => buildShopeeHistoryRecoveryRequest({ credentialId, historyRunId: runId,
    scope, activeCheckpoint: null,
    failedJob: failedJob(arguments_, jobId), interruption: { jobId,
      sequence: Number(arguments_.sellerpilotShopeeHistorySequence), checkpointDigest: null, reason: "failed" } }),
  /SHOPEE_HISTORY_RECOVERY_ATTEMPTS_EXHAUSTED/u);
});

test("customer reply jobs and reply-shaped fields can never enter history recovery", () => {
  const [scope] = planShopeeReviewHistory([{ shopId, country: "SG" }]);
  const arguments_ = { ...scope.arguments, sellerpilotShopeeScopeKey: scope.scopeKey,
    sellerpilotShopeeHistoryRunId: runId, sellerpilotShopeeHistorySequence: 1,
    sellerpilotShopeeInputCheckpointDigest: null };
  const interruption = { jobId: failedJobId, sequence: 1, checkpointDigest: null, reason: "failed" as const };

  assert.throws(() => buildShopeeHistoryRecoveryRequest({ credentialId, historyRunId: runId,
    scope, activeCheckpoint: null,
    failedJob: failedJob(arguments_, failedJobId, "inquiries.reply"), interruption }),
  /SHOPEE_HISTORY_RECOVERY_JOB_INVALID/u);
  assert.throws(() => buildShopeeHistoryRecoveryRequest({ credentialId, historyRunId: runId,
    scope, activeCheckpoint: null,
    failedJob: failedJob({ ...arguments_, reply: "must-not-send", commentId: "7", itemId: "8" }), interruption }),
  /SHOPEE_HISTORY_RECOVERY_ARGUMENTS_INVALID/u);
});
