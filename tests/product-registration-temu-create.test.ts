import assert from "node:assert/strict";
import test from "node:test";

import { executeTemu } from "../lib/product-registration/channels/temu";
import {
  inspectTemuGeneralCreateBody,
  normalizeTemuCreateProcessingState,
  normalizeTemuCreateReceipt,
  normalizeTemuIdentityRead,
  temuGeneralCreateIdentityQueries,
} from "../lib/product-registration/temu/create-contract";
import {
  attestTemuCredentialIdentityForSave,
  hasTemuAccountIdentityFields,
  normalizeTemuAccessTokenIdentity,
  resolveTemuCreateAccountTarget,
  temuAccountIdentityContract,
  temuAccountIdentityEndpointHost,
  temuCategoryRequiredApiScopes,
  temuCredentialReadinessRequiredApiScopes,
  temuCreateRequiredApiScopes,
  temuSafeTestRequiredApiScopes,
  verifyTemuAccountIdentity,
  withoutTemuAccountIdentityFields,
} from "../lib/product-registration/temu/account-identity";
import { temuReviewAndCreatePrewriteContract } from "../lib/product-registration/temu/create-readiness-adapter";
import { temuReviewAndCreateRequiredApiScopes } from "../lib/product-registration/temu/review-and-create-readiness";

const hero = "https://cdn.example.test/temu/hero.jpg";
const details = Array.from({ length: 8 }, (_, index) => `https://cdn.example.test/temu/detail-${index + 1}.jpg`);

function identityPayload(overrides: Record<string, unknown> = {}) {
  return {
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "fixture-token",
    temu_account_identity_contract: temuAccountIdentityContract,
    temu_account_identity_endpoint_host: temuAccountIdentityEndpointHost,
    temu_account_identity_mall_id: "608573962731830",
    temu_account_identity_region_id: "211",
    temu_account_identity_mall_type: "100",
    ...overrides,
  };
}

function identityResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      mallId: "608573962731830",
      regionId: "211",
      mallType: 100,
      expiredTime: "4102444800",
      apiScopeList: [...temuCredentialReadinessRequiredApiScopes],
      ...overrides,
    },
  };
}

function validBody() {
  return {
    language: "ko",
    goodsBasic: {
      externalGoodsId: "SP-TEMU-GENERAL-001",
      goodsName: "케이블 정리 클립 6개 구성",
      extCatName: "Home & Kitchen / Storage & Organization / Cable Management",
      goodsDesc: "책상과 벽면의 케이블을 정리하는 클립의 구성과 사용 방법입니다.",
      goodsCarouselImage: [hero],
      detailImage: details,
      bulletPoints: ["부착면을 닦고 건조한 뒤 고정합니다."],
      productType: 1,
    },
    attributes: [
      { name: "Brand", value: ["COUPLIT"] },
      { name: "Material", value: ["ABS"] },
    ],
    skuList: [{
      externalSkuId: "SP-TEMU-GENERAL-001-01",
      images: [hero],
      price: { basePrice: { amount: "5000", currency: "KRW" } },
      quantity: 2,
      packageInfo: { weight: "100", length: "10", width: "8", height: "2" },
      variations: [{ name: "판매 구성", value: "상품 6개" }],
    }],
  };
}

