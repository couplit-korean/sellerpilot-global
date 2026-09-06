/** A URL refresh is a new browser load, even when the saved document is unchanged. */
export function productDetailImageLoadCycleKey(input: {
  productId: string;
  version: number;
  savedSource: string;
  selectedSource: string;
  assetUrls: Record<string, string>;
}) {
  return JSON.stringify([
    input.productId,
    input.version,
    input.savedSource,
    input.selectedSource,
    Object.entries(input.assetUrls).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}
