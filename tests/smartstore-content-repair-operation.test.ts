import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import {
  gatewayJobCompletionStatus,
  smartstoreContentRepairWorkerResultSchema,
} from "../lib/channels/gateway-contract";
import { executeChannelOperation } from "../lib/channels/operations";
import { buildSmartstoreContentRepairResult } from "../lib/channels/smartstore-content-repair-result";
import { smartstoreNaverDetailHtmlMatches } from "../lib/channels/smartstore-content-repair-readback";
import {
  smartstoreContentRepairArgument,
  smartstoreContentRepairBodyHashes,
} from "../lib/channels/smartstore-content-repair";
import { smartstoreContentRepairTransmissionArgument } from "../lib/channels/smartstore-content-repair-contract";
import { collectSmartstoreManualAdoptionReadback } from "../lib/server-smartstore-manual-adoption";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  baseline: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  listing: "44444444-4444-4444-8444-444444444444",
  job: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  credential: "77777777-7777-4777-8777-777777777777",
};
const originProductNo = "13688607602";
const channelProductNo = "13749310594";
const sellerSku = "SP-REPAIR-TEST";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const imageRoles = [
  "detail-overview", "detail-use", "detail-contents", "detail-routine",
  "detail-material", "detail-feature", "detail-storage", "detail-package",
];

function approvedDetailHtml(urls: string[]) {
  return `<div data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14">${imageRoles.map((role, index) =>
    `<section data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${role}"><p>${index === 0 ? "315g &times; 6봉 &middot; 승인 문구" : `승인 섹션 ${index}`}</p><img src="${urls[index]}" alt="승인 ${index}"></section>`,
  ).join("")}<section data-sellerpilot-puck-block="story"><p>원재료는 포장 확인</p></section><p data-sellerpilot-puck-evidence="true">근거</p></div>`;
}

function naverSerializedDetailHtml(value: string) {
  let html = value.replace(
    '<div data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14"',
    '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14") --><div',
  );
  for (const role of imageRoles) {
    html = html.replace(
      `<section data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${role}"`,
      `<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${role}") --><section`,
    );
  }
  return html
    .replace(
      '<section data-sellerpilot-puck-block="story"',
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="story") --><section',
    )
    .replace(
      '<p data-sellerpilot-puck-evidence="true"',
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-evidence="true") --><p',
    )
    .replaceAll("&times;", "×")
    .replaceAll("&middot;", "·");
}

function fixture() {
  const currentOrigin = {
    statusType: "SALE",
    leafCategoryId: "50022679",
    name: "원격 이전 제목",
    detailContent: "<p>원격 이전 설명</p>",
    salePrice: 3190,
    stockQuantity: 1,
    deliveryInfo: { deliveryType: "DELIVERY", deliveryFee: { deliveryFeeType: "PAID", baseFee: 3000 } },
    detailAttribute: { sellerCodeInfo: { sellerManagementCode: sellerSku } },
    images: { representativeImage: { url: "https://old.example/representative.jpg" }, optionalImages: [] },
  };
  const currentChannel = {
    channelProductName: "원격 이전 제목",
    channelProductDisplayStatusType: "ON",
    naverShoppingRegistration: true,
  };
  const hashes = smartstoreContentRepairBodyHashes({
    originProduct: currentOrigin,
    smartstoreChannelProduct: currentChannel,
  });
  const approvedImages = {
    representativeImage: { url: "https://shop-phinf.pstatic.net/new-representative.jpg" },
    optionalImages: Array.from({ length: 8 }, (_, index) => ({
      url: `https://shop-phinf.pstatic.net/new-detail-${index}.jpg`,
    })),
  };
  const body = {
    originProduct: {
      ...structuredClone(currentOrigin),
      name: "승인 제목",
      detailContent: approvedDetailHtml(
        approvedImages.optionalImages.map((image) => image.url),
      ),
      images: approvedImages,
    },
    smartstoreChannelProduct: {
      ...structuredClone(currentChannel),
      channelProductName: "승인 채널 제목",
    },
  };
  const marker = {
    contract: "smartstore_existing_content_repair_job_v1" as const,
    ownerId: ids.owner,
    baselineId: ids.baseline,
    productId: ids.product,
    listingId: ids.listing,
    sourceJobId: ids.job,
    sourceAttemptId: ids.attempt,
    credentialId: ids.credential,
    sellerAccountKey: digest("seller-account"),
    sellerSku,
    originProductNo,
    channelProductNo,
    approvalRevision: 1,
    contentSha256: digest("content"),
    manifestDigest: digest("manifest"),
    ...hashes,
  };
  const transmission = Array.from({ length: 8 }, (_, index) => {
    const contentSha256 = digest(`detail-${index}`);
    return {
      index,
      url: `https://project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`,
      contentSha256,
      decodedRgbaSha256: digest(`pixel-${index}`),
      width: 1000,
      height: 1000,
    };
  });
  return { currentOrigin, currentChannel, body, marker, transmission };
}