function strictArguments(mallId = "608573962731830") {
  return {
    body: validBody(),
    publicationIntent: "live" as const,
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    sellerpilotTemuCreateCorrelation: {
      version: "temu_create_attempt_external_id_v1",
      sourceSellerSku: "SP-TEMU-GENERAL-001",
      externalGoodsId: "SP-TEMU-GENERAL-001",
      scopeFingerprint: "b".repeat(64),
      skuCount: 1,
    },
    sellerpilotTemuCreateAccountLineage: {
      version: "temu_create_account_lineage_v1",
      market: "KR",
      mallId,
    },
    sellerpilotTemuReviewAndCreatePrewrite: {
      version: temuReviewAndCreatePrewriteContract,
      publicationFingerprint: "a".repeat(64),
      externalGoodsId: "SP-TEMU-GENERAL-001",
      accountBinding: {
        source: "temu_partner_token_account_mapping_v1" as const,
        observedAtEpochMs: 1_800_000_000_000,
        partnerAccountSubject: `temu-account:sha256:${"c".repeat(64)}`,
        tokenIdentitySubject: `temu:sha256:${"d".repeat(64)}`,
        mallId,
        regionId: "211",
        productRevisionFingerprint: "a".repeat(64),
        evidenceSha256: "e".repeat(64),
      },
      app: {
        currentAppState: "active" as const,
        currentComplianceState: "approved" as const,
        rejectionReason: null,
        cloudProviders: ["Vercel", "Supabase"],
        cloudDataFlowDocumented: true,
        retentionAndDeletionDocumented: true,
        incidentResponseDocumented: true,
        authorizationMode: "manual_access_token" as const,
        authorizationCallbackImplemented: false,
        authorizationCallbackEvidence: null,
        eventWebhookClaimed: false,
        eventWebhookImplemented: false,
      },
      create: {
        operatingCredentialPresent: true,
        verifiedApiScopes: [...temuReviewAndCreateRequiredApiScopes],
        networkEgress: "provider_confirmed_no_allowlist" as const,
        productId: "11111111-1111-4111-8111-111111111111",
        ledgerId: "SP-TEMU-READY-001",
        sellerSku: "SP-TEMU-GENERAL-001",
        locale: "ko-KR" as const,
        language: "ko" as const,
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
        priceAmount: "5000",
        priceCurrency: "KRW",
        packageWeightGrams: 100,
        packageLengthCm: 10,
        packageWidthCm: 8,
        packageHeightCm: 2,
        approvedRepresentativeImageCount: 1,
        approvedDetailImageCount: 8,
        storeDefaultShippingVerified: true,
        duplicateGoodsReadComplete: true,
        duplicateSkuReadComplete: true,
      },
    },
  };
}

test("Temu general CREATE accepts an optional external category name and forbids costTemplate", () => {
  const inspection = inspectTemuGeneralCreateBody(validBody());
  assert.equal(inspection.ok, true);
  assert.equal(inspection.categoryMode, "external_category_name");
  assert.equal(inspection.shippingMode, "store_default");

  const autoCategory = validBody();
  delete (autoCategory.goodsBasic as Partial<typeof autoCategory.goodsBasic>).extCatName;
  assert.equal(inspectTemuGeneralCreateBody(autoCategory).categoryMode, "provider_auto_recommend");

  for (const goodsBasic of [
    { ...validBody().goodsBasic, extCatName: "601099" },
    { ...validBody().goodsBasic, costTemplate: "" },
    { ...validBody().goodsBasic, costTemplate: "QA_KR_STANDARD" },
  ]) {
    const rejected = inspectTemuGeneralCreateBody({ ...validBody(), goodsBasic });
    assert.equal(rejected.ok, false);
  }
});

test("Temu general CREATE does not reject a seller-supplied Type Standard specification", () => {
  const body = validBody();
  body.skuList[0].variations = [{ name: "Type", value: "Standard" }];
  const inspection = inspectTemuGeneralCreateBody(body);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.skuChecks.variations, true);
});

test("Temu general CREATE rejects any invalid image element without filtering it away", () => {
  for (const goodsBasic of [
    { ...validBody().goodsBasic, goodsCarouselImage: [hero, "not-a-url"] },
    { ...validBody().goodsBasic, detailImage: [...details, "not-a-url"] },
  ]) {
    const inspection = inspectTemuGeneralCreateBody({ ...validBody(), goodsBasic });
    assert.equal(inspection.ok, false);
    assert.equal(inspection.issues.some((issue) => issue.code === "IMAGE_CONTRACT_INVALID"), true);
  }
});

test("Temu general CREATE issues separate exact goods and SKU duplicate reads", () => {
  const queries = temuGeneralCreateIdentityQueries(validBody());
  assert.deepEqual(queries, [
    {
      method: "temu.local.goods.list.retrieve",
      arguments: { outGoodsSnList: ["SP-TEMU-GENERAL-001"], pageSize: 25 },
    },
    {
      method: "temu.local.goods.list.retrieve",
      arguments: { outSkuSnList: ["SP-TEMU-GENERAL-001-01"], pageSize: 25 },
    },
  ]);
  assert.equal(queries.every((query) => !("goodsSearchType" in query.arguments)), true);
});

