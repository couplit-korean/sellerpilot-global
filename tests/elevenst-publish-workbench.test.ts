import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelArguments, normalizeManualFields } from "../app/product-publish-workbench";
import { validateElevenstListingProduct } from "../lib/channels/elevenst-listing";
import { inspectListingDraft } from "../lib/channels/listing-preflight";
import { channelRegistrationFields, applyRegistrationPatches } from "../lib/channel-registration-form";

type WorkbenchContext = Parameters<typeof buildChannelArguments>[1];

function publishContext(input: {
  categoryId?: string;
  sellerSku?: string;
  brandName?: string;
  providedAttributes?: Record<string, string>;
} = {}): WorkbenchContext {
  const categoryId = input.categoryId ?? "1341821";
  const sellerSku = input.sellerSku ?? "CABLE-ORGANIZER-001";
  return {
    product: {
      id: "product-001",
      externalCode: "source-001",
      sku: sellerSku,
      name: "부착형 케이블 정리 클립 6개 세트",
      description: "책상과 벽면에 부착해 케이블을 정리하는 클립입니다.",
      sourceUrl: "https://example.com/source",
      status: "ready",
    },
    manualFields: {
      productName: "부착형 케이블 정리 클립 6개 세트",
      description: "책상과 벽면에 부착해 케이블을 정리하는 클립입니다.",
      sellerSku,
      categoryHint: "케이블 정리소품",
      brandName: input.brandName ?? "Couplit",
      manufacturer: "Couplit 공급처",
      countryOfOrigin: "대한민국",
      material: "실리콘",
      packageContents: "상품 1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 10_000,
      shippingFeeKrw: 0,
      currency: "KRW",
      stock: 2,
      weightKg: 0.2,
      packageLengthCm: 12,
      packageWidthCm: 8,
      packageHeightCm: 3,
    },
    imageSpecs: [],
    assignments: [{
      channel: "elevenst",
      market: "KR",
      categoryId,
      categoryPath: ["생활잡화", "정리소품", "케이블 정리소품"],
      providedAttributes: input.providedAttributes ?? {},
      status: "confirmed",
      confirmedAt: "2026-08-25T00:00:00.000Z",
    }],
    listings: [],
    sourceImages: [{ path: "source/product.jpg", url: "https://cdn.example.com/product.jpg" }],
    generatedImages: [
      { id: "square", path: "generated/square.jpg", url: "https://cdn.example.com/square.jpg" },
      { id: "hero", path: "generated/hero.jpg", url: "https://cdn.example.com/hero.jpg" },
      { id: "portrait", path: "generated/portrait.jpg", url: "https://cdn.example.com/portrait.jpg" },
      { id: "wide", path: "generated/wide.jpg", url: "https://cdn.example.com/wide.jpg" },
    ],
    localizedListings: [],
  };
}

function elevenstDraft(context: WorkbenchContext) {
  return buildChannelArguments(
    "elevenst",
    context,
    10_000,
    2,
    undefined,
    { weight: 0.2, length: 12, width: 8, height: 3 },
    10,
  ) as unknown as { sellerpilotAssets: Record<string, unknown>; product: Record<string, unknown> };
}

test("AI galleries use generated assets only and never fall back to analysis source photos", () => {
  const context = publishContext();
  const originalSources = structuredClone(context.sourceImages);
  const generatedUrls = context.generatedImages.map(image => image.url);
  const assets = elevenstDraft(context).sellerpilotAssets;
  assert.equal((assets.galleryImageUrls as string[]).length, 4);
  assert.equal((assets.galleryImageUrls as string[]).every(url => generatedUrls.includes(url)), true);
  assert.doesNotMatch(JSON.stringify(assets.galleryImageUrls), /product\.jpg/);
  context.generatedImages = [];
  assert.deepEqual(elevenstDraft(context).sellerpilotAssets.galleryImageUrls, []);
  context.contentMode = "manual_mvp";
  assert.deepEqual(elevenstDraft(context).sellerpilotAssets.galleryImageUrls, originalSources.map(image => image.url));
  assert.deepEqual(context.sourceImages, originalSources);
});

const processedFoodAttributes: Record<string, string> = {
  "notification:176400445": "롯데웰푸드㈜ / 대한민국",
  "notification:176398001": "제품 별도 표기일까지",
  "notification:42154823": "해당사항 없음",
  "notification:23757260": "해당사항 없음",
  "notification:23757095": "총 내용량 315g, 100g당 500kcal",
  "notification:176312674": "우유 함유",
  "notification:23756754": "080-024-6060",
  "notification:23757245": "밀가루(밀:미국산), 설탕",
  "notification:42155152": "315g(6봉입)",
  "notification:23757000": "과자",
};

