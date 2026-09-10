import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  assertSmartstoreCreateBodyReady,
  assertSmartstoreCreateDraftReady,
  smartstoreCreateIdentity,
  smartstoreListingCreateContract,
  smartstoreStrictCreateRequested,
} from "../lib/channels/smartstore-listing-create-contract";
import {
  smartstoreCategoryAttributeMappingContract,
  smartstoreProductAttributesDigest,
} from "../lib/channels/smartstore-category-attribute-mapping";
import {
  buildSmartstoreCreateTransport,
  smartstoreCreateBodyBindingSha256,
  smartstoreCreateTransportArgument,
  smartstoreCreateTransportStageArgument,
  smartstoreCreateTransportStageContract,
} from "../lib/channels/smartstore-create-transport";
import { assertSmartstoreCreateSourceMatchesBody } from "../lib/server-smartstore-listing-create-binding";

const originProductNo = "10000001";
const channelProductNo = "20000001";
const sellerSku = "SELLERPILOT-SMARTSTORE-CREATE-V1";
const fingerprint = "a".repeat(64);

function imageUrl(index: number) {
  return `https://shop-phinf.pstatic.net/20260909_sellerpilot/create-${index}.jpg`;
}

function preparedBody() {
  const optionalImages = Array.from({ length: 8 }, (_, index) => ({
    url: imageUrl(index + 1),
  }));
  return {
    originProduct: {
      statusType: "SALE",
      saleType: "NEW",
      leafCategoryId: "50022679",
      name: "SellerPilot 스마트스토어 신규 등록 계약 검사 상품",
      detailContent: optionalImages
        .map(({ url }, index) => `<img src="${url}" alt="상세 ${index + 1}" />`)
        .join(""),
      images: {
        representativeImage: { url: imageUrl(0) },
        optionalImages,
      },
      salePrice: 10_000,
      stockQuantity: 1,
      deliveryInfo: {
        deliveryType: "DELIVERY",
        deliveryAttributeType: "NORMAL",
        deliveryCompany: "HANJIN",
        deliveryFee: {
          deliveryFeeType: "PAID",
          baseFee: 3_000,
          deliveryFeePayType: "PREPAID",
        },
        claimDeliveryInfo: {
          returnDeliveryCompanyPriorityType: "PRIMARY",
          returnDeliveryFee: 3_000,
          exchangeDeliveryFee: 6_000,
          shippingAddressId: 12345678,
          returnAddressId: 87654321,
        },
      },
      detailAttribute: {
        naverShoppingSearchInfo: { brandName: "SellerPilot Test" },
        afterServiceInfo: {
          afterServiceTelephoneNumber: "02-1234-5678",
          afterServiceGuideContent: "판매자 안내에 따라 접수합니다.",
        },
        originAreaInfo: { originAreaCode: "04", content: "대한민국" },
        sellerCodeInfo: { sellerManagementCode: sellerSku },
        certificationTargetExcludeContent: {
          childCertifiedProductExclusionYn: true,
          kcCertifiedProductExclusionYn: "TRUE",
          greenCertifiedProductExclusionYn: true,
          chemicalCertifiedProductExclusionYn: true,
        },
        productInfoProvidedNotice: {
          productInfoProvidedNoticeType: "ETC",
          etc: {
            returnCostReason: "상품상세 참조",
            noRefundReason: "상품상세 참조",
            qualityAssuranceStandard: "상품상세 참조",
            compensationProcedure: "상품상세 참조",
            troubleShootingContents: "상품상세 참조",
            itemName: "검사 상품",
            modelName: "SP-TEST-001",
            certificateDetails: "해당사항 없음",
            manufacturer: "SellerPilot Test",
            customerServicePhoneNumber: "02-1234-5678",
          },
        },
        productAttributes: [
          { attributeSeq: 10020580, attributeValueSeq: 10832333 },
          { attributeSeq: 10014442, attributeValueSeq: 10972472 },
        ],
        optionInfo: {},
        unitCapacity: { unitPriceYn: false },
      },
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductName: "SellerPilot 스마트스토어 신규 등록 계약 검사 상품",
      channelProductDisplayStatusType: "ON",
    },
  };
}