test("Temu duplicate read is complete only with an exact total and no continuation", () => {
  const [goodsQuery, skuQuery] = temuGeneralCreateIdentityQueries(validBody());
  assert.deepEqual(normalizeTemuIdentityRead({
    query: goodsQuery,
    response: { success: true, result: { goodsList: [], total: 0 } },
  }), {
    contract: "temu_general_create_v1",
    queryKind: "goods",
    complete: true,
    empty: true,
    observedGoodsCount: 0,
    total: 0,
  });
  assert.equal(normalizeTemuIdentityRead({
    query: goodsQuery,
    response: { success: true, result: { goodsList: [] } },
  }).complete, false);
  assert.equal(normalizeTemuIdentityRead({
    query: goodsQuery,
    response: { success: true, result: { goodsList: [], total: 0, nextToken: "next" } },
  }).complete, false);
  for (const nextToken of [{}, 1, " "]) {
    assert.equal(normalizeTemuIdentityRead({
      query: goodsQuery,
      response: { success: true, result: { goodsList: [], total: 0, nextToken } },
    }).complete, false);
    assert.equal(normalizeTemuIdentityRead({
      query: goodsQuery,
      response: { success: true, result: { goodsList: [], total: 0, pagination: { nextToken } } },
    }).complete, false);
  }
  assert.equal(normalizeTemuIdentityRead({
    query: goodsQuery,
    response: { success: true, result: { goodsList: [], total: 0, pagination: 1 } },
  }).complete, false);
  const collision = normalizeTemuIdentityRead({
    query: skuQuery,
    response: { success: true, result: { goodsList: [{ goodsId: "608573962731830" }], total: 1 } },
  });
  assert.equal(collision.complete, true);
  assert.equal(collision.empty, false);
  assert.equal(collision.queryKind, "sku");
});

test("Temu create receipt proves identity but never review, sale, buyer visibility, or completion", () => {
  const receipt = normalizeTemuCreateReceipt({
    body: validBody(),
    response: {
      success: true,
      result: { goodsId: "608573962731830", externalGoodsId: "SP-TEMU-GENERAL-001" },
    },
  });
  assert.equal(receipt?.created, true);
  assert.equal(receipt?.publicationConfirmed, false);
  assert.equal(receipt?.buyerVisibilityVerified, false);
  assert.equal(receipt?.internalCompletionEligible, false);
  assert.equal(receipt?.recommendedReadDelayMs, 600_000);
});

test("Temu official list states keep Draft, review, Active, Inactive, and Deleted separate", () => {
  const expected = {
    DRAFT: ["not_submitted", "not_sellable", "complete_category_attributes"],
    INCOMPLETE: ["pending_review", "not_sellable", "wait_for_review"],
    ACTIVE: ["provider_active", "active_not_buyer_verified", "verify_full_readback_and_buyer_visibility"],
    INACTIVE: ["provider_inactive", "non_public", "keep_non_public"],
    DELETED: ["provider_deleted", "withdrawn", "stop_removed_lineage"],
  } as const;
  for (const [goodsStatus, state] of Object.entries(expected)) {
    const result = normalizeTemuCreateProcessingState({
      listResponse: {
        success: true,
        result: {
          goodsList: [{
            goodsId: "608573962731830",
            outGoodsSn: "SP-TEMU-GENERAL-001",
            goodsStatus,
          }],
          total: 1,
        },
      },
      goodsId: "608573962731830",
      externalGoodsId: "SP-TEMU-GENERAL-001",
    });
    assert.deepEqual([result?.reviewState, result?.saleState, result?.nextAction], state);
    assert.equal(result?.buyerVisibilityVerified, false);
    assert.equal(result?.internalCompletionEligible, false);
  }
});

