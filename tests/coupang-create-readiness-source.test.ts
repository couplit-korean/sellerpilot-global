import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoupangCreateReadinessSource,
  coupangCreatePublishContextWithApprovedManifest,
  type CoupangCreateReadinessSourceDependencies,
  type CoupangCreateReadinessSourceInput,
} from "../lib/product-registration/coupang/create-readiness-source";

const productId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000001";
const manifestDigest = "f".repeat(64);
const imageHashes = "12345678".split("").map((value) => value.repeat(64));

function completeSource(): CoupangCreateReadinessSourceInput {
  const shippingRule = "판매자 확인 주문 기준 2영업일 출고";
  return {
    source: {
      publicationIntent: "safe_test",
      sellerpilotCoupangBaseSku: "NEW-SKU",
      facts: {
        coupangOptionRows: [{
          skuSuffix: "RED", itemName: "신규 상품 빨강", modelNo: "MODEL-RED",
          emptyBarcodeReason: "바코드가 없는 상품", salePrice: 12_900, stock: 9,
          unitCount: 1, purchaseOptions: [{ name: "색상", value: "빨강" }],
        }],
      },
      sellerpilotAssets: {
        shipping: {
          shippingFeeKrw: 3_000,
          shippingRule,
          coupangLeadTimeConfirmation: {
            source: "coupang-wing", shippingRule, outboundShippingTimeDay: 2,
            orderDateAndCalendarConfirmed: true, approvedPromiseMatched: true,
            sameDayShipping: false,
          },
        },
        approvedDetailPageVersion: 3,
        detailImageManifestDigest: manifestDigest,
        approvedDetailImagePaths: Array.from({ length: 8 }, (_, index) => `approved/${index}.png`),
        approvedDetailImageSha256s: imageHashes,
        detailImageRoles: Array.from({ length: 8 }, (_, index) => `section-${index}`),
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
        itemName: "신규 상품 빨강", externalVendorSku: "NEW-SKU-RED",
        salePrice: 12_900, originalPrice: 12_900, maximumBuyCount: 9,
        maximumBuyForPerson: 9, unitCount: 1, outboundShippingTimeDay: 2,
        barcode: "", emptyBarcode: true, emptyBarcodeReason: "바코드가 없는 상품",
        modelNo: "MODEL-RED",
        attributes: [{ attributeTypeName: "색상", attributeValueName: "빨강", exposed: "EXPOSED" }],
        notices: [{ noticeCategoryName: "기타 재화", noticeCategoryDetailName: "품명", content: "신규 상품" }],
        certifications: [],
        images: [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: "https://images.example/new.jpg" }],
      }],
    },
    publishContext: {
      product: { id: productId, sku: "NEW-SKU", name: "신규 상품", onHand: 9, costKrw: 8_000 },
      manualFields: { productName: "신규 상품", sellerSku: "NEW-SKU" },
      assignments: [{ channel: "coupang", market: "KR", status: "confirmed", categoryId: "59631" }],
      detailPage: { version: 3, approvedVersion: 3, imageManifest: { digest: manifestDigest } },
    },
    environment: "production",
    now: new Date("2026-09-10T00:00:00.000Z"),
  };
}

