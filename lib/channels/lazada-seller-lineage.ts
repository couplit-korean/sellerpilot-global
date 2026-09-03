import { activeLazadaSellerIdForMarket } from "./lazada-target-lineage";

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function booleanValue(value: unknown) {
  if (value === true || value === 1 || value === "1") return true;
  const normalized = text(value).toLowerCase();
  if (["true", "yes", "active", "enabled"].includes(normalized)) return true;
  if (value === false || value === 0 || value === "0") return false;
  if (["false", "no", "inactive", "disabled", "suspended"].includes(normalized)) {
    return false;
  }
  return null;
}

function sellerData(value: unknown) {
  const root = recordValue(value);
  const data = recordValue(root.data);
  const resultData = recordValue(recordValue(root.result).data);
  return Object.keys(data).length
    ? data
    : Object.keys(resultData).length
      ? resultData
      : root;
}

/**
 * Proves that the current OAuth token, cached MY target and GetSeller response
 * all name the same active Lazada seller. The function returns no provider
 * profile data so worker results cannot leak seller contact information.
 */
export function assertLazadaActiveSellerLineage(input: {
  credential: UnknownRecord;
  remoteData: UnknownRecord;
  country: string;
  expectedSellerId: string;
}) {
  const country = input.country.trim().toLowerCase();
  const expectedSellerId = input.expectedSellerId.trim();
  if (country !== "my" || !/^\d+$/u.test(expectedSellerId)) {
    throw new Error("LAZADA_SELLER_TARGET_INVALID");
  }
  const credentialSellerId = activeLazadaSellerIdForMarket(
    input.credential,
    country,
  );
  if (credentialSellerId !== expectedSellerId) {
    throw new Error("LAZADA_SELLER_TARGET_MISMATCH");
  }

  const seller = sellerData(input.remoteData);
  const providerSellerId = text(seller.seller_id ?? seller.sellerId ?? seller.id);
  const active = booleanValue(
    seller.is_active ?? seller.isActive ?? seller.status ?? seller.seller_status,
  );
  if (providerSellerId !== expectedSellerId) {
    throw new Error("LAZADA_SELLER_READBACK_MISMATCH");
  }
  if (active !== true) throw new Error("LAZADA_SELLER_NOT_ACTIVE");
  return { sellerId: expectedSellerId, status: "ACTIVE" as const };
}
