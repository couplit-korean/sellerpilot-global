import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { setRegistrationValue } from "../lib/channel-registration-form";
import {
  canonicalProductDetailImageManifestInput,
  defaultProductDetailImageRoles,
  productDetailImageManifestContract,
} from "../lib/product-detail-image-manifest";
import { buildChannelArguments } from "../app/product-publish-workbench";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    if (specifier === "./marketplace-images"
      && context.parentURL?.endsWith("/lib/channels/provider-listing-runtime.ts")) {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export async function downloadMarketplaceImage(){throw new Error('IMAGE_DOWNLOAD_MUST_NOT_START')} ",
      };
    }
    return nextResolve(specifier, context);
  },
});

const { prepareMarketplaceListingArguments } = await import("../lib/channels/provider-listing-runtime");
const {
  approvedProductDetailManifestFromPublishContext,
  bindMarketplaceArgumentsToApprovedDetailManifest,
} = await import("../lib/server-product-detail-manifest");
const {
  attachSmartstoreListingCreateExecuteTransport,
  bindSmartstoreListingCreateSourceIdentity,
} = await import("../lib/server-smartstore-listing-create-binding");

const productId = "20000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000002";
const credentialId = "20000000-0000-4000-8000-000000000003";
const sellerCode = "SMARTSTORE-NEW-PRODUCT-001";
const categoryId = "50022679";
const jobId = "30000000-0000-4000-8000-000000000001";
const claimId = "40000000-0000-4000-8000-000000000001";

test("SmartStore source identity is bound after approval and before claim", async () => {
  const route = await readFile(new URL(
    "../app/api/admin/channel-operations/route.ts",
    import.meta.url,
  ), "utf8");
  const approvalBinding = route.indexOf("bindMarketplaceArgumentsToApprovedDetailManifest(");
  const sourceSnapshot = route.indexOf(
    '"sellerpilot_service_smartstore_create_source_snapshot"',
  );
  const categoryBinding = route.indexOf("bindSmartstoreCreateCategoryAttributesFromServerSource({");
  const sourceIdentityBinding = route.indexOf("bindSmartstoreListingCreateSourceIdentity({");
  const fingerprint = route.indexOf("const baseFingerprintArguments", sourceIdentityBinding);
  const claim = route.indexOf('"sellerpilot_claim_channel_operation"', sourceIdentityBinding);
  const transportAttach = route.indexOf("attachSmartstoreListingCreateExecuteTransport(");
  const gatewayExecute = route.indexOf("executeViaChannelGateway({", transportAttach);
  assert.ok(approvalBinding >= 0);
  assert.ok(sourceSnapshot > approvalBinding);
  assert.ok(categoryBinding > sourceSnapshot);
  assert.ok(sourceIdentityBinding > categoryBinding);
  assert.ok(fingerprint > sourceIdentityBinding);
  assert.ok(claim > fingerprint);
  assert.ok(transportAttach > claim);
  assert.ok(gatewayExecute > transportAttach);
  assert.match(route, /smartstore_listing_create_source_unavailable/u);
  assert.match(route, /status: unavailable \? 503 : 409/u);
});

