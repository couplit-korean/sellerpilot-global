import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  runTracxDiagnostic,
  tracxNoData,
  tracxOperationArguments,
  tracxOperationSucceeded,
  tracxRequest,
  tracxResultCode,
  tracxSucceeded,
  verifyTracxWebhookSignature,
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
  assert.equal(url.pathname, "/GMKT.INC.GLPS.OpenApiService/SmartShipService.qapi/Tracking");
  assert.equal(url.searchParams.get("returnType"), "json");
  assert.equal(url.searchParams.get("key"), "test-secret-key");
  assert.deepEqual(JSON.parse(requestedBody), { trackingNo: "QSP-123" });
  assert.equal(tracxResultCode(remote.data), 0);
  assert.equal(tracxSucceeded(remote), true);
});

test("TracX treats the provider's empty-list Not Found response as a successful read", async () => {
  const remote = await tracxRequest({
    payload: { api_key: "test-secret-key" },
    operation: "orders.list",
    arguments: { startDate: "2026-08-21", endDate: "2026-08-22" },
    fetchImpl: (async () => new Response(JSON.stringify({
      ResultCode: 1,
      ResultMsg: "Not Found",
      ResultObject: [],
    }), { status: 200 })) as typeof fetch,
  });
  assert.equal(tracxNoData(remote), true);
  assert.equal(tracxOperationSucceeded(remote, "orders.list"), true);
  assert.equal(tracxOperationSucceeded(remote, "orders.get"), false);
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

test("TracX webhook signatures bind the raw body to a fresh timestamp", () => {
  const secret = "webhook-secret-value-that-is-long-enough";
  const body = JSON.stringify({ TrackingNo: "TRACK-1", StatusCode: "D4" });
  const now = Date.parse("2026-08-26T00:00:00.000Z");
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(verifyTracxWebhookSignature({ secret, body, timestamp, signature, now }), true);
  assert.equal(verifyTracxWebhookSignature({ secret, body: `${body} `, timestamp, signature, now }), false);
  assert.equal(verifyTracxWebhookSignature({ secret, body, timestamp, signature, now: now + 5 * 60_000 + 1 }), false);
  assert.equal(verifyTracxWebhookSignature({ secret, body, timestamp, signature: "invalid", now }), false);
});
