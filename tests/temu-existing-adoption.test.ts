import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import {
  normalizeTemuCredentialIdentityObservation,
  normalizeTemuExistingAdoptionObservation,
  temuCredentialCertificationBinding,
  temuCredentialCertificationContract,
  temuExistingAdoptionBinding,
  temuExistingAdoptionContract,
  temuExistingAdoptionIdentity,
} from "../lib/channels/temu-existing-adoption";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeServerlessGatewayProviderJob } = await import(
  "../lib/channels/serverless-gateway-provider"
);
const { executeChannelOperation } = await import("../lib/channels/operations");

const reviewId = "61000000-0000-4000-8000-000000000001";
const credentialId = "62000000-0000-4000-8000-000000000001";
const manifestDigest = "a".repeat(64);
const externalGoodsId = "QA-TEMU-EXISTING-001";
const externalSkuId = "QA-TEMU-EXISTING-001-SKU";
const representativeImages = ["https://cdn.example.test/temu-existing/hero.jpg"];
const detailImages = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/temu-existing/detail-${index + 1}.jpg`,
);

function argumentsValue(overrides: Record<string, unknown> = {}) {
  return {
    sellerpilotReadOnly: true,
    sellerpilotTemuExistingAdoption: {
      contract: temuExistingAdoptionContract,
      reviewId,
      productId: temuExistingAdoptionIdentity.productId,
      credentialId,
      goodsId: temuExistingAdoptionIdentity.goodsId,
      skuId: temuExistingAdoptionIdentity.skuId,
      approvedManifestDigest: manifestDigest,
      ...overrides,
    },
  };
}

function credentialCertificationArguments(overrides: Record<string, unknown> = {}) {
  return {
    sellerpilotReadOnly: true,
    sellerpilotTemuCredentialCertification: {
      contract: temuCredentialCertificationContract,
      reviewId,
      productId: temuExistingAdoptionIdentity.productId,
      credentialId,
      goodsId: temuExistingAdoptionIdentity.goodsId,
      skuId: temuExistingAdoptionIdentity.skuId,
      ...overrides,
    },
  };
}

function accessTokenInfoData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      mallId: 1024,
      apiScopeList: [
        "bg.local.goods.publish.status.get",
        "bg.open.accesstoken.info.get",
      ],
      ...overrides,
    },
  };
}

function listData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      goodsList: [{
        goodsId: temuExistingAdoptionIdentity.goodsId,
        outGoodsSn: externalGoodsId,
        goodsStatus: "ACTIVE",
        ...overrides,
      }],
    },
  };
}

function statusData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      goodsPublishStatusList: [{
        goodsId: temuExistingAdoptionIdentity.goodsId,
        statusName: "ACTIVE",
        ...overrides,
      }],
    },
  };
}

function detailData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      goodsId: temuExistingAdoptionIdentity.goodsId,
      outGoodsSn: externalGoodsId,
      language: "ko",
      goodsName: "케이블 정리 클립 테스트 상품",
      goodsDesc: "케이블을 깔끔하게 정리하는 한국어 상세 설명입니다.",
      bulletPoints: ["책상과 차량에서 사용할 수 있습니다."],
      goodsGallery: {
        goodsCarouselImage: representativeImages,
        detailImage: detailImages,
      },
      skuList: [{
        skuId: temuExistingAdoptionIdentity.skuId,
        outSkuSn: externalSkuId,
        price: { retailPrice: { amount: "5000.00", currency: "KRW" } },
        retailPrice: { amount: "5000", currency: "KRW" },
      }],
      ...overrides,
    },
  };
}

function stockData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      stockList: [{
        goodsId: temuExistingAdoptionIdentity.goodsId,
        skuStockInfoList: [{
          skuId: temuExistingAdoptionIdentity.skuId,
          outSkuSn: externalSkuId,
          selfOrdinaryStock: { stock: 1 },
          ...overrides,
        }],
      }],
    },
  };
}

function observation(input: {
  list?: Record<string, unknown>;
  status?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  stock?: Record<string, unknown>;
} = {}) {
  const binding = temuExistingAdoptionBinding(argumentsValue());
  assert.ok(binding);
  return normalizeTemuExistingAdoptionObservation({
    binding,
    listData: input.list ?? listData(),
    publishStatusData: input.status ?? statusData(),
    detailData: input.detail ?? detailData(),
    stockData: input.stock ?? stockData(),
    observedAt: new Date("2026-09-01T09:00:00.000Z"),
  });
}

test("Temu existing adoption marker is exact and read-only", () => {
  const binding = temuExistingAdoptionBinding(argumentsValue());
  assert.deepEqual(binding, {
    contract: temuExistingAdoptionContract,
    reviewId,
    productId: temuExistingAdoptionIdentity.productId,
    credentialId,
    goodsId: temuExistingAdoptionIdentity.goodsId,
    skuId: temuExistingAdoptionIdentity.skuId,
    approvedManifestDigest: manifestDigest,
  });
  assert.equal(temuExistingAdoptionBinding({
    ...argumentsValue(),
    sellerpilotReadOnly: false,
  }), null);
  assert.equal(temuExistingAdoptionBinding(argumentsValue({
    goodsId: "608570473054516",
  })), null);
  assert.equal(temuExistingAdoptionBinding(argumentsValue({
    skuId: "123896921649275",
  })), null);
  assert.equal(temuExistingAdoptionBinding(argumentsValue({ extra: true })), null);
});

test("Temu credential certification binds one exact read-only marker and redacts token material", () => {
  const binding = temuCredentialCertificationBinding(credentialCertificationArguments());
  assert.deepEqual(binding, {
    contract: temuCredentialCertificationContract,
    reviewId,
    productId: temuExistingAdoptionIdentity.productId,
    credentialId,
    goodsId: temuExistingAdoptionIdentity.goodsId,
    skuId: temuExistingAdoptionIdentity.skuId,
  });
  assert.equal(temuCredentialCertificationBinding({
    ...credentialCertificationArguments(),
    sellerpilotReadOnly: false,
  }), null);
  assert.equal(temuCredentialCertificationBinding(credentialCertificationArguments({
    goodsId: "608570473054516",
  })), null);
  const identity = normalizeTemuCredentialIdentityObservation(
    accessTokenInfoData({ accessToken: "must-not-be-returned" }),
    new Date("2026-09-01T09:00:00.000Z"),
  );
  assert.ok(identity);
  assert.equal(identity.mallId, "1024");
  assert.equal(identity.sellerSubject, "temu:mall:1024");
  assert.match(identity.sellerAccountKey, /^[a-f0-9]{64}$/u);
  assert.match(identity.apiScopeDigest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(identity).includes("must-not-be-returned"), false);
  assert.equal(normalizeTemuCredentialIdentityObservation(accessTokenInfoData({
    mallId: " 1024",
  })), null);
  assert.equal(normalizeTemuCredentialIdentityObservation(accessTokenInfoData({
    apiScopeList: ["bg.local.goods.publish.status.get"],
  })), null);
  assert.equal(normalizeTemuCredentialIdentityObservation(accessTokenInfoData({
    apiScopeList: ["bg.open.accesstoken.info.get", "bg.open.accesstoken.info.get"],
  })), null);
});

test("Temu credential certification calls only access-token info and emits no secret", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let providerMutations = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    methods.push(String(body.type));
    return Response.json({
      ...accessTokenInfoData({ accessToken: "provider-secret-token" }),
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.publication.verify",
      environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: credentialCertificationArguments(),
      providerMutationHooks: {
        assertLeaseHealthy: async () => undefined,
        begin: async () => { providerMutations += 1; },
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(methods, ["bg.open.accesstoken.info.get"]);
    assert.equal(providerMutations, 0);
    assert.equal(JSON.stringify(result).includes("provider-secret-token"), false);
    assert.equal(JSON.stringify(result).includes("accessToken"), false);
    assert.equal(result.steps[0]?.data.sellerpilotNoSecretStored, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh ACTIVE Korean KRW readback with one hero and eight distinct details is digest-bound", () => {
  const verified = observation();
  assert.ok(verified);
  assert.equal(verified.goodsId, temuExistingAdoptionIdentity.goodsId);
  assert.equal(verified.skuId, temuExistingAdoptionIdentity.skuId);
  assert.equal(verified.externalGoodsId, externalGoodsId);
  assert.equal(verified.externalSkuId, externalSkuId);
  assert.equal(verified.visibility, "live");
  assert.equal(verified.locale, "ko-KR");
  assert.equal(verified.currency, "KRW");
  assert.equal(verified.price, "5000");
  assert.equal(verified.stock, 1);
  assert.equal(verified.representativeImages.length, 1);
  assert.equal(verified.detailImages.length, 8);
  assert.match(verified.digest, /^[a-f0-9]{64}$/u);
  assert.equal(observation()?.digest, verified.digest);
});

test("Temu existing adoption fails closed on status, locale, commerce, SKU, and image drift", () => {
  assert.equal(observation({ status: statusData({ statusName: "INACTIVE" }) }), null);
  assert.equal(observation({ detail: detailData({ language: "en" }) }), null);
  assert.equal(observation({ detail: detailData({
    skuList: [{
      skuId: temuExistingAdoptionIdentity.skuId,
      outSkuSn: externalSkuId,
      retailPrice: { amount: "5000", currency: "USD" },
    }],
  }) }), null);
  assert.equal(observation({ stock: stockData({ skuId: "123896921649275" }) }), null);
  assert.equal(observation({ detail: detailData({
    goodsGallery: {
      goodsCarouselImage: representativeImages,
      detailImage: detailImages.slice(0, 7),
    },
  }) }), null);
});

test("serverless gateway accepts only the exact adoption marker without opening a provider mutation fence", async () => {
  const events: string[] = [];
  const job: GatewayClaim = {
    id: reviewId,
    claim_token: "63000000-0000-4000-8000-000000000001",
    credential_id: credentialId,
    channel: "temu",
    operation: "listing.publication.verify",
    environment: "production",
    request: { arguments: argumentsValue() },
    credential: { app_key: "test", app_secret: "test" },
    attempt_count: 1,
  };
  const result = await executeServerlessGatewayProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("provider-mutation"); },
      beginCredentialMutation: async () => { events.push("credential-mutation"); },
      stageCredentialRefresh: async () => { events.push("credential-stage"); },
    },
  }, async (input) => {
    events.push("read-only-provider");
    assert.equal(input.operation, "listing.publication.verify");
    assert.ok(temuExistingAdoptionBinding(input.arguments));
    return {
      ok: true,
      channel: "temu",
      operation: "listing.publication.verify",
      remoteId: temuExistingAdoptionIdentity.goodsId,
      steps: [{ name: "observation", ok: true, status: 200, data: {} }],
      safeMessage: "verified",
    };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["lease", "read-only-provider"]);
});

test("Temu exact adoption executes four independent reads and returns one digest-bound observation", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let providerMutations = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const method = String(body.type);
    methods.push(method);
    if (method === "bg.local.goods.detail.query") return Response.json(detailData());
    if (method === "bg.local.goods.publish.status.get") return Response.json(statusData());
    if (method === "temu.local.goods.sku.stock.query") return Response.json(stockData());
    if (method === "temu.local.goods.list.retrieve") return Response.json(listData());
    throw new Error(`unexpected Temu adoption method: ${method}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.publication.verify",
      environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: argumentsValue(),
      providerMutationHooks: {
        assertLeaseHealthy: async () => undefined,
        begin: async () => { providerMutations += 1; },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, temuExistingAdoptionIdentity.goodsId);
    assert.equal(result.steps.length, 5);
    assert.equal(result.steps.at(-1)?.name, "temu-existing-adoption-observation");
    assert.match(
      String(result.steps.at(-1)?.data.sellerpilotTemuExistingAdoptionObservation
        && (result.steps.at(-1)?.data.sellerpilotTemuExistingAdoptionObservation as { digest?: unknown }).digest),
      /^[a-f0-9]{64}$/u,
    );
    assert.equal(providerMutations, 0);
    assert.deepEqual(methods.sort(), [
      "bg.local.goods.detail.query",
      "bg.local.goods.publish.status.get",
      "temu.local.goods.list.retrieve",
      "temu.local.goods.sku.stock.query",
    ].sort());
  } finally {
    globalThis.fetch = originalFetch;
  }
});
