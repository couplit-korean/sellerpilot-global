import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import {
  assertElevenstExactExistingUpdate,
  bindElevenstExactExistingPublication,
  elevenstExactExistingCreateForbidden,
  elevenstExactExistingPublicationCandidate,
  elevenstExactExistingPublicationIdentity as identity,
} from "../lib/channels/elevenst-exact-existing-publication";
import { buildListingPublicationAssetBinding } from "../lib/channels/marketplace-images";
import { executeChannelOperation } from "../lib/channels/operations";
import { executeServerlessGatewayProviderJob } from "../lib/channels/serverless-gateway-provider";
import {
  elevenstExactExistingUpdateProjectionDigestInput,
  listingUpdateServerCandidate,
  prepareListingUpdateArguments,
} from "../lib/channels/listing-update";

const roles = [
  "detail-overview", "detail-context", "detail-package", "detail-feature",
  "detail-contents", "detail-use", "detail-care", "detail-routine",
];
const imageUrls = roles.map((_role, index) => {
  const digest = (index + 1).toString(16).padStart(64, "0");
  return `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`;
});
const detailHtml = `<section lang="ko-KR"><p>케이블을 깔끔하게 정리하는 사용 방법과 주의사항을 한국어로 자세히 안내합니다.</p>${imageUrls
  .map((url) => `<img src="${url}">`)
  .join("")}</section>`;
const assetBinding = buildListingPublicationAssetBinding({
  approvedDetailPageVersion: 1,
  approvedManifestDigest: "a".repeat(64),
  approvedDetailRoles: roles,
  approvedDetailImagePaths: roles.map((role) => `results/${identity.productId}/claims/11111111-1111-4111-8111-111111111111/${role}.png`),
  approvedDetailImageSha256s: roles.map((_role, index) => (index + 17).toString(16).padStart(64, "0")),
  approvedDetailImageUrls: imageUrls,
  providerImageSurface: "detail_content",
  providerTransportRoles: roles,
  providerTransportUrls: imageUrls,
});
assert.ok(assetBinding);

