import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertShopeeSgExistingContentSource,
  assertShopeeSgExistingInventorySource,
  bindShopeeSgExistingUpdateArguments,
  shopeeSgExistingUpdateArgument,
  shopeeSgExistingUpdateBinding,
  shopeeSgExistingUpdateCandidate,
  shopeeSgExistingCentralProductVerified,
  shopeeSgExistingUpdateIdentity,
  verifyShopeeSgExistingUpdatePrewrite,
  verifyShopeeSgExistingContentReadback,
  verifyShopeeSgExistingInventoryReadback,
  type ShopeeSgExistingUpdatePhase,
} from "../lib/channels/shopee-sg-existing-update";

const LISTING_ID = "93000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "93000000-0000-4000-8000-000000000002";
const ADOPTION_ID = "93000000-0000-4000-8000-000000000003";
const ADOPTION_JOB_ID = "93000000-0000-4000-8000-000000000004";
const RELEASE_SHA = "a".repeat(40);
const SELLER_KEY = "b".repeat(64);
const EVIDENCE = "c".repeat(64);
const providerImageIds = Array.from({ length: 9 }, (_, index) => `image-${index + 1}`);
const normalizedImageUrls = Array.from(
  { length: 9 },
  (_, index) => `https://sellerpilot.example/normalized/${index + 1}.jpg`,
);

function identity(phase: ShopeeSgExistingUpdatePhase) {
  return {
    status: "allowed" as const,
    contract: "sellerpilot_shopee_sg_existing_update_identity_v1" as const,
    phase,
    listingId: LISTING_ID,
    productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
    credentialId: CREDENTIAL_ID,
    sellerAccountKey: SELLER_KEY,
    itemId: "53717126190",
    sku: "QA-20260823-CC-001",
    merchantId: "5511564",
    shopId: "1719148844",
    market: "SG" as const,
    locale: "en-SG" as const,
    currency: "SGD" as const,
    priceSgd: 16.77,
    stock: 1 as const,
    providerStatus: "UNLIST" as const,
    adoptionAttestationId: ADOPTION_ID,
    adoptionGatewayJobId: ADOPTION_JOB_ID,
    adoptionEvidenceDigest: EVIDENCE,
  };
}

function contentSource() {
  const bound = bindShopeeSgExistingUpdateArguments({
    argumentsValue: {
      globalProduct: true,
      publish: { shop_id: 1719148844 },
      sellerpilotAssets: { detailAssetMode: "dedicated" },
      imageUrls: normalizedImageUrls,
      body: {
        item_name: "Reusable Cable Organizer Clips for Home and Office",
        description: "Keep charging cables neatly organized with durable reusable clips designed for desks, kitchens, offices, and travel.",
        item_status: "NORMAL",
        item_sku: "attacker-sku",
        original_price: 1,
        normal_stock: 999,
        image: { image_id_list: [] },
      },
    },
    identity: identity("content"),
    releaseSha: RELEASE_SHA,
  });
  const prepared = structuredClone(bound);
  delete prepared.sellerpilotAssets;
  return {
    ...prepared,
    imageUrls: normalizedImageUrls,
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "en-SG",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: "d".repeat(64),
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      providerImageSurface: "buyer_visible",
      providerTransportImages: normalizedImageUrls.slice(1).map((publicUrl) => ({ publicUrl })),
    },
  };
}

function contentProviderArguments() {
  const source = contentSource();
  return {
    ...source,
    sellerpilotProviderDetailImageIds: providerImageIds.slice(1),
    body: {
      ...(source.body as Record<string, unknown>),
      image: { image_id_list: providerImageIds },
    },
  };
}

