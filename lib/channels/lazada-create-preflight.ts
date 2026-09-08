import { everySku, skuPositive, skuQuantity, skuRecord, skuRows, skuText, uniqueSkuIds } from "../product-registration/sku-contract";

// CreateProduct requires complete data for every SKU, including later variants.
export function lazadaCreateSkuChecks(argumentsValue: unknown) {
  const request = skuRecord(skuRecord(argumentsValue).request);
  const product = skuRecord(skuRecord(request.Request).Product);
  const rows = skuRows(skuRecord(product.Skus).Sku);
  return {
    sku: uniqueSkuIds(rows, "SellerSku"),
    price: everySku(rows, row => skuPositive(row.price)),
    stock: everySku(rows, row => skuQuantity(row.quantity)),
    package: everySku(rows, row => skuText(row.package_content)
      && ["package_weight", "package_length", "package_width", "package_height"].every(key => skuPositive(row[key]))),
  };
}
