import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteResponse } from "../lib/channels/protocols";
import {
  collectTemuAuthoritativeReadinessInput,
  type CollectTemuAuthoritativeReadinessInput,
  type TemuAuthoritativeReadDependencies,
} from "../lib/product-registration/temu/authoritative-source-collector";
import {
  createTemuAuthoritativeProviderReadAdapter,
  TemuAuthoritativeProviderReadError,
} from "../lib/product-registration/temu/authoritative-provider-read-adapter";
import { temuReviewAndCreateRequiredApiScopes } from "../lib/product-registration/temu/review-and-create-readiness";
import { temuAccountIdentitySubject } from "../lib/product-registration/temu/account-identity";

const nowEpochMs = 1_800_000_000_000;
const appId = "sellerpilot-self-developed";
const mallId = "608573962731830";
const regionId = "211";
const fingerprint = "b".repeat(64);
const externalId = "AUTO-780720401E2D4E4EA45F";
const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const accountSubject = `temu-account:sha256:${"a".repeat(64)}`;
const tokenSubject = temuAccountIdentitySubject({
  contract: "temu_access_token_identity_v1",
  endpointHost: "openapi-b-global.temu.com",
  mallId,
  regionId,
  mallType: 100,
  semiUniqueId: null,
});
const categoryPlanSha256 = "d".repeat(64);

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

function listData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      goodsList: [],
      total: 0,
      ...overrides,
    },
  };
}

function remote(
  data: Record<string, unknown>,
  status = 200,
): RemoteResponse {
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
  return {
    nowEpochMs,
    expectedAppId: appId,
    expectedPublicationFingerprint: fingerprint,
    expectedExternalGoodsId: externalId,
    expectedCategoryPlanSha256: categoryPlanSha256,
    accountMapping: {
      source: "temu_partner_token_account_mapping_v1",
      observedAtEpochMs: nowEpochMs - 1_000,
      partnerAccountSubject: accountSubject,
      tokenIdentitySubject: tokenSubject,
      mallId,
      regionId,
      productRevisionFingerprint: fingerprint,
      evidenceSha256: "e".repeat(64),
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

function adapter(input: {
  credential?: Record<string, unknown>;
  request: NonNullable<Parameters<typeof createTemuAuthoritativeProviderReadAdapter>[0]["request"]>;
  clock?: { nowEpochMs: () => number };
}) {
  return createTemuAuthoritativeProviderReadAdapter({
    payload: input.credential ?? payload(),
    expectedMallId: mallId,
    expectedRegionId: regionId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
    externalSkuId: externalId,
    createBody: createBody(),
    request: input.request,
    clock: input.clock ?? { nowEpochMs: () => nowEpochMs - 1_000 },
  });
}

function completeDependencies(
  provider: ReturnType<typeof adapter>,
  appRows: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readAppRows"]>>["rows"] = [{
    appId,
    state: "active",
    complianceState: "approved",
    rejectionReason: null,
  }],
): TemuAuthoritativeReadDependencies {
  return {
    readAppRows: async () => ({
      observedAtEpochMs: nowEpochMs - 1_000,
      accountSubject,
      rows: appRows,
    }),
    ...provider,
    readLeafCategoryCompliance: async () => ({
      observedAtEpochMs: nowEpochMs - 1_000,
      mallId,
      productRevisionFingerprint: fingerprint,
      categoryId: "601099",
      categoryPlanSha256,
      requestEvidenceSha256: "f".repeat(64),
      responseEvidenceSha256: "1".repeat(64),
      leafCategoryVerified: true,
      categoryRecommendationVerified: true,
      categoryAttributesVerified: true,
      categoryComplianceVerified: true,
      certificationDecisionVerified: true,
    }),
    readStoreShipping: async () => ({
      observedAtEpochMs: nowEpochMs - 1_000,
      mallId,
      storeDefaultShippingVerified: true,
    }),
    readGlobalEgressAttestation: async () => ({
      observedAtEpochMs: nowEpochMs - 1_000,
      endpointHost: "openapi-b-global.temu.com",
      state: "provider_confirmed_no_allowlist",
    }),
  };
}

function assertZeroWrites(effects: {
  mutations: number;
  claims: number;
  enqueues: number;
}) {
  assert.deepEqual([
    effects.mutations,
    effects.claims,
    effects.enqueues,
  ], [0, 0, 0]);
}

test("signed adapter emits bounded token, exact goods, and exact SKU DTOs", async () => {
  const calls: Array<{ type: string; arguments?: Record<string, unknown> }> = [];
  const provider = adapter({
    request: async (input) => {
      calls.push({ type: input.type, arguments: input.arguments });
      return remote(input.type === "bg.open.accesstoken.info.get"
        ? tokenData()
        : listData());
    },
  });
  const token = await provider.readTokenInfo();
  const goods = await provider.readExactGoods({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  });
  const sku = await provider.readExactSku({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalSkuId: externalId,
  });
  assert.deepEqual(calls.map((call) => call.type), [
    "bg.open.accesstoken.info.get",
    "temu.local.goods.list.retrieve",
    "temu.local.goods.list.retrieve",
  ]);
  assert.deepEqual(calls[1]?.arguments, {
    outGoodsSnList: [externalId],
    pageSize: 25,
  });
  assert.deepEqual(calls[2]?.arguments, {
    outSkuSnList: [externalId],
    pageSize: 25,
  });
  assert.deepEqual(token, {
    observedAtEpochMs: nowEpochMs - 1_000,
    active: true,
    mallId,
    regionId,
    subject: tokenSubject,
    apiScopes: [...temuReviewAndCreateRequiredApiScopes],
  });
  for (const result of [goods, sku]) {
    assert.equal(result.mallId, mallId);
    assert.equal(result.productRevisionFingerprint, fingerprint);
    assert.equal(result.externalId, externalId);
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
    assert.equal(result.continuationToken, null);
  }
  assert.doesNotMatch(JSON.stringify({ token, goods, sku }),
    /fixture-secret|fixture-token|requestId|errorMsg/u);
});

test("r15 adapter stamps actual delayed responses at completion and collector accepts them", async () => {
  const startedAtEpochMs = Date.now();
  const clock = { nowEpochMs: Date.now };
  const provider = adapter({
    request: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return remote(input.type === "bg.open.accesstoken.info.get"
        ? tokenData()
        : listData());
    },
    clock,
  });
  const fixed = completeDependencies(provider);
  const dependencies: TemuAuthoritativeReadDependencies = {
    ...fixed,
    readAppRows: async (scope) => ({
      ...await fixed.readAppRows(scope),
      observedAtEpochMs: Date.now(),
    }),
    readLeafCategoryCompliance: async (scope) => ({
      ...await fixed.readLeafCategoryCompliance(scope),
      observedAtEpochMs: Date.now(),
    }),
    readStoreShipping: async (scope) => ({
      ...await fixed.readStoreShipping(scope),
      observedAtEpochMs: Date.now(),
    }),
    readGlobalEgressAttestation: async (scope) => ({
      ...await fixed.readGlobalEgressAttestation(scope),
      observedAtEpochMs: Date.now(),
    }),
  };
  const request = collectorRequest();
  request.nowEpochMs = startedAtEpochMs;
  request.accountMapping.observedAtEpochMs = startedAtEpochMs;
  const collected = await collectTemuAuthoritativeReadinessInput({
    request,
    dependencies,
    clock,
  });
  assert.equal(collected.ok, true);
  assert.ok((collected.serviceInput?.credential?.observedAtEpochMs ?? 0)
    >= startedAtEpochMs + 15);
  assert.ok((collected.serviceInput?.nowEpochMs ?? 0)
    >= (collected.serviceInput?.credential?.observedAtEpochMs ?? 0));
});