async function executeRepairWithPostwriteMutation(
  mutate: (state: {
    originProduct: Record<string, unknown>;
    smartstoreChannelProduct: Record<string, unknown>;
  }) => void,
  postwriteFailure?: "network" | "malformed",
) {
  const originalFetch = globalThis.fetch;
  const state = fixture();
  let written: Record<string, unknown> | null = null;
  let putCount = 0;
  let searchCount = 0;
  let originGetCount = 0;
  let channelGetCount = 0;
  const providerState = () => {
    const body = structuredClone(written!);
    const originProduct = body.originProduct as Record<string, unknown>;
    originProduct.detailContent = naverSerializedDetailHtml(String(originProduct.detailContent));
    const postwrite = {
      originProduct,
      smartstoreChannelProduct: body.smartstoreChannelProduct as Record<string, unknown>,
    };
    mutate(postwrite);
    return postwrite;
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return Response.json({ access_token: "token", expires_in: 10_800 });
    }
    if (url.endsWith("/v1/products/search")) {
      searchCount += 1;
      if (searchCount === 2 && postwriteFailure === "network") {
        throw new Error("socket error with unsafe provider detail");
      }
      return Response.json({
        page: 1, size: 50,
        totalElements: searchCount === 2 && postwriteFailure === "malformed" ? 0 : 1,
        totalPages: 1, first: true, last: true,
        contents: [{ originProductNo, channelProducts: [{ channelProductNo, sellerManagementCode: sellerSku }] }],
      });
    }
    if (url.endsWith(`/v2/products/channel-products/${channelProductNo}`)) {
      channelGetCount += 1;
      return Response.json(written ? providerState() : {
        originProduct: structuredClone(state.currentOrigin),
        smartstoreChannelProduct: structuredClone(state.currentChannel),
      });
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`) && init?.method === "PUT") {
      putCount += 1;
      written = JSON.parse(String(init.body));
      return Response.json({});
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`)) {
      originGetCount += 1;
      return Response.json(written
        ? { originProduct: providerState().originProduct }
        : { originProduct: structuredClone(state.currentOrigin) });
    }
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.update",
      environment: "production",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller" },
      arguments: {
        originProductNo,
        body: state.body,
        imageUrls: [],
        [smartstoreContentRepairArgument]: state.marker,
        [smartstoreContentRepairTransmissionArgument]: state.transmission,
      },
    });
    return { operation, putCount, searchCount, originGetCount, channelGetCount };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("SmartStore repair binds unique search identity, preserves commerce, and emits prewrite evidence", async () => {
  const originalFetch = globalThis.fetch;
  const state = fixture();
  const providerDetailBytes = await Promise.all(Array.from({ length: 8 }, (_, index) => (
    sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: { r: index * 25, g: 180 - index * 15, b: 80 + index * 10 },
      },
    }).jpeg().toBuffer()
  )));
  for (const [index, bytes] of providerDetailBytes.entries()) {
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const decoded = await sharp(bytes).rotate().toColourspace("srgb").ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    state.transmission[index] = {
      ...state.transmission[index]!,
      url: `https://project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`,
      contentSha256,
      decodedRgbaSha256: createHash("sha256")
        .update(Buffer.concat([Buffer.from("600x600:RGBA\n"), decoded.data]))
        .digest("hex"),
    };
  }
  let written: Record<string, unknown> | null = null;
  let putCount = 0;
  let searchCount = 0;
  let originGetCount = 0;
  let channelGetCount = 0;
  const providerState = () => {
    const body = structuredClone(written!);
    const originProduct = body.originProduct as Record<string, unknown>;
    originProduct.detailContent = naverSerializedDetailHtml(String(originProduct.detailContent));
    return {
      originProduct,
      smartstoreChannelProduct: body.smartstoreChannelProduct as Record<string, unknown>,
    };
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 10_800 });
    if (url.endsWith("/v1/products/search")) {
      searchCount += 1;
      return Response.json({
        page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
        contents: [{ originProductNo, channelProducts: [{ channelProductNo, sellerManagementCode: sellerSku }] }],
      });
    }
    if (url.endsWith(`/v2/products/channel-products/${channelProductNo}`)) {
      channelGetCount += 1;
      return Response.json(written ? providerState() : {
        originProduct: structuredClone(state.currentOrigin),
        smartstoreChannelProduct: structuredClone(state.currentChannel),
      });
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`) && init?.method === "PUT") {
      putCount += 1;
      written = JSON.parse(String(init.body));
      return Response.json({});
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`)) {
      originGetCount += 1;
      return Response.json(written
        ? { originProduct: providerState().originProduct }
        : { originProduct: structuredClone(state.currentOrigin) });
    }
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.update",
      environment: "production",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller" },
      arguments: {
        originProductNo,
        body: state.body,
        imageUrls: [],
        [smartstoreContentRepairArgument]: state.marker,
        [smartstoreContentRepairTransmissionArgument]: state.transmission,
      },
    });
    assert.equal(operation.ok, true);
    assert.equal(putCount, 1);
    assert.equal(searchCount, 2);
    assert.equal(originGetCount, 2);
    assert.equal(channelGetCount, 2);
    assert.equal((written?.originProduct as Record<string, unknown>).salePrice, 3190);
    assert.equal((written?.originProduct as Record<string, unknown>).stockQuantity, 1);
    assert.equal((written?.originProduct as Record<string, unknown>).name, "승인 제목");
    assert.equal(
      (written?.smartstoreChannelProduct as Record<string, unknown>).channelProductName,
      "승인 채널 제목",
    );
    assert.deepEqual(operation.smartstoreContentRepair, {
      contract: "smartstore_existing_content_repair_mutation_v1",
      originProductNo,
      channelProductNo,
      baselineBodySha256: state.marker.baselineBodySha256,
      prewriteProtectedBodySha256: state.marker.protectedBodySha256,
      prewriteOriginResponseSha256: operation.smartstoreContentRepair?.prewriteOriginResponseSha256,
      prewriteChannelResponseSha256: operation.smartstoreContentRepair?.prewriteChannelResponseSha256,
    });
    assert.match(operation.smartstoreContentRepair?.prewriteOriginResponseSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(operation.smartstoreContentRepair?.prewriteChannelResponseSha256 ?? "", /^[a-f0-9]{64}$/u);
    const postwrite = providerState();
    const postwriteReadback = await collectSmartstoreManualAdoptionReadback(
      { credential: {}, target: { sellerSku } },
      {
        accessToken: async () => "token",
        normalizedImageProjectUrl: "https://project.supabase.co",
        now: () => new Date("2026-09-07T06:47:02.000Z"),
        downloadImage: async (url) => {
          const match = url.match(/new-detail-(\d+)\.jpg$/u);
          assert.ok(match);
          return { bytes: providerDetailBytes[Number(match[1])!]!, contentType: "image/jpeg" };
        },
        request: async (requestInput) => {
          let data: Record<string, unknown>;
          if (requestInput.path === "/v1/products/search") {
            data = {
              page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
              contents: [{ originProductNo, channelProducts: [{ channelProductNo, sellerManagementCode: sellerSku }] }],
            };
          } else if (requestInput.path === `/v2/products/origin-products/${originProductNo}`) {
            data = { originProduct: structuredClone(postwrite.originProduct) };
          } else if (requestInput.path === `/v2/products/channel-products/${channelProductNo}`) {
            data = {
              originProduct: structuredClone(postwrite.originProduct),
              smartstoreChannelProduct: structuredClone(postwrite.smartstoreChannelProduct),
            };
          } else {
            throw new Error(`unexpected readback path ${requestInput.path}`);
          }
          return { response: new Response(JSON.stringify(data), { status: 200 }), data };
        },
      },
    );
    const evidence = buildSmartstoreContentRepairResult({
      binding: state.marker,
      mutationEvidence: operation.smartstoreContentRepair,
      approvedTransmissionImages: state.transmission,
      postwriteReadback,
    });
    const workerResult = smartstoreContentRepairWorkerResultSchema.parse({
      ok: true,
      channel: "smartstore",
      operation: "listing.update",
      steps: operation.steps,
      remoteId: originProductNo,
      evidence,
      safeMessage: "스마트스토어 콘텐츠 수정 후 공식 재조회를 검증했습니다.",
    });
    assert.equal(workerResult.evidence.postwriteReadback.channelReadback.path,
      `/v2/products/channel-products/${channelProductNo}`);
    assert.equal(workerResult.evidence.approvedTransmissionImages.length, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SmartStore Naver HTML comparison permits only exact tag-bound filter comments", () => {
  const source = approvedDetailHtml(
    Array.from({ length: 8 }, (_, index) => `https://source.example/${index}.jpg`),
  );
  const provider = naverSerializedDetailHtml(source).replaceAll(
    /https:\/\/source\.example\/\d+\.jpg/gu,
    (url) => url.replace("source.example", "shop-phinf.pstatic.net"),
  );
  assert.equal(smartstoreNaverDetailHtmlMatches(source, provider), true);
  assert.equal(smartstoreNaverDetailHtmlMatches(
    source,
    provider.replace('data-sellerpilot-image-role="detail-use"', 'data-sellerpilot-image-role="other"'),
  ), false);
  assert.equal(smartstoreNaverDetailHtmlMatches(
    source,
    provider.replace("Filtered ( data-sellerpilot-puck-detail", "Filtered (  data-sellerpilot-puck-detail"),
  ), false);
  assert.equal(smartstoreNaverDetailHtmlMatches(
    `${source}<p>data-sellerpilot-puck-evidence="true"</p>`,
    `${provider}<p></p>`,
  ), false);
});