function dependencies(trace: string[]): CoupangCreateReadinessSourceDependencies {
  return {
    readCategoryMetadata: () => {
      trace.push("category_metadata");
      return {
        code: "SUCCESS",
        data: {
          attributes: [{ attributeTypeName: "색상", required: "MANDATORY", exposed: "EXPOSED" }],
          noticeCategories: [{
            noticeCategoryName: "기타 재화",
            noticeCategoryDetailNames: [{ noticeCategoryDetailName: "품명", required: "MANDATORY" }],
          }],
          certifications: [],
        },
      };
    },
    readCategoryStatus: () => {
      trace.push("category_status");
      return { code: "SUCCESS", data: true };
    },
    readOutboundShippingPlaces: () => {
      trace.push("outbound_shipping_places");
      return { code: "SUCCESS", data: { content: [{
        usable: true, outboundShippingPlaceCode: 12345,
        placeAddresses: [{ countryCode: "KR", addressType: "ROADNAME" }],
      }] } };
    },
    readReturnCenters: () => {
      trace.push("return_centers");
      return { code: "SUCCESS", data: { content: [{
        usable: true, returnCenterCode: "RETURN-1", deliverCode: "HANJIN",
        returnFee02kg: 4_500,
        placeAddresses: [{ countryCode: "KR", addressType: "ROADNAME" }],
      }] } };
    },
    readActiveCredentialRevision: () => {
      trace.push("active_credential_revision");
      return {
        credentialId, credentialVersion: 7, credentialFingerprint: "ABCDEF123456",
        environment: "production", expiresAt: "2099-01-01T00:00:00.000Z",
        sellerIdentityReady: true,
        accessKey: "must-not-leak", secretKey: "must-not-leak",
      };
    },
  };
}

test("seller-controlled omissions stop before every provider and credential callback", async () => {
  for (const mutate of [
    (input: CoupangCreateReadinessSourceInput) => {
      (input.body as Record<string, unknown>).sellerProductName = "";
    },
    (input: CoupangCreateReadinessSourceInput) => {
      (input.source as Record<string, unknown>).resumeRemoteId = "retired-remote";
    },
  ]) {
    const input = completeSource();
    mutate(input);
    const trace: string[] = [];
    let candidateCalls = 0;
    const deps = dependencies(trace);
    deps.buildRevisionCandidate = () => {
      candidateCalls += 1;
      throw new Error("must not run");
    };
    const result = await buildCoupangCreateReadinessSource(input, deps);
    assert.equal(result.status, "not_ready");
    assert.deepEqual(trace, []);
    assert.equal(candidateCalls, 0);
    assert.deepEqual(result.attemptedReads, []);
  }
});

test("reads exact provider sources in order, sanitizes credential revision, then builds candidate", async () => {
  const input = completeSource();
  const before = structuredClone(input);
  const trace: string[] = [];
  const deps = dependencies(trace);
  const defaultBuilder = (await import("../lib/product-registration/coupang/create-completeness"))
    .buildCoupangCreateRevisionCandidate;
  deps.buildRevisionCandidate = (value) => {
    trace.push("candidate");
    return defaultBuilder(value);
  };
  const result = await buildCoupangCreateReadinessSource(input, deps);
  assert.equal(result.status, "ready");
  assert.deepEqual(trace, [
    "category_metadata", "category_status", "outbound_shipping_places",
    "return_centers", "active_credential_revision", "candidate",
  ]);
  assert.deepEqual(input, before);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|accessKey|secretKey/u);
  if (result.status === "ready") {
    assert.equal(result.candidate.credentialRevision.credentialId, credentialId);
    assert.deepEqual(Object.keys(result.candidate.credentialRevision).sort(), [
      "credentialFingerprint", "credentialId", "credentialVersion", "environment",
      "expiresAt", "sellerIdentityReady",
    ]);
    assert.equal(result.candidate.completeness.canBindCreateSourceRevision, true);
    assert.equal(result.candidate.officialReadEvidence.contract,
      "sellerpilot_coupang_create_official_read_evidence_v1");
    assert.equal(result.candidate.officialReadEvidence.displayCategoryCode, 59631);
    assert.match(String(result.candidate.officialReadEvidence.evidenceSha256), /^[a-f0-9]{64}$/);
    assert.equal(result.officialReadSnapshotPayload.contract,
      "sellerpilot_coupang_create_official_read_snapshot_payload_v1");
    assert.deepEqual(result.officialReadSnapshotPayload.officialReadEvidence,
      result.candidate.officialReadEvidence);
    assert.equal(result.officialReadSnapshotPayload.normalizedReads.categoryStatus, true);
    assert.deepEqual(
      Object.keys(result.officialReadSnapshotPayload.normalizedReads).sort(),
      ["categoryMetadata", "categoryStatus", "outboundShippingPlaces", "returnCenters"],
    );
  }
});

