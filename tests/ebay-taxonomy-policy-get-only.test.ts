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

test("eBay GET-only returns only the selected category's aspect requirements and policy IDs", async () => {
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
            aspectConstraint: {
              aspectRequired: true,
              aspectUsage: "RECOMMENDED",
              aspectMode: "SELECTION_ONLY",
              itemToAspectCardinality: "SINGLE",
            },
            aspectValues: [{ localizedValue: "Lotte" }, { localizedValue: "Orion" }],
          },
          {
            localizedAspectName: "Product",
            aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" },
            aspectValues: [],
          },
          {
            localizedAspectName: "Flavor",
            aspectConstraint: {
              aspectRequired: false,
              aspectUsage: "RECOMMENDED",
              expectedRequiredByDate: "2027-01-01T00:00:00.000Z",
              aspectMode: "FREE_TEXT",
            },
            aspectValues: [],
          },
        ],
      });
    }
    if (url.includes("get_item_condition_policies")) {
      return jsonResponse({ itemConditionPolicies: [{
        categoryId: "20473",
        categoryTreeId: "0",
        itemConditionRequired: true,
        itemConditions: [{ conditionId: "1000" }],
      }] });
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
    assert.equal(result.aspectsShapeVerified, true);
    assert.deepEqual(result.requiredAspectNames, ["Brand", "Product"]);
    assert.deepEqual(result.upcomingRequiredAspectNames, ["Flavor"]);
    assert.equal(result.aspects.find((item) => item.name === "Brand")?.cardinality, "SINGLE");
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
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET", "GET", "GET", "GET"]);
    assert.equal(calls.every((call) => call.method === "GET"), true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(accessToken));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay GET-only distinguishes an explicit empty aspect list from malformed HTTP 200 metadata", async () => {
  const originalFetch = globalThis.fetch;
  let aspectPayload: unknown = { aspects: [] };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("get_default_category_tree_id")) return jsonResponse({ categoryTreeId: "0" });
    if (url.includes("get_item_aspects_for_category")) return jsonResponse(aspectPayload);
    if (url.includes("get_item_condition_policies")) return jsonResponse({ itemConditionPolicies: [{
      categoryId: "20473",
      categoryTreeId: "0",
      itemConditionRequired: true,
      itemConditions: [{ conditionId: "1000" }],
    }] });
    if (url.includes("fulfillment_policy")) return jsonResponse({ total: 0, fulfillmentPolicies: [] });
    if (url.includes("payment_policy")) return jsonResponse({ total: 0, paymentPolicies: [] });
    if (url.includes("return_policy")) return jsonResponse({ total: 0, returnPolicies: [] });
    throw new Error(url);
  };
  try {
    const read = () => readEbayTaxonomyPolicyGetOnly({
      payload: { access_token: accessToken, marketplace_id: "EBAY_US" },
      categoryId: "20473",
    });
    const empty = await read();
    assert.equal(empty.aspectsShapeVerified, true);
    assert.equal(empty.aspectCount, 0);
    assert.equal(empty.unverifiedReason, undefined);
    assert.equal(empty.conditionPolicyCategoryTreeId, "0");

    const validAspect = {
      localizedAspectName: "Color",
      aspectConstraint: {
        aspectRequired: false,
        aspectMode: "SELECTION_ONLY",
        itemToAspectCardinality: "SINGLE",
      },
      aspectValues: [{ localizedValue: "Blue" }],
    };
    const malformedPayloads: unknown[] = [
      {},
      { aspects: {} },
      { aspects: [null] },
      { aspects: [validAspect, structuredClone(validAspect)] },
      { aspects: [{ ...validAspect, aspectValues: [{ localizedValue: "Blue" }, null] }] },
      { aspects: [{ ...validAspect, aspectValues: [{
        localizedValue: "Blue",
        valueConstraints: [{
          applicableForLocalizedAspectName: "Material",
          applicableForLocalizedAspectValues: ["Cotton", null],
        }],
      }] }] },
      { aspects: [{ ...validAspect, aspectValues: [{
        localizedValue: "Blue",
        valueConstraints: [
          { applicableForLocalizedAspectName: "Material", applicableForLocalizedAspectValues: ["Cotton"] },
          { applicableForLocalizedAspectName: "Material", applicableForLocalizedAspectValues: ["Wool"] },
        ],
      }] }] },
    ];
    for (const payload of malformedPayloads) {
      aspectPayload = payload;
      const result = await read();
      assert.equal(result.aspectsHttpStatus, 200);
      assert.equal(result.aspectsShapeVerified, false);
      assert.equal(result.aspectCount, 0);
      assert.equal(result.unverifiedReason, "EBAY_ASPECTS_RESPONSE_MALFORMED");
    }
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
    if (url.includes("get_item_condition_policies")) return jsonResponse({ itemConditionPolicies: [{ categoryId: "20473", categoryTreeId: "0", itemConditionRequired: true, itemConditions: [{ conditionId: "1000" }] }] });
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
      payload: { access_token: accessToken, marketplace_id: "EBAY_US" },
      categoryId: "20473",
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

test("eBay policy readback preserves selected domestic and international return terms", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("get_default_category_tree_id")) return jsonResponse({ categoryTreeId: "0" });
    if (url.includes("get_item_aspects_for_category")) return jsonResponse({ aspects: [] });
    if (url.includes("get_item_condition_policies")) return jsonResponse({ itemConditionPolicies: [{ categoryId: "20473", categoryTreeId: "0", itemConditionRequired: true, itemConditions: [{ conditionId: "1000" }] }] });
    if (url.includes("fulfillment_policy")) {
      return jsonResponse({ total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "f", marketplaceId: "EBAY_US" }] });
    }
    if (url.includes("payment_policy")) {
      return jsonResponse({ total: 1, paymentPolicies: [{ paymentPolicyId: "p", marketplaceId: "EBAY_US" }] });
    }
    if (url.includes("return_policy")) {
      return jsonResponse({
        total: 1,
        returnPolicies: [{
          returnPolicyId: "r",
          name: "Confirmed returns",
          marketplaceId: "EBAY_US",
          returnsAccepted: true,
          returnPeriod: { value: 30, unit: "DAY" },
          returnShippingCostPayer: "BUYER",
          refundMethod: "MONEY_BACK",
          internationalOverride: {
            returnsAccepted: false,
            returnShippingCostPayer: "BUYER",
          },
        }],
      });
    }
    throw new Error(url);
  };
  try {
    const result = await readEbayTaxonomyPolicyGetOnly({
      payload: { access_token: accessToken, marketplace_id: "EBAY_US" },
      categoryId: "20473",
    });
    assert.deepEqual(result.returnPolicyDetails, [{
      id: "r",
      name: "Confirmed returns",
      marketplaceId: "EBAY_US",
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      returnShippingCostPayer: "BUYER",
      refundMethod: "MONEY_BACK",
      returnMethod: null,
      internationalOverride: {
        returnsAccepted: false,
        returnPeriod: null,
        returnShippingCostPayer: "BUYER",
        refundMethod: null,
        returnMethod: null,
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
