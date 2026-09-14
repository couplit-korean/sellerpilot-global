function categoryScalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0]?.trim() ?? "" : value?.trim() ?? "";
}

function englishEbayMaterial(value: string) {
  const normalized = value.trim();
  const translations: Record<string, string> = {
    "도자기": "Ceramic",
    "세라믹": "Ceramic",
    "유리": "Glass",
    "스테인리스": "Stainless Steel",
    "스테인리스 스틸": "Stainless Steel",
    "플라스틱": "Plastic",
    "실리콘": "Silicone",
    "나무": "Wood",
    "목재": "Wood",
    "가죽": "Leather",
    "합성가죽": "Faux Leather",
    "면": "Cotton",
    "폴리에스터": "Polyester",
  };
  return translations[normalized] ?? normalized;
}

export function ebayCategoryAspects(
  categoryId: string,
  providedAttributes: Record<string, string | string[]>,
  fallbackMaterial: string,
) {
  // EBAY_US Soft Drinks (179188) does not require Material. Product ingredients
  // remain in both descriptions; treating the full ingredient declaration as
  // a Material aspect exceeds eBay's 65-character aspect limit at publish.
  if (categoryId.trim() === "179188") {
    return Object.fromEntries(
      Object.entries(providedAttributes).filter(([name]) => name !== "Material"),
    );
  }
  const material = englishEbayMaterial(
    categoryScalar(providedAttributes.Material) || fallbackMaterial,
  );
  return { ...providedAttributes, ...(material ? { Material: material } : {}) };
}
