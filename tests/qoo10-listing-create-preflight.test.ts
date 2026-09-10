import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { applyPreparedQoo10Images } from "../lib/channels/marketplace-images";
import { listingPublicationProviderAssetEvidence } from "../lib/channels/listing-publication-content";
import { executeListingPublicationVerification } from "../lib/channels/listing-publication-verification";
import { qoo10VerifiedListingRemoteState } from "../lib/channels/qoo10-listing-publication";
import {
  qoo10SellerCodeAbsent,
  buildQoo10ListingCreateContext,
  qoo10ListingCreateExpectation,
  qoo10ListingCreateContextContract,
  qoo10SellerAccountIdentityDigestFromReadback,
} from "../lib/channels/qoo10-listing-create-preflight";
import { bindQoo10ListingCreateApproval } from "../lib/channels/qoo10-listing-create-approval";
import { qoo10ListingCreateFulfillmentEvidenceFromOfficialGets } from "../lib/channels/qoo10-listing-create-fulfillment-evidence";
import { externalDetailDigest } from "../lib/external-detail-copy";
import {
  qoo10QsmCreateFulfillmentCaptureContract,
  qoo10QsmCreateFulfillmentCollector,
  qoo10QsmCreateFulfillmentOrigin,
  qoo10QsmCreateFulfillmentTrustBoundary,
  sealQoo10QsmCreateFulfillmentCapture,
} from "../lib/channels/qoo10-listing-create-fulfillment-qsm-source";
import {
  assertQoo10CreateFulfillmentMutationFence,
  bindQoo10ListingCreateApprovalFromDurableSource,
} from "../lib/server-qoo10-listing-create-fulfillment-source";

const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000001";
const CLAIM_ID = "30000000-0000-4000-8000-000000000001";
const OWNER_ID = "40000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "50000000-0000-4000-8000-000000000001";
// The exact CC-001 SKU already owns remote 1217336970 and is update-only.
// Generic create-contract coverage must use a distinct fixture identity.
const SKU = "QA-20260823-CF-002";
const ITEM_CODE = "1234567890";
const TEST_ITEM_CODE = "1098765432";
const SELLER_ID = "seller-qa-account";
const TEST_ITEM_SELLER_CODE = "ACCOUNT-BOUND-TEST-ITEM";
const BI_CONTENTS_NO = "8461402963";
const FINGERPRINT = "a".repeat(64);
const SOURCE_PRICE_KRW = 5_000;
const QAPI_PRICE_JPY = 1_871;
const roles = [
  "detail-hero",
  "detail-overview",
  "detail-feature-one",
  "detail-feature-two",
  "detail-specification",
  "detail-use",
  "detail-care",
  "detail-closing",
];

function imageDigest(index: number) {
  return index.toString(16).padStart(64, "0");
}

function jsonDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function fulfillmentEvidence() {
  const now = new Date();
  const observedAt = new Date(now.getTime() - 1_000).toISOString();
  const sellerIdDigest = jsonDigest({ sellerId: SELLER_ID });
  const sellerAccountIdentityDigest = jsonDigest({
    sellerIdDigest,
    testItemCode: TEST_ITEM_CODE,
    testItemSellerCode: TEST_ITEM_SELLER_CODE,
  });
  const response = (
    resource: "seller_account_identity" | "dispatch_places" | "return_policies",
    records: Array<Record<string, unknown>>,
  ) => ({
    contract: "sellerpilot_qoo10_official_get_evidence_v1" as const,
    method: "GET" as const,
    resource,
    sourceOrigin: resource === "seller_account_identity"
      ? "https://api.qoo10.jp" : "https://qsm.qoo10.jp",
    authenticated: true,
    authenticatedSellerId: SELLER_ID,
    sellerAccountIdentityDigest,
    observedAt,
    revision: `${resource}-revision-7`,
    status: 200,
    resultCode: 0,
    records,
  });
  return qoo10ListingCreateFulfillmentEvidenceFromOfficialGets({
    sellerId: SELLER_ID,
    testItemCode: TEST_ITEM_CODE,
    dispatchPlaceId: "dispatch-jp-1",
    returnPolicyId: "return-jp-1",
    responses: {
      seller_account_identity: response("seller_account_identity", [{
        id: TEST_ITEM_CODE,
        active: true,
        sellerCode: TEST_ITEM_SELLER_CODE,
        payload: { ItemNo: TEST_ITEM_CODE, SellerCode: TEST_ITEM_SELLER_CODE },
      }]),
      dispatch_places: response("dispatch_places", [{
        id: "dispatch-jp-1",
        active: true,
        payload: { country: "JP", postalCode: "100-0001", address: "Tokyo" },
      }]),
      return_policies: response("return_policies", [{
        id: "return-jp-1",
        active: true,
        payload: { currency: "JPY", returnFee: 500, windowDays: 7 },
      }]),
    },
    now,
  });
}

function normalizedImage(index: number) {
  const contentSha256 = imageDigest(index);
  const objectPath = `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
  return {
    publicUrl: `https://qa-project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256,
  };
}

function qoo10MainImage(contentId: string, lastShard = contentId.slice(-3), precedingShard = contentId.slice(-6, -3)) {
  return `https://gd.image-qoo10.jp/li/${lastShard}/${precedingShard}/${contentId}.g_400-w-st_g.jpg`;
}

function publicationBinding() {
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "b".repeat(64),
    approvedDetailImages: roles.map((role, index) => ({
      role,
      approvedObjectPath: `results/${ATTEMPT_ID}/claims/${CLAIM_ID}/${index + 1}.png`,
      approvedSourceSha256: (index + 20).toString(16).padStart(64, "0"),
      ...normalizedImage(index + 1),
    })),
    providerImageSurface: "detail_content",
    providerTransportImages: roles.map((role, index) => ({
      role,
      ...normalizedImage(index + 1),
    })),
  };
}

function detailHtml() {
  return `<section lang="ja-JP"><h2>商品の詳しいご案内</h2><p>毎日の暮らしで使いやすい品質と仕上がりを、日本のお客様向けに分かりやすくご案内します。</p>${roles
    .map((_role, index) => `<img src="${normalizedImage(index + 1).publicUrl}" alt="商品詳細 ${index + 1}">`)
    .join("")}</section>`;
}

