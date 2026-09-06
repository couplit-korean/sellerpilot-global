import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  smartstoreContentRepairArgument,
  smartstoreContentRepairBodyHashes,
} from "../lib/channels/smartstore-content-repair";
import { smartstoreContentRepairTransmissionArgument } from "../lib/channels/smartstore-content-repair-contract";

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
      detailContent: Array.from({ length: 8 }, (_, index) => (
        `<img src="https://shop-phinf.pstatic.net/new-detail-${index}.jpg" />`
      )).join(""),
      images: approvedImages,
    },
    smartstoreChannelProduct: {
      ...structuredClone(currentChannel),
      channelProductName: "승인 제목",
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

test("SmartStore repair binds unique search identity, preserves commerce, and emits prewrite evidence", async () => {
  const originalFetch = globalThis.fetch;
  const state = fixture();
  let written: Record<string, unknown> | null = null;
  let putCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 10_800 });
    if (url.endsWith("/v1/products/search")) return Response.json({
      page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
      contents: [{ originProductNo, channelProducts: [{ channelProductNo, sellerManagementCode: sellerSku }] }],
    });
    if (url.endsWith(`/v2/products/channel-products/${channelProductNo}`)) return Response.json({
      originProduct: structuredClone(state.currentOrigin),
      smartstoreChannelProduct: structuredClone(state.currentChannel),
    });
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`) && init?.method === "PUT") {
      putCount += 1;
      written = JSON.parse(String(init.body));
      return Response.json({});
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`)) {
      return Response.json(written ?? {
        originProduct: structuredClone(state.currentOrigin),
        smartstoreChannelProduct: structuredClone(state.currentChannel),
      });
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
    assert.equal((written?.originProduct as Record<string, unknown>).salePrice, 3190);
    assert.equal((written?.originProduct as Record<string, unknown>).stockQuantity, 1);
    assert.equal((written?.originProduct as Record<string, unknown>).name, "승인 제목");
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
  } finally {
    globalThis.fetch = originalFetch;
  }
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
