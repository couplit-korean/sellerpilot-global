type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const unknownText = /^(?:상품\s*상세\s*참조|상세(?:페이지)?\s*참조|미확인|미기재|모름|알\s*수\s*없음|확인\s*필요|판매자\s*확인\s*필요|미정|unknown|not provided|seller confirmation required|n\/a|tbd|server_managed)$/iu;

// Commerce API 2.88.0: GENERAL_FOOD / generalFood (not processedFood).
// https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/원상품-정보-구조체
export const smartstoreFoodFields = [
  ["productName", "가공식품 제품명", 200],
  ["foodType", "식품의 유형 (라벨 표시)", 200],
  ["producer", "생산자 (판매원과 구분)", 200],
  ["location", "생산자 소재지", 200],
  ["weight", "포장 단위별 내용물 용량·중량", 200],
  ["amount", "포장 단위별 판매 수량", 200],
  ["ingredients", "원재료명·원산지 및 표시 대상 함량", 1000],
  ["consumerSafetyCaution", "소비자 안전 주의사항", 500],
] as const;
const commonFields = ["returnCostReason", "noRefundReason", "qualityAssuranceStandard", "compensationProcedure", "troubleShootingContents"] as const;
export const smartstoreFoodBooleanFields = [
  ["geneticallyModified", "유전자변형식품 해당 여부"],
  ["importDeclarationCheck", "수입 신고 완료 여부 (해당 없음은 아니요)"],
] as const;

export function smartstoreGeneralFoodCategory(assignment: { categoryPath?: string[]; officialMetadata?: RecordValue } | undefined) {
  const metadata = assignment?.officialMetadata ?? {};
  if (metadata.productInfoProvidedNoticeType === "GENERAL_FOOD") return true;
  // Only confirmed category names, never product titles or generic '식품'.
  return (assignment?.categoryPath ?? []).some((part) => /(?:^|[\/·&])\s*(?:가공식품|음료|탄산음료|사이다)\s*(?:$|[\/·&])/u.test(part));
}

export function buildSmartstoreGeneralFoodNotice(input: { title: string; packageContents: string; attributes?: RecordValue }) {
  const attributes = input.attributes ?? {};
  const explicit = (key: string) => attributes[`smartstore.generalFood.${key}`];
  const food: RecordValue = {
    ...Object.fromEntries(commonFields.map((key) => [key, "상품상세 참조"])),
    ...Object.fromEntries(smartstoreFoodFields.map(([key]) => [key, text(explicit(key))])),
    productName: text(explicit("productName")) || input.title.slice(0, 200),
    // A generic composition such as '상품 1개' is not a content capacity.
    // Neither shipping mass nor title-derived numbers establish this fact.
    weight: text(explicit("weight")),
    amount: text(explicit("amount")) || input.packageContents.trim(),
    packDateText: text(explicit("packDateText")),
    consumptionDateText: text(explicit("consumptionDateText")),
    nutritionFacts: text(explicit("nutritionFacts")),
    customerServicePhoneNumber: "SERVER_MANAGED",
  };
  for (const [key] of smartstoreFoodBooleanFields) {
    const value = explicit(key);
    food[key] = typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : null;
  }
  for (const key of ["packDate", "consumptionDate"]) if (text(explicit(key))) food[key] = text(explicit(key));
  return { productInfoProvidedNoticeType: "GENERAL_FOOD", generalFood: food };
}

export function smartstoreFoodTextValid(value: unknown, max: number) {
  return Boolean(text(value)) && text(value).length <= max && !unknownText.test(text(value));
}

function calendarDate(value: unknown) {
  const date = text(value);
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date;
}

export function smartstoreFoodDateValid(food: RecordValue, key: "packDate" | "consumptionDate") {
  return text(food[key]) ? calendarDate(food[key]) : smartstoreFoodTextValid(food[`${key}Text`], 300);
}

export function smartstoreFoodNutritionRequired(food: RecordValue) {
  return /음료|탄산|사이다/u.test(text(food.foodType));
}