function remoteItem(stock = 1) {
  return {
    response: {
      item_list: [{
        item_id: 53717126190,
        item_sku: "QA-20260823-CC-001",
        item_status: "UNLIST",
        currency: "SGD",
        current_price: 16.77,
        item_name: "Reusable Cable Organizer Clips for Home and Office",
        description: "Keep charging cables neatly organized with durable reusable clips designed for desks, kitchens, offices, and travel.",
        image: { image_id_list: providerImageIds },
        stock_info_v2: { summary_info: { total_available_stock: stock } },
      }],
    },
  };
}

test("exact Shopee SG candidate is limited to the adopted non-public item", () => {
  const base = {
    channel: "shopee",
    operation: "listing.update",
    productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
    remoteId: "53717126190",
    marketplaceSku: "QA-20260823-CC-001",
    market: "SG",
    targetId: "1719148844",
    status: "paused",
    requestedPublicationIntent: "safe_test",
    remoteVisibility: "non_public",
    providerStatus: "UNLIST",
    publishedAt: null,
  };
  assert.equal(shopeeSgExistingUpdateCandidate(base), true);
  assert.equal(shopeeSgExistingUpdateCandidate({ ...base, operation: "inventory.update" }), true);
  assert.equal(shopeeSgExistingUpdateCandidate({ ...base, remoteId: "53717126191" }), false);
  assert.equal(shopeeSgExistingUpdateCandidate({ ...base, providerStatus: "NORMAL" }), false);
  assert.equal(shopeeSgExistingUpdateCandidate({ ...base, publishedAt: "2026-09-01T00:00:00Z" }), false);
  assert.equal(shopeeSgExistingCentralProductVerified({
    product: { sku: "QA-20260823-CC-001", on_hand: 1 },
  }), true);
  assert.equal(shopeeSgExistingCentralProductVerified({
    product: { sku: "QA-20260823-CC-001", on_hand: 2 },
  }), false);
});

test("server binding rebuilds an exact content-only Shopee update payload", () => {
  const value = contentSource();
  const body = value.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(value).sort(), [
    "body", "country", "imageUrls", "localItemId", "publicationExpectedFingerprint",
    "publicationExpectedImageCount", "publicationExpectedLocale",
    "publicationIntent", "publicationStateContract",
    "sellerpilotPublicationAssetBinding", "sellerpilotShopeeSgExistingUpdate",
    "shopId",
  ]);
  assert.deepEqual(Object.keys(body).sort(), ["description", "item_id", "item_name"]);
  assert.equal(value.localItemId, "53717126190");
  assert.equal(body.item_id, 53717126190);
  assert.equal(body.item_status, undefined);
  assert.equal(body.item_sku, undefined);
  assert.equal(body.original_price, undefined);
  assert.equal(body.normal_stock, undefined);
  assert.equal(body.image, undefined);
  assert.equal(body.logistic_info, undefined);
  assert.ok(shopeeSgExistingUpdateBinding(value, "content"));
  assert.equal(shopeeSgExistingUpdateIdentity(identity("content"), "content")?.priceSgd, 16.77);
});

