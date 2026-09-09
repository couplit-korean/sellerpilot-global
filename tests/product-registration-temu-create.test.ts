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

const hero = "https://cdn.example.test/temu/hero.jpg";
const details = Array.from({ length: 8 }, (_, index) => `https://cdn.example.test/temu/detail-${index + 1}.jpg`);

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

function strictArguments() {
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

test("Temu runtime blocks an external SKU collision before provider create", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
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
      payload: { app_key: "fixture-app", app_secret: "fixture-secret", access_token: "fixture-token" },
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls.map((call) => call.type), [
      "temu.local.goods.list.retrieve",
      "temu.local.goods.list.retrieve",
    ]);
    assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_EXTERNAL_GOODS_OR_SKU_ID_ALREADY_EXISTS");
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
      return Response.json({ success: true, result: { goodsList: [], total: 0, nextToken } });
    };
    try {
      const result = await executeTemu({
        channel: "temu",
        operation: "listing.create",
        payload: { app_key: "fixture-app", app_secret: "fixture-secret", access_token: "fixture-token" },
        arguments: strictArguments(),
        environment: "production",
      });
      assert.equal(result.ok, false);
      assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_EXTERNAL_ID_PREFLIGHT_INCOMPLETE");
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
