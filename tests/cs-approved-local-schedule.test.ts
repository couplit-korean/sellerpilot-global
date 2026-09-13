import assert from "node:assert/strict";
import test from "node:test";
import { enqueueCurrentInquirySyncs } from "../lib/cs/operations/schedule";

test("Vercel enqueues approved Mac CS channels without changing its own egress policy", async () => {
  const enqueued: string[] = [];
  const staticEgressChannels = [] as const;
  const result = await enqueueCurrentInquirySyncs({ includeApprovedLocalRoutes: true, staticEgressChannels,
    now: () => new Date("2026-09-13T05:17:00Z"),
    rpc: async (name, args) => {
      if (name === "sellerpilot_service_local_cs_schedule_channels") return { data: ["temu", "lazada", "elevenst"], error: null };
      if (name === "sellerpilot_service_enqueue_lazada_inquiry_fanout") {
        enqueued.push("lazada");return { data: { accounts: [{ status: "queued" }] }, error: null };
      }
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        enqueued.push(String(args?.p_channel));return { data: { status: "queued" }, error: null };
      }
      return { data: null, error: { code: "fixture_case_dispute_unavailable" } };
    } });
  assert.ok(enqueued.includes("temu"));assert.ok(enqueued.includes("lazada"));assert.ok(enqueued.includes("elevenst"));
  assert.ok(!enqueued.includes("coupang"));assert.ok(!enqueued.includes("smartstore"));
  assert.deepEqual(staticEgressChannels, []);
  assert.equal(result.failed, 1); // Independent fixture case/dispute lookup.
});

test("unavailable or invalid route proof is counted and never admits a local channel", async () => {
  for (const routeResult of [{ data: null, error: { code: "503" } }, { data: ["not-a-channel"], error: null }]) {
    const enqueued: string[] = [];
    const result = await enqueueCurrentInquirySyncs({ includeApprovedLocalRoutes: true,
      now: () => new Date("2026-09-13T05:17:00Z"), rpc: async (name, args) => {
        if (name === "sellerpilot_service_local_cs_schedule_channels") return routeResult;
        if (name === "sellerpilot_service_enqueue_periodic_sync") {
          enqueued.push(String(args?.p_channel));return { data: { status: "queued" }, error: null };
        }
        return { data: null, error: { code: "fixture_case_dispute_unavailable" } };
      } });
    assert.ok(enqueued.includes("ebay"));assert.ok(!enqueued.includes("temu"));
    assert.equal(result.failed, 2);
  }
});