function strictArguments(overrides: Record<string, unknown> = {}) {
  const params = {
    SecondSubCat: "320000542",
    ManufactureNo: "100000042",
    BrandNo: "200000084",
    ItemTitle: "暮らしに便利な高品質ケーブル整理クリップ",
    PromotionName: "便利な整理用品",
    SellerCode: SKU,
    IndustrialCode: "",
    IndustrialCodeType: "",
    ProductionPlaceType: "2",
    ProductionPlace: "KR",
    AdultYN: "N",
    StandardImage: normalizedImage(9).publicUrl,
    ItemDescription: detailHtml(),
    AdditionalOption: "",
    ItemType: "",
    RetailPrice: String(QAPI_PRICE_JPY),
    ItemPrice: String(QAPI_PRICE_JPY),
    TaxRate: "S",
    ItemQty: "1",
    ExpireDate: "2027-08-30",
    ShippingNo: "0",
    AvailableDateType: "0",
    AvailableDateValue: "3",
  };
  const itemTitle = params.ItemTitle;
  const approvedExternalExport = {
    title: itemTitle,
    html: detailHtml(),
    plain: "商品の詳しいご案内",
    sections: roles.map((role, index) => ({
      imageAsset: role,
      body: `承認済み商品詳細 ${index + 1}`,
    })),
  };
  const argumentsValue = {
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    sellerpilotQoo10CreateContext: {
      contract: qoo10ListingCreateContextContract,
      productId: PRODUCT_ID,
      sku: SKU,
      sourceCurrency: "KRW",
      sourcePrice: SOURCE_PRICE_KRW,
      market: "JP",
      locale: "ja-JP",
      currency: "JPY",
      price: QAPI_PRICE_JPY,
      quantity: 1,
    },
    sellerpilotExternalDetail: {
      contract: "sellerpilot_external_detail_channel_v1",
      productId: PRODUCT_ID,
      version: 1,
      approvalRevision: 7,
      contentSha256: "c".repeat(64),
      requestSha256: "d".repeat(64),
      documentSha256: "e".repeat(64),
      allLocaleDocumentSha256: {
        ja: "e".repeat(64),
        en: "f".repeat(64),
      },
      channel: "qoo10",
      market: "JP",
      locale: "ja-JP",
      language: "ja",
      title: itemTitle,
      html: detailHtml(),
      plain: approvedExternalExport.plain,
      sections: approvedExternalExport.sections,
      imageSha256s: roles.map((_role, index) =>
        (index + 20).toString(16).padStart(64, "0")),
      exportSha256: externalDetailDigest(approvedExternalExport),
    },
    sellerpilotAssets: {
      approvedDetailPageVersion: 1,
      detailImageManifestDigest: "b".repeat(64),
      detailImageRoles: roles,
      approvedDetailImageSha256s: roles.map((_role, index) =>
        (index + 20).toString(16).padStart(64, "0")),
      shipping: {
        shippingFeeKrw: 0,
        shippingRule: "通常発送 3営業日以内",
        packagingRule: "追跡可能な梱包",
        policyReview: "확인",
        shippingRuleReview: "확인",
        packagingRuleReview: "확인",
      },
    },
    params,
  };
  const bound = bindQoo10ListingCreateApproval(argumentsValue, fulfillmentEvidence());
  return {
    ...bound,
    sellerpilotPublicationAssetBinding: publicationBinding(),
    ...overrides,
  };
}

const payload = {
  api_key: "test-key",
  seller_id: SELLER_ID,
  test_item_code: TEST_ITEM_CODE,
};

function providerReadback() {
  const params = strictArguments().params as Record<string, string>;
  return {
    ItemNo: ITEM_CODE,
    ItemStatus: "S2",
    ItemTitle: params.ItemTitle,
    SellerCode: params.SellerCode,
    SecondSubCatCd: params.SecondSubCat,
    ManufacturerCd: params.ManufactureNo,
    BrandCd: params.BrandNo,
    ShippingNo: params.ShippingNo,
    RetailPrice: params.RetailPrice,
    SellPrice: params.ItemPrice,
    ItemQty: params.ItemQty,
    ItemDetail: params.ItemDescription,
    ImageUrl: params.StandardImage,
  };
}

test("Qoo10 strict create contract binds QA SKU, 5,000 KRW source, JP/ja-JP, separate JPY target price, stock, and nine independent durable image digests", () => {
  assert.deepEqual(buildQoo10ListingCreateContext({
    productId: PRODUCT_ID,
    product: { id: PRODUCT_ID, sku: SKU, onHand: 1 },
    manualFields: { sellingPrice: SOURCE_PRICE_KRW, currency: "KRW" },
    market: "JP",
    currency: "JPY",
    price: QAPI_PRICE_JPY,
  }), strictArguments().sellerpilotQoo10CreateContext);
  const parsed = qoo10ListingCreateExpectation({ arguments: strictArguments(), payload });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.expectation.sellerCode, SKU);
  assert.equal(parsed.expectation.approval.approvalRevision, 7);
  assert.equal(parsed.expectation.approval.japaneseDocumentSha256, "e".repeat(64));
  assert.equal(parsed.expectation.approval.englishDocumentSha256, "f".repeat(64));
  assert.match(parsed.expectation.approval.dispatchPlaceDigest, /^[a-f0-9]{64}$/u);
  assert.match(parsed.expectation.approval.returnPolicyDigest, /^[a-f0-9]{64}$/u);
  assert.equal(parsed.expectation.approval.dispatchPlaceId, "dispatch-jp-1");
  assert.equal(parsed.expectation.approval.returnPolicyId, "return-jp-1");
  assert.match(parsed.expectation.approval.fulfillmentEvidenceRevision, /^[a-f0-9]{64}$/u);
  assert.match(parsed.expectation.approval.fulfillmentEvidenceDigest, /^[a-f0-9]{64}$/u);
  assert.equal(parsed.expectation.manufactureNo, "100000042");
  assert.equal(parsed.expectation.brandNo, "200000084");
  assert.equal(parsed.expectation.productionPlaceType, "2");
  assert.equal(parsed.expectation.productionPlace, "KR");
  assert.equal(parsed.expectation.availableDateType, "0");
  assert.equal(parsed.expectation.availableDateValue, "3");
  assert.equal(parsed.expectation.optionContract, "single_sku_no_options");
  assert.equal(parsed.expectation.context.market, "JP");
  assert.equal(parsed.expectation.context.locale, "ja-JP");
  assert.equal(parsed.expectation.context.sourceCurrency, "KRW");
  assert.equal(parsed.expectation.context.sourcePrice, SOURCE_PRICE_KRW);
  assert.equal(parsed.expectation.context.currency, "JPY");
  assert.equal(parsed.expectation.retailPrice, QAPI_PRICE_JPY);
  assert.equal(parsed.expectation.price, QAPI_PRICE_JPY);
  assert.equal(parsed.expectation.quantity, 1);
  assert.equal(parsed.expectation.detailImageUrls.length, 8);
  assert.equal(new Set([
    parsed.expectation.standardImageDigest,
    ...parsed.expectation.detailImageDigests,
  ]).size, 9);
});

test("Qoo10 strict live readback independently rejects category, catalog, shipping, prices, stock, representative image, and detail digest drift", () => {
  const parsed = qoo10ListingCreateExpectation({ arguments: strictArguments(), payload });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const base = {
    operation: "listing.create" as const,
    remoteId: ITEM_CODE,
    resultObject: providerReadback(),
    expectedSellerCode: SKU,
    expectedLocale: "ja-JP",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
    expectedCreate: parsed.expectation,
    expectedSellerAccountIdentityDigest: "c".repeat(64),
  };
  assert.ok(qoo10VerifiedListingRemoteState(base));
  for (const [field, value] of [
    ["SecondSubCatCd", "999999999"],
    ["ManufacturerCd", "100000043"],
    ["BrandCd", "200000085"],
    ["ShippingNo", "42"],
    ["RetailPrice", "4999"],
    ["SellPrice", "4999"],
    ["ItemQty", "2"],
    ["ImageUrl", normalizedImage(10).publicUrl],
    ["ItemDetail", detailHtml().replace(normalizedImage(8).publicUrl, normalizedImage(10).publicUrl)],
  ] as const) {
    assert.equal(qoo10VerifiedListingRemoteState({
      ...base,
      resultObject: { ...providerReadback(), [field]: value },
    }), null, field);
  }
});

