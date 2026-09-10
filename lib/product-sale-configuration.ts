export const productSaleConfigurations = [
  { value: "상품 1개", label: "1개" },
  { value: "상품 1+1", label: "1+1" },
  { value: "상품 6개", label: "6개" },
] as const;

export type ProductSaleConfiguration = (typeof productSaleConfigurations)[number]["value"];

export function normalizeProductSaleConfiguration(value: unknown): ProductSaleConfiguration | "" {
  const normalized = typeof value === "string" ? value.trim() : "";
  return productSaleConfigurations.find((configuration) => configuration.value === normalized)?.value ?? "";
}
