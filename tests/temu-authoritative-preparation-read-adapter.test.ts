import assert from "node:assert/strict";
import test from "node:test";

import {
  runWithProviderReadOnlyTransport,
  temuRequest,
  type RemoteResponse,
} from "../lib/channels/protocols";
import {
  createTemuAuthoritativePreparationReadAdapter,
  temuCategoryPreparationPlanSha256,
  TemuAuthoritativePreparationError,
  type TemuCategoryPreparationPlan,
  type TemuPartnerAppServiceSnapshot,
  type TemuPreparationReadMethod,
  type TemuSellerShippingServiceSnapshot,
} from "../lib/product-registration/temu/authoritative-preparation-read-adapter";
import {
  collectTemuAuthoritativeReadinessInput,
  type CollectTemuAuthoritativeReadinessInput,
  type TemuAuthoritativeReadDependencies,
} from "../lib/product-registration/temu/authoritative-source-collector";
import { createTemuAuthoritativeProviderReadAdapter } from "../lib/product-registration/temu/authoritative-provider-read-adapter";
import { temuReviewAndCreateRequiredApiScopes } from "../lib/product-registration/temu/review-and-create-readiness";
import { temuAccountIdentitySubject } from "../lib/product-registration/temu/account-identity";

const nowEpochMs = 1_800_000_000_000;
const observedAtEpochMs = nowEpochMs - 1_000;
const appId = "sellerpilot-self-developed";
const accountSubject = `temu-account:sha256:${"a".repeat(64)}`;
const mallId = "608573962731830";
const regionId = "211";
const fingerprint = "c".repeat(64);
const externalId = "AUTO-780720401E2D4E4EA45F";
const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const categoryId = "601099";
const parentCategoryId = "601000";
const defaultTemplateId = "TEMU-KR-DEFAULT-1";
const tokenSubject = temuAccountIdentitySubject({
  contract: "temu_access_token_identity_v1",
  endpointHost: "openapi-b-global.temu.com",
  mallId,
  regionId,
  mallType: 100,
  semiUniqueId: null,
});

const r16Methods = new Set<TemuPreparationReadMethod>([
  "bg.local.goods.category.recommend",
  "bg.local.goods.cats.get",
  "bg.local.goods.property.get",
  "bg.local.goods.size.element.get",
  "bg.local.goods.template.get",
  "bg.local.goods.compliance.rules.get",
  "bg.local.goods.compliance.extra.template.get",
  "bg.local.goods.compliance.property.check",
  "bg.freight.template.list.query",
]);
const allReadMethods = new Set<string>([
  ...r16Methods,
  "bg.open.accesstoken.info.get",
  "temu.local.goods.list.retrieve",
]);

function payload() {
  return {
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "fixture-token",
    temu_account_identity_contract: "temu_access_token_identity_v1",
    temu_account_identity_endpoint_host: "openapi-b-global.temu.com",
    temu_account_identity_mall_id: mallId,
    temu_account_identity_region_id: regionId,
    temu_account_identity_mall_type: "100",
  };
}

function categoryPlan(): TemuCategoryPreparationPlan {
  return {
    categoryId,
    parentCategoryId,
    language: "ko",
    goodsName: "한국어로 검증된 테무 등록 상품",
    goodsDescription: "상품의 구성과 사용 방법을 한국어로 설명합니다.",
    goodsProperties: [{ propName: "Material", values: ["ABS"] }],
    normalProperties: [{ pid: 10, vid: 20, refPid: 10, value: "ABS" }],
    selectedSpecIds: [],
    resolvedSizeElementIds: [],
  };
}

