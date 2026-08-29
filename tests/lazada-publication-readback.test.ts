import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  lazadaListingArgumentsForPublicationIntent,
  lazadaListingArgumentsForRemoteItem,
  normalizeLazadaListingPublicationReadback,
} from "../lib/channels/provider-lazada-publication-readback";

const FINGERPRINT = "b".repeat(64);
const IMAGES = Array.from({ length: 8 }, (_, index) => `https://my-live.slatic.net/p/image-${index + 1}.jpg`);

function argumentsFor(intent: "safe_test" | "live") {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: intent,
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    country: "my",
    request: {
      Request: {
        Product: {
          PrimaryCategory: "12345",
          Images: { Image: IMAGES },
          Attributes: {
            name: "Cawan yang disahkan",
            description: "Penerangan produk yang tepat",
            short_description: "Maklumat ringkas",
          },
          Skus: {
            Sku: [{
              SellerSku: "CAWAN-MY-1",
              price: "39.90",
              quantity: "1",
              Status: intent === "safe_test" ? "inactive" : "active",
              Images: { Image: IMAGES },
            }],
          },
        },
      },
    },
  };
}

function readback(status: string, qcStatus?: string) {
  return {
    code: "0",
    request_id: "readback-request",
    data: {
      item_id: 987654321,
      status,
      ...(qcStatus ? { qc_status: qcStatus } : {}),
      images: IMAGES,
      attributes: {
        name: "Cawan yang disahkan",
        description: "Penerangan produk yang tepat",
        short_description: "Maklumat ringkas",
      },
      skus: [{
        SkuId: 555001,
        SellerSku: "CAWAN-MY-1",
        Status: status,
        Url: "https://www.lazada.com.my/products/i987654321.html",
        Images: IMAGES,
      }],
    },
  };
}

test("Lazada create shaping forces every SKU inactive for safe_test and active for live", () => {
  const source = argumentsFor("live");
  const safe = lazadaListingArgumentsForPublicationIntent(source, "safe_test");
  const live = lazadaListingArgumentsForPublicationIntent(argumentsFor("safe_test"), "live");
  const safeSkus = safe.request.Request.Product.Skus.Sku;
  const liveSkus = live.request.Request.Product.Skus.Sku;
  assert.equal(safeSkus[0].Status, "inactive");
  assert.equal(liveSkus[0].Status, "active");
  assert.equal(source.request.Request.Product.Skus.Sku[0].Status, "active", "the caller's immutable request must not be changed");
});

test("Lazada update and deactivate shaping bind the exact remote ItemId without mutating the source", () => {
  const source = { itemId: "987654321", request: { Request: { Product: { Attributes: { name: "Cawan" } } } } };
  const shaped = lazadaListingArgumentsForRemoteItem(source, "987654321");
  assert.equal(shaped.request.Request.Product.ItemId, "987654321");
  assert.equal(source.request.Request.Product.ItemId, undefined);
  assert.throws(
    () => lazadaListingArgumentsForRemoteItem({
      ...source,
      request: { Request: { Product: { ItemId: "111", Attributes: { name: "Cawan" } } } },
    }, "987654321"),
    /LAZADA_REMOTE_ITEM_ID_MISMATCH/,
  );
});

