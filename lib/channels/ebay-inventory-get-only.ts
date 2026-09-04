import {
  ebayRequest,
  runWithProviderReadOnlyTransport,
  type SecretPayload,
} from "./protocols";

export const ebayCookieMarketplaceSku = "AUTO-780720401E2D4E4EA45F";

const LOCATION_PATH = "/sell/inventory/v1/location";
const INVENTORY_ITEM_PREFIX = "/sell/inventory/v1/inventory_item/";

function assertMarketplaceSku(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(normalized)) {
    throw new Error("EBAY_MARKETPLACE_SKU_INVALID");
  }
  return normalized;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function locationEntries(data: Record<string, unknown>) {
  const locations = Array.isArray(data.locations) ? data.locations : [];
  return locations.flatMap((item) => {
    const location = record(item);
    const merchantLocationKey = typeof location.merchantLocationKey === "string"
      ? location.merchantLocationKey.trim()
      : "";
    if (!merchantLocationKey) return [];
    const status = typeof location.merchantLocationStatus === "string"
      ? location.merchantLocationStatus.trim().toUpperCase()
      : "";
    const address = record(record(location.location).address);
    const countryCode = typeof address.country === "string"
      ? address.country.trim().toUpperCase()
      : "";
    return [{
      merchantLocationKey,
      merchantLocationStatus: status || null,
      countryCode: countryCode || null,
    }];
  });
}

export type EbayInventoryGetOnlyResult = {
  sku: string;
  marketplaceId: string;
  locationHttpStatus: number;
  merchantLocationKeys: string[];
  enabledMerchantLocationKeys: string[];
  exactMerchantLocationKey: string | null;
  locationCountryCodes: string[];
  inventoryHttpStatus: number;
  skuOutcome: "present" | "absent" | "unverified";
  inventorySku: string | null;
  absentReason?: "http_404";
  unverifiedReason?: string;
};

export async function readEbayInventoryGetOnly(input: {
  payload: SecretPayload;
  sku: string;
  environment?: "sandbox" | "production";
}): Promise<EbayInventoryGetOnlyResult> {
  const sku = assertMarketplaceSku(input.sku);
  const environment = input.environment ?? "production";
  const marketplaceId = typeof input.payload.marketplace_id === "string"
    && input.payload.marketplace_id.trim()
    ? input.payload.marketplace_id.trim().toUpperCase()
    : "EBAY_US";
  return runWithProviderReadOnlyTransport(async () => {
    const locationRemote = await ebayRequest({
      payload: input.payload,
      environment,
      method: "GET",
      path: LOCATION_PATH,
      query: new URLSearchParams({ limit: "50" }),
    });
    const inventoryRemote = await ebayRequest({
      payload: input.payload,
      environment,
      method: "GET",
      path: `${INVENTORY_ITEM_PREFIX}${encodeURIComponent(sku)}`,
    });
    const locations = locationEntries(locationRemote.data);
    const merchantLocationKeys = [...new Set(locations.map((item) => item.merchantLocationKey))];
    const enabledMerchantLocationKeys = [...new Set(
      locations
        .filter((item) => item.merchantLocationStatus === "ENABLED")
        .map((item) => item.merchantLocationKey),
    )];
    const locationCountryCodes = [...new Set(
      locations
        .map((item) => item.countryCode)
        .filter((value): value is string => Boolean(value)),
    )];
    const inventorySku = typeof inventoryRemote.data.sku === "string"
      ? inventoryRemote.data.sku.trim()
      : "";
    const locationHttpStatus = locationRemote.response.status;
    const inventoryHttpStatus = inventoryRemote.response.status;
    const base = {
      sku,
      marketplaceId,
      locationHttpStatus,
      merchantLocationKeys,
      enabledMerchantLocationKeys,
      exactMerchantLocationKey: enabledMerchantLocationKeys.length === 1
        ? enabledMerchantLocationKeys[0]
        : merchantLocationKeys.length === 1
          ? merchantLocationKeys[0]
          : null,
      locationCountryCodes,
      inventoryHttpStatus,
      inventorySku: inventorySku || null,
    };
    if (inventoryHttpStatus === 404) {
      return { ...base, skuOutcome: "absent", absentReason: "http_404" };
    }
    if (inventoryHttpStatus === 200 && (!inventorySku || inventorySku === sku)) {
      return { ...base, skuOutcome: "present" };
    }
    if (inventoryHttpStatus === 200 && inventorySku !== sku) {
      return {
        ...base,
        skuOutcome: "unverified",
        unverifiedReason: "EBAY_INVENTORY_SKU_MISMATCH",
      };
    }
    return {
      ...base,
      skuOutcome: "unverified",
      unverifiedReason: `EBAY_INVENTORY_GET_UNVERIFIED:HTTP_${inventoryHttpStatus}`,
    };
  });
}
