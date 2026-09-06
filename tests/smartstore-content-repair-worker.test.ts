import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  gatewayWorkerCompletionSchema,
  smartstoreContentRepairResultSchema,
} from "../lib/channels/gateway-contract";
import { smartstoreContentRepairBodyHashes } from "../lib/channels/smartstore-content-repair";
import { buildSmartstoreContentRepairResult } from "../lib/channels/smartstore-content-repair-result";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const originProductNo = "13688607602";
const channelProductNo = "13749310594";

function evidence() {
  const approvedTransmissionImages = Array.from({ length: 8 }, (_, index) => {
    const contentSha256 = hash(`content-${index}`);
    return {
      index,
      url: `https://project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`,
      contentSha256,
      decodedRgbaSha256: hash(`pixel-${index}`),
      width: 1000,
      height: 1000,
    };
  });
  const postwriteReadback = {
    contract: "smartstore_official_manual_adoption_readback_v1" as const,
    source: "smartstore_official_api_readback_v1" as const,
    observedAt: "2026-09-07T10:00:00.000Z",
    providerMutationPerformed: false as const,
    searchReadback: {
      method: "POST" as const,
      path: "/v1/products/search" as const,
      httpStatus: 200 as const,
      request: { searchKeywordType: "SELLER_CODE", sellerManagementCode: "SP-REPAIR" },
      response: { contents: [] },
    },
    originReadback: {
      method: "GET" as const,
      path: `/v2/products/origin-products/${originProductNo}`,
      httpStatus: 200 as const,
      request: null,
      response: { originProduct: { statusType: "SALE" } },
    },
    channelReadback: {
      method: "GET" as const,
      path: `/v2/products/channel-products/${channelProductNo}`,
      httpStatus: 200 as const,
      request: null,
      response: { smartstoreChannelProduct: { channelProductDisplayStatusType: "ON" } },
    },
    detailImageUrls: Array.from({ length: 8 }, (_, index) => `https://shop-phinf.pstatic.net/${index}.jpg`),
    detailImagePixelSha256s: approvedTransmissionImages.map((image) => image.decodedRgbaSha256),
  };
  return {
    contract: "smartstore_existing_content_repair_result_v1" as const,
    source: "smartstore_official_content_repair_v1" as const,
    observedAt: postwriteReadback.observedAt,
    providerMutationPerformed: true as const,
    originProductNo,
    channelProductNo,
    baselineBodySha256: hash("baseline"),
    prewriteProtectedBodySha256: hash("protected"),
    postwriteProtectedBodySha256: hash("protected"),
    prewriteOriginResponseSha256: hash("pre-origin"),
    prewriteChannelResponseSha256: hash("pre-channel"),
    postwriteOriginResponseSha256: hash("post-origin"),
    postwriteChannelResponseSha256: hash("post-channel"),
    approvedTransmissionImages,
    postwriteReadback,
  };
}

test("repair evidence binds ordered transmitted JPEG pixels to the strict provider readback", () => {
  const exact = evidence();
  assert.equal(smartstoreContentRepairResultSchema.safeParse(exact).success, true);
  const completion = gatewayWorkerCompletionSchema.safeParse({
    jobId: "11111111-1111-4111-8111-111111111111",
    claimToken: "22222222-2222-4222-8222-222222222222",
    status: "succeeded",
    result: {
      ok: true,
      channel: "smartstore",
      operation: "listing.update",
      steps: [{ name: "product-update", ok: true, status: 200, data: {} }],
      remoteId: originProductNo,
      evidence: exact,
      safeMessage: "복구 후 재조회 완료",
    },
  });
  assert.equal(completion.success, true);
});

test("repair evidence rejects protected drift, wrong transmission order, and different provider pixels", () => {
  const protectedDrift = structuredClone(evidence());
  protectedDrift.postwriteProtectedBodySha256 = hash("changed");
  assert.equal(smartstoreContentRepairResultSchema.safeParse(protectedDrift).success, false);

  const wrongOrder = structuredClone(evidence());
  [wrongOrder.approvedTransmissionImages[0], wrongOrder.approvedTransmissionImages[1]] = [
    wrongOrder.approvedTransmissionImages[1]!, wrongOrder.approvedTransmissionImages[0]!,
  ];
  assert.equal(smartstoreContentRepairResultSchema.safeParse(wrongOrder).success, false);

  const changedProviderPixel = structuredClone(evidence());
  changedProviderPixel.postwriteReadback.detailImagePixelSha256s[2] = hash("different-pixel");
  assert.equal(smartstoreContentRepairResultSchema.safeParse(changedProviderPixel).success, false);
});

test("worker result builder derives postwrite hashes and rejects protected provider drift", () => {
  const sample = evidence();
  const originProduct = sample.postwriteReadback.originReadback.response.originProduct as Record<string, unknown>;
  const channelProduct = sample.postwriteReadback.channelReadback.response.smartstoreChannelProduct as Record<string, unknown>;
  const bodyHashes = smartstoreContentRepairBodyHashes({ originProduct, smartstoreChannelProduct: channelProduct });
  const binding = {
    contract: "smartstore_existing_content_repair_job_v1",
    ownerId: "11111111-1111-4111-8111-111111111111",
    baselineId: "22222222-2222-4222-8222-222222222222",
    productId: "33333333-3333-4333-8333-333333333333",
    listingId: "44444444-4444-4444-8444-444444444444",
    sourceJobId: "55555555-5555-4555-8555-555555555555",
    sourceAttemptId: "66666666-6666-4666-8666-666666666666",
    credentialId: "77777777-7777-4777-8777-777777777777",
    sellerAccountKey: hash("account"),
    sellerSku: "SP-REPAIR",
    originProductNo,
    channelProductNo,
    approvalRevision: 1,
    contentSha256: hash("content"),
    manifestDigest: hash("manifest"),
    ...bodyHashes,
  };
  const mutationEvidence = {
    contract: "smartstore_existing_content_repair_mutation_v1",
    originProductNo,
    channelProductNo,
    baselineBodySha256: bodyHashes.baselineBodySha256,
    prewriteProtectedBodySha256: bodyHashes.protectedBodySha256,
    prewriteOriginResponseSha256: hash("pre-origin"),
    prewriteChannelResponseSha256: hash("pre-channel"),
  };
  const built = buildSmartstoreContentRepairResult({
    binding,
    mutationEvidence,
    approvedTransmissionImages: sample.approvedTransmissionImages,
    postwriteReadback: sample.postwriteReadback,
  });
  assert.equal(built.postwriteProtectedBodySha256, bodyHashes.protectedBodySha256);
  assert.match(built.postwriteOriginResponseSha256, /^[a-f0-9]{64}$/u);

  const drifted = structuredClone(sample.postwriteReadback);
  (drifted.channelReadback.response.smartstoreChannelProduct as Record<string, unknown>)
    .channelProductDisplayStatusType = "SUSPENSION";
  assert.throws(() => buildSmartstoreContentRepairResult({
    binding,
    mutationEvidence,
    approvedTransmissionImages: sample.approvedTransmissionImages,
    postwriteReadback: drifted,
  }));
});
