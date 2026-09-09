/** Retired one-product jobs must not fall through into the normal write path. */
const retiredMarker = /^sellerpilot(?:Coupang(?:Exact|PostPriceVerification)|EbayExact|Elevenst(?:Exact|LegacySnapshot|SnapshotRecovery)|LazadaExact|SmartstoreExact|Qoo10(?:Exact|Adopted|NoEffectReconciliation|ShippingS1)|Temu(?:Exact|ExistingAdoption|CredentialCertification)|ShopeeSg(?:Existing|ExactUpdate))/u;

export function hasRetiredProductRecovery(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasRetiredProductRecovery);
  return Object.entries(value).some(([key, nested]) => retiredMarker.test(key) || hasRetiredProductRecovery(nested));
}

export function assertNoRetiredProductRecovery(value: unknown): void {
  if (hasRetiredProductRecovery(value)) throw new Error("PRODUCT_RECOVERY_RETIRED");
}
