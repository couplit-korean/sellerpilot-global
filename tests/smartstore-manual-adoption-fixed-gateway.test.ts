import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  gatewayWorkerCompletionSchema,
  smartstoreManualAdoptionLineageResultSchema,
  smartstoreManualAdoptionReadbackJobSchema,
} from "../lib/channels/gateway-contract";
import {
  isSmartstoreLocalReadOperation,
  SMARTSTORE_LOCAL_READ_OPERATIONS,
} from "../lib/channels/smartstore-local-read-routing";
import {
  collectSmartstoreManualAdoptionReadback,
  isRetryableSmartstoreManualAdoptionReadbackError,
  SmartstoreManualAdoptionError,
} from "../lib/server-smartstore-manual-adoption";

const workerUrl = new URL("../scripts/ai-cli-worker.mjs", import.meta.url);
const completionRouteUrl = new URL(
  "../app/api/channel-gateway/worker/complete/route.ts",
  import.meta.url,
);
const serverlessGatewayUrl = new URL(
  "../lib/channels/serverless-cs-gateway.ts",
  import.meta.url,
);
const digest = "a".repeat(64);

const marker = {
  contract: "smartstore_manual_adoption_readback_job_v1",
  ownerId: "11111111-1111-4111-8111-111111111111",
  productId: "22222222-2222-4222-8222-222222222222",
  listingId: "33333333-3333-4333-8333-333333333333",
  sourceJobId: "44444444-4444-4444-8444-444444444444",
  sourceAttemptId: "55555555-5555-4555-8555-555555555555",
  credentialId: "66666666-6666-4666-8666-666666666666",
  sellerAccountKey: digest,
  sellerSku: "AUTO-780720401E2D4E4EA45F",
  approvalRevision: 1,
  contentSha256: digest,
  manifestDigest: digest,
} as const;

const imageUrls = Array.from(
  { length: 8 },
  (_, index) => `https://shop-phinf.pstatic.net/detail-${index + 1}.jpg`,
);
const pixelDigests = Array.from(
  { length: 8 },
  (_, index) => (index + 1).toString(16).repeat(64).slice(0, 64),
);

const readback = {
  contract: "smartstore_official_manual_adoption_readback_v1",
  source: "smartstore_official_api_readback_v1",
  observedAt: "2026-09-07T07:00:00.000Z",
  providerMutationPerformed: false,
  searchReadback: {
    method: "POST",
    path: "/v1/products/search",
    httpStatus: 200,
    request: { searchKeywordType: "SELLER_CODE" },
    response: { contents: [] },
  },
  originReadback: {
    method: "GET",
    path: "/v2/products/origin-products/13688607602",
    httpStatus: 200,
    request: null,
    response: { originProductNo: 13688607602 },
  },
  channelReadback: {
    method: "GET",
    path: "/v2/products/channel-products/13749310594",
    httpStatus: 200,
    request: null,
    response: { smartstoreChannelProductNo: 13749310594 },
  },
  detailImageUrls: imageUrls,
  detailImagePixelSha256s: pixelDigests,
} as const;

const result = {
  ok: true,
  channel: "smartstore",
  operation: "listing.lineage.verify",
  verificationStatus: "verified",
  evidence: {
    contract: "smartstore_manual_adoption_readback_result_v1",
    readback,
  },
  steps: [{
    name: "smartstore-manual-adoption-readback",
    ok: true,
    status: 200,
    data: {
      sellerpilotVerification: "SMARTSTORE_MANUAL_ADOPTION_READBACK_VERIFIED",
      providerMutationPerformed: false,
      detailImageCount: 8,
    },
  }],
  safeMessage: "스마트스토어 공식 API에서 기존 상품을 읽기 전용으로 확인했습니다.",
} as const;