test("current Applications zero rows never invokes the provider adapter", async () => {
  const effects = { providerReads: 0, mutations: 0, claims: 0, enqueues: 0 };
  const provider = adapter({
    credential: {},
    request: async () => {
      effects.providerReads += 1;
      throw new Error("must not run");
    },
  });
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: collectorRequest(),
    dependencies: completeDependencies(provider, []),
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.ok, false);
  assert.deepEqual(collected.blockers.map((blocker) => blocker.code), [
    "CURRENT_APP_ROW_REQUIRED",
  ]);
  assert.equal(effects.providerReads, 0);
  assertZeroWrites(effects);
});

test("missing operating credential fails before any signed provider read", async () => {
  const effects = { providerReads: 0, mutations: 0, claims: 0, enqueues: 0 };
  const provider = adapter({
    credential: {},
    request: async () => {
      effects.providerReads += 1;
      return remote(tokenData());
    },
  });
  await assert.rejects(provider.readTokenInfo(), (error: unknown) =>
    error instanceof TemuAuthoritativeProviderReadError
      && error.code === "TEMU_AUTHORITATIVE_CREDENTIAL_REQUIRED");
  await assert.rejects(provider.readExactGoods({
    mallId,
    productRevisionFingerprint: fingerprint,
    externalGoodsId: externalId,
  }), (error: unknown) =>
    error instanceof TemuAuthoritativeProviderReadError
      && error.code === "TEMU_AUTHORITATIVE_CREDENTIAL_REQUIRED");
  assert.equal(effects.providerReads, 0);
  assertZeroWrites(effects);
});

