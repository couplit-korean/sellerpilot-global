import assert from "node:assert/strict";
import test from "node:test";

import {
  collectTemuAuthoritativeReadinessInput,
  type CollectTemuAuthoritativeReadinessInput,
  type TemuAuthoritativeReadDependencies,
  type TemuOfficialExactDuplicateRead,
} from "../lib/product-registration/temu/authoritative-source-collector";
import {
  buildTemuReviewAndCreatePrewriteBinding,
  temuReadinessEvidenceMaxAgeMs,
} from "../lib/product-registration/temu/create-readiness-builder";
import { temuReviewAndCreateRequiredApiScopes } from "../lib/product-registration/temu/review-and-create-readiness";
import { temuAccountIdentitySubject } from "../lib/product-registration/temu/account-identity";

const nowEpochMs = 1_800_000_000_000;
const observedAtEpochMs = nowEpochMs - 1_000;
const appId = "sellerpilot-self-developed";
const mallId = "608573962731830";
const regionId = "211";
const fingerprint = "a".repeat(64);
const sellerSku = "AUTO-780720401E2D4E4EA45F";
const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const accountSubject = `temu-account:sha256:${"d".repeat(64)}`;
const tokenSubject = temuAccountIdentitySubject({
  contract: "temu_access_token_identity_v1",
  endpointHost: "openapi-b-global.temu.com",
  mallId,
  regionId,
  mallType: 100,
  semiUniqueId: null,
});
const categoryPlanSha256 = "e".repeat(64);

