import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelArguments, buildSynchronizedDraftMap } from "../app/product-publish-workbench";
import { inspectListingDraft } from "../lib/channels/listing-preflight";
import { channelRegistrationFields, setRegistrationValue } from "../lib/channel-registration-form";
import { assertSmartstoreFoodCategoryNotice, buildSmartstoreGeneralFoodNotice, smartstoreGeneralFoodCategory, smartstoreGeneralFoodIssues, smartstoreFoodNoticeFromDraft } from "../lib/channels/smartstore-food-notice";
import { finalizeSmartstoreListingBody } from "../lib/channels/smartstore-image-contract";
import { assertSmartstoreCreateDraftReady } from "../lib/channels/smartstore-listing-create-contract";

function context(): Parameters<typeof buildChannelArguments>[1] {
  return {
    product: { id: "food-fixture", externalCode: "FOOD", sku: "FOOD", name: "가상 시험 음료", description: "가상 시험 자료", sourceUrl: null, status: "ready" },
    manualFields: { productName: "가상 시험 음료", description: "가상 시험 자료", sellerSku: "FOOD", categoryHint: "음료", brandName: "TEST", manufacturer: "가상 판매원", countryOfOrigin: "대한민국", material: "검증 전", packageContents: "500ml 1병", condition: "NEW", gtinStatus: "NO_GTIN", gtin: "", sellingPrice: 3000, currency: "KRW", stock: 10, shippingFeeKrw: 3000, shippingRule: "시험 출고 정책", packagingRule: "시험 포장", weightKg: 0.6, packageLengthCm: 8, packageWidthCm: 8, packageHeightCm: 25 },
    contentMode: "manual_mvp", imageSpecs: [], assignments: [{ channel: "smartstore", market: "KR", categoryId: "50000001", categoryPath: ["식품", "음료", "탄산음료"], providedAttributes: {}, status: "confirmed", confirmedAt: "2026-09-14T00:00:00Z" }], listings: [], sourceImages: [{ path: "fixture.jpg", url: "https://example.com/fixture.jpg" }], generatedImages: [], localizedListings: [], detailData: null,
  };
}
const packageFields = { weight: 0.6, length: 8, width: 8, height: 25 };
const build = (input = context()) => buildChannelArguments("smartstore", input, 3000, 10, undefined, packageFields, 2) as Record<string, unknown>;
const foodPath = ["body", "originProduct", "detailAttribute", "productInfoProvidedNotice", "generalFood"];
const foodChecks = (draft: Record<string, unknown>) => inspectListingDraft("smartstore", draft).filter((field) => field.key.startsWith("food-"));
function completeNotice() {
  const notice = buildSmartstoreGeneralFoodNotice({ title: "가상 시험 음료", packageContents: "500ml 1병" });
  Object.assign(notice.generalFood, { foodType: "탄산음료", weight: "500ml", producer: "가상 시험 생산자", location: "가상 시험 제조소", packDateText: "시험용 제조표시 문구", consumptionDateText: "시험용 소비기한 표시 문구", ingredients: "가상 시험 원재료", nutritionFacts: "가상 시험 영양성분", geneticallyModified: false, importDeclarationCheck: false, consumerSafetyCaution: "가상 시험 주의사항" });
  return notice;
}

test("confirmed beverage category uses GENERAL_FOOD without inventing manufacturer, label facts, dates or booleans", () => {
  const draft = build();
  const { notice, food } = smartstoreFoodNoticeFromDraft(draft);
  assert.equal(notice.productInfoProvidedNoticeType, "GENERAL_FOOD");
  assert.equal(notice.etc, undefined);
  assert.equal(food.producer, ""); // A generic supplier is not a proven producer.
  assert.equal(food.packDateText, "");
  assert.equal(food.consumptionDateText, "");
  assert.equal(food.geneticallyModified, null);
  assert.equal(food.importDeclarationCheck, null);
  assert.equal(food.weight, "");
  assert.equal(food.amount, "500ml 1병"); // Never stock 10 or shipping mass 0.6kg.
  const missing = foodChecks(draft).filter((field) => field.status === "manual");
  for (const key of ["food-weight", "food-producer", "food-location", "food-ingredients", "food-packDate", "food-consumptionDate", "food-geneticallyModified", "food-importDeclarationCheck", "food-nutrition"]) assert.ok(missing.some((field) => field.key === key), key);
  const fields = channelRegistrationFields("smartstore", draft, inspectListingDraft("smartstore", draft));
  for (const field of missing) assert.ok(fields.some((entry) => entry.path.join(".") === field.manualPath?.join(".") && entry.required && entry.issue), field.key);
  assert.equal(fields.find((field) => field.path.at(-1) === "geneticallyModified")?.inputType, "boolean");
});

