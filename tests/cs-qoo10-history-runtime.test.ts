import assert from "node:assert/strict";
import test from "node:test";
import { enqueueInquiryReplyViaChannelGateway } from "../lib/cs/operations/enqueue-reply.ts";
import { executeQoo10Inquiry } from "../lib/channels/qoo10-inquiries.ts";
import {
  planQoo10History,
  qoo10HistoryWindowKey,
  splitSaturatedQoo10Window,
} from "../lib/channels/cs/qoo10/history.ts";
import {
  assessQoo10HistoryExecution,
  executeQoo10HistoryWindow,
  qoo10HistoryArguments,
  qoo10HistoryExecutionRequests,
  qoo10HistoryWindowFromArguments,
  reconcileQoo10InquiryHistoryRows,
} from "../lib/channels/cs/qoo10/history-runtime.ts";
import {
  prepareQoo10GatewayReply,
  prepareQoo10Reply,
} from "../lib/channels/cs/qoo10/reply-guard.ts";
import {
  buildQoo10S3GatewayReadback,
  executeQoo10ReplyS3Readback,
  verifyQoo10S3Readback,
} from "../lib/channels/cs/qoo10/reply-readback.ts";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols.ts";

const payload = { api_key: "fixture-api-key" };

test("Qoo10 history requests carry stable resume keys for all daily inquiry and claim windows", () => {
  const requests = qoo10HistoryExecutionRequests("2026-09-01", "2026-09-02");
  assert.equal(requests.length, 8);
  assert.equal(new Set(requests.map((request) => request.periodicKey)).size, 8);
  assert.match(requests[0]?.periodicKey ?? "", /^inquiries:history:qoo10:inquiry:S1:/u);
  assert.equal((requests[0]?.arguments.sellerpilotHistoryWindow as Record<string, unknown>).refinement, "day");
  assert.equal(requests.at(-1)?.arguments.kind, "claim");
  for (const request of requests) {
    assert.equal(qoo10HistoryWindowKey(qoo10HistoryWindowFromArguments(request.arguments)), request.periodicKey);
  }
  const tampered = structuredClone(requests[0]!.arguments);
  (tampered.sellerpilotHistoryWindow as Record<string, unknown>).windowKey = "inquiries:history:qoo10:tampered";
  assert.throws(() => qoo10HistoryWindowFromArguments(tampered), /QOO10_HISTORY_ARGUMENTS_INVALID/u);
});

test("Qoo10 saturated inquiry and claim windows refine day to hour to minute to second", () => {
  const plan = planQoo10History("2026-09-01", "2026-09-01");
  const inquiryHours = splitSaturatedQoo10Window(plan.inquiries[0]!);
  const claimHours = splitSaturatedQoo10Window(plan.claims[0]!);
  assert.equal(inquiryHours.length, 24);
  assert.equal(claimHours.length, 24);
  assert.equal(new Set(inquiryHours.map(qoo10HistoryWindowKey)).size, 24);
  const minutes = splitSaturatedQoo10Window(inquiryHours[0]!);
  assert.equal(minutes.length, 60);
  const seconds = splitSaturatedQoo10Window(minutes[0]!);
  assert.equal(seconds.length, 60);
  assert.deepEqual(splitSaturatedQoo10Window(seconds[0]!), []);
  assert.equal(inquiryHours[0]?.parentWindowKey, qoo10HistoryWindowKey(plan.inquiries[0]!));
  for (const child of [inquiryHours[0]!, claimHours[0]!, minutes[0]!, seconds[0]!]) {
    assert.deepEqual(qoo10HistoryWindowFromArguments(qoo10HistoryArguments(child)), child);
  }
});