function sourceBinding(body: ReturnType<typeof preparedBody>) {
  return {
    contract: "smartstore_listing_create_source_v1" as const,
    productId: "11111111-1111-4111-8111-111111111111",
    ownerId: "22222222-2222-4222-8222-222222222222",
    productUpdatedAt: "2026-09-10T00:00:00.000Z",
    detailPageVersion: 1,
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "d".repeat(64),
    sellerManagementCode: sellerSku,
    credentialId: "33333333-3333-4333-8333-333333333333",
    credentialVersion: 1,
    credentialFingerprint: "ABCDEF123456",
    credentialVaultSecretId: "44444444-4444-4444-8444-444444444444",
    credentialLastRotatedAt: "2026-09-10T00:00:00.000Z",
    productName: body.originProduct.name,
    salePrice: body.originProduct.salePrice,
    stockQuantity: body.originProduct.stockQuantity,
    manualFieldsSha256: "e".repeat(64),
    bodyBindingSha256: smartstoreCreateBodyBindingSha256(body),
  };
}

function strictArguments(body = preparedBody()) {
  const productAttributes = structuredClone(
    body.originProduct.detailAttribute.productAttributes,
  );
  const transport = buildSmartstoreCreateTransport(body);
  return {
    sellerpilotSmartstoreCreateContract: smartstoreListingCreateContract,
    sellerpilotSmartstoreCreateSource: sourceBinding(body),
    sellerpilotSmartstoreCategoryAttributeMapping: {
      ok: true,
      contract: smartstoreCategoryAttributeMappingContract,
      categoryId: body.originProduct.leafCategoryId,
      assignmentRevision: 7,
      assignmentDigest: "b".repeat(64),
      officialReadbackDigest: "c".repeat(64),
      productAttributes,
      productAttributesSha256: smartstoreProductAttributesDigest(productAttributes),
    },
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    body,
    [smartstoreCreateTransportArgument]: transport,
    [smartstoreCreateTransportStageArgument]: {
      contract: smartstoreCreateTransportStageContract,
      jobId: "11111111-1111-4111-8111-111111111111",
      bodySha256: transport.bodySha256,
      bodyByteLength: transport.bodyByteLength,
      staged: true,
    },
  };
}

function payload() {
  return {
    access_token: "test-only-smartstore-token",
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
  };
}

function providerOrigin(body = preparedBody()) {
  return {
    originProductNo,
    smartstoreChannelProductNo: channelProductNo,
    originProduct: structuredClone(body.originProduct),
    smartstoreChannelProduct: {
      ...structuredClone(body.smartstoreChannelProduct),
      channelProductNo,
      originProductNo,
      sellerManagementCode: sellerSku,
    },
  };
}

function providerChannel(
  body = preparedBody(),
  resolvedChannelProductNo = channelProductNo,
) {
  return {
    originProductNo,
    smartstoreChannelProductNo: resolvedChannelProductNo,
    originProduct: structuredClone(body.originProduct),
    smartstoreChannelProduct: {
      ...structuredClone(body.smartstoreChannelProduct),
      channelProductNo: resolvedChannelProductNo,
      originProductNo,
      sellerManagementCode: sellerSku,
    },
  };
}

function emptySearch() {
  return {
    page: 1,
    size: 50,
    totalElements: 0,
    totalPages: 0,
    first: true,
    last: true,
    contents: [],
  };
}

function exactSearch(resolvedChannelProductNo = channelProductNo) {
  return {
    page: 1,
    size: 50,
    totalElements: 1,
    totalPages: 1,
    first: true,
    last: true,
    contents: [{
      originProductNo,
      channelProducts: [{
        channelProductNo: resolvedChannelProductNo,
        sellerManagementCode: sellerSku,
      }],
    }],
  };
}