function createBody() {
  return {
    language: "ko",
    goodsBasic: {
      externalGoodsId: externalId,
      goodsName: "한국어로 검증된 테무 등록 상품",
      extCatName: "Home & Kitchen / Storage / Cable Management",
      goodsDesc: "상품의 구성과 사용 방법을 한국어로 설명합니다.",
      bulletPoints: ["검증된 구성 정보를 안내합니다."],
      goodsCarouselImage: ["https://cdn.example.test/temu/hero.jpg"],
      detailImage: Array.from(
        { length: 8 },
        (_, index) => `https://cdn.example.test/temu/detail-${index + 1}.jpg`,
      ),
    },
    attributes: [{ name: "Material", value: ["ABS"] }],
    skuList: [{
      images: ["https://cdn.example.test/temu/hero.jpg"],
      packageInfo: { weight: "400", length: "28", width: "20", height: "7" },
      variations: [{ name: "판매 구성", value: "6봉" }],
      externalSkuId: externalId,
      price: { basePrice: { amount: "3190", currency: "KRW" } },
      quantity: 1,
    }],
  };
}

function appSnapshot(
  state: "active" | "inactive" = "active",
  complianceState: "approved" | "reviewing" = "approved",
): TemuPartnerAppServiceSnapshot {
  return {
    source: "temu_authenticated_partner_app_management_v1",
    accountSubject,
    observedAtEpochMs,
    rows: [{
      appId,
      state,
      complianceState,
      rejectionReason: null,
    }],
  };
}

function shippingSnapshot(): TemuSellerShippingServiceSnapshot {
  return {
    source: "temu_authenticated_seller_center_shipping_v1",
    accountSubject,
    observedAtEpochMs,
    mallId,
    defaultTemplateId,
    warehouseVerified: true,
    feeRuleVerified: true,
    returnPolicyVerified: true,
  };
}

function tokenData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      mallId,
      regionId,
      mallType: 100,
      expiredTime: "4102444800",
      apiScopeList: [...temuReviewAndCreateRequiredApiScopes],
      ...overrides,
    },
  };
}

function officialData(
  type: string,
  overrides: Partial<Record<string, Record<string, unknown>>> = {},
) {
  const resultByType: Record<string, Record<string, unknown>> = {
    "bg.local.goods.category.recommend": { catId: categoryId },
    "bg.local.goods.cats.get": {
      goodsCatsList: [{
        catId: Number(categoryId),
        parentId: Number(parentCategoryId),
        leaf: true,
        availableStatus: 1,
      }],
    },
    "bg.local.goods.property.get": {
      goodsPropertyList: [{ pid: 10, vid: 20, refPid: 10, value: "ABS" }],
    },
    "bg.local.goods.size.element.get": {
      sizeSpecElementRule: {
        catId: Number(categoryId),
        sizeSpecElementList: [],
        setElementList: [],
      },
    },
    "bg.local.goods.template.get": {
      templateInfo: {
        templateId: 9001,
        goodsProperties: [{ required: true, refPid: 10 }],
        goodsSpecProperties: [],
      },
    },
    "bg.local.goods.compliance.rules.get": {
      goodsCertList: [],
      checkInfoList: [],
      actualPhotoRequirement: [],
      mustHaveActualPhoto: false,
    },
    "bg.local.goods.compliance.extra.template.get": {
      extraComplianceInfoList: [],
      extraTemplateList: [],
      guideFileRequirement: { isRequired: false },
    },
    "bg.local.goods.compliance.property.check": { isMatch: true },
    "bg.freight.template.list.query": {
      templateList: [{
        templateId: defaultTemplateId,
        templateName: "Current store default",
      }],
    },
    "temu.local.goods.list.retrieve": { goodsList: [], total: 0 },
  };
  return {
    success: true,
    result: overrides[type] ?? resultByType[type] ?? {},
  };
}

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  const text = JSON.stringify(data);
  return {
    response: new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    }),
    data,
    text,
  };
}

function collectorRequest(): CollectTemuAuthoritativeReadinessInput {
  const categoryPlanSha256 = temuCategoryPreparationPlanSha256(categoryPlan());
  return {
    nowEpochMs,
    expectedAppId: appId,
    expectedPublicationFingerprint: fingerprint,
    expectedExternalGoodsId: externalId,
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
      sellerSku: externalId,
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
      representativeImages: ["https://cdn.example.test/temu/approved/hero.jpg"],
      detailImages: Array.from(
        { length: 8 },
        (_, index) => `https://cdn.example.test/temu/approved/detail-${index + 1}.jpg`,
      ),
    },
  };
}

