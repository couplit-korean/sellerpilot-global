import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoupangCreateRevisionCandidate,
  resolveCoupangCreateCompleteness,
  type CoupangCreateCompletenessInput,
} from "../lib/product-registration/coupang/create-completeness";
import { bindCoupangCreateSourceRevision } from
  "../lib/product-registration/coupang/create-source-revision";
import { buildCoupangCreateOfficialReadEvidence } from
  "../lib/product-registration/coupang/create-official-read-evidence";

const productId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000001";
const manifestDigest = "f".repeat(64);
const imageHashes = "12345678".split("").map((character) => character.repeat(64));

function completeInput(): CoupangCreateCompletenessInput {
  const shippingRule = "판매자 확인 주문 기준 2영업일 출고";
  return {
    source: {
      publicationIntent: "safe_test",
      sellerpilotCoupangBaseSku: "NEW-SKU",
      facts: {
        coupangOptionRows: [{
          skuSuffix: "RED",
          itemName: "신규 상품 빨강",
          modelNo: "MODEL-RED",
          emptyBarcodeReason: "바코드가 없는 상품",
          salePrice: 12_900,
          stock: 9,
          unitCount: 1,
          purchaseOptions: [{ name: "색상", value: "빨강" }],
        }],
      },
      sellerpilotAssets: {
        shipping: {
          shippingFeeKrw: 3_000,
          shippingRule,
          coupangLeadTimeConfirmation: {
            source: "coupang-wing",
            shippingRule,
            outboundShippingTimeDay: 2,
            orderDateAndCalendarConfirmed: true,
            approvedPromiseMatched: true,
            sameDayShipping: false,
          },
        },
        approvedDetailPageVersion: 3,
        detailImageManifestDigest: manifestDigest,
        approvedDetailImagePaths: Array.from({ length: 8 }, (_, index) => `approved/${index}.png`),
        approvedDetailImageSha256s: imageHashes,
        detailImageRoles: Array.from({ length: 8 }, (_, index) => `section-${index}`),
        detailImageUrls: Array.from({ length: 8 }, (_, index) =>
          `https://signed.example/${index}?token=one`),
      },
    },
    body: {
      displayCategoryCode: 59631,
      sellerProductName: "신규 상품",
      displayProductName: "신규 상품",
      brand: "테스트",
      outboundShippingPlaceCode: 12345,
      returnCenterCode: "RETURN-1",
      deliveryCompanyCode: "HANJIN",
      deliveryChargeType: "NOT_FREE",
      deliveryCharge: 3_000,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: 0,
      returnCharge: 4_500,
      items: [{
        itemName: "신규 상품 빨강",
        externalVendorSku: "NEW-SKU-RED",
        salePrice: 12_900,
        originalPrice: 12_900,
        maximumBuyCount: 9,
        maximumBuyForPerson: 9,
        unitCount: 1,
        outboundShippingTimeDay: 2,
        barcode: "",
        emptyBarcode: true,
        emptyBarcodeReason: "바코드가 없는 상품",
        modelNo: "MODEL-RED",
        attributes: [{
          attributeTypeName: "색상",
          attributeValueName: "빨강",
          exposed: "EXPOSED",
        }],
        notices: [{
          noticeCategoryName: "기타 재화",
          noticeCategoryDetailName: "품명",
          content: "신규 상품",
        }],
        certifications: [],
        images: [{
          imageOrder: 0,
          imageType: "REPRESENTATION",
          vendorPath: "https://images.example/new-sku.jpg",
        }],
      }],
    },
    publishContext: {
      product: { id: productId, sku: "NEW-SKU", name: "신규 상품", onHand: 9, costKrw: 8_000 },
      manualFields: { productName: "신규 상품", sellerSku: "NEW-SKU" },
      assignments: [{ channel: "coupang", market: "KR", status: "confirmed", categoryId: "59631" }],
      detailPage: { version: 3, approvedVersion: 3, imageManifest: { digest: manifestDigest } },
    },
    categoryMetadataRead: {
      code: "SUCCESS",
      data: {
        attributes: [{ attributeTypeName: "색상", required: "MANDATORY", exposed: "EXPOSED" }],
        noticeCategories: [{
          noticeCategoryName: "기타 재화",
          noticeCategoryDetailNames: [{ noticeCategoryDetailName: "품명", required: "MANDATORY" }],
        }],
        certifications: [],
      },
    },
    categoryStatusRead: { code: "SUCCESS", data: true },
    outboundShippingPlacesRead: {
      code: "SUCCESS",
      data: { content: [{
        usable: true,
        outboundShippingPlaceCode: 12345,
        placeAddresses: [{ countryCode: "KR", addressType: "ROADNAME" }],
      }] },
    },
    returnCentersRead: {
      code: "SUCCESS",
      data: { content: [{
        usable: true,
        returnCenterCode: "RETURN-1",
        deliverCode: "HANJIN",
        returnFee02kg: 4_500,
        placeAddresses: [{ countryCode: "KR", addressType: "ROADNAME" }],
      }] },
    },
    credentialRevision: {
      credentialId,
      credentialVersion: 7,
      credentialFingerprint: "ABCDEF123456",
      environment: "production",
      expiresAt: "2099-01-01T00:00:00.000Z",
      sellerIdentityReady: true,
    },
    environment: "production",
    now: new Date("2026-09-10T00:00:00.000Z"),
  };
}