test("normalized official GET evidence is key-order stable and changes with provider data", async () => {
  const first = await buildCoupangCreateReadinessSource(completeSource(), dependencies([]));
  const reordered = dependencies([]);
  reordered.readCategoryStatus = () => ({ data: true, code: "SUCCESS" });
  const second = await buildCoupangCreateReadinessSource(completeSource(), reordered);
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  if (first.status === "ready" && second.status === "ready") {
    assert.equal(first.candidate.officialReadEvidence.evidenceSha256,
      second.candidate.officialReadEvidence.evidenceSha256);
  }

  const changed = dependencies([]);
  changed.readCategoryStatus = () => ({ code: "SUCCESS", data: false });
  const third = await buildCoupangCreateReadinessSource(completeSource(), changed);
  assert.equal(third.status, "not_ready", "a provider contradiction must fail before candidate binding");
});

test("a failed provider read stops all later reads and candidate construction", async () => {
  const trace: string[] = [];
  let candidateCalls = 0;
  const deps = dependencies(trace);
  deps.readCategoryStatus = () => {
    trace.push("category_status");
    throw new Error("provider timeout with secret text");
  };
  deps.buildRevisionCandidate = () => {
    candidateCalls += 1;
    throw new Error("must not run");
  };
  const result = await buildCoupangCreateReadinessSource(completeSource(), deps);
  assert.equal(result.status, "not_ready");
  if (result.status === "not_ready") {
    assert.equal(result.reason, "provider_read_failed");
    assert.equal(result.stage, "category_status");
  }
  assert.deepEqual(trace, ["category_metadata", "category_status"]);
  assert.equal(candidateCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /timeout|secret text/u);
});

test("shipping centers are never auto-selected when seller-confirmed codes are absent", async () => {
  const input = completeSource();
  (input.body as Record<string, unknown>).outboundShippingPlaceCode = "";
  const trace: string[] = [];
  const result = await buildCoupangCreateReadinessSource(input, dependencies(trace));
  assert.equal(result.status, "not_ready");
  if (result.status === "not_ready") {
    assert.equal(result.reason, "seller_input_required");
    assert.equal(result.stage, "outbound_shipping_places");
    assert.ok(result.completeness.blockingFieldKeys.includes("outbound_shipping_place"));
  }
  assert.deepEqual(trace, ["category_metadata", "category_status", "outbound_shipping_places"]);
  assert.equal((input.body as Record<string, unknown>).outboundShippingPlaceCode, "");
});

test("same immutable input and injected reads produce an idempotent result", async () => {
  const input = completeSource();
  const before = structuredClone(input);
  const firstTrace: string[] = [];
  const secondTrace: string[] = [];
  const first = await buildCoupangCreateReadinessSource(input, dependencies(firstTrace));
  const second = await buildCoupangCreateReadinessSource(input, dependencies(secondTrace));
  assert.deepEqual(first, second);
  assert.deepEqual(firstTrace, secondTrace);
  assert.deepEqual(input, before);
});

test("server-approved external manifest adapts the legacy detail page for completeness", async () => {
  const input = completeSource();
  const context = input.publishContext as Record<string, unknown>;
  context.detailPage = { version: 3, approvedVersion: 0, imageManifest: null };
  input.publishContext = coupangCreatePublishContextWithApprovedManifest(context, {
    version: 3,
    manifest: { digest: manifestDigest },
  });
  const result = await buildCoupangCreateReadinessSource(input, dependencies([]));
  assert.equal(result.status, "ready");
  assert.equal(result.completeness.fields.find((field) =>
    field.key === "approved_detail_images")?.status, "resolved");
});