type Effects = {
  providerTypes: string[];
  appSnapshots: number;
  shippingSnapshots: number;
  mutations: number;
  claims: number;
  enqueues: number;
};

function effects(): Effects {
  return {
    providerTypes: [],
    appSnapshots: 0,
    shippingSnapshots: 0,
    mutations: 0,
    claims: 0,
    enqueues: 0,
  };
}

function assertZeroWrites(state: Effects) {
  assert.deepEqual([
    state.mutations,
    state.claims,
    state.enqueues,
  ], [0, 0, 0]);
}

function harness(input: {
  app?: TemuPartnerAppServiceSnapshot | null;
  shipping?: TemuSellerShippingServiceSnapshot | null;
  category?: TemuCategoryPreparationPlan;
  response?: (type: string) => RemoteResponse;
} = {}) {
  const state = effects();
  const clock = { nowEpochMs: () => nowEpochMs };
  const request = async ({ type }: { type: string }) => {
    state.providerTypes.push(type);
    if (!allReadMethods.has(type)) state.mutations += 1;
    if (input.response) return input.response(type);
    if (type === "bg.open.accesstoken.info.get") {
      return remote(tokenData());
    }
    return remote(officialData(type));
  };
  const selectedCategory = input.category ?? categoryPlan();
  const preparation = createTemuAuthoritativePreparationReadAdapter({
    payload: payload(),
    expectedAccountSubject: accountSubject,
    expectedMallId: mallId,
    expectedRegionId: regionId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
    category: selectedCategory,
    categoryBinding: {
      source: "sellerpilot_exact_product_revision_category_plan_v1",
      productRevisionFingerprint: fingerprint,
      categoryPlanSha256:
        temuCategoryPreparationPlanSha256(selectedCategory),
    },
    readCurrentAppSnapshot: async () => {
      state.appSnapshots += 1;
      return input.app === undefined ? appSnapshot() : input.app;
    },
    readCurrentShippingSnapshot: async () => {
      state.shippingSnapshots += 1;
      return input.shipping === undefined
        ? shippingSnapshot()
        : input.shipping;
    },
    request,
    clock,
  });
  const provider = createTemuAuthoritativeProviderReadAdapter({
    payload: payload(),
    expectedMallId: mallId,
    expectedRegionId: regionId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
    externalSkuId: externalId,
    createBody: createBody(),
    request,
    clock,
  });
  const dependencies: TemuAuthoritativeReadDependencies = {
    ...preparation,
    ...provider,
    readGlobalEgressAttestation: async () => ({
      observedAtEpochMs,
      endpointHost: "openapi-b-global.temu.com",
      state: "provider_confirmed_no_allowlist",
    }),
  };
  return { state, preparation, dependencies, clock };
}

test("current Inactive and Compliance Reviewing app stops before every provider read", async () => {
  const state = harness({ app: appSnapshot("inactive", "reviewing") });
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: collectorRequest(),
    dependencies: state.dependencies,
    clock: state.clock,
  });
  assert.equal(collected.serviceInput, null);
  assert.deepEqual(collected.blockers.map((blocker) => blocker.code), [
    "APP_ACTIVE_REQUIRED",
    "APP_COMPLIANCE_APPROVAL_REQUIRED",
  ]);
  assert.equal(state.state.appSnapshots, 1);
  assert.equal(state.state.shippingSnapshots, 0);
  assert.deepEqual(state.state.providerTypes, []);
  assertZeroWrites(state.state);
});

test("Applications zero rows remains CURRENT_APP_ROW_REQUIRED with no invented app", async () => {
  const snapshot = appSnapshot();
  snapshot.rows = [];
  const state = harness({ app: snapshot });
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: collectorRequest(),
    dependencies: state.dependencies,
    clock: state.clock,
  });
  assert.equal(collected.serviceInput, null);
  assert.deepEqual(collected.blockers.map((blocker) => blocker.code), [
    "CURRENT_APP_ROW_REQUIRED",
  ]);
  assert.deepEqual(state.state.providerTypes, []);
  assertZeroWrites(state.state);
});

