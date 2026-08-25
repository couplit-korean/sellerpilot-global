import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelArguments, normalizeManualFields } from "../app/product-publish-workbench";
import { validateElevenstListingProduct } from "../lib/channels/elevenst-listing";
import { inspectListingDraft } from "../lib/channels/listing-preflight";

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

test("11st category contract no longer depends on a QA-prefixed seller SKU", () => {
  const production = elevenstDraft(publishContext({ sellerSku: "CABLE-ORGANIZER-001" }));
  const qaPrefixed = elevenstDraft(publishContext({ sellerSku: "QA-CABLE-ORGANIZER-001" }));

  assert.equal(Object.hasOwn(production, "verificationOnly"), false);
  assert.equal(Object.hasOwn(qaPrefixed, "verificationOnly"), false);
  assert.deepEqual(qaPrefixed.product.ProductNotification, production.product.ProductNotification);
  assert.deepEqual(qaPrefixed.product.ProductCertGroup, production.product.ProductCertGroup);
});

test("11st categories other than 1341821 cannot inherit guessed notice or certification metadata", () => {
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
  assert.throws(() => validateElevenstListingProduct(draft.product), /ELEVENST_CERTIFICATION_CONTRACT_UNVERIFIED/);
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