test("11st normal production SKU uses the verified 1341821 notice and non-regulated certification contract", () => {
  const draft = elevenstDraft(publishContext({ sellerSku: "CABLE-ORGANIZER-001" }));
  const notification = draft.product.ProductNotification as { type: string; item: Array<{ code: string; name: string }> };
  const certificationGroups = draft.product.ProductCertGroup as Array<{ crtfGrpTypCd: string; crtfGrpObjClfCd: string }>;

  assert.equal(Object.hasOwn(draft, "verificationOnly"), false);
  assert.equal(draft.product.dispCtgrNo, "1341821");
  assert.equal(notification.type, "891045");
  assert.deepEqual(notification.item.map((item) => item.code), ["11800", "11905", "23760413", "23759100", "23756033"]);
  assert.deepEqual(certificationGroups.map((group) => `${group.crtfGrpTypCd}:${group.crtfGrpObjClfCd}`), ["01:03", "02:03", "03:03", "04:05"]);
  assert.doesNotThrow(() => validateElevenstListingProduct(draft.product));
});

test("11st processed-food leaf maps the official 891031 notice fields without changing the cable contract", () => {
  const draft = elevenstDraft(publishContext({
    categoryId: "1346631",
    sellerSku: "FOOD-001",
    providedAttributes: processedFoodAttributes,
  }));
  const notification = draft.product.ProductNotification as { type: string; item: Array<{ code: string; name: string }> };

  assert.equal(notification.type, "891031");
  assert.deepEqual(notification.item.map((item) => item.code), [
    "176400445", "176398001", "42154823", "23757260", "23757095", "176312674",
    "176317774", "23756754", "23757245", "42155152", "23757000",
  ]);
  assert.equal(notification.item.find((item) => item.code === "176317774")?.name, "부착형 케이블 정리 클립 6개 세트");
  assert.deepEqual(inspectListingDraft("elevenst", draft).filter((item) => item.status === "manual").map(item => item.key), ["elevenst-addrSeqOut", "elevenst-addrSeqIn"]);
  assert.doesNotThrow(() => validateElevenstListingProduct(draft.product));

  const cableDraft = elevenstDraft(publishContext());
  assert.deepEqual((cableDraft.product.ProductNotification as { item: Array<{ code: string }> }).item.map((item) => item.code), [
    "11800", "11905", "23760413", "23759100", "23756033",
  ]);
});

test("11st cider food notices are editable by official labels, preserve category and never invent missing facts", () => {
  const context = publishContext({ categoryId: "1009792", providedAttributes: processedFoodAttributes });
  context.manualFields.productName = "나랑드사이다 제로 500ml 1병";
  const draft = elevenstDraft(context);
  assert.equal(draft.product.dispCtgrNo, "1009792");
  assert.doesNotThrow(() => validateElevenstListingProduct(draft.product));
  const fields = channelRegistrationFields("elevenst", draft, inspectListingDraft("elevenst", draft));
  const notices = fields.filter(field => field.label.startsWith("가공식품 고시 ·"));
  assert.equal(notices.length, 11);
  assert.equal(fields.some(field => field.path.includes("ProductCertGroup") || field.path.includes("ProductNotification") && ["code", "type"].includes(field.path.at(-1)!)), false);
  const ingredients = notices.find(field => field.label.includes("원재료명"))!;
  const changed = applyRegistrationPatches(draft, [{ path: ingredients.path, value: "라벨에서 확인한 원재료" }]);
  assert.equal((changed.product as typeof draft.product).dispCtgrNo, "1009792");
  const notice = (changed.product as typeof draft.product).ProductNotification as {type:string;item:Array<{code:string;name:string}>};
  assert.equal(notice.type, "891031");
  assert.equal(notice.item.find(item => item.code === "23757245")?.name, "라벨에서 확인한 원재료");
  assert.doesNotThrow(() => validateElevenstListingProduct(changed.product));
  const missing = elevenstDraft(publishContext({ categoryId: "1009792" }));
  assert.equal(inspectListingDraft("elevenst", missing).filter(field => field.key.startsWith("food-notice-") && field.status === "manual").length, 10);
  assert.throws(() => validateElevenstListingProduct(missing.product));
});

test("11st processed-food preflight exposes and blocks unconfirmed expiry, GMO, nutrition, and phone", () => {
  const providedAttributes = { ...processedFoodAttributes };
  delete providedAttributes["notification:176398001"];
  delete providedAttributes["notification:23757260"];
  delete providedAttributes["notification:23757095"];
  delete providedAttributes["notification:23756754"];
  const draft = elevenstDraft(publishContext({ categoryId: "1346631", providedAttributes }));
  const notification = draft.product.ProductNotification as { item: Array<{ code: string; name: string }> };
  const requirements = inspectListingDraft("elevenst", draft);

  for (const code of ["176398001", "23757260", "23757095", "23756754"]) {
    assert.equal(notification.item.find((item) => item.code === code)?.name, "");
    const requirement = requirements.find((item) => item.key === `food-notice-${code}`);
    assert.equal(requirement?.status, "manual");
    assert.match(requirement?.help ?? "", /추정하지 않습니다/);
  }
  assert.throws(() => validateElevenstListingProduct(draft.product), /ELEVENST_CONTRACT_FIELD_INVALID:name/);
});