test("SmartStore repair treats a provider write failure as reconciliation and never retries PUT", async () => {
  const originalFetch = globalThis.fetch;
  const state = fixture();
  let putCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 10_800 });
    if (url.endsWith("/v1/products/search")) return Response.json({
      page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
      contents: [{ originProductNo, channelProducts: [{ channelProductNo, sellerManagementCode: sellerSku }] }],
    });
    if (url.endsWith(`/v2/products/channel-products/${channelProductNo}`)) return Response.json({
      originProduct: state.currentOrigin,
      smartstoreChannelProduct: state.currentChannel,
    });
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`) && init?.method === "PUT") {
      putCount += 1;
      return Response.json({ code: "INTERNAL" }, { status: 503 });
    }
    return Response.json({ originProduct: state.currentOrigin, smartstoreChannelProduct: state.currentChannel });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore", operation: "listing.update", environment: "production",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller" },
      arguments: {
        originProductNo, body: state.body, imageUrls: [],
        [smartstoreContentRepairArgument]: state.marker,
        [smartstoreContentRepairTransmissionArgument]: state.transmission,
      },
    });
    assert.equal(operation.ok, false);
    assert.equal(putCount, 1);
    assert.equal(gatewayJobCompletionStatus(operation.operation, operation.ok, operation.steps), "reconciliation_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SmartStore repair rejects every postwrite mutable or protected drift after one PUT", async () => {
  const cases: Array<{
    expectedPath: string;
    mutate: Parameters<typeof executeRepairWithPostwriteMutation>[0];
  }> = [
    {
      expectedPath: "originProduct.name",
      mutate: (state) => { state.originProduct.name = "다른 원상품명"; },
    },
    {
      expectedPath: "smartstoreChannelProduct.channelProductName",
      mutate: (state) => { state.smartstoreChannelProduct.channelProductName = "다른 채널상품명"; },
    },
    {
      expectedPath: "originProduct.detailContent",
      mutate: (state) => {
        state.originProduct.detailContent = String(state.originProduct.detailContent)
          .replace("승인 문구", "변조 문구");
      },
    },
    {
      expectedPath: "originProduct.images",
      mutate: (state) => {
        const images = state.originProduct.images as {
          optionalImages: Array<{ url: string }>;
        };
        [images.optionalImages[0], images.optionalImages[1]] = [
          images.optionalImages[1]!, images.optionalImages[0]!,
        ];
      },
    },
    {
      expectedPath: "originProduct.salePrice",
      mutate: (state) => { state.originProduct.salePrice = 5000; },
    },
    {
      expectedPath: "originProduct.stockQuantity",
      mutate: (state) => { state.originProduct.stockQuantity = 2; },
    },
  ];
  for (const scenario of cases) {
    const { operation, putCount } = await executeRepairWithPostwriteMutation(scenario.mutate);
    assert.equal(putCount, 1, scenario.expectedPath);
    assert.equal(operation.ok, false, scenario.expectedPath);
    const verification = operation.steps.find(
      (candidate) => candidate.name === "smartstore-content-repair-postwrite-verification",
    );
    assert.ok(verification, scenario.expectedPath);
    assert.ok(
      (verification.data.sellerpilotMismatchPaths as string[]).includes(scenario.expectedPath),
      scenario.expectedPath,
    );
    assert.equal(
      gatewayJobCompletionStatus(operation.operation, operation.ok, operation.steps),
      "reconciliation_required",
      scenario.expectedPath,
    );
  }
});

test("SmartStore repair preserves the accepted PUT result when postwrite identity cannot be read", async () => {
  for (const failure of ["network", "malformed"] as const) {
    const outcome = await executeRepairWithPostwriteMutation(() => {}, failure);
    assert.equal(outcome.putCount, 1, failure);
    assert.equal(outcome.searchCount, 2, failure);
    assert.equal(outcome.originGetCount, 1, failure);
    assert.equal(outcome.channelGetCount, 1, failure);
    assert.equal(outcome.operation.ok, false, failure);
    assert.equal(
      outcome.operation.steps.find((candidate) => candidate.name === "product-update")?.ok,
      true,
      failure,
    );
    const identityFailure = outcome.operation.steps.find(
      (candidate) => candidate.name === "smartstore-content-repair-postwrite-identity",
    );
    assert.ok(identityFailure, failure);
    assert.equal(
      identityFailure.data.sellerpilotFailureCode,
      failure === "malformed"
        ? "NAVER_UPDATE_SEARCH_PREFLIGHT_FAILED"
        : "NAVER_UPDATE_POSTWRITE_IDENTITY_UNVERIFIED",
      failure,
    );
    assert.equal(JSON.stringify(identityFailure.data).includes("unsafe provider detail"), false);
    assert.equal(
      gatewayJobCompletionStatus(
        outcome.operation.operation,
        outcome.operation.ok,
        outcome.operation.steps,
      ),
      "reconciliation_required",
      failure,
    );
  }
});