function mutableInput() {
  return structuredClone(completeInput()) as CoupangCreateCompletenessInput;
}

function byKey(input: CoupangCreateCompletenessInput, key: string) {
  return resolveCoupangCreateCompleteness(input).fields.find((candidate) => candidate.key === key)!;
}

test("complete fixture exposes the exact ordered two-pass DTO", () => {
  const result = resolveCoupangCreateCompleteness(completeInput());
  assert.deepEqual(result.fields.map((candidate) => candidate.key), [
    "create_lineage", "category", "title", "brand", "options", "external_vendor_sku", "price",
    "stock", "unit", "attributes", "notices", "certifications",
    "outbound_shipping_place", "return_center", "carrier", "fees",
    "representative_image", "approved_detail_images", "credential_revision",
  ]);
  assert.equal(result.contract, "sellerpilot_coupang_create_completeness_v1");
  assert.equal(result.canBindCreateSourceRevision, true);
  assert.deepEqual(result.counts, {
    resolved: 19, manual_required: 0, provider_read_required: 0, blocked: 0,
  });
  for (const candidate of result.fields) {
    assert.equal(candidate.status, "resolved", candidate.key);
    assert.ok(candidate.fieldPaths.length > 0, candidate.key);
    assert.ok(candidate.allowedSources.length > 0, candidate.key);
    assert.ok(candidate.selectedSource, candidate.key);
    assert.ok(candidate.message.length > 0, candidate.key);
  }
  assert.deepEqual(byKey(completeInput(), "category").fieldPaths, [
    "body.displayCategoryCode", "publishContext.assignments[channel=coupang].categoryId",
  ]);
  assert.ok(byKey(completeInput(), "fees").fieldPaths.includes(
    "source.sellerpilotAssets.shipping.coupangLeadTimeConfirmation"));

  const explicitSellerSku = mutableInput();
  (explicitSellerSku.publishContext as { product: { sku: string } }).product.sku = "CATALOG-SKU";
  assert.equal(byKey(explicitSellerSku, "external_vendor_sku").status, "resolved");

  const approvedLocalizedTitle = mutableInput();
  (approvedLocalizedTitle.publishContext as Record<string, unknown>).localizedListings = [{
    channel: "coupang", market: "KR", title: "승인된 쿠팡 상품명",
  }];
  const localizedBody = approvedLocalizedTitle.body as { sellerProductName: string; displayProductName: string };
  localizedBody.sellerProductName = "승인된 쿠팡 상품명";
  localizedBody.displayProductName = "승인된 쿠팡 상품명";
  assert.equal(byKey(approvedLocalizedTitle, "title").status, "resolved");

  const asciiNames = mutableInput();
  const asciiSource = asciiNames.source as {
    sellerpilotCoupangBaseSku: string;
    facts: { coupangOptionRows: Array<Record<string, unknown>> };
  };
  asciiSource.sellerpilotCoupangBaseSku = "BANANA";
  asciiSource.facts.coupangOptionRows[0].itemName = "Banana Red";
  const asciiContext = asciiNames.publishContext as {
    product: { name: string; sku: string };
    manualFields: { productName: string; sellerSku: string };
  };
  Object.assign(asciiContext.product, { name: "Banana", sku: "BANANA" });
  Object.assign(asciiContext.manualFields, { productName: "Banana", sellerSku: "BANANA" });
  const asciiBody = asciiNames.body as { sellerProductName: string; displayProductName: string; brand: string; items: Array<Record<string, unknown>> };
  Object.assign(asciiBody, { sellerProductName: "Banana", displayProductName: "Banana", brand: "NARS" });
  Object.assign(asciiBody.items[0], { itemName: "Banana Red", externalVendorSku: "BANANA-RED" });
  assert.equal(byKey(asciiNames, "title").status, "resolved");
  assert.equal(byKey(asciiNames, "brand").status, "resolved");
  assert.equal(byKey(asciiNames, "external_vendor_sku").status, "resolved");
});