test("Temu token identity preserves official LONG values and binds the credential to mall and region", () => {
  const responseText = JSON.stringify(identityResponse({
    mallId: "9007199254740993",
  })).replace('"9007199254740993"', "9007199254740993")
    .replace('"4102444800"', "4102444800");
  const identity = normalizeTemuAccessTokenIdentity({
    response: JSON.parse(responseText) as Record<string, unknown>,
    responseText,
  });
  assert.equal(identity?.mallId, "9007199254740993");
  assert.equal(identity?.regionId, "211");
  assert.equal(identity?.mallType, 100);
  assert.match(identity?.subject ?? "", /^temu:sha256:[a-f0-9]{64}$/u);
  assert.equal(verifyTemuAccountIdentity({
    payload: identityPayload({
      temu_account_identity_mall_id: "9007199254740993",
    }),
    response: JSON.parse(responseText) as Record<string, unknown>,
    responseText,
    requiredScopes: temuCreateRequiredApiScopes,
    nowSeconds: 1_800_000_000,
  }).verification, "TEMU_ACCOUNT_IDENTITY_VERIFIED");
});

test("Temu CREATE derives an omitted target from the server credential and rejects a different requested mall", () => {
  assert.deepEqual(resolveTemuCreateAccountTarget({
    payload: identityPayload(),
    market: "KR",
    requestedTargetId: "",
  }), {
    market: "KR",
    targetId: "608573962731830",
    regionId: "211",
  });
  assert.throws(() => resolveTemuCreateAccountTarget({
    payload: identityPayload(),
    market: "KR",
    requestedTargetId: "608573962731831",
  }), /TEMU_CREATE_TARGET_MALL_MISMATCH/u);
});

test("Temu token identity requires the semi-managed store identity and every CREATE scope", () => {
  assert.equal(verifyTemuAccountIdentity({
    payload: identityPayload({
      temu_account_identity_mall_type: "1",
    }),
    response: identityResponse({
      mallType: 1,
      semiUniqueId: "semi-store-1",
    }),
    requiredScopes: temuCreateRequiredApiScopes,
    nowSeconds: 1_800_000_000,
  }).verification, "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED");

  const missingScope = verifyTemuAccountIdentity({
    payload: identityPayload(),
    response: identityResponse({
      apiScopeList: temuCreateRequiredApiScopes.filter((scope) =>
        scope !== "temu.local.goods.v3.add"),
    }),
    requiredScopes: temuCreateRequiredApiScopes,
    nowSeconds: 1_800_000_000,
  });
  assert.equal(missingScope.verification, "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING");
  assert.deepEqual(missingScope.missingScopes, ["temu.local.goods.v3.add"]);

  const safeTestScope = verifyTemuAccountIdentity({
    payload: identityPayload(),
    response: identityResponse(),
    requiredScopes: temuSafeTestRequiredApiScopes,
    nowSeconds: 1_800_000_000,
  });
  assert.equal(safeTestScope.verification, "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING");
  assert.deepEqual(safeTestScope.missingScopes,
    ["bg.local.goods.sale.status.set"]);
});

test("Temu token identity rejects malformed optional fields and invalid clocks", () => {
  for (const malformed of [{}, [], " "]) {
    assert.equal(verifyTemuAccountIdentity({
      payload: identityPayload({
        temu_account_identity_semi_unique_id: malformed,
      }),
      response: identityResponse(),
      requiredScopes: temuCreateRequiredApiScopes,
      nowSeconds: 1_800_000_000,
    }).verification, "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED");

    assert.equal(verifyTemuAccountIdentity({
      payload: identityPayload(),
      response: identityResponse({ semiUniqueId: malformed }),
      requiredScopes: temuCreateRequiredApiScopes,
      nowSeconds: 1_800_000_000,
    }).verification, "TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED");
  }

  for (const nowSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.equal(verifyTemuAccountIdentity({
      payload: identityPayload(),
      response: identityResponse(),
      requiredScopes: temuCreateRequiredApiScopes,
      nowSeconds,
    }).verification, "TEMU_ACCOUNT_IDENTITY_CLOCK_INVALID");
  }
});