test("missing authoritative app snapshot becomes APP_READ_FAILED before provider access", async () => {
  const state = harness({ app: null });
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: collectorRequest(),
    dependencies: state.dependencies,
    clock: state.clock,
  });
  assert.equal(collected.serviceInput, null);
  assert.deepEqual(collected.blockers.map((blocker) => blocker.code), [
    "APP_READ_FAILED",
  ]);
  assert.deepEqual(state.state.providerTypes, []);
  assertZeroWrites(state.state);
});

test("r16 preparation reads combine with r15 token and duplicate reads in r14", async () => {
  const state = harness();
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: collectorRequest(),
    dependencies: state.dependencies,
    clock: state.clock,
  });
  assert.equal(collected.ok, true);
  assert.equal(collected.serviceInput?.category?.categoryId, categoryId);
  assert.equal(collected.serviceInput?.shipping?.storeDefaultShippingVerified,
    true);
  assert.equal(collected.serviceInput?.duplicateRead?.goodsEmpty, true);
  assert.equal(collected.serviceInput?.duplicateRead?.skuEmpty, true);
  assert.equal(state.state.appSnapshots, 1);
  assert.equal(state.state.shippingSnapshots, 1);
  assert.equal(state.state.providerTypes.length, 12);
  assert.equal(state.state.providerTypes.every((type) =>
    allReadMethods.has(type)), true);
  assert.equal(state.state.providerTypes.includes("bg.local.goods.spec.id.get"),
    false);
  assertZeroWrites(state.state);
});

test("shipping template list alone cannot prove the Seller Center default", async () => {
  const state = harness({ shipping: null });
  await assert.rejects(state.preparation.readStoreShipping({ mallId }),
    (error: unknown) =>
      error instanceof TemuAuthoritativePreparationError
      && error.code === "TEMU_AUTHORITATIVE_SHIPPING_SOURCE_UNAVAILABLE");
  assert.equal(state.state.shippingSnapshots, 1);
  assert.deepEqual(state.state.providerTypes, []);
  assertZeroWrites(state.state);
});

test("a Seller Center default must match the official template list and policy snapshot", async () => {
  const mismatched = shippingSnapshot();
  mismatched.defaultTemplateId = "OTHER-TEMPLATE";
  const state = harness({ shipping: mismatched });
  const result = await state.preparation.readStoreShipping({ mallId });
  assert.equal(result.storeDefaultShippingVerified, false);
  assert.deepEqual(state.state.providerTypes, [
    "bg.freight.template.list.query",
  ]);
  assertZeroWrites(state.state);
});

test("malformed official category response fails closed without raw provider output", async () => {
  const state = harness({
    response: (type) => type === "bg.local.goods.template.get"
      ? remote({ success: true, result: null as unknown as Record<string, unknown> })
      : remote(officialData(type)),
  });
  await assert.rejects(state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  }), (error: unknown) =>
    error instanceof TemuAuthoritativePreparationError
      && error.code === "TEMU_AUTHORITATIVE_PREPARATION_RESPONSE_INVALID");
  assert.equal(state.state.providerTypes.length, 8);
  assertZeroWrites(state.state);
});

test("required certification or extra compliance never becomes a verified exemption", async () => {
  const state = harness({
    response: (type) => {
      if (type === "bg.local.goods.compliance.rules.get") {
        return remote(officialData(type, {
          [type]: {
            goodsCertList: [{ certType: 1, isRequired: true }],
            checkInfoList: [],
            actualPhotoRequirement: [],
            mustHaveActualPhoto: false,
          },
        }));
      }
      return remote(officialData(type));
    },
  });
  const result = await state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.categoryComplianceVerified, false);
  assert.equal(result.certificationDecisionVerified, false);
  assertZeroWrites(state.state);
});

