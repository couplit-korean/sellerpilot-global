import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/commerce-operations";
import { assertNoRetiredProductRecovery, hasRetiredProductRecovery } from "../lib/channels/retired-product-recovery";
import { listingUpdateServerCandidate, prepareListingUpdateArguments } from "../lib/channels/listing-update";

const retired = {
  coupang: "sellerpilotCoupangExactQaRecovery",
  ebay: "sellerpilotEbayExactExistingQaRecovery",
  elevenst: "sellerpilotElevenstExactExistingPublication",
  lazada: "sellerpilotLazadaExactExistingUpdate",
  qoo10: "sellerpilotQoo10ExactLocalization",
  shopee: "sellerpilotShopeeSgExistingUpdate",
  smartstore: "sellerpilotSmartstoreExactQaRecovery",
  temu: "sellerpilotTemuExactExistingUpdate",
} as const;

for (const [channel, marker] of Object.entries(retired) as Array<[keyof typeof retired, string]>) {
  test(`${channel}: retired queued recovery cannot reach a provider`, async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls++; throw new Error("unexpected provider request"); };
    try {
      await assert.rejects(executeChannelOperation({ channel, operation: "listing.update", environment: "production", payload: {}, arguments: { [marker]: null } }), /PRODUCT_RECOVERY_RETIRED/);
      assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("retired markers in persisted nested payloads are rejected without modifying input", () => {
  const value = { sellerpilotPublicationSource: { sourceArguments: [{ sellerpilotQoo10AdoptedLocalization: {} }] } };
  const before = structuredClone(value);
  assert.throws(() => assertNoRetiredProductRecovery(value), /PRODUCT_RECOVERY_RETIRED/);
  assert.deepEqual(value, before);
  assert.equal(hasRetiredProductRecovery({ body: { sellerProductId: "16375780938", sku: "AUTO-780720401E2D4E4EA45F", salePrice: 3290, stockQuantity: 4 } }), false);
});

test("former product IDs receive ordinary update rules and cannot bypass unresolved state", () => {
  for (const channel of Object.keys(retired) as Array<keyof typeof retired>) {
    assert.equal(listingUpdateServerCandidate(channel, { listingId: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc", remoteId: "1217336970", status: "failed", failureClass: "external_action", remoteVisibility: "unknown", requestedPublicationIntent: "live" }), false);
  }
  const draft = { body: { originProduct: { name: "일반 상품 수정", salePrice: 8420, stockQuantity: 7 } } };
  const prepared = prepareListingUpdateArguments("smartstore", draft, { remoteId: "13749310594", status: "published" });
  assert.deepEqual(prepared.body, { originProduct: { name: "일반 상품 수정" } });
  assert.equal(draft.body.originProduct.salePrice, 8420);
});

test("active application source contains no historical product recovery modules or QA tuple", async () => {
  const forbidden = /ddccde35-9c58-4856-b673-d7aa27ce4220|QA-20260823-CC-001|1217336970|16375780938|AUTO-780720401E2D4E4EA45F|9598600918/;
  async function scan(directory: URL): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) await scan(file);
      else if (/\.(?:tsx?|mjs)$/.test(entry.name)) assert.doesNotMatch(await readFile(file, "utf8"), forbidden, file.pathname);
    }
  }
  await scan(new URL("../lib/", import.meta.url));
  await scan(new URL("../app/", import.meta.url));
  await scan(new URL("../scripts/", import.meta.url));
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("hasRetiredProductRecovery(parsed.data.arguments)") < route.indexOf('"sellerpilot_claim_channel_operation"'));
  assert.doesNotMatch(route, /sellerpilot_service_arm_.*exact|sellerpilot_service_atomic_enqueue_ebay_exact/);
});