test("seller-known omissions are manual_required and never receive invented values", () => {
  const cases: Array<[string, (input: CoupangCreateCompletenessInput) => void]> = [
    ["title", (input) => { (input.body as Record<string, unknown>).sellerProductName = ""; }],
    ["price", (input) => {
      ((input.source as { facts: { coupangOptionRows: unknown[] } }).facts.coupangOptionRows) = [];
      ((input.body as { items: Array<Record<string, unknown>> }).items[0]).salePrice = 0;
    }],
    ["stock", (input) => {
      ((input.source as { facts: { coupangOptionRows: unknown[] } }).facts.coupangOptionRows) = [];
      ((input.body as { items: Array<Record<string, unknown>> }).items[0]).maximumBuyCount = 0;
    }],
    ["unit", (input) => {
      ((input.source as { facts: { coupangOptionRows: unknown[] } }).facts.coupangOptionRows) = [];
      ((input.body as { items: Array<Record<string, unknown>> }).items[0]).unitCount = 0;
    }],
    ["attributes", (input) => { ((input.body as { items: Array<Record<string, unknown>> }).items[0]).attributes = []; }],
    ["notices", (input) => { ((input.body as { items: Array<Record<string, unknown>> }).items[0]).notices = []; }],
    ["fees", (input) => {
      delete (input.body as Record<string, unknown>).deliveryChargeType;
    }],
  ];
  for (const [key, mutate] of cases) {
    const input = mutableInput();
    mutate(input);
    const result = resolveCoupangCreateCompleteness(input);
    assert.equal(result.fields.find((candidate) => candidate.key === key)?.status,
      "manual_required", key);
    assert.equal(result.canBindCreateSourceRevision, false);
    assert.doesNotMatch(JSON.stringify(input), /상품상세 참조|미확인|CJGLS/u);
  }
});

test("official evidence not read is provider_read_required even when body has saved values", () => {
  const input = mutableInput();
  delete input.categoryMetadataRead;
  delete input.categoryStatusRead;
  delete input.outboundShippingPlacesRead;
  delete input.returnCentersRead;
  delete input.credentialRevision;
  const result = resolveCoupangCreateCompleteness(input);
  for (const key of ["category", "options", "attributes", "notices", "certifications",
    "outbound_shipping_place", "return_center", "carrier", "fees", "credential_revision"] as const) {
    assert.equal(result.fields.find((candidate) => candidate.key === key)?.status,
      "provider_read_required", key);
  }
  assert.equal(result.canBindCreateSourceRevision, false);
});

test("contradictory or stale evidence is blocked without a fallback placeholder", () => {
  const cases: Array<[string, (input: CoupangCreateCompletenessInput) => void]> = [
    ["create_lineage", (input) => { (input.source as Record<string, unknown>).resumeRemoteId = "123"; }],
    ["create_lineage", (input) => {
      (input.source as Record<string, unknown>).nested = { sellerpilotCoupangExactRecovery: true };
    }],
    ["create_lineage", (input) => {
      (input.body as Record<string, unknown>).nested = { sellerpilotCoupangPostPriceVerificationReceipt: true };
    }],
    ["category", (input) => { input.categoryStatusRead = { code: "SUCCESS", data: false }; }],
    ["notices", (input) => {
      ((input.body as { items: Array<{ notices: Array<Record<string, unknown>> }> }).items[0]
        .notices[0]).content = "상품상세 참조";
    }],
    ["outbound_shipping_place", (input) => {
      (input.body as Record<string, unknown>).outboundShippingPlaceCode = 99999;
    }],
    ["carrier", (input) => { (input.body as Record<string, unknown>).deliveryCompanyCode = "CJGLS"; }],
    ["fees", (input) => { (input.body as Record<string, unknown>).returnCharge = 9_000; }],
    ["fees", (input) => {
      const center = (((input.returnCentersRead as Record<string, unknown>).data as Record<string, unknown>).content as Array<Record<string, unknown>>)[0]!;
      center.returnFee05kg = 5_500;
    }],
    ["category", (input) => {
      input.categoryStatusRead = { response: { ok: false }, data: { code: "SUCCESS", data: true } };
    }],
    ["approved_detail_images", (input) => {
      (input.publishContext as { detailPage: { imageManifest: { digest: string } } })
        .detailPage.imageManifest.digest = "e".repeat(64);
    }],
    ["credential_revision", (input) => {
      (input.credentialRevision as Record<string, unknown>).expiresAt = "2020-01-01T00:00:00.000Z";
    }],
    ["options", (input) => {
      ((input.body as { items: Array<Record<string, unknown>> }).items[0]).originalPrice = 11_000;
    }],
    ["options", (input) => {
      ((input.body as { items: Array<Record<string, unknown>> }).items[0]).maximumBuyForPerson = 8;
    }],
  ];
  for (const [key, mutate] of cases) {
    const input = mutableInput();
    mutate(input);
    assert.equal(byKey(input, key).status, "blocked", key);
  }
});

