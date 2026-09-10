import assert from "node:assert/strict";
import test from "node:test";
import { runChannelDiagnostic } from "../lib/channel-diagnostics";
import { channelCatalog } from "../lib/channels/catalog";

test("11st seller ID is required and invalid credentials never reach the provider", async () => {
  const sellerIdField = channelCatalog.elevenst.fields.find((field) => field.key === "seller_id");
  assert.ok(sellerIdField);
  assert.notEqual(sellerIdField.optional, true);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected provider call"); };
  try {
    for (const seller_id of ["", "x", "seller\u0001id", "x".repeat(101)]) {
      const result = await runChannelDiagnostic("elevenst", { api_key: "a".repeat(32), seller_id });
      assert.equal(result.status, "failed");
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st ProductSearch success does not claim a remote seller-ID match", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    assert.equal(new URL(String(url)).searchParams.get("apiCode"), "ProductSearch");
    return new Response('<ProductSearchResponse><Products><TotalCount>0</TotalCount></Products></ProductSearchResponse>', { headers: { "content-type": "application/xml" } });
  };
  try {
    const result = await runChannelDiagnostic("elevenst", { api_key: "a".repeat(32), seller_id: "fixture-seller" });
    assert.equal(result.status, "passed");
    assert.match(result.message, /계정 ID를 되돌려주지 않습니다/u);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