test("401 and 403 token-info responses become one bounded authorization failure", async () => {
  for (const status of [401, 403]) {
    const effects = { mutations: 0, claims: 0, enqueues: 0 };
    const provider = adapter({
      request: async () => remote({
        success: false,
        errorMsg: `private provider error ${status}`,
      }, status),
    });
    await assert.rejects(provider.readTokenInfo(), (error: unknown) =>
      error instanceof TemuAuthoritativeProviderReadError
        && error.code === "TEMU_AUTHORITATIVE_READ_AUTHORIZATION_REJECTED"
        && !error.message.includes("private provider error"));
    assertZeroWrites(effects);
  }
});

test("timeout is bounded and does not fall through to another provider action", async () => {
  const effects = { providerReads: 0, mutations: 0, claims: 0, enqueues: 0 };
  const provider = adapter({
    request: async () => {
      effects.providerReads += 1;
      throw new DOMException("private timeout detail", "AbortError");
    },
  });
  await assert.rejects(provider.readTokenInfo(), (error: unknown) =>
    error instanceof TemuAuthoritativeProviderReadError
      && error.code === "TEMU_AUTHORITATIVE_READ_TRANSPORT_FAILED"
      && !error.message.includes("private timeout detail"));
  assert.equal(effects.providerReads, 1);
  assertZeroWrites(effects);
});

test("malformed pagination reaches the collector only as incomplete bounded DTOs", async () => {
  const effects = { providerReads: 0, mutations: 0, claims: 0, enqueues: 0 };
  const provider = adapter({
    request: async (input) => {
      effects.providerReads += 1;
      return remote(input.type === "bg.open.accesstoken.info.get"
        ? tokenData()
        : listData({ nextToken: "private-cursor" }));
    },
  });
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: collectorRequest(),
    dependencies: completeDependencies(provider),
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.equal(collected.blockers.some((blocker) =>
    blocker.code === "DUPLICATE_READ_INCOMPLETE"), true);
  assert.equal(JSON.stringify(collected).includes("private-cursor"), false);
  assert.equal(effects.providerReads, 3);
  assertZeroWrites(effects);
});

test("an exact provider collision is never converted into existing-goods recovery", async () => {
  const effects = { providerReads: 0, mutations: 0, claims: 0, enqueues: 0 };
  const provider = adapter({
    request: async (input) => {
      effects.providerReads += 1;
      if (input.type === "bg.open.accesstoken.info.get") {
        return remote(tokenData());
      }
      return input.arguments?.outGoodsSnList
        ? remote(listData({ goodsList: [{ goodsId: "90000001" }], total: 1 }))
        : remote(listData());
    },
  });
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: collectorRequest(),
    dependencies: completeDependencies(provider),
    clock: { nowEpochMs: () => nowEpochMs },
  });
  assert.equal(collected.serviceInput, null);
  assert.equal(collected.blockers.some((blocker) =>
    blocker.code === "EXTERNAL_ID_ALREADY_EXISTS"), true);
  assert.equal(JSON.stringify(collected).includes("90000001"), false);
  assert.equal(effects.providerReads, 3);
  assertZeroWrites(effects);
});

test("cross-mall, cross-revision, and cross-external-ID calls stop locally", async () => {
  const effects = { providerReads: 0, mutations: 0, claims: 0, enqueues: 0 };
  const provider = adapter({
    request: async () => {
      effects.providerReads += 1;
      return remote(listData());
    },
  });
  for (const scope of [
    { mallId: "999", productRevisionFingerprint: fingerprint, externalGoodsId: externalId },
    { mallId, productRevisionFingerprint: "c".repeat(64), externalGoodsId: externalId },
    { mallId, productRevisionFingerprint: fingerprint, externalGoodsId: "OTHER-SKU" },
  ]) {
    await assert.rejects(provider.readExactGoods(scope), (error: unknown) =>
      error instanceof TemuAuthoritativeProviderReadError
        && error.code === "TEMU_AUTHORITATIVE_READ_SCOPE_MISMATCH");
  }
  assert.equal(effects.providerReads, 0);
  assertZeroWrites(effects);
});

test("token-info mall or region mismatch is rejected without duplicate reads", async () => {
  const effects = { providerReads: 0, mutations: 0, claims: 0, enqueues: 0 };
  const provider = adapter({
    request: async (input) => {
      effects.providerReads += 1;
      return remote(input.type === "bg.open.accesstoken.info.get"
        ? tokenData({ regionId: "999" })
        : listData());
    },
  });
  await assert.rejects(provider.readTokenInfo(), (error: unknown) =>
    error instanceof TemuAuthoritativeProviderReadError
      && error.code === "TEMU_AUTHORITATIVE_TOKEN_ACCOUNT_MISMATCH");
  assert.equal(effects.providerReads, 1);
  assertZeroWrites(effects);
});