function approvedContext() {
  const generatedImagePaths = Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
    asset.id,
    `results/${jobId}/claims/${claimId}/${asset.file}`,
  ]));
  const sourceSha256s = defaultProductDetailImageRoles.map((role) =>
    createHash("sha256").update(`approved-${role}`).digest("hex"));
  const images = defaultProductDetailImageRoles.map((role, index) => ({
    role,
    path: generatedImagePaths[role],
    sourceSha256: sourceSha256s[index],
  }));
  const digest = createHash("sha256")
    .update(canonicalProductDetailImageManifestInput(images))
    .digest("hex");
  const data = {
    root: {},
    content: defaultProductDetailImageRoles.map((role, index) => ({
      type: "ImageStoryBlock",
      props: {
        id: `detail-${index + 1}`,
        imageUrl: `sellerpilot-asset://${role}`,
        imageRole: role,
        imageAlt: `승인 상세 이미지 ${index + 1}`,
      },
    })),
  };
  return {
    ownerId,
    contentMode: "ai_generated",
    product: {
      id: productId,
      externalCode: sellerCode,
      sku: sellerCode,
      name: "스마트스토어 신규 상품 회귀 검사",
      description: "실제 함수 경로만 검증하는 로컬 fixture",
      sourceUrl: null,
      status: "ready",
      onHand: 1,
    },
    manualFields: {
      productName: "스마트스토어 신규 상품 회귀 검사",
      description: "실제 함수 경로만 검증하는 로컬 fixture",
      sellerSku: sellerCode,
      categoryHint: "생활용품",
      brandName: "SellerPilot Test",
      manufacturer: "SellerPilot Test",
      countryOfOrigin: "대한민국",
      material: "검사 재질",
      packageContents: "1개",
      condition: "NEW" as const,
      gtinStatus: "NO_GTIN" as const,
      gtin: "",
      sellingPrice: 10_000,
      currency: "KRW",
      stock: 1,
      shippingFeeKrw: 3_000,
      shippingRule: "",
      packagingRule: "",
      weightKg: 0.5,
      packageLengthCm: 10,
      packageWidthCm: 10,
      packageHeightCm: 10,
    },
    imageSpecs: [],
    assignments: [{
      channel: "smartstore" as const,
      market: "KR",
      categoryId,
      categoryPath: ["생활용품"],
      providedAttributes: {},
      status: "confirmed" as const,
      confirmedAt: "2026-09-09T00:00:00.000Z",
    }],
    listings: [],
    sourceImages: [{
      path: `results/${jobId}/claims/${claimId}/source.jpg`,
      url: "https://fixture.invalid/source.jpg",
    }],
    generatedImages: aiGeneratedAssetSpecs.map((asset) => ({
      id: asset.id,
      path: generatedImagePaths[asset.id],
      url: `https://fixture.invalid/${asset.file}`,
    })),
    generatedImagePaths,
    localizedListings: [],
    studioResult: { warnings: [] },
    detailData: data,
    detailPage: {
      data,
      version: 1,
      approvedVersion: 1,
      imageManifest: {
        contract: productDetailImageManifestContract,
        algorithm: "sha256",
        digest,
        images,
      },
    },
  };
}

function createSourceSnapshot(context: ReturnType<typeof approvedContext>) {
  return {
    contract: "smartstore_listing_create_source_snapshot_v1",
    productId,
    ownerId,
    productUpdatedAt: "2026-09-10T00:00:00.000Z",
    detailPageVersion: context.detailPage.version,
    approvedDetailPageVersion: context.detailPage.approvedVersion,
    approvedManifestDigest: context.detailPage.imageManifest.digest,
    sellerManagementCode: sellerCode,
    credentialId,
    credentialVersion: 7,
    credentialFingerprint: "ABCDEF123456",
    credentialVaultSecretId: "77777777-7777-4777-8777-777777777777",
    credentialLastRotatedAt: "2026-09-10T00:00:00.000Z",
    productName: context.manualFields.productName,
    salePrice: context.manualFields.sellingPrice,
    stockQuantity: context.manualFields.stock,
    manualFieldsSha256: "e".repeat(64),
  };
}