function request(): CollectTemuAuthoritativeReadinessInput {
  return {
    nowEpochMs,
    expectedAppId: appId,
    expectedPublicationFingerprint: fingerprint,
    expectedExternalGoodsId: sellerSku,
    expectedCategoryPlanSha256: categoryPlanSha256,
    accountMapping: {
      source: "temu_partner_token_account_mapping_v1",
      observedAtEpochMs,
      partnerAccountSubject: accountSubject,
      tokenIdentitySubject: tokenSubject,
      mallId,
      regionId,
      productRevisionFingerprint: fingerprint,
      evidenceSha256: "f".repeat(64),
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
    assets: {
      source: "sellerpilot_approved_asset_lineage",
      productId,
      productRevisionFingerprint: fingerprint,
      representativeImages: [
        "https://cdn.example.test/temu/approved/hero.jpg",
      ],
      detailImages: Array.from(
        { length: 8 },
        (_, index) =>
          `https://cdn.example.test/temu/approved/detail-${index + 1}.jpg`,
      ),
    },
  };
}

type FixtureEvidence = {
  app: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readAppRows"]>>;
  token: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readTokenInfo"]>>;
  category: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readLeafCategoryCompliance"]>>;
  shipping: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readStoreShipping"]>>;
  egress: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readGlobalEgressAttestation"]>>;
  goods: TemuOfficialExactDuplicateRead;
  sku: TemuOfficialExactDuplicateRead;
};

function evidence(): FixtureEvidence {
  const duplicate = {
    observedAtEpochMs,
    mallId,
    productRevisionFingerprint: fingerprint,
    externalId: sellerSku,
    items: [],
    total: 0,
    continuationToken: null,
  } as const;
  return {
    app: {
      observedAtEpochMs,
      accountSubject,
      rows: [{
        appId,
        state: "active",
        complianceState: "approved",
        rejectionReason: null,
      }],
    },
    token: {
      observedAtEpochMs,
      active: true,
      mallId,
      regionId,
      subject: tokenSubject,
      apiScopes: [...temuReviewAndCreateRequiredApiScopes],
    },
    category: {
      observedAtEpochMs,
      mallId,
      productRevisionFingerprint: fingerprint,
      categoryId: "601099",
      categoryPlanSha256,
      requestEvidenceSha256: "1".repeat(64),
      responseEvidenceSha256: "2".repeat(64),
      leafCategoryVerified: true,
      categoryRecommendationVerified: true,
      categoryAttributesVerified: true,
      categoryComplianceVerified: true,
      certificationDecisionVerified: true,
    },
    shipping: {
      observedAtEpochMs,
      mallId,
      storeDefaultShippingVerified: true,
    },
    egress: {
      observedAtEpochMs,
      endpointHost: "openapi-b-global.temu.com",
      state: "static_ip_verified",
    },
    goods: { ...duplicate },
    sku: { ...duplicate },
  };
}

function fixture(evidenceValue = evidence()) {
  const effects = {
    reads: [] as string[],
    mutations: 0,
    claims: 0,
    enqueues: 0,
  };
  const dependencies: TemuAuthoritativeReadDependencies = {
    readAppRows: async ({ expectedAppId }) => {
      effects.reads.push("app");
      assert.equal(expectedAppId, appId);
      return evidenceValue.app;
    },
    readTokenInfo: async () => {
      effects.reads.push("token");
      return evidenceValue.token;
    },
    readLeafCategoryCompliance: async (scope) => {
      effects.reads.push("category");
      assert.deepEqual(scope, {
        mallId,
        productRevisionFingerprint: fingerprint,
        externalGoodsId: sellerSku,
      });
      return evidenceValue.category;
    },
    readStoreShipping: async ({ mallId: requestedMall }) => {
      effects.reads.push("shipping");
      assert.equal(requestedMall, mallId);
      return evidenceValue.shipping;
    },
    readGlobalEgressAttestation: async ({ endpointHost }) => {
      effects.reads.push("egress");
      assert.equal(endpointHost, "openapi-b-global.temu.com");
      return evidenceValue.egress;
    },
    readExactGoods: async (scope) => {
      effects.reads.push("goods");
      assert.equal(scope.externalGoodsId, sellerSku);
      return evidenceValue.goods;
    },
    readExactSku: async (scope) => {
      effects.reads.push("sku");
      assert.equal(scope.externalSkuId, sellerSku);
      return evidenceValue.sku;
    },
  };
  return { dependencies, effects };
}

test("authoritative read collector creates a complete r13 input and binding from one exact scope", async () => {
  const state = fixture();
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.ok, true);
  assert.deepEqual(collected.blockers, []);
  assert.equal(collected.serviceInput?.credential?.mallId, mallId);
  assert.equal(collected.serviceInput?.category?.productRevisionFingerprint,
    fingerprint);
  assert.equal(collected.serviceInput?.duplicateRead?.goodsEmpty, true);
  assert.equal(collected.serviceInput?.duplicateRead?.skuEmpty, true);
  assert.deepEqual(state.effects.reads, [
    "app", "token", "category", "shipping", "egress", "goods", "sku",
  ]);
  const built = buildTemuReviewAndCreatePrewriteBinding(
    collected.serviceInput!,
  );
  assert.equal(built.ok, true);
  assert.equal(built.binding?.publicationFingerprint, fingerprint);
  assert.deepEqual([
    state.effects.mutations,
    state.effects.claims,
    state.effects.enqueues,
  ], [0, 0, 0]);
});

test("exact goods and exact SKU reads keep their distinct derived identities", async () => {
  const skuId = `${sellerSku}-01`;
  const evidenceValue = evidence();
  evidenceValue.sku = { ...evidenceValue.sku, externalId: skuId };
  const state = fixture(evidenceValue);
  state.dependencies.readExactSku = async (scope) => {
    state.effects.reads.push("sku");
    assert.equal(scope.externalSkuId, skuId);
    return evidenceValue.sku;
  };
  const exactRequest = request();
  exactRequest.expectedExternalSkuId = skuId;
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: exactRequest, dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.ok, true);
  assert.equal(collected.serviceInput?.duplicateRead?.externalGoodsId, sellerSku);
  assert.equal(collected.serviceInput?.duplicateRead?.externalSkuId, skuId);
});

