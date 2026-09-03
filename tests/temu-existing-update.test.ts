import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  bindTemuExactExistingUpdateArguments,
  temuExactExistingUpdateArgument,
  temuExactExistingUpdateCandidate,
  temuExactExistingUpdateContract,
  temuExactExistingUpdateIdentity,
  temuExactExistingUpdateRequest,
  type TemuExactExistingUpdateBinding,
} from "../lib/channels/temu-existing-update";
import { buildListingPublicationAssetBinding } from "../lib/channels/marketplace-images";
import type { GatewayClaim } from "../lib/channels/gateway-contract";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeChannelOperation } = await import("../lib/channels/operations");
const { executeServerlessGatewayProviderJob } = await import(
  "../lib/channels/serverless-gateway-provider"
);

const binding: TemuExactExistingUpdateBinding = {
  contract: temuExactExistingUpdateContract,
  productId: temuExactExistingUpdateIdentity.productId,
  listingId: "61000000-0000-4000-8000-000000000001",
  credentialId: "62000000-0000-4000-8000-000000000001",
  goodsId: temuExactExistingUpdateIdentity.goodsId,
  skuId: temuExactExistingUpdateIdentity.skuId,
  externalGoodsId: "QA-TEMU-EXISTING-001",
  externalSkuId: "QA-TEMU-EXISTING-001-SKU",
  sellerAccountKey: createHash("sha256")
    .update("temu\u001fproduction\u001ftemu:mall:1024", "utf8")
    .digest("hex"),
  approvedManifestDigest: "b".repeat(64),
  releaseSha: "c".repeat(40),
};
const fingerprint = "d".repeat(64);
const representativeDigest = "a".repeat(64);
const representativeImages = [
  `https://demo.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${representativeDigest.slice(0, 2)}/${representativeDigest}.jpg`,
];
const detailDigests = Array.from(
  { length: 8 },
  (_, index) => String(index + 1).repeat(64),
);
const detailImages = detailDigests.map((digest) =>
  `https://demo.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
const detailRoles = Array.from({ length: 8 }, (_, index) => `detail-role-${index + 1}`);
const assetBinding = buildListingPublicationAssetBinding({
  approvedDetailPageVersion: 1,
  approvedManifestDigest: binding.approvedManifestDigest,
  approvedDetailRoles: detailRoles,
  approvedDetailImagePaths: detailRoles.map((role) =>
    `results/61000000-0000-4000-8000-000000000001/claims/62000000-0000-4000-8000-000000000001/${role}.png`),
  approvedDetailImageSha256s: detailDigests,
  approvedDetailImageUrls: detailImages,
  providerImageSurface: "detail_content",
  providerTransportRoles: detailRoles,
  providerTransportUrls: detailImages,
});
assert.ok(assetBinding);
const requestedContent = {
  goodsName: "케이블 정리 클립 6개 세트",
  goodsDesc: "책상과 차량의 케이블을 깔끔하게 정리하는 한국어 상품 설명입니다.",
  bulletPoints: ["간편하게 부착할 수 있습니다.", "여러 공간에서 활용할 수 있습니다."],
};

function sourceArguments() {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: fingerprint,
    sellerpilotPublicationAssetBinding: assetBinding,
    body: {
      language: "ko",
      goodsBasic: {
        externalGoodsId: binding.externalGoodsId,
        ...requestedContent,
        goodsCarouselImage: representativeImages,
        detailImage: detailImages,
      },
      skuList: [{
        externalSkuId: binding.externalSkuId,
        price: { basePrice: { amount: "5000", currency: "KRW" } },
        quantity: 1,
      }],
    },
    [temuExactExistingUpdateArgument]: { forged: true },
  };
}

function listData() {
  return {
    success: true,
    result: { goodsList: [{
      goodsId: binding.goodsId,
      outGoodsSn: binding.externalGoodsId,
      goodsStatus: "ACTIVE",
    }] },
  };
}

function statusData() {
  return {
    success: true,
    result: { goodsPublishStatusList: [{
      goodsId: binding.goodsId,
      statusName: "ACTIVE",
    }] },
  };
}

function detailData(updated: boolean) {
  return {
    success: true,
    result: {
      goodsId: binding.goodsId,
      outGoodsSn: binding.externalGoodsId,
      language: "ko",
      ...(updated ? requestedContent : {
        goodsName: "기존 상품명",
        goodsDesc: "기존 한국어 상품 설명입니다.",
        bulletPoints: ["기존 상품 정보입니다."],
      }),
      goodsGallery: {
        goodsCarouselImage: representativeImages,
        detailImage: detailImages,
      },
      skuList: [{
        skuId: binding.skuId,
        outSkuSn: binding.externalSkuId,
        retailPrice: { amount: "5000", currency: "KRW" },
      }],
    },
  };
}

function stockData() {
  return {
    success: true,
    result: { stockList: [{
      goodsId: binding.goodsId,
      skuStockInfoList: [{
        skuId: binding.skuId,
        outSkuSn: binding.externalSkuId,
        selfOrdinaryStock: { stock: 1 },
      }],
    }] },
  };
}

test("Temu exact existing update binds only the adopted ACTIVE item and immutable commerce", () => {
  assert.equal(temuExactExistingUpdateCandidate({
    channel: "temu",
    operation: "listing.update",
    productId: binding.productId,
    remoteId: binding.goodsId,
    status: "published",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  }), true);
  assert.equal(temuExactExistingUpdateCandidate({
    channel: "temu",
    operation: "listing.create",
    productId: binding.productId,
    remoteId: binding.goodsId,
    status: "published",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  }), false);

  const exact = bindTemuExactExistingUpdateArguments(sourceArguments(), binding);
  const request = temuExactExistingUpdateRequest(exact);
  assert.ok(request);
  assert.equal(JSON.stringify(exact).includes("forged"), false);
  assert.deepEqual(request.providerArguments, {
    goodsId: binding.goodsId,
    ...requestedContent,
  });
  assert.equal(request.expectedSkus[0]?.skuId, binding.skuId);
  assert.deepEqual(request.expectedRepresentativeImages, representativeImages);
  assert.deepEqual(request.expectedDetailImages, detailImages);

  const wrongPrice = structuredClone(exact);
  (wrongPrice.body as { skuList: Array<{ price: { basePrice: { amount: string } } }> })
    .skuList[0].price.basePrice.amount = "5001";
  assert.equal(temuExactExistingUpdateRequest(wrongPrice), null);
  const duplicateImage = structuredClone(exact);
  (duplicateImage.body as { goodsBasic: { detailImage: string[] } })
    .goodsBasic.detailImage[7] = detailImages[0];
  assert.equal(temuExactExistingUpdateRequest(duplicateImage), null);
  const englishBullet = structuredClone(exact);
  (englishBullet.body as { goodsBasic: { bulletPoints: string[] } })
    .goodsBasic.bulletPoints[0] = "Easy to attach";
  assert.equal(temuExactExistingUpdateRequest(englishBullet), null);
  const assetDrift = structuredClone(exact);
  const preserved = assetDrift.sellerpilotTemuExactPreservedAssets as {
    detailImages: Array<{ approvedSourceSha256: string }>;
  };
  preserved.detailImages[0].approvedSourceSha256 = "f".repeat(64);
  assert.equal(temuExactExistingUpdateRequest(assetDrift), null);
});

test("Temu exact update performs one partial mutation between four-field pre/post readbacks", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let updated = false;
  let mutationBegins = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const method = String(body.type);
    methods.push(method);
    if (method === temuExactExistingUpdateIdentity.providerOperation) {
      assert.equal(updated, false);
      assert.equal(String(body.goodsId), binding.goodsId);
      assert.equal(body.goodsName, requestedContent.goodsName);
      assert.equal(body.goodsDesc, requestedContent.goodsDesc);
      assert.deepEqual(body.bulletPoints, requestedContent.bulletPoints);
      assert.deepEqual(
        Object.keys(body).filter((key) => [
          "goodsId", "goodsName", "goodsDesc", "bulletPoints",
          "price", "stock", "skuId", "skuList", "images", "status",
        ].includes(key)).sort(),
        ["bulletPoints", "goodsDesc", "goodsId", "goodsName"],
      );
      updated = true;
      return Response.json({ success: true, result: { goodsId: binding.goodsId } });
    }
    if (method === "bg.open.accesstoken.info.get") {
      return Response.json({
        success: true,
        result: {
          mallId: 1024,
          apiScopeList: [
            "bg.open.accesstoken.info.get",
            temuExactExistingUpdateIdentity.providerOperation,
          ],
        },
      });
    }
    if (method === "temu.local.goods.list.retrieve") return Response.json(listData());
    if (method === "bg.local.goods.publish.status.get") return Response.json(statusData());
    if (method === "bg.local.goods.detail.query") return Response.json(detailData(updated));
    if (method === "temu.local.goods.sku.stock.query") return Response.json(stockData());
    return Response.json({ success: false, errorMsg: `unexpected ${method}` }, { status: 400 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.update",
      environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: bindTemuExactExistingUpdateArguments(sourceArguments(), binding),
      providerMutationHooks: {
        assertLeaseHealthy: async () => undefined,
        begin: async () => { mutationBegins += 1; },
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(mutationBegins, 1);
    assert.equal(
      methods.filter((method) => method === temuExactExistingUpdateIdentity.providerOperation).length,
      1,
    );
    assert.equal(methods.length, 10);
    assert.deepEqual(methods, [
      "bg.open.accesstoken.info.get",
      "temu.local.goods.list.retrieve",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
      "temu.local.goods.sku.stock.query",
      temuExactExistingUpdateIdentity.providerOperation,
      "temu.local.goods.list.retrieve",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
      "temu.local.goods.sku.stock.query",
    ]);
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.locale, "ko-KR");
    assert.equal(
      result.remoteState?.evidence.contentDigest,
      createHash("sha256")
        .update(
          `${requestedContent.goodsName}\u001f${requestedContent.goodsDesc}\u001f${requestedContent.bulletPoints.join("\u001e")}`,
          "utf8",
        )
        .digest("hex"),
    );
    assert.equal(
      result.remoteState?.evidence.representativeImageDigest,
      createHash("sha256").update(JSON.stringify(representativeImages), "utf8").digest("hex"),
    );
    assert.equal(
      result.remoteState?.evidence.orderedDetailImageDigest,
      createHash("sha256").update(JSON.stringify(detailImages), "utf8").digest("hex"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu exact update fails before any provider request when its marker drifts", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return Response.json({ success: true });
  };
  try {
    const exact = bindTemuExactExistingUpdateArguments(sourceArguments(), binding);
    (exact[temuExactExistingUpdateArgument] as Record<string, unknown>).goodsId = "608570473054516";
    await assert.rejects(() => executeChannelOperation({
        channel: "temu",
        operation: "listing.update",
        environment: "production",
        payload: { app_key: "app", app_secret: "secret", access_token: "token" },
        arguments: exact,
        providerMutationHooks: {
          assertLeaseHealthy: async () => undefined,
          begin: async () => undefined,
        },
      }),
      /LISTING_UPDATE_NOT_RELEASED:temu/u,
    );
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu exact update never reaches the mutation without the current partial-update scope", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let mutationBegins = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    methods.push(String(body.type));
    return Response.json({
      success: true,
      result: {
        mallId: 1024,
        apiScopeList: ["bg.open.accesstoken.info.get"],
      },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.update",
      environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: bindTemuExactExistingUpdateArguments(sourceArguments(), binding),
      providerMutationHooks: {
        assertLeaseHealthy: async () => undefined,
        begin: async () => { mutationBegins += 1; },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(mutationBegins, 0);
    assert.deepEqual(methods, ["bg.open.accesstoken.info.get"]);
    assert.equal(result.steps[0]?.name, "temu-exact-update-current-credential");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serverless Temu exact update delays the provider fence until all pre-readbacks pass", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let updated = false;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const method = String(body.type);
    events.push(`fetch:${method}:${updated ? "post" : "pre"}`);
    if (method === temuExactExistingUpdateIdentity.providerOperation) {
      assert.equal(updated, false);
      updated = true;
      return Response.json({ success: true, result: { goodsId: binding.goodsId } });
    }
    if (method === "bg.open.accesstoken.info.get") {
      return Response.json({
        success: true,
        result: {
          mallId: 1024,
          apiScopeList: [
            "bg.open.accesstoken.info.get",
            temuExactExistingUpdateIdentity.providerOperation,
          ],
        },
      });
    }
    if (method === "temu.local.goods.list.retrieve") return Response.json(listData());
    if (method === "bg.local.goods.publish.status.get") return Response.json(statusData());
    if (method === "bg.local.goods.detail.query") return Response.json(detailData(updated));
    if (method === "temu.local.goods.sku.stock.query") return Response.json(stockData());
    return Response.json({ success: false, errorMsg: `unexpected ${method}` }, { status: 400 });
  };
  const job: GatewayClaim = {
    id: "63000000-0000-4000-8000-000000000001",
    claim_token: "64000000-0000-4000-8000-000000000001",
    credential_id: binding.credentialId,
    channel: "temu",
    operation: "listing.update",
    environment: "production",
    request: { arguments: bindTemuExactExistingUpdateArguments(sourceArguments(), binding) },
    credential: { app_key: "app", app_secret: "secret", access_token: "token" },
    attempt_count: 1,
  };
  try {
    const result = await executeServerlessGatewayProviderJob({
      job,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => { events.push("lease"); },
        beginProviderMutation: async () => { events.push("mutation-fence"); },
        beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
        stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(events.filter((event) => event === "mutation-fence").length, 1);
    const fenceIndex = events.indexOf("mutation-fence");
    const mutationIndex = events.findIndex((event) =>
      event.startsWith(`fetch:${temuExactExistingUpdateIdentity.providerOperation}:`));
    assert.ok(fenceIndex > 0 && mutationIndex > fenceIndex);
    for (const method of [
      "bg.open.accesstoken.info.get",
      "temu.local.goods.list.retrieve",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
      "temu.local.goods.sku.stock.query",
    ]) {
      assert.ok(events.findIndex((event) => event === `fetch:${method}:pre`) < fenceIndex);
    }
    for (const method of [
      "temu.local.goods.list.retrieve",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
      "temu.local.goods.sku.stock.query",
    ]) {
      assert.equal(events.filter((event) => event === `fetch:${method}:post`).length, 1);
      assert.ok(events.findIndex((event) => event === `fetch:${method}:post`) > mutationIndex);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serverless Temu non-exact update reaches neither provider nor mutation fence", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  let mutationBegins = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return Response.json({ success: true });
  };
  try {
    await assert.rejects(() => executeServerlessGatewayProviderJob({
      job: {
        id: "63000000-0000-4000-8000-000000000002",
        claim_token: "64000000-0000-4000-8000-000000000002",
        credential_id: binding.credentialId,
        channel: "temu",
        operation: "listing.update",
        environment: "production",
        request: { arguments: {} },
        credential: { app_key: "app", app_secret: "secret", access_token: "token" },
        attempt_count: 1,
      },
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { mutationBegins += 1; },
        beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
        stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      },
    }), /TEMU_EXACT_EXISTING_UPDATE_SERVER_CONTEXT_REQUIRED/u);
    assert.equal(fetches, 0);
    assert.equal(mutationBegins, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu exact preflight rejects changed remote SKU and non-ACTIVE live aliases before mutation", async () => {
  for (const drift of ["sku", "status"] as const) {
    const originalFetch = globalThis.fetch;
    let begins = 0;
    let fetches = 0;
    globalThis.fetch = async (_input, init) => {
      fetches += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const method = String(body.type);
      if (method === "bg.open.accesstoken.info.get") return Response.json({
        success: true,
        result: {
          mallId: 1024,
          apiScopeList: [
            "bg.open.accesstoken.info.get",
            temuExactExistingUpdateIdentity.providerOperation,
          ],
        },
      });
      if (method === "temu.local.goods.list.retrieve") {
        const value = listData();
        if (drift === "status") value.result.goodsList[0].goodsStatus = "PUBLISHED";
        return Response.json(value);
      }
      if (method === "bg.local.goods.publish.status.get") {
        const value = statusData();
        if (drift === "status") value.result.goodsPublishStatusList[0].statusName = "PUBLISHED";
        return Response.json(value);
      }
      if (method === "bg.local.goods.detail.query") {
        const value = detailData(false);
        if (drift === "sku") value.result.skuList[0].skuId = "123896921649275";
        return Response.json(value);
      }
      if (method === "temu.local.goods.sku.stock.query") {
        const value = stockData();
        if (drift === "sku") value.result.stockList[0].skuStockInfoList[0].skuId = "123896921649275";
        return Response.json(value);
      }
      return Response.json({ success: false }, { status: 400 });
    };
    try {
      const result = await executeChannelOperation({
        channel: "temu",
        operation: "listing.update",
        environment: "production",
        payload: { app_key: "app", app_secret: "secret", access_token: "token" },
        arguments: bindTemuExactExistingUpdateArguments(sourceArguments(), binding),
        providerMutationHooks: {
          assertLeaseHealthy: async () => undefined,
          begin: async () => { begins += 1; },
        },
      });
      assert.equal(result.ok, false, drift);
      assert.equal(begins, 0, drift);
      assert.equal(fetches, 5, drift);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("Temu operator copy names every mutable content field", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
  assert.match(source, /한국어 제목·설명·핵심 bullet만 1회 부분 수정/u);
  assert.doesNotMatch(source, /한국어 제목·설명만 1회 부분 수정/u);
});
