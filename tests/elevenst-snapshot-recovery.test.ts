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

const verificationJobId = "81000000-0000-4000-8000-000000000001";
const sourceJobId = "82000000-0000-4000-8000-000000000001";
const recoveryId = "83000000-0000-4000-8000-000000000001";
const remoteId = "9573255804";
const fingerprint = "d".repeat(64);
const manifestDigest = "e".repeat(64);
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
  selMthdCd: "01",
  dispCtgrNo: "1341821",
  prdTypCd: "01",
  prdNm: "한국어로 확인된 케이블 정리 소품",
  brand: "SellerPilot",
  rmaterialTypCd: "04",
  orgnTypCd: "03",
  orgnNmVal: "대한민국",
  sellerPrdCd: "QA-KR-RECOVERY-001",
  suplDtyfrPrdClfCd: "01",
  forAbrdBuyClf: "01",
  prdStatCd: "01",
  minorSelCnYn: "Y",
  prdImage01: detailImages[0].publicUrl,
  prdImage02: detailImages[1].publicUrl,
  prdImage03: detailImages[2].publicUrl,
  prdImage04: detailImages[3].publicUrl,
  htmlDetail: `<section lang="ko-KR"><p>케이블 정리 상품의 사용법과 주의사항을 한국어로 안내합니다.</p>${detailImages
    .map((image) => `<img src="${image.publicUrl}">`)
    .join("")}</section>`,
  ProductCertGroup: [
    { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
  ],
  selPrdClfCd: "3y:110",
  aplBgnDy: "2026/08/31",
  aplEndDy: "2029/08/30",
  selPrc: "5000",
  prdSelQty: "10",
  dlvCnAreaCd: "01",
  dlvWyCd: "01",
  dlvCstInstBasiCd: "01",
  bndlDlvCnYn: "Y",
  dlvCstPayTypCd: "03",
  rtngdDlvCst: "3000",
  exchDlvCst: "6000",
  asDetail: "11번가 판매자 문의를 이용해 주세요.",
  rtngExchDetail: "상품 수령 후 판매자 반품 교환 정책을 확인해 주세요.",
  ProductNotification: {
    type: "891045",
    item: [
      { code: "11800", name: "한국어로 확인된 케이블 정리 소품" },
      { code: "11905", name: "SellerPilot" },
      { code: "23760413", name: "11번가 판매자 문의를 이용해 주세요." },
      { code: "23759100", name: "대한민국" },
      { code: "23756033", name: "해당사항 없음" },
    ],
  },
};

const sourceArguments = {
  publicationIntent: "live",
  publicationStateContract: "verified_remote_state_v1",
  publicationExpectedLocale: "ko-KR",
  publicationExpectedFingerprint: fingerprint,
  publicationExpectedImageCount: 8,
  product,
  sellerpilotPublicationAssetBinding: {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 2,
    approvedManifestDigest: manifestDigest,
    approvedDetailImages: detailImages,
    providerImageSurface: "detail_content",
    providerTransportImages: detailImages,
  },
};
const sourceRemoteProduct = { prdNo: remoteId, selStatCd: "103", selStatNm: "판매중", ...product };
const publicationAssetBinding = listingPublicationProviderAssetEvidence({
  channel: "elevenst",
  remoteId,
  sourceArguments,
  providerArguments: sourceArguments,
});

assert.ok(publicationAssetBinding, "recovery fixture must carry an exact provider asset binding");

const legacyProduct = {
  ...product,
  prdNm: "부착형 케이블 정리 클립 6개 세트",
  htmlDetail: `<section lang="ko-KR"><p>과거 등록 상세 설명입니다.</p>${detailImages
    .slice(0, 4)
    .map((image) => `<img src="${image.publicUrl}">`)
    .join("")}</section>`,
};