test("11st processed-food preflight rejects explicit unknown placeholders", () => {
  const draft = elevenstDraft(publishContext({
    categoryId: "1346631",
    providedAttributes: { ...processedFoodAttributes, "notification:176398001": "판매자 확인 필요" },
  }));

  assert.equal(inspectListingDraft("elevenst", draft).find((item) => item.key === "food-notice-176398001")?.status, "manual");
  assert.throws(() => validateElevenstListingProduct(draft.product), /ELEVENST_CONTRACT_PLACEHOLDER_REJECTED:name/);
});

test("11st category contract no longer depends on a QA-prefixed seller SKU", () => {
  const production = elevenstDraft(publishContext({ sellerSku: "CABLE-ORGANIZER-001" }));
  const qaPrefixed = elevenstDraft(publishContext({ sellerSku: "QA-CABLE-ORGANIZER-001" }));

  assert.equal(Object.hasOwn(production, "verificationOnly"), false);
  assert.equal(Object.hasOwn(qaPrefixed, "verificationOnly"), false);
  assert.deepEqual(qaPrefixed.product.ProductNotification, production.product.ProductNotification);
  assert.deepEqual(qaPrefixed.product.ProductCertGroup, production.product.ProductCertGroup);
});

test("11st categories outside the verified leaves cannot inherit guessed notice or certification metadata", () => {
  const draft = elevenstDraft(publishContext({
    categoryId: "1341822",
    providedAttributes: {
      notificationType: "891045",
      "notification:11800": "추정 상품명",
      "notification:11905": "추정 제조사",
      "notification:23760413": "추정 문의처",
      "notification:23759100": "추정 원산지",
      "notification:23756033": "추정 기타사항",
    },
  }));
  const requirements = inspectListingDraft("elevenst", draft);

  assert.deepEqual(draft.product.ProductCertGroup, []);
  assert.deepEqual(draft.product.ProductNotification, { type: "", item: [] });
  assert.equal(requirements.find((item) => item.key === "notice")?.status, "manual");
  assert.equal(requirements.find((item) => item.key === "certification")?.status, "manual");
  assert.throws(() => validateElevenstListingProduct(draft.product), /ELEVENST_CATEGORY_CONTRACT_UNVERIFIED/);
});

test("missing commerce measurements stay fail-closed instead of receiving invented defaults", () => {
  const rawContext = publishContext();
  rawContext.manualFields = {
    ...rawContext.manualFields,
    sellingPrice: undefined,
    currency: "",
    stock: undefined,
    weightKg: undefined,
    packageLengthCm: undefined,
    packageWidthCm: undefined,
    packageHeightCm: undefined,
  } as unknown as WorkbenchContext["manualFields"];

  const normalized = normalizeManualFields(rawContext);
  assert.equal(normalized.sellingPrice, 0);
  assert.equal(normalized.currency, "");
  assert.equal(normalized.stock, 0);
  assert.equal(normalized.weightKg, 0);
  assert.equal(normalized.packageLengthCm, 0);
  assert.equal(normalized.packageWidthCm, 0);
  assert.equal(normalized.packageHeightCm, 0);
});

test("11st missing brand stays empty and is blocked by local preflight instead of receiving a placeholder", () => {
  const rawContext = publishContext({ brandName: "   " });
  const manualFields = normalizeManualFields(rawContext);
  const draft = elevenstDraft({ ...rawContext, manualFields });

  assert.equal(manualFields.brandName, "");
  assert.equal(draft.product.brand, "");
  assert.equal(inspectListingDraft("elevenst", draft).find((item) => item.key === "brand")?.status, "manual");
  assert.throws(() => validateElevenstListingProduct(draft.product), /ELEVENST_CONTRACT_FIELD_INVALID:brand/);
});


test("11st food approval exposes missing address IDs and preserves entered IDs in saved patches", () => {
  const draft = { product: { dispCtgrNo: "1009792" } };
  const requirements = inspectListingDraft("elevenst", draft);
  const fields = channelRegistrationFields("elevenst", draft, requirements);
  for (const name of ["addrSeqOut", "addrSeqIn"]) {
    const field = fields.find(item => item.path.join(".") === `product.${name}`);
    assert.ok(field?.required);
    assert.equal(field.value, null);
    assert.equal(requirements.find(item => item.key === `elevenst-${name}`)?.status, "manual");
  }
  const restored = applyRegistrationPatches(draft, [
    { path: ["product", "addrSeqOut"], value: "2" },
    { path: ["product", "addrSeqIn"], value: "3" },
  ]);
  const checked = inspectListingDraft("elevenst", restored);
  assert.equal(checked.find(item => item.key === "elevenst-addrSeqOut")?.status, "ready");
  assert.equal(checked.find(item => item.key === "elevenst-addrSeqIn")?.status, "ready");
  for (const invalid of ["0", "-1", "2.5", "주소 참조"]) {
    const changed = applyRegistrationPatches(draft, [{ path: ["product", "addrSeqOut"], value: invalid }]);
    assert.equal(inspectListingDraft("elevenst", changed).find(item => item.key === "elevenst-addrSeqOut")?.status, "manual");
  }
});