test("a malformed optional certification row cannot produce approved compliance", async () => {
  const state = harness({
    response: (type) => type === "bg.local.goods.compliance.rules.get"
      ? remote(officialData(type, {
        [type]: {
          goodsCertList: [{ isRequired: false }],
          checkInfoList: [],
          actualPhotoRequirement: [],
          mustHaveActualPhoto: false,
        },
      }))
      : remote(officialData(type)),
  });
  const result = await state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.categoryComplianceVerified, false);
  assert.equal(result.certificationDecisionVerified, false);
  assertZeroWrites(state.state);
});

test("unresolved custom specification stays blocked and generation API is never called", async () => {
  const plan = categoryPlan();
  plan.selectedSpecIds = [];
  const state = harness({
    category: plan,
    response: (type) => {
      if (type === "bg.local.goods.template.get") {
        return remote(officialData(type, {
          [type]: {
            templateInfo: {
              templateId: 9001,
              goodsProperties: [{ required: true, refPid: 10 }],
              goodsSpecProperties: [{
                required: true,
                values: [{ specId: 777 }],
              }],
            },
          },
        }));
      }
      return remote(officialData(type));
    },
  });
  const result = await state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.categoryAttributesVerified, false);
  assert.equal(state.state.providerTypes.includes("bg.local.goods.spec.id.get"),
    false);
  assertZeroWrites(state.state);
});

test("401, 403, and timeout category reads return bounded failures and no writes", async () => {
  for (const failure of [401, 403, "timeout"] as const) {
    const state = harness({
      response: () => {
        if (failure === "timeout") {
          throw new DOMException("private timeout", "AbortError");
        }
        return remote({
          success: false,
          errorMsg: `private provider ${failure}`,
        }, failure);
      },
    });
    await assert.rejects(state.preparation.readLeafCategoryCompliance({
      mallId,
      productRevisionFingerprint: fingerprint,
      externalGoodsId: externalId,
    }), (error: unknown) => {
      if (!(error instanceof TemuAuthoritativePreparationError)) return false;
      assert.equal(error.message.includes("private"), false);
      return error.code === (failure === "timeout"
        ? "TEMU_AUTHORITATIVE_PREPARATION_TRANSPORT_FAILED"
        : "TEMU_AUTHORITATIVE_PREPARATION_AUTHORIZATION_REJECTED");
    });
    assertZeroWrites(state.state);
  }
});

test("cross-mall or cross-revision category scope stops before service and provider reads", async () => {
  const state = harness();
  for (const scope of [
    { mallId: "999", productRevisionFingerprint: fingerprint, externalGoodsId: externalId },
    { mallId, productRevisionFingerprint: "d".repeat(64), externalGoodsId: externalId },
  ]) {
    await assert.rejects(state.preparation.readLeafCategoryCompliance(scope),
      (error: unknown) =>
        error instanceof TemuAuthoritativePreparationError
        && error.code === "TEMU_AUTHORITATIVE_PREPARATION_SCOPE_MISMATCH");
  }
  assert.equal(state.state.appSnapshots, 0);
  assert.equal(state.state.shippingSnapshots, 0);
  assert.deepEqual(state.state.providerTypes, []);
  assertZeroWrites(state.state);
});

test("missing required flags, malformed size groups, and unrelated properties fail closed together", async () => {
  const state = harness({
    response: (type) => {
      if (type === "bg.local.goods.property.get") {
        return remote(officialData(type, {
          [type]: {
            goodsPropertyList: [{
              pid: 999,
              vid: 998,
              refPid: 997,
              value: "unrelated",
            }],
          },
        }));
      }
      if (type === "bg.local.goods.size.element.get") {
        return remote(officialData(type, {
          [type]: {
            sizeSpecElementRule: {
              catId: Number(categoryId),
              sizeSpecElementList: [],
              setElementList: [{}],
            },
          },
        }));
      }
      if (type === "bg.local.goods.template.get") {
        return remote(officialData(type, {
          [type]: {
            templateInfo: {
              goodsProperties: [{ refPid: 10 }],
              goodsSpecProperties: [],
            },
          },
        }));
      }
      return remote(officialData(type));
    },
  });
  const result = await state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.categoryAttributesVerified, false);
  assert.equal(state.state.providerTypes.length, 8);
  assertZeroWrites(state.state);
});