test("a delayed provider response is current against the post-response collector clock", async () => {
  const requestValue = request();
  const startedAt = Date.now();
  requestValue.nowEpochMs = startedAt;
  requestValue.accountMapping.observedAtEpochMs = startedAt;
  const value = evidence();
  const state = fixture(value);
  state.dependencies.readAppRows = async () => ({
    ...value.app,
    observedAtEpochMs: Date.now(),
  });
  state.dependencies.readTokenInfo = async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { ...value.token, observedAtEpochMs: Date.now() };
  };
  state.dependencies.readLeafCategoryCompliance = async () => ({
    ...value.category,
    observedAtEpochMs: Date.now(),
  });
  state.dependencies.readStoreShipping = async () => ({
    ...value.shipping,
    observedAtEpochMs: Date.now(),
  });
  state.dependencies.readGlobalEgressAttestation = async () => ({
    ...value.egress,
    observedAtEpochMs: Date.now(),
  });
  state.dependencies.readExactGoods = async () => ({
    ...value.goods,
    observedAtEpochMs: Date.now(),
  });
  state.dependencies.readExactSku = async () => ({
    ...value.sku,
    observedAtEpochMs: Date.now(),
  });
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: requestValue,
    dependencies: state.dependencies,
    clock: { nowEpochMs: Date.now },
  });
  assert.equal(collected.ok, true);
  assert.ok((collected.serviceInput?.nowEpochMs ?? 0) >= startedAt + 15);
  assert.equal(collected.blockers.some((blocker) =>
    blocker.code === "TOKEN_INFO_STALE"), false);
});

test("a clock that moves behind the request is rejected before every authoritative read", async () => {
  const state = fixture();
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs - 1 },
  });
  assert.deepEqual(collected.blockers.map((blocker) => blocker.code), [
    "SERVER_INPUT_INVALID",
  ]);
  assert.deepEqual(state.effects.reads, []);
});

test("current Applications zero rows stops after the app read and creates no service input", async () => {
  const evidenceValue = evidence();
  evidenceValue.app.rows = [];
  const state = fixture(evidenceValue);
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.ok, false);
  assert.equal(collected.serviceInput, null);
  assert.deepEqual(collected.blockers.map((blocker) => blocker.code), [
    "CURRENT_APP_ROW_REQUIRED",
  ]);
  assert.deepEqual(state.effects.reads, ["app"]);
  assert.deepEqual([
    state.effects.mutations,
    state.effects.claims,
    state.effects.enqueues,
  ], [0, 0, 0]);
});

test("Inactive or non-approved current app row stops before token and downstream reads", async () => {
  const evidenceValue = evidence();
  evidenceValue.app.rows = [{
    appId,
    state: "inactive",
    complianceState: "rejected",
    rejectionReason: "Cloud service provider is incomplete.",
  }];
  const state = fixture(evidenceValue);
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.deepEqual(collected.blockers.map((blocker) => blocker.code), [
    "APP_ACTIVE_REQUIRED",
    "APP_COMPLIANCE_APPROVAL_REQUIRED",
  ]);
  assert.deepEqual(state.effects.reads, ["app"]);
});

test("Partner subject and token subject mismatches stop at their own trust boundary", async () => {
  const appMismatchEvidence = evidence();
  appMismatchEvidence.app.accountSubject =
    `temu-account:sha256:${"9".repeat(64)}`;
  const appMismatch = fixture(appMismatchEvidence);
  const appResult = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: appMismatch.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.deepEqual(appResult.blockers.map((blocker) => blocker.code), [
    "APP_ACCOUNT_MAPPING_REQUIRED",
  ]);
  assert.deepEqual(appMismatch.effects.reads, ["app"]);

  const tokenMismatchEvidence = evidence();
  tokenMismatchEvidence.token.subject = `temu:sha256:${"9".repeat(64)}`;
  const tokenMismatch = fixture(tokenMismatchEvidence);
  const tokenResult = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: tokenMismatch.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.deepEqual(tokenResult.blockers.map((blocker) => blocker.code), [
    "TOKEN_ACCOUNT_MAPPING_MISMATCH",
  ]);
  assert.deepEqual(tokenMismatch.effects.reads, ["app", "token"]);
});

test("stale or incomplete token info stops before category, shipping, egress, and duplicate reads", async () => {
  const evidenceValue = evidence();
  evidenceValue.token.observedAtEpochMs =
    nowEpochMs - temuReadinessEvidenceMaxAgeMs - 1;
  evidenceValue.token.apiScopes = [];
  const state = fixture(evidenceValue);
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.equal(collected.blockers.some((blocker) =>
    blocker.code === "TOKEN_INFO_STALE"), true);
  assert.equal(collected.blockers.some((blocker) =>
    blocker.code === "TOKEN_SCOPE_INCOMPLETE"), true);
  assert.deepEqual(state.effects.reads, ["app", "token"]);
});

