import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  boundedGatewayCompletionError,
  clearSmartstoreListingUpdateCompletionJournal,
  smartstoreListingUpdateCompletionJournal,
  smartstoreListingUpdateCompletionEvidenceStored,
  stageSmartstoreListingUpdateCompletionJournal,
} from "../scripts/gateway-worker-completion.mjs";

const jobId = "11111111-1111-4111-8111-111111111111";
const claimToken = "22222222-2222-4222-8222-222222222222";

function repairCompletion(overrides = {}) {
  return {
    jobId,
    claimToken,
    status: "reconciliation_required",
    error: `SMARTSTORE_READBACK_FAILED:${"x".repeat(700)}`,
    result: {
      ok: false,
      channel: "smartstore",
      operation: "listing.update",
      steps: [{
        name: "product-update",
        ok: true,
        status: 200,
        data: {
          authorization: "Bearer forbidden",
          credential: { accessToken: "forbidden" },
          sellerpilotVerification: "REMOTE_WRITE_ACCEPTED",
        },
      }],
      remoteId: "13688607602",
      evidence: {
        contract: "smartstore_existing_content_repair_result_v1",
        readbackSha256: "a".repeat(64),
        secret: "forbidden",
      },
      safeMessage: "readback failed",
    },
    credentialRefresh: { payload: { accessToken: "forbidden" } },
    ...overrides,
  };
}

test("completion errors are bounded to the API contract before serialization", () => {
  assert.equal(boundedGatewayCompletionError(` ${"x".repeat(700)} `).length, 500);
  assert.equal(boundedGatewayCompletionError(""), "CHANNEL_OPERATION_FAILED");
});

test("the private journal keeps only scoped job, claim, and sanitized result evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-completion-journal-"));
  try {
    const target = await stageSmartstoreListingUpdateCompletionJournal(repairCompletion(), {
      directory,
      recordedAt: "2026-09-07T06:47:02.576Z",
    });
    assert.equal(target, join(directory, `${jobId}.json`));
    const state = await lstat(target);
    assert.equal(state.mode & 0o777, 0o600);
    const stored = JSON.parse(await readFile(target, "utf8"));
    assert.deepEqual(stored.job, { id: jobId, channel: "smartstore", operation: "listing.update" });
    assert.deepEqual(stored.claim, { id: claimToken });
    assert.equal(stored.completionError.length, 500);
    assert.equal(stored.result.steps[0].data.sellerpilotVerification, "REMOTE_WRITE_ACCEPTED");
    assert.equal(stored.result.evidence.readbackSha256, "a".repeat(64));
    assert.equal(JSON.stringify(stored).includes("forbidden"), false);
    assert.equal(Object.hasOwn(stored, "credentialRefresh"), false);
    await clearSmartstoreListingUpdateCompletionJournal(target);
    await assert.rejects(lstat(target), /ENOENT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("non-SmartStore and non-update results never create a journal", async () => {
  assert.equal(smartstoreListingUpdateCompletionJournal(repairCompletion({
    result: { channel: "coupang", operation: "listing.update" },
  })), null);
  assert.equal(smartstoreListingUpdateCompletionJournal(repairCompletion({
    result: { channel: "smartstore", operation: "listing.create" },
  })), null);
  assert.equal(smartstoreListingUpdateCompletionJournal(repairCompletion({
    status: "succeeded",
    error: undefined,
    result: { channel: "smartstore", operation: "listing.update" },
  })), null);
});

test("an accepted repair survives a failed later readback without claiming verified completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-provisional-repair-"));
  try {
    const payload = repairCompletion({
      error: "SMARTSTORE_CONTENT_REPAIR_POSTWRITE_VERIFICATION_PENDING",
    });
    payload.result.ok = true;
    const target = await stageSmartstoreListingUpdateCompletionJournal(payload, { directory });
    const stored = JSON.parse(await readFile(target, "utf8"));
    assert.equal(stored.completionStatus, "reconciliation_required");
    assert.equal(stored.result.steps[0].status, 200);
    assert.equal(stored.result.steps[0].data.sellerpilotVerification, "REMOTE_WRITE_ACCEPTED");
    assert.equal(smartstoreListingUpdateCompletionEvidenceStored(payload, {
      completionStatus: "reconciliation_required", durableEvidenceStored: false,
    }), false);
    assert.equal((await lstat(target)).isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only a succeeded repair with a durable evidence receipt can clear its journal", () => {
  const succeeded = repairCompletion({ status: "succeeded", error: undefined });
  assert.equal(smartstoreListingUpdateCompletionEvidenceStored(succeeded, {
    completionStatus: "verification_queued",
    durableEvidenceStored: true,
  }), true);
  assert.equal(smartstoreListingUpdateCompletionEvidenceStored(repairCompletion(), {
    completionStatus: "reconciliation_required",
    durableEvidenceStored: false,
  }), false);
  assert.equal(smartstoreListingUpdateCompletionEvidenceStored(succeeded, {
    completionStatus: "reconciliation_required",
    durableEvidenceStored: false,
  }), false);
  assert.equal(smartstoreListingUpdateCompletionEvidenceStored(succeeded, { message: "ok" }), false);
});

test("worker and route wire the bounded error, private journal, and value-free diagnostics", async () => {
  const [worker, route, contract, commerceCompletion] = await Promise.all([
    readFile(new URL("../scripts/commerce-gateway-job.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/channel-gateway/worker/complete/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/gateway-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/commerce-worker-completion.ts", import.meta.url), "utf8"),
  ]);
  const stage = worker.indexOf("stageSmartstoreListingUpdateCompletionJournal(completionPayload)");
  const persist = worker.indexOf('persistWorkerCompletion(\n      "/api/channel-gateway/worker/complete"', stage);
  const durable = worker.indexOf("smartstoreListingUpdateCompletionEvidenceStored(completionPayload, completionResponseBody)", persist);
  const clear = worker.indexOf("clearSmartstoreListingUpdateCompletionJournal(completionJournalPath)", durable);
  assert.ok(stage > 0 && persist > stage && durable > persist && clear > durable);
  assert.match(worker, /result = \{ \.\.\.result, safeMessage: boundedGatewayCompletionError\(result\.safeMessage\) \}/u);
  assert.ok((worker.match(/error: boundedGatewayCompletionError\(/gu) ?? []).length >= 2);
  assert.match(contract, /status: z\.literal\("reconciliation_required"\),[\s\S]{0,160}error: z\.string\(\)\.min\(1\)\.max\(500\)/u);
  assert.match(route, /payloadBytes/u);
  assert.match(route, /path:\s*issue\.path/u);
  assert.match(route, /code:\s*issue\.code/u);
  assert.match(commerceCompletion, /completionStatus: repairCompletion\.data\.status/u);
  assert.match(commerceCompletion, /durableEvidenceStored: repairCompletion\.data\.status === "verification_queued"/u);
  assert.doesNotMatch(route, /console\.error\([^\n]*parsed\.error/u);
});
