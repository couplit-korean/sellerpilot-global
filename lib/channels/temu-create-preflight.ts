import { everySku, skuPositive, skuQuantity, skuRecord, skuRows, skuText, uniqueSkuIds } from "../product-registration/sku-contract";

// temu.local.goods.v3.add, official specification checked 2026-09-09.
export function temuCreateSkuChecks(body: unknown) {
  const rows = skuRows(skuRecord(body).skuList);
  return {
    sku: uniqueSkuIds(rows, "externalSkuId"),
    price: everySku(rows, row => {
      const prices = skuRecord(row.price);
      const price = skuRecord(prices.basePrice);
      const listPrice = skuRecord(prices.listPrice);
      return typeof price.amount === "string" && skuPositive(price.amount)
        && typeof price.currency === "string" && /^[A-Z]{3}$/u.test(price.currency)
        && (!Object.hasOwn(prices, "listPrice") || (typeof listPrice.amount === "string"
          && skuPositive(listPrice.amount) && listPrice.currency === price.currency
          && Number(listPrice.amount) > Number(price.amount)));
    }),
    stock: everySku(rows, row => skuQuantity(row.quantity)),
    package: everySku(rows, row => {
      const box = skuRecord(row.packageInfo);
      return ["weight", "length", "width", "height"].every(key => typeof box[key] === "string" && skuPositive(box[key]));
    }),
    images: everySku(rows, row => Array.isArray(row.images) && row.images.length > 0
      && Array.from(row.images).every(image => typeof image === "string" && /^https:\/\//u.test(image))),
    variations: everySku(rows, row => {
      const variations = skuRows(row.variations);
      return everySku(variations, variation => skuText(variation.name) && skuText(variation.value))
        && new Set(variations.map(variation => String(variation.name).trim())).size === variations.length;
    }),
  };
}
