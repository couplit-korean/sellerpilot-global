import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  enqueueCurrentInquirySyncs,
  serverlessCsCurrentInquiryEnqueues,
} = await import("../lib/cs/operations/schedule.ts");

test("SmartStore periodic account results are counted independently while eBay collection remains scheduled", async () => {
  const now = new Date("2026-09-09T01:15:00.000Z");
  const requests = serverlessCsCurrentInquiryEnqueues(now, ["smartstore"]);
  const smartstoreRequests = requests.filter(request => request.channel === "smartstore").length;
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const summary = await enqueueCurrentInquirySyncs({
    now: () => now,
    staticEgressChannels: ["smartstore"],
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2") {
        const plan = args?.p_plan as { anchorAt: string };
        return { data: {
          contract: "sellerpilot-ebay-case-dispute-collection-enqueue/1",
          anchorAt: plan.anchorAt,
          attempted: 1,
          queued: 0,
          pending: 1,
          scopeBlocked: 0,
          deferred: 0,
          status: "accepted",
        }, error: null };
      }
      if (name === "sellerpilot_service_enqueue_periodic_sync"
          && args?.p_channel === "smartstore") {
        return { data: {
          contract: "sellerpilot-smartstore-periodic-fanout/1",
          status: "failed",
          results: [
            { credentialId: "00000000-0000-4000-8000-000000000101", status: "queued" },
            { credentialId: "00000000-0000-4000-8000-000000000102", status: "failed" },
          ],
        }, error: null };
      }
      if (name === "sellerpilot_service_enqueue_lazada_inquiry_fanout") {
        return { data: { status: "already_pending", accounts: [] }, error: null };
      }
      return { data: { status: "already_pending" }, error: null };
    },
  });
  assert.equal(summary.attempted, requests.length + smartstoreRequests + 1);
  assert.equal(summary.queued, smartstoreRequests);
  assert.equal(summary.failed, smartstoreRequests);
  assert.equal(summary.pending, requests.length - smartstoreRequests + 1);
  assert.equal(calls.filter(call => call.name ===
    "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2").length, 1);
});
