import assert from "node:assert/strict";
import test from "node:test";
import {
  runTracxDiagnostic,
  tracxOperationArguments,
  tracxRequest,
  tracxResultCode,
  tracxSucceeded,
} from "../lib/logistics/tracx-core";

test("TracX order list keeps the official date fields and optional filters", () => {
  assert.deepEqual(tracxOperationArguments("orders.list", {
    startDate: "2026-08-01",
    endDate: "2026-08-22",
    periodType: "PAYMENT",
    shopNo: 32081,
    status: "P1",
    ignored: "never-forwarded",
  }), {
    startDate: "2026-08-01",
    endDate: "2026-08-22",
    periodType: "PAYMENT",
    shopNo: 32081,
    status: "P1",
  });
});

test("TracX inquiry operations normalize official status and reply fields", () => {
  assert.deepEqual(tracxOperationArguments("inquiries.list", {
    start_dt: "2026-08-20",
    end_dt: "2026-08-22",
    status: "new",
  }), { start_dt: "2026-08-20", end_dt: "2026-08-22", status: "NEW" });
  assert.deepEqual(tracxOperationArguments("inquiries.reply", {
    ticketId: "TICKET-1",
    content: "배송 상태를 확인했습니다.",
  }), {
    ticket_id: "TICKET-1",
    ticket_prcs_cn: "배송 상태를 확인했습니다.",
    attach_file_list: "",
  });
});

test("TracX rejects oversized date windows before sending provider data", () => {
  assert.throws(() => tracxOperationArguments("orders.list", {
    startDate: "2026-06-01",
    endDate: "2026-08-22",
  }), /TRACX_ARGUMENT_INVALID:dateRange/);
});

test("TracX request uses the official qualified TxAPI path and JSON body", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const remote = await tracxRequest({
    payload: { api_key: "test-secret-key" },
    operation: "tracking.get",
    arguments: { trackingNo: "QSP-123" },
    fetchImpl: (async (input, init) => {
      requestedUrl = String(input);
      requestedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ ResultCode: 0, ResultMsg: "OK", ResultObject: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://api.tracxlogis.com");
  assert.equal(url.pathname, "/GMKT.INC.GLPS.OpenApiService/SmartShipService.qapi/GetShippingHistory");
  assert.equal(url.searchParams.get("returnType"), "json");
  assert.equal(url.searchParams.get("key"), "test-secret-key");
  assert.deepEqual(JSON.parse(requestedBody), { trackingNo: "QSP-123" });
  assert.equal(tracxResultCode(remote.data), 0);
  assert.equal(tracxSucceeded(remote), true);
});

test("TracX diagnostic performs a read-only one-day order query", async () => {
  let body: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ ResultCode: 0, ResultObject: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await runTracxDiagnostic({ api_key: "diagnostic-key" }, new Date("2026-08-22T09:00:00.000Z"));
    assert.equal(result.status, "passed");
    assert.deepEqual(body, { startDate: "2026-08-21", endDate: "2026-08-22" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
