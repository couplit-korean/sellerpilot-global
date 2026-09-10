import assert from "node:assert/strict";
import test from "node:test";
import {
  qoo10HistoryGatewayCompletion,
  qoo10HistoryGatewayRpcArguments,
} from "../lib/channels/cs/qoo10/history-gateway.ts";
import {
  qoo10HistoryArguments,
  qoo10HistoryExecutionRequests,
} from "../lib/channels/cs/qoo10/history-runtime.ts";
import { splitSaturatedQoo10Window } from "../lib/channels/cs/qoo10/history.ts";

function result(rows: Record<string, unknown>[], total?: number) {
  return {
    ok: true,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "GetInquiryMessage",
      ok: true,
      status: 200,
      data: {
        ResultCode: 0,
        ResultObject: rows,
        ...(total === undefined ? {} : { TotalCount: total }),
      },
    }],
    safeMessage: "fixture only",
  };
}

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    INQ_TYPE: "MSG",
    QUESTION_NO: String(1_000 + index),
    SEQ_NO: String(2_000 + index),
    CONTENTS: `fixture-${index}`,
    INQ_DT: "20260909010000",
  }));
}

test("Qoo10 gateway history ignores ordinary polling arguments", () => {
  assert.equal(qoo10HistoryGatewayCompletion({
    arguments: { params: { search_start_dt: "20260909", search_end_dt: "20260909", proc_status: "S1" } },
    result: result([]),
  }), null);
});

test("Qoo10 exact observed row limit produces stable hourly resume work", () => {
  const request = qoo10HistoryExecutionRequests("2026-09-09", "2026-09-09")[0]!;
  const completion = qoo10HistoryGatewayCompletion({
    arguments: request.arguments,
    result: result(rows(100)),
    observedRowLimit: 100,
  });
  assert.ok(completion);
  assert.equal(completion.state, "refining");
  assert.equal(completion.coverage.completeness.reason, "observed_row_limit_reached");
  assert.equal(completion.refinementRequests.length, 24);
  assert.equal(new Set(completion.refinementRequests.map((entry) => entry.periodicKey)).size, 24);
  for (const child of completion.refinementRequests) {
    assert.equal(
      child.arguments.sellerpilotHistoryWindow.parentWindowKey,
      request.arguments.sellerpilotHistoryWindow.windowKey,
    );
    assert.equal(child.arguments.sellerpilotHistoryWindow.refinement, "hour");
  }
  assert.deepEqual(qoo10HistoryGatewayCompletion({
    arguments: request.arguments,
    result: result(rows(100)),
    observedRowLimit: 100,
  }), completion);
});

test("Qoo10 row count below an observed boundary remains a gap without invented resume work", () => {
  const request = qoo10HistoryExecutionRequests("2026-09-09", "2026-09-09")[1]!;
  const completion = qoo10HistoryGatewayCompletion({
    arguments: request.arguments,
    result: result(rows(99)),
    observedRowLimit: 100,
  });
  assert.ok(completion);
  assert.equal(completion.state, "gap");
  assert.equal(completion.coverage.completeness.state, "unverified");
  assert.equal(completion.refinementRequests.length, 0);
});

test("Qoo10 empty provider-total page completes without a continuation", () => {
  const request = qoo10HistoryExecutionRequests("2026-09-09", "2026-09-09")[2]!;
  const completion = qoo10HistoryGatewayCompletion({
    arguments: request.arguments,
    result: result([], 0),
    observedRowLimit: 100,
  });
  assert.ok(completion);
  assert.equal(completion.state, "complete");
  assert.equal(completion.coverage.completeness.reason, "provider_total_reconciled");
  assert.equal(completion.refinementRequests.length, 0);
});

test("Qoo10 saturated one-second window is persisted as an irreducible gap", () => {
  const dayRequest = qoo10HistoryExecutionRequests("2026-09-09", "2026-09-09")[0]!;
  let window = dayRequest.arguments;
  for (let index = 0; index < 3; index += 1) {
    const parsed = qoo10HistoryGatewayCompletion({
      arguments: window,
      result: result(rows(100)),
      observedRowLimit: 100,
    });
    assert.ok(parsed);
    window = parsed.refinementRequests[0]!.arguments;
  }
  const final = qoo10HistoryGatewayCompletion({
    arguments: window,
    result: result(rows(100)),
    observedRowLimit: 100,
  });
  assert.ok(final);
  assert.equal(final.state, "gap");
  assert.equal(final.coverage.irreducibleGap, true);
  assert.equal(final.refinementRequests.length, 0);

  const parsedWindow = splitSaturatedQoo10Window({
    source: "qapi_inquiry",
    status: "S1",
    calendarDate: "2026-09-09",
    refinement: "second",
    parentWindowKey: String(window.sellerpilotHistoryWindow.parentWindowKey),
    params: window.params,
  });
  assert.deepEqual(parsedWindow, []);
});

test("Qoo10 history RPC arguments keep the exact job and completion evidence", () => {
  const request = qoo10HistoryExecutionRequests("2026-09-09", "2026-09-09")[0]!;
  const completion = qoo10HistoryGatewayCompletion({
    arguments: qoo10HistoryArguments({
      source: "qapi_inquiry",
      status: "S1",
      calendarDate: "2026-09-09",
      params: request.arguments.params,
    }),
    result: result([], 0),
  });
  assert.ok(completion);
  const rpc = qoo10HistoryGatewayRpcArguments({
    tokenHash: "a".repeat(64),
    jobId: "00000000-0000-4000-8000-000000000001",
    claimToken: "00000000-0000-4000-8000-000000000002",
    completion,
  });
  assert.equal(rpc.p_job_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(rpc.p_completion.windowKey, completion.windowKey);
  assert.equal(rpc.p_completion.contractVersion, "sellerpilot-qoo10-history-gateway-completion/1");
});