test("metadata requirements are evaluated for every option item", () => {
  const input = mutableInput();
  const body = input.body as { items: Array<Record<string, unknown>> };
  const second = structuredClone(body.items[0]);
  second.itemName = "신규 상품 파랑";
  second.externalVendorSku = "NEW-SKU-BLUE";
  second.modelNo = "MODEL-BLUE";
  second.images = [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: "https://images.example/blue.jpg" }];
  second.attributes = [];
  second.notices = [];
  second.certifications = [];
  body.items.push(second);
  const metadata = (input.categoryMetadataRead as { data: Record<string, unknown> }).data;
  metadata.certifications = [{ certificationType: "KC", required: "MANDATORY", dataType: "CODE" }];
  (body.items[0].certifications as Array<Record<string, unknown>>).push({ certificationType: "KC", certificationCode: "KC-1" });
  const result = resolveCoupangCreateCompleteness(input);
  assert.equal(result.fields.find((candidate) => candidate.key === "attributes")?.status, "manual_required");
  assert.equal(result.fields.find((candidate) => candidate.key === "notices")?.status, "manual_required");
  assert.equal(result.fields.find((candidate) => candidate.key === "certifications")?.status, "manual_required");
  assert.equal(result.canBindCreateSourceRevision, false);
});

test("metadata parity selects one notice family and respects attribute groups and official certification types", () => {
  const input = mutableInput();
  const metadata = (input.categoryMetadataRead as { data: Record<string, unknown> }).data;
  metadata.noticeCategories = [
    ...(metadata.noticeCategories as unknown[]),
    {
      noticeCategoryName: "식품",
      noticeCategoryDetailNames: [{ noticeCategoryDetailName: "원재료", required: "MANDATORY" }],
    },
  ];
  metadata.attributes = [
    { attributeTypeName: "색상", required: "MANDATORY", exposed: "EXPOSED", groupNumber: "A" },
    { attributeTypeName: "무늬", required: "MANDATORY", exposed: "EXPOSED", groupNumber: "A" },
    { attributeTypeName: "내부용", required: "MANDATORY", exposed: "NONE", groupNumber: "NONE" },
  ];
  assert.equal(byKey(input, "notices").status, "resolved");
  assert.equal(byKey(input, "attributes").status, "resolved");

  const unknownNotice = structuredClone(input);
  ((unknownNotice.body as { items: Array<{ notices: unknown[] }> }).items[0].notices).push({
    noticeCategoryName: "기타 재화", noticeCategoryDetailName: "임의 항목", content: "임의 값",
  });
  assert.equal(byKey(unknownNotice, "notices").status, "blocked");

  const unknownCertification = structuredClone(input);
  ((unknownCertification.body as { items: Array<{ certifications: unknown[] }> }).items[0]
    .certifications).push({ certificationType: "UNKNOWN", certificationCode: "X-1" });
  assert.equal(byKey(unknownCertification, "certifications").status, "blocked");
});

