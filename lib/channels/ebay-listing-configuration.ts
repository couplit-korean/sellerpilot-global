export const EBAY_LISTING_CONFIGURATION_REQUIRED = "EBAY_LISTING_CONFIGURATION_REQUIRED";

export const EBAY_LISTING_CONFIGURATION_FIELDS = [
  "offer.marketplaceId",
  "offer.listingPolicies.fulfillmentPolicyId",
  "offer.listingPolicies.paymentPolicyId",
  "offer.listingPolicies.returnPolicyId",
  "offer.merchantLocationKey",
] as const;

type EbayListingConfigurationField = (typeof EBAY_LISTING_CONFIGURATION_FIELDS)[number];
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function explicitOperationalValue(value: unknown) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.trim().toUpperCase() !== "SERVER_MANAGED";
}

export function missingEbayListingCreateConfiguration(
  arguments_: Record<string, unknown>,
): EbayListingConfigurationField[] {
  const offer = record(arguments_.offer);
  const policies = record(offer.listingPolicies);
  const values: Record<EbayListingConfigurationField, unknown> = {
    "offer.marketplaceId": offer.marketplaceId,
    "offer.listingPolicies.fulfillmentPolicyId": policies.fulfillmentPolicyId,
    "offer.listingPolicies.paymentPolicyId": policies.paymentPolicyId,
    "offer.listingPolicies.returnPolicyId": policies.returnPolicyId,
    "offer.merchantLocationKey": offer.merchantLocationKey,
  };
  return EBAY_LISTING_CONFIGURATION_FIELDS.filter((field) =>
    !explicitOperationalValue(values[field]));
}

export function assertEbayListingCreateConfiguration(
  arguments_: Record<string, unknown>,
) {
  const missing = missingEbayListingCreateConfiguration(arguments_);
  if (missing.length) {
    throw new Error(`${EBAY_LISTING_CONFIGURATION_REQUIRED}:${missing.join(",")}`);
  }
}