export function smartstoreGeneralFoodIssues(value: unknown, allowServerManagedContact = false) {
  const food = record(value);
  const issues: string[] = [];
  for (const key of commonFields) if (!text(food[key])) issues.push(key);
  for (const [key, , max] of smartstoreFoodFields) if (!smartstoreFoodTextValid(food[key], max)) issues.push(key);
  for (const key of ["packDate", "consumptionDate"] as const) if (!smartstoreFoodDateValid(food, key)) issues.push(`${key}Text`);
  for (const [key] of smartstoreFoodBooleanFields) if (typeof food[key] !== "boolean") issues.push(key);
  if ((smartstoreFoodNutritionRequired(food) || text(food.nutritionFacts)) && !smartstoreFoodTextValid(food.nutritionFacts, 1000)) issues.push("nutritionFacts");
  if (!(allowServerManagedContact && food.customerServicePhoneNumber === "SERVER_MANAGED") && !smartstoreFoodTextValid(food.customerServicePhoneNumber, 30)) issues.push("customerServicePhoneNumber");
  return issues;
}

export function smartstoreFoodNoticeFromDraft(draft: RecordValue) {
  const notice = record(record(record(record(draft.body).originProduct).detailAttribute).productInfoProvidedNotice);
  return { notice, food: record(notice.generalFood), required: notice.productInfoProvidedNoticeType === "GENERAL_FOOD" || record(draft.sellerpilotAssets).smartstoreNoticeType === "GENERAL_FOOD" };
}

export function assertSmartstoreFoodCategoryNotice(originValue: unknown, categoryValue: unknown) {
  const origin = record(originValue);
  const category = record(categoryValue);
  if (!smartstoreGeneralFoodCategory({ categoryPath: [text(category.name)], officialMetadata: category })) return;
  const notice = record(record(origin.detailAttribute).productInfoProvidedNotice);
  if (notice.productInfoProvidedNoticeType !== "GENERAL_FOOD") throw new Error("NAVER_CREATE_GENERAL_FOOD_CATEGORY_NOTICE_REQUIRED");
  const food = record(notice.generalFood);
  const issues = smartstoreGeneralFoodIssues(food, true);
  if (smartstoreFoodNutritionRequired({ foodType: category.name }) && !smartstoreFoodTextValid(food.nutritionFacts, 1000) && !issues.includes("nutritionFacts")) issues.push("nutritionFacts");
  if (issues.length) throw new Error(`NAVER_CREATE_GENERAL_FOOD_NOTICE_REQUIRED:${issues.join(",")}`);
}

export function preserveSmartstoreFoodNotice(current: RecordValue, next: RecordValue) {
  const before = smartstoreFoodNoticeFromDraft(current);
  const after = smartstoreFoodNoticeFromDraft(next);
  if (!after.required || before.notice.productInfoProvidedNoticeType !== "GENERAL_FOOD") return next;
  const previousOrigin = record(record(current.body).originProduct);
  const nextOrigin = record(record(next.body).originProduct);
  const sku = (origin: RecordValue) => text(record(record(origin.detailAttribute).sellerCodeInfo).sellerManagementCode);
  const previousProduct = text(record(current.sellerpilotAssets).smartstoreNoticeProductId);
  const nextProduct = text(record(next.sellerpilotAssets).smartstoreNoticeProductId);
  if (!sku(nextOrigin) || sku(previousOrigin) !== sku(nextOrigin)
      || text(previousOrigin.leafCategoryId) !== text(nextOrigin.leafCategoryId)
      || !nextProduct || previousProduct !== nextProduct) return next;
  const result = structuredClone(next);
  const detail = record(record(record(result.body).originProduct).detailAttribute);
  // Preserve typed booleans and operator facts; never copy an old ETC notice
  // across the category transition to food.
  detail.productInfoProvidedNotice = { ...after.notice, generalFood: { ...after.food, ...before.food } };
  return result;
}