test("Qoo10 history runtime reaches the native QAPI read path and returns hourly work for a saturated day", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  const row = {
    INQ_TYPE: "MSG", QUESTION_NO: "100", SEQ_NO: "101",
    INQ_DT: "20260901100000", CONTENTS: "fixture question", STATUS: "S1",
  };
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ ResultCode: 0, ResultObject: [row, row] });
  };
  try {
    const window = planQoo10History("2026-09-01", "2026-09-01").inquiries[0]!;
    const result = await runWithProviderReadOnlyTransport(() => executeQoo10HistoryWindow({
      window,
      observedRowLimit: 2,
      execute: (request) => executeQoo10Inquiry({ ...request, payload }),
    }));
    assert.equal(body.proc_status, "S1");
    assert.equal(result.coverage.providerRows, 2);
    assert.equal(result.coverage.uniqueRows, 1);
    assert.equal(result.coverage.duplicateObservations, 1);
    assert.deepEqual(result.coverage.completeness, {
      state: "incomplete", reason: "observed_row_limit_reached",
    });
    assert.equal(result.refinement.length, 24);
    assert.equal(result.coverage.refinementRequired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 history runtime never completes an empty page with a positive provider total", async () => {
  const window = planQoo10History("2026-09-01", "2026-09-01").inquiries[0]!;
  const result = await executeQoo10HistoryWindow({
    window,
    execute: async () => ({
      steps: [{
        name: "GetInquiryMessage",
        ok: true,
        status: 200,
        data: { ResultCode: 0, ResultObject: [], TotalCount: 5 },
      }],
    }),
  });
  assert.deepEqual(result.coverage.completeness, {
    state: "incomplete", reason: "provider_total_mismatch",
  });
  assert.equal(result.coverage.refinementRequired, true);
  assert.equal(result.refinement.length, 24);
});

test("Qoo10 one-second saturation remains an irreducible coverage gap", () => {
  const day = planQoo10History("2026-09-01", "2026-09-01").inquiries[0]!;
  const second = splitSaturatedQoo10Window(
    splitSaturatedQoo10Window(splitSaturatedQoo10Window(day)[0]!)[0]!,
  )[0]!;
  const result = assessQoo10HistoryExecution({
    window: second,
    observedRowLimit: 1,
    execution: {
      steps: [{
        name: "GetInquiryMessage",
        ok: true,
        status: 200,
        data: { ResultCode: 0, ResultObject: [{
          INQ_TYPE: "MSG", QUESTION_NO: "601", SEQ_NO: "602",
          INQ_DT: second.params.search_start_dt, CONTENTS: "fixture",
        }] },
      }],
    },
  });
  assert.equal(result.coverage.completeness.reason, "observed_row_limit_reached");
  assert.equal(result.coverage.refinementRequired, false);
  assert.equal(result.coverage.irreducibleGap, true);
  assert.equal(result.coverage.irreducibleSaturation, true);
  assert.deepEqual(result.refinement, []);
});

test("Qoo10 inquiry reconciliation keeps sequence collisions separate and resolves duplicate status observations", () => {
  const row = { INQ_TYPE: "HELP", QUESTION_NO: "200", SEQ_NO: "201", CONTENTS: "fixture", INQ_DT: "20260901100000" };
  const collision = { ...row, QUESTION_NO: "202" };
  const result = reconcileQoo10InquiryHistoryRows([
    { status: "S1", rows: [row] },
    { status: "S3", rows: [row, collision] },
  ]);
  assert.equal(result.providerRows, 3);
  assert.equal(result.uniqueRows, 2);
  assert.equal(result.duplicateObservations, 1);
  assert.equal(result.crossStatusDuplicates, 1);
  assert.equal(result.sequenceCollisions.length, 1);
  assert.deepEqual(result.identities.map((entry) => entry.latestStatus).sort(), ["S3", "S3"]);
  assert.throws(() => reconcileQoo10InquiryHistoryRows([
    { status: "S1", rows: [row] },
    { status: "S2", rows: [{ ...row, CONTENTS: "conflicting fixture" }] },
  ]), /QOO10_HISTORY_INQUIRY_IDENTITY_CONFLICT/u);
});

