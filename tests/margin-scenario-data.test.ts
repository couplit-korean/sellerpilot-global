import assert from "node:assert/strict";
import test from "node:test";
import {
  isMissingLatestMarginScenarioRpc,
  mergeMarginScenarioRows,
  resolveMarginScenarioRows,
} from "../lib/margin-scenario-data";

function scenario({
  id,
  productId = "11111111-1111-4111-8111-111111111111",
  channelKey = "qoo10",
  createdAt = "2026-08-28T00:00:00.000Z",
}: {
  id: string;
  productId?: string | null;
  channelKey?: string;
  createdAt?: string;
}) {
  return { id, productId, name: id, channelKey, inputs: {}, result: {}, createdAt };
}

test("merges recent history with complete latest product-channel baselines without duplicates", () => {
  const older = scenario({ id: "older", createdAt: "2026-08-27T00:00:00.000Z" });
  const qoo10 = scenario({ id: "qoo10", createdAt: "2026-08-28T01:00:00.000Z" });
  const ebay = scenario({ id: "ebay", channelKey: "ebay", createdAt: "2026-08-28T02:00:00.000Z" });
  const rows = mergeMarginScenarioRows([qoo10, older], [ebay, qoo10]);

  assert.deepEqual(rows.map((row) => row.id), ["ebay", "qoo10", "older"]);
});

test("drops malformed rows instead of inventing margin scenario fields", () => {
  const rows = mergeMarginScenarioRows([
    scenario({ id: "valid" }),
    { id: "missing-fields", productId: null },
    null,
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["valid"]);
});

test("uses the latest lineage RPC as complete coverage and keeps recent calculator history", () => {
  const resolved = resolveMarginScenarioRows({
    recentData: [scenario({ id: "legacy", productId: null })],
    recentError: null,
    latestData: [scenario({ id: "coupang", channelKey: "coupang" })],
    latestError: null,
  });

  assert.equal(resolved.state, "ready");
  assert.equal(resolved.coverage, "latest-per-product-channel");
  assert.deepEqual(new Set(resolved.rows.map((row) => row.id)), new Set(["legacy", "coupang"]));
});

test("falls back to 50 recent rows only for an unapplied latest RPC", () => {
  const missingRpc = {
    code: "PGRST202",
    message: "Could not find the function public.sellerpilot_list_latest_margin_scenarios(p_limit, p_product_id) in the schema cache",
  };
  assert.equal(isMissingLatestMarginScenarioRpc(missingRpc), true);

  const resolved = resolveMarginScenarioRows({
    recentData: [scenario({ id: "recent" })],
    recentError: null,
    latestData: null,
    latestError: missingRpc,
  });
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.coverage, "recent-fallback");
  assert.match(resolved.message ?? "", /최근 50개/);
});

test("reports unavailable when neither authenticated RPC returns an array", () => {
  const resolved = resolveMarginScenarioRows({
    recentData: null,
    recentError: { code: "42501", message: "administrator access required" },
    latestData: null,
    latestError: { code: "42501", message: "administrator access required" },
  });
  assert.equal(resolved.state, "unavailable");
  assert.deepEqual(resolved.rows, []);
});