test("a selected property plus an unrelated provider property fails exact correspondence", async () => {
  const state = harness({
    response: (type) => type === "bg.local.goods.property.get"
      ? remote(officialData(type, {
        [type]: {
          goodsPropertyList: [
            { pid: 10, vid: 20, refPid: 10, value: "ABS" },
            { pid: 999, vid: 998, refPid: 997, value: "unrelated" },
          ],
        },
      }))
      : remote(officialData(type)),
  });
  const result = await state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.categoryAttributesVerified, false);
  assert.equal(state.state.providerTypes.length, 8);
  assertZeroWrites(state.state);
});

test("an exact leaf plus a malformed unrelated category row cannot verify the category", async () => {
  const state = harness({
    response: (type) => type === "bg.local.goods.cats.get"
      ? remote(officialData(type, {
        [type]: {
          goodsCatsList: [
            {
              catId: Number(categoryId),
              parentId: Number(parentCategoryId),
              leaf: true,
              availableStatus: 1,
            },
            {},
          ],
        },
      }))
      : remote(officialData(type)),
  });
  const result = await state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.leafCategoryVerified, false);
  assertZeroWrites(state.state);
});

test("a malformed optional specification row cannot verify category attributes", async () => {
  const state = harness({
    response: (type) => type === "bg.local.goods.template.get"
      ? remote(officialData(type, {
        [type]: {
          templateInfo: {
            templateId: 9001,
            goodsProperties: [{ required: true, refPid: 10 }],
            goodsSpecProperties: [{ required: false, values: [null] }],
          },
        },
      }))
      : remote(officialData(type)),
  });
  const result = await state.preparation.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.categoryAttributesVerified, false);
  assertZeroWrites(state.state);
});

test("a valid default plus a malformed unrelated freight row cannot verify shipping", async () => {
  const state = harness({
    response: (type) => type === "bg.freight.template.list.query"
      ? remote(officialData(type, {
        [type]: {
          templateList: [
            {
              templateId: defaultTemplateId,
              templateName: "Current store default",
            },
            { templateId: "UNRELATED" },
          ],
        },
      }))
      : remote(officialData(type)),
  });
  const result = await state.preparation.readStoreShipping({ mallId });
  assert.equal(result.storeDefaultShippingVerified, false);
  assertZeroWrites(state.state);
});

