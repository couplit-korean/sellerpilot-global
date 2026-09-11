import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  normalizeQoo10ListingPublicationReadback,
  qoo10OfficialReadbackUnsupportedFields,
  qoo10StrictProjectionExcludedFields,
  qoo10StrictProjectionFields,
} from "../lib/channels/qoo10-listing-publication";
import { qoo10PublicationReadbackStep } from "../lib/product-registration/channels/qoo10";
import type { Qoo10ListingCreateExpectation } from "../lib/channels/qoo10-listing-create-preflight";
import type { RemoteResponse } from "../lib/channels/protocols";

const ITEM_CODE = "1234567890";
const TEST_ITEM_CODE = "1098765432";
const SELLER_CODE = "QA-20260910-READBACK-TRACE-001";
const FINGERPRINT = "a".repeat(64);
const SELLER_ACCOUNT_IDENTITY_DIGEST = "b".repeat(64);
const CATEGORY_CODE = "123456789";
const MANUFACTURE_NO = "55000001";
const BRAND_NO = "77000002";
const SHIPPING_NO = "806971";
const SELL_PRICE = 1871;
const RETAIL_PRICE = 2500;
const QUANTITY = 7;
const STANDARD_IMAGE_URL = "https://cdn.example.test/main.jpg";
const DETAIL_IMAGE_URLS = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/detail-${index + 1}.jpg`,
);
const DETAIL_HTML = `<section lang="ja-JP"><p>日本語の商品詳細です。</p>${
  DETAIL_IMAGE_URLS.map((url) => `<img src="${url}">`).join("")
}</section>`;

function digestOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/**
 * Server-bound strict create projection. Production builds this from the
 * approved prewrite arguments; this fixture only has to be the same shape the
 * readback compares against.
 */
function createExpectation(): Qoo10ListingCreateExpectation {
  return {
    context: {
      contract: "sellerpilot_qoo10_listing_create_context_v1",
      productId: "10000000-0000-4000-8000-000000000001",
      sku: SELLER_CODE,
      sourceCurrency: "KRW",
      sourcePrice: 5_000,
      market: "JP",
      locale: "ja-JP",
      currency: "JPY",
      price: SELL_PRICE,
      quantity: QUANTITY,
    },
    approval: {
      contract: "sellerpilot_qoo10_listing_create_approval_v1",
      approvalRevision: 7,
      approvalContentSha256: digestOf({ approval: 7 }),
      approvedDetailPageVersion: 3,
      approvedManifestDigest: digestOf({ manifest: 3 }),
      japaneseDocumentSha256: digestOf({ document: "ja" }),
      englishDocumentSha256: digestOf({ document: "en" }),
      sellerIdDigest: digestOf({ sellerId: "seller-fixture" }),
      sellerAccountIdentityDigest: SELLER_ACCOUNT_IDENTITY_DIGEST,
      testItemCode: TEST_ITEM_CODE,
      testItemSellerCodeDigest: digestOf({ testItemSellerCode: "test-item" }),
      dispatchPlaceId: "dispatch-jp-1",
      returnPolicyId: "return-jp-1",
      fulfillmentEvidenceRevision: "seller-account-revision-7",
      fulfillmentEvidenceObservedAt: "2026-09-10T00:00:00.000Z",
      fulfillmentEvidenceExpiresAt: "2026-12-31T00:00:00.000Z",
      fulfillmentEvidenceDigest: digestOf({ fulfillment: 7 }),
      dispatchPlaceDigest: digestOf({ dispatchPlaceId: "dispatch-jp-1" }),
      returnPolicyDigest: digestOf({ returnPolicyId: "return-jp-1" }),
      approvalPayloadDigest: digestOf({ approvalPayload: 7 }),
    },
    sellerIdDigest: digestOf({ sellerId: "seller-fixture" }),
    testItemCode: TEST_ITEM_CODE,
    sellerCode: SELLER_CODE,
    itemTitle: "日本語の商品名",
    categoryCode: CATEGORY_CODE,
    manufactureNo: MANUFACTURE_NO,
    brandNo: BRAND_NO,
    productionPlaceType: "2",
    productionPlace: "KR",
    availableDateType: "0",
    availableDateValue: "1",
    additionalOption: "",
    itemType: "",
    optionContract: "single_sku_no_options",
    retailPrice: RETAIL_PRICE,
    price: SELL_PRICE,
    quantity: QUANTITY,
    shippingNo: SHIPPING_NO,
    standardImageUrl: STANDARD_IMAGE_URL,
    standardImageDigest: digestOf({ standardImageUrl: STANDARD_IMAGE_URL }),
    detailImageUrls: DETAIL_IMAGE_URLS,
    detailImageDigests: DETAIL_IMAGE_URLS.map((url) => digestOf({ detail: url })),
    detailImageDigest: digestOf({ details: DETAIL_IMAGE_URLS }),
    publicationAssetDigest: digestOf({ assets: DETAIL_IMAGE_URLS }),
  };
}

/**
 * Synthetic ItemsLookup.GetItemDetailInfo 1.2 payload. Note that the payload
 * never carries ProductionPlace, AvailableDateType, AvailableDateValue,
 * AdditionalOption, or ItemType: the official readback declares those fields
 * unsupported, so a correct listing cannot be judged unverified for them.
 */
function itemDetailInfo(overrides: Record<string, unknown> = {}) {
  return {
    ResultCode: 0,
    ResultMsg: "SUCCESS",
    ResultObject: {
      ItemNo: ITEM_CODE,
      ItemCode: ITEM_CODE,
      ItemStatus: "S2",
      ItemTitle: "日本語の商品名",
      SellerCode: SELLER_CODE,
      SecondSubCat: CATEGORY_CODE,
      ManufacturerCd: MANUFACTURE_NO,
      BrandCd: BRAND_NO,
      ShippingNo: SHIPPING_NO,
      SellPrice: `${SELL_PRICE}.0000`,
      RetailPrice: String(RETAIL_PRICE),
      ItemQty: String(QUANTITY),
      ImageUrl: STANDARD_IMAGE_URL,
      ItemDetail: DETAIL_HTML,
      ...overrides,
    },
  };
}

function readbackInput(resultObject: unknown) {
  return {
    operation: "listing.create" as const,
    remoteId: ITEM_CODE,
    resultObject,
    expectedLocale: "ja-JP",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
    expectedCreate: createExpectation(),
    expectedSellerAccountIdentityDigest: SELLER_ACCOUNT_IDENTITY_DIGEST,
    verifiedAt: new Date("2026-09-10T00:00:00.000Z"),
  };
}

test("Qoo10 readback declares which strict-create fields it cannot observe", () => {
  assert.deepEqual([...qoo10OfficialReadbackUnsupportedFields], [
    "ProductionPlace",
    "AvailableDateType",
    "AvailableDateValue",
    "AdditionalOption",
    "ItemType",
  ]);
  // Derived from the declaration, so the exclusion cannot silently widen.
  assert.deepEqual([...qoo10StrictProjectionExcludedFields], [
    "productionPlaceType",
    "productionPlace",
    "availableDateType",
    "availableDateValue",
    "additionalOption",
    "itemType",
    "optionContract",
  ]);
  for (const protectedField of [
    "categoryCode",
    "manufactureNo",
    "brandNo",
    "itemTitle",
    "shippingNo",
    "retailPrice",
    "price",
    "quantity",
    "standardImageUrl",
    "detailImageUrls",
  ]) {
    assert.equal(
      qoo10StrictProjectionExcludedFields.includes(protectedField),
      false,
      `${protectedField} must stay inside the strict projection`,
    );
  }
  // No projected (checked) field may be excluded from the projection.
  assert.deepEqual(
    qoo10StrictProjectionFields
      .filter((entry) => qoo10StrictProjectionExcludedFields.includes(entry.field)),
    [],
  );
});

test("Qoo10 readback verifies a fully matching GetItemDetailInfo payload", () => {
  const verification = normalizeQoo10ListingPublicationReadback(
    readbackInput(itemDetailInfo()),
  );

  assert.deepEqual(verification.checks, {
    identityVerified: true,
    statusVerified: true,
    sellerCodeVerified: true,
    localeVerified: true,
    fingerprintVerified: true,
    imageCountVerified: true,
    sellerAccountIdentityVerified: true,
    categoryVerified: true,
    catalogVerified: true,
    titleVerified: true,
    shippingVerified: true,
    priceQuantityVerified: true,
    representativeImageVerified: true,
    detailImageDigestVerified: true,
    retailPriceVerified: true,
  });
  assert.equal(verification.remoteState?.visibility, "live");
  assert.equal(verification.remoteState?.providerStatus, "S2");
  assert.equal(verification.remoteState?.imageCount, 8);
  assert.equal(verification.remoteState?.evidence.titleVerified, true);
  assert.equal(verification.remoteState?.evidence.categoryVerified, true);
  assert.equal(verification.remoteState?.evidence.priceQuantityVerified, true);
  assert.deepEqual(
    verification.remoteState?.evidence.officialReadbackUnsupportedFields,
    [...qoo10OfficialReadbackUnsupportedFields],
  );
  assert.deepEqual(verification.diagnostics, {
    verified: true,
    reasonCode: "QOO10_READBACK_VERIFIED",
    failedChecks: [],
    strictProjection: {
      verified: true,
      failedFields: [],
      excludedFields: [...qoo10StrictProjectionExcludedFields],
    },
    remoteStateRejected: false,
  });
});

test("Qoo10 readback names the failing check and withholds remoteState on a mismatch", () => {
  const cases: Array<{
    label: string;
    overrides: Record<string, unknown>;
    check: string;
    code: string;
    expectedFragment: string;
    observedFragment: string;
    strictField: string;
  }> = [
    {
      label: "item title",
      overrides: { ItemTitle: "別の商品名" },
      check: "titleVerified",
      code: "QOO10_READBACK_TITLE_MISMATCH",
      expectedFragment: "ItemTitle=日本語の商品名",
      observedFragment: "ItemTitle=別の商品名",
      strictField: "itemTitle",
    },
    {
      label: "category",
      overrides: { SecondSubCat: "987654321" },
      check: "categoryVerified",
      code: "QOO10_READBACK_CATEGORY_MISMATCH",
      expectedFragment: `SecondSubCat=${CATEGORY_CODE}`,
      observedFragment: "SecondSubCat=987654321",
      strictField: "categoryCode",
    },
    {
      label: "sell price",
      overrides: { SellPrice: "1900.0000" },
      check: "priceQuantityVerified",
      code: "QOO10_READBACK_PRICE_QUANTITY_MISMATCH",
      expectedFragment: "SellPrice=1871",
      observedFragment: "SellPrice=1900",
      strictField: "price",
    },
    {
      label: "quantity",
      overrides: { ItemQty: "99" },
      check: "priceQuantityVerified",
      code: "QOO10_READBACK_PRICE_QUANTITY_MISMATCH",
      expectedFragment: "ItemQty=7",
      observedFragment: "ItemQty=99",
      strictField: "quantity",
    },
    {
      label: "shipping group",
      overrides: { ShippingNo: "111111" },
      check: "shippingVerified",
      code: "QOO10_READBACK_SHIPPING_MISMATCH",
      expectedFragment: `ShippingNo=${SHIPPING_NO}`,
      observedFragment: "ShippingNo=111111",
      strictField: "shippingNo",
    },
  ];

  for (const mismatch of cases) {
    const verification = normalizeQoo10ListingPublicationReadback(
      readbackInput(itemDetailInfo(mismatch.overrides)),
    );
    const label = mismatch.label;

    assert.equal(verification.remoteState, undefined, `${label}: no verified state`);
    assert.equal(verification.diagnostics.verified, false, label);
    assert.equal(
      verification.diagnostics.reasonCode,
      "QOO10_READBACK_CHECK_MISMATCH",
      label,
    );
    assert.equal(verification.diagnostics.remoteStateRejected, false, label);

    const failure = verification.diagnostics.failedChecks.find(
      (entry) => entry.check === mismatch.check,
    );
    assert.ok(failure, `${label}: diagnostic names ${mismatch.check}`);
    assert.equal(failure.code, mismatch.code, label);
    assert.ok(
      failure.expected.includes(mismatch.expectedFragment),
      `${label}: expected ${failure.expected}`,
    );
    assert.ok(
      failure.observed.includes(mismatch.observedFragment),
      `${label}: observed ${failure.observed}`,
    );
    assert.ok(
      verification.diagnostics.strictProjection.failedFields.includes(mismatch.strictField),
      `${label}: strict projection names ${mismatch.strictField}`,
    );
    assert.equal(
      verification.diagnostics.strictProjection.verified,
      false,
      label,
    );
    assert.deepEqual(
      verification.diagnostics.strictProjection.excludedFields,
      [...qoo10StrictProjectionExcludedFields],
      label,
    );
  }
});

test("Qoo10 readback reports an unmatched item as an identity failure", () => {
  const verification = normalizeQoo10ListingPublicationReadback(
    readbackInput(itemDetailInfo({ ItemNo: "9999999999", ItemCode: "9999999999" })),
  );

  assert.equal(verification.remoteState, undefined);
  assert.equal(verification.providerStatus, "");
  assert.equal(verification.imageCount, 0);
  assert.equal(verification.checks.identityVerified, false);
  assert.equal(verification.diagnostics.reasonCode, "QOO10_READBACK_CHECK_MISMATCH");
  assert.deepEqual(
    verification.diagnostics.failedChecks.find((entry) => entry.check === "identityVerified"),
    {
      check: "identityVerified",
      code: "QOO10_READBACK_IDENTITY_MISMATCH",
      providerFields: ["ItemCode", "IdentifiedItemCount"],
      expected: `ItemCode=${ITEM_CODE}, IdentifiedItemCount=1`,
      observed: "ItemCode=, IdentifiedItemCount=0",
    },
  );
  assert.equal(
    verification.diagnostics.failedChecks[0]?.check,
    "identityVerified",
  );
  assert.equal(
    verification.diagnostics.failedChecks[0]?.code,
    "QOO10_READBACK_IDENTITY_MISMATCH",
  );
});

test("Qoo10 readback reports a schema rejection separately from a field mismatch", () => {
  const verification = normalizeQoo10ListingPublicationReadback({
    ...readbackInput(itemDetailInfo()),
    // Every field check passes, but the verified-state schema refuses a
    // verification timestamp that is in the future.
    verifiedAt: new Date(Date.now() + 30 * 60 * 1_000),
  });

  assert.equal(verification.remoteState, undefined);
  assert.deepEqual(
    verification.diagnostics.failedChecks,
    [],
    "no field mismatch should be reported",
  );
  assert.equal(verification.diagnostics.verified, false);
  assert.equal(
    verification.diagnostics.reasonCode,
    "QOO10_READBACK_REMOTE_STATE_REJECTED",
  );
  assert.equal(verification.diagnostics.remoteStateRejected, true);
});

test("Qoo10 publication step carries the failed-check diagnostics into the operation result", () => {
  const payload = itemDetailInfo({ ItemTitle: "別の商品名" });
  const remote: RemoteResponse = {
    response: new Response(JSON.stringify(payload), { status: 200 }),
    data: payload as unknown as Record<string, unknown>,
    text: JSON.stringify(payload),
  };
  const verification = normalizeQoo10ListingPublicationReadback(
    readbackInput(payload),
  );
  const publicationStep = qoo10PublicationReadbackStep(remote, verification);

  assert.equal(publicationStep.ok, false);
  // The provider-facing message keeps its exact form: live identity SQL matches
  // on this literal string.
  assert.equal(publicationStep.data.ResultMsg, "QOO10_PUBLICATION_STATE_UNVERIFIED");
  assert.equal(
    publicationStep.data.sellerpilotPublicationChecks?.titleVerified,
    false,
  );
  const diagnostics = publicationStep.data.sellerpilotPublicationDiagnostics as
    | { reasonCode: string; failedChecks: Array<{ check: string; code: string }> }
    | undefined;
  assert.equal(diagnostics?.reasonCode, "QOO10_READBACK_CHECK_MISMATCH");
  assert.deepEqual(diagnostics?.failedChecks.map((entry) => entry.check), ["titleVerified"]);
  assert.deepEqual(
    diagnostics?.failedChecks.map((entry) => entry.code),
    ["QOO10_READBACK_TITLE_MISMATCH"],
  );
});