function completeSmartstoreDraft(value: Record<string, unknown>) {
  let next = value;
  const set = (path: string[], replacement: unknown) => {
    next = setRegistrationValue(next, path, replacement);
  };
  set(["body", "originProduct", "detailAttribute", "unitCapacity", "unitPriceYn"], false);
  set(["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent", "childCertifiedProductExclusionYn"], false);
  set(["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent", "kcCertifiedProductExclusionYn"], "TRUE");
  set(["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent", "greenCertifiedProductExclusionYn"], false);
  set(["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent", "chemicalCertifiedProductExclusionYn"], false);
  set(["body", "originProduct", "deliveryInfo", "deliveryCompany"], "HANJIN");
  set(["body", "originProduct", "deliveryInfo", "deliveryFee", "deliveryFeeType"], "PAID");
  set(["body", "originProduct", "deliveryInfo", "deliveryFee", "baseFee"], 3_000);
  set(["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "returnDeliveryFee"], 3_000);
  set(["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "exchangeDeliveryFee"], 6_000);
  set(["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "shippingAddressId"], 12_345_678);
  set(["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "returnAddressId"], 87_654_321);
  return next;
}

test("approved new product keeps its revision and canonical SKU through SmartStore duplicate preflight", async () => {
  const context = approvedContext();
  const approved = approvedProductDetailManifestFromPublishContext(
    context as unknown as Record<string, unknown>,
  );
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.value.version, 1);

  const stale = structuredClone(context);
  stale.detailPage.approvedVersion = 0;
  assert.deepEqual(
    approvedProductDetailManifestFromPublishContext(stale as unknown as Record<string, unknown>),
    { ok: false, code: "DETAIL_PAGE_APPROVAL_REQUIRED" },
  );

  const draft = completeSmartstoreDraft(buildChannelArguments(
    "smartstore",
    context,
    10_000,
    1,
    undefined,
    { weight: 0.5, length: 10, width: 10, height: 10 },
    10,
  ));
  (draft.sellerpilotAssets as Record<string, unknown>).localizedDetailSections =
    defaultProductDetailImageRoles.map((role, index) => ({
      imageAsset: role,
      imageAltText: `승인 상세 이미지 ${index + 1}`,
      heading: `상세 ${index + 1}`,
      body: "검증된 상품 설명",
    }));
  const bound = bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: draft,
    publishContext: context as unknown as Record<string, unknown>,
    sourceSnapshot: createSourceSnapshot(context),
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  });
  const sellerManagementCode = (((bound.body as Record<string, unknown>).originProduct as Record<string, unknown>)
    .detailAttribute as { sellerCodeInfo: { sellerManagementCode: string } })
    .sellerCodeInfo.sellerManagementCode;
  assert.equal(sellerManagementCode, sellerCode);
  assert.deepEqual(bound.sellerpilotSmartstoreCreateSource, {
    contract: "smartstore_listing_create_source_v1",
    productId,
    ownerId,
    productUpdatedAt: "2026-09-10T00:00:00.000Z",
    detailPageVersion: 1,
    approvedDetailPageVersion: 1,
    approvedManifestDigest: context.detailPage.imageManifest.digest,
    sellerManagementCode: sellerCode,
    credentialId,
    credentialVersion: 7,
    credentialFingerprint: "ABCDEF123456",
    credentialVaultSecretId: "77777777-7777-4777-8777-777777777777",
    credentialLastRotatedAt: "2026-09-10T00:00:00.000Z",
    productName: context.manualFields.productName,
    salePrice: context.manualFields.sellingPrice,
    stockQuantity: context.manualFields.stock,
    manualFieldsSha256: "e".repeat(64),
    bodyBindingSha256: (bound.sellerpilotSmartstoreCreateSource as Record<string, unknown>).bodyBindingSha256,
  });
  assert.throws(() => bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: draft,
    publishContext: context as unknown as Record<string, unknown>,
    sourceSnapshot: {
      ...createSourceSnapshot(context),
      approvedDetailPageVersion: 2,
      detailPageVersion: 2,
    },
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  }), /SMARTSTORE_CREATE_SOURCE_REVISION_MISMATCH/u);
  assert.throws(() => bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: draft,
    publishContext: context as unknown as Record<string, unknown>,
    sourceSnapshot: {
      ...createSourceSnapshot(context),
      credentialVersion: 0,
    },
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  }), /SMARTSTORE_CREATE_SOURCE_SNAPSHOT_INVALID/u);
  const signedDetailUrls = defaultProductDetailImageRoles.map((_, index) =>
    `https://signed.invalid/detail-${index + 1}.jpg`);
  const providerReady = bindMarketplaceArgumentsToApprovedDetailManifest(
    bound,
    approved.value,
    signedDetailUrls,
  );
  providerReady.imageUrls = [
    "https://signed.invalid/representative.jpg",
    ...signedDetailUrls,
  ];
  (((providerReady.body as Record<string, unknown>).originProduct as Record<string, unknown>))
    .detailContent = signedDetailUrls.map((url) => `<img src="${url}" />`).join("");
  providerReady.publicationStateContract = "verified_remote_state_v1";
  providerReady.publicationIntent = "live";
  providerReady.publicationExpectedLocale = "ko-KR";
  providerReady.publicationExpectedImageCount = 8;

  const forged = structuredClone(draft);
  (((forged.body as Record<string, unknown>).originProduct as Record<string, unknown>)
    .detailAttribute as { sellerCodeInfo: { sellerManagementCode: string } })
    .sellerCodeInfo.sellerManagementCode = "FORGED-ABSENT-CODE";
  assert.throws(() => bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: forged,
    publishContext: context as unknown as Record<string, unknown>,
    sourceSnapshot: createSourceSnapshot(context),
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  }), /SMARTSTORE_CREATE_SELLER_CODE_MISMATCH/u);

  const notReady = structuredClone(context);
  notReady.product.status = "draft";
  assert.throws(() => bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: draft,
    publishContext: notReady as unknown as Record<string, unknown>,
    sourceSnapshot: createSourceSnapshot(context),
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  }), /SMARTSTORE_CREATE_PRODUCT_NOT_READY/u);

  const existing = structuredClone(context);
  existing.listings.push({
    channel: "smartstore", market: "KR", targetId: "",
    remoteId: "13688607602", status: "published",
  } as never);
  assert.throws(() => bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: draft,
    publishContext: existing as unknown as Record<string, unknown>,
    sourceSnapshot: createSourceSnapshot(context),
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  }), /SMARTSTORE_CREATE_EXISTING_LISTING_REQUIRES_UPDATE/u);

  const searchBodies: Record<string, unknown>[] = [];
  const providerPaths: string[] = [];
  let providerMutations = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    providerPaths.push(url.pathname);
    if (url.pathname.endsWith(`/v1/categories/${categoryId}`)) {
      return Response.json({ id: categoryId, last: true, exceptionalCategories: [] });
    }
    if (url.pathname.endsWith("/v1/products/search")) {
      searchBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        page: 1,
        size: 50,
        totalElements: 1,
        totalPages: 1,
        first: true,
        last: true,
        contents: [{ originProductNo: "13688607602" }],
      });
    }
    throw new Error(`unexpected provider request: ${url.pathname}`);
  };
  try {
    await assert.rejects(() => prepareMarketplaceListingArguments({
      channel: "smartstore",
      operation: "listing.create",
      environment: "production",
      credential: {
        access_token: "fixture-token",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        after_service_phone: "02-1234-5678",
      },
      arguments: providerReady,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => {},
        beginProviderMutation: async () => { providerMutations += 1; },
      },
    }), /NAVER_EXISTING_PRODUCT_REQUIRES_UPDATE/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(providerPaths, [
    `/external/v1/categories/${categoryId}`,
    "/external/v1/products/search",
  ]);
  assert.deepEqual(searchBodies, [{
    searchKeywordType: "SELLER_CODE",
    sellerManagementCode: sellerCode,
    page: 1,
    size: 50,
    orderType: "NO",
  }]);
  assert.equal(providerMutations, 0);
});