test("Qoo10 reply guard preserves legacy tickets and accepts only attested v2 aliases", () => {
  const common = {
    replyText: "fixture reply",
    selectedInboundKey: "inbound-2",
    latestInboundKey: "inbound-2",
    approved: true,
  };
  const legacy = prepareQoo10Reply({
    ...common,
    externalTicketId: "qoo10:ITEM:300:301",
    replyContext: { inquiryType: "ITEM", questionNo: "300", sequenceNo: "301" },
    providerContext: { inquiryType: "ITEM", questionNo: "300", sequenceNo: "301", processingStatus: "S1" },
  });
  assert.equal(legacy.compatibility.ticketIdentity, "legacy");
  const thread = prepareQoo10Reply({
    ...common,
    externalTicketId: "qoo10:v2:ITEM:300",
    replyContext: {
      inquiryType: "ITEM", questionNo: "300", sequenceNo: "302",
      legacyExternalTicketId: "qoo10:ITEM:300:302",
    },
    providerContext: {
      inquiryType: "ITEM", questionNo: "300", sequenceNo: "302", processingStatus: "S2",
      ticketIdentityVersion: "qoo10-thread-v2",
      legacyExternalTicketIds: ["qoo10:ITEM:300:301", "qoo10:ITEM:300:302"],
    },
  });
  assert.equal(thread.compatibility.ticketIdentity, "thread-v2");
  assert.equal(thread.params.seq_no, "302");
  assert.throws(() => prepareQoo10Reply({
    ...common,
    externalTicketId: "qoo10:v2:ITEM:300",
    replyContext: {
      inquiryType: "ITEM", questionNo: "300", sequenceNo: "302",
      legacyExternalTicketId: "qoo10:ITEM:300:302",
    },
    providerContext: {
      inquiryType: "ITEM", questionNo: "300", sequenceNo: "302", processingStatus: "S2",
      ticketIdentityVersion: "qoo10-thread-v2", legacyExternalTicketIds: ["qoo10:ITEM:300:301"],
    },
  }), /QOO10_REPLY_TARGET_INVALID/u);
});

test("Qoo10 guarded reply keeps arguments.params through enqueue and the native adapter", async () => {
  const prepared = prepareQoo10GatewayReply({
    externalTicketId: "qoo10:MSG:700:701",
    replyText: "fixture reply",
    replyContext: { inquiryType: "MSG", questionNo: "700", sequenceNo: "701" },
    providerContext: {
      inquiryType: "MSG", questionNo: "700", sequenceNo: "701", processingStatus: "S1",
    },
    selectedInboundKey: "qoo10:fixture-inbound",
    latestInboundKey: "qoo10:fixture-inbound",
    approved: true,
  });
  let enqueueArguments: Record<string, unknown> = {};
  const serviceClient = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "sellerpilot_enqueue_inquiry_reply_gateway_job");
      enqueueArguments = args;
      return { data: "00000000-0000-4000-8000-000000000701", error: null };
    },
  };
  const queued = await enqueueInquiryReplyViaChannelGateway({
    serviceClient: serviceClient as never,
    ticketId: "00000000-0000-4000-8000-000000000700",
    channel: "qoo10",
    reply: "fixture reply",
    expectedInboundKey: "qoo10:fixture-inbound",
    arguments: prepared.arguments,
  });
  assert.equal(queued.jobId, "00000000-0000-4000-8000-000000000701");
  const requestPayload = enqueueArguments.p_request_payload as Record<string, unknown>;
  assert.deepEqual(requestPayload.arguments, {
    params: { inq_type: "MSG", question_no: "700", seq_no: "701", contents: "fixture reply" },
  });

  const originalFetch = globalThis.fetch;
  let providerBody: Record<string, unknown> = {};
  let providerUrl = "";
  globalThis.fetch = async (input, init) => {
    providerUrl = String(input);
    providerBody = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ ResultCode: 0, ResultObject: "701" });
  };
  try {
    const result = await executeQoo10Inquiry({
      operation: "inquiries.reply",
      payload,
      arguments: requestPayload.arguments as Record<string, unknown>,
    });
    assert.match(providerUrl, /CSCenter\.SetInquiryMessage/u);
    assert.deepEqual(providerBody, {
      returnType: "json", inq_type: "MSG", question_no: "700", seq_no: "701", contents: "fixture reply",
    });
    assert.equal(result.steps[0]?.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 S3 readback blocks resend for absent, wrong-sequence, and nonterminal observations", () => {
  const readbackTarget = { inquiryType: "MSG" as const, questionNo: "400", sequenceNo: "401" };
  const exact = { INQ_TYPE: "MSG", QUESTION_NO: "400", SEQ_NO: "401", STATUS: "S3" };
  assert.deepEqual(verifyQoo10S3Readback({ target: readbackTarget, data: { ResultCode: 0, ResultObject: [exact] } }), {
    state: "verified", reason: "exact_s3_status_observed", resendAllowed: false,
    replyContentObserved: false, matchingRows: 1,
  });
  assert.equal(verifyQoo10S3Readback({
    target: readbackTarget, data: { ResultCode: 0, ResultObject: [] },
  }).state, "pending");
  assert.equal(verifyQoo10S3Readback({
    target: readbackTarget,
    data: { ResultCode: 0, ResultObject: [{ ...exact, SEQ_NO: "402" }] },
  }).reason, "wrong_sequence_observed");
  assert.equal(verifyQoo10S3Readback({
    target: readbackTarget,
    data: { ResultCode: 0, ResultObject: [{ ...exact, STATUS: "S2" }] },
  }).reason, "exact_identity_not_completed");
  assert.equal(verifyQoo10S3Readback({
    target: readbackTarget, data: { ResultCode: -10001 },
  }).reason, "provider_rejected");
});

