import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";
import {
  buildGatewayWorkerFailedCompletionPayload,
  safeElevenstProductQnaBusinessFailureResult,
  sanitizedElevenstFailedInquiryStoredResult,
} from "../lib/channels/cs/elevenst/worker-completion";

const job = {
  id: "10000000-0000-4000-8000-000000000011",
  channel: "elevenst",
  operation: "inquiries.list",
};
const claimToken = "20000000-0000-4000-8000-000000000011";
const workerSource = await readFile(new URL("../scripts/cs-gateway-job.mjs", import.meta.url), "utf8");

function business500(): ChannelOperationResult {
  return {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: false,
      status: 200,
      data: {
        accepted: false,
        resultCode: "500",
        productQnas: [],
        sellerpilotInquiryKind: "product_qna",
        message: "raw provider message",
        memID: "must-not-cross-worker-boundary",
      },
    }],
    safeMessage: "provider message must not cross the worker boundary",
  };
}

test("actual worker failure payload keeps only safe 11st Product Q&A business-500 evidence", () => {
  const payload = buildGatewayWorkerFailedCompletionPayload({
    job,
    claimToken,
    error: "11st Product Q&A business error.",
    result: business500(),
  });
  assert.deepEqual(payload, {
    jobId: job.id,
    claimToken,
    status: "failed",
    error: "11st Product Q&A business error.",
    result: {
      ok: false,
      channel: "elevenst",
      operation: "inquiries.list",
      steps: [{
        name: "inquiries",
        ok: false,
        status: 200,
        data: {
          accepted: false,
          resultCode: "500",
          productQnas: [],
          sellerpilotInquiryKind: "product_qna",
        },
      }],
      safeMessage: "11st Product Q&A business response was not accepted.",
    },
  });
  assert.doesNotMatch(JSON.stringify(payload), /raw provider|memID|must-not-cross/u);
});

test("other channels, operations, provider statuses and transport failures never attach a result", () => {
  const examples = [
    { job: { ...job, channel: "qoo10" }, result: { ...business500(), channel: "qoo10" as const } },
    { job: { ...job, operation: "inquiries.reply" }, result: { ...business500(), operation: "inquiries.reply" as const } },
    {
      job,
      result: {
        ...business500(),
        steps: [{ ...business500().steps[0]!, status: 503 }],
      },
    },
    { job, result: null },
  ];
  for (const example of examples) {
    const payload = buildGatewayWorkerFailedCompletionPayload({
      job: example.job,
      claimToken,
      error: "transport or unrelated failure",
      result: example.result,
    });
    assert.equal("result" in payload, false);
  }
});

test("the 11st safe result addition preserves Temu retry continuation without attaching its provider result", () => {
  const retryContinuation = {
    reason: "retryable_read_failure",
    arguments: { kind: "after_sales_detail", requestId: "fixture-request" },
  };
  const payload = buildGatewayWorkerFailedCompletionPayload({
    job: { ...job, channel: "temu" },
    claimToken,
    error: "Temu read will resume.",
    result: { ...business500(), channel: "temu" },
    retryContinuation,
  });
  assert.equal("result" in payload, false);
  assert.deepEqual(payload.retryContinuation, retryContinuation);
});

test("the provider-result branch uses the safe builder while the transport catch remains result-free", () => {
  const completionStart = workerSource.indexOf('const completion = status !== "failed"');
  const catchStart = workerSource.indexOf('} catch (caught)', completionStart);
  assert.ok(completionStart > 0 && catchStart > completionStart);
  assert.match(workerSource.slice(completionStart, catchStart), /buildCsFailedCompletionPayload\(\{ job, claimToken, error: result.safeMessage, result, credentialRefresh \}\)/u);
  assert.doesNotMatch(workerSource.slice(catchStart), /\bresult\s*[,}:]/u);
  assert.match(workerSource.slice(catchStart), /status: externalWriteStarted \? "reconciliation_required" : "failed"/u);

});

test("external worker and serverless failed reads converge on the same normalized stored response", () => {
  const safe = safeElevenstProductQnaBusinessFailureResult(job, business500());
  assert.ok(safe);
  assert.deepEqual(sanitizedElevenstFailedInquiryStoredResult(safe), {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries-normalized",
      ok: false,
      status: 200,
      data: {
        sellerpilotMarker: "normalized_inquiries_v1",
        normalizedInquiryCount: 0,
        providerStepCount: 1,
      },
    }],
    safeMessage: "문의 동기화 결과를 정규화해 저장했습니다.",
  });
});