function xmlEscape(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fullProductXml(overrides: {
  omit?: string;
  status?: string;
  product?: typeof product;
} = {}) {
  const selectedProduct = overrides.product ?? product;
  const scalarFields = [
    "sellerPrdCd", "selMthdCd", "dispCtgrNo", "prdTypCd", "prdNm", "brand",
    "rmaterialTypCd", "orgnTypCd", "orgnNmVal", "suplDtyfrPrdClfCd", "forAbrdBuyClf",
    "prdStatCd", "minorSelCnYn", "prdImage01", "prdImage02", "prdImage03", "prdImage04",
    "selPrdClfCd", "aplBgnDy", "aplEndDy", "selPrc", "prdSelQty", "dlvCnAreaCd",
    "dlvWyCd", "dlvCstInstBasiCd", "bndlDlvCnYn", "dlvCstPayTypCd", "rtngdDlvCst",
    "exchDlvCst", "asDetail", "rtngExchDetail",
  ] as const;
  const scalars = scalarFields
    .filter((field) => field !== overrides.omit)
    .map((field) => `<${field}>${xmlEscape(selectedProduct[field])}</${field}>`)
    .join("");
  const certs = selectedProduct.ProductCertGroup
    .map((group) => `<ProductCertGroup><crtfGrpTypCd>${group.crtfGrpTypCd}</crtfGrpTypCd><crtfGrpObjClfCd>${group.crtfGrpObjClfCd}</crtfGrpObjClfCd></ProductCertGroup>`)
    .join("");
  const notice = `<ProductNotification><type>${selectedProduct.ProductNotification.type}</type>${selectedProduct.ProductNotification.item
    .map((item) => `<item><code>${item.code}</code><name>${xmlEscape(item.name)}</name></item>`)
    .join("")}</ProductNotification>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Product><prdNo>${remoteId}</prdNo><selStatCd>${overrides.status ?? "103"}</selStatCd><selStatNm>판매중</selStatNm>${scalars}<htmlDetail><![CDATA[${selectedProduct.htmlDetail}]]></htmlDetail>${certs}${notice}</Product>`;
}

function verificationInput(recovery = true) {
  return {
    channel: "elevenst" as const,
    operation: "listing.publication.verify" as const,
    payload: { api_key: "A".repeat(32) },
    arguments: {
      ...(recovery ? {
        sellerpilotElevenstSnapshotRecovery: "elevenst_exact_legacy_snapshot_recovery_v1",
        elevenstSnapshotRecoveryId: recoveryId,
        sellerpilotSnapshotOnly: true,
        approvedManifestDigest: manifestDigest,
        approvedDetailPageVersion: 2,
      } : {}),
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
        sourceOperation: recovery ? "listing.create" as const : "listing.update" as const,
        sourceArguments: recovery ? {
          product: legacyProduct,
          verificationOnly: true,
          sellerpilotElevenstLegacySnapshotAttestation: {
            contract: "elevenst_exact_legacy_source_attestation_v1",
            snapshotOnly: true,
            approvedContentVerified: false,
            publicationReviewAllowed: false,
            sourceRequestSha256: "a".repeat(64),
            sourceResponseSha256: "b".repeat(64),
            approvedManifestDigest: manifestDigest,
            approvedDetailPageVersion: 2,
          },
        } : sourceArguments,
        sourceResponsePayload: recovery ? {
          ok: true,
          remoteId,
          steps: [
            { name: "product-create", ok: true, status: 200, data: { accepted: true, productNo: remoteId } },
            { name: "product-readback", ok: true, status: 200, data: { accepted: true, productNo: remoteId } },
            { name: "verification-stop-display", ok: true, status: 200, data: { accepted: true } },
          ],
        } : {
          steps: [{
            name: "listing-readback",
            ok: true,
            status: 200,
            data: { accepted: true, product: sourceRemoteProduct },
          }],
          remoteState: {
            evidence: { publicationAssetBinding },
            resources: { productNo: remoteId, sellerProductCode: product.sellerPrdCd },
          },
        },
        sourceFingerprint: fingerprint,
        expectedRemoteId: remoteId,
        expectedLocale: "ko-KR",
        expectedImageCount: 8 as const,
        market: "KR",
        targetId: "KR",
      },
    },
    environment: "production" as const,
  };
}

