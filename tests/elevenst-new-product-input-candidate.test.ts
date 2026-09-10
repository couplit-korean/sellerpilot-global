import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  elevenstListingShippingFields,
  elevenstProcessedFoodNotificationFields,
  elevenstProcessedFoodProductNameNoticeCode,
  elevenstSaleDateRange,
} from "../lib/channels/elevenst-listing";

interface NoticeCandidate {
  code: string;
  sourceMode: string;
  value: string | null;
  state: string;
}

interface CandidateFixture {
  contract: string;
  requestId: string;
  mutationPolicy: Record<string, unknown>;
  freshLiveRead: {
    sellerOffice: { state: string; accountObserved: string | null };
    openApiManagement: { state: string; usageStatusObserved: string | null };
    sellerPilot: { state: string; candidateObserved: boolean };
  };
  historicalAccountEvidence: {
    storedSellerId: string;
    sellerIdMatchesAccount: boolean;
    providerCertifiedOwnership: boolean;
  };
  candidate: {
    product: {
      id: string;
      sellerProductCode: string;
      productName: string;
      priceKrw: number;
      stock: number;
    };
    category: { id: string; leaf: boolean; notificationType: string };
    shipping: Record<string, string | number | boolean>;
    returns: Record<string, unknown>;
    salePeriod: { selPrdClfCd: string };
    certificationGroups: string[];
    images: {
      historicalDetailImageCount: number;
      latestKnownApprovedVersion: number;
      newListingProductImageUrls: string[];
      state: string;
    };
    notifications: NoticeCandidate[];
  };
  existingProductReadOnlyReference: {
    productId: string;
    sellerProductCode: string;
    stockGet: { separateApi: boolean; quantity: number; statusCode: string };
  };
  readiness: {
    state: string;
    resolvedRequiredNoticeCount: number;
    requiredNoticeCount: number;
    blockingRequiredNoticeCodes: string[];
    blockingFields: string[];
  };
}

const fixturePath = fileURLToPath(new URL(
  "../docs/product-channel-parallel/reports/elevenst/fixtures/elevenst-006-new-product-input-candidate.json",
  import.meta.url,
));
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as CandidateFixture;

test("elevenst-006 fixture is read-only and never reuses the existing product as a create target", () => {
  assert.equal(fixture.contract, "sellerpilot-elevenst-new-product-input-candidate/1");
  assert.equal(fixture.requestId, "elevenst-006-r1");
  assert.equal(fixture.existingProductReadOnlyReference.productId, "9598600918");
  assert.equal(fixture.candidate.product.id, "1ed4acfc-7603-48ec-a638-241131e59358");

  for (const [key, value] of Object.entries(fixture.mutationPolicy)) {
    if (key.endsWith("Executed") || key === "gateChanged") assert.equal(value, false, key);
  }
});

test("processed-food category has the exact eleven official notice codes and only product name is auto-filled", () => {
  assert.equal(fixture.candidate.category.id, "1346631");
  assert.equal(fixture.candidate.category.leaf, true);
  assert.equal(fixture.candidate.category.notificationType, "891031");
  assert.deepEqual(
    fixture.candidate.notifications.map(({ code }) => code),
    elevenstProcessedFoodNotificationFields.map(({ code }) => code),
  );

  const auto = fixture.candidate.notifications.filter(({ sourceMode }) => sourceMode === "auto_product_name");
  assert.deepEqual(auto.map(({ code }) => code), [elevenstProcessedFoodProductNameNoticeCode]);
  assert.equal(auto[0]?.value, fixture.candidate.product.productName);
  assert.equal(fixture.candidate.notifications.filter(({ sourceMode }) => sourceMode === "manual").length, 10);
});