test("Temu credential save strips every stale binding and rebuilds it only from a fresh signed read", async () => {
  const submitted = identityPayload({
    access_token: "new-fixture-token",
    temu_account_identity_mall_id: "stale-mall",
    temu_account_identity_region_id: "stale-region",
    unrelated_server_value: "preserved",
  });
  assert.equal(hasTemuAccountIdentityFields(submitted), true);
  assert.equal(hasTemuAccountIdentityFields(
    withoutTemuAccountIdentityFields(submitted),
  ), false);
  let requestPayload: Record<string, unknown> | null = null;
  const attested = await attestTemuCredentialIdentityForSave({
    payload: submitted,
    nowSeconds: 1_800_000_000,
    request: async (request) => {
      requestPayload = request.payload;
      return {
        response: Response.json(identityResponse()),
        data: identityResponse(),
        text: JSON.stringify(identityResponse()),
      };
    },
  });
  assert.equal(hasTemuAccountIdentityFields(requestPayload ?? {}), false);
  assert.equal(requestPayload?.access_token, "new-fixture-token");
  assert.equal(attested.payload.temu_account_identity_mall_id,
    "608573962731830");
  assert.equal(attested.payload.temu_account_identity_region_id, "211");
  assert.equal(attested.payload.unrelated_server_value, "preserved");
});

test("Temu credential save never returns a payload when the fresh signed read is invalid", async () => {
  await assert.rejects(attestTemuCredentialIdentityForSave({
    payload: identityPayload(),
    nowSeconds: 1_800_000_000,
    request: async () => ({
      response: Response.json(identityResponse()),
      data: identityResponse({ mallId: [] }),
      text: JSON.stringify(identityResponse({ mallId: [] })),
    }),
  }), /TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED/u);
});

test("Temu credential readiness requires the official category recommendation scope", async () => {
  await assert.rejects(attestTemuCredentialIdentityForSave({
    payload: {
      app_key: "fixture-app",
      app_secret: "fixture-secret",
      access_token: "fixture-token",
    },
    nowSeconds: 1_800_000_000,
    request: async () => ({
      response: Response.json(identityResponse()),
      data: identityResponse({ apiScopeList: [...temuCreateRequiredApiScopes] }),
      text: JSON.stringify(identityResponse({ apiScopeList: [...temuCreateRequiredApiScopes] })),
    }),
  }), /TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING/u);
});

