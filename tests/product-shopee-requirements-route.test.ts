import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Shopee requirement route is read-only and binds official candidates to the exact active SG lineage", async () => {
  const source = await readFile(new URL("../app/api/admin/shopee-requirements/route.ts", import.meta.url), "utf8");
  assert.match(source, /activeProductionShopeeCredentialId\(credentials\) !== parsed\.data\.credentialId/u);
  assert.match(source, /target\.targetId === parsed\.data\.shopId && target\.marketCode === "SG"/u);
  assert.match(source, /envelope\.credentialId !== parsed\.data\.credentialId/u);
  assert.match(source, /sourceFingerprint: parsed\.data\.sourceFingerprint/u);
  assert.match(source, /loadShopeeSgOfficialRequirementCandidates/u);
  assert.match(source, /cache-control": "no-store, max-age=0/u);
  assert.doesNotMatch(source, /add_global_item|publish_global_item|add_item|update_item|delete_item/u);
  assert.doesNotMatch(source, /sellerpilot_service_upsert|sellerpilot_service_create|sellerpilot_service_complete/u);
});

test("Shopee requirement route exposes explicit blocked resources instead of fixed fallback candidates", async () => {
  const source = await readFile(new URL("../app/api/admin/shopee-requirements/route.ts", import.meta.url), "utf8");
  for (const resource of ["category", "brand", "attributes", "logistics", "warehouses", "eligibleShops"]) {
    assert.match(source, new RegExp(`${resource}: state`, "u"));
  }
  assert.match(source, /state: "blocked" as const/u);
  assert.doesNotMatch(source, /100787|1719148844|70000001|9001|SG-LOC/u);
});