test("prepared SmartStore create contract accepts only resolved channel-required values", () => {
  assert.doesNotThrow(() => assertSmartstoreCreateBodyReady(preparedBody()));

  const cases: Array<[string, (body: ReturnType<typeof preparedBody>) => void]> = [
    ["NAVER_CREATE_IMAGES_REQUIRED", (body) => {
      body.originProduct.images.optionalImages.pop();
    }],
    ["NAVER_CREATE_SHIPPING_REQUIRED", (body) => {
      body.originProduct.deliveryInfo.claimDeliveryInfo.returnAddressId = 0;
    }],
    ["NAVER_CREATE_AFTER_SERVICE_REQUIRED", (body) => {
      body.originProduct.detailAttribute.afterServiceInfo.afterServiceTelephoneNumber = "SERVER_MANAGED";
    }],
    ["NAVER_CREATE_PRODUCT_NOTICE_REQUIRED", (body) => {
      body.originProduct.detailAttribute.productInfoProvidedNotice.etc.manufacturer = "";
    }],
    ["NAVER_CREATE_CERTIFICATION_DECISION_REQUIRED", (body) => {
      delete body.originProduct.detailAttribute
        .certificationTargetExcludeContent.chemicalCertifiedProductExclusionYn;
    }],
    ["NAVER_CREATE_BRAND_REQUIRED", (body) => {
      body.originProduct.detailAttribute.naverShoppingSearchInfo = {};
    }],
    ["NAVER_CREATE_ORIGIN_AREA_REQUIRED", (body) => {
      body.originProduct.detailAttribute.originAreaInfo.content = "";
    }],
    ["NAVER_CREATE_UNIT_CAPACITY_INVALID", (body) => {
      body.originProduct.detailAttribute.unitCapacity = {
        unitPriceYn: false,
        totalCapacityValue: 1,
      } as never;
    }],
    ["NAVER_CREATE_OPTIONS_INVALID", (body) => {
      body.originProduct.detailAttribute.optionInfo = {
        optionSimple: [{ groupName: "색상", name: "검정" }],
        optionCombinations: [{
          optionName1: "검정",
          stockQuantity: 1,
          price: 0,
        }],
      } as never;
    }],
    ["NAVER_CREATE_PRODUCT_ATTRIBUTES_INVALID", (body) => {
      body.originProduct.detailAttribute.productAttributes[1]
        .attributeValueSeq = 0;
    }],
    ["NAVER_CREATE_CHANNEL_PRODUCT_REQUIRED", (body) => {
      body.smartstoreChannelProduct.naverShoppingRegistration = "true" as never;
    }],
  ];
  for (const [code, mutate] of cases) {
    const body = preparedBody();
    mutate(body);
    assert.throws(() => assertSmartstoreCreateBodyReady(body), new RegExp(code));
  }
});

test("draft contract permits only explicit server placeholders before image upload", () => {
  const body = preparedBody();
  body.originProduct.images = {
    representativeImage: { url: "PROGRAM_UPLOAD_PENDING" },
    optionalImages: [],
  };
  body.originProduct.detailAttribute.afterServiceInfo = {
    afterServiceTelephoneNumber: "SERVER_MANAGED",
    afterServiceGuideContent: "SERVER_MANAGED",
  };
  body.originProduct.detailAttribute.productInfoProvidedNotice
    .etc.customerServicePhoneNumber = "SERVER_MANAGED";
  assert.doesNotThrow(() => assertSmartstoreCreateDraftReady(body));
  assert.throws(
    () => assertSmartstoreCreateBodyReady(body),
    /NAVER_CREATE_PRODUCT_NOTICE_REQUIRED/,
  );
  body.originProduct.detailAttribute.productInfoProvidedNotice
    .etc.customerServicePhoneNumber = "02-1234-5678";
  assert.throws(
    () => assertSmartstoreCreateBodyReady(body),
    /NAVER_CREATE_IMAGES_REQUIRED/,
  );

  body.originProduct.detailAttribute.naverShoppingSearchInfo = {};
  assert.throws(
    () => assertSmartstoreCreateDraftReady(body),
    /NAVER_CREATE_BRAND_REQUIRED/,
  );
});

