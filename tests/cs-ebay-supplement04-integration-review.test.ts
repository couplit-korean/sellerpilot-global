import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import { ebayCaseDisputeGatewayPlan } from "../lib/channels/cs/ebay/case-dispute-gateway";

// Regression for the fixed supplemental 04 continuation. The second page must
// reach the provider and finish in the dedicated case/dispute envelope.
test("supplement04 review: common executor continuation completes page two", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    globalThis.fetch = async () => {
      providerCalls += 1;
      return Response.json({
        paymentDisputeSummaries: [{
          paymentDisputeId: "fixture-dispute", orderId: "fixture-order",
          paymentDisputeStatus: "ACTION_NEEDED", reason: "ITEM_NOT_RECOGNIZED",
          openDate: "2026-09-03T00:00:00.000Z", respondByDate: null, closedDate: null,
          amount: { value: "20.00", currency: "USD" },
        }],
        limit: 25, offset: providerCalls === 1 ? 0 : 25, total: 26,
        ...(providerCalls === 1 ? { next: "https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=25&offset=25" } : {}),
      });
    };
    const input = {
      channel: "ebay" as const, operation: "inquiries.list" as const,
      environment: "production" as const,
      payload: {
        access_token: "fixture-token", marketplace_id: "EBAY_US", ebay_user_id: "fixture-seller",
        provider_account_identity_version: "v1",
        provider_account_subject: "ebay:eias:fixtureSellerEiasToken01",
      },
      arguments: ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[2].arguments,
    };
    const first = await executeChannelOperation(input);
    assert.equal(first.ok, true);
    assert.ok(first.continuation);
    assert.equal(first.continuation.arguments.sellerpilotPaginationDepth, 1);
    assert.throws(() => normalizeChannelInquiries("ebay", first, "2026-09-08T13:00:00.000Z"), /INQUIRY_PAGE_REQUIRED:ebay/);
    const second = await executeChannelOperation({ ...input, arguments: first.continuation.arguments });
    assert.equal(second.ok, true);
    assert.equal(second.continuation, undefined);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