test("SmartStore adoption marker is exact and the operation stays in the local read lane", () => {
  assert.equal(smartstoreManualAdoptionReadbackJobSchema.safeParse(marker).success, true);
  assert.equal(smartstoreManualAdoptionReadbackJobSchema.safeParse({
    ...marker,
    browserSuppliedReadback: {},
  }).success, false);
  assert.equal(isSmartstoreLocalReadOperation("listing.lineage.verify"), true);
  assert.equal(SMARTSTORE_LOCAL_READ_OPERATIONS.includes("listing.lineage.verify"), true);
  assert.equal(isSmartstoreLocalReadOperation("listing.create"), false);
});

test("SmartStore adoption completion accepts only eight distinct read-only image observations", () => {
  assert.equal(smartstoreManualAdoptionLineageResultSchema.safeParse(result).success, true);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: "77777777-7777-4777-8777-777777777777",
    claimToken: "88888888-8888-4888-8888-888888888888",
    status: "succeeded",
    result,
  }).success, true);
  assert.equal(smartstoreManualAdoptionLineageResultSchema.safeParse({
    ...result,
    evidence: {
      ...result.evidence,
      readback: { ...readback, providerMutationPerformed: true },
    },
  }).success, false);
  assert.equal(smartstoreManualAdoptionLineageResultSchema.safeParse({
    ...result,
    evidence: {
      ...result.evidence,
      readback: {
        ...readback,
        detailImageUrls: Array(8).fill(imageUrls[0]),
      },
    },
  }).success, false);
});

test("the Mac worker uses the dedicated collector without opening a provider mutation fence", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const lineage = worker.indexOf('job.operation === "listing.lineage.verify"');
  const smartstore = worker.indexOf('job.channel === "smartstore"', lineage);
  const fallback = worker.indexOf("} else {", smartstore);
  const branch = worker.slice(smartstore, fallback);

  assert.ok(lineage > 0 && smartstore > lineage && fallback > smartstore);
  assert.match(branch, /smartstoreManualAdoptionReadbackJobSchema\.safeParse/);
  assert.match(branch, /collectSmartstoreManualAdoptionReadback/);
  assert.match(branch, /signal: gatewayExecutionSignal/);
  assert.match(branch, /providerMutationPerformed: false/);
  assert.doesNotMatch(branch, /markExternalWriteStarted|markExternalMutationStarted|begin-mutation/);
  assert.match(
    worker,
    /retryableLineageReadback[\s\S]*isRetryableSmartstoreManualAdoptionReadbackError/,
  );
});

test("only transient SmartStore read failures can reuse the bounded job", () => {
  assert.equal(isRetryableSmartstoreManualAdoptionReadbackError(
    new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_PROVIDER_TRANSIENT"),
  ), true);
  assert.equal(isRetryableSmartstoreManualAdoptionReadbackError(
    new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_DETAIL_IMAGE_DOWNLOAD_FAILED",
      new Error("read ECONNRESET"),
    ),
  ), true);
  assert.equal(isRetryableSmartstoreManualAdoptionReadbackError(
    new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_DETAIL_IMAGE_DOWNLOAD_FAILED",
      new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED"),
    ),
  ), false);
  assert.equal(isRetryableSmartstoreManualAdoptionReadbackError(
    new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE",
      undefined,
      "NAVER_TOKEN_EXCHANGE_TIMEOUT",
    ),
  ), true);
  assert.equal(isRetryableSmartstoreManualAdoptionReadbackError(
    new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE",
      undefined,
      "NAVER_IP_NOT_ALLOWED",
    ),
  ), false);
  for (const terminalCode of [
    "SMARTSTORE_MANUAL_ORIGIN_HTTP_STATUS_INVALID",
    "SMARTSTORE_MANUAL_CHANNEL_HTTP_STATUS_INVALID",
    "SMARTSTORE_MANUAL_ORIGIN_PROVIDER_REJECTED",
    "SMARTSTORE_MANUAL_CHANNEL_PROVIDER_REJECTED",
    "SMARTSTORE_MANUAL_ORIGIN_PAYLOAD_INVALID",
    "SMARTSTORE_MANUAL_CHANNEL_PAYLOAD_INVALID",
    "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_PAYLOAD_INVALID",
    "SMARTSTORE_MANUAL_ORIGIN_IDENTITY_MISMATCH",
    "SMARTSTORE_MANUAL_CHANNEL_IDENTITY_MISMATCH",
    "SMARTSTORE_MANUAL_ORIGIN_SELLER_SKU_MISMATCH",
    "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_SELLER_SKU_MISMATCH",
    "SMARTSTORE_MANUAL_CHANNEL_SELLER_SKU_MISMATCH",
    "SMARTSTORE_MANUAL_ORIGIN_STATUS_MISMATCH",
    "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_STATUS_MISMATCH",
    "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_PRODUCT_MISMATCH",
    "SMARTSTORE_MANUAL_CHANNEL_STATUS_MISMATCH",
  ]) {
    assert.equal(isRetryableSmartstoreManualAdoptionReadbackError(
      new SmartstoreManualAdoptionError(terminalCode),
    ), false, terminalCode);
  }
  assert.equal(isRetryableSmartstoreManualAdoptionReadbackError(
    new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_DETAIL_IMAGES_UNVERIFIED"),
  ), false);
});

