import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bindSmartstoreExactQaRecoveryArguments,
  smartstoreExactQaApprovedContentRequired,
  smartstoreExactQaCentralSkuVerified,
  smartstoreExactQaCreateForbidden,
  smartstoreExactQaRecoveryArgument,
  smartstoreExactQaRecoveryBinding,
  smartstoreExactQaRecoveryCandidate,
  smartstoreExactQaRecoveryIdentity,
} from "../lib/channels/smartstore-exact-qa-recovery";

test("Smartstore exact QA recovery binding is server-owned and preserves null marketplace SKU", () => {
  const argumentsValue = bindSmartstoreExactQaRecoveryArguments({
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
  });
  assert.deepEqual(smartstoreExactQaRecoveryBinding(argumentsValue), {
    contract: "smartstore_exact_qa_recovery_v1",
    phase: "listing.update",
    productId: smartstoreExactQaRecoveryIdentity.productId,
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
    channelProductNo: smartstoreExactQaRecoveryIdentity.channelProductNo,
    centralSku: smartstoreExactQaRecoveryIdentity.centralSku,
    sellerManagementCodeSource: "provider_readback_required",
    sellerAccountLineage: "validated_by_service_rpc",
  });
  assert.equal(Object.hasOwn(argumentsValue, "marketplaceSku"), false);
  assert.equal(Object.hasOwn(argumentsValue, "marketplace_sku"), false);

  const forged = {
    ...argumentsValue,
    [smartstoreExactQaRecoveryArgument]: {
      ...argumentsValue[smartstoreExactQaRecoveryArgument] as Record<string, unknown>,
      channelProductNo: "99999999999",
    },
  };
  assert.equal(smartstoreExactQaRecoveryBinding(forged), null);
});

test("Smartstore exact QA product is update-only and requires the observed failed ledger state", () => {
  assert.equal(smartstoreExactQaCreateForbidden({
    productId: smartstoreExactQaRecoveryIdentity.productId,
  }), true);
  assert.equal(smartstoreExactQaCreateForbidden({
    argumentsValue: {
      body: {
        originProduct: {
          detailAttribute: {
            sellerCodeInfo: {
              sellerManagementCode: smartstoreExactQaRecoveryIdentity.centralSku,
            },
          },
        },
      },
    },
  }), true);

  const exactState = {
    channel: "smartstore",
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
    remoteId: smartstoreExactQaRecoveryIdentity.originProductNo,
    status: "failed",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
    failureClass: "external_action",
  };
  assert.equal(smartstoreExactQaRecoveryCandidate(exactState), true);
  assert.equal(smartstoreExactQaRecoveryCandidate({
    ...exactState,
    remoteId: "99999999999",
  }), false);
  assert.equal(smartstoreExactQaRecoveryCandidate({
    ...exactState,
    status: "published",
  }), false);
});

test("Smartstore exact QA update always requires the approved detail manifest", async () => {
  const exact = {
    channel: "smartstore",
    operation: "listing.update",
    productId: smartstoreExactQaRecoveryIdentity.productId,
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
  };
  assert.equal(smartstoreExactQaApprovedContentRequired(exact), true);
  assert.equal(smartstoreExactQaApprovedContentRequired({
    ...exact,
    listingId: "00000000-0000-4000-8000-000000000000",
  }), false);
  assert.equal(smartstoreExactQaApprovedContentRequired({
    ...exact,
    operation: "listing.stop",
  }), false);

  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /exactSmartstoreContentUpdate = smartstoreExactQaApprovedContentRequired/);
  assert.match(
    route,
    /contentBoundListingOperation = operation === "listing\.create"[\s\S]{0,300}\|\| exactSmartstoreContentUpdate/,
  );
});

test("Smartstore exact QA central SKU accepts no conflicting product or manual value", () => {
  assert.equal(smartstoreExactQaCentralSkuVerified({
    product: { sku: smartstoreExactQaRecoveryIdentity.centralSku },
    manualFields: {},
  }), true);
  assert.equal(smartstoreExactQaCentralSkuVerified({
    product: { sku: smartstoreExactQaRecoveryIdentity.centralSku },
    manualFields: { sellerSku: "OTHER-SKU" },
  }), false);
  assert.equal(smartstoreExactQaCentralSkuVerified({
    product: { sku: "OTHER-SKU" },
    manualFields: { sellerSku: smartstoreExactQaRecoveryIdentity.centralSku },
  }), false);
});
