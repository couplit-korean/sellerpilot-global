import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { coupangCategoryCloudReadReady } from "../lib/channels/coupang-category-read-readiness";
const releaseSha = "a".repeat(40);
const ready = {
  channel: "coupang", operation: "categories.attributes", configuredChannels: ["coupang"] as const, releaseSha,
  staticEgress: { data: { coupang: true }, error: null },
  runtime: { data: { configured: true, active: true, activeRelease: releaseSha }, error: null },
};
test("Coupang cloud categories require configured egress, approved DB policy and same active release", () => {
  for (const operation of ["categories.suggest", "categories.attributes", "categories.validate"]) assert.equal(coupangCategoryCloudReadReady({ ...ready, operation }), true);
  for (const changed of [
    { configuredChannels: [] }, { releaseSha: null }, { releaseSha: "bad" },
    { staticEgress: { data: { coupang: false }, error: null } },
    { staticEgress: { data: { coupang: true }, error: { code: "unavailable" } } },
    { runtime: { data: { ...ready.runtime.data, configured: false }, error: null } },
    { runtime: { data: { ...ready.runtime.data, active: false }, error: null } },
    { runtime: { data: { ...ready.runtime.data, activeRelease: "b".repeat(40) }, error: null } },
    { runtime: { data: ready.runtime.data, error: { code: "unavailable" } } },
  ]) assert.equal(coupangCategoryCloudReadReady({ ...ready, ...changed }), false);
});
test("local routes for other channels and all product mutations remain mandatory under this exception", () => {
  for (const channel of ["elevenst", "temu", "lazada", "smartstore", "shopee", "ebay", "qoo10"]) assert.equal(coupangCategoryCloudReadReady({ ...ready, channel }), false);
  for (const operation of ["listing.create", "listing.update", "inquiries.list", "inquiries.reply", "orders.list", "categories.list"]) assert.equal(coupangCategoryCloudReadReady({ ...ready, operation }), false);
});
test("admin route uses the exception only inside the failed local-read gate and leaves CREATE gate independent", async () => {
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const start = route.indexOf("let categoryCloudReadReady = false;");
  const end = route.indexOf("const providerMutationStaticEgressChannel", start);
  const gate = route.slice(start, end);
  assert.match(gate, /localExecutorAccess === "read" && !localChannelExecutorReady\s*&& isCoupangCategoryRead\(channel, operation\) && runtimeRelease.status === "valid"/);
  assert.match(gate, /localExecutorAccess === "read" && !localChannelExecutorReady && !categoryCloudReadReady/);
  assert.doesNotMatch(gate, /localChannelExecutorReady\s*=/);
  assert.match(route.slice(end), /providerMutationStaticEgressChannel && !localChannelExecutorReady/);
});
