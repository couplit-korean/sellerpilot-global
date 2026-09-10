import { createHash } from "node:crypto";

import {
  temuRequest,
  type RemoteResponse,
  type SecretPayload,
} from "../../channels/protocols";

export const temuAccountIdentityContract =
  "temu_access_token_identity_v1" as const;
export const temuAccountIdentityEndpointHost =
  "openapi-b-global.temu.com" as const;

export const temuCreateRequiredApiScopes = [
  "temu.local.goods.list.retrieve",
  "temu.local.goods.v3.add",
  "bg.local.goods.publish.status.get",
  "bg.local.goods.detail.query",
  "temu.local.goods.sku.stock.query",
] as const;

export const temuCategoryRequiredApiScopes = [
  "bg.local.goods.category.recommend",
] as const;

export const temuCredentialReadinessRequiredApiScopes = [
  ...temuCreateRequiredApiScopes,
  ...temuCategoryRequiredApiScopes,
] as const;

export const temuSafeTestRequiredApiScopes = [
  ...temuCreateRequiredApiScopes,
  "bg.local.goods.sale.status.set",
] as const;

export type TemuAccountIdentityBinding = {
  contract: typeof temuAccountIdentityContract;
  endpointHost: typeof temuAccountIdentityEndpointHost;
  mallId: string;
  regionId: string;
  mallType: 1 | 100;
  semiUniqueId: string | null;
};

export type TemuAccessTokenIdentity = TemuAccountIdentityBinding & {
  expiresAtSeconds: string;
  apiScopes: string[];
  subject: string;
};

export type TemuAccountIdentityVerification = {
  ok: boolean;
  verification:
    | "TEMU_ACCOUNT_IDENTITY_VERIFIED"
    | "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED"
    | "TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED"
    | "TEMU_ACCOUNT_IDENTITY_CLOCK_INVALID"
    | "TEMU_ACCOUNT_IDENTITY_TOKEN_EXPIRED"
    | "TEMU_ACCOUNT_IDENTITY_MISMATCH"
    | "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING";
  identity?: TemuAccessTokenIdentity;
  missingScopes?: string[];
};

export const temuAccountIdentityPayloadKeys = {
  contract: "temu_account_identity_contract",
  endpointHost: "temu_account_identity_endpoint_host",
  mallId: "temu_account_identity_mall_id",
  regionId: "temu_account_identity_region_id",
  mallType: "temu_account_identity_mall_type",
  semiUniqueId: "temu_account_identity_semi_unique_id",
} as const;