test("Qoo10 strict create rejects expired fulfillment evidence", () => {
  const argumentsValue = strictArguments();
  const approval = argumentsValue.sellerpilotQoo10CreateApprovalBinding as Record<string, unknown>;
  const expiresAt = Date.parse(String(approval.fulfillmentEvidenceExpiresAt));
  const parsed = qoo10ListingCreateExpectation({
    arguments: argumentsValue,
    payload,
    now: new Date(expiresAt + 1),
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(
    parsed.mismatchFields.includes("sellerpilotQoo10CreateApprovalBinding"),
    true,
  );
});

test("Qoo10 strict create binds a provider-rehosted representative image to SetNewGoods BIContentsNo and exact CDN shards", () => {
  const parsed = qoo10ListingCreateExpectation({ arguments: strictArguments(), payload });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const base = {
    operation: "listing.create" as const,
    remoteId: ITEM_CODE,
    resultObject: { ...providerReadback(), ImageUrl: qoo10MainImage(BI_CONTENTS_NO) },
    expectedSellerCode: SKU,
    expectedLocale: "ja-JP",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
    expectedCreate: parsed.expectation,
    expectedSellerAccountIdentityDigest: "c".repeat(64),
    expectedRepresentativeImageContentId: BI_CONTENTS_NO,
  };
  const accepted = qoo10VerifiedListingRemoteState(base);
  assert.equal(accepted?.evidence.version, "qoo10_get_item_detail_create_v4");
  assert.equal(accepted?.evidence.representativeImageBinding, "set_new_goods_bi_contents_no");
  assert.equal(accepted?.evidence.representativeImageBindingVerified, true);
  assert.equal(accepted?.evidence.representativeImageContentIdVerified, true);
  assert.equal(accepted?.resources.representativeImageBinding, "set_new_goods_bi_contents_no");
  assert.equal(accepted?.resources.qoo10MainImageContentId, BI_CONTENTS_NO);

  const acceptedOriginalSize = qoo10VerifiedListingRemoteState({
    ...base,
    resultObject: {
      ...providerReadback(),
      ImageUrl: `https://gd.image-qoo10.jp/li/963/402/${BI_CONTENTS_NO}.jpg`,
    },
  });
  assert.equal(
    acceptedOriginalSize?.evidence.representativeImageBinding,
    "set_new_goods_bi_contents_no",
  );

  const wrongContentId = "8461402964";
  for (const [name, imageUrl] of [
    ["host", `https://gd.image-qoo10.jp.evil.example/li/963/402/${BI_CONTENTS_NO}.g_400-w-st_g.jpg`],
    ["content-id", qoo10MainImage(wrongContentId)],
    ["last-shard", qoo10MainImage(BI_CONTENTS_NO, "964", "402")],
    ["preceding-shard", qoo10MainImage(BI_CONTENTS_NO, "963", "403")],
    ["file-pattern", `https://gd.image-qoo10.jp/li/963/402/${BI_CONTENTS_NO}.png`],
    ["query", `${qoo10MainImage(BI_CONTENTS_NO)}?source=untrusted`],
  ] as const) {
    assert.equal(qoo10VerifiedListingRemoteState({
      ...base,
      resultObject: { ...providerReadback(), ImageUrl: imageUrl },
    }), null, name);
  }

  assert.equal(qoo10VerifiedListingRemoteState({
    ...base,
    operation: "listing.update",
  }), null, "BIContentsNo binding is create-only");
  const literal = qoo10VerifiedListingRemoteState({
    ...base,
    resultObject: providerReadback(),
    expectedRepresentativeImageContentId: undefined,
  });
  assert.ok(literal, "the canonical source URL remains an accepted exact literal readback");
  assert.equal(literal?.evidence.representativeImageBinding, "source_url_literal");
  assert.equal(literal?.evidence.representativeImageSourceUrlLiteralVerified, true);
  assert.equal(literal?.evidence.representativeImageContentIdVerified, undefined);
});

for (const [name, edit] of [
  ["approval revision", (value: Record<string, unknown>) => {
    (value.sellerpilotExternalDetail as Record<string, unknown>).approvalRevision = 8;
  }],
  ["English approval document", (value: Record<string, unknown>) => {
    const external = value.sellerpilotExternalDetail as Record<string, unknown>;
    (external.allLocaleDocumentSha256 as Record<string, unknown>).en = "4".repeat(64);
  }],
  ["dispatch place", (value: Record<string, unknown>) => {
    (value.sellerpilotQoo10CreateApprovalBinding as Record<string, unknown>).dispatchPlaceDigest = "5".repeat(64);
  }],
  ["return policy", (value: Record<string, unknown>) => {
    (value.sellerpilotQoo10CreateApprovalBinding as Record<string, unknown>).returnPolicyDigest = "6".repeat(64);
  }],
  ["sealed fulfillment evidence", (value: Record<string, unknown>) => {
    const evidence = value.sellerpilotQoo10CreateFulfillmentEvidence as Record<string, unknown>;
    evidence.returnPolicyId = "return-jp-2";
  }],
  ["category after approval", (value: Record<string, unknown>) => {
    (value.params as Record<string, unknown>).SecondSubCat = "999999999";
  }],
  ["shipping review after approval", (value: Record<string, unknown>) => {
    const assets = value.sellerpilotAssets as Record<string, unknown>;
    (assets.shipping as Record<string, unknown>).policyReview = "";
  }],
] as const) {
  test(`Qoo10 create approval binding fails closed on ${name} drift`, () => {
    const argumentsValue = structuredClone(strictArguments());
    edit(argumentsValue);
    const parsed = qoo10ListingCreateExpectation({ arguments: argumentsValue, payload });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(
      parsed.mismatchFields.includes("sellerpilotQoo10CreateApprovalBinding"),
      true,
    );
  });
}

test("Qoo10 create approval drift is rejected before any provider access", async () => {
  const argumentsValue = structuredClone(strictArguments());
  (argumentsValue.sellerpilotExternalDetail as Record<string, unknown>)
    .approvalRevision = 8;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ResultCode: 0 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload,
      arguments: argumentsValue,
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "qoo10-create-contract-preflight");
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 strict create rejects commerce, current field-name, active HTML, and asset-binding mismatches before provider access", async () => {
  for (const [name, argumentsValue] of [
    ["currency", strictArguments({ sellerpilotQoo10CreateContext: { ...(strictArguments().sellerpilotQoo10CreateContext as object), currency: "KRW" } })],
    ["price", strictArguments({ params: { ...(strictArguments().params as object), ItemPrice: "4999" } })],
    ["unsupported-currency-field", strictArguments({ params: { ...(strictArguments().params as object), Currency: "KRW" } })],
    ["stock", strictArguments({ params: { ...(strictArguments().params as object), ItemQty: "2" } })],
    ["invalid-expiry-date", strictArguments({ params: { ...(strictArguments().params as object), ExpireDate: "2027-02-30" } })],
    ["invalid-general-availability", strictArguments({ params: { ...(strictArguments().params as object), AvailableDateValue: "4" } })],
    ["legacy-adult-field", strictArguments({ params: { ...(strictArguments().params as object), AdultYN: undefined, AudultYN: "N" } })],
    ["japan-as-imported-origin", strictArguments({ params: { ...(strictArguments().params as object), ProductionPlaceType: "2", ProductionPlace: "JP" } })],
    ["invalid-manufacturer", strictArguments({ params: { ...(strictArguments().params as object), ManufactureNo: "maker-42" } })],
    ["invalid-brand", strictArguments({ params: { ...(strictArguments().params as object), BrandNo: "brand-84" } })],
    ["additional-option-not-supported", strictArguments({ params: { ...(strictArguments().params as object), AdditionalOption: "色||*赤||*0" } })],
    ["inventory-option-not-supported", strictArguments({ params: { ...(strictArguments().params as object), ItemType: "色||*赤||*0||*1||*RED" } })],
    ["active-html", strictArguments({ params: { ...(strictArguments().params as object), ItemDescription: `${detailHtml()}<script>alert(1)</script>` } })],
    ["representative-reused", strictArguments({ params: { ...(strictArguments().params as object), StandardImage: normalizedImage(1).publicUrl } })],
  ] as const) {
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return Response.json({ ResultCode: 0 });
    };
    try {
      const result = await executeChannelOperation({
        channel: "qoo10",
        operation: "listing.create",
        payload,
        arguments: argumentsValue,
        environment: "production",
      });
      assert.equal(result.ok, false, name);
      assert.equal(fetchCount, 0, name);
      assert.equal(result.steps[0]?.name, "qoo10-create-contract-preflight", name);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("Qoo10 listing.create without the strict publication contract is rejected before provider access", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ResultCode: 0 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload,
      arguments: { params: strictArguments().params },
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.equal(fetchCount, 0);
    assert.equal(operation.steps[0]?.name, "qoo10-create-contract-preflight");
    assert.equal(operation.steps[0]?.data.ResultMsg, "QOO10_CREATE_CONTEXT_INVALID");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 manual source preparation is intake-only until the exact approved eight-image binding replaces it", () => {
  const sourceOnlyArguments = strictArguments({
    sellerpilotContentMode: "manual_mvp",
    params: {
      ...(strictArguments().params as Record<string, unknown>),
      ItemDescription: '<section lang="ja-JP"><h2>販売者確認済み商品</h2><p>販売者が確認した商品の説明です。</p></section>',
    },
  });
  delete sourceOnlyArguments.sellerpilotPublicationAssetBinding;
  delete sourceOnlyArguments.sellerpilotQoo10CreateApprovalBinding;
  applyPreparedQoo10Images(
    sourceOnlyArguments,
    [normalizedImage(9).publicUrl],
    [normalizedImage(1).publicUrl],
    ["販売者確認済みの原本画像"],
  );
  const preparedHtml = String((sourceOnlyArguments.params as Record<string, unknown>).ItemDescription ?? "");
  assert.equal([...preparedHtml.matchAll(/<img\b/giu)].length, 1, "manual intake keeps its one explicit source image");

  const unbound = qoo10ListingCreateExpectation({
    arguments: sourceOnlyArguments,
    payload,
  });
  assert.equal(unbound.ok, false);
  if (unbound.ok) return;
  assert.equal(unbound.code, "QOO10_CREATE_CONTEXT_INVALID");
  assert.deepEqual(unbound.mismatchFields, [
    "sellerpilotQoo10CreateApprovalBinding",
    "sellerpilotPublicationAssetBinding",
  ]);

  const forgedBinding = qoo10ListingCreateExpectation({
    arguments: {
      ...sourceOnlyArguments,
      sellerpilotPublicationAssetBinding: publicationBinding(),
    },
    payload,
  });
  assert.equal(forgedBinding.ok, false);
  if (forgedBinding.ok) return;
  assert.equal(forgedBinding.code, "QOO10_CREATE_CONTEXT_INVALID");
  assert.deepEqual(forgedBinding.mismatchFields, ["sellerpilotQoo10CreateApprovalBinding"]);

  const approvedArguments = strictArguments({
    sellerpilotContentMode: "manual_mvp",
    params: {
      ...(strictArguments().params as Record<string, unknown>),
      ItemDescription: '<section lang="ja-JP"><h2>販売者確認済み商品</h2><p>承認された詳細画像で商品の内容をご案内します。</p></section>',
    },
  });
  applyPreparedQoo10Images(
    approvedArguments,
    [normalizedImage(9).publicUrl],
    roles.map((_role, index) => normalizedImage(index + 1).publicUrl),
    roles.map((_role, index) => `承認済み商品詳細 ${index + 1}`),
    roles,
  );
  const approvedExternal = approvedArguments.sellerpilotExternalDetail as Record<string, unknown>;
  const approvedExport = {
    title: approvedExternal.title,
    html: (approvedArguments.params as Record<string, unknown>).ItemDescription,
    plain: approvedExternal.plain,
    sections: approvedExternal.sections,
  };
  approvedExternal.html = approvedExport.html;
  approvedExternal.exportSha256 = externalDetailDigest(approvedExport);
  const reboundApprovedArguments = bindQoo10ListingCreateApproval(
    approvedArguments,
    fulfillmentEvidence(),
  );
  const approved = qoo10ListingCreateExpectation({ arguments: reboundApprovedArguments, payload });
  assert.equal(approved.ok, true, "the final prepared payload needs the exact eight-image binding");
});

test("Qoo10 verifies account-bound seller item, exact leaf category, and shipping setting before SetNewGoods, then verifies the exact live readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let createHeaders: Headers | null = null;
  let createBody: Record<string, string> | null = null;
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === "" && body.SellerCode) {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
      return Response.json({
        ResultCode: 0,
        ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: TEST_ITEM_SELLER_CODE },
      });
    }
    if (method === "CommonInfoLookup.GetCatagoryListAll") {
      return Response.json({
        ResultCode: 0,
        ResultObject: [{
          CATE_L_CD: "100000019",
          CATE_L_NM: "文具",
          CATE_M_CD: "200000146",
          CATE_M_NM: "文房具",
          CATE_S_CD: "320000542",
          CATE_S_NM: "クリップ・結束用品",
        }],
      });
    }
    if (method === "ItemsLookup.GetSellerDeliveryGroupInfo") {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsBasic.SetNewGoods") {
      createHeaders = new Headers(init?.headers);
      createBody = body;
      return Response.json({
        ResultCode: 0,
        ResultObject: { GdNo: ITEM_CODE, BIContentsNo: Number(BI_CONTENTS_NO) },
      });
    }
    if (method === "ItemsContents.EditGoodsContents") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === ITEM_CODE) {
      return Response.json({
        ResultCode: 0,
        ResultObject: { ...providerReadback(), ImageUrl: qoo10MainImage(BI_CONTENTS_NO) },
      });
    }
    return Response.json({ ResultCode: -9999, ResultMsg: "UNEXPECTED_TEST_CALL" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload,
      arguments: strictArguments(),
      environment: "production",
    });
    const createIndex = methods.indexOf("ItemsBasic.SetNewGoods");
    assert.ok(createIndex >= 3);
    assert.equal(methods.slice(0, createIndex).includes("ItemsLookup.GetItemDetailInfo"), true);
    assert.equal(methods.slice(0, createIndex).includes("CommonInfoLookup.GetCatagoryListAll"), true);
    assert.equal(methods.slice(0, createIndex).includes("ItemsLookup.GetSellerDeliveryGroupInfo"), true);
    assert.equal(createHeaders?.get("QAPIVersion"), "1.1");
    assert.equal(createHeaders?.get("GiosisCertificationKey"), payload.api_key);
    assert.deepEqual(
      Object.fromEntries([
        "SellerCode", "SecondSubCat", "ManufactureNo", "BrandNo", "ItemTitle",
        "ProductionPlaceType", "ProductionPlace", "RetailPrice", "ItemPrice", "ItemQty",
        "AvailableDateType", "AvailableDateValue", "AdditionalOption", "ItemType",
      ].map((key) => [key, createBody?.[key]])),
      Object.fromEntries([
        "SellerCode", "SecondSubCat", "ManufactureNo", "BrandNo", "ItemTitle",
        "ProductionPlaceType", "ProductionPlace", "RetailPrice", "ItemPrice", "ItemQty",
        "AvailableDateType", "AvailableDateValue", "AdditionalOption", "ItemType",
      ].map((key) => [key, (strictArguments().params as Record<string, string>)[key]])),
    );
    assert.equal(createBody?.SellerCode, SKU);
    assert.equal(createBody?.ItemPrice, String(QAPI_PRICE_JPY));
    assert.equal(createBody?.ItemQty, "1");
    assert.equal(result.ok, true);
    assert.equal(result.publicationFulfilled, true);
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.evidence.categoryVerified, true);
    assert.equal(
      result.steps.some((entry) =>
        entry.name === "qoo10-create-final-approval-freshness-prewrite"
        && entry.ok),
      true,
    );
    assert.equal(result.remoteState?.evidence.approvalRevision, 7);
    assert.equal(result.remoteState?.evidence.approvalPayloadDigestVerified, true);
    assert.equal(result.remoteState?.evidence.japaneseDocumentSha256, "e".repeat(64));
    assert.equal(result.remoteState?.evidence.englishDocumentSha256, "f".repeat(64));
    assert.match(String(result.remoteState?.evidence.dispatchPlaceDigest), /^[a-f0-9]{64}$/u);
    assert.match(String(result.remoteState?.evidence.returnPolicyDigest), /^[a-f0-9]{64}$/u);
    assert.match(String(result.remoteState?.evidence.fulfillmentEvidenceRevision), /^[a-f0-9]{64}$/u);
    assert.match(String(result.remoteState?.evidence.fulfillmentEvidenceDigest), /^[a-f0-9]{64}$/u);
    assert.equal(result.remoteState?.evidence.shippingVerified, true);
    assert.equal(result.remoteState?.evidence.priceQuantityVerified, true);
    assert.equal(result.remoteState?.evidence.retailPriceVerified, true);
    assert.equal(result.remoteState?.evidence.qapiRetailPriceJpy, QAPI_PRICE_JPY);
    assert.equal(result.remoteState?.evidence.representativeImageVerified, true);
    assert.equal(result.remoteState?.evidence.representativeImageBinding, "set_new_goods_bi_contents_no");
    assert.equal(result.remoteState?.evidence.representativeImageContentIdVerified, true);
    assert.equal(result.remoteState?.resources.qoo10MainImageContentId, BI_CONTENTS_NO);
    assert.equal(result.remoteState?.evidence.detailImageDigestVerified, true);
    assert.equal(result.remoteState?.evidence.publicationAssetDigestVerified, true);
    assert.match(String(result.remoteState?.evidence.sellerAccountIdentityDigest), /^[a-f0-9]{64}$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [name, createResultObject] of [
  ["missing GdNo", { ItemCode: ITEM_CODE }],
  ["malformed GdNo", { GdNo: "not-an-item-code" }],
  ["contradictory aliases", { GdNo: ITEM_CODE, ItemCode: "1234567891" }],
  ["scalar result", ITEM_CODE],
] as const) {
  test(`Qoo10 accepted create with ${name} requires reconciliation and performs no follow-up mutation`, async () => {
    const originalFetch = globalThis.fetch;
    const methods: string[] = [];
    globalThis.fetch = async (input, init) => {
      const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
      methods.push(method);
      if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === "" && body.SellerCode === SKU) {
        return Response.json({ ResultCode: 0, ResultObject: [] });
      }
      if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
        return Response.json({
          ResultCode: 0,
          ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: "ACCOUNT-BOUND-TEST-ITEM" },
        });
      }
      if (method === "CommonInfoLookup.GetCatagoryListAll") {
        return Response.json({
          ResultCode: 0,
          ResultObject: [{
            CATE_L_CD: "100000019",
            CATE_L_NM: "文具",
            CATE_M_CD: "200000146",
            CATE_M_NM: "文房具",
            CATE_S_CD: "320000542",
            CATE_S_NM: "クリップ・結束用品",
          }],
        });
      }
      if (method === "ItemsLookup.GetSellerDeliveryGroupInfo") {
        return Response.json({ ResultCode: 0, ResultObject: [] });
      }
      if (method === "ItemsBasic.SetNewGoods") {
        return Response.json({ ResultCode: 0, ResultObject: createResultObject });
      }
      throw new Error(`Unexpected follow-up call ${method}`);
    };
    try {
      const operation = await executeChannelOperation({
        channel: "qoo10",
        operation: "listing.create",
        payload,
        arguments: strictArguments(),
        environment: "production",
      });
      const identityStep = operation.steps.find(
        (item) => item.name === "qoo10-create-response-identity",
      );
      assert.equal(operation.ok, false);
      assert.equal(identityStep?.ok, false);
      assert.equal(
        identityStep?.data.sellerpilotVerification,
        "QOO10_CREATE_RESPONSE_IDENTITY_UNVERIFIED",
      );
      assert.equal(identityStep?.data.sellerpilotReconciliationRequired, true);
      assert.equal(identityStep?.data.sellerpilotAutomaticRetryAllowed, false);
      assert.equal(methods.filter((method) => method === "ItemsBasic.SetNewGoods").length, 1);
      assert.equal(methods.some((method) => method === "ItemsContents.EditGoodsContents"), false);
      assert.equal(methods.at(-1), "ItemsBasic.SetNewGoods");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("Qoo10 strict create exposes a sanitized provider rejection without follow-up mutation", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === "" && body.SellerCode === SKU) {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
      return Response.json({
        ResultCode: 0,
        ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: "ACCOUNT-BOUND-TEST-ITEM" },
      });
    }
    if (method === "CommonInfoLookup.GetCatagoryListAll") {
      return Response.json({
        ResultCode: 0,
        ResultObject: [{
          CATE_L_CD: "100000019",
          CATE_L_NM: "文具",
          CATE_M_CD: "200000146",
          CATE_M_NM: "文房具",
          CATE_S_CD: "320000542",
          CATE_S_NM: "クリップ・結束用品",
        }],
      });
    }
    if (method === "ItemsLookup.GetSellerDeliveryGroupInfo") {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsBasic.SetNewGoods") {
      return Response.json({
        ResultCode: -9999,
        ResultMsg: "ManufactureNo is invalid https://private.example/item?token=secret-value",
      });
    }
    throw new Error(`Unexpected follow-up call ${method}`);
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload,
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.match(operation.safeMessage, /ManufactureNo is invalid/u);
    assert.doesNotMatch(operation.safeMessage, /private\.example|secret-value/u);
    assert.equal(methods.filter((method) => method === "ItemsBasic.SetNewGoods").length, 1);
    assert.equal(methods.some((method) => method === "ItemsContents.EditGoodsContents"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 create preserves eight verified detail images and rolls back a mismatched CDN representative-image binding", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; status?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    calls.push({ method, ...(body.Status ? { status: body.Status } : {}) });
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === "" && body.SellerCode) {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
      return Response.json({
        ResultCode: 0,
        ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: "ACCOUNT-BOUND-TEST-ITEM" },
      });
    }
    if (method === "CommonInfoLookup.GetCatagoryListAll") {
      return Response.json({
        ResultCode: 0,
        ResultObject: [{
          CATE_L_CD: "100000019",
          CATE_L_NM: "文具",
          CATE_M_CD: "200000146",
          CATE_M_NM: "文房具",
          CATE_S_CD: "320000542",
          CATE_S_NM: "クリップ・結束用品",
        }],
      });
    }
    if (method === "ItemsLookup.GetSellerDeliveryGroupInfo") {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsBasic.SetNewGoods") {
      return Response.json({
        ResultCode: 0,
        ResultObject: { GdNo: ITEM_CODE, BIContentsNo: BI_CONTENTS_NO },
      });
    }
    if (method === "ItemsContents.EditGoodsContents") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === ITEM_CODE) {
      return Response.json({
        ResultCode: 0,
        ResultObject: { ...providerReadback(), ImageUrl: qoo10MainImage("8461402964") },
      });
    }
    if (method === "ItemsBasic.EditGoodsStatus") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    return Response.json({ ResultCode: -9999, ResultMsg: "UNEXPECTED_TEST_CALL" });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload,
      arguments: strictArguments(),
      environment: "production",
    });
    const detailStep = operation.steps.find((item) => item.name === "detail-image-readback");
    const publicationStep = operation.steps.find(
      (item) => item.name === "GetItemDetailInfo-publication-readback",
    );
    const publicationChecks = publicationStep?.data.sellerpilotPublicationChecks as
      | Record<string, boolean>
      | undefined;

    assert.equal(operation.ok, false);
    assert.equal(operation.remoteId, ITEM_CODE);
    assert.equal(detailStep?.ok, true);
    assert.equal(detailStep?.data.ResultMsg, "DETAIL_IMAGES_VERIFIED");
    assert.equal(detailStep?.data.detailImageCount, 8);
    assert.equal(publicationStep?.ok, false);
    assert.equal(publicationStep?.data.ResultMsg, "QOO10_PUBLICATION_STATE_UNVERIFIED");
    assert.equal(publicationStep?.data.actualImageCount, 8);
    assert.equal(publicationStep?.data.providerStatus, "S2");
    assert.equal(publicationChecks?.imageCountVerified, true);
    assert.equal(publicationChecks?.categoryVerified, true);
    assert.equal(publicationChecks?.representativeImageVerified, false);
    assert.equal(operation.steps.some(
      (item) => item.data.ResultMsg === "QOO10_DETAIL_IMAGE_READBACK_MISSING",
    ), false);
    assert.match(operation.safeMessage, /GetItemDetailInfo-publication-readback: QOO10_PUBLICATION_STATE_UNVERIFIED/u);
    assert.equal(operation.steps.at(-1)?.name, "rollback-missing-detail");
    assert.equal(operation.steps.at(-1)?.ok, true);
    assert.deepEqual(calls.at(-1), { method: "ItemsBasic.EditGoodsStatus", status: "1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 create never treats eight images from a failed readback plus rollback as publication success", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; status?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    calls.push({ method, ...(body.Status ? { status: body.Status } : {}) });
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === "" && body.SellerCode) {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
      return Response.json({
        ResultCode: 0,
        ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: "ACCOUNT-BOUND-TEST-ITEM" },
      });
    }
    if (method === "CommonInfoLookup.GetCatagoryListAll") {
      return Response.json({
        ResultCode: 0,
        ResultObject: [{
          CATE_L_CD: "100000019",
          CATE_L_NM: "文具",
          CATE_M_CD: "200000146",
          CATE_M_NM: "文房具",
          CATE_S_CD: "320000542",
          CATE_S_NM: "クリップ・結束用品",
        }],
      });
    }
    if (method === "ItemsLookup.GetSellerDeliveryGroupInfo") {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsBasic.SetNewGoods") {
      return Response.json({
        ResultCode: 0,
        ResultObject: { GdNo: ITEM_CODE, BIContentsNo: BI_CONTENTS_NO },
      });
    }
    if (method === "ItemsContents.EditGoodsContents") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === ITEM_CODE) {
      return Response.json({
        ResultCode: -9999,
        ResultMsg: "READBACK_FAILED",
        // A malformed provider error must not become success merely because a
        // stale payload still contains the expected eight image elements.
        ResultObject: { ...providerReadback(), ImageUrl: qoo10MainImage(BI_CONTENTS_NO) },
      });
    }
    if (method === "ItemsBasic.EditGoodsStatus") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    return Response.json({ ResultCode: -9999, ResultMsg: "UNEXPECTED_TEST_CALL" });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload,
      arguments: strictArguments(),
      environment: "production",
    });
    const detailStep = operation.steps.find((item) => item.name === "detail-image-readback");
    const publicationStep = operation.steps.find(
      (item) => item.name === "GetItemDetailInfo-publication-readback",
    );

    assert.equal(operation.ok, false);
    assert.notEqual(operation.publicationFulfilled, true);
    assert.equal(detailStep?.ok, false);
    assert.equal(detailStep?.data.ResultMsg, "QOO10_DETAIL_IMAGE_READBACK_MISSING");
    assert.equal(detailStep?.data.detailImageCount, 8);
    assert.equal(publicationStep?.ok, false);
    assert.equal(publicationStep?.data.sellerpilotProviderResultMessage, "READBACK_FAILED");
    assert.equal(operation.steps.at(-1)?.name, "rollback-missing-detail");
    assert.equal(operation.steps.at(-1)?.ok, true);
    assert.deepEqual(calls.at(-1), { method: "ItemsBasic.EditGoodsStatus", status: "1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 category ambiguity fails closed after read-only preflight and never calls a mutation", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === "" && body.SellerCode) {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
      return Response.json({ ResultCode: 0, ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: "BOUND" } });
    }
    if (method === "CommonInfoLookup.GetCatagoryListAll") {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    return Response.json({ ResultCode: 0, ResultObject: [] });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload,
      arguments: strictArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(methods.length, 4);
    assert.equal(methods.some((method) => method === "ItemsBasic.SetNewGoods" || method === "ItemsContents.EditGoodsContents"), false);
    assert.equal(result.steps.find((step) => step.name === "qoo10-leaf-category-preflight")?.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin create route injects the server-owned Qoo10 product/SKU/JPY/stock context before fingerprinting", async () => {
  const source = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const contextIndex = source.indexOf("buildQoo10ListingCreateContext({");
  const bindingIndex = source.indexOf("sellerpilotQoo10CreateContext: qoo10CreateContext");
  const fingerprintIndex = source.indexOf("const fingerprintArguments =");
  assert.ok(contextIndex > 0);
  assert.ok(bindingIndex > contextIndex);
  assert.ok(fingerprintIndex > bindingIndex);
  assert.match(source.slice(contextIndex, fingerprintIndex), /product:\s*verifiedPublishContext\?\.product/);
  assert.match(source.slice(contextIndex, fingerprintIndex), /manualFields:\s*verifiedPublishContext\?\.manualFields/);
  assert.match(source.slice(contextIndex, fingerprintIndex), /market:\s*parsed\.data\.market/);
  assert.match(source.slice(contextIndex, fingerprintIndex), /currency:\s*effectiveCurrency/);
  assert.match(source.slice(contextIndex, fingerprintIndex), /price:\s*effectivePrice/);
});

