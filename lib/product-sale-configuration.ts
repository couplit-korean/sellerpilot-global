export const productSaleConfigurations = [
  { value: "상품 1개", label: "1개" },
  { value: "상품 1+1", label: "1+1" },
  { value: "상품 6개", label: "6개" },
] as const;

export type ProductSaleConfiguration = (typeof productSaleConfigurations)[number]["value"];

export function normalizeProductSaleConfiguration(value: unknown): ProductSaleConfiguration | "" {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  if (/1\s*\+\s*1/.test(normalized)) return "상품 1+1";
  if (/(?:^|[^\d])6\s*개(?:\s|$)/.test(normalized)) return "상품 6개";
  if (/(?:^|[^\d])1\s*개(?:\s|$)/.test(normalized) || /\bsingle(?:\s+item)?\b/i.test(normalized)) return "상품 1개";
  return "";
}