function completeProduct(overrides: Record<string, unknown> = {}) {
  return {
    selMthdCd: "01",
    dispCtgrNo: identity.categoryId,
    prdTypCd: "01",
    prdNm: "부착형 케이블 정리 클립 6개 세트",
    brand: "No Brand",
    rmaterialTypCd: "04",
    orgnTypCd: "03",
    orgnNmVal: "중국",
    sellerPrdCd: identity.sellerSku,
    suplDtyfrPrdClfCd: "01",
    forAbrdBuyClf: "01",
    prdStatCd: "01",
    minorSelCnYn: "Y",
    prdImage01: imageUrls[0],
    prdImage02: imageUrls[1],
    prdImage03: imageUrls[2],
    prdImage04: imageUrls[3],
    htmlDetail: detailHtml,
    ProductCertGroup: [
      { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
    ],
    selPrdClfCd: "3y:110",
    aplBgnDy: "2026/08/31",
    aplEndDy: "2029/08/30",
    selPrc: String(identity.priceKrw),
    prdSelQty: String(identity.stock),
    dlvCnAreaCd: "01",
    dlvWyCd: "01",
    dlvCstInstBasiCd: "01",
    bndlDlvCnYn: "Y",
    dlvCstPayTypCd: "03",
    rtngdDlvCst: "0",
    exchDlvCst: "0",
    asDetail: "11번가 판매자 문의 이용",
    rtngExchDetail: "11번가 반품 교환 정책 확인",
    ProductNotification: {
      type: "891045",
      item: [
        { code: "11800", name: "부착형 케이블 정리 클립 6개 세트" },
        { code: "11905", name: "No Brand" },
        { code: "23760413", name: "11번가 판매자 문의 이용" },
        { code: "23759100", name: "중국" },
        { code: "23756033", name: "해당사항 없음" },
      ],
    },
    ...overrides,
  };
}

function exactArguments(product = completeProduct()) {
  const base = {
    productNo: identity.remoteId,
    product,
    productPatch: {
      prdNm: product.prdNm,
      htmlDetail: product.htmlDetail,
      selPrc: String(identity.priceKrw),
      prdSelQty: String(identity.stock),
    },
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: identity.locale,
    publicationExpectedFingerprint: "b".repeat(64),
    publicationExpectedImageCount: identity.detailImageCount,
    sellerpilotPublicationAssetBinding: assetBinding,
  };
  return bindElevenstExactExistingPublication(base);
}

function productXml(product: Record<string, unknown>, status: string) {
  const scalarFields = [
    "sellerPrdCd", "dispCtgrNo", "prdNm", "brand", "orgnNmVal", "prdStatCd",
    "prdImage01", "prdImage02", "prdImage03", "prdImage04", "asDetail",
    "rtngExchDetail", "selPrc", "prdSelQty",
  ];
  const escape = (value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const scalars = scalarFields.map((field) => `<${field}>${escape(product[field])}</${field}>`).join("");
  const notice = product.ProductNotification as { type: string; item: Array<{ code: string; name: string }> };
  return `<Product><prdNo>${identity.remoteId}</prdNo><selStatCd>${status}</selStatCd>${scalars}<htmlDetail><![CDATA[${product.htmlDetail}]]></htmlDetail><ProductNotification><type>${notice.type}</type>${notice.item
    .map((item) => `<item><code>${item.code}</code><name>${item.name}</name></item>`)
    .join("")}</ProductNotification></Product>`;
}

const listing = {
  listingId: identity.listingId,
  remoteId: identity.remoteId,
  marketplaceSku: identity.sellerSku,
  status: "failed",
  failureClass: "external_action" as const,
  requestedPublicationIntent: "live",
  remoteVisibility: "unknown",
  providerStatus: "105",
  publishedAt: null,
};

test("11st exact existing identity is the only failed external-action update candidate", () => {
  assert.equal(elevenstExactExistingPublicationCandidate({ channel: "elevenst", ...listing }), true);
  assert.equal(listingUpdateServerCandidate("elevenst", listing), true);
  assert.equal(elevenstExactExistingPublicationCandidate({
    channel: "elevenst",
    ...listing,
    marketplaceSku: null,
  }), true);
  assert.equal(listingUpdateServerCandidate("elevenst", { ...listing, marketplaceSku: null }), true);
  assert.equal(listingUpdateServerCandidate("elevenst", { ...listing, remoteId: "9573255805" }), false);
  assert.equal(listingUpdateServerCandidate("elevenst", { ...listing, marketplaceSku: "OTHER" }), false);
  assert.equal(elevenstExactExistingCreateForbidden({ productId: identity.productId }), true);
});

test("11st exact update mapper pins price 5000 and stock 1 without broadening generic updates", () => {
  const exact = prepareListingUpdateArguments("elevenst", { product: completeProduct() }, listing);
  assert.equal((exact.productPatch as Record<string, unknown>).selPrc, "5000");
  assert.equal((exact.productPatch as Record<string, unknown>).prdSelQty, "1");
  const rebound = prepareListingUpdateArguments("elevenst", exact, listing);
  assert.equal(rebound.productNo, identity.remoteId);
  assert.equal((rebound.productPatch as Record<string, unknown>).selPrc, "5000");
  assert.equal((rebound.productPatch as Record<string, unknown>).prdSelQty, "1");
  assert.throws(
    () => prepareListingUpdateArguments("elevenst", {
      ...exact,
      productPatch: { ...(exact.productPatch as Record<string, unknown>), selPrc: "5010" },
    }, listing),
    /ELEVENST_EXACT_EXISTING_COMMERCE_VALUES_REQUIRED/u,
  );
  const generic = prepareListingUpdateArguments("elevenst", { product: completeProduct({ sellerPrdCd: "OTHER" }) }, {
    status: "published",
    remoteId: "123456789",
  });
  assert.equal(Object.hasOwn(generic.productPatch as object, "selPrc"), false);
  assert.equal(Object.hasOwn(generic.productPatch as object, "prdSelQty"), false);
});

test("11st exact contract requires ko-KR and the approved ordered eight detail images", () => {
  const good = exactArguments();
  assert.doesNotThrow(() => assertElevenstExactExistingUpdate(good));
  const product = completeProduct({
    htmlDetail: `<section lang="ko-KR"><p>케이블을 깔끔하게 정리하는 사용 방법과 주의사항을 한국어로 자세히 안내합니다.</p>${[
      imageUrls[1], imageUrls[0], ...imageUrls.slice(2),
    ].map((url) => `<img src="${url}">`).join("")}</section>`,
  });
  assert.throws(
    () => assertElevenstExactExistingUpdate(exactArguments(product)),
    /ELEVENST_EXACT_EXISTING_UPDATE_INVALID/u,
  );
  assert.throws(
    () => assertElevenstExactExistingUpdate(exactArguments(completeProduct({ prdNm: "Cable clips" }))),
    /ELEVENST_EXACT_EXISTING_UPDATE_INVALID/u,
  );
  for (const invalid of [
    { ...good, publicationIntent: "safe_test" },
    { ...good, publicationExpectedLocale: "en-US" },
    { ...good, publicationExpectedImageCount: 7 },
    { ...good, publicationExpectedFingerprint: "" },
    exactArguments(completeProduct({ prdImage01: "http://sellerpilot.example/representative.jpg" })),
  ]) {
    assert.throws(
      () => assertElevenstExactExistingUpdate(invalid),
      /ELEVENST_EXACT_EXISTING_UPDATE_INVALID/u,
    );
  }
});

test("11st exact duplicate create is rejected before any provider request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 500 }); };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: "A".repeat(32) },
      arguments: { product: completeProduct() },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "product-duplicate-create-fence");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st exact update stages content at 105 before official restartdisplay and final 103 readback", async () => {
  const originalFetch = globalThis.fetch;
  const before = completeProduct({ prdNm: "기존 부착형 케이블 정리 클립" });
  const after = completeProduct();
  const argumentsValue = {
    ...exactArguments(after),
    sellerpilotSnapshotMutableFingerprint: createHash("sha256")
      .update(elevenstExactExistingUpdateProjectionDigestInput(before))
      .digest("hex"),
  };
  const calls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    const method = String(init?.method ?? "GET");
    calls.push({ method, url });
    if (method === "GET") {
      const read = calls.filter((item) => item.method === "GET").length;
      return new Response(productXml(read === 1 ? before : after, read === 3 ? "103" : "105"), { status: 200 });
    }
    if (url.endsWith(`/rest/prodstatservice/stat/restartdisplay/${identity.remoteId}`)) {
      return new Response("<ClientMessage><message>판매상태가 수정되었습니다. [STAT : 103]</message><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    }
    return new Response(`<ClientMessage><productNo>${identity.remoteId}</productNo><resultCode>200</resultCode></ClientMessage>`, { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: "A".repeat(32) },
      arguments: argumentsValue,
      environment: "production",
    });
    assert.deepEqual(calls, [
      { method: "GET", url: `https://api.11st.co.kr/rest/prodmarketservice/prodmarket/${identity.remoteId}` },
      { method: "PUT", url: `https://api.11st.co.kr/rest/prodservices/product/${identity.remoteId}` },
      { method: "GET", url: `https://api.11st.co.kr/rest/prodmarketservice/prodmarket/${identity.remoteId}` },
      { method: "PUT", url: `https://api.11st.co.kr/rest/prodstatservice/stat/restartdisplay/${identity.remoteId}` },
      { method: "GET", url: `https://api.11st.co.kr/rest/prodmarketservice/prodmarket/${identity.remoteId}` },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.publicationFulfilled, true);
    assert.equal(result.remoteState?.providerStatus, "103");
    assert.equal(result.steps[2]?.name, "listing-staged-readback");
    assert.equal(result.steps[2]?.data.sellerpilotExactExistingStagedStatus105Verified, true);
    assert.equal(result.steps[3]?.name, "restart-display");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st exact update never calls restartdisplay when staged content differs", async () => {
  const originalFetch = globalThis.fetch;
  const before = completeProduct({ prdNm: "기존 부착형 케이블 정리 클립" });
  const after = completeProduct();
  const mismatched = completeProduct({ prdNm: "다른 상품명" });
  const argumentsValue = {
    ...exactArguments(after),
    sellerpilotSnapshotMutableFingerprint: createHash("sha256")
      .update(elevenstExactExistingUpdateProjectionDigestInput(before))
      .digest("hex"),
  };
  const calls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async (request, init) => {
    const call = { method: String(init?.method ?? "GET"), url: String(request) };
    calls.push(call);
    if (call.method === "GET") {
      const reads = calls.filter((item) => item.method === "GET").length;
      return new Response(productXml(reads === 1 ? before : mismatched, "105"), { status: 200 });
    }
    return new Response(`<ClientMessage><productNo>${identity.remoteId}</productNo><resultCode>200</resultCode></ClientMessage>`, { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: "A".repeat(32) },
      arguments: argumentsValue,
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps.at(-1)?.name, "listing-staged-readback");
    assert.equal(calls.some((call) => call.url.includes("/restartdisplay/")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st exact update blocks a non-105 baseline before PUT", async () => {
  const originalFetch = globalThis.fetch;
  const product = completeProduct();
  const argumentsValue = {
    ...exactArguments(product),
    sellerpilotSnapshotMutableFingerprint: createHash("sha256")
      .update(elevenstExactExistingUpdateProjectionDigestInput(product))
      .digest("hex"),
  };
  const methods: string[] = [];
  globalThis.fetch = async (_request, init) => {
    methods.push(String(init?.method ?? "GET"));
    return new Response(productXml(product, "103"), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: "A".repeat(32) },
      arguments: argumentsValue,
      environment: "production",
    });
    assert.deepEqual(methods, ["GET"]);
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.data.error, "ELEVENST_EXACT_EXISTING_BASELINE_STATUS_REQUIRED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st exact remote or seller SKU mismatch rejects before GET", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 500 }); };
  try {
    const bad = exactArguments(completeProduct({ sellerPrdCd: "OTHER" }));
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: "A".repeat(32) },
      arguments: { ...bad, sellerpilotSnapshotMutableFingerprint: "c".repeat(64) },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st serverless worker rejects an exact duplicate create before mutation hooks", async () => {
  const job: GatewayClaim = {
    id: "11111111-1111-4111-8111-111111111111",
    claim_token: "22222222-2222-4222-8222-222222222222",
    credential_id: "33333333-3333-4333-8333-333333333333",
    channel: "elevenst",
    operation: "listing.create",
    environment: "production",
    request: { arguments: { product: completeProduct() } },
    credential: { api_key: "A".repeat(32) },
    attempt_count: 1,
  };
  let mutations = 0;
  await assert.rejects(executeServerlessGatewayProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => undefined,
      beginProviderMutation: async () => { mutations += 1; },
      beginCredentialMutation: async () => { mutations += 1; },
      stageCredentialRefresh: async () => { mutations += 1; },
    },
  }), /ELEVENST_EXACT_EXISTING_DUPLICATE_CREATE_FORBIDDEN/u);
  assert.equal(mutations, 0);
});

test("11st serverless worker rejects a credential outside the exact listing lineage before mutation", async () => {
  const job: GatewayClaim = {
    id: "11111111-1111-4111-8111-111111111111",
    claim_token: "22222222-2222-4222-8222-222222222222",
    credential_id: "33333333-3333-4333-8333-333333333333",
    channel: "elevenst",
    operation: "listing.update",
    environment: "production",
    request: {
      arguments: {
        ...exactArguments(),
        sellerpilotSnapshotMutableFingerprint: "c".repeat(64),
      },
    },
    credential: { api_key: "A".repeat(32) },
    attempt_count: 1,
  };
  let hooks = 0;
  let executorCalls = 0;
  await assert.rejects(executeServerlessGatewayProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { hooks += 1; },
      beginProviderMutation: async () => { hooks += 1; },
      beginCredentialMutation: async () => { hooks += 1; },
      stageCredentialRefresh: async () => { hooks += 1; },
    },
  }, async () => {
    executorCalls += 1;
    throw new Error("unexpected provider executor");
  }), /ELEVENST_EXACT_EXISTING_CREDENTIAL_LINEAGE_MISMATCH/u);
  assert.equal(hooks, 0);
  assert.equal(executorCalls, 0);
});
