import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEbayExactExistingQaUpdateArguments,
  bindEbayExactExistingQaRecoveryArguments,
  ebayExactExistingQaCreateForbidden,
  ebayExactExistingQaRecoveryBindingValue,
  ebayExactExistingQaRecoveryCandidate,
  ebayExactExistingQaRecoveryIdentity,
} from "../lib/channels/ebay-exact-existing-qa-recovery";
import { prepareListingUpdateArguments } from "../lib/channels/listing-update";

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
    credentialId: ebayExactExistingQaRecoveryIdentity.credentialId,
    sellerAccountKey: ebayExactExistingQaRecoveryIdentity.sellerAccountKey,
    offerIdSource: "immutable_lineage_attestation_v1",
    sellerAccountLineage: "validated_by_service_rpc",
  } as const;
}

function html() {
  return `<p>This durable cable organizer keeps charging cords tidy and easy to reach.</p>${Array.from(
    { length: 8 },
    (_, index) => `<img src="https://cdn.example.com/detail-${index + 1}.jpg">`,
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
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 7 } },
      product: {
        title: "Adhesive Cable Organizer Clips",
        description: html(),
        imageUrls: ["https://cdn.example.com/main.jpg"],
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
  assert.doesNotThrow(() => assertEbayExactExistingQaUpdateArguments(argumentsValue));
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
});
