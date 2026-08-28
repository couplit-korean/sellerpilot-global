import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSupabaseAddons,
  parseSupabaseApiUsage,
  parseSupabaseDiskUsage,
  parseSupabasePlan,
  parseVercelPlan,
  summarizeVercelCharges,
} from "../lib/platform-usage";

test("Vercel FOCUS rows are aggregated through an explicit allowlist", () => {
  const summary = summarizeVercelCharges([
    JSON.stringify({
      ServiceName: "Fluid Compute",
      ConsumedQuantity: "2.5",
      ConsumedUnit: "GB-hours",
      BilledCost: "1.25",
      EffectiveCost: 1,
      Tags: { ProjectName: "secret-project" },
      accessToken: "must-not-pass",
    }),
    JSON.stringify({
      ServiceName: "Fluid Compute",
      ConsumedQuantity: 1.5,
      ConsumedUnit: "GB-hours",
      BilledCost: 0.75,
      EffectiveCost: 0.5,
    }),
  ].join("\n"));

  assert.equal(summary.acceptedRows, 2);
  assert.deepEqual(summary.totals, { billedCostUsd: 2, effectiveCostUsd: 1.5 });
  assert.deepEqual(summary.services, [{
    serviceName: "Fluid Compute",
    consumedQuantity: 4,
    consumedUnit: "GB-hours",
    billedCostUsd: 2,
    effectiveCostUsd: 1.5,
  }]);
  assert.doesNotMatch(JSON.stringify(summary), /secret-project|must-not-pass|Tags|accessToken/);
});

test("provider plan parsers reject invented plans", () => {
  assert.equal(parseVercelPlan({ billing: { plan: "pro" }, secret: "hidden" }), "pro");
  assert.equal(parseSupabasePlan({ plan: "team", payment_method: "hidden" }), "team");
  assert.throws(() => parseVercelPlan({ billing: { plan: "unlimited" } }));
  assert.throws(() => parseSupabasePlan({ plan: "unlimited" }));
});

test("Supabase operational metrics are normalized without billing-quota inference", () => {
  const apiUsage = parseSupabaseApiUsage({
    result: [
      { total_auth_requests: 2, total_realtime_requests: 3, total_rest_requests: 5, total_storage_requests: 7 },
      { total_auth_requests: "11", total_realtime_requests: "13", total_rest_requests: "17", total_storage_requests: "19" },
    ],
    error: null,
  });
  assert.deepEqual(apiUsage, {
    interval: "1day",
    authRequests: 13,
    realtimeRequests: 16,
    restRequests: 22,
    storageRequests: 26,
    totalRequests: 77,
  });

  assert.deepEqual(parseSupabaseDiskUsage({
    timestamp: "2026-08-28T01:00:00Z",
    metrics: { fs_size_bytes: 1_000, fs_used_bytes: 600, fs_avail_bytes: 400 },
    internal: "discarded",
  }), {
    measuredAt: "2026-08-28T01:00:00Z",
    sizeBytes: 1_000,
    usedBytes: 600,
    availableBytes: 400,
  });
});

test("Supabase addon parser returns selected public billing fields only", () => {
  const addons = parseSupabaseAddons({
    selected_addons: [{
      type: "compute_instance",
      variant: {
        id: "ci_small",
        name: "Small",
        price: { amount: 15, interval: "monthly", type: "fixed", description: "Monthly compute" },
        meta: { internal: "discarded" },
      },
      credential: "discarded",
    }],
    available_addons: [{ secret: "discarded" }],
  });
  assert.deepEqual(addons, [{
    type: "compute_instance",
    variantId: "ci_small",
    name: "Small",
    price: { amount: 15, interval: "monthly", type: "fixed", description: "Monthly compute" },
  }]);
  assert.doesNotMatch(JSON.stringify(addons), /internal|credential|available_addons/);
});