test("official 429/5xx readback responses are transient while provider rejection is terminal", async () => {
  const collectForStatus = (status: number) => collectSmartstoreManualAdoptionReadback(
    { credential: {}, target: { sellerSku: marker.sellerSku } },
    {
      accessToken: async () => "test-token",
      now: () => new Date("2026-09-07T07:00:00.000Z"),
      request: async () => ({
        response: new Response("{}", { status }),
        data: {},
        text: "",
      }),
      downloadImage: async () => {
        throw new Error("unexpected image download");
      },
    },
  );

  await assert.rejects(collectForStatus(429), (error) => (
    isRetryableSmartstoreManualAdoptionReadbackError(error)
  ));
  await assert.rejects(collectForStatus(503), (error) => (
    isRetryableSmartstoreManualAdoptionReadbackError(error)
  ));
  await assert.rejects(collectForStatus(401), (error) => (
    error instanceof SmartstoreManualAdoptionError
      && error.code === "SMARTSTORE_MANUAL_SEARCH_UNVERIFIED"
      && !isRetryableSmartstoreManualAdoptionReadbackError(error)
  ));
});

test("the completion route sends full readback only to the dedicated atomic RPC", async () => {
  const route = await readFile(completionRouteUrl, "utf8");
  const branch = route.indexOf(
    'job.channel === "smartstore" && job.operation === "listing.lineage.verify"',
  );
  const dedicated = route.indexOf(
    '"sellerpilot_complete_smartstore_manual_adoption_readback"',
    branch,
  );
  const branchEnd = route.indexOf(
    'if (parsed.data.status === "succeeded")',
    dedicated,
  );
  const generic = route.indexOf(
    'serviceClient.rpc("sellerpilot_service_complete_gateway_transaction"',
    dedicated,
  );
  const scoped = route.slice(branch, branchEnd);

  assert.ok(
    branch > 0
      && dedicated > branch
      && branchEnd > dedicated
      && generic > branchEnd,
  );
  assert.match(scoped, /p_readback: verifiedResult\?\.success/);
  assert.match(scoped, /p_status: adoptionStatus/);
  assert.match(scoped, /p_token_hash: tokenHash/);
  assert.match(scoped, /p_claim_token: parsed\.data\.claimToken/);
  assert.doesNotMatch(scoped, /storedResponse\s*=|p_response_payload/);
});

test("the generic serverless lineage completer rejects the SmartStore readback contract", async () => {
  const serverlessGateway = await readFile(serverlessGatewayUrl, "utf8");
  const completion = serverlessGateway.indexOf("async function completeListingLineageClaim");
  const smartstoreGuard = serverlessGateway.indexOf(
    'if (result.channel === "smartstore")',
    completion,
  );
  const genericPayload = serverlessGateway.indexOf(
    "listingLineageSuccessPayload(result)",
    smartstoreGuard,
  );

  assert.ok(completion > 0 && smartstoreGuard > completion && genericPayload > smartstoreGuard);
  assert.match(
    serverlessGateway.slice(smartstoreGuard, genericPayload),
    /return "ownership_lost"/,
  );
});
