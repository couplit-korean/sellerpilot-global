import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectTemuReviewAndCreateReadiness,
  temuReviewAndCreateRequiredApiScopes,
  type TemuAppReviewEvidence,
  type TemuCreateEvidence,
} from "../lib/product-registration/temu/review-and-create-readiness";

function completeApp(overrides: Partial<TemuAppReviewEvidence> = {}): TemuAppReviewEvidence {
  return {
    currentAppState: "active",
    currentComplianceState: "approved",
    rejectionReason: null,
    cloudProviders: ["Vercel", "Supabase"],
    cloudDataFlowDocumented: true,
    retentionAndDeletionDocumented: true,
    incidentResponseDocumented: true,
    authorizationMode: "manual_access_token",
    authorizationCallbackImplemented: false,
    authorizationCallbackEvidence: null,
    eventWebhookClaimed: false,
    eventWebhookImplemented: false,
    ...overrides,
  };
}

function completeCreate(overrides: Partial<TemuCreateEvidence> = {}): TemuCreateEvidence {
  return {
    operatingCredentialPresent: true,
    verifiedApiScopes: [...temuReviewAndCreateRequiredApiScopes],
    networkEgress: "static_ip_verified",
    productId: "1ed4acfc-7603-48ec-a638-241131e59358",
    ledgerId: "SP-AI-E0AE47DA14",
    sellerSku: "AUTO-780720401E2D4E4EA45F",
    locale: "ko-KR",
    language: "ko",
    localizedTitleVerified: true,
    localizedDescriptionVerified: true,
    localizedBulletPointsVerified: true,
    categoryId: "601099",
    categoryRecommendationVerified: true,
    categoryAttributesVerified: true,
    categoryComplianceVerified: true,
    certificationDecisionVerified: true,
    saleUnitCount: 1,
    innerPackCount: 6,
    inventoryQuantity: 1,
    priceAmount: "3190",
    priceCurrency: "KRW",
    packageWeightGrams: 400,
    packageLengthCm: 28,
    packageWidthCm: 20,
    packageHeightCm: 7,
    approvedRepresentativeImageCount: 1,
    approvedDetailImageCount: 8,
    storeDefaultShippingVerified: true,
    duplicateGoodsReadComplete: true,
    duplicateSkuReadComplete: true,
    ...overrides,
  };
}

test("current audited Temu evidence stays blocked without inventing review or CREATE readiness", () => {
  const result = inspectTemuReviewAndCreateReadiness({
    app: completeApp({
      currentAppState: "unknown",
      currentComplianceState: "unknown",
      rejectionReason: null,
      retentionAndDeletionDocumented: false,
      incidentResponseDocumented: false,
    }),
    create: completeCreate({
      operatingCredentialPresent: false,
      verifiedApiScopes: [],
      networkEgress: "blocked_until_stable_ip",
      categoryId: null,
      categoryRecommendationVerified: false,
      categoryAttributesVerified: false,
      categoryComplianceVerified: false,
      certificationDecisionVerified: false,
      approvedRepresentativeImageCount: 0,
      approvedDetailImageCount: 0,
      storeDefaultShippingVerified: false,
      duplicateGoodsReadComplete: false,
      duplicateSkuReadComplete: false,
    }),
  });
  assert.equal(result.appSubmissionPrepared, false);
  assert.equal(result.createPrewriteReady, false);
  assert.deepEqual(result.appIssues.map((issue) => issue.code), [
    "CURRENT_APP_STATE_UNVERIFIED",
    "DATA_RETENTION_UNVERIFIED",
    "INCIDENT_RESPONSE_UNVERIFIED",
  ]);
  assert.deepEqual(result.createIssues.map((issue) => issue.code), [
    "OPERATING_CREDENTIAL_MISSING",
    "API_SCOPE_UNVERIFIED",
    "NETWORK_EGRESS_UNVERIFIED",
    "CATEGORY_UNVERIFIED",
    "CATEGORY_ATTRIBUTES_UNVERIFIED",
    "CATEGORY_COMPLIANCE_UNVERIFIED",
    "APPROVED_REPRESENTATIVE_IMAGE_REQUIRED",
    "APPROVED_DETAIL_IMAGES_REQUIRED",
    "STORE_DEFAULT_SHIPPING_UNVERIFIED",
    "DUPLICATE_READ_UNVERIFIED",
  ]);
});

test("Rejected state requires the actual rejection reason before a resubmission draft is ready", () => {
  const result = inspectTemuReviewAndCreateReadiness({
    app: completeApp({ currentAppState: "inactive", currentComplianceState: "rejected" }),
    create: completeCreate(),
  });
  assert.equal(result.appSubmissionPrepared, false);
  assert.equal(result.appIssues[0]?.code, "COMPLIANCE_REJECTION_REASON_UNVERIFIED");
});

test("manual authorization and no webhook do not claim unimplemented callback security", () => {
  const result = inspectTemuReviewAndCreateReadiness({ app: completeApp(), create: completeCreate() });
  assert.equal(result.authorizationContract, "no_callback_claimed");
  assert.equal(result.webhookContract, "no_webhook_claimed");
  assert.equal(result.appSubmissionPrepared, true);
  assert.equal(result.createPrewriteReady, true);
});

test("callback or webhook claims require matching deployed evidence", () => {
  const result = inspectTemuReviewAndCreateReadiness({
    app: completeApp({
      authorizationMode: "authorization_callback",
      authorizationCallbackImplemented: false,
      eventWebhookClaimed: true,
      eventWebhookImplemented: false,
    }),
    create: completeCreate(),
  });
  assert.deepEqual(result.appIssues.map((issue) => issue.code), [
    "AUTHORIZATION_CALLBACK_UNVERIFIED",
    "WEBHOOK_CLAIM_CONTRADICTS_IMPLEMENTATION",
  ]);
});

test("stored image counts never substitute for the approved one-plus-eight contract", () => {
  const result = inspectTemuReviewAndCreateReadiness({
    app: completeApp(),
    create: completeCreate({
      approvedRepresentativeImageCount: 2,
      approvedDetailImageCount: 12,
    }),
  });
  assert.deepEqual(result.createIssues.map((issue) => issue.code), [
    "APPROVED_REPRESENTATIVE_IMAGE_REQUIRED",
    "APPROVED_DETAIL_IMAGES_REQUIRED",
  ]);
});

test("the six inner packs cannot become six sale units or six inventory units", () => {
  for (const override of [
    { saleUnitCount: 6 },
    { inventoryQuantity: 6 },
    { innerPackCount: 1 },
  ]) {
    const result = inspectTemuReviewAndCreateReadiness({
      app: completeApp(),
      create: completeCreate(override),
    });
    assert.equal(result.createIssues.some((issue) => issue.code === "SALE_UNIT_MISMATCH"), true);
    assert.equal(result.createPrewriteReady, false);
  }
});

test("missing a single preparation scope keeps the candidate blocked before provider write", () => {
  const missing = "bg.local.goods.compliance.rules.get";
  const result = inspectTemuReviewAndCreateReadiness({
    app: completeApp(),
    create: completeCreate({
      verifiedApiScopes: temuReviewAndCreateRequiredApiScopes.filter((scope) => scope !== missing),
    }),
  });
  assert.deepEqual(result.missingScopes, [missing]);
  assert.equal(result.createIssues[0]?.code, "API_SCOPE_UNVERIFIED");
  assert.equal(result.createPrewriteReady, false);
});
