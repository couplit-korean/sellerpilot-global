import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { RemoteResponse } from "../lib/channels/protocols";
import {
  lazadaMyCreateReadinessContract,
} from "../lib/product-registration/lazada/my-create-readiness";
import {
  lazadaMyCreatePrewriteContract,
  type LazadaMyCreatePrewriteReceipt,
} from "../lib/product-registration/lazada/my-create-prewrite";
import {
  runLazadaMyCreatePostwrite,
} from "../lib/product-registration/lazada/my-create-postwrite";
import {
  lazadaMyCreateCurrentStateContract,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "../lib/product-registration/lazada/my-create-raw-readback";

const SELLER_SKU = "SP-MY-POSTWRITE-001";
const ITEM_ID = "987654321";
const SKU_ID = "555001";
const CATEGORY_ID = "10100205";
const VERIFIED_AT = "2026-09-10T02:03:00.000Z";
const IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/postwrite-${index + 1}.jpg`,
);

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), { status }),
    data,
    text: JSON.stringify(data),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function argumentsValue() {
  return {
    publicationIntent: "safe_test",
    publicationExpectedFingerprint: "e".repeat(64),
    request: {
      Request: {
        Product: {
          PrimaryCategory: CATEGORY_ID,
          Images: { Image: [...IMAGES] },
          Attributes: {
            name: "SellerPilot Postwrite Storage Organizer",
            description: "Verified English description for the MY listing.",
            brand_id: "30768",
          },
          Skus: { Sku: [{
            SellerSku: SELLER_SKU,
            price: "19.90",
            quantity: "3",
            Status: "inactive",
            Images: { Image: [...IMAGES] },
          }] },
        },
      },
    },
  };
}

function readiness() {
  return {
    contract: lazadaMyCreateReadinessContract,
    credentialId: "61111111-1111-4111-8111-111111111111",
    appKey: "137451",
    sellerId: "300872000183",
    shortCode: "MY4NNISR2D",
    categoryId: CATEGORY_ID,
    categoryLanguageCode: "en_US" as const,
    sellerMode: "standard" as const,
    sellerSkus: [SELLER_SKU],
    brand: "30768",
    productImageCount: 8 as const,
    targetPriceMyr: 19.9,
    quantity: 3,
    shipmentProvider: "LGS-FM43",
    deliveryOption: "standard",
    deliveryOptionSof: "No" as const,
    targetVerifiedAt: VERIFIED_AT,
    englishContentApprovedAt: VERIFIED_AT,
    deliveryVerifiedAt: VERIFIED_AT,
    returnVerifiedAt: VERIFIED_AT,
  };
}

function receipt(args: ReturnType<typeof argumentsValue>) {
  const ready = readiness();
  return Object.freeze({
    contract: lazadaMyCreatePrewriteContract,
    readinessContract: lazadaMyCreateReadinessContract,
    requestSha256: createHash("sha256")
      .update(JSON.stringify(stableValue(args))).digest("hex"),
    credentialId: ready.credentialId,
    appKey: ready.appKey,
    sellerId: ready.sellerId,
    shortCode: ready.shortCode,
    market: "MY" as const,
    country: "my" as const,
    categoryId: ready.categoryId,
    categoryLanguageCode: ready.categoryLanguageCode,
    sellerMode: ready.sellerMode,
    sellerSkus: Object.freeze([...ready.sellerSkus]),
    brand: ready.brand,
    productImageCount: ready.productImageCount,
    targetPriceMyr: ready.targetPriceMyr,
    quantity: ready.quantity,
    shipmentProvider: ready.shipmentProvider,
    deliveryOption: ready.deliveryOption,
    deliveryOptionSof: ready.deliveryOptionSof,
    targetVerifiedAt: ready.targetVerifiedAt,
    englishContentApprovedAt: ready.englishContentApprovedAt,
    deliveryVerifiedAt: ready.deliveryVerifiedAt,
    returnVerifiedAt: ready.returnVerifiedAt,
  }) satisfies LazadaMyCreatePrewriteReceipt;
}

function createResponse(overrides: Record<string, unknown> = {}) {
  return remote({
    code: "0",
    data: {
      item_id: ITEM_ID,
      sku_list: [{ seller_sku: SELLER_SKU, sku_id: SKU_ID }],
      ...overrides,
    },
  });
}

function itemReadback(overrides: Record<string, unknown> = {}) {
  const product = argumentsValue().request.Request.Product;
  return remote({
    code: "0",
    data: {
      item_id: ITEM_ID,
      primary_category: CATEGORY_ID,
      status: "inactive",
      locale: "ms-MY",
      images: IMAGES,
      attributes: product.Attributes,
      skus: [{
        ...product.Skus.Sku[0],
        SkuId: SKU_ID,
        special_price: 0,
        Url: `https://www.lazada.com.my/products/i${ITEM_ID}.html`,
      }],
      ...overrides,
    },
  });
}

function currentSource(): LazadaMyCreateCurrentSourceSnapshot {
  return {
    contract: lazadaMyCreateCurrentStateContract,
    productId: "71111111-1111-4111-8111-111111111111",
    productStatus: "draft",
    productDemo: false,
    productOnHand: 3,
    productUpdatedAt: VERIFIED_AT,
    listingStatus: "draft",
    listingRemoteId: null,
    listingUpdatedAt: VERIFIED_AT,
    credentialId: "61111111-1111-4111-8111-111111111111",
    credentialStatus: "active",
    credentialVersion: 1,
  };
}