test("Temu carries a freshly attested account into the category readiness call", async () => {
  const mallId = "731004298517642";
  const regionId = "37";
  const officialIdentity = identityResponse({ mallId, regionId });
  const attested = await attestTemuCredentialIdentityForSave({
    payload: {
      app_key: "fixture-app",
      app_secret: "fixture-secret",
      access_token: "fresh-fixture-token",
    },
    nowSeconds: 1_800_000_000,
    request: async () => ({
      response: Response.json(officialIdentity),
      data: officialIdentity,
      text: JSON.stringify(officialIdentity),
    }),
  });
  assert.equal(attested.payload.temu_account_identity_mall_id, mallId);
  assert.equal(attested.payload.temu_account_identity_region_id, regionId);

  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "bg.open.accesstoken.info.get") {
      return Response.json(officialIdentity);
    }
    if (body.type === "bg.local.goods.category.recommend") {
      return Response.json({ success: true, result: { catId: "601099" } });
    }
    if (Array.isArray(body.outGoodsSnList)) {
      return Response.json({ success: true, result: { goodsList: [], total: 0 } });
    }
    if (Array.isArray(body.outSkuSnList)) {
      return Response.json({
        success: true,
        result: { goodsList: [{ goodsId: "981007331452806" }], total: 1 },
      });
    }
    throw new Error("unexpected provider call");
  };
  try {
    const result = await executeTemu({
      channel: "temu",
      operation: "categories.suggest",
      payload: attested.payload,
      arguments: { goodsName: "케이블 정리 클립 6개 구성" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "601099");
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.open.accesstoken.info.get",
      "bg.local.goods.category.recommend",
    ]);
    assert.equal(result.steps[0].data.sellerpilotVerification,
      "TEMU_ACCOUNT_IDENTITY_VERIFIED");
    assert.equal(result.steps[0].data.sellerpilotTemuTargetId, mallId);
    assert.equal(result.steps[0].data.sellerpilotTemuRegionId, regionId);

    const createReadiness = await executeTemu({
      channel: "temu",
      operation: "listing.create",
      payload: attested.payload,
      arguments: strictArguments(mallId),
      environment: "production",
    });
    assert.equal(createReadiness.ok, false);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.open.accesstoken.info.get",
      "bg.local.goods.category.recommend",
      "bg.open.accesstoken.info.get",
      "temu.local.goods.list.retrieve",
      "temu.local.goods.list.retrieve",
    ]);
    assert.equal(createReadiness.steps[0].data.sellerpilotTemuTargetId, mallId);
    assert.equal(createReadiness.steps[0].data.sellerpilotTemuRegionId, regionId);
    assert.equal(createReadiness.steps[1].data.sellerpilotVerification,
      "TEMU_EXTERNAL_GOODS_OR_SKU_ID_ALREADY_EXISTS");
    assert.equal(calls.some((call) => call.type === "temu.local.goods.v3.add"),
      false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu blocks category recommendation before provider category access when scope is missing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return Response.json(identityResponse({
      apiScopeList: temuCreateRequiredApiScopes,
    }));
  };
  try {
    const result = await executeTemu({
      channel: "temu",
      operation: "categories.suggest",
      payload: identityPayload(),
      arguments: { goodsName: "케이블 정리 클립 6개 구성" },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.open.accesstoken.info.get",
    ]);
    assert.equal(result.steps[0].data.sellerpilotVerification,
      "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING");
    assert.deepEqual(result.steps[0].data.sellerpilotTemuMissingScopes,
      temuCategoryRequiredApiScopes);
    assert.equal(result.steps[0].data.sellerpilotNoWriteConfirmed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu runtime requires the r11 readiness binding before every CREATE provider read or write", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider transport must remain unused");
  };
  try {
    const argumentsValue = strictArguments() as Record<string, unknown>;
    delete argumentsValue.sellerpilotTemuReviewAndCreatePrewrite;
    const result = await executeTemu({
      channel: "temu",
      operation: "listing.create",
      payload: identityPayload(),
      arguments: argumentsValue,
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(providerCalls, 0);
    assert.equal(result.steps[0].name,
      "temu-review-create-readiness-prewrite");
    assert.equal(result.steps[0].data.sellerpilotVerification,
      "TEMU_REVIEW_CREATE_PREWRITE_BINDING_REQUIRED");
    assert.equal(result.steps[0].data.sellerpilotNoWriteConfirmed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu runtime blocks Inactive app evidence and a stale product fingerprint before provider access", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider transport must remain unused");
  };
  try {
    const inactiveArguments = strictArguments() as Record<string, unknown>;
    const inactiveBinding = inactiveArguments
      .sellerpilotTemuReviewAndCreatePrewrite as {
        app: { currentAppState: string };
      };
    inactiveBinding.app.currentAppState = "inactive";
    const inactive = await executeTemu({
      channel: "temu",
      operation: "listing.create",
      payload: identityPayload(),
      arguments: inactiveArguments,
      environment: "production",
    });
    assert.equal(inactive.ok, false);
    assert.equal(inactive.steps[0].data.sellerpilotVerification,
      "TEMU_REVIEW_CREATE_PREWRITE_READINESS_REJECTED");

    const staleArguments = strictArguments() as Record<string, unknown>;
    const staleBinding = staleArguments
      .sellerpilotTemuReviewAndCreatePrewrite as {
        publicationFingerprint: string;
      };
    staleBinding.publicationFingerprint = "c".repeat(64);
    const stale = await executeTemu({
      channel: "temu",
      operation: "listing.create",
      payload: identityPayload(),
      arguments: staleArguments,
      environment: "production",
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.steps[0].data.sellerpilotVerification,
      "TEMU_REVIEW_CREATE_PREWRITE_FINGERPRINT_MISMATCH");
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu runtime blocks CREATE with no server credential identity before any provider call", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider transport must remain unused");
  };
  try {
    const result = await executeTemu({
      channel: "temu",
      operation: "listing.create",
      payload: {
        app_key: "fixture-app",
        app_secret: "fixture-secret",
        access_token: "fixture-token",
      },
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(providerCalls, 0);
    assert.equal(result.steps[0].name, "temu-account-identity-prewrite");
    assert.equal(result.steps[0].data.sellerpilotVerification,
      "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED");
    assert.equal(result.steps[0].data.sellerpilotNoWriteConfirmed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu runtime blocks CREATE when the signed token belongs to another mall", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return Response.json(identityResponse({ mallId: "608573962731831" }));
  };
  try {
    const result = await executeTemu({
      channel: "temu",
      operation: "listing.create",
      payload: identityPayload(),
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.open.accesstoken.info.get",
    ]);
    assert.equal(result.steps[0].data.sellerpilotVerification,
      "TEMU_ACCOUNT_IDENTITY_MISMATCH");
    assert.equal(result.steps[0].data.sellerpilotTemuTargetId,
      "608573962731831");
    assert.equal(result.steps[0].data.sellerpilotNoWriteConfirmed, true);
    assert.equal(calls.some((call) => call.type === "temu.local.goods.v3.add"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu runtime blocks an external SKU collision before provider create", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "bg.open.accesstoken.info.get") {
      return Response.json(identityResponse());
    }
    if (Array.isArray(body.outGoodsSnList)) {
      return Response.json({ success: true, result: { goodsList: [], total: 0 } });
    }
    if (Array.isArray(body.outSkuSnList)) {
      return Response.json({
        success: true,
        result: { goodsList: [{ goodsId: "608573962731830" }], total: 1 },
      });
    }
    throw new Error("provider create must not run after a SKU collision");
  };
  try {
    const result = await executeTemu({
      channel: "temu",
      operation: "listing.create",
      payload: identityPayload(),
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.open.accesstoken.info.get",
      "temu.local.goods.list.retrieve",
      "temu.local.goods.list.retrieve",
    ]);
    assert.equal(result.steps[1].data.sellerpilotVerification, "TEMU_EXTERNAL_GOODS_OR_SKU_ID_ALREADY_EXISTS");
    assert.equal(calls.some((call) => call.type === "temu.local.goods.v3.add"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu runtime treats malformed continuation metadata as incomplete and performs zero creates", async () => {
  const originalFetch = globalThis.fetch;
  for (const nextToken of [{}, 1, " "]) {
    const calls: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (body.type === "bg.open.accesstoken.info.get") {
        return Response.json(identityResponse());
      }
      return Response.json({ success: true, result: { goodsList: [], total: 0, nextToken } });
    };
    try {
      const result = await executeTemu({
        channel: "temu",
        operation: "listing.create",
        payload: identityPayload(),
        arguments: strictArguments(),
        environment: "production",
      });
      assert.equal(result.ok, false);
      assert.equal(result.steps[1].data.sellerpilotVerification, "TEMU_EXTERNAL_ID_PREFLIGHT_INCOMPLETE");
      assert.equal(calls.some((call) => call.type === "temu.local.goods.v3.add"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("Temu runtime rejects missing or legacy CREATE contracts before any provider call", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider transport must remain unused");
  };
  try {
    for (const publicationStateContract of [undefined, "legacy_remote_state_v0"]) {
      const argumentsValue = strictArguments() as Record<string, unknown>;
      if (publicationStateContract === undefined) delete argumentsValue.publicationStateContract;
      else argumentsValue.publicationStateContract = publicationStateContract;
      const result = await executeTemu({
        channel: "temu",
        operation: "listing.create",
        payload: { app_key: "fixture-app", app_secret: "fixture-secret", access_token: "fixture-token" },
        arguments: argumentsValue,
        environment: "production",
      });
      assert.equal(result.ok, false);
      assert.equal(result.steps.length, 1);
      assert.equal(result.steps[0].name, "publication-prewrite");
      assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_CREATE_CONTRACT_REQUIRED");
      assert.equal(result.steps[0].data.sellerpilotNoWriteConfirmed, true);
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
