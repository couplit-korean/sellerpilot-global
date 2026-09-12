// Pure credential identity parsing shared by CS and product registration.
// No provider calls, listing rules, or domain executors belong here.
import type { SecretPayload } from "./protocols";

export const temuAccountIdentityContract =
  "temu_access_token_identity_v1" as const;
export const temuAccountIdentityEndpointHost =
  "openapi-b-global.temu.com" as const;

export type TemuAccountIdentityBinding = {
  contract: typeof temuAccountIdentityContract;
  endpointHost: typeof temuAccountIdentityEndpointHost;
  mallId: string;
  regionId: string;
  mallType: 1 | 100;
  semiUniqueId: string | null;
};

export const temuAccountIdentityPayloadKeys = {
  contract: "temu_account_identity_contract",
  endpointHost: "temu_account_identity_endpoint_host",
  mallId: "temu_account_identity_mall_id",
  regionId: "temu_account_identity_region_id",
  mallType: "temu_account_identity_mall_type",
  semiUniqueId: "temu_account_identity_semi_unique_id",
} as const;

export function canonicalPositiveInteger(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return /^[1-9]\d*$/u.test(normalized) ? normalized : null;
  }
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    ? String(value)
    : null;
}

export function canonicalMallType(value: unknown): 1 | 100 | null {
  const normalized = canonicalPositiveInteger(value);
  return normalized === "1" ? 1 : normalized === "100" ? 100 : null;
}

function boundedIdentityText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= 256
    && !Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
    ? normalized
    : null;
}

export function optionalIdentityText(value: unknown): {
  valid: boolean;
  value: string | null;
} {
  if (value === undefined || value === null || value === "") {
    return { valid: true, value: null };
  }
  const normalized = boundedIdentityText(value);
  return normalized
    ? { valid: true, value: normalized }
    : { valid: false, value: null };
}

export function readTemuAccountIdentityBinding(
  payload: SecretPayload,
): TemuAccountIdentityBinding | null {
  if (payload[temuAccountIdentityPayloadKeys.contract] !== temuAccountIdentityContract
    || payload[temuAccountIdentityPayloadKeys.endpointHost] !== temuAccountIdentityEndpointHost) {
    return null;
  }
  const mallId = canonicalPositiveInteger(
    payload[temuAccountIdentityPayloadKeys.mallId],
  );
  const regionId = canonicalPositiveInteger(
    payload[temuAccountIdentityPayloadKeys.regionId],
  );
  const mallType = canonicalMallType(
    payload[temuAccountIdentityPayloadKeys.mallType],
  );
  const semiUniqueId = optionalIdentityText(
    payload[temuAccountIdentityPayloadKeys.semiUniqueId],
  );
  if (!mallId || !regionId || !mallType || !semiUniqueId.valid) return null;
  if (mallType === 1 && !semiUniqueId.value) return null;
  return {
    contract: temuAccountIdentityContract,
    endpointHost: temuAccountIdentityEndpointHost,
    mallId,
    regionId,
    mallType,
    semiUniqueId: semiUniqueId.value,
  };
}

