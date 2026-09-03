import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import {
  bindCoupangExactQaRecoveryArguments,
  buildCoupangExactQaGalleryImages,
  coupangExactQaCreateForbidden,
  coupangExactQaRecoveryBinding,
  coupangExactQaRecoveryCandidate,
  coupangExactQaRecoveryIdentity,
} from "../lib/channels/coupang-exact-qa-recovery";
import {
  assertCoupangExactQaCurrentProduct,
  assertCoupangExactQaInventoryReadback,
  assertCoupangExactQaUpdateReadback,
  prepareCoupangExactQaRecoveryArguments,
} from "../lib/channels/coupang-listing-update";
import { listingUpdateServerCandidate } from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  coupangProviderImageSnapshotSha256,
  type CoupangProviderImageIdentity,
  verifyCoupangExactRepresentativeReadback,
} from "../lib/channels/coupang-representative-readback";
import { prepareMarketplaceListingArguments } from "../lib/channels/provider-listing-runtime";

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

const fingerprint = "c".repeat(64);
const missingFixtureField = Symbol("missing-fixture-field");
const representativeImageUrl = "https://cdn.example.com/coupang-exact-representative.jpg";
const representativeSourcePath =
  "results/10000000-0000-4000-8000-000000000001/claims/10000000-0000-4000-8000-000000000002/thumbnail-square.png";
const representativeSourceSha = "a".repeat(64);
const representativeContentSha = "b".repeat(64);
const representativeObjectPath =
  `normalized/${representativeContentSha.slice(0, 2)}/${representativeContentSha}.jpg`;

function exactRepresentativeBinding() {
  return {
    contract: "coupang_exact_qa_representative_v1",
    role: "gallery-representative",
    sourceBucket: "sellerpilot-ai",
    sourceObjectPath: representativeSourcePath,
    sourceSha256: representativeSourceSha,
    normalizedObjectPath: representativeObjectPath,
    contentSha256: representativeContentSha,
  };
}

function setFixtureField(
  root: Record<string, unknown>,
  path: string[],
  value: unknown | typeof missingFixtureField,
) {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    assert.ok(next && typeof next === "object" && !Array.isArray(next));
    current = next as Record<string, unknown>;
  }
  const key = path.at(-1);
  assert.ok(key);
  if (value === missingFixtureField) delete current[key];
  else current[key] = value;
}

function detailImageUrls() {
  return Array.from(
    { length: coupangExactQaRecoveryIdentity.detailImageCount },
    (_, index) => `https://cdn.example.com/coupang-exact-${index + 1}.jpg`,
  );
}

function detailContents() {
  return detailImageUrls().map((url) => ({
    contentsType: "IMAGE",
    contentDetails: [{
      detailType: "IMAGE",
      content: url,
    }],
  }));
}

function exactGalleryImages() {
  return [representativeImageUrl, ...detailImageUrls()].map((vendorPath, imageOrder) => ({
    imageOrder,
    imageType: imageOrder === 0 ? "REPRESENTATION" : "DETAIL",
    vendorPath,
  }));
}

function providerReadbackGalleryImages(
  argumentsValue: Record<string, unknown>,
  representative: "old" | "expected" = "expected",
) {
  const assets = argumentsValue.sellerpilotPublicationAssetBinding as {
    providerTransportImages: Array<{ contentSha256: string }>;
  };
  return assets.providerTransportImages.map((asset, imageOrder) => {
    const basename = imageOrder === 0 && representative === "old"
      ? "old-representative.jpg"
      : `${asset.contentSha256}.jpg`;
    return {
      imageOrder,
      imageType: imageOrder === 0 ? "REPRESENTATION" : "DETAIL",
      cdnPath: `vendor_inventory/images/2026/09/01/${basename}`,
      vendorPath: basename,
    };
  });
}

function exactPublicationAssetBinding() {
  const approved = detailImageUrls().map((publicUrl, index) => ({
    role: `detail-role-${index + 1}`,
    approvedObjectPath: `results/detail-${index + 1}.png`,
    approvedSourceSha256: String(index + 1).repeat(64).slice(0, 64),
    publicUrl,
    objectPath: `normalized/${index + 1}/detail-${index + 1}.jpg`,
    contentSha256: String(8 - index).repeat(64).slice(0, 64),
  }));
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    providerImageSurface: "gallery",
    approvedDetailImages: approved,
    providerTransportImages: [{
      role: "gallery-representative",
      approvedObjectPath: representativeSourcePath,
      approvedSourceSha256: representativeSourceSha,
      publicUrl: representativeImageUrl,
      objectPath: representativeObjectPath,
      contentSha256: representativeContentSha,
    }, ...approved],
  };
}

function exactNotices() {
  return [
    ["품명 및 모델명", "부착형 케이블 정리 클립 6개 세트"],
    ["인증/허가 사항", "해당사항 없음"],
    ["제조국(원산지)", "중국"],
    ["제조자(수입자)", "Generic OEM"],
    ["소비자상담 관련 전화번호", "쿠팡 판매자 문의 이용"],
  ].map(([noticeCategoryDetailName, content]) => ({
    noticeCategoryName: "기타 재화",
    noticeCategoryDetailName,
    content,
  }));
}

