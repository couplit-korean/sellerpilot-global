import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemuReviewAndCreatePrewriteBinding,
  temuReadinessEvidenceMaxAgeMs,
  type TemuCreateReadinessServiceInput,
} from "../lib/product-registration/temu/create-readiness-builder";
import { temuReviewAndCreatePrewriteContract } from "../lib/product-registration/temu/create-readiness-adapter";
import { temuReviewAndCreateRequiredApiScopes } from "../lib/product-registration/temu/review-and-create-readiness";

const nowEpochMs = 1_800_000_000_000;
const fingerprint = "a".repeat(64);
const sellerSku = "AUTO-780720401E2D4E4EA45F";
const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const mallId = "608573962731830";
const representativeImages = ["https://cdn.example.test/temu/approved/hero.jpg"];
const detailImages = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/temu/approved/detail-${index + 1}.jpg`,
);

function completeInput(): TemuCreateReadinessServiceInput {
  return {
    nowEpochMs,
    expectedPublicationFingerprint: fingerprint,
    expectedExternalGoodsId: sellerSku,
    app: {
      source: "temu_partner_platform_server_attestation",
      observedAtEpochMs: nowEpochMs - 1_000,
      rowPresent: true,
      appId: "sellerpilot-self-developed",
      state: "active",
      complianceState: "approved",
      rejectionReason: null,
    },
    policy: {
      source: "sellerpilot_compliance_policy_registry",
      cloudProviders: ["Vercel", "Supabase"],
      cloudDataFlowDocumented: true,
      retentionAndDeletionDocumented: true,
      incidentResponseDocumented: true,
      authorizationMode: "manual_access_token",
      authorizationCallbackImplemented: false,
      authorizationCallbackEvidence: null,
      eventWebhookClaimed: false,
      eventWebhookImplemented: false,
    },
    credential: {
      source: "temu_fresh_token_info_attestation",
      observedAtEpochMs: nowEpochMs - 1_000,
      active: true,
      mallId,
      regionId: "211",
      verifiedApiScopes: [...temuReviewAndCreateRequiredApiScopes],
    },
    accountBinding: {
      source: "temu_partner_token_account_mapping_v1",
      observedAtEpochMs: nowEpochMs - 1_000,
      partnerAccountSubject: `temu-account:sha256:${"d".repeat(64)}`,
      tokenIdentitySubject: `temu:sha256:${"e".repeat(64)}`,
      mallId,
      regionId: "211",
      productRevisionFingerprint: fingerprint,
      evidenceSha256: "f".repeat(64),
    },
    product: {
      source: "sellerpilot_exact_product_revision",
      productId,
      ledgerId: "SP-AI-E0AE47DA14",
      sellerSku,
      revisionFingerprint: fingerprint,
      locale: "ko-KR",
      language: "ko",
      localizedTitleVerified: true,
      localizedDescriptionVerified: true,
      localizedBulletPointsVerified: true,
      saleUnitCount: 1,
      innerPackCount: 6,
      inventoryQuantity: 1,
      priceAmount: "3190",
      priceCurrency: "KRW",
      packageWeightGrams: 400,
      packageLengthCm: 28,
      packageWidthCm: 20,
      packageHeightCm: 7,
    },
    category: {
      source: "temu_official_category_compliance_readback",
      mallId,
      productRevisionFingerprint: fingerprint,
      categoryId: "601099",
      leafCategoryVerified: true,
      categoryRecommendationVerified: true,
      categoryAttributesVerified: true,
      categoryComplianceVerified: true,
      certificationDecisionVerified: true,
    },
    assets: {
      source: "sellerpilot_approved_asset_lineage",
      productId,
      productRevisionFingerprint: fingerprint,
      representativeImages,
      detailImages,
    },
    shipping: {
      source: "temu_store_shipping_readback",
      mallId,
      storeDefaultShippingVerified: true,
    },
    egress: {
      source: "sellerpilot_server_egress_attestation",
      observedAtEpochMs: nowEpochMs - 1_000,
      endpointHost: "openapi-b-global.temu.com",
      state: "provider_confirmed_no_allowlist",
    },
    duplicateRead: {
      source: "temu_official_exact_duplicate_read",
      observedAtEpochMs: nowEpochMs - 1_000,
      mallId,
      productRevisionFingerprint: fingerprint,
      externalGoodsId: sellerSku,
      externalSkuId: sellerSku,
      goodsReadComplete: true,
      skuReadComplete: true,
      goodsEmpty: true,
      skuEmpty: true,
      continuationPresent: false,
      existingGoodsRecoveryUsed: false,
    },
  };
}

test("Temu service builder emits the exact r12 binding only from complete current evidence", () => {
  const result = buildTemuReviewAndCreatePrewriteBinding(completeInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.binding?.version, temuReviewAndCreatePrewriteContract);
  assert.equal(result.binding?.publicationFingerprint, fingerprint);
  assert.equal(result.binding?.externalGoodsId, sellerSku);
  assert.equal(result.binding?.app.currentAppState, "active");
  assert.equal(result.binding?.create.productId, productId);
  assert.equal(result.binding?.create.approvedRepresentativeImageCount, 1);
  assert.equal(result.binding?.create.approvedDetailImageCount, 8);
  assert.equal(result.binding?.create.duplicateGoodsReadComplete, true);
  assert.equal(result.binding?.create.duplicateSkuReadComplete, true);
});

test("Temu service builder returns an area-specific blocker and no binding for every missing evidence owner", () => {
  const cases: Array<[
    keyof Pick<TemuCreateReadinessServiceInput,
      "app" | "policy" | "credential" | "accountBinding" | "product" | "category" | "assets" | "shipping" | "egress" | "duplicateRead">,
    string,
  ]> = [
    ["app", "SERVICE_APP_ATTESTATION_REQUIRED"],
    ["policy", "SERVICE_COMPLIANCE_POLICY_REQUIRED"],
    ["credential", "SERVICE_CREDENTIAL_ATTESTATION_REQUIRED"],
    ["accountBinding", "ACCOUNT_SUBJECT_MAPPING_REQUIRED"],
    ["product", "SERVICE_PRODUCT_REVISION_REQUIRED"],
    ["category", "OFFICIAL_CATEGORY_READBACK_REQUIRED"],
    ["assets", "APPROVED_ASSET_LINEAGE_REQUIRED"],
    ["shipping", "STORE_SHIPPING_READBACK_REQUIRED"],
    ["egress", "NETWORK_EGRESS_ATTESTATION_REQUIRED"],
    ["duplicateRead", "EXACT_DUPLICATE_READ_REQUIRED"],
  ];
  for (const [field, expectedCode] of cases) {
    const input = completeInput();
    delete input[field];
    const result = buildTemuReviewAndCreatePrewriteBinding(input);
    assert.equal(result.ok, false, field);
    assert.equal(result.binding, null, field);
    assert.equal(result.blockers.some((blocker) =>
      blocker.code === expectedCode), true, field);
  }
});

test("current empty App Management list is an explicit blocker rather than historical approval", () => {
  const input = completeInput();
  input.app!.rowPresent = false;
  input.app!.appId = null;
  input.app!.state = "unknown";
  input.app!.complianceState = "unknown";
  const result = buildTemuReviewAndCreatePrewriteBinding(input);
  assert.equal(result.ok, false);
  assert.equal(result.binding, null);
  assert.deepEqual(result.blockers
    .filter((blocker) => blocker.area === "app")
    .map((blocker) => blocker.code), [
    "CURRENT_APP_ROW_REQUIRED",
    "ACTIVE_APP_REQUIRED",
    "APP_COMPLIANCE_APPROVAL_REQUIRED",
  ]);
});

test("browser, stale, cross-mall, cross-revision, and recovered-goods evidence never becomes a binding", () => {
  const browserInput = completeInput();
  (browserInput.app as unknown as { source: string }).source = "browser";
  assert.equal(buildTemuReviewAndCreatePrewriteBinding(browserInput)
    .blockers.some((blocker) =>
      blocker.code === "SERVICE_APP_ATTESTATION_REQUIRED"), true);

  const staleInput = completeInput();
  staleInput.credential!.observedAtEpochMs =
    nowEpochMs - temuReadinessEvidenceMaxAgeMs - 1;
  assert.equal(buildTemuReviewAndCreatePrewriteBinding(staleInput)
    .blockers.some((blocker) =>
      blocker.code === "SERVICE_CREDENTIAL_ATTESTATION_REQUIRED"), true);

  const mismatched = completeInput();
  mismatched.category!.mallId = "different-mall";
  mismatched.assets!.productRevisionFingerprint = "b".repeat(64);
  mismatched.duplicateRead!.productRevisionFingerprint = "c".repeat(64);
  const mismatchedResult = buildTemuReviewAndCreatePrewriteBinding(mismatched);
  assert.equal(mismatchedResult.binding, null);
  assert.deepEqual(new Set(mismatchedResult.blockers.map((blocker) =>
    blocker.code)), new Set([
    "CATEGORY_ACCOUNT_OR_REVISION_MISMATCH",
    "APPROVED_ASSET_SET_REQUIRED",
    "DUPLICATE_READ_SCOPE_MISMATCH",
  ]));

  const recovered = completeInput();
  recovered.duplicateRead!.goodsEmpty = false;
  recovered.duplicateRead!.existingGoodsRecoveryUsed = true;
  const recoveredResult = buildTemuReviewAndCreatePrewriteBinding(recovered);
  assert.equal(recoveredResult.binding, null);
  assert.equal(recoveredResult.blockers.some((blocker) =>
    blocker.code === "EXTERNAL_ID_ALREADY_EXISTS"), true);
});

test("malformed assets, shipping, egress, and category compliance stay independently blocked", () => {
  const input = completeInput();
  input.assets!.detailImages = [
    ...detailImages.slice(0, 7),
    representativeImages[0],
  ];
  input.shipping!.storeDefaultShippingVerified = false;
  input.egress!.state = "blocked_until_stable_ip";
  input.category!.categoryComplianceVerified = false;
  input.category!.certificationDecisionVerified = false;
  const result = buildTemuReviewAndCreatePrewriteBinding(input);
  assert.equal(result.binding, null);
  assert.deepEqual(new Set(result.blockers.map((blocker) => blocker.code)),
    new Set([
      "CATEGORY_COMPLIANCE_REQUIRED",
      "APPROVED_ASSET_SET_REQUIRED",
      "STORE_SHIPPING_READBACK_REQUIRED",
      "NETWORK_EGRESS_ATTESTATION_REQUIRED",
    ]));
});

test("invalid server clock, fingerprint, external ID, and numeric account/category identities fail closed", () => {
  const invalidClock = completeInput();
  invalidClock.nowEpochMs = Number.NaN;
  assert.equal(buildTemuReviewAndCreatePrewriteBinding(invalidClock)
    .blockers.some((blocker) => blocker.code === "SERVER_CLOCK_INVALID"),
  true);

  const input = completeInput();
  input.expectedPublicationFingerprint = "not-a-digest";
  input.expectedExternalGoodsId = "";
  input.credential!.mallId = "mall-not-long";
  input.credential!.regionId = "";
  input.category!.categoryId = "leaf-not-long";
  const result = buildTemuReviewAndCreatePrewriteBinding(input);
  assert.equal(result.binding, null);
  assert.equal(result.blockers.some((blocker) =>
    blocker.code === "PRODUCT_REVISION_FINGERPRINT_MISMATCH"), true);
  assert.equal(result.blockers.some((blocker) =>
    blocker.code === "PRODUCT_IDENTITY_MISMATCH"), true);
  assert.equal(result.blockers.some((blocker) =>
    blocker.code === "CREDENTIAL_ACCOUNT_IDENTITY_REQUIRED"), true);
  assert.equal(result.blockers.some((blocker) =>
    blocker.code === "LEAF_CATEGORY_REQUIRED"), true);
});

test("builder validation performs no provider call for success or any blocker", () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("pure builder must not use provider transport");
  };
  try {
    assert.equal(buildTemuReviewAndCreatePrewriteBinding(completeInput()).ok,
      true);
    const blocked = completeInput();
    delete blocked.app;
    delete blocked.credential;
    delete blocked.duplicateRead;
    assert.equal(buildTemuReviewAndCreatePrewriteBinding(blocked).ok, false);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
