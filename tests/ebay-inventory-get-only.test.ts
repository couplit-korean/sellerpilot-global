import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ebayCookieMarketplaceSku,
  readEbayInventoryGetOnly,
} from "../lib/channels/ebay-inventory-get-only";
import { ebayRequest, runWithProviderReadOnlyTransport } from "../lib/channels/protocols";

const cookieSku = "AUTO-780720401E2D4E4EA45F";
const accessToken = "ebay-access-token-fixture";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("eBay GET-only script decrypts vault in-process and never prints tokens or writes", async () => {
  const source = await readFile(
    new URL("../scripts/ebay-inventory-get-only.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /sellerpilot_decrypt_credential/);
  assert.match(source, /readEbayInventoryGetOnly/);
  assert.doesNotMatch(source, /from ["'].*live-channel-operation|executeChannelOperation|ensureEbayAccessToken/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(access_token|refresh_token|client_secret)/);
  assert.doesNotMatch(source, /api\.ebay\.com|identity\.ebay\.com/);
  assert.doesNotMatch(source, /method:\s*"(PUT|PATCH|DELETE)"/);
});

test("eBay inventory GET-only source cannot claim other channels or mutate inventory", async () => {
  const source = await readFile(
    new URL("../lib/channels/ebay-inventory-get-only.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /runWithProviderReadOnlyTransport/);
  assert.match(source, /method: "GET"/);
  assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /listing\.create|executeChannelOperation|ensureEbayAccessToken/);
  assert.doesNotMatch(source, /claim_channel_gateway|gateway:worker|live-channel-operation/);
  assert.doesNotMatch(source, /qoo10Request|shopeeRequest|coupangRequest|elevenstSellerXmlRequest/);
});

test("eBay cookie SKU constant matches the launch SKU", () => {
  assert.equal(ebayCookieMarketplaceSku, cookieSku);
});

test("eBay GET-only location+inventory treats 404 inventory as absent and extracts one ENABLED location key", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({ url, method });
    assert.equal(method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${accessToken}`);
    if (url.includes("/sell/inventory/v1/location")) {
      return jsonResponse({
        total: 1,
        locations: [{
          merchantLocationKey: "COUPLIT_KR_SEOUL",
          merchantLocationStatus: "ENABLED",
          location: { address: { country: "KR", city: "Seoul" } },
        }],
      });
    }
    assert.match(url, /\/sell\/inventory\/v1\/inventory_item\/AUTO-780720401E2D4E4EA45F$/);
    return jsonResponse({ errors: [{ errorId: 25710, message: "Not found" }] }, 404);
  };
  try {
    const result = await readEbayInventoryGetOnly({
      payload: { access_token: accessToken, marketplace_id: "EBAY_US" },
      sku: cookieSku,
    });
    assert.equal(result.skuOutcome, "absent");
    assert.equal(result.absentReason, "http_404");
    assert.equal(result.inventoryHttpStatus, 404);
    assert.equal(result.exactMerchantLocationKey, "COUPLIT_KR_SEOUL");
    assert.deepEqual(result.merchantLocationKeys, ["COUPLIT_KR_SEOUL"]);
    assert.deepEqual(result.enabledMerchantLocationKeys, ["COUPLIT_KR_SEOUL"]);
    assert.deepEqual(result.locationCountryCodes, ["KR"]);
    assert.equal(result.marketplaceId, "EBAY_US");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
    assert.equal(calls.some((call) => /offer$|publish|inventory_item\/.+/.test(call.url) && call.method !== "GET"), false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(accessToken));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay GET-only inventory 200 with matching sku is present", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/sell/inventory/v1/location")) {
      return jsonResponse({ locations: [] });
    }
    return jsonResponse({ sku: cookieSku, condition: "NEW" });
  };
  try {
    const result = await readEbayInventoryGetOnly({
      payload: { access_token: accessToken },
      sku: cookieSku,
    });
    assert.equal(result.skuOutcome, "present");
    assert.equal(result.inventorySku, cookieSku);
    assert.equal(result.exactMerchantLocationKey, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay read-only transport blocks PUT inventory even if called inside the same ALS", async () => {
  await assert.rejects(
    () => runWithProviderReadOnlyTransport(() => ebayRequest({
      payload: { access_token: accessToken },
      environment: "production",
      method: "PUT",
      path: `/sell/inventory/v1/inventory_item/${cookieSku}`,
      body: { sku: cookieSku },
    })),
    /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/,
  );
});