test("one unchanged SmartStore source snapshot rejects a second title/price/stock body", async () => {
  const context = approvedContext();
  const approved = approvedProductDetailManifestFromPublishContext(
    context as unknown as Record<string, unknown>,
  );
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const draft = completeSmartstoreDraft(buildChannelArguments(
    "smartstore",
    context,
    10_000,
    1,
    undefined,
    { weight: 0.5, length: 10, width: 10, height: 10 },
    10,
  ));
  const snapshot = createSourceSnapshot(context);
  const first = bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: draft,
    publishContext: context as unknown as Record<string, unknown>,
    sourceSnapshot: snapshot,
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  });
  const firstBody = first.body as {
    originProduct: { name: string; salePrice: number; stockQuantity: number };
  };
  assert.equal(firstBody.originProduct.name, context.manualFields.productName);
  assert.equal(firstBody.originProduct.salePrice, 10_000);
  assert.equal(firstBody.originProduct.stockQuantity, 1);

  const second = structuredClone(draft);
  const origin = (second.body as Record<string, unknown>).originProduct as Record<string, unknown>;
  origin.name = "다른 제목";
  origin.salePrice = 990_000;
  origin.stockQuantity = 99;
  ((second.body as Record<string, unknown>).smartstoreChannelProduct as Record<string, unknown>)
    .channelProductName = "다른 제목";
  assert.throws(() => bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: second,
    publishContext: context as unknown as Record<string, unknown>,
    sourceSnapshot: snapshot,
    approvedDetail: approved.value,
    productId,
    credentialId,
    market: "KR",
    targetId: "",
  }), /SMARTSTORE_CREATE_COMMERCIAL_SOURCE_MISMATCH/u);
});