test("provider omissions permit only explicit seller carrier and return-fee fallbacks", () => {
  const input = mutableInput();
  const center = ((input.returnCentersRead as { data: { content: Array<Record<string, unknown>> } })
    .data.content[0]);
  delete center.deliverCode;
  delete center.returnFee02kg;
  assert.equal(byKey(input, "carrier").status, "resolved");
  assert.equal(byKey(input, "fees").status, "resolved");

  const missingCarrier = structuredClone(input);
  (missingCarrier.body as Record<string, unknown>).deliveryCompanyCode = "";
  assert.equal(byKey(missingCarrier, "carrier").status, "manual_required");

  const providerConflict = mutableInput();
  (providerConflict.body as Record<string, unknown>).deliveryCompanyCode = "CJGLS";
  assert.equal(byKey(providerConflict, "carrier").status, "blocked");

  const heavierFee = mutableInput();
  const heavierCenter = ((heavierFee.returnCentersRead as { data: { content: Array<Record<string, unknown>> } })
    .data.content[0]);
  delete heavierCenter.returnFee02kg;
  heavierCenter.returnFee10kg = 4_500;
  assert.equal(byKey(heavierFee, "fees").status, "resolved");

  const addressMissing = mutableInput();
  const outbound = ((addressMissing.outboundShippingPlacesRead as { data: { content: Array<Record<string, unknown>> } })
    .data.content[0]);
  outbound.placeAddresses = [];
  assert.equal(byKey(addressMissing, "outbound_shipping_place").status, "blocked");

  const returnAddressMissing = mutableInput();
  const returned = ((returnAddressMissing.returnCentersRead as { data: { content: Array<Record<string, unknown>> } })
    .data.content[0]);
  returned.placeAddresses = [];
  assert.equal(byKey(returnAddressMissing, "return_center").status, "blocked");
});

test("representative and eight approved detail images are independent gates", () => {
  const noRepresentative = mutableInput();
  ((noRepresentative.body as { items: Array<Record<string, unknown>> }).items[0]).images = [];
  assert.equal(byKey(noRepresentative, "representative_image").status, "manual_required");
  assert.equal(byKey(noRepresentative, "approved_detail_images").status, "resolved");

  const sevenDetails = mutableInput();
  ((sevenDetails.source as { sellerpilotAssets: { approvedDetailImagePaths: string[] } })
    .sellerpilotAssets.approvedDetailImagePaths).pop();
  assert.equal(byKey(sevenDetails, "representative_image").status, "resolved");
  assert.equal(byKey(sevenDetails, "approved_detail_images").status, "blocked");

  const rotatedUrl = mutableInput();
  (rotatedUrl.source as { sellerpilotAssets: { detailImageUrls: string[] } })
    .sellerpilotAssets.detailImageUrls[0] = "https://signed.example/0?token=two";
  assert.equal(byKey(rotatedUrl, "approved_detail_images").status, "resolved");
});

test("only an all-resolved pure result can enter the 003 source-revision binder", () => {
  for (const mutate of [
    (input: CoupangCreateCompletenessInput) => {
      (input.body as Record<string, unknown>).sellerProductName = "";
    },
    (input: CoupangCreateCompletenessInput) => { delete input.categoryMetadataRead; },
    (input: CoupangCreateCompletenessInput) => {
      (input.source as Record<string, unknown>).resumeRemoteId = "existing";
    },
  ]) {
    const input = mutableInput();
    mutate(input);
    assert.throws(() => buildCoupangCreateRevisionCandidate(input),
      /COUPANG_CREATE_COMPLETENESS_REQUIRED/);
  }

  const input = mutableInput();
  input.officialReadEvidence = buildCoupangCreateOfficialReadEvidence({
    displayCategoryCode: 59631,
    environment: "production",
    now: new Date(),
    categoryMetadataRead: input.categoryMetadataRead,
    categoryStatusRead: input.categoryStatusRead,
    outboundShippingPlacesRead: input.outboundShippingPlacesRead,
    returnCentersRead: input.returnCentersRead,
  });
  const before = structuredClone(input);
  const first = resolveCoupangCreateCompleteness(input);
  const second = resolveCoupangCreateCompleteness(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  const candidate = buildCoupangCreateRevisionCandidate(input);
  const bound = bindCoupangCreateSourceRevision({
    argumentsValue: candidate.argumentsValue,
    publishContext: candidate.publishContext,
    productId,
    credentialId,
    credentialVersion: 7,
    credentialFingerprint: "ABCDEF123456",
    credentialEnvironment: "production",
    credentialExpiresAt: "2099-01-01T00:00:00.000Z",
    credential: { vendor_id: "A00123456", requested_by: "wing-user" },
    officialReadEvidence: candidate.officialReadEvidence,
    officialReadSnapshotId: "30000000-0000-4000-8000-000000000001",
    officialReadSnapshotDigestSha256: "8".repeat(64),
    market: "KR",
    targetId: "A00123456",
  });
  assert.equal(typeof bound.sellerpilotCoupangCreateSourceRevision, "object");
});