function exactRemoteProduct(overrides: Record<string, unknown> = {}) {
  return {
    sellerProductId: Number(coupangExactQaRecoveryIdentity.sellerProductId),
    displayCategoryCode: coupangExactQaRecoveryIdentity.displayCategoryCode,
    sellerProductName: "부착형 케이블 정리 클립 6개 세트",
    displayProductName: "부착형 케이블 정리 클립 6개 세트",
    brand: "No Brand",
    manufacture: "Generic OEM",
    requested: true,
    statusName: "승인완료",
    items: [{
      vendorItemId: Number(coupangExactQaRecoveryIdentity.vendorItemId),
      externalVendorSku: coupangExactQaRecoveryIdentity.sellerSku,
      modelNo: coupangExactQaRecoveryIdentity.sellerSku,
      itemName: "부착형 케이블 정리 클립 검정색 6개",
      originalPrice: coupangExactQaRecoveryIdentity.priceKrw,
      salePrice: coupangExactQaRecoveryIdentity.priceKrw,
      maximumBuyCount: coupangExactQaRecoveryIdentity.stock,
      images: exactGalleryImages(),
      attributes: [{ attributeTypeName: "색상", attributeValueName: "검정색" }],
      notices: exactNotices(),
      contents: detailContents(),
    }],
    ...overrides,
  };
}

function baseRecoveryArguments() {
  return bindCoupangExactQaRecoveryArguments({
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    sellerpilotCoupangExactQaRepresentative: exactRepresentativeBinding(),
    sellerpilotPublicationAssetBinding: exactPublicationAssetBinding(),
    body: {
      sellerProductId: Number(coupangExactQaRecoveryIdentity.sellerProductId),
      displayCategoryCode: coupangExactQaRecoveryIdentity.displayCategoryCode,
      sellerProductName: "부착형 케이블 정리 클립 6개 세트",
      items: [{
        sellerpilotItemMatchId: coupangExactQaRecoveryIdentity.sellerSku,
        externalVendorSku: coupangExactQaRecoveryIdentity.sellerSku,
        itemName: "부착형 케이블 정리 클립 화이트 6개",
        modelNo: coupangExactQaRecoveryIdentity.sellerSku,
        originalPrice: coupangExactQaRecoveryIdentity.priceKrw,
        salePrice: coupangExactQaRecoveryIdentity.priceKrw,
        maximumBuyCount: coupangExactQaRecoveryIdentity.stock,
        images: exactGalleryImages(),
        attributes: [
          { attributeTypeName: "색상", attributeValueName: "화이트" },
          { attributeTypeName: "수량", attributeValueName: "6개" },
        ],
        notices: [],
        contents: detailContents(),
      }],
    },
  }, "listing.update");
}

function sanitizedRecoveryArguments() {
  const value = structuredClone(baseRecoveryArguments());
  const item = (value.body as { items: Array<Record<string, unknown>> }).items[0];
  item.sellerpilotItemMatchId = coupangExactQaRecoveryIdentity.vendorItemId;
  delete item.externalVendorSku;
  delete item.originalPrice;
  delete item.salePrice;
  delete item.maximumBuyCount;
  return value;
}

function baseStopRecoveryArguments() {
  return bindCoupangExactQaRecoveryArguments({
    sellerProductId: coupangExactQaRecoveryIdentity.sellerProductId,
    vendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
    sellerSku: coupangExactQaRecoveryIdentity.sellerSku,
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 0,
  }, "listing.stop");
}

function outboundResponse() {
  return {
    code: "SUCCESS",
    data: { content: [{
      usable: true,
      outboundShippingPlaceCode: 25291339,
      placeAddresses: [{
        countryCode: "KR",
        addressType: "ROADNAME",
        returnZipCode: "06236",
        returnAddress: "서울특별시 강남구 테헤란로",
        returnAddressDetail: "1층",
        companyContactNumber: "02-0000-0000",
      }],
    }] },
  };
}

function returnCenterResponse() {
  return {
    code: "SUCCESS",
    data: { content: [{
      usable: true,
      returnCenterCode: "RET-001",
      deliverCode: "CJGLS",
      shippingPlaceName: "서울 반품지",
      returnFee02kg: 3000,
      placeAddresses: [{
        countryCode: "KR",
        addressType: "ROADNAME",
        returnZipCode: "06236",
        returnAddress: "서울특별시 강남구 테헤란로",
        returnAddressDetail: "1층",
        companyContactNumber: "02-0000-0000",
      }],
    }] },
  };
}

function categoryMetadataResponse(noticeCategoryName = "기타 재화") {
  return {
    code: "SUCCESS",
    data: {
      attributes: [{
        attributeTypeName: "색상",
        dataType: "STRING",
        required: "MANDATORY",
        groupNumber: "NONE",
        exposed: "EXPOSED",
      }],
      noticeCategories: [{
        noticeCategoryName,
        noticeCategoryDetailNames: exactNotices().map((notice) => ({
          noticeCategoryDetailName: notice.noticeCategoryDetailName,
          required: "MANDATORY",
        })),
      }],
      certifications: [],
    },
  };
}