test("unapproved sample notice text remains absent and blocks the candidate", () => {
  const unresolved = fixture.candidate.notifications.filter(({ value }) => value === null);
  assert.equal(unresolved.length, 9);
  assert.deepEqual(
    unresolved.map(({ code }) => code),
    fixture.readiness.blockingRequiredNoticeCodes,
  );
  assert.equal(fixture.readiness.resolvedRequiredNoticeCount, 2);
  assert.equal(fixture.readiness.requiredNoticeCount, 11);
  assert.equal(fixture.readiness.state, "blocked");
  assert.ok(unresolved.every(({ state }) => /required$/u.test(state)));
});

test("paid shipping 3000 maps to the native fixed prepaid fields without free-shipping fallback", () => {
  const native = elevenstListingShippingFields({ shippingFeeKrw: fixture.candidate.shipping.shippingFeeKrw });
  assert.deepEqual(native, {
    dlvCstInstBasiCd: "02",
    dlvCstPayTypCd: "03",
    dlvCst1: "3000",
  });
  assert.equal(fixture.candidate.shipping.dlvCstInstBasiCd, "02");
  assert.equal(fixture.candidate.shipping.dlvCst1, "3000");
  assert.equal(fixture.candidate.shipping.dlvCstPayTypCd, "03");
  assert.equal(fixture.candidate.shipping.freeShippingFallbackAllowed, false);
});

test("new candidate stock 1 stays separate from existing product stock API quantity 0", () => {
  assert.equal(fixture.candidate.product.sellerProductCode, "AUTO-780720401E2D4E4EA45F");
  assert.equal(fixture.existingProductReadOnlyReference.sellerProductCode, "AUTO-780720401E2D4E4EA45F");
  assert.equal(fixture.candidate.product.stock, 1);
  assert.equal(fixture.existingProductReadOnlyReference.stockGet.separateApi, true);
  assert.equal(fixture.existingProductReadOnlyReference.stockGet.quantity, 0);
  assert.equal(fixture.existingProductReadOnlyReference.stockGet.statusCode, "02");
  assert.notEqual(fixture.candidate.product.stock, fixture.existingProductReadOnlyReference.stockGet.quantity);
});

test("price, certification groups, and inclusive three-year sale period match the local contract", () => {
  assert.equal(fixture.candidate.product.priceKrw, 3190);
  assert.equal(fixture.candidate.salePeriod.selPrdClfCd, "3y:110");
  assert.deepEqual(fixture.candidate.certificationGroups, ["01:03", "02:03", "03:03", "04:05"]);
  assert.deepEqual(elevenstSaleDateRange(new Date("2026-09-09T15:00:00.000Z")), {
    aplBgnDy: "2026/09/10",
    aplEndDy: "2029/09/09",
  });
});

test("historical eight detail images do not bypass approval or exact image URL requirements", () => {
  assert.equal(fixture.candidate.images.historicalDetailImageCount, 8);
  assert.equal(fixture.candidate.images.latestKnownApprovedVersion, 0);
  assert.deepEqual(fixture.candidate.images.newListingProductImageUrls, []);
  assert.equal(fixture.candidate.images.state, "approval_and_exact_urls_required");
  assert.ok(fixture.readiness.blockingFields.includes("approved detail version"));
  assert.ok(fixture.readiness.blockingFields.includes("exact HTTPS listing image URLs"));
});

test("maintenance, login, and seller identity mismatch stay explicit blockers", () => {
  assert.equal(fixture.freshLiveRead.sellerOffice.state, "blocked_system_maintenance");
  assert.equal(fixture.freshLiveRead.sellerOffice.accountObserved, null);
  assert.equal(fixture.freshLiveRead.openApiManagement.state, "blocked_system_maintenance");
  assert.equal(fixture.freshLiveRead.openApiManagement.usageStatusObserved, null);
  assert.equal(fixture.freshLiveRead.sellerPilot.state, "blocked_login_required");
  assert.equal(fixture.freshLiveRead.sellerPilot.candidateObserved, false);
  assert.equal(fixture.historicalAccountEvidence.storedSellerId, "sample");
  assert.equal(fixture.historicalAccountEvidence.sellerIdMatchesAccount, false);
  assert.equal(fixture.historicalAccountEvidence.providerCertifiedOwnership, false);
});