test("durable route source is bound into the actual preflight and CAS runs immediately before SetNewGoods", async () => {
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  const capture = sealQoo10QsmCreateFulfillmentCapture({
    contract: qoo10QsmCreateFulfillmentCaptureContract,
    collector: qoo10QsmCreateFulfillmentCollector,
    trustBoundary: qoo10QsmCreateFulfillmentTrustBoundary,
    browser: { name: "Chrome", family: "chrome", type: "extension", profileName: "CHANGHEE" },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    authenticatedSellerId: SELLER_ID,
    testItemCode: TEST_ITEM_CODE,
    testItemSellerCode: TEST_ITEM_SELLER_CODE,
    observedAt,
    dispatchPlaces: [{
      id: "dispatch-jp-1", active: true,
      payload: { label: "dispatch", countryCode: "JP", postalCode: "1000001", addressLine1: "Tokyo" },
    }],
    returnPolicies: [{
      id: "return-jp-1", active: true,
      payload: {
        label: "returns", returnWindowDays: 7, returnShippingPaidBy: "buyer",
      },
    }],
  });
  let takeCalls = 0;
  const argumentsValue = await bindQoo10ListingCreateApprovalFromDurableSource({
    rpc: async (name, parameters) => {
      takeCalls += 1;
      assert.equal(name, "sellerpilot_service_take_qoo10_create_fulfillment_capture");
      assert.deepEqual(parameters, {
        p_owner_id: OWNER_ID,
        p_product_id: PRODUCT_ID,
        p_credential_id: CREDENTIAL_ID,
        p_credential_version: 7,
        p_market: "JP",
        p_target_id: "Japan · QAPI",
      });
      return {
        error: null,
        data: {
          contract: "sellerpilot_qoo10_durable_create_fulfillment_source_v1",
          sourceId: "60000000-0000-4000-8000-000000000001",
          ownerId: OWNER_ID,
          productId: PRODUCT_ID,
          credentialId: CREDENTIAL_ID,
          credentialVersion: 7,
          sellerId: SELLER_ID,
          market: "JP",
          targetId: "Japan · QAPI",
          testItemCode: TEST_ITEM_CODE,
          testItemSellerCode: TEST_ITEM_SELLER_CODE,
          dispatchPlaceId: "dispatch-jp-1",
          returnPolicyId: "return-jp-1",
          sourceRevision: capture.sourceRevision,
          captureDigest: capture.captureDigest,
          observedAt,
          expiresAt: new Date(Date.parse(observedAt) + 300_000).toISOString(),
          consumedAt: new Date().toISOString(),
          capture,
        },
      };
    },
    ownerId: OWNER_ID,
    productId: PRODUCT_ID,
    credentialId: CREDENTIAL_ID,
    credentialVersion: 7,
    market: "JP",
    targetId: "Japan · QAPI",
    argumentsValue: strictArguments(),
  });
  assert.equal(takeCalls, 1);

  const sequence: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    sequence.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === "" && body.SellerCode === SKU) {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
      return Response.json({ ResultCode: 0, ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: TEST_ITEM_SELLER_CODE } });
    }
    if (method === "CommonInfoLookup.GetCatagoryListAll") {
      return Response.json({ ResultCode: 0, ResultObject: [{
        CATE_L_CD: "100000019", CATE_L_NM: "文具", CATE_M_CD: "200000146",
        CATE_M_NM: "文房具", CATE_S_CD: "320000542", CATE_S_NM: "クリップ・結束用品",
      }] });
    }
    if (method === "ItemsLookup.GetSellerDeliveryGroupInfo") {
      return Response.json({ ResultCode: 0, ResultObject: [] });
    }
    if (method === "ItemsBasic.SetNewGoods") {
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: ITEM_CODE, BIContentsNo: Number(BI_CONTENTS_NO) } });
    }
    if (method === "ItemsContents.EditGoodsContents") return Response.json({ ResultCode: 0 });
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === ITEM_CODE) {
      return Response.json({ ResultCode: 0, ResultObject: { ...providerReadback(), ImageUrl: qoo10MainImage(BI_CONTENTS_NO) } });
    }
    return Response.json({ ResultCode: -9999, ResultMsg: "UNEXPECTED_TEST_CALL" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10", operation: "listing.create", payload,
      arguments: argumentsValue, environment: "production",
      providerMutationHooks: {
        assertLeaseHealthy: async () => {},
        begin: async () => {
          await assertQoo10CreateFulfillmentMutationFence({
            rpc: async (name, parameters) => {
              assert.equal(name, "sellerpilot_service_fence_qoo10_create_fulfillment_v2");
              assert.equal(parameters.p_product_id, PRODUCT_ID);
              assert.equal(parameters.p_credential_id, CREDENTIAL_ID);
              sequence.push("QSM_CAPTURE_CAS");
              return { data: true, error: null };
            },
            argumentsValue,
            ownerId: OWNER_ID,
            productId: PRODUCT_ID,
            credentialId: CREDENTIAL_ID,
            market: "JP",
            targetId: "Japan · QAPI",
          });
        },
      },
    });
    assert.equal(result.ok, true);
    assert.ok(sequence.indexOf("QSM_CAPTURE_CAS") > sequence.indexOf("ItemsLookup.GetSellerDeliveryGroupInfo"));
    assert.equal(sequence.indexOf("ItemsBasic.SetNewGoods"), sequence.indexOf("QSM_CAPTURE_CAS") + 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("independent Qoo10 publication reverification re-attests the seller account item and exact representative/detail digests", async () => {
  const argumentsValue = strictArguments();
  const parsed = qoo10ListingCreateExpectation({ arguments: argumentsValue, payload });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const sellerIdentityRemote = {
    response: Response.json({}),
    text: "",
    data: { ResultCode: 0, ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: "ACCOUNT-BOUND-TEST-ITEM" } },
  };
  const sellerIdentity = qoo10SellerAccountIdentityDigestFromReadback({
    remote: sellerIdentityRemote,
    expectation: parsed.expectation,
  });
  assert.ok(sellerIdentity.identityDigest);
  const publicationAssetBinding = listingPublicationProviderAssetEvidence({
    channel: "qoo10",
    remoteId: ITEM_CODE,
    sourceArguments: argumentsValue,
    providerArguments: argumentsValue,
  });
  assert.ok(publicationAssetBinding);
  const sourceJobId = "40000000-0000-4000-8000-000000000001";
  const source = {
    contract: "listing_publication_verification_source_v1",
    verificationJobId: "50000000-0000-4000-8000-000000000001",
    sourceJobId,
    sourceOperation: "listing.create",
    sourceArguments: argumentsValue,
    sourceResponsePayload: {
      steps: [
        {
          name: "SetNewGoods",
          ok: true,
          status: 200,
          data: {
            ResultCode: 0,
            ResultObject: { GdNo: ITEM_CODE, BIContentsNo: Number(BI_CONTENTS_NO) },
          },
        },
        {
          name: "GetItemDetailInfo-publication-readback",
          ok: true,
          status: 200,
          data: {
            ResultCode: 0,
            ResultObject: { ...providerReadback(), ImageUrl: qoo10MainImage(BI_CONTENTS_NO) },
          },
        },
      ],
      remoteState: {
        evidence: {
          publicationAssetBinding,
          sellerAccountIdentityDigest: sellerIdentity.identityDigest,
        },
        resources: { itemCode: ITEM_CODE, sellerCode: SKU },
      },
    },
    sourceFingerprint: FINGERPRINT,
    expectedRemoteId: ITEM_CODE,
    expectedLocale: "ja-JP",
    expectedImageCount: 8,
    market: "JP",
    targetId: "JP",
  };
  const originalFetch = globalThis.fetch;
  const readItems: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    readItems.push(body.ItemCode);
    return body.ItemCode === TEST_ITEM_CODE
      ? Response.json(sellerIdentityRemote.data)
      : Response.json({
          ResultCode: 0,
          ResultObject: { ...providerReadback(), ImageUrl: qoo10MainImage(BI_CONTENTS_NO) },
        });
  };
  try {
    const execution = await executeListingPublicationVerification({
      channel: "qoo10",
      operation: "listing.publication.verify",
      payload,
      environment: "production",
      arguments: {
        publicationReviewSourceJobId: sourceJobId,
        sellerpilotReadOnly: true,
        remoteId: ITEM_CODE,
        market: "JP",
        targetId: "JP",
        publicationIntent: "live",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ja-JP",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 8,
        sellerpilotPublicationSource: source,
      },
    });
    assert.deepEqual(readItems.sort(), [ITEM_CODE, TEST_ITEM_CODE].sort());
    assert.equal(execution.steps.every((step) => step.ok), true);
    assert.equal(execution.remoteState?.evidence.representativeImageVerified, true);
    assert.equal(execution.remoteState?.evidence.representativeImageBinding, "set_new_goods_bi_contents_no");
    assert.equal(execution.remoteState?.resources.qoo10MainImageContentId, BI_CONTENTS_NO);
    assert.equal(execution.remoteState?.evidence.detailImageDigestVerified, true);
    assert.equal(execution.remoteState?.evidence.sourceContentVerified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [name, data, accepted, httpStatus] of [
  ["normal empty", { ResultCode: 0, ResultObject: [] }, true, 200],
  ["documented missing", { ResultCode: -10001, ResultObject: null }, true, 200],
  ["documented missing no object", { ResultCode: "-10001" }, true, 200],
  ["existing item", { ResultCode: 0, ResultObject: [{ ItemCode: ITEM_CODE, SellerCode: SKU }] }, false, 200],
  ["missing success code", { ResultObject: [] }, false, 200],
  ["malformed success", { ResultCode: 0, ResultObject: {} }, false, 200],
  ["contradictory missing", { ResultCode: -10001, ResultObject: [{ ItemCode: ITEM_CODE }] }, false, 200],
  ["conflicting code", { ResultCode: -10001, ErrorCode: 0 }, false, 200],
  ["auth expired", { ResultCode: -90004, ResultObject: [] }, false, 200],
  ["permission denied", { ResultCode: -90002, ResultObject: [] }, false, 200],
  ["HTTP error", { ResultCode: -10001 }, false, 403],
] as const) {
  test(`Qoo10 SellerCode absence: ${name}`, () => {
    const value = structuredClone(data);
    assert.equal(qoo10SellerCodeAbsent({ data: value, text: "", response: Response.json(value, { status: httpStatus }) }), accepted);
  });
}

for (const scenario of ["existing", "missing-code", "auth", "timeout"] as const) {
  test(`Qoo10 create ${scenario} lookup prevents all mutations`, async () => {
    const original = globalThis.fetch;
    const methods: string[] = [];
    globalThis.fetch = async (input, init) => {
      const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
      const body = JSON.parse(String(init?.body ?? "{}"));
      methods.push(method);
      if (method === "ItemsLookup.GetItemDetailInfo" && body.SellerCode === SKU && body.ItemCode === "") {
        if (scenario === "timeout") throw new TypeError("timed out");
        return Response.json(scenario === "existing" ? { ResultCode: 0, ResultObject: [{ ItemCode: ITEM_CODE, SellerCode: SKU }] }
          : scenario === "auth" ? { ResultCode: -90004 } : { ResultObject: [] });
      }
      if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === TEST_ITEM_CODE) {
        return Response.json({ ResultCode: 0, ResultObject: { ItemNo: TEST_ITEM_CODE, SellerCode: "BOUND" } });
      }
      if (method === "CommonInfoLookup.GetCatagoryListAll") return Response.json({ ResultCode: 0,
        ResultObject: [{ CATE_L_CD: "100000019", CATE_M_CD: "200000146", CATE_S_CD: "320000542" }] });
      if (method === "ItemsLookup.GetSellerDeliveryGroupInfo") return Response.json({ ResultCode: 0, ResultObject: [] });
      throw new Error(`Unexpected mutation ${method}`);
    };
    try {
      const operation = await executeChannelOperation({ channel: "qoo10", operation: "listing.create", payload,
        arguments: strictArguments(), environment: "production" });
      assert.equal(operation.ok, false);
      assert.equal(operation.steps.find(step => step.name === "qoo10-seller-code-absence-preflight")?.ok, false);
      assert.equal(methods.length, 4);
      assert.equal(methods.some(method => /SetNewGoods|EditGoods/.test(method)), false);
    } finally { globalThis.fetch = original; }
  });
}
