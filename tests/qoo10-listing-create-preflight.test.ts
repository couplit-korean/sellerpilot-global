import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { listingPublicationProviderAssetEvidence } from "../lib/channels/listing-publication-content";
import { executeListingPublicationVerification } from "../lib/channels/listing-publication-verification";
import { qoo10VerifiedListingRemoteState } from "../lib/channels/qoo10-listing-publication";
import {
  buildQoo10ListingCreateContext,
  qoo10ListingCreateExpectation,
  qoo10ListingCreateContextContract,
  qoo10SellerAccountIdentityDigestFromReadback,
} from "../lib/channels/qoo10-listing-create-preflight";

const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000001";
const CLAIM_ID = "30000000-0000-4000-8000-000000000001";
const SKU = "QA-20260823-CC-001";
const ITEM_CODE = "1234567890";
const TEST_ITEM_CODE = "1098765432";
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

function normalizedImage(index: number) {
  const contentSha256 = imageDigest(index);
  const objectPath = `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
  return {
    publicUrl: `https://qa-project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256,
  };
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
    RetailPrice: String(QAPI_PRICE_JPY),
    ItemPrice: String(QAPI_PRICE_JPY),
    TaxRate: "S",
    ItemQty: "1",
    ExpireDate: "2027-08-30",
    ShippingNo: "0",
    AvailableDateType: "0",
    AvailableDateValue: "3",
  };
  return {
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
    sellerpilotPublicationAssetBinding: publicationBinding(),
    params,
    ...overrides,
  };
}

const payload = {
  api_key: "test-key",
  seller_id: "seller-qa-account",
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
    ShippingNo: params.ShippingNo,
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
  assert.equal(parsed.expectation.context.market, "JP");
  assert.equal(parsed.expectation.context.locale, "ja-JP");
  assert.equal(parsed.expectation.context.sourceCurrency, "KRW");
  assert.equal(parsed.expectation.context.sourcePrice, SOURCE_PRICE_KRW);
  assert.equal(parsed.expectation.context.currency, "JPY");
  assert.equal(parsed.expectation.price, QAPI_PRICE_JPY);
  assert.equal(parsed.expectation.quantity, 1);
  assert.equal(parsed.expectation.detailImageUrls.length, 8);
  assert.equal(new Set([
    parsed.expectation.standardImageDigest,
    ...parsed.expectation.detailImageDigests,
  ]).size, 9);
});

test("Qoo10 strict live readback independently rejects category, shipping, price, stock, representative image, and detail digest drift", () => {
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
    ["ShippingNo", "42"],
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

test("Qoo10 strict create rejects commerce, current field-name, active HTML, and asset-binding mismatches before provider access", async () => {
  for (const [name, argumentsValue] of [
    ["currency", strictArguments({ sellerpilotQoo10CreateContext: { ...(strictArguments().sellerpilotQoo10CreateContext as object), currency: "KRW" } })],
    ["price", strictArguments({ params: { ...(strictArguments().params as object), ItemPrice: "4999" } })],
    ["unsupported-currency-field", strictArguments({ params: { ...(strictArguments().params as object), Currency: "KRW" } })],
    ["stock", strictArguments({ params: { ...(strictArguments().params as object), ItemQty: "2" } })],
    ["legacy-adult-field", strictArguments({ params: { ...(strictArguments().params as object), AdultYN: undefined, AudultYN: "N" } })],
    ["japan-as-imported-origin", strictArguments({ params: { ...(strictArguments().params as object), ProductionPlaceType: "2", ProductionPlace: "JP" } })],
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

test("Qoo10 verifies account-bound seller item, exact leaf category, and shipping setting before SetNewGoods, then verifies the exact live readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    methods.push(method);
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
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: ITEM_CODE } });
    }
    if (method === "ItemsContents.EditGoodsContents") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    if (method === "ItemsLookup.GetItemDetailInfo" && body.ItemCode === ITEM_CODE) {
      return Response.json({ ResultCode: 0, ResultObject: providerReadback() });
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
    assert.equal(result.ok, true);
    assert.equal(result.publicationFulfilled, true);
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.evidence.categoryVerified, true);
    assert.equal(result.remoteState?.evidence.shippingVerified, true);
    assert.equal(result.remoteState?.evidence.priceQuantityVerified, true);
    assert.equal(result.remoteState?.evidence.representativeImageVerified, true);
    assert.equal(result.remoteState?.evidence.detailImageDigestVerified, true);
    assert.equal(result.remoteState?.evidence.publicationAssetDigestVerified, true);
    assert.match(String(result.remoteState?.evidence.sellerAccountIdentityDigest), /^[a-f0-9]{64}$/u);
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
    assert.equal(methods.length, 3);
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
      steps: [{
        name: "GetItemDetailInfo-publication-readback",
        ok: true,
        status: 200,
        data: { ResultCode: 0, ResultObject: providerReadback() },
      }],
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
      : Response.json({ ResultCode: 0, ResultObject: providerReadback() });
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
    assert.equal(execution.remoteState?.evidence.detailImageDigestVerified, true);
    assert.equal(execution.remoteState?.evidence.sourceContentVerified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