async function prepareExactRecoveryWithFetch(
  noticeCategoryName = "기타 재화",
  returnCenter = returnCenterResponse(),
) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; pathname: string }> = [];
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    calls.push({ method: init?.method ?? "GET", pathname });
    if (pathname.endsWith("/shipping-place/outbound")) return Response.json(outboundResponse());
    if (pathname.includes("/returnShippingCenters")) return Response.json(returnCenter);
    if (pathname.endsWith("/status")) return Response.json({ code: "SUCCESS", data: true });
    return Response.json(categoryMetadataResponse(noticeCategoryName));
  };
  try {
    const prepared = await prepareMarketplaceListingArguments({
      channel: "coupang",
      operation: "listing.update",
      credential: {
        vendor_id: "A00012345",
        access_key: "access",
        secret_key: "secret",
        requested_by: "wing-user",
      },
      arguments: baseRecoveryArguments(),
      environment: "production",
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => assert.fail("recovery metadata preparation must be read-only"),
      },
    });
    return { prepared, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("only the exact stale Coupang ledger row is an update recovery candidate", () => {
  const candidate = {
    channel: "coupang",
    listingId: coupangExactQaRecoveryIdentity.listingId,
    remoteId: coupangExactQaRecoveryIdentity.sellerProductId,
    status: "failed",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
    failureClass: null,
  };
  assert.equal(coupangExactQaRecoveryCandidate(candidate), true);
  assert.equal(listingUpdateServerCandidate("coupang", candidate), true);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, failureClass: "external_action" }), true);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, listingId: crypto.randomUUID() }), false);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, remoteId: "16356981735" }), false);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, remoteVisibility: "live" }), false);
});

test("the exact QA product and immutable remote SKU can never enter listing.create", () => {
  assert.equal(coupangExactQaCreateForbidden({
    productId: coupangExactQaRecoveryIdentity.productId,
  }), true);
  assert.equal(coupangExactQaCreateForbidden({
    argumentsValue: {
      body: { items: [{ externalVendorSku: coupangExactQaRecoveryIdentity.sellerSku }] },
    },
  }), true);
  assert.equal(coupangExactQaCreateForbidden({
    productId: crypto.randomUUID(),
    argumentsValue: { body: { items: [{ externalVendorSku: "OTHER-SKU" }] } },
  }), false);
});

test("exact gallery keeps one representative plus all eight approved detail images", () => {
  const images = buildCoupangExactQaGalleryImages(
    [representativeImageUrl, "https://cdn.example.com/unused-gallery.jpg"],
    detailImageUrls(),
  );
  assert.ok(images);
  assert.equal(images.length, 9);
  assert.equal(images[0].imageType, "REPRESENTATION");
  assert.deepEqual(images.slice(1).map((image) => image.vendorPath), detailImageUrls());
});

test("exact recovery prepares current category, active shipping metadata, strict facts, and eight buyer images", async () => {
  const { prepared, calls } = await prepareExactRecoveryWithFetch();
  const body = prepared.arguments.body as Record<string, unknown>;
  const item = (body.items as Array<Record<string, unknown>>)[0];
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET", "GET"]);
  assert.equal(body.sellerProductId, Number(coupangExactQaRecoveryIdentity.sellerProductId));
  assert.equal(body.displayCategoryCode, 64574);
  assert.equal(body.brand, "No Brand");
  assert.equal(body.manufacture, "Generic OEM");
  assert.equal(body.outboundShippingPlaceCode, 25291339);
  assert.equal(body.returnCenterCode, "RET-001");
  assert.equal(body.deliveryCompanyCode, "CJGLS");
  assert.equal(item.sellerpilotItemMatchId, coupangExactQaRecoveryIdentity.vendorItemId);
  assert.equal(item.originalPrice, coupangExactQaRecoveryIdentity.priceKrw);
  assert.equal(item.salePrice, coupangExactQaRecoveryIdentity.priceKrw);
  assert.equal(item.maximumBuyCount, coupangExactQaRecoveryIdentity.stock);
  assert.deepEqual(item.images, exactGalleryImages());
  assert.equal((item.contents as unknown[]).filter((value) =>
    (value as Record<string, unknown>).contentsType === "IMAGE").length, 8);
  assert.deepEqual(item.notices, exactNotices());
  assert.ok((item.attributes as Array<Record<string, unknown>>).some((attribute) =>
    attribute.attributeTypeName === "색상" && attribute.attributeValueName === "검정색"));
});

test("exact recovery accepts the server-sanitized content patch and restores immutable commerce values", () => {
  const prepared = prepareCoupangExactQaRecoveryArguments(
    sanitizedRecoveryArguments(),
  );
  const item = (prepared.body as { items: Array<Record<string, unknown>> }).items[0];
  assert.equal(
    item.sellerpilotItemMatchId,
    coupangExactQaRecoveryIdentity.vendorItemId,
  );
  assert.equal(item.originalPrice, coupangExactQaRecoveryIdentity.priceKrw);
  assert.equal(item.salePrice, coupangExactQaRecoveryIdentity.priceKrw);
  assert.equal(item.maximumBuyCount, coupangExactQaRecoveryIdentity.stock);
});

