import type { ProductClassification } from "../app/product-studio-types";

const healthFunctionalFoodRelevantProductPattern = /(?:건강\s*기능\s*식품|건기식|건강\s*식품|영양제|비타민|오메가|유산균|콜라겐|보충제|일반\s*식품|가공품|음료|과자|시리얼|커피|차류|캔디|젤리|통조림|참치|\b(?:health\s*functional\s*food|supplement|vitamin|omega|probiotic|collagen|food|beverage|cereal|coffee|tea|snack|candy|jelly|tuna)\b)/iu;

type ProductClassificationContext = {
  name: string;
  category: string;
  classification: ProductClassification;
};

export function productDetailHealthFunctionalStatus({
  name,
  category,
  classification,
}: ProductClassificationContext) {
  const relevantCopy = `${name}\n${category}\n${classification.displayName}`;
  const isRelevant = classification.isHealthFunctionalFood === true
    || healthFunctionalFoodRelevantProductPattern.test(relevantCopy);

  if (!isRelevant) return "";
  if (classification.isHealthFunctionalFood === true) return "건강기능식품 표시 확인";
  if (classification.isHealthFunctionalFood === false) return "건강기능식품 아님";
  return "표시 여부 확인 필요";
}