test("category plan binding rejects cross-revision input and snapshots nested plan values against TOCTOU", async () => {
  const plan = categoryPlan();
  const binding = {
    source: "sellerpilot_exact_product_revision_category_plan_v1" as const,
    productRevisionFingerprint: fingerprint,
    categoryPlanSha256: temuCategoryPreparationPlanSha256(plan),
  };
  assert.throws(() => createTemuAuthoritativePreparationReadAdapter({
    payload: payload(),
    expectedAccountSubject: accountSubject,
    expectedMallId: mallId,
    expectedRegionId: regionId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
    category: plan,
    categoryBinding: {
      ...binding,
      productRevisionFingerprint: "9".repeat(64),
    },
    readCurrentAppSnapshot: async () => appSnapshot(),
    readCurrentShippingSnapshot: async () => shippingSnapshot(),
    clock: { nowEpochMs: () => observedAtEpochMs },
  }), /TEMU_AUTHORITATIVE_PREPARATION_CONFIGURATION_INVALID/u);

  const calls: Array<{ type: string; arguments?: Record<string, unknown> }> = [];
  const adapter = createTemuAuthoritativePreparationReadAdapter({
    payload: payload(),
    expectedAccountSubject: accountSubject,
    expectedMallId: mallId,
    expectedRegionId: regionId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
    category: plan,
    categoryBinding: binding,
    readCurrentAppSnapshot: async () => appSnapshot(),
    readCurrentShippingSnapshot: async () => shippingSnapshot(),
    request: async (request) => {
      calls.push({ type: request.type, arguments: request.arguments });
      return remote(officialData(request.type));
    },
    clock: { nowEpochMs: () => observedAtEpochMs },
  });
  plan.categoryId = "999999";
  (plan.goodsProperties[0]!.values as string[])[0] = "mutated";
  plan.normalProperties[0]!.pid = 999;
  const result = await adapter.readLeafCategoryCompliance({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  assert.equal(result.categoryId, categoryId);
  assert.equal(result.categoryPlanSha256, binding.categoryPlanSha256);
  const propertyCall = calls.find((call) =>
    call.type === "bg.local.goods.property.get");
  assert.equal(propertyCall?.arguments?.catId, Number(categoryId));
  assert.deepEqual(propertyCall?.arguments?.goodsPropList, [{
    propName: "Material",
    values: ["ABS"],
  }]);
});

test("app rows are rebuilt from known fields and strip raw payload, email, and token extras", async () => {
  const snapshot = appSnapshot();
  snapshot.rows = [{
    ...snapshot.rows[0]!,
    rawPayload: { secret: "must-strip" },
    email: "must-strip@example.test",
    accessToken: "must-strip",
  } as unknown as TemuPartnerAppServiceSnapshot["rows"][number]];
  const state = harness({ app: snapshot });
  const result = await state.preparation.readAppRows({ expectedAppId: appId });
  assert.deepEqual(result.rows, [{
    appId,
    state: "active",
    complianceState: "approved",
    rejectionReason: null,
  }]);
  assert.equal(result.accountSubject, accountSubject);
  assert.doesNotMatch(JSON.stringify(result), /must-strip|rawPayload|email|token/iu);
});

test("all preparation methods pass the actual shared read-only transport while a mutation is rejected", async () => {
  const originalFetch = globalThis.fetch;
  const fetchTypes: string[] = [];
  const adapterTypes: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { type: string };
    fetchTypes.push(body.type);
    return Response.json({ success: true, result: {} });
  };
  try {
    const selectedCategory = categoryPlan();
    const adapter = createTemuAuthoritativePreparationReadAdapter({
      payload: payload(),
      expectedAccountSubject: accountSubject,
      expectedMallId: mallId,
      expectedRegionId: regionId,
      productRevisionFingerprint: fingerprint,
      externalGoodsId: externalId,
      category: selectedCategory,
      categoryBinding: {
        source: "sellerpilot_exact_product_revision_category_plan_v1",
        productRevisionFingerprint: fingerprint,
        categoryPlanSha256:
          temuCategoryPreparationPlanSha256(selectedCategory),
      },
      readCurrentAppSnapshot: async () => appSnapshot(),
      readCurrentShippingSnapshot: async () => shippingSnapshot(),
      request: async (request) => {
        adapterTypes.push(request.type);
        await assert.rejects(
          temuRequest({
            payload: payload(),
            type: "temu.local.goods.v3.add",
          }),
          /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/u,
        );
        return remote(officialData(request.type));
      },
      clock: { nowEpochMs: () => nowEpochMs },
    });
    await adapter.readLeafCategoryCompliance({
      mallId,
      productRevisionFingerprint: fingerprint,
      externalGoodsId: externalId,
    });
    await adapter.readStoreShipping({ mallId });
    assert.deepEqual(new Set(adapterTypes), r16Methods);
    assert.equal(adapterTypes.every((type) => r16Methods.has(
      type as TemuPreparationReadMethod)), true);
    assert.equal(adapterTypes.includes("temu.local.goods.v3.add"), false);
    await assert.rejects(
      runWithProviderReadOnlyTransport(() => temuRequest({
        payload: payload(),
        type: "temu.local.goods.v3.add",
      })),
      /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/u,
    );
    assert.deepEqual(fetchTypes, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