async function run(input: {
  create?: RemoteResponse;
  readback?: RemoteResponse;
  mutateReceipt?: (value: LazadaMyCreatePrewriteReceipt) => LazadaMyCreatePrewriteReceipt;
  leaseError?: Error;
  completionError?: Error;
} = {}) {
  const events: string[] = [];
  const args = argumentsValue();
  const originalReceipt = receipt(args);
  const snapshot = currentSource();
  const output = await runLazadaMyCreatePostwrite({
    receipt: input.mutateReceipt
      ? input.mutateReceipt(originalReceipt)
      : originalReceipt,
    readiness: readiness() as never,
    argumentsValue: args,
    createResponse: input.create ?? createResponse(),
    verifiedAt: VERIFIED_AT,
    claimedCurrentSource: snapshot,
    hooks: {
      assertLeaseHealthy: async () => {
        events.push("lease");
        if (input.leaseError) throw input.leaseError;
      },
      readCurrentSource: async () => snapshot,
    },
    readItem: async (request) => {
      events.push(`${request.method}:${request.path}:${request.params.item_id}`);
      return input.readback ?? itemReadback();
    },
    completeInternal: async (completion) => {
      events.push(`complete:${completion.itemId}:${completion.skuIds.join(",")}`);
      if (input.completionError) throw input.completionError;
      return { stored: true };
    },
  });
  return { events, output };
}

test("Lazada MY postwrite binds complete CreateProduct identity to exact item readback before internal completion", async () => {
  const { events, output } = await run();
  assert.deepEqual(events, [
    `GET:/product/item/get:${ITEM_ID}`,
    "lease",
    `complete:${ITEM_ID}:${SKU_ID}`,
  ]);
  assert.equal(output.ok, true);
  if (!output.ok) return;
  assert.equal(output.completion.contract, "lazada_my_create_completion_v1");
  assert.equal(output.completion.itemId, ITEM_ID);
  assert.deepEqual(output.completion.sellerSkus, [SELLER_SKU]);
  assert.equal(output.completion.visibility, "non_public");
  assert.deepEqual(output.internalResult, { stored: true });
  assert.equal("createResponse" in output, false);
});

test("Lazada MY postwrite rejects item_id-only success before readback or internal completion", async () => {
  const { events, output } = await run({
    create: createResponse({ sku_list: undefined }),
  });
  assert.deepEqual(events, []);
  assert.equal(output.ok, false);
  if (output.ok) return;
  assert.equal(output.blocker.stage, "create_response");
  assert.equal(output.blocker.code, "LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  assert.equal(output.blocker.sellerpilotReconciliationRequired, true);
  assert.equal(output.blocker.internalCompletionAttempted, false);
});

test("Lazada MY postwrite rejects a wrong or incomplete SKU list before readback", async () => {
  for (const skuList of [
    [{ seller_sku: "OTHER-SKU", sku_id: SKU_ID }],
    [{ seller_sku: SELLER_SKU, sku_id: "" }],
    [],
  ]) {
    const { events, output } = await run({
      create: createResponse({ sku_list: skuList }),
    });
    assert.deepEqual(events, []);
    assert.equal(output.ok, false);
    if (!output.ok) assert.equal(output.blocker.stage, "create_response");
  }
});

test("Lazada MY postwrite blocks mismatched official readback with zero internal completion", async () => {
  const { events, output } = await run({
    readback: itemReadback({ item_id: "987654322" }),
  });
  assert.deepEqual(events, [`GET:/product/item/get:${ITEM_ID}`]);
  assert.equal(output.ok, false);
  if (output.ok) return;
  assert.equal(output.blocker.stage, "item_readback");
  assert.equal(output.blocker.code, "LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  assert.equal(output.blocker.itemId, ITEM_ID);
  assert.equal(output.blocker.internalCompletionAttempted, false);
});

test("Lazada MY postwrite rejects receipt drift before any provider read", async () => {
  const { events, output } = await run({
    mutateReceipt: (value) => ({ ...value, sellerId: "999999999999" }),
  });
  assert.deepEqual(events, []);
  assert.equal(output.ok, false);
  if (output.ok) return;
  assert.equal(output.blocker.stage, "prewrite_receipt");
  assert.equal(output.blocker.code, "LAZADA_MY_CREATE_PREWRITE_RECEIPT_MISMATCH");
  assert.equal(output.blocker.internalCompletionAttempted, false);
});

test("Lazada MY postwrite marks lease and internal completion uncertainty for reconciliation", async () => {
  const lease = await run({ leaseError: new Error("LEASE_LOST") });
  assert.deepEqual(lease.events, [`GET:/product/item/get:${ITEM_ID}`, "lease"]);
  assert.equal(lease.output.ok, false);
  if (!lease.output.ok) {
    assert.equal(lease.output.blocker.stage, "lease");
    assert.equal(lease.output.blocker.internalCompletionAttempted, false);
  }

  const internal = await run({
    completionError: new Error("INTERNAL_COMPLETION_UNCERTAIN"),
  });
  assert.deepEqual(internal.events, [
    `GET:/product/item/get:${ITEM_ID}`,
    "lease",
    `complete:${ITEM_ID}:${SKU_ID}`,
  ]);
  assert.equal(internal.output.ok, false);
  if (!internal.output.ok) {
    assert.equal(internal.output.blocker.stage, "internal_completion");
    assert.equal(internal.output.blocker.internalCompletionAttempted, true);
  }
});