test("exact recovery fails before PUT when Coupang metadata does not expose the approved notice category", async () => {
  await assert.rejects(
    prepareExactRecoveryWithFetch("가정용 전기제품"),
    /COUPANG_EXACT_QA_NOTICE_CATEGORY_UNAVAILABLE/,
  );
});

test("exact recovery fails before PUT without an active return center and carrier", async () => {
  const unavailable = returnCenterResponse();
  unavailable.data.content[0].usable = false;
  unavailable.data.content[0].deliverCode = "";
  await assert.rejects(
    prepareExactRecoveryWithFetch("기타 재화", unavailable),
    /COUPANG_USABLE_RETURN_CENTER_MISSING/,
  );
});

test("exact update rejects missing or null provider fields before any Coupang request", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected request: ${String(input)}`);
  };
  const requiredFields = [
    ["body.sellerProductId", ["body", "sellerProductId"]],
    ["publicationIntent", ["publicationIntent"]],
    ["publicationStateContract", ["publicationStateContract"]],
    ["publicationExpectedLocale", ["publicationExpectedLocale"]],
    ["publicationExpectedFingerprint", ["publicationExpectedFingerprint"]],
    ["publicationExpectedImageCount", ["publicationExpectedImageCount"]],
    ["sellerpilotPublicationAssetBinding", ["sellerpilotPublicationAssetBinding"]],
  ] as const;
  try {
    for (const [field, path] of requiredFields) {
      for (const [variant, value] of [
        ["missing", missingFixtureField],
        ["null", null],
      ] as const) {
        const argumentsValue = structuredClone(baseRecoveryArguments());
        setFixtureField(argumentsValue, [...path], value);
        await assert.rejects(
          executeChannelOperation({
            channel: "coupang",
            operation: "listing.update",
            payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
            arguments: argumentsValue,
            environment: "production",
          }),
          /COUPANG_EXACT_QA_PROVIDER_CONTRACT_MISMATCH/,
          `${field}:${variant}`,
        );
        assert.deepEqual(calls, [], `${field}:${variant}`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact update rejects price, stock, SKU, or image drift before any Coupang request", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected request: ${String(input)}`);
  };
  const mutations: Array<(argumentsValue: ReturnType<typeof baseRecoveryArguments>) => void> = [
    (argumentsValue) => {
      const item = (argumentsValue.body as { items: Array<Record<string, unknown>> }).items[0];
      item.salePrice = 5_010;
    },
    (argumentsValue) => {
      const item = (argumentsValue.body as { items: Array<Record<string, unknown>> }).items[0];
      item.maximumBuyCount = 2;
    },
    (argumentsValue) => {
      const item = (argumentsValue.body as { items: Array<Record<string, unknown>> }).items[0];
      item.externalVendorSku = "OTHER-SKU";
    },
    (argumentsValue) => {
      const item = (argumentsValue.body as { items: Array<Record<string, unknown>> }).items[0];
      (item.images as Array<Record<string, unknown>>).pop();
    },
    (argumentsValue) => {
      const binding = argumentsValue.sellerpilotPublicationAssetBinding as {
        providerTransportImages: Array<Record<string, unknown>>;
      };
      binding.providerTransportImages[7].publicUrl = "https://cdn.example.com/tampered.jpg";
    },
  ];
  try {
    for (const mutate of mutations) {
      const argumentsValue = structuredClone(baseRecoveryArguments());
      mutate(argumentsValue);
      await assert.rejects(
        executeChannelOperation({
          channel: "coupang",
          operation: "listing.update",
          payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
          arguments: argumentsValue,
          environment: "production",
        }),
        /COUPANG_EXACT_QA_(?:PROVIDER_CONTRACT_MISMATCH|BUYER_CONTENT_IMAGES_REQUIRED|GALLERY_IMAGES_REQUIRED)/,
      );
      assert.deepEqual(calls, []);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact stop rejects missing or null provider fields before any Coupang request", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected request: ${String(input)}`);
  };
  const requiredFields = [
    ["sellerProductId", ["sellerProductId"]],
    ["vendorItemId", ["vendorItemId"]],
    ["sellerSku", ["sellerSku"]],
    ["publicationExpectedImageCount", ["publicationExpectedImageCount"]],
  ] as const;
  try {
    for (const [field, path] of requiredFields) {
      for (const [variant, value] of [
        ["missing", missingFixtureField],
        ["null", null],
      ] as const) {
        const argumentsValue = structuredClone(baseStopRecoveryArguments());
        setFixtureField(argumentsValue, [...path], value);
        await assert.rejects(
          executeChannelOperation({
            channel: "coupang",
            operation: "listing.stop",
            payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
            arguments: argumentsValue,
            environment: "production",
          }),
          /COUPANG_EXACT_QA_PROVIDER_CONTRACT_MISMATCH/,
          `${field}:${variant}`,
        );
        assert.deepEqual(calls, [], `${field}:${variant}`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact update proves signed GET before PUT and verifies the strict readback", async () => {
  const { prepared } = await prepareExactRecoveryWithFetch();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; pathname: string; body: string }> = [];
  let sellerReads = 0;
  let transmittedBody: Record<string, unknown> | null = null;
  const prewriteProduct = exactRemoteProduct();
  prewriteProduct.items[0].images = providerReadbackGalleryImages(
    prepared.arguments,
    "old",
  );
  let boundPrewrite: CoupangProviderImageIdentity[] | null = null;
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    calls.push({ method, pathname, body: String(init?.body ?? "") });
    if (method === "PUT") {
      transmittedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Response.json({ code: "SUCCESS", data: null });
    }
    if (pathname.includes(`/vendor-items/${coupangExactQaRecoveryIdentity.vendorItemId}/inventories`)) {
      return Response.json({
        code: "SUCCESS",
        data: {
          // Coupang names this response field sellerItemId and does not promise
          // that it echoes the vendorItemId used in the request path.
          sellerItemId: 123456789,
          amountInStock: coupangExactQaRecoveryIdentity.stock,
          salePrice: coupangExactQaRecoveryIdentity.priceKrw,
          onSale: true,
        },
      });
    }
    sellerReads += 1;
    const providerReadback = transmittedBody
      ? structuredClone(transmittedBody)
      : null;
    if (providerReadback) {
      providerReadback.requested = true;
      providerReadback.statusName = "승인완료";
      const providerItems = providerReadback.items as Array<Record<string, unknown>>;
      providerItems[0].images = providerReadbackGalleryImages(prepared.arguments);
    }
    return Response.json({
      code: "SUCCESS",
      data: providerReadback ?? prewriteProduct,
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.update",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: prepared.arguments,
      environment: "production",
      providerMutationHooks: {
        assertLeaseHealthy: async () => {},
        bindCoupangRepresentativePrewrite: async (images) => {
          boundPrewrite = images;
          return {
            prewriteSnapshotSha256: coupangProviderImageSnapshotSha256(images),
          };
        },
        begin: async () => {},
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.remoteState?.visibility, "live");
    assert.deepEqual(
      result.steps.find((step) => step.name === "listing-readback")?.data
        .sellerpilotCoupangExactRepresentativeReadback,
      {
        ...exactRepresentativeBinding(),
        contract: "coupang_exact_qa_representative_readback_v1",
        sellerProductId: coupangExactQaRecoveryIdentity.sellerProductId,
        vendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
        representativeImageCount: 1,
        detailImageCount: 8,
        remoteGalleryVerified: true,
        providerPrewriteSnapshotSha256:
          coupangProviderImageSnapshotSha256(boundPrewrite!),
        prewriteImages: boundPrewrite,
        postwriteImages: providerReadbackGalleryImages(prepared.arguments),
        expectedContentSha256s: (prepared.arguments
          .sellerpilotPublicationAssetBinding as {
            providerTransportImages: Array<{ contentSha256: string }>;
          }).providerTransportImages.map((asset) => asset.contentSha256),
        providerReadbackSnapshotSha256: coupangProviderImageSnapshotSha256(
          providerReadbackGalleryImages(prepared.arguments),
        ),
        providerVendorBasenamesVerified: true,
        providerRepresentativeAlreadyExpected: false,
        providerRepresentativeChanged: true,
        providerDetailImagesPreserved: true,
      },
    );
    assert.equal(sellerReads, 3);
    assert.deepEqual(calls.slice(0, 4).map((call) => call.method), ["GET", "GET", "PUT", "GET"]);
    const transmitted = JSON.parse(calls.find((call) => call.method === "PUT")!.body);
    assert.equal(transmitted.sellerProductId, Number(coupangExactQaRecoveryIdentity.sellerProductId));
    assert.equal(transmitted.items.length, 1);
    assert.equal(transmitted.items[0].vendorItemId, Number(coupangExactQaRecoveryIdentity.vendorItemId));
    const binding = coupangExactQaRecoveryBinding(prepared.arguments, "listing.update");
    assert.ok(binding);
    assertCoupangExactQaUpdateReadback(transmitted, binding);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serverless exact update binds fresh provider images before one mutation fence", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let transmittedBody: Record<string, unknown> | null = null;
  const serverlessArguments = structuredClone(baseRecoveryArguments());
  const approvedDetailImages = Array.from({ length: 8 }, (_, index) => {
    const contentSha256 = (index + 1).toString(16).repeat(64).slice(0, 64);
    const objectPath =
      `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
    return {
      role: `detail-${index + 1}`,
      approvedObjectPath:
        `results/11000000-0000-4000-8000-000000000001/claims/12000000-0000-4000-8000-000000000001/detail-${index + 1}.png`,
      approvedSourceSha256: (index + 9).toString(16).repeat(64).slice(0, 64),
      publicUrl:
        `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
      objectPath,
      contentSha256,
    };
  });
  const representativeAsset = {
    role: "gallery-representative",
    approvedObjectPath: representativeSourcePath,
    approvedSourceSha256: representativeSourceSha,
    publicUrl:
      `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${representativeObjectPath}`,
    objectPath: representativeObjectPath,
    contentSha256: representativeContentSha,
  };
  serverlessArguments.sellerpilotPublicationAssetBinding = {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "e".repeat(64),
    providerImageSurface: "gallery",
    approvedDetailImages,
    providerTransportImages: [representativeAsset, ...approvedDetailImages],
  };
  const serverlessItem = (serverlessArguments.body as {
    items: Array<Record<string, unknown>>;
  }).items[0];
  serverlessItem.images = [representativeAsset, ...approvedDetailImages].map(
    (image, imageOrder) => ({
      imageOrder,
      imageType: imageOrder === 0 ? "REPRESENTATION" : "DETAIL",
      vendorPath: image.publicUrl,
    }),
  );
  serverlessItem.contents = [...approvedDetailImages.map((image) => ({
    contentsType: "IMAGE",
    contentDetails: [{ detailType: "IMAGE", content: image.publicUrl }],
  })), {
    contentsType: "TEXT",
    contentDetails: [{
      detailType: "TEXT",
      content: "부착형 케이블 정리 클립의 재질과 구성, 설치 방법 및 사용 시 주의사항을 확인하세요.",
    }],
  }];
  const prewriteProduct = exactRemoteProduct();
  prewriteProduct.items[0].images = providerReadbackGalleryImages(
    serverlessArguments,
    "old",
  );
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    events.push(`fetch:${method}:${pathname}`);
    if (pathname.endsWith("/shipping-place/outbound")) {
      return Response.json(outboundResponse());
    }
    if (pathname.includes("/returnShippingCenters")) {
      return Response.json(returnCenterResponse());
    }
    if (pathname.endsWith("/status")) {
      return Response.json({ code: "SUCCESS", data: true });
    }
    if (pathname.includes("/category-related-metas/")) {
      return Response.json(categoryMetadataResponse());
    }
    if (pathname.includes(`/vendor-items/${coupangExactQaRecoveryIdentity.vendorItemId}/inventories`)) {
      return Response.json({
        code: "SUCCESS",
        data: {
          sellerItemId: 123456789,
          amountInStock: coupangExactQaRecoveryIdentity.stock,
          salePrice: coupangExactQaRecoveryIdentity.priceKrw,
          onSale: true,
        },
      });
    }
    if (method === "PUT") {
      transmittedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Response.json({ code: "SUCCESS", data: null });
    }
    if (pathname.includes(`/seller-products/${coupangExactQaRecoveryIdentity.sellerProductId}`)) {
      if (!transmittedBody) {
        return Response.json({ code: "SUCCESS", data: prewriteProduct });
      }
      const postwriteProduct = structuredClone(transmittedBody);
      postwriteProduct.requested = true;
      postwriteProduct.statusName = "승인완료";
      const items = postwriteProduct.items as Array<Record<string, unknown>>;
      items[0].images = providerReadbackGalleryImages(serverlessArguments);
      return Response.json({ code: "SUCCESS", data: postwriteProduct });
    }
    throw new Error(`unexpected Coupang request: ${method} ${pathname}`);
  };
  const job: GatewayClaim = {
    id: "51000000-0000-4000-8000-000000000991",
    claim_token: "52000000-0000-4000-8000-000000000991",
    credential_id: "53000000-0000-4000-8000-000000000991",
    channel: "coupang",
    operation: "listing.update",
    environment: "production",
    request: { arguments: serverlessArguments },
    credential: {
      vendor_id: "A00012345",
      access_key: "access",
      secret_key: "secret",
      requested_by: "wing-user",
    },
    attempt_count: 1,
  };
  try {
    const result = await executeServerlessGatewayProviderJob({
      job,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => { events.push("lease"); },
        beginProviderMutation: async () => { events.push("begin"); },
        bindCoupangRepresentativePrewrite: async (images) => {
          events.push("bind-prewrite");
          return {
            prewriteSnapshotSha256: coupangProviderImageSnapshotSha256(images),
          };
        },
        beginCredentialMutation: async () => assert.fail("unexpected credential mutation"),
        stageCredentialRefresh: async () => assert.fail("unexpected credential refresh"),
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.publicationFulfilled, true, JSON.stringify(result));
    assert.equal(
      (result.remoteState?.evidence.publicationAssetBinding as {
        providerTransportRoles?: unknown[];
      } | undefined)?.providerTransportRoles?.length,
      9,
    );
    assert.equal(events.filter((event) => event === "bind-prewrite").length, 1);
    assert.equal(events.filter((event) => event === "begin").length, 1);
    const bindIndex = events.indexOf("bind-prewrite");
    const beginIndex = events.indexOf("begin");
    const putIndex = events.findIndex((event) => event.startsWith("fetch:PUT:"));
    const preSellerIndex = events.findIndex((event) =>
      event.includes(`/seller-products/${coupangExactQaRecoveryIdentity.sellerProductId}`));
    const preInventoryIndex = events.findIndex((event) =>
      event.includes(`/vendor-items/${coupangExactQaRecoveryIdentity.vendorItemId}/inventories`));
    assert.ok(preSellerIndex >= 0 && preSellerIndex < bindIndex);
    assert.ok(preInventoryIndex >= 0 && preInventoryIndex < bindIndex);
    assert.ok(bindIndex < beginIndex && beginIndex < putIndex);
    assert.ok(events.findIndex((event, index) => index > putIndex
      && event.includes(`/seller-products/${coupangExactQaRecoveryIdentity.sellerProductId}`)) > putIndex);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact update blocks before PUT when authoritative commerce state is not 5,000 KRW, stock 1, and on sale", async () => {
  const { prepared } = await prepareExactRecoveryWithFetch();
  const cases = [
    { amountInStock: 2, salePrice: 5_000, onSale: true },
    { amountInStock: 1, salePrice: 5_010, onSale: true },
    { amountInStock: 1, salePrice: 5_000, onSale: false },
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const commerce of cases) {
      const calls: Array<{ method: string; pathname: string }> = [];
      globalThis.fetch = async (input, init) => {
        const pathname = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        calls.push({ method, pathname });
        if (pathname.includes(`/vendor-items/${coupangExactQaRecoveryIdentity.vendorItemId}/inventories`)) {
          return Response.json({
            code: "SUCCESS",
            data: {
              sellerItemId: Number(coupangExactQaRecoveryIdentity.vendorItemId),
              ...commerce,
            },
          });
        }
        return Response.json({ code: "SUCCESS", data: exactRemoteProduct() });
      };
      const result = await executeChannelOperation({
        channel: "coupang",
        operation: "listing.update",
        payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
        arguments: prepared.arguments,
        environment: "production",
      });
      assert.equal(result.ok, false, JSON.stringify(commerce));
      assert.equal(calls.some((call) => call.method === "PUT"), false, JSON.stringify(commerce));
      assert.equal(
        result.steps.at(-1)?.data.sellerpilotVerification,
        "COUPANG_EXACT_QA_COMMERCE_READBACK_MISMATCH",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact update readback rejects price and representative/detail gallery drift", () => {
  const argumentsValue = baseRecoveryArguments();
  const binding = coupangExactQaRecoveryBinding(argumentsValue, "listing.update");
  assert.ok(binding);
  const priceDrift = exactRemoteProduct();
  (priceDrift.items[0] as Record<string, unknown>).salePrice = 5_010;
  assert.throws(
    () => assertCoupangExactQaUpdateReadback(priceDrift, binding),
    /COUPANG_EXACT_QA_UPDATE_READBACK_MISMATCH/,
  );
  const galleryDrift = exactRemoteProduct();
  (galleryDrift.items[0].images as Array<Record<string, unknown>>)[8].vendorPath =
    "https://cdn.example.com/tampered-detail.jpg";
  assert.throws(
    () => assertCoupangExactQaUpdateReadback(galleryDrift, binding),
    /COUPANG_EXACT_QA_UPDATE_READBACK_MISMATCH/,
  );
});

test("exact readback accepts Coupang CDN paths without treating sellerItemId as vendorItemId", () => {
  const argumentsValue = baseRecoveryArguments();
  const binding = coupangExactQaRecoveryBinding(argumentsValue, "listing.update");
  assert.ok(binding);
  const providerProduct = exactRemoteProduct();
  providerProduct.items[0].images = providerReadbackGalleryImages(argumentsValue);
  assert.doesNotThrow(() => assertCoupangExactQaUpdateReadback(
    providerProduct,
    binding,
    { providerReadback: true },
  ));
  assert.doesNotThrow(() => assertCoupangExactQaInventoryReadback({
    sellerItemId: 123456789,
    amountInStock: coupangExactQaRecoveryIdentity.stock,
    salePrice: coupangExactQaRecoveryIdentity.priceKrw,
    onSale: true,
  }, binding, {
    requestedVendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
    authoritativeVendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
  }));
  assert.throws(() => assertCoupangExactQaInventoryReadback({
    sellerItemId: 123456789,
    amountInStock: coupangExactQaRecoveryIdentity.stock,
    salePrice: coupangExactQaRecoveryIdentity.priceKrw,
    onSale: true,
  }, binding, {
    requestedVendorItemId: "95962393878",
    authoritativeVendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
  }), /COUPANG_EXACT_QA_COMMERCE_READBACK_MISMATCH/);
});

test("exact representative provider identity fails closed on every ambiguous gallery shape", () => {
  const argumentsValue = baseRecoveryArguments();
  const prewriteImages = providerReadbackGalleryImages(argumentsValue, "old");
  const productWithImages = (images: CoupangProviderImageIdentity[]) => {
    const product = exactRemoteProduct();
    product.items[0].images = images;
    return product;
  };
  const alreadyExpectedImages = providerReadbackGalleryImages(argumentsValue);
  const alreadyExpected = verifyCoupangExactRepresentativeReadback({
    currentValue: productWithImages(alreadyExpectedImages),
    prewriteImages: alreadyExpectedImages,
    argumentsValue,
  });
  assert.equal(alreadyExpected.providerRepresentativeAlreadyExpected, true);
  assert.equal(alreadyExpected.providerRepresentativeChanged, false);
  assert.doesNotThrow(() => verifyCoupangExactRepresentativeReadback({
    currentValue: productWithImages(providerReadbackGalleryImages(argumentsValue)),
    prewriteImages,
    argumentsValue,
  }));

  const wrongRepresentative = providerReadbackGalleryImages(argumentsValue);
  wrongRepresentative[0].vendorPath = "wrong-representative.jpg";
  assert.throws(
    () => verifyCoupangExactRepresentativeReadback({
      currentValue: productWithImages(wrongRepresentative),
      prewriteImages,
      argumentsValue,
    }),
    /COUPANG_EXACT_QA_REPRESENTATIVE_PROVIDER_IDENTITY_UNRESOLVED/,
  );

  const unchangedRepresentative = providerReadbackGalleryImages(argumentsValue, "old");
  assert.throws(
    () => verifyCoupangExactRepresentativeReadback({
      currentValue: productWithImages(unchangedRepresentative),
      prewriteImages,
      argumentsValue,
    }),
    /COUPANG_EXACT_QA_REPRESENTATIVE_PROVIDER_IDENTITY_UNRESOLVED/,
  );

  const vendorPathOnlyTransition = providerReadbackGalleryImages(argumentsValue);
  vendorPathOnlyTransition[0].cdnPath = prewriteImages[0].cdnPath;
  assert.throws(
    () => verifyCoupangExactRepresentativeReadback({
      currentValue: productWithImages(vendorPathOnlyTransition),
      prewriteImages,
      argumentsValue,
    }),
    /COUPANG_EXACT_QA_REPRESENTATIVE_NOT_CHANGED/,
  );

  const missingVendorIdentity = providerReadbackGalleryImages(argumentsValue);
  missingVendorIdentity[0].vendorPath = "";
  assert.throws(
    () => verifyCoupangExactRepresentativeReadback({
      currentValue: productWithImages(missingVendorIdentity),
      prewriteImages,
      argumentsValue,
    }),
    /COUPANG_EXACT_QA_REPRESENTATIVE_PROVIDER_IDENTITY_UNRESOLVED/,
  );

  const detailDrift = providerReadbackGalleryImages(argumentsValue);
  detailDrift[4].cdnPath = `vendor_inventory/images/drift/${detailDrift[4].vendorPath}`;
  assert.throws(
    () => verifyCoupangExactRepresentativeReadback({
      currentValue: productWithImages(detailDrift),
      prewriteImages,
      argumentsValue,
    }),
    /COUPANG_EXACT_QA_DETAIL_IDENTITY_DRIFT/,
  );
});

test("exact current-product preflight rejects status names that merely contain APPROVED", () => {
  const argumentsValue = baseRecoveryArguments();
  const binding = coupangExactQaRecoveryBinding(argumentsValue, "listing.update");
  assert.ok(binding);
  assert.throws(
    () => assertCoupangExactQaCurrentProduct(
      exactRemoteProduct({ statusName: "NOT_APPROVED" }),
      binding,
    ),
    /COUPANG_EXACT_QA_REMOTE_PUBLICATION_STATE_MISMATCH/,
  );
});

test("exact stop binds one vendor item and completes only after onSale false readback", async () => {
  const argumentsValue = baseStopRecoveryArguments();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    calls.push(`${init?.method ?? "GET"} ${pathname}`);
    if (init?.method === "PUT") return Response.json({ code: "SUCCESS" });
    if (pathname.includes("/seller-products/")) {
      return Response.json({ code: "SUCCESS", data: exactRemoteProduct() });
    }
    return Response.json({
      code: "SUCCESS",
      data: { vendorItemId: Number(coupangExactQaRecoveryIdentity.vendorItemId), onSale: false },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.stop",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: argumentsValue,
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "withdrawn");
    assert.equal(calls.filter((call) => call.startsWith("PUT ")).length, 1);
    assert.ok(calls.some((call) => call.includes(`/vendor-items/${coupangExactQaRecoveryIdentity.vendorItemId}/sales/stop`)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unbound or duplicate buyer content fails before any recovery provider mutation", () => {
  const unbound = baseRecoveryArguments();
  delete unbound.sellerpilotCoupangExactQaRecovery;
  assert.throws(
    () => prepareCoupangExactQaRecoveryArguments(unbound),
    /COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED/,
  );
  const duplicate = baseRecoveryArguments();
  const item = (duplicate.body as { items: Array<{ contents: unknown[] }> }).items[0];
  item.contents[7] = item.contents[0];
  assert.throws(
    () => prepareCoupangExactQaRecoveryArguments(duplicate),
    /COUPANG_EXACT_QA_BUYER_CONTENT_IMAGES_REQUIRED/,
  );
});
