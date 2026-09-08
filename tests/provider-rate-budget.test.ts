import assert from "node:assert/strict";
import test from "node:test";
import { providerRateLimitEvidence } from "../lib/channels/provider-rate-budget";
import { step } from "../lib/channels/operation-step";
import type { ChannelOperationResult } from "../lib/channels/operations";
import { coupangRequest, runWithProviderRequestBudget } from "../lib/channels/protocols";

function result(data: Record<string, unknown>, status = 429): ChannelOperationResult {
  return {
    ok: false,
    channel: "ebay",
    operation: "inquiries.list",
    steps: [{ name: "messages", ok: false, status, data }],
    safeMessage: "Rate limited.",
  };
}

test("Retry-After seconds and HTTP dates are bounded", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  assert.deepEqual(providerRateLimitEvidence(result({ responseHeaders: { "retry-after": "12" } }), now), {
    contract: "sellerpilot-provider-rate-budget/1",
    retryAfterSeconds: 12,
    providerSpecified: true,
  });
  assert.equal(providerRateLimitEvidence(result({ headers: { "Retry-After": "Mon, 08 Sep 2026 00:00:31 GMT" } }), now)?.retryAfterSeconds, 31);
  assert.equal(providerRateLimitEvidence(result({ retryAfterSeconds: 99_999 }), now)?.retryAfterSeconds, 3_600);
});

test("429 without a header gets a conservative retry and ordinary failures do not", () => {
  assert.equal(providerRateLimitEvidence(result({ error: "busy" }))?.retryAfterSeconds, 60);
  assert.equal(providerRateLimitEvidence(result({ code: "SERVER_ERROR" }, 503)), null);
  assert.equal(providerRateLimitEvidence(result({ code: "RATE_LIMIT_EXCEEDED" }, 400))?.retryAfterSeconds, 60);
});

test("operation steps retain only bounded provider pacing headers", () => {
  const response = new Response("{}", {
    status: 429,
    headers: {
      "retry-after": "19",
      "x-ebay-c-apicall-limit": "5000,5000",
      "authorization": "private-token",
    },
  });
  const operationStep = step("messages", { response, data: { error: "busy" } });
  assert.deepEqual(operationStep.data.sellerpilotRateLimit, {
    responseHeaders: {
      "retry-after": "19",
      "x-ebay-c-apicall-limit": "5000,5000",
    },
  });
  assert.doesNotMatch(JSON.stringify(operationStep), /private-token|authorization/);
  assert.equal(providerRateLimitEvidence({
    ok: false,
    channel: "ebay",
    operation: "inquiries.list",
    steps: [operationStep],
    safeMessage: "Rate limited.",
  })?.retryAfterSeconds, 19);
});

test("the transport reserves once before every provider HTTP request", async () => {
  const originalFetch = globalThis.fetch;
  let reservations = 0;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return Response.json({ code: "SUCCESS" }); };
  try {
    await runWithProviderRequestBudget(async () => { reservations += 1; }, async () => {
      const payload = { access_key: "access", secret_key: "secret", vendor_id: "vendor" };
      await coupangRequest({ payload, method: "GET", path: "/one" });
      await coupangRequest({ payload, method: "GET", path: "/two" });
    });
    assert.equal(requests, 2);assert.equal(reservations, 2);
  } finally { globalThis.fetch = originalFetch; }
});
