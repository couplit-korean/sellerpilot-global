import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertEbayExactExistingQaProviderCopyRequest,
  assertEbayExactExistingQaUpdateArguments,
  bindEbayExactNoEffectRetryArguments,
  bindEbayExactExistingQaRecoveryArguments,
  ebayExactV101ContentContract,
  ebayExactV101ContentContractArgument,
  ebayExactV101ContentRequestFingerprint,
  ebayExactV101ContentRequestFingerprintForBase,
  ebayExactV101EnglishAspects,
  ebayExactExistingQaClientBuyerCopySupplied,
  ebayExactExistingQaCreateForbidden,
  ebayExactExistingQaRecoveryBindingValue,
  ebayExactExistingQaRecoveryCandidate,
  ebayExactExistingQaRecoveryIdentity,
  ebayExactNoEffectRetryArgument,
  ebayExactNoEffectRetryMarker,
} from "../lib/channels/ebay-exact-existing-qa-recovery";
import { prepareListingUpdateArguments } from "../lib/channels/listing-update";

const currentCredentialId = "11111111-2222-4333-8444-555555555555";
const detailUrls = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.com/detail-${index + 1}.jpg`,
);
const representativeUrl =
  "https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg";
const inventoryImageUrls = [representativeUrl, ...detailUrls];

function assetBinding() {
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "b".repeat(64),
    approvedDetailImages: detailUrls.map((publicUrl, index) => ({
      role: `detail-${index + 1}`,
      approvedObjectPath: `approved/detail-${index + 1}.png`,
      approvedSourceSha256: (index + 17).toString(16).padStart(64, "0"),
      publicUrl,
      objectPath: `normalized/${index + 1}.jpg`,
      contentSha256: (index + 1).toString(16).padStart(64, "0"),
    })),
    providerImageSurface: "gallery",
    providerTransportImages: [{
      role: "gallery-representative",
      publicUrl: representativeUrl,
      objectPath: "normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg",
      contentSha256: "292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a",
      approvedObjectPath: "results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/gallery-representative.png",
      approvedSourceSha256: "a".repeat(64),
    }, ...detailUrls.map((publicUrl, index) => ({
      role: `detail-${index + 1}`,
      publicUrl,
      objectPath: `normalized/${index + 1}.jpg`,
      contentSha256: (index + 1).toString(16).padStart(64, "0"),
    }))],
  };
}

function binding(stock = 7) {
  return {
    contract: "ebay_exact_existing_qa_recovery_v2",
    phase: "listing.update",
    productId: ebayExactExistingQaRecoveryIdentity.productId,
    listingId: ebayExactExistingQaRecoveryIdentity.listingId,
    sourceAttemptId: ebayExactExistingQaRecoveryIdentity.sourceAttemptId,
    publicListingId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    market: "US",
    marketplaceId: "EBAY_US",
    marketplaceSku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
    offerId: ebayExactExistingQaRecoveryIdentity.offerId,
    currency: "USD",
    priceUsd: 12.9,
    stock,
    credentialId: currentCredentialId,
    sellerAccountKey: ebayExactExistingQaRecoveryIdentity.sellerAccountKey,
    offerIdSource: "immutable_lineage_attestation_v1",
    sellerAccountLineage: "validated_by_service_rpc",
  } as const;
}

function html() {
  return `<p>This durable cable organizer keeps charging cords tidy and easy to reach.</p>${Array.from(
    { length: 8 },
    (_, index) => `<img src="${detailUrls[index]}">`,
  ).join("")}`;
}

function exactArguments() {
  return bindEbayExactExistingQaRecoveryArguments({
    offerId: "browser-forged-offer",
    providerResourceId: "browser-forged-provider-resource",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedImageCount: 8,
    sellerpilotPublicationAssetBinding: assetBinding(),
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 7 } },
      product: {
        title: "Adhesive Cable Organizer Clips",
        description: html(),
        imageUrls: inventoryImageUrls,
        aspects: {
          Brand: ["Unbranded"],
          Material: ["ABS Plastic"],
          Type: ["Cable Clip(s)"],
        },
      },
    },
    offer: {
      availableQuantity: 7,
      listingDescription: html(),
      pricingSummary: { price: { currency: "USD", value: 12.9 } },
    },
  }, binding());
}

test("exact eBay recovery accepts only the fixed failed/live tuple and strips a browser offer ID", () => {
  assert.equal(ebayExactExistingQaRecoveryCandidate({
    channel: "ebay",
    listingId: ebayExactExistingQaRecoveryIdentity.listingId,
    remoteId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    marketplaceSku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
    status: "failed",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
    failureClass: "external_action",
  }), true);
  assert.equal(ebayExactExistingQaRecoveryCandidate({
    channel: "ebay",
    listingId: ebayExactExistingQaRecoveryIdentity.listingId,
    remoteId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    marketplaceSku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
    status: "failed",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
    failureClass: "retryable",
  }), true);
  assert.equal(ebayExactExistingQaRecoveryCandidate({
    channel: "ebay",
    listingId: ebayExactExistingQaRecoveryIdentity.listingId,
    remoteId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    marketplaceSku: "wrong-sku",
    status: "failed",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
    failureClass: "external_action",
  }), false);
  const argumentsValue = exactArguments();
  assert.equal(Object.hasOwn(argumentsValue, "offerId"), false);
  assert.equal(Object.hasOwn(argumentsValue, "providerResourceId"), false);
  assert.equal(argumentsValue.listingId, ebayExactExistingQaRecoveryIdentity.publicListingId);
  assert.equal(argumentsValue.sku, ebayExactExistingQaRecoveryIdentity.marketplaceSku);
  assert.deepEqual(
    argumentsValue[ebayExactV101ContentContractArgument],
    ebayExactV101ContentContract,
  );
  assert.doesNotThrow(() => assertEbayExactExistingQaUpdateArguments(argumentsValue));
});

test("exact eBay v101 fingerprint and Material translation are narrowly bound", () => {
  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const baseRequestFingerprint =
    "ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2";
  assert.equal(
    ebayExactV101ContentRequestFingerprintForBase(
      baseRequestFingerprint,
    ),
    ebayExactV101ContentRequestFingerprint,
  );
  assert.equal(
    createHash("sha256").update(canonicalJson({
      baseRequestFingerprint,
      contract: ebayExactV101ContentContract,
    })).digest("hex"),
    ebayExactV101ContentRequestFingerprint,
  );
  assert.throws(
    () => ebayExactV101ContentRequestFingerprintForBase("f".repeat(64)),
    /EBAY_EXACT_V101_CONTENT_BASE_FINGERPRINT_REQUIRED/u,
  );
  const source = {
    Brand: ["Unbranded"],
    Material: ["ABS 플라스틱"],
    Type: ["Cable Clip(s)"],
    "Country/Region of Manufacture": ["China"],
  };
  assert.deepEqual(ebayExactV101EnglishAspects(source), {
    ...source,
    Material: ["ABS Plastic"],
  });
  assert.deepEqual(source.Material, ["ABS 플라스틱"]);
  assert.throws(
    () => ebayExactV101EnglishAspects({ ...source, Material: ["PVC"] }),
    /EBAY_EXACT_V101_MATERIAL_ASPECT_REQUIRED/u,
  );
  assert.throws(
    () => ebayExactV101EnglishAspects({ ...source, Brand: ["브랜드 없음"] }),
    /EBAY_EXACT_V101_ENGLISH_ASPECT_SHAPE_REQUIRED/u,
  );
  assert.throws(
    () => ebayExactV101EnglishAspects({ ...source, Brand: { name: "Unbranded" } }),
    /EBAY_EXACT_V101_ENGLISH_ASPECT_SHAPE_REQUIRED/u,
  );
  assert.throws(
    () => ebayExactV101EnglishAspects({ ...source, Brand: ["Бренд"] }),
    /EBAY_EXACT_V101_ENGLISH_ASPECT_SHAPE_REQUIRED/u,
  );
});

test("exact eBay no-effect retry marker is server-owned and changes the canonical request", () => {
  const marked = bindEbayExactNoEffectRetryArguments(exactArguments());
  assert.deepEqual(marked[ebayExactNoEffectRetryArgument], ebayExactNoEffectRetryMarker);
  assert.equal(
    (marked[ebayExactNoEffectRetryArgument] as Record<string, unknown>).providerErrorId,
    25_718,
  );
});

test("exact eBay recovery rejects duplicate create identities and forged price, stock, or marker", () => {
  assert.equal(ebayExactExistingQaCreateForbidden({
    productId: ebayExactExistingQaRecoveryIdentity.productId,
    market: "US",
    targetId: "EBAY_US",
  }), true);
  assert.equal(ebayExactExistingQaCreateForbidden({
    argumentsValue: { offer: { sku: ebayExactExistingQaRecoveryIdentity.marketplaceSku } },
  }), true);

  const badPrice = exactArguments();
  ((badPrice.offer as Record<string, unknown>).pricingSummary as Record<string, unknown>) = {
    price: { currency: "USD", value: 12.91 },
  };
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(badPrice),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/,
  );

  const badStock = exactArguments();
  (badStock.offer as Record<string, unknown>).availableQuantity = 8;
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(badStock),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/,
  );

  assert.equal(ebayExactExistingQaRecoveryBindingValue({
    ...binding(),
    unexpectedCapability: true,
  }), null);
  assert.equal(ebayExactExistingQaRecoveryBindingValue({
    ...binding(),
    offerId: null,
  }), null);
  assert.equal(ebayExactExistingQaRecoveryBindingValue({
    ...binding(),
    offerId: "244042196012",
  }), null);
});

test("exact eBay recovery requires representative plus eight ordered details and genuinely English copy", () => {
  const extraGalleryImage = exactArguments();
  ((extraGalleryImage.inventoryItem as Record<string, unknown>).product as Record<string, unknown>).imageUrls = [
    representativeUrl,
    ...detailUrls.slice(0, 7),
  ];
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(extraGalleryImage),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/,
  );

  const koreanTitle = exactArguments();
  ((koreanTitle.inventoryItem as Record<string, unknown>).product as Record<string, unknown>).title =
    "부착형 케이블 정리 클립 6개 세트";
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(koreanTitle),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/,
  );

  const koreanBody = exactArguments();
  (koreanBody.offer as Record<string, unknown>).listingDescription =
    `<p>책상과 벽의 충전 케이블을 깔끔하게 정리하는 부착형 클립입니다.</p>${Array.from(
      { length: 8 },
      (_, index) => `<img src="https://cdn.example.com/detail-${index + 1}.jpg">`,
    ).join("")}`;
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(koreanBody),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/,
  );
});

test("provider-prepared inventory copy is compact text while offer detail keeps eight images", () => {
  const compact = exactArguments();
  const product = (compact.inventoryItem as Record<string, unknown>)
    .product as Record<string, unknown>;
  product.description =
    "Adhesive cable organizer clips keep charging cords tidy on clean dry surfaces.";
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(compact),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/u,
  );
  assert.doesNotThrow(() => assertEbayExactExistingQaUpdateArguments(compact, {
    inventoryDescriptionMode: "compact_text",
  }));

  const tooLong = structuredClone(compact);
  ((tooLong.inventoryItem as Record<string, unknown>).product as Record<string, unknown>)
    .description = `Safe English cable organizer description ${"detail ".repeat(170)}`;
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(tooLong, {
      inventoryDescriptionMode: "compact_text",
    }),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/u,
  );

  const inventoryImage = structuredClone(compact);
  ((inventoryImage.inventoryItem as Record<string, unknown>).product as Record<string, unknown>)
    .description += '<img src="https://cdn.example.com/not-allowed.jpg">';
  assert.throws(
    () => assertEbayExactExistingQaUpdateArguments(inventoryImage, {
      inventoryDescriptionMode: "compact_text",
    }),
    /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/u,
  );
});

test("exact eBay provider-copy request permits only image transport and rejects buyer text", () => {
  const imageOnly = html().replace(
    "<p>This durable cable organizer keeps charging cords tidy and easy to reach.</p>",
    "",
  );
  const argumentsValue = bindEbayExactExistingQaRecoveryArguments({
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedImageCount: 8,
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 7 } },
      product: {
        description: imageOnly,
        imageUrls: inventoryImageUrls,
      },
    },
    offer: {
      availableQuantity: 7,
      listingDescription: imageOnly,
      pricingSummary: { price: { currency: "USD", value: 12.9 } },
    },
    sellerpilotPublicationAssetBinding: assetBinding(),
  }, binding());
  assert.doesNotThrow(() => assertEbayExactExistingQaProviderCopyRequest(argumentsValue));
  assert.equal(ebayExactExistingQaClientBuyerCopySupplied(argumentsValue), false);

  const forged = structuredClone(argumentsValue);
  ((forged.inventoryItem as Record<string, unknown>).product as Record<string, unknown>).description =
    `<p>Browser supplied text must not be accepted.</p>${imageOnly}`;
  assert.equal(ebayExactExistingQaClientBuyerCopySupplied(forged), true);
  assert.throws(
    () => assertEbayExactExistingQaProviderCopyRequest(forged),
    /EBAY_EXACT_EXISTING_QA_PROVIDER_COPY_REQUEST_REQUIRED/u,
  );

  const forgedRepresentativeLineage = structuredClone(argumentsValue);
  const bindingValue = forgedRepresentativeLineage
    .sellerpilotPublicationAssetBinding as Record<string, unknown>;
  const transports = bindingValue.providerTransportImages as Array<Record<string, unknown>>;
  transports[0].approvedSourceSha256 = "not-a-source-digest";
  assert.throws(
    () => assertEbayExactExistingQaProviderCopyRequest(forgedRepresentativeLineage),
    /EBAY_EXACT_EXISTING_QA_PROVIDER_COPY_REQUEST_REQUIRED/u,
  );
});

test("exact failed eBay candidate preserves price and central-stock fields before the server marker exists", () => {
  const prepared = prepareListingUpdateArguments("ebay", {
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 7 } },
      product: {
        title: "Adhesive Cable Organizer Clips",
        description: "This durable cable organizer keeps charging cords tidy and easy to reach.",
        imageUrls: ["https://cdn.example.com/main.jpg"],
        brand: "Unbranded",
        mpn: "QA-CC-001",
      },
    },
    offer: {
      availableQuantity: 7,
      listingDescription: "This durable cable organizer keeps charging cords tidy and easy to reach.",
      pricingSummary: { price: { currency: "USD", value: 12.9 } },
    },
  }, {
    listingId: ebayExactExistingQaRecoveryIdentity.listingId,
    remoteId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    marketplaceSku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
    status: "failed",
    failureClass: "external_action",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
  });
  assert.deepEqual(
    (prepared.inventoryItem as Record<string, unknown>).availability,
    { shipToLocationAvailability: { quantity: 7 } },
  );
  assert.equal((prepared.inventoryItem as Record<string, unknown>).condition, "NEW");
  assert.deepEqual((prepared.offer as Record<string, unknown>).pricingSummary, {
    price: { currency: "USD", value: 12.9 },
  });
  assert.equal((prepared.offer as Record<string, unknown>).availableQuantity, 7);
  assert.deepEqual(
    (prepared.inventoryItem as Record<string, unknown>).product,
    {},
  );
  assert.equal(
    Object.hasOwn(prepared.offer as Record<string, unknown>, "listingDescription"),
    false,
  );
});