test("content source and provider readback require en-SG, SGD, UNLIST, and exact representative plus eight details", () => {
  const source = contentSource();
  assert.equal(assertShopeeSgExistingContentSource(source).phase, "content");
  const provider = contentProviderArguments();
  assert.equal(verifyShopeeSgExistingUpdatePrewrite({
    argumentsValue: provider,
    phase: "content",
    credentialPayload: {
      shop_id: "1719148844",
      merchant_id: "5511564",
    },
    shopRemoteData: { response: { shop_id: 1719148844 } },
    itemRemoteData: remoteItem(),
  }), true);
  assert.equal(verifyShopeeSgExistingUpdatePrewrite({
    argumentsValue: provider,
    phase: "content",
    credentialPayload: {
      shop_id: "1719148845",
      merchant_id: "5511564",
    },
    shopRemoteData: { response: { shop_id: 1719148844 } },
    itemRemoteData: remoteItem(),
  }), false);
  const evidence = verifyShopeeSgExistingContentReadback({
    argumentsValue: provider,
    remoteData: remoteItem(),
  });
  assert.deepEqual(evidence, {
    contract: "sellerpilot_shopee_sg_existing_content_readback_v1",
    itemId: "53717126190",
    sku: "QA-20260823-CC-001",
    currency: "SGD",
    priceSgd: 16.77,
    providerStatus: "UNLIST",
    visibility: "non_public",
    providerImageIdentityDigest: "c314598136d395f8f2efad08ece1f72f8005048d4ff47aa335d7e6a5ed66247c",
    representativeImageCount: 1,
    detailImageCount: 8,
    titleLanguageVerified: true,
    descriptionLanguageVerified: true,
  });
  assert.equal(verifyShopeeSgExistingContentReadback({
    argumentsValue: provider,
    remoteData: remoteItem(),
  })?.detailImageCount, 8);

  const attacked = structuredClone(provider);
  (attacked.body as Record<string, unknown>).item_name = "케이블 정리 클립";
  assert.throws(() => assertShopeeSgExistingContentSource(attacked));
  const arbitraryMutation = structuredClone(provider);
  (arbitraryMutation.body as Record<string, unknown>).category_id = 999;
  assert.throws(() => assertShopeeSgExistingContentSource(arbitraryMutation));
  const shippingMutation = structuredClone(provider);
  (shippingMutation.body as Record<string, unknown>).logistic_info = [{ logistic_id: 1 }];
  assert.throws(() => assertShopeeSgExistingContentSource(shippingMutation));
  assert.equal(verifyShopeeSgExistingContentReadback({
    argumentsValue: provider,
    remoteData: {
      response: { item_list: [{ ...remoteItem().response.item_list[0], item_status: "NORMAL" }] },
    },
  }), null);
  assert.equal(verifyShopeeSgExistingContentReadback({
    argumentsValue: provider,
    remoteData: {
      response: {
        item_list: [{
          ...remoteItem().response.item_list[0],
          image: { image_id_list: providerImageIds.slice(0, 8) },
        }],
      },
    },
  }), null);
});

test("inventory phase is a separate minimal stock-one contract with authoritative readback", () => {
  const inventory = bindShopeeSgExistingUpdateArguments({
    argumentsValue: {
      quantity: 999,
      body: { item_id: 1, stock_list: [{ seller_stock: [{ stock: 999 }] }] },
      unexpected: true,
    },
    identity: identity("inventory"),
    releaseSha: RELEASE_SHA,
  });
  assert.equal(assertShopeeSgExistingInventorySource(inventory).phase, "inventory");
  assert.deepEqual(Object.keys(inventory).sort(), [
    "country", "itemId", "quantity", "sellerpilotShopeeSgExistingUpdate", "shopId",
  ]);
  assert.equal(verifyShopeeSgExistingInventoryReadback({
    argumentsValue: inventory,
    remoteData: remoteItem(1),
  })?.stock, 1);
  assert.deepEqual(verifyShopeeSgExistingInventoryReadback({
    argumentsValue: inventory,
    remoteData: remoteItem(1),
  }), {
    contract: "sellerpilot_shopee_sg_existing_inventory_readback_v1",
    itemId: "53717126190",
    sku: "QA-20260823-CC-001",
    currency: "SGD",
    priceSgd: 16.77,
    stock: 1,
    providerStatus: "UNLIST",
    visibility: "non_public",
    providerImageIdentityDigest: "c314598136d395f8f2efad08ece1f72f8005048d4ff47aa335d7e6a5ed66247c",
    representativeImageCount: 1,
    detailImageCount: 8,
    titleLanguageVerified: true,
    descriptionLanguageVerified: true,
  });
  assert.equal(verifyShopeeSgExistingInventoryReadback({
    argumentsValue: inventory,
    remoteData: remoteItem(2),
  }), null);

  const attacked = {
    ...inventory,
    [shopeeSgExistingUpdateArgument]: {
      ...(inventory[shopeeSgExistingUpdateArgument] as Record<string, unknown>),
      releaseSha: "e".repeat(40),
    },
    quantity: 2,
  };
  assert.throws(() => assertShopeeSgExistingInventorySource(attacked));
});

