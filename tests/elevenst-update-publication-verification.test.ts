import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { listingPublicationProviderAssetEvidence } = await import(
  "../lib/channels/listing-publication-content"
);
const { executeListingPublicationVerification } = await import(
  "../lib/channels/listing-publication-verification"
);
const { executeServerlessGatewayProviderJob } = await import(
  "../lib/channels/serverless-gateway-provider"
);

const verificationJobId = "71000000-0000-4000-8000-000000000001";
const sourceJobId = "72000000-0000-4000-8000-000000000001";
const remoteId = "9573255804";
const sellerProductCode = "QA-KR-UPDATE-001";
const fingerprint = "c".repeat(64);
const detailRoles = [
  "detail-overview",
  "detail-context",
  "detail-package",
  "detail-feature",
  "detail-contents",
  "detail-use",
  "detail-care",
  "detail-routine",
];
const detailImages = detailRoles.map((role, index) => {
  const contentSha256 = (index + 1).toString(16).padStart(64, "0");
  const objectPath = `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
  return {
    role,
    approvedObjectPath: `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/${role}.png`,
    approvedSourceSha256: (index + 17).toString(16).padStart(64, "0"),
    publicUrl: `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256,
  };
});
const product = {
  prdNo: remoteId,
  sellerPrdCd: sellerProductCode,
  prdNm: "한국어로 확인된 케이블 정리 소품",
  htmlDetail: `<section lang="ko-KR"><p>이 상품은 케이블을 깔끔하게 정리하고 편리하게 사용하는 방법을 자세히 안내합니다.</p>${detailImages
    .map((image) => `<img src="${image.publicUrl}">`)
    .join("")}</section>`,
  selStatCd: "103",
  selStatNm: "판매중",
};
const sourceArguments = {
  publicationIntent: "live",
  publicationStateContract: "verified_remote_state_v1",
  publicationExpectedLocale: "ko-KR",
  publicationExpectedFingerprint: fingerprint,
  publicationExpectedImageCount: 8,
  product: {
    prdNm: product.prdNm,
    sellerPrdCd: product.sellerPrdCd,
    htmlDetail: product.htmlDetail,
  },
  sellerpilotPublicationAssetBinding: {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 2,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailImages: detailImages,
    providerImageSurface: "detail_content",
    providerTransportImages: detailImages,
  },
};
const sourceReadback = { accepted: true, product };
const publicationAssetBinding = listingPublicationProviderAssetEvidence({
  channel: "elevenst",
  remoteId,
  sourceArguments,
  providerArguments: sourceArguments,
});

assert.ok(publicationAssetBinding, "11st update fixture must carry an exact provider asset binding");

function verificationInput(input: {
  sourceOperation: "listing.create" | "listing.update";
  sourceStepName: string;
}) {
  return {
    channel: "elevenst" as const,
    operation: "listing.publication.verify" as const,
    payload: { api_key: "A".repeat(32) },
    arguments: {
      publicationReviewSourceJobId: sourceJobId,
      sellerpilotReadOnly: true,
      remoteId,
      market: "KR",
      targetId: "KR",
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: fingerprint,
      publicationExpectedImageCount: 8,
      sellerpilotPublicationSource: {
        contract: "listing_publication_verification_source_v1",
        verificationJobId,
        sourceJobId,
        sourceOperation: input.sourceOperation,
        sourceArguments,
        sourceResponsePayload: {
          steps: [{
            name: input.sourceStepName,
            ok: true,
            status: 200,
            data: sourceReadback,
          }],
          remoteState: {
            evidence: { publicationAssetBinding },
            resources: { productNo: remoteId, sellerProductCode },
          },
        },
        sourceFingerprint: fingerprint,
        expectedRemoteId: remoteId,
        expectedLocale: "ko-KR",
        expectedImageCount: 8,
        market: "KR",
        targetId: "KR",
      },
    },
    environment: "production" as const,
  };
}

function exactProductXml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Product><prdNo>${remoteId}</prdNo><sellerPrdCd>${sellerProductCode}</sellerPrdCd><prdNm>${product.prdNm}</prdNm><htmlDetail><![CDATA[${product.htmlDetail}]]></htmlDetail><selStatCd>103</selStatCd><selStatNm>판매중</selStatNm></Product>`;
}

function gatewayJob(): GatewayClaim {
  const input = verificationInput({
    sourceOperation: "listing.update",
    sourceStepName: "listing-readback",
  });
  return {
    id: verificationJobId,
    claim_token: "73000000-0000-4000-8000-000000000001",
    credential_id: "74000000-0000-4000-8000-000000000001",
    channel: input.channel,
    operation: input.operation,
    environment: input.environment,
    request: { arguments: input.arguments },
    credential: input.payload,
    attempt_count: 1,
  };
}

test("11st listing.update re-verifies the exact listing-readback source contract", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async (request, init) => {
    calls.push({
      method: String(init?.method ?? (request instanceof Request ? request.method : "GET")),
      url: String(request instanceof Request ? request.url : request),
    });
    return new Response(exactProductXml(), {
      status: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
    });
  };
  try {
    let providerMutationHooks = 0;
    const result = await executeServerlessGatewayProviderJob({
      job: gatewayJob(),
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { providerMutationHooks += 1; },
        beginCredentialMutation: async () => { providerMutationHooks += 1; },
        stageCredentialRefresh: async () => { providerMutationHooks += 1; },
      },
    });
    assert.deepEqual(calls, [{
      method: "GET",
      url: `https://api.11st.co.kr/rest/prodmarketservice/prodmarket/${remoteId}`,
    }]);
    assert.equal(result.ok, true);
    assert.equal(result.publicationFulfilled, true);
    assert.equal(result.remoteId, remoteId);
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.imageCount, 8);
    assert.equal(result.remoteState?.evidence.sourceOperation, "listing.update");
    assert.equal(result.remoteState?.evidence.contentVerified, true);
    assert.equal(result.steps.at(-1)?.name, "publication-content-verification");
    assert.equal(result.steps.at(-1)?.ok, true);
    assert.equal(providerMutationHooks, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st source readback names remain exact and the create contract remains accepted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(exactProductXml(), {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
  try {
    const createResult = await executeListingPublicationVerification(verificationInput({
      sourceOperation: "listing.create",
      sourceStepName: "product-publication-readback",
    }));
    assert.equal(createResult.steps.at(-1)?.ok, true);
    assert.equal(createResult.remoteState?.evidence.sourceOperation, "listing.create");

    const nonExactResult = await executeListingPublicationVerification(verificationInput({
      sourceOperation: "listing.update",
      sourceStepName: "listing-readback-untrusted",
    }));
    assert.equal(nonExactResult.steps.at(-1)?.ok, false);
    assert.equal(nonExactResult.remoteState, undefined);
    assert.deepEqual(
      (nonExactResult.steps.at(-1)?.data.mismatchFields as string[]).slice(0, 3),
      ["title", "description", "detailImages"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