test("create response identity requires distinct official origin and channel IDs", () => {
  assert.deepEqual(smartstoreCreateIdentity({
    originProductNo: Number(originProductNo),
    smartstoreChannelProductNo: Number(channelProductNo),
  }), { originProductNo, channelProductNo });
  assert.equal(smartstoreCreateIdentity({ originProductNo }), null);
  assert.equal(smartstoreCreateIdentity({
    originProductNo,
    smartstoreChannelProductNo: originProductNo,
  }), null);
});

test("every create requires the exact strict marker and publication contract", () => {
  assert.throws(
    () => smartstoreStrictCreateRequested({}),
    /NAVER_CREATE_CONTRACT_REQUIRED/,
  );
  assert.equal(smartstoreStrictCreateRequested({
    sellerpilotSmartstoreCreateContract: smartstoreListingCreateContract,
    publicationStateContract: "verified_remote_state_v1",
  }), true);
  assert.throws(() => smartstoreStrictCreateRequested({
    publicationStateContract: "verified_remote_state_v1",
  }), /NAVER_CREATE_CONTRACT_REQUIRED/);
  assert.throws(() => smartstoreStrictCreateRequested({
    sellerpilotSmartstoreCreateContract: "smartstore_listing_create_v0",
    publicationStateContract: "verified_remote_state_v1",
  }), /NAVER_CREATE_CONTRACT_INVALID/);
  assert.throws(() => smartstoreStrictCreateRequested({
    sellerpilotSmartstoreCreateContract: smartstoreListingCreateContract,
  }), /NAVER_CREATE_PUBLICATION_CONTRACT_REQUIRED/);
});