test("category classification is narrow and unrelated ETC behavior is preserved", () => {
  for (const name of ["식품", "건강기능식품", "음료컵", "탄산음료제조기", "생활용품"]) assert.equal(smartstoreGeneralFoodCategory({ categoryPath: [name] }), false, name);
  for (const name of ["가공식품", "생수/음료", "탄산음료", "사이다"]) assert.equal(smartstoreGeneralFoodCategory({ categoryPath: [name] }), true, name);
  const input = context(); input.assignments[0].categoryPath = ["생활용품"];
  const draft = build(input);
  assert.equal(smartstoreFoodNoticeFromDraft(draft).notice.productInfoProvidedNoticeType, "ETC");
  assert.deepEqual(foodChecks(draft), []);
});

test("generic composition and a title containing 500ml cannot fill verified content capacity", () => {
  const input = context();
  input.manualFields.productName = "가상 시험 음료 500ml";
  input.manualFields.packageContents = "상품 1개";
  const draft = build(input);
  assert.equal(smartstoreFoodNoticeFromDraft(draft).food.weight, "");
  assert.equal(smartstoreFoodNoticeFromDraft(draft).food.amount, "상품 1개");
  assert.equal(foodChecks(draft).find((field) => field.key === "food-weight")?.status, "manual");
});

test("explicit false booleans and verified direct date text pass; placeholders and malformed dates do not", () => {
  const { generalFood: food } = completeNotice();
  assert.deepEqual(smartstoreGeneralFoodIssues(food, true), []);
  for (const key of ["geneticallyModified", "importDeclarationCheck"]) {
    assert.ok(smartstoreGeneralFoodIssues({ ...food, [key]: "false" }, true).includes(key));
    assert.ok(smartstoreGeneralFoodIssues({ ...food, [key]: null }, true).includes(key));
  }
  for (const value of ["", "상품상세 참조", "미확인", "확인 필요"]) assert.ok(smartstoreGeneralFoodIssues({ ...food, consumptionDateText: value }, true).includes("consumptionDateText"));
  assert.ok(smartstoreGeneralFoodIssues({ ...food, packDate: "2026-02-30" }, true).includes("packDateText"));
  assert.ok(smartstoreGeneralFoodIssues({ ...food, ingredients: "x".repeat(1001) }, true).includes("ingredients"));
  assert.ok(smartstoreGeneralFoodIssues({ ...food, nutritionFacts: "" }, true).includes("nutritionFacts"));
  assert.deepEqual(smartstoreGeneralFoodIssues({ ...food, packDate: "2026-02-28", packDateText: "" }, true), []);
});

test("common price/stock changes preserve operator food facts and boolean types", () => {
  const input = context();
  const draft = setRegistrationValue(build(input), foodPath, completeNotice().generalFood as Record<string, string | boolean>);
  assert.deepEqual(foodChecks(draft).filter((field) => field.status === "manual"), []);
  const next = JSON.parse(buildSynchronizedDraftMap(input, { smartstore: JSON.stringify(draft) }, 4000, 4, {}, packageFields, 2).smartstore!);
  assert.deepEqual(smartstoreFoodNoticeFromDraft(next).food, smartstoreFoodNoticeFromDraft(draft).food);
  assert.equal(next.body.originProduct.salePrice, 4000);
  assert.equal(next.body.originProduct.stockQuantity, 4);
  const oldEtc = build({ ...input, assignments: [] });
  const transitioned = JSON.parse(buildSynchronizedDraftMap(input, { smartstore: JSON.stringify(oldEtc) }, 3000, 10, {}, packageFields, 2).smartstore!);
  assert.equal(smartstoreFoodNoticeFromDraft(transitioned).notice.productInfoProvidedNoticeType, "GENERAL_FOOD");
  assert.ok(foodChecks(transitioned).some((field) => field.status === "manual"));
  assert.equal(inspectListingDraft("smartstore", draft, "listing.update").some((field) => field.key.startsWith("food-")), false);
});