const temuAccountIdentityPayloadKeySet = new Set<string>(
  Object.values(temuAccountIdentityPayloadKeys),
);

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalPositiveInteger(value: unknown) {
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

function canonicalMallType(value: unknown): 1 | 100 | null {
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

function optionalIdentityText(value: unknown): {
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

function parseTemuIdentityResponseText(text: string | undefined) {
  if (!text) return null;
  try {
    type JsonSourceContext = { source?: string };
    const parseWithSource = JSON.parse as unknown as (
      value: string,
      reviver: (
        this: unknown,
        key: string,
        value: unknown,
        context?: JsonSourceContext,
      ) => unknown,
    ) => unknown;
    const parsed = parseWithSource(text, function preserveTemuIdentityLong(
      key,
      value,
      context,
    ) {
      if (["mallId", "regionId", "expiredTime"].includes(key)
        && typeof value === "number"
        && /^[1-9]\d*$/u.test(context?.source ?? "")) {
        return context!.source!;
      }
      return value;
    });
    return objectRecord(parsed);
  } catch {
    return null;
  }
}

export function temuAccountIdentitySubject(binding: TemuAccountIdentityBinding) {
  const canonical = [
    binding.contract,
    binding.endpointHost,
    binding.mallId,
    binding.regionId,
    String(binding.mallType),
    binding.semiUniqueId ?? "",
  ].join("\n");
  return `temu:sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
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

export function resolveTemuCreateAccountTarget(input: {
  payload: SecretPayload;
  market: string;
  requestedTargetId: string;
}) {
  const binding = readTemuAccountIdentityBinding(input.payload);
  const market = input.market.trim().toUpperCase();
  const requestedTargetId = input.requestedTargetId.trim();
  if (!binding) throw new Error("TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED");
  if (market !== "KR") throw new Error("TEMU_CREATE_ACCOUNT_MARKET_MISMATCH");
  if (requestedTargetId && requestedTargetId !== binding.mallId) {
    throw new Error("TEMU_CREATE_TARGET_MALL_MISMATCH");
  }
  return {
    market,
    targetId: binding.mallId,
    regionId: binding.regionId,
  };
}

export function hasTemuAccountIdentityFields(payload: SecretPayload) {
  return Object.keys(payload).some((key) =>
    temuAccountIdentityPayloadKeySet.has(key));
}

export function withoutTemuAccountIdentityFields(payload: SecretPayload) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) =>
    !temuAccountIdentityPayloadKeySet.has(key)));
}

export function temuAccountIdentityCredentialFields(
  identity: TemuAccessTokenIdentity,
) {
  return {
    [temuAccountIdentityPayloadKeys.contract]: identity.contract,
    [temuAccountIdentityPayloadKeys.endpointHost]: identity.endpointHost,
    [temuAccountIdentityPayloadKeys.mallId]: identity.mallId,
    [temuAccountIdentityPayloadKeys.regionId]: identity.regionId,
    [temuAccountIdentityPayloadKeys.mallType]: String(identity.mallType),
    ...(identity.semiUniqueId ? {
      [temuAccountIdentityPayloadKeys.semiUniqueId]: identity.semiUniqueId,
    } : {}),
  };
}

export function normalizeTemuAccessTokenIdentity(input: {
  response: Record<string, unknown>;
  responseText?: string;
}) {
  const exactResponse = parseTemuIdentityResponseText(input.responseText)
    ?? input.response;
  if (exactResponse.success !== true) return null;
  const value = objectRecord(exactResponse.result);
  if (!value) return null;
  const mallId = canonicalPositiveInteger(value.mallId);
  const regionId = canonicalPositiveInteger(value.regionId);
  const mallType = canonicalMallType(value.mallType);
  const semiUniqueId = optionalIdentityText(value.semiUniqueId);
  const expiresAtSeconds = canonicalPositiveInteger(value.expiredTime);
  const rawScopes = value.apiScopeList;
  if (!mallId || !regionId || !mallType || !expiresAtSeconds
    || !semiUniqueId.valid
    || !Array.isArray(rawScopes) || rawScopes.length === 0
    || rawScopes.length > 2_048
    || (mallType === 1 && !semiUniqueId.value)) {
    return null;
  }
  const apiScopes = rawScopes.map((scope) =>
    typeof scope === "string" ? scope.trim() : "");
  if (apiScopes.some((scope) =>
    !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/u.test(scope))
    || new Set(apiScopes).size !== apiScopes.length) {
    return null;
  }
  const binding: TemuAccountIdentityBinding = {
    contract: temuAccountIdentityContract,
    endpointHost: temuAccountIdentityEndpointHost,
    mallId,
    regionId,
    mallType,
    semiUniqueId: semiUniqueId.value,
  };
  return {
    ...binding,
    expiresAtSeconds,
    apiScopes,
    subject: temuAccountIdentitySubject(binding),
  } satisfies TemuAccessTokenIdentity;
}

export function verifyTemuAccountIdentity(input: {
  payload: SecretPayload;
  response: Record<string, unknown>;
  responseText?: string;
  requiredScopes: readonly string[];
  nowSeconds?: number;
}): TemuAccountIdentityVerification {
  const expected = readTemuAccountIdentityBinding(input.payload);
  if (!expected) {
    return {
      ok: false,
      verification: "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED",
    };
  }
  const identity = normalizeTemuAccessTokenIdentity(input);
  if (!identity) {
    return {
      ok: false,
      verification: "TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED",
    };
  }
  const clockSeconds = input.nowSeconds ?? Date.now() / 1000;
  const normalizedClockSeconds = Math.floor(clockSeconds);
  if (!Number.isFinite(clockSeconds)
    || !Number.isSafeInteger(normalizedClockSeconds)
    || normalizedClockSeconds < 0) {
    return {
      ok: false,
      verification: "TEMU_ACCOUNT_IDENTITY_CLOCK_INVALID",
      identity,
    };
  }
  const nowSeconds = BigInt(normalizedClockSeconds);
  if (BigInt(identity.expiresAtSeconds) <= nowSeconds + BigInt(300)) {
    return {
      ok: false,
      verification: "TEMU_ACCOUNT_IDENTITY_TOKEN_EXPIRED",
      identity,
    };
  }
  if (expected.mallId !== identity.mallId
    || expected.regionId !== identity.regionId
    || expected.mallType !== identity.mallType
    || expected.semiUniqueId !== identity.semiUniqueId) {
    return {
      ok: false,
      verification: "TEMU_ACCOUNT_IDENTITY_MISMATCH",
      identity,
    };
  }
  const grantedScopes = new Set(identity.apiScopes);
  const missingScopes = [...new Set(input.requiredScopes)]
    .filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) {
    return {
      ok: false,
      verification: "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING",
      identity,
      missingScopes,
    };
  }
  return {
    ok: true,
    verification: "TEMU_ACCOUNT_IDENTITY_VERIFIED",
    identity,
  };
}

type TemuIdentityRequest = (input: {
  payload: SecretPayload;
  type: string;
  arguments?: Record<string, unknown>;
}) => Promise<RemoteResponse>;

export async function attestTemuCredentialIdentityForSave(input: {
  payload: SecretPayload;
  nowSeconds?: number;
  request?: TemuIdentityRequest;
}) {
  const unboundPayload = withoutTemuAccountIdentityFields(input.payload);
  const remote = await (input.request ?? temuRequest)({
    payload: unboundPayload,
    type: "bg.open.accesstoken.info.get",
  });
  if (!remote.response.ok) {
    throw new Error("TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED");
  }
  const identity = normalizeTemuAccessTokenIdentity({
    response: remote.data,
    responseText: remote.text,
  });
  if (!identity) {
    throw new Error("TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED");
  }
  const payload: SecretPayload = {
    ...unboundPayload,
    ...temuAccountIdentityCredentialFields(identity),
  };
  const verification = verifyTemuAccountIdentity({
    payload,
    response: remote.data,
    responseText: remote.text,
    requiredScopes: temuCredentialReadinessRequiredApiScopes,
    nowSeconds: input.nowSeconds,
  });
  if (!verification.ok) throw new Error(verification.verification);
  return {
    payload,
    identity,
    requestId: typeof remote.data.requestId === "string"
      ? remote.data.requestId.trim().slice(0, 160)
      : undefined,
  };
}
