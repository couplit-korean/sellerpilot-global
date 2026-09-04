import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ebayCookieCategoryId,
  exactAllowedAspectValue,
  readEbayTaxonomyPolicyGetOnly,
} from "../lib/channels/ebay-taxonomy-policy-get-only";
import { ebayRequest, runWithProviderReadOnlyTransport } from "../lib/channels/protocols";

const accessToken = "ebay-access-token-fixture";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("eBay taxonomy/policy GET-only script decrypts vault and never prints tokens or writes", async () => {
  const source = await readFile(
    new URL("../scripts/ebay-taxonomy-policy-get-only.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /sellerpilot_decrypt_credential/);
  assert.match(source, /readEbayTaxonomyPolicyGetOnly/);
  assert.doesNotMatch(source, /from ["'].*live-channel-operation|executeChannelOperation|ensureEbayAccessToken/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(access_token|refresh_token|client_secret)/);
  assert.doesNotMatch(source, /method:\s*"(PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /offer\/publish/);
});

test("eBay taxonomy/policy GET-only source cannot mutate listings or auto-pick Brand", async () => {
  const source = await readFile(
    new URL("../lib/channels/ebay-taxonomy-policy-get-only.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /runWithProviderReadOnlyTransport/);
  assert.match(source, /method: "GET"/);
  assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /listing\.create|executeChannelOperation|ensureEbayAccessToken/);
  assert.doesNotMatch(source, /Lotte Wellfood|롯데웰푸드|Lotsand|Pasteur/);
  assert.equal(ebayCookieCategoryId, "20473");
});

test("eBay GET-only aspects+policies extract required Brand/Product and unique policy IDs without inventing values", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({ url, method });
    assert.equal(method, "GET");
    if (url.includes("get_default_category_tree_id")) {
      return jsonResponse({ categoryTreeId: "0" });
    }
    if (url.includes("get_item_aspects_for_category")) {
      assert.match(url, /category_id=20473/);
      return jsonResponse({
        aspects: [
          {
            localizedAspectName: "Brand",
            aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" },
            aspectValues: [{ localizedValue: "Lotte" }, { localizedValue: "Orion" }],
          },
          {
            localizedAspectName: "Product",
            aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" },
            aspectValues: [],
          },
          {
            localizedAspectName: "Flavor",
            aspectConstraint: { aspectRequired: false, aspectMode: "FREE_TEXT" },
            aspectValues: [],
          },
        ],
      });
    }
    if (url.includes("/sell/account/v1/fulfillment_policy")) {
      return jsonResponse({
        total: 1,
        fulfillmentPolicies: [{ fulfillmentPolicyId: "fulfill-1", name: "KR ship", marketplaceId: "EBAY_US" }],
      });
    }
    if (url.includes("/sell/account/v1/payment_policy")) {
      return jsonResponse({
        total: 2,
        paymentPolicies: [
          { paymentPolicyId: "pay-1", name: "US pay", marketplaceId: "EBAY_US" },
          { paymentPolicyId: "pay-2", name: "AU pay", marketplaceId: "EBAY_AU" },
        ],
      });
    }
    if (url.includes("/sell/account/v1/return_policy")) {
      return jsonResponse({ total: 0, returnPolicies: [] });
    }
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const result = await readEbayTaxonomyPolicyGetOnly({
      payload: { access_token: accessToken, marketplace_id: "EBAY_US" },
      categoryId: "20473",
      brandProbes: ["Lotte", "Orion", "Unbranded"],
      productProbes: ["Cookies", "Chips"],
    });
    assert.equal(result.categoryTreeId, "0");
    assert.deepEqual(result.requiredAspectNames, ["Brand", "Product"]);
    assert.equal(result.brandAspect?.mode, "SELECTION_ONLY");
    assert.deepEqual(result.brandAspect?.valuesSample, ["Lotte", "Orion"]);
    assert.equal(result.productAspect?.required, true);
    assert.deepEqual(result.brandProbeHits, ["Lotte", "Orion"]);
    assert.deepEqual(result.productProbeHits, []);
    assert.equal(result.fulfillmentPolicy.exactId, "fulfill-1");
    assert.equal(result.paymentPolicy.exactId, "pay-1");
    assert.equal(result.returnPolicy.exactId, null);
    assert.equal(result.returnPolicy.unverifiedReason, "EBAY_POLICY_NONE");
    assert.equal(exactAllowedAspectValue(result.brandAspect?.valuesSample ?? [], "롯데웰푸드"), null);
    assert.equal(exactAllowedAspectValue(result.brandAspect?.valuesSample ?? [], "Lotte"), "Lotte");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET", "GET", "GET"]);
    assert.equal(calls.every((call) => call.method === "GET"), true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(accessToken));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay GET-only does not auto-pick a policy when two marketplace matches exist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("get_default_category_tree_id")) return jsonResponse({ categoryTreeId: "0" });
    if (url.includes("get_item_aspects_for_category")) return jsonResponse({ aspects: [] });
    if (url.includes("fulfillment_policy")) {
      return jsonResponse({
        total: 2,
        fulfillmentPolicies: [
          { fulfillmentPolicyId: "a", name: "A", marketplaceId: "EBAY_US" },
          { fulfillmentPolicyId: "b", name: "B", marketplaceId: "EBAY_US" },
        ],
      });
    }
    if (url.includes("payment_policy") || url.includes("return_policy")) {
      return jsonResponse({ total: 1, paymentPolicies: [{ paymentPolicyId: "p", marketplaceId: "EBAY_US" }], returnPolicies: [{ returnPolicyId: "r", marketplaceId: "EBAY_US" }] });
    }
    throw new Error(url);
  };
  try {
    const result = await readEbayTaxonomyPolicyGetOnly({
      payload: { access_token: accessToken },
    });
    assert.equal(result.fulfillmentPolicy.exactId, null);
    assert.equal(result.fulfillmentPolicy.unverifiedReason, "EBAY_POLICY_NOT_UNIQUE");
    assert.deepEqual(result.fulfillmentPolicy.ids, ["a", "b"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay read-only transport still blocks policy writes", async () => {
  await assert.rejects(
    () => runWithProviderReadOnlyTransport(() => ebayRequest({
      payload: { access_token: accessToken },
      environment: "production",
      method: "POST",
      path: "/sell/account/v1/fulfillment_policy",
      body: { name: "new" },
    })),
    /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/,
  );
});