test("Qoo10 S3 readback executor uses only GetInquiryMessage with the fixed target period", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ ResultCode: 0, ResultObject: [{
      INQ_TYPE: "ITEM", QUESTION_NO: "500", SEQ_NO: "501", STATUS: "S3",
    }] });
  };
  try {
    const result = await runWithProviderReadOnlyTransport(() => executeQoo10ReplyS3Readback({
      from: "20260901000000",
      to: "20260901235959",
      target: { inquiryType: "ITEM", questionNo: "500", sequenceNo: "501" },
      execute: (request) => executeQoo10Inquiry({ ...request, payload }),
    }));
    assert.match(url, /CSCenter\.GetInquiryMessage/u);
    assert.equal(body.proc_status, "S3");
    assert.equal(result.verification.state, "verified");
    assert.equal(result.verification.replyContentObserved, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 S3 gateway readback keeps the delivery binding through the native list adapter", async () => {
  const deliveryId = "00000000-0000-4000-8000-000000000801";
  const request = buildQoo10S3GatewayReadback({
    from: "20260908000000",
    to: "20260908235959",
    deliveryId,
    target: { inquiryType: "HELP", questionNo: "800", sequenceNo: "801" },
  });
  assert.equal(request.periodicKey, `inquiries:reply-readback:qoo10:${deliveryId}`);
  assert.deepEqual(request.arguments.sellerpilotQoo10ReplyReadback, {
    contractVersion: "sellerpilot-qoo10-reply-readback/1",
    deliveryId,
    inquiryType: "HELP",
    questionNo: "800",
    sequenceNo: "801",
  });
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ ResultCode: 0, ResultObject: [] });
  };
  try {
    await executeQoo10Inquiry({ operation: "inquiries.list", payload, arguments: request.arguments });
    assert.deepEqual(body, {
      returnType: "json",
      search_start_dt: "20260908000000",
      search_end_dt: "20260908235959",
      proc_status: "S3",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.throws(() => buildQoo10S3GatewayReadback({
    from: "20260908000000",
    to: "20260908235959",
    deliveryId: "not-a-uuid",
    target: { inquiryType: "HELP", questionNo: "800", sequenceNo: "801" },
  }), /QOO10_REPLY_READBACK_DELIVERY_INVALID/u);
});
