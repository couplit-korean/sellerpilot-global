import assert from "node:assert/strict";
import test from "node:test";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import { listingRemoteStateFulfillsOperation } from "../lib/channels/listing-publication-state";
import { executeChannelOperation } from "../lib/channels/operations";
import { normalizeTemuListingPublicationReadback } from "../lib/channels/provider-temu-publication-readback";

const FINGERPRINT = "a".repeat(64);
const REPRESENTATIVE_IMAGES = ["https://cdn.example.test/temu/hero.jpg"];
const DETAIL_IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/temu/detail-${index + 1}.jpg`,
);
const GOODS_ID = "90000001";
const EXTERNAL_GOODS_ID = "TEMU-KR-STRICT-001";
const SKU_ID = "91000001";
const BASE_PRICE = { amount: "5000", currency: "KRW" };
const QUANTITY = 1;
const SOURCE_SKU = {
  externalSkuId: EXTERNAL_GOODS_ID,
  price: { basePrice: BASE_PRICE },
  quantity: QUANTITY,
};
const EXPECTED_SKUS = [{
  externalSkuId: EXTERNAL_GOODS_ID,
  basePrice: BASE_PRICE,
  quantity: QUANTITY,
}];
const GOODS_BASIC = {
  externalGoodsId: EXTERNAL_GOODS_ID,
  goodsName: "한국어로 확인된 테무 판매 상품",
  extCatName: "601099",
  costTemplate: "QA_KR_STANDARD",
  goodsDesc: "이 상품은 품질과 사용 방법을 한국어로 자세히 설명한 상품입니다.",
  bulletPoints: ["검증된 재질과 구성 정보를 한국어로 안내합니다."],
  goodsCarouselImage: REPRESENTATIVE_IMAGES,
  detailImage: DETAIL_IMAGES,
};

function listData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      goodsList: [{
        goodsId: GOODS_ID,
        outGoodsSn: EXTERNAL_GOODS_ID,
        status: 1,
        ...overrides,
      }],
    },
  };
}

function emptyListData() {
  return { success: true, result: { goodsList: [] } };
}

function statusData(
  status = 1,
  subStatus = 2,
  statusName = status === 1 && subStatus === 2
    ? "LIVE"
    : status === 1 && subStatus === 1
      ? "PENDING_REVIEW"
      : "",
) {
  return {
    success: true,
    result: {
      goodsPublishStatusList: [{
        goodsId: Number(GOODS_ID),
        status,
        subStatus,
        ...(statusName ? { statusName } : {}),
      }],
    },
  };
}

function detailData(images = DETAIL_IMAGES, overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      goodsId: GOODS_ID,
      outGoodsSn: EXTERNAL_GOODS_ID,
      goodsName: GOODS_BASIC.goodsName,
      goodsDesc: GOODS_BASIC.goodsDesc,
      bulletPoints: GOODS_BASIC.bulletPoints,
      goodsGallery: {
        goodsCarouselImage: GOODS_BASIC.goodsCarouselImage,
        detailImage: images,
      },
      skuList: [{
        skuId: SKU_ID,
        outSkuSn: EXTERNAL_GOODS_ID,
        price: { retailPrice: BASE_PRICE },
        retailPrice: BASE_PRICE,
      }],
      ...overrides,
    },
  };
}

function stockData(
  goodsId = GOODS_ID,
  skuOverrides: Record<string, unknown> = {},
) {
  return {
    success: true,
    result: {
      stockList: [{
        goodsId,
        skuStockInfoList: [{
          skuId: SKU_ID,
          outSkuSn: EXTERNAL_GOODS_ID,
          selfOrdinaryStock: { stock: QUANTITY, stockType: 1 },
          ...skuOverrides,
        }],
      }],
    },
  };
}

function normalize(input: {
  operation?: "listing.create" | "listing.stop" | "listing.publication.verify";
  intent?: "live" | "safe_test";
  list?: Record<string, unknown>;
  status?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  stock?: Record<string, unknown>;
  expectedRepresentativeImages?: string[];
  expectedImages?: string[];
} = {}) {
  const operation = input.operation ?? "listing.create";
  return normalizeTemuListingPublicationReadback({
    operation,
    intent: input.intent ?? "live",
    remoteId: GOODS_ID,
    externalGoodsId: EXTERNAL_GOODS_ID,
    listData: input.list ?? listData(),
    publishStatusData: input.status ?? statusData(),
    detailData: input.detail ?? detailData(),
    expectedLocale: "ko-KR",
    expectedFingerprint: FINGERPRINT,
    expectedRepresentativeImages: operation === "listing.stop"
      ? []
      : input.expectedRepresentativeImages ?? REPRESENTATIVE_IMAGES,
    expectedDetailImages: input.expectedImages ?? DETAIL_IMAGES,
    requestedLanguage: "ko",
    expectedGoodsName: GOODS_BASIC.goodsName,
    expectedGoodsDesc: GOODS_BASIC.goodsDesc,
    expectedBulletPoints: GOODS_BASIC.bulletPoints,
    ...(operation === "listing.stop" ? {} : {
      expectedSkus: EXPECTED_SKUS,
      stockData: input.stock ?? stockData(),
    }),
  });
}

test("Temu binds ko-KR, immutable goods IDs, and the exact ordered eight-image readback", () => {
  const result = normalize();
  assert.equal(result.remoteState?.visibility, "live");
  assert.equal(result.remoteState?.locale, "ko-KR");
  assert.equal(result.remoteState?.imageCount, 8);
  assert.deepEqual(result.remoteState?.resources, {
    goodsId: GOODS_ID,
    externalGoodsId: EXTERNAL_GOODS_ID,
  });
  assert.equal(result.remoteState?.fingerprint, FINGERPRINT);
  assert.equal(result.checks.imageOrderVerified, true);
  assert.equal(result.checks.representativeImageVerified, true);
  assert.equal(result.checks.skuIdentityVerified, true);
  assert.equal(result.checks.priceVerified, true);
  assert.equal(result.checks.stockVerified, true);
  assert.equal(result.remoteState?.evidence.version, "temu_list_status_detail_stock_v3");
  assert.equal(result.remoteState?.evidence.observedRepresentativeImageCount, 1);
  assert.deepEqual(result.remoteState?.evidence.readbackMethods, [
    "temu.local.goods.list.retrieve",
    "bg.local.goods.publish.status.get",
    "bg.local.goods.detail.query",
    "temu.local.goods.sku.stock.query",
  ]);
  assert.equal(result.remoteState?.evidence.observedSkuCount, 1);
});

test("Temu rejects mismatched SKU identity, base price, and regular stock readbacks", () => {
  assert.equal(normalize({
    detail: detailData(DETAIL_IMAGES, {
      skuList: [{
        skuId: SKU_ID,
        outSkuSn: EXTERNAL_GOODS_ID,
        price: { retailPrice: { amount: "4999", currency: "KRW" } },
      }],
    }),
  }).remoteState, undefined);
  assert.equal(normalize({
    stock: stockData(GOODS_ID, { selfOrdinaryStock: { stock: QUANTITY + 1, stockType: 1 } }),
  }).remoteState, undefined);
  assert.equal(normalize({
    stock: stockData(GOODS_ID, { outSkuSn: "TEMU-OTHER" }),
  }).remoteState, undefined);
  assert.equal(normalize({
    detail: detailData(DETAIL_IMAGES, {
      skuList: [
        ...detailData().result.skuList,
        { skuId: "91000002", outSkuSn: "TEMU-EXTRA", retailPrice: BASE_PRICE },
      ],
    }),
  }).remoteState, undefined);
});

test("Temu pending review is durable evidence but never fulfilled publication", () => {
  const result = normalize({ status: statusData(1, 1) });
  assert.equal(result.remoteState?.visibility, "pending_review");
  assert.equal(
    result.remoteState
      ? listingRemoteStateFulfillsOperation("listing.create", result.remoteState, "live")
      : true,
    false,
  );
});

test("Temu rejects 7, 9, duplicate, and reordered approved detail-image readbacks", () => {
  const variants = [
    DETAIL_IMAGES.slice(0, 7),
    [...DETAIL_IMAGES, "https://cdn.example.test/temu/detail-9.jpg"],
    [...DETAIL_IMAGES.slice(0, 7), DETAIL_IMAGES[0]],
    [DETAIL_IMAGES[1], DETAIL_IMAGES[0], ...DETAIL_IMAGES.slice(2)],
  ];
  for (const images of variants) {
    const result = normalize({ detail: detailData(images) });
    assert.equal(result.remoteState, undefined, images.join("|"));
  }
});

test("Temu rejects missing, extra, reused, and drifted representative-image readbacks", () => {
  const detailWithCarousel = (goodsCarouselImage: string[]) => detailData(DETAIL_IMAGES, {
    goodsGallery: { goodsCarouselImage, detailImage: DETAIL_IMAGES },
  });
  for (const representativeImages of [
    [],
    [...REPRESENTATIVE_IMAGES, "https://cdn.example.test/temu/hero-2.jpg"],
    [DETAIL_IMAGES[0]],
    ["https://cdn.example.test/temu/other-hero.jpg"],
  ]) {
    const result = normalize({ detail: detailWithCarousel(representativeImages) });
    assert.equal(result.remoteState, undefined, representativeImages.join("|"));
    assert.equal(result.checks.representativeImageVerified, false);
  }
  assert.equal(normalize({
    expectedRepresentativeImages: [DETAIL_IMAGES[0]],
  }).remoteState, undefined);
});

test("Temu rejects unknown status, locale drift, and externalGoodsId drift", () => {
  assert.equal(normalize({ status: statusData(99, 99) }).remoteState, undefined);
  assert.equal(normalize({ detail: detailData(DETAIL_IMAGES, { goodsName: "다른 상품" }) }).remoteState, undefined);
  assert.equal(normalize({ list: listData({ outGoodsSn: "TEMU-OTHER" }) }).remoteState, undefined);
});

test("Temu fails closed on numeric-only or conflicting status evidence", () => {
  const numericOnly = {
    success: true,
    result: {
      goodsPublishStatusList: [{ goodsId: Number(GOODS_ID), status: 1, subStatus: 2 }],
    },
  };
  assert.equal(normalize({ status: numericOnly }).remoteState, undefined);
  assert.equal(normalize({
    list: listData({ goodsStatus: "PROVIDER_ENUM_NOT_YET_VERSIONED" }),
    status: numericOnly,
  }).remoteState, undefined);
  assert.equal(normalize({
    status: statusData(1, 2, "LIVE"),
    list: listData({ goodsShowSubStatus: "OFF_SHELF" }),
  }).remoteState, undefined);
  assert.equal(normalize({
    status: statusData(0, 0, "OFF_SHELF"),
    list: listData({ onsale: 0 }),
    detail: detailData(DETAIL_IMAGES, { onsale: 1 }),
  }).remoteState, undefined);
  const rejected = normalize({ status: statusData(1, 2, "REJECTED") });
  assert.equal(rejected.visibility, "rejected");
  assert.equal(rejected.remoteState, undefined);
});

test("Temu safe-test and stop require an off-shelf readback", () => {
  const offShelfStatus = statusData(0, 0, "OFF_SHELF");
  const safeTest = normalize({ intent: "safe_test", list: listData({ onsale: 0 }), status: offShelfStatus });
  assert.equal(safeTest.remoteState?.visibility, "non_public");
  const stop = normalize({
    operation: "listing.stop",
    intent: undefined,
    list: listData({ onsale: 0 }),
    status: offShelfStatus,
    expectedImages: [],
  });
  assert.equal(stop.remoteState?.visibility, "non_public");
  assert.equal(stop.remoteState?.imageCount, 0);
  assert.equal(normalize({ intent: "safe_test" }).remoteState, undefined);
});

function strictArguments(intent: "live" | "safe_test" = "live") {
  return {
    body: { language: "ko", goodsBasic: GOODS_BASIC, skuList: [SOURCE_SKU] },
    publicationIntent: intent,
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    sellerpilotTemuCreateCorrelation: {
      version: "temu_create_attempt_external_id_v1",
      sourceSellerSku: EXTERNAL_GOODS_ID,
      externalGoodsId: EXTERNAL_GOODS_ID,
      scopeFingerprint: "b".repeat(64),
      skuCount: 1,
    },
  };
}

function activationArguments() {
  return {
    ...strictArguments("live"),
    goodsId: GOODS_ID,
    externalGoodsId: EXTERNAL_GOODS_ID,
    sellerpilotTemuActivation: {
      version: "temu_verified_non_public_activation_v1",
      sourceJobId: "11111111-1111-4111-8111-111111111111",
      listingId: "22222222-2222-4222-8222-222222222222",
      activationFingerprint: "c".repeat(64),
      goodsId: GOODS_ID,
      externalGoodsId: EXTERNAL_GOODS_ID,
    },
  };
}

test("Temu activation verifies exact price and stock before and after the provider write", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  let listReads = 0;
  let statusReads = 0;
  let beginCalls = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.list.retrieve") {
      listReads += 1;
      return Response.json(listData({ onsale: listReads === 1 ? 0 : 1 }));
    }
    if (body.type === "bg.local.goods.publish.status.get") {
      statusReads += 1;
      return Response.json(statusReads === 1
        ? statusData(0, 0, "OFF_SHELF")
        : statusData());
    }
    if (body.type === "bg.local.goods.detail.query") return Response.json(detailData());
    if (body.type === "temu.local.goods.sku.stock.query") {
      assert.equal("language" in body, false);
      return Response.json(stockData());
    }
    if (body.type === "bg.local.goods.sale.status.set") {
      return Response.json({ success: true, result: { goodsId: Number(GOODS_ID) } });
    }
    throw new Error(`unexpected Temu method: ${String(body.type)}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.activate",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: activationArguments(),
      environment: "production",
      providerMutationHooks: {
        assertLeaseHealthy: async () => undefined,
        begin: async () => { beginCalls += 1; },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.evidence.priceVerified, true);
    assert.equal(result.remoteState?.evidence.stockVerified, true);
    assert.equal(beginCalls, 1);
    assert.equal(
      calls.filter((call) => call.type === "temu.local.goods.sku.stock.query").length,
      2,
    );
    assert.equal(
      calls.filter((call) => call.type === "bg.local.goods.sale.status.set").length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu activation blocks before the provider write when source stock no longer matches", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  let beginCalls = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.list.retrieve") return Response.json(listData({ onsale: 0 }));
    if (body.type === "bg.local.goods.publish.status.get") return Response.json(statusData(0, 0, "OFF_SHELF"));
    if (body.type === "bg.local.goods.detail.query") return Response.json(detailData());
    if (body.type === "temu.local.goods.sku.stock.query") {
      return Response.json(stockData(GOODS_ID, { selfOrdinaryStock: { stock: QUANTITY + 1 } }));
    }
    throw new Error("provider write must not run");
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.activate",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: activationArguments(),
      environment: "production",
      providerMutationHooks: {
        assertLeaseHealthy: async () => undefined,
        begin: async () => { beginCalls += 1; },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(beginCalls, 0);
    assert.equal(calls.some((call) => call.type === "bg.local.goods.sale.status.set"), false);
    assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_EXACT_NON_PUBLIC_ACTIVATION_SOURCE_UNVERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu create timeout reconciles once by externalGoodsId and never sends a second create", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  let listReadCount = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.list.retrieve") {
      listReadCount += 1;
      return Response.json(listReadCount === 1 ? emptyListData() : listData());
    }
    if (body.type === "temu.local.goods.v3.add") throw new DOMException("timed out", "TimeoutError");
    if (body.type === "bg.local.goods.publish.status.get") return Response.json(statusData());
    if (body.type === "temu.local.goods.sku.stock.query") return Response.json(stockData());
    return Response.json(detailData());
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, GOODS_ID);
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(calls.filter((call) => call.type === "temu.local.goods.v3.add").length, 1);
    assert.equal(result.steps[1].data.createTransportUncertain, true);
    assert.equal(result.steps[1].data.sellerpilotVerification, "EXISTING_GOODS_RECOVERED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu strict create returns pending-review without claiming publication success", async () => {
  const originalFetch = globalThis.fetch;
  let listReadCount = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.type === "temu.local.goods.v3.add") {
      return Response.json({ success: true, result: { goodsId: Number(GOODS_ID), externalGoodsId: EXTERNAL_GOODS_ID } });
    }
    if (body.type === "temu.local.goods.list.retrieve") {
      listReadCount += 1;
      return Response.json(listReadCount === 1 ? emptyListData() : listData());
    }
    if (body.type === "bg.local.goods.publish.status.get") return Response.json(statusData(1, 1));
    if (body.type === "temu.local.goods.sku.stock.query") return Response.json(stockData());
    return Response.json(detailData());
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "pending_review");
    assert.equal(result.publicationFulfilled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu strict safe-test immediately goes off-shelf and binds the same eight images", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  let listReadCount = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.v3.add") {
      return Response.json({ success: true, result: { goodsId: Number(GOODS_ID), externalGoodsId: EXTERNAL_GOODS_ID } });
    }
    if (body.type === "temu.local.goods.list.retrieve") {
      listReadCount += 1;
      return Response.json(listReadCount === 1 ? emptyListData() : listData({ onsale: 0 }));
    }
    if (body.type === "bg.local.goods.sale.status.set") {
      return Response.json({ success: true, result: { goodsId: Number(GOODS_ID) } });
    }
    if (body.type === "bg.local.goods.publish.status.get") return Response.json(statusData(0, 0, "OFF_SHELF"));
    if (body.type === "temu.local.goods.sku.stock.query") return Response.json(stockData());
    return Response.json(detailData());
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: strictArguments("safe_test"),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.equal(result.remoteState?.imageCount, 8);
    assert.equal(result.publicationFulfilled, true);
    assert.deepEqual(calls.map((call) => call.type), [
      "temu.local.goods.list.retrieve",
      "temu.local.goods.v3.add",
      "bg.local.goods.sale.status.set",
      "temu.local.goods.list.retrieve",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
      "temu.local.goods.sku.stock.query",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu preserves a LONG goodsId above MAX_SAFE_INTEGER for exact off-shelf and readback calls", async () => {
  const originalFetch = globalThis.fetch;
  const longGoodsId = "9223372036854775806";
  const requestBodies: string[] = [];
  let listReadCount = 0;
  globalThis.fetch = async (_input, init) => {
    const rawBody = String(init?.body ?? "");
    requestBodies.push(rawBody);
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (body.type === "temu.local.goods.v3.add") {
      return new Response(`{"success":true,"result":{"goodsId":${longGoodsId},"externalGoodsId":"${EXTERNAL_GOODS_ID}"}}`, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (body.type === "temu.local.goods.list.retrieve") {
      listReadCount += 1;
      return Response.json(listReadCount === 1 ? emptyListData() : {
        success: true,
        result: { goodsList: [{ goodsId: longGoodsId, outGoodsSn: EXTERNAL_GOODS_ID, onsale: 0 }] },
      });
    }
    if (body.type === "bg.local.goods.sale.status.set") {
      return new Response(`{"success":true,"result":{"goodsId":${longGoodsId}}}`, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (body.type === "bg.local.goods.publish.status.get") {
      return Response.json({
        success: true,
        result: { goodsPublishStatusList: [{ goodsId: longGoodsId, statusName: "OFF_SHELF" }] },
      });
    }
    if (body.type === "temu.local.goods.sku.stock.query") {
      return Response.json(stockData(longGoodsId));
    }
    return Response.json({
      ...detailData().result,
      success: true,
      result: { ...detailData().result, goodsId: longGoodsId },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: strictArguments("safe_test"),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, longGoodsId);
    for (const type of [
      "bg.local.goods.sale.status.set",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
      "temu.local.goods.sku.stock.query",
    ]) {
      const body = requestBodies.find((candidate) => candidate.includes(`"type":"${type}"`));
      assert.ok(body, type);
      assert.equal(
        body.includes(`"goodsId":${longGoodsId}`)
          || body.includes(`"goodsIdList":[${longGoodsId}]`),
        true,
        body,
      );
      assert.equal(body.includes(`"${longGoodsId}"`), false, body);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu safe-test off-shelves before a missing first readback and never reports success", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.v3.add") {
      return Response.json({ success: true, result: { goodsId: Number(GOODS_ID), externalGoodsId: EXTERNAL_GOODS_ID } });
    }
    if (body.type === "bg.local.goods.sale.status.set") {
      return Response.json({ success: true, result: { goodsId: Number(GOODS_ID) } });
    }
    if (body.type === "temu.local.goods.list.retrieve") {
      return Response.json(emptyListData());
    }
    throw new Error("post-miss provider call must not run");
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: strictArguments("safe_test"),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.notEqual(result.publicationFulfilled, true);
    assert.deepEqual(calls.map((call) => call.type), [
      "temu.local.goods.list.retrieve",
      "temu.local.goods.v3.add",
      "bg.local.goods.sale.status.set",
      "temu.local.goods.list.retrieve",
    ]);
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "reconciliation_required",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu definite create rejection never looks up or off-shelves an existing external ID", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.list.retrieve") return Response.json(emptyListData());
    return Response.json({
      success: false,
      errorCode: 150010041,
      errorMsg: "externalGoodsId already exists",
    }, { status: 409 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: strictArguments("safe_test"),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls.map((call) => call.type), [
      "temu.local.goods.list.retrieve",
      "temu.local.goods.v3.add",
    ]);
    assert.equal(result.steps[1]?.data.sellerpilotVerification, "TEMU_EXTERNAL_ID_COLLISION_MANUAL_RECONCILIATION");
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "reconciliation_required",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu rejects an invalid strict image contract before the create call", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected provider call");
  };
  try {
    const invalid = strictArguments();
    invalid.body.goodsBasic = { ...GOODS_BASIC, detailImage: DETAIL_IMAGES.slice(0, 7) };
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: invalid,
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_PUBLICATION_PREWRITE_REJECTED");
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu requires an exact leaf category, shipping template, and one distinct representative before create", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected provider call");
  };
  try {
    for (const goodsBasic of [
      { ...GOODS_BASIC, extCatName: "케이블 > 정리" },
      { ...GOODS_BASIC, costTemplate: "" },
      { ...GOODS_BASIC, goodsCarouselImage: [] },
      { ...GOODS_BASIC, goodsCarouselImage: [REPRESENTATIVE_IMAGES[0], "https://cdn.example.test/temu/hero-2.jpg"] },
      { ...GOODS_BASIC, goodsCarouselImage: [DETAIL_IMAGES[0]] },
    ]) {
      const invalid = strictArguments();
      invalid.body.goodsBasic = goodsBasic;
      const result = await executeChannelOperation({
        channel: "temu",
        operation: "listing.create",
        payload: { app_key: "app", app_secret: "secret", access_token: "token" },
        arguments: invalid,
        environment: "production",
      });
      assert.equal(result.ok, false);
      assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_PUBLICATION_PREWRITE_REJECTED");
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu rejects an incomplete strict price or stock contract before the create call", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected provider call");
  };
  try {
    for (const invalidSku of [
      { externalSkuId: EXTERNAL_GOODS_ID, quantity: QUANTITY },
      { externalSkuId: EXTERNAL_GOODS_ID, price: SOURCE_SKU.price },
    ]) {
      const invalid = strictArguments();
      invalid.body.skuList = [invalidSku as typeof SOURCE_SKU];
      const result = await executeChannelOperation({
        channel: "temu",
        operation: "listing.create",
        payload: { app_key: "app", app_secret: "secret", access_token: "token" },
        arguments: invalid,
        environment: "production",
      });
      assert.equal(result.ok, false);
      assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_PUBLICATION_PREWRITE_REJECTED");
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu quarantines a provider-accepted create when price or stock readback drifts", async () => {
  const originalFetch = globalThis.fetch;
  for (const drift of ["price", "stock"] as const) {
    let listReadCount = 0;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.type === "temu.local.goods.v3.add") {
        return Response.json({ success: true, result: { goodsId: Number(GOODS_ID), externalGoodsId: EXTERNAL_GOODS_ID } });
      }
      if (body.type === "temu.local.goods.list.retrieve") {
        listReadCount += 1;
        return Response.json(listReadCount === 1 ? emptyListData() : listData());
      }
      if (body.type === "bg.local.goods.publish.status.get") return Response.json(statusData());
      if (body.type === "temu.local.goods.sku.stock.query") {
        return Response.json(drift === "stock"
          ? stockData(GOODS_ID, { selfOrdinaryStock: { stock: QUANTITY + 1 } })
          : stockData());
      }
      return Response.json(drift === "price"
        ? detailData(DETAIL_IMAGES, {
            skuList: [{
              skuId: SKU_ID,
              outSkuSn: EXTERNAL_GOODS_ID,
              price: { retailPrice: { amount: "4900", currency: "KRW" } },
            }],
          })
        : detailData());
    };
    try {
      const result = await executeChannelOperation({
        channel: "temu",
        operation: "listing.create",
        payload: { app_key: "app", app_secret: "secret", access_token: "token" },
        arguments: strictArguments(),
        environment: "production",
      });
      assert.equal(result.ok, false, drift);
      assert.notEqual(result.publicationFulfilled, true, drift);
      assert.equal(result.remoteState, undefined, drift);
      assert.equal(
        result.steps.at(-1)?.data.sellerpilotVerification,
        drift === "price" ? "TEMU_PRICE_READBACK_MISMATCH" : "TEMU_STOCK_READBACK_MISMATCH",
        drift,
      );
      assert.equal(
        gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
        "reconciliation_required",
        drift,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("Temu strict stop performs off-shelf mutation and verifies the same goodsId pair", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "bg.local.goods.sale.status.set") return Response.json({ success: true, result: { goodsId: Number(GOODS_ID) } });
    if (body.type === "temu.local.goods.list.retrieve") return Response.json(listData({ onsale: 0 }));
    if (body.type === "bg.local.goods.publish.status.get") return Response.json(statusData(0, 0, "OFF_SHELF"));
    return Response.json(detailData());
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.stop",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: {
        goodsId: GOODS_ID,
        externalGoodsId: EXTERNAL_GOODS_ID,
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ko-KR",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 0,
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.equal(result.remoteState?.imageCount, 0);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.local.goods.sale.status.set",
      "temu.local.goods.list.retrieve",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