test("incomplete pagination never becomes exact empty duplicate evidence", async () => {
  const evidenceValue = evidence();
  evidenceValue.goods.continuationToken = "next";
  evidenceValue.sku.total = null;
  const state = fixture(evidenceValue);
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.equal(collected.blockers.some((blocker) =>
    blocker.code === "DUPLICATE_READ_INCOMPLETE"), true);
  assert.deepEqual([
    state.effects.mutations,
    state.effects.claims,
    state.effects.enqueues,
  ], [0, 0, 0]);
});

test("stale and cross-mall or cross-revision downstream reads remain separate blockers", async () => {
  const evidenceValue = evidence();
  evidenceValue.category.observedAtEpochMs =
    nowEpochMs - temuReadinessEvidenceMaxAgeMs - 1;
  evidenceValue.category.mallId = "different-mall";
  evidenceValue.category.productRevisionFingerprint = "b".repeat(64);
  evidenceValue.shipping.mallId = "different-mall";
  evidenceValue.egress.observedAtEpochMs =
    nowEpochMs - temuReadinessEvidenceMaxAgeMs - 1;
  evidenceValue.goods.mallId = "different-mall";
  evidenceValue.sku.productRevisionFingerprint = "c".repeat(64);
  const state = fixture(evidenceValue);
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  const codes = new Set(collected.blockers.map((blocker) => blocker.code));
  assert.equal(codes.has("CATEGORY_READ_STALE"), true);
  assert.equal(codes.has("CATEGORY_SCOPE_MISMATCH"), true);
  assert.equal(codes.has("SHIPPING_SCOPE_MISMATCH"), true);
  assert.equal(codes.has("EGRESS_READ_STALE"), true);
  assert.equal(codes.has("DUPLICATE_READ_SCOPE_MISMATCH"), true);
});

test("a duplicate collision is not converted into current-product recovery", async () => {
  const evidenceValue = evidence();
  evidenceValue.sku.items = [{ goodsId: "qa-goods" }];
  evidenceValue.sku.total = 1;
  const state = fixture(evidenceValue);
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.equal(collected.blockers.some((blocker) =>
    blocker.code === "EXTERNAL_ID_ALREADY_EXISTS"), true);
});

test("rejected official dependencies return bounded read blockers and no service input", async () => {
  const state = fixture();
  state.dependencies.readLeafCategoryCompliance = async () => {
    throw new Error("category unavailable");
  };
  state.dependencies.readStoreShipping = async () => {
    throw new Error("shipping unavailable");
  };
  state.dependencies.readGlobalEgressAttestation = async () => {
    throw new Error("egress unavailable");
  };
  state.dependencies.readExactGoods = async () => {
    throw new Error("goods unavailable");
  };
  state.dependencies.readExactSku = async () => {
    throw new Error("sku unavailable");
  };
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: request(),
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.deepEqual(new Set(collected.blockers.map((blocker) => blocker.code)),
    new Set([
      "CATEGORY_READ_FAILED",
      "SHIPPING_READ_FAILED",
      "EGRESS_READ_FAILED",
      "GOODS_DUPLICATE_READ_FAILED",
      "SKU_DUPLICATE_READ_FAILED",
    ]));
  assert.deepEqual([
    state.effects.mutations,
    state.effects.claims,
    state.effects.enqueues,
  ], [0, 0, 0]);
});

test("invalid local server scope performs zero official reads", async () => {
  const state = fixture();
  const invalid = request();
  invalid.expectedPublicationFingerprint = "client-marker";
  invalid.product!.sellerSku = "other-product";
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: invalid,
    dependencies: state.dependencies,
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.deepEqual(new Set(collected.blockers.map((blocker) => blocker.code)),
    new Set(["SERVER_INPUT_INVALID", "PRODUCT_REVISION_INVALID"]));
  assert.deepEqual(state.effects.reads, []);
});