test("Lazada GetProductItem normalization binds country, localized content, identity, status and eight images", () => {
  const normalized = normalizeLazadaListingPublicationReadback({
    operation: "listing.create",
    remoteId: "987654321",
    remoteData: readback("active"),
    mutationArguments: argumentsFor("live"),
    market: "my",
    expectedLocale: "ms-MY",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
    verifiedAt: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(normalized.remoteState?.visibility, "live");
  assert.equal(normalized.remoteState?.imageCount, 8);
  assert.deepEqual(normalized.remoteState?.resources, {
    itemId: "987654321",
    country: "my",
    skuIds: ["555001"],
    sellerSkus: ["CAWAN-MY-1"],
    urls: ["https://www.lazada.com.my/products/i987654321.html"],
  });
  assert.deepEqual(
    Object.fromEntries([
      "identityVerified",
      "statusVerified",
      "localeVerified",
      "fingerprintVerified",
      "imageCountVerified",
    ].map((key) => [key, normalized.remoteState?.evidence[key]])),
    {
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      imageCountVerified: true,
    },
  );
  assert.equal(normalized.checks.fingerprintVerified, true);
});

test("Lazada publication evidence fails shut on wrong country, content or image cardinality", () => {
  const base = {
    operation: "listing.create" as const,
    remoteId: "987654321",
    mutationArguments: argumentsFor("live"),
    expectedLocale: "ms-MY",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  };
  assert.equal(normalizeLazadaListingPublicationReadback({
    ...base,
    market: "sg",
    remoteData: readback("active"),
  }).remoteState, undefined);
  assert.equal(normalizeLazadaListingPublicationReadback({
    ...base,
    market: "my",
    remoteData: {
      ...readback("active"),
      data: { ...readback("active").data, attributes: { ...readback("active").data.attributes, name: "Wrong" } },
    },
  }).remoteState, undefined);
  assert.equal(normalizeLazadaListingPublicationReadback({
    ...base,
    market: "my",
    remoteData: { ...readback("active"), data: { ...readback("active").data, images: IMAGES.slice(0, 7) } },
  }).remoteState, undefined);
  assert.equal(normalizeLazadaListingPublicationReadback({
    ...base,
    remoteId: "987654322",
    market: "my",
    remoteData: readback("active"),
  }).remoteState, undefined);
  assert.equal(normalizeLazadaListingPublicationReadback({
    ...base,
    market: "my",
    expectedFingerprint: "not-a-fingerprint",
    remoteData: readback("active"),
  }).remoteState, undefined);
});

test("Lazada safe_test create writes inactive and completes only after exact non-public readback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.includes("/product/create")) {
      return Response.json({ code: "0", request_id: "create-request", data: { item_id: 987654321 } });
    }
    return Response.json(readback("inactive"));
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: argumentsFor("safe_test"),
      environment: "production",
    });
    const payload = new URLSearchParams(calls[0].body).get("payload") ?? "";
    assert.match(payload, /<Status>inactive<\/Status>/);
    assert.equal(calls[1].url.includes("/product/item/get"), true);
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.equal(result.publicationFulfilled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada live create writes active but a QC-pending readback is not counted as published", async () => {
  const originalFetch = globalThis.fetch;
  let createPayload = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/product/create")) {
      createPayload = new URLSearchParams(String(init?.body ?? "")).get("payload") ?? "";
      return Response.json({ code: "0", request_id: "create-request", data: { item_id: 987654321 } });
    }
    const pending = readback("inactive", "pending");
    return Response.json(pending);
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: argumentsFor("live"),
      environment: "production",
    });
    assert.match(createPayload, /<Status>active<\/Status>/);
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "pending_review");
    assert.equal(result.publicationFulfilled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada update binds the existing item and verifies localized fields and eight images", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.includes("/product/update")) return Response.json({ code: "0", request_id: "update-request", data: {} });
    return Response.json(readback("active"));
  };
  try {
    const createArguments = argumentsFor("live");
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "listing.update",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: {
        ...createArguments,
        itemId: "987654321",
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.locale, "ms-MY");
    assert.match(new URLSearchParams(calls[0].body).get("payload") ?? "", /<ItemId>987654321<\/ItemId>/);
    assert.equal(calls.some(({ url }) => url.includes("/product/item/get")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada deactivate binds ItemId from the request and verifies the same item is offline", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.includes("/product/deactivate")) return Response.json({ code: "0", request_id: "deactivate-request", data: {} });
    return Response.json(readback("inactive"));
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "listing.stop",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: {
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ms-MY",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 0,
        country: "my",
        request: { Request: { Product: { ItemId: 987654321 } } },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.match(new URLSearchParams(calls[0].body).get("payload") ?? "", /<ItemId>987654321<\/ItemId>/);
    assert.equal(calls.some(({ url }) => url.includes("/product/item/get")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