test("missing or altered create contracts stop before token, media, or provider transport", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  const credentials = {
    client_id: "test-only-client",
    client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
    token_type: "SELLER",
    account_id: "test-only-account",
  };
  try {
    for (const [variant, expected] of [
      ["missing-marker", /NAVER_CREATE_CONTRACT_REQUIRED/],
      ["altered-marker", /NAVER_CREATE_CONTRACT_INVALID/],
      ["missing-publication", /NAVER_CREATE_PUBLICATION_CONTRACT_REQUIRED/],
      ["altered-publication", /NAVER_CREATE_PUBLICATION_CONTRACT_REQUIRED/],
      ["missing-both", /NAVER_CREATE_CONTRACT_REQUIRED/],
    ] as const) {
      const argumentsValue = strictArguments();
      if (variant === "missing-marker" || variant === "missing-both") {
        delete argumentsValue.sellerpilotSmartstoreCreateContract;
      } else if (variant === "altered-marker") {
        argumentsValue.sellerpilotSmartstoreCreateContract =
          "smartstore_listing_create_v0" as never;
      }
      if (variant === "missing-publication" || variant === "missing-both") {
        delete argumentsValue.publicationStateContract;
      } else if (variant === "altered-publication") {
        argumentsValue.publicationStateContract =
          "verified_remote_state_v0" as never;
      }
      await assert.rejects(executeChannelOperation({
        channel: "smartstore",
        operation: "listing.create",
        payload: credentials,
        arguments: argumentsValue,
        environment: "production",
      }), expected);
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing, altered, or body-divergent category mapping stops before token or provider transport", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  const credentials = {
    client_id: "test-only-client",
    client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
    token_type: "SELLER",
    account_id: "test-only-account",
  };
  try {
    for (const variant of ["missing", "tampered-digest", "category", "body"] as const) {
      const argumentsValue = strictArguments();
      const mapping = argumentsValue.sellerpilotSmartstoreCategoryAttributeMapping;
      if (variant === "missing") {
        delete argumentsValue.sellerpilotSmartstoreCategoryAttributeMapping;
      } else if (variant === "tampered-digest") {
        mapping.productAttributesSha256 = "d".repeat(64);
      } else if (variant === "category") {
        mapping.categoryId = "50000000";
      } else {
        argumentsValue.body.originProduct.detailAttribute.productAttributes[0]
          .attributeValueSeq += 1;
      }
      const operation = await executeChannelOperation({
        channel: "smartstore",
        operation: "listing.create",
        payload: credentials,
        arguments: argumentsValue,
        environment: "production",
      });
      assert.equal(operation.ok, false, variant);
      const preflight = operation.steps.find(
        ({ name }) => name === "category-attribute-mapping-preflight",
      );
      assert.equal(preflight?.ok, false, variant);
      assert.equal(
        preflight?.data.sellerpilotVerification,
        "SMARTSTORE_CATEGORY_ATTRIBUTE_MAPPING_BLOCKED",
        variant,
      );
      assert.equal(preflight?.data.providerMutationAllowed, false, variant);
      assert.deepEqual(
        preflight?.data.providerMutationCounts,
        { create: 0, put: 0 },
        variant,
      );
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("strict contract rejects unresolved inputs before token, duplicate search, or create", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  const body = preparedBody();
  body.originProduct.detailAttribute.naverShoppingSearchInfo = {};
  try {
    await assert.rejects(executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: {
        client_id: "test-only-client",
        client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
        token_type: "SELLER",
        account_id: "test-only-account",
      },
      arguments: strictArguments(body),
      environment: "production",
    }), /NAVER_CREATE_BRAND_REQUIRED/);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepted create without both IDs stops without retry, readback, or PUT", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/v1/products/search")) return Response.json(emptySearch());
    if (url.endsWith("/v2/products") && method === "POST") {
      return Response.json({ originProductNo: Number(originProductNo) });
    }
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: payload(),
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.remoteId, originProductNo);
    assert.deepEqual(operation.steps.map((item) => item.name), [
      "product-create",
      "product-create-get-recovery-search",
      "product-create-identity",
    ]);
    assert.equal(
      operation.steps[2]?.data.sellerpilotVerification,
      "SMARTSTORE_CREATE_IDENTITIES_MISSING",
    );
    assert.equal(calls.filter(({ url }) => url.endsWith("/v2/products")).length, 1);
    assert.equal(calls.filter(({ url }) => url.endsWith("/v1/products/search")).length, 2);
    assert.equal(calls.some(({ method }) => method === "PUT"), false);
    assert.equal(calls.some(({ method }) => method === "GET"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function strictCreateWithOfficialReadback(input: {
  responseChannelProductNo: string;
  readbackChannelProductNo: string;
  mutateReadbackBody?: (body: ReturnType<typeof preparedBody>) => void;
}) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let created = false;
  const readbackBody = preparedBody();
  input.mutateReadbackBody?.(readbackBody);
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/v1/products/search") && !created) {
      return Response.json(emptySearch());
    }
    if (url.endsWith("/v2/products") && method === "POST") {
      created = true;
      return Response.json({
        originProductNo: Number(originProductNo),
        smartstoreChannelProductNo: Number(input.responseChannelProductNo),
      });
    }
    if (url.endsWith("/v1/products/search")) {
      return Response.json(exactSearch(input.readbackChannelProductNo));
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`)) {
      return Response.json(providerOrigin(readbackBody));
    }
    if (url.endsWith(
      `/v2/products/channel-products/${input.readbackChannelProductNo}`,
    )) {
      return Response.json(providerChannel(
        readbackBody,
        input.readbackChannelProductNo,
      ));
    }
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: payload(),
      arguments: strictArguments(),
      environment: "production",
    });
    return { operation, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("one strict create binds both response IDs to exact official GET readback", async () => {
  const { operation, calls } = await strictCreateWithOfficialReadback({
    responseChannelProductNo: channelProductNo,
    readbackChannelProductNo: channelProductNo,
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.publicationFulfilled, true);
  assert.equal(operation.remoteId, originProductNo);
  assert.deepEqual(operation.remoteState?.resources, {
    originProductNo,
    smartstoreChannelProductNo: channelProductNo,
  });
  assert.equal(
    operation.steps.find(({ name }) => name === "product-create-identity-readback")
      ?.data.sellerpilotVerification,
    "SMARTSTORE_CREATE_IDENTITIES_VERIFIED",
  );
  const exactReceipt = operation.steps.find(
    ({ name }) => name === "product-create-contract-readback",
  );
  const mapping = strictArguments().sellerpilotSmartstoreCategoryAttributeMapping;
  assert.deepEqual(exactReceipt?.data.sellerpilotCategoryAttributeMapping, {
    contract: smartstoreCategoryAttributeMappingContract,
    categoryId: mapping.categoryId,
    assignmentRevision: mapping.assignmentRevision,
    assignmentDigest: mapping.assignmentDigest,
    officialReadbackDigest: mapping.officialReadbackDigest,
    productAttributesSha256: mapping.productAttributesSha256,
  });
  assert.equal(calls.filter(({ url }) => url.endsWith("/v2/products")).length, 1);
  assert.equal(
    calls.filter(({ url, method }) => method === "GET"
      && url.endsWith(`/v2/products/origin-products/${originProductNo}`)).length,
    3,
  );
  assert.equal(
    calls.some(({ url, method }) => method === "GET"
      && url.endsWith(`/v2/products/channel-products/${channelProductNo}`)),
    true,
  );
  assert.equal(calls.some(({ method }) => method === "PUT"), false);
});

test("official channel ID mismatch refuses completion without a second create or PUT", async () => {
  const { operation, calls } = await strictCreateWithOfficialReadback({
    responseChannelProductNo: "20000002",
    readbackChannelProductNo: channelProductNo,
  });
  assert.equal(operation.ok, false);
  assert.equal(operation.remoteState, undefined);
  assert.equal(operation.publicationFulfilled, undefined);
  const identity = operation.steps.find(
    ({ name }) => name === "product-create-identity-readback",
  );
  assert.equal(identity?.ok, false);
  assert.equal(
    identity?.data.sellerpilotVerification,
    "SMARTSTORE_CREATE_IDENTITIES_MISMATCH",
  );
  assert.equal(identity?.data.expectedChannelProductNo, "20000002");
  assert.equal(identity?.data.officialChannelProductNo, channelProductNo);
  assert.equal(calls.filter(({ url }) => url.endsWith("/v2/products")).length, 1);
  assert.equal(calls.some(({ method }) => method === "PUT"), false);
});

test("exact official GET must preserve every SmartStore create contract group", async () => {
  const cases: Array<[
    string,
    (body: ReturnType<typeof preparedBody>) => void,
  ]> = [
    ["productInput", (body) => {
      body.originProduct.salePrice += 10;
    }],
    ["categoryAndAttributes", (body) => {
      body.originProduct.detailAttribute.productAttributes[0]
        .attributeValueSeq += 1;
    }],
    ["brandAndNotice", (body) => {
      body.originProduct.detailAttribute.productInfoProvidedNotice
        .etc.manufacturer = "다른 제조사";
    }],
    ["shippingAndReturns", (body) => {
      body.originProduct.deliveryInfo.claimDeliveryInfo.returnDeliveryFee += 10;
    }],
    ["approvedImagesAndDetail", (body) => {
      body.originProduct.detailContent += "<p>공급자에서 변경됨</p>";
    }],
    ["channelProduct", (body) => {
      body.smartstoreChannelProduct.naverShoppingRegistration = false;
    }],
  ];
  for (const [mismatchGroup, mutateReadbackBody] of cases) {
    const { operation, calls } = await strictCreateWithOfficialReadback({
      responseChannelProductNo: channelProductNo,
      readbackChannelProductNo: channelProductNo,
      mutateReadbackBody,
    });
    const receipt = operation.steps.find(
      ({ name }) => name === "product-create-contract-readback",
    );
    assert.equal(operation.ok, false, mismatchGroup);
    assert.equal(operation.remoteState, undefined, mismatchGroup);
    assert.equal(
      receipt?.data.sellerpilotVerification,
      "SMARTSTORE_CREATE_EXACT_READBACK_MISMATCH",
      mismatchGroup,
    );
    assert.deepEqual(receipt?.data.mismatchGroups, [mismatchGroup]);
    assert.match(String(receipt?.data.expectedProjectionSha256), /^[a-f0-9]{64}$/u);
    assert.match(String(receipt?.data.officialProjectionSha256), /^[a-f0-9]{64}$/u);
    assert.equal(calls.filter(({ url }) => url.endsWith("/v2/products")).length, 1);
    assert.equal(calls.some(({ method }) => method === "PUT"), false);
  }
});

test("one unchanged source snapshot cannot authorize two title/price/stock bodies", async () => {
  const first = preparedBody();
  const second = preparedBody();
  second.originProduct.name = "다른 제목";
  second.originProduct.salePrice = 990_000;
  second.originProduct.stockQuantity = 99;
  second.smartstoreChannelProduct.channelProductName = "다른 제목";
  const firstSource = sourceBinding(first);
  assert.doesNotThrow(() => assertSmartstoreCreateSourceMatchesBody({
    source: firstSource,
    body: first,
  }));
  assert.throws(() => assertSmartstoreCreateSourceMatchesBody({
    source: firstSource,
    body: second,
  }), /SMARTSTORE_CREATE_COMMERCIAL_SOURCE_MISMATCH/u);
  assert.notEqual(
    smartstoreCreateBodyBindingSha256(first),
    smartstoreCreateBodyBindingSha256(second),
  );

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  try {
    const argumentsValue = strictArguments(second);
    argumentsValue.sellerpilotSmartstoreCreateSource = firstSource;
    await assert.rejects(executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: payload(),
      arguments: argumentsValue,
      environment: "production",
    }), /SMARTSTORE_CREATE_COMMERCIAL_SOURCE_MISMATCH/u);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET-only response-loss recovery accepts the staged body and never POSTs again", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let created = false;
  const body = preparedBody();
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/v1/products/search") && !created) {
      return Response.json(emptySearch());
    }
    if (url.endsWith("/v2/products") && method === "POST") {
      created = true;
      return Response.json({ originProductNo: Number(originProductNo) });
    }
    if (url.endsWith("/v1/products/search")) {
      return Response.json(exactSearch());
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`)) {
      return Response.json(providerOrigin(body));
    }
    if (url.endsWith(`/v2/products/channel-products/${channelProductNo}`)) {
      return Response.json(providerChannel(body));
    }
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: payload(),
      arguments: strictArguments(body),
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.remoteId, originProductNo);
    assert.equal(
      operation.steps.find(({ name }) => name === "product-create-get-recovery")
        ?.data.sellerpilotVerification,
      "SMARTSTORE_CREATE_GET_RECOVERY_VERIFIED",
    );
    assert.equal(calls.filter(({ url }) => url.endsWith("/v2/products")).length, 1);
    assert.equal(calls.some(({ method }) => method === "PUT"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET-only recovery refuses a different title/price/stock body without a second CREATE", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let created = false;
  const official = preparedBody();
  official.originProduct.name = "다른 제목";
  official.originProduct.salePrice = 990_000;
  official.originProduct.stockQuantity = 99;
  official.smartstoreChannelProduct.channelProductName = "다른 제목";
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/v1/products/search") && !created) {
      return Response.json(emptySearch());
    }
    if (url.endsWith("/v2/products") && method === "POST") {
      created = true;
      return Response.json({ originProductNo: Number(originProductNo) });
    }
    if (url.endsWith("/v1/products/search")) {
      return Response.json(exactSearch());
    }
    if (url.endsWith(`/v2/products/origin-products/${originProductNo}`)) {
      return Response.json(providerOrigin(official));
    }
    if (url.endsWith(`/v2/products/channel-products/${channelProductNo}`)) {
      return Response.json(providerChannel(official));
    }
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: payload(),
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.equal(
      operation.steps.find(({ name }) => name === "product-create-get-recovery")
        ?.data.sellerpilotVerification,
      "SMARTSTORE_CREATE_GET_RECOVERY_MISMATCH",
    );
    assert.equal(calls.filter(({ url }) => url.endsWith("/v2/products")).length, 1);
    assert.equal(calls.some(({ method }) => method === "PUT"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