test("fresh official beverage category rejects an ETC escape before mutation and binds account contact", () => {
  const draft = build();
  const origin = (draft.body as { originProduct: Record<string, unknown> }).originProduct;
  const detail = origin.detailAttribute as Record<string, unknown>;
  detail.productInfoProvidedNotice = { productInfoProvidedNoticeType: "ETC", etc: { itemName: "generic" } };
  assert.throws(() => assertSmartstoreFoodCategoryNotice(origin, { name: "탄산음료" }), /GENERAL_FOOD_CATEGORY_NOTICE_REQUIRED/);
  assert.ok(foodChecks(draft).some((field) => field.key === "food-notice-type" && field.status === "manual"));
  detail.productInfoProvidedNotice = completeNotice();
  assert.doesNotThrow(() => assertSmartstoreFoodCategoryNotice(origin, { name: "탄산음료" }));
  const finalized = finalizeSmartstoreListingBody({ body: draft.body as Record<string, unknown>, operation: "listing.create", afterServicePhone: "000-0000-0000" });
  const finalFood = smartstoreFoodNoticeFromDraft({ body: finalized }).food;
  assert.equal(finalFood.customerServicePhoneNumber, "000-0000-0000");
  assert.equal(completeNotice().generalFood.customerServicePhoneNumber, "SERVER_MANAGED");
  assert.deepEqual(smartstoreGeneralFoodIssues(finalFood), []);
});

test("product or SKU or category changes discard previous food facts even for another GENERAL_FOOD draft", () => {
  const original = context();
  const draft = setRegistrationValue(build(original), foodPath, completeNotice().generalFood as Record<string, string | boolean>);
  for (const change of ["product", "sku", "category"]) {
    const next = structuredClone(original);
    if (change === "product") next.product.id = "another-product";
    if (change === "sku") next.manualFields.sellerSku = "ANOTHER-SKU";
    if (change === "category") next.assignments[0].categoryId = "50000002";
    next.manualFields.productName = "새로운 시험 음료";
    const synchronized = JSON.parse(buildSynchronizedDraftMap(next, { smartstore: JSON.stringify(draft) }, 3000, 10, {}, packageFields, 2).smartstore!);
    const food = smartstoreFoodNoticeFromDraft(synchronized).food;
    assert.equal(food.productName, "새로운 시험 음료", change);
    assert.equal(food.weight, "", change);
    assert.equal(food.ingredients, "", change);
    assert.equal(food.geneticallyModified, null, change);
  }
});

test("shared create contract rejects incomplete food even when generic product fields are present", () => {
  const draft = build();
  const origin = (draft.body as { originProduct: Record<string, unknown> }).originProduct;
  origin.deliveryInfo = { deliveryType: "DELIVERY", deliveryAttributeType: "NORMAL", deliveryCompany: "HANJIN", deliveryFee: { deliveryFeeType: "PAID", baseFee: 3000, deliveryFeePayType: "PREPAID" }, claimDeliveryInfo: { returnDeliveryCompanyPriorityType: "PRIMARY", returnDeliveryFee: 3000, exchangeDeliveryFee: 6000, shippingAddressId: 123, returnAddressId: 456 } };
  assert.throws(() => assertSmartstoreCreateDraftReady(draft.body), /NAVER_CREATE_GENERAL_FOOD_NOTICE_REQUIRED/);
});