test("route and provider wiring keep the exact capability server-owned and prewrite-first", async () => {
  const [route, worker, listingRuntime, operations] = await Promise.all([
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-gateway-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/provider-listing-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/operations.ts", import.meta.url), "utf8"),
  ]);

  const identity = route.indexOf("sellerpilot_service_get_shopee_sg_exact_update_identity");
  const strip = route.indexOf("delete effectiveArguments[shopeeSgExistingUpdateArgument]");
  const bind = route.indexOf("bindShopeeSgExistingUpdateArguments({");
  const fingerprint = route.indexOf('const baseRequestFingerprint = createHash("sha256")');
  const arm = route.indexOf('"sellerpilot_service_arm_shopee_sg_exact_update"');
  const claim = route.indexOf('"sellerpilot_claim_channel_operation"');
  assert.ok(identity >= 0 && strip > identity && bind > strip);
  assert.ok(fingerprint > bind && arm > fingerprint && claim > arm);
  assert.match(route, /assertShopeeSgExistingContentSource\(gatewayArguments\)/u);
  assert.match(route, /assertShopeeSgExistingInventorySource\(effectiveArguments\)/u);

  const exactCredential = worker.indexOf("const exactExistingUpdate = shopeeSgExistingUpdateBinding(arguments_)");
  const storedToken = worker.indexOf("readStoredShopeeShopAccessToken(", exactCredential);
  const staleError = worker.indexOf("SHOPEE_SG_EXISTING_UPDATE_FRESH_OAUTH_REQUIRED", storedToken);
  const genericRefresh = worker.indexOf("ensureShopeeAccessToken(", staleError);
  assert.ok(exactCredential >= 0 && storedToken > exactCredential);
  assert.ok(staleError > storedToken && genericRefresh > staleError);
  assert.match(worker, /delayedShopeeExactInventoryBoundary[\s\S]*providerMutationHooks/u);

  const exactListing = listingRuntime.indexOf(
    'shopeeSgExistingUpdateBinding(input.arguments, "content")',
  );
  const prewrite = listingRuntime.indexOf("verifyShopeeSgExistingUpdatePrewrite({", exactListing);
  const noExactLogistics = listingRuntime.indexOf("const logistics = exactExisting", prewrite);
  const upload = listingRuntime.indexOf("uploadShopeeImage(", noExactLogistics);
  assert.ok(exactListing >= 0 && prewrite > exactListing);
  assert.ok(noExactLogistics > prewrite && upload > noExactLogistics);
  assert.match(
    listingRuntime.slice(noExactLogistics, upload),
    /exactExisting\s*\?\s*null\s*:\s*await activeShopeeLogistics/u,
  );

  const shopeeStart = operations.indexOf("async function executeShopee(");
  const inventoryStart = operations.indexOf(
    'if (input.operation === "inventory.update")',
    shopeeStart,
  );
  const inventoryEnd = operations.indexOf('if (input.operation === "listing.update")', inventoryStart);
  const inventory = operations.slice(inventoryStart, inventoryEnd);
  const inventoryPrewrite = inventory.indexOf("verifyShopeeSgExistingUpdatePrewrite({");
  const inventoryFence = inventory.indexOf("input.providerMutationHooks!.begin()");
  const inventoryWrite = inventory.indexOf('path: "/api/v2/product/update_stock"');
  const inventoryReadback = inventory.indexOf("verifyShopeeSgExistingInventoryReadback({");
  assert.ok(inventoryPrewrite >= 0 && inventoryFence > inventoryPrewrite);
  assert.ok(inventoryWrite > inventoryFence && inventoryReadback > inventoryWrite);
});