function gatewayJob(): GatewayClaim {
  const input = verificationInput();
  return {
    id: verificationJobId,
    claim_token: "84000000-0000-4000-8000-000000000001",
    credential_id: "85000000-0000-4000-8000-000000000001",
    channel: input.channel,
    operation: input.operation,
    environment: input.environment,
    request: { arguments: input.arguments },
    credential: input.payload,
    attempt_count: 1,
  };
}

test("11st legacy snapshot recovery performs one exact GET and records observation-only evidence", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async (request, init) => {
    calls.push({
      method: String(init?.method ?? (request instanceof Request ? request.method : "GET")),
      url: String(request instanceof Request ? request.url : request),
    });
    return new Response(fullProductXml({ product: legacyProduct }), {
      status: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
    });
  };
  try {
    let mutationBegins = 0;
    const result = await executeServerlessGatewayProviderJob({
      job: gatewayJob(),
      signal: new AbortController().signal,
      hooks: {
        beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
        stageCredentialRefresh: async () => { throw new Error("unexpected credential refresh"); },
        beginProviderMutation: async () => { mutationBegins += 1; },
        assertLeaseHealthy: async () => {},
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.operation, "listing.publication.verify");
    assert.equal(result.remoteId, remoteId);
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.providerStatus, "103");
    assert.equal(result.remoteState?.locale, "ko-KR");
    assert.equal(result.remoteState?.imageCount, 4);
    assert.equal(result.remoteState?.evidence.fullProductVerified, true);
    assert.equal(result.remoteState?.evidence.snapshotOnly, true);
    assert.equal(result.remoteState?.evidence.approvedContentVerified, false);
    assert.equal(result.remoteState?.evidence.approvedImageCountVerified, false);
    assert.equal(result.remoteState?.evidence.publicationReviewCreated, false);
    assert.equal(result.remoteState?.evidence.legacySourceAttested, true);
    assert.equal(result.remoteState?.evidence.immutableSourceFieldsVerified, true);
    assert.equal(
      result.remoteState?.evidence.fullProductBytes,
      Buffer.byteLength(JSON.stringify(legacyProduct), "utf8"),
    );
    assert.deepEqual(result.steps[0]?.data.product, {
      prdNo: remoteId,
      selStatCd: "103",
      selStatNm: "판매중",
      ...legacyProduct,
    });
    assert.equal(result.steps.some((step) => step.name === "publication-content-verification"), false);
    assert.equal(mutationBegins, 0);
    assert.deepEqual(calls, [{
      method: "GET",
      url: `https://api.11st.co.kr/rest/prodmarketservice/prodmarket/${remoteId}`,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st normal publication verifier does not persist a full Product snapshot in evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(fullProductXml(), { status: 200 });
  try {
    const result = await executeListingPublicationVerification(verificationInput(false));
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.evidence.fullProductVerified, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st snapshot recovery fails closed when any required full Product field is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(fullProductXml({
    omit: "selPrc",
    product: legacyProduct,
  }), { status: 200 });
  try {
    const result = await executeListingPublicationVerification(verificationInput());
    assert.equal(result.remoteState, undefined);
    assert.equal(result.steps[0]?.name, "product-publication-reverification");
    assert.equal(result.steps[0]?.ok, false);
    assert.equal(result.steps.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st legacy snapshot recovery rejects an immutable seller code mismatch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(fullProductXml({
    product: { ...legacyProduct, sellerPrdCd: "DIFFERENT-SELLER-CODE" },
  }), { status: 200 });
  try {
    const result = await executeListingPublicationVerification(verificationInput());
    assert.equal(result.remoteState, undefined);
    assert.equal(result.steps[0]?.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st legacy source without the exact snapshot attestation cannot enter the verifier", async () => {
  const input = verificationInput();
  const source = input.arguments.sellerpilotPublicationSource;
  delete source.sourceArguments.sellerpilotElevenstLegacySnapshotAttestation;
  await assert.rejects(
    executeListingPublicationVerification(input),
    /LISTING_PUBLICATION_VERIFY_SOURCE_BINDING_INVALID/u,
  );
});
