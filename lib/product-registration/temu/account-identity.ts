import {
  temuAccountIdentityContract, temuAccountIdentityEndpointHost, temuAccountIdentityPayloadKeys,
  readTemuAccountIdentityBinding, canonicalPositiveInteger, canonicalMallType, optionalIdentityText,
  type TemuAccountIdentityBinding,
} from "../../channels/temu-identity-binding";
export {
  temuAccountIdentityContract, temuAccountIdentityEndpointHost, temuAccountIdentityPayloadKeys,
  readTemuAccountIdentityBinding, type TemuAccountIdentityBinding,
} from "../../channels/temu-identity-binding";
import { createHash } from "node:crypto";

import {
  temuRequest,
  type RemoteResponse,
  type SecretPayload,
} from "../../channels/protocols";
import {
  classifyTemuEgressAllowlistFailure,
  TemuEgressIpNotAllowlistedError,
} from "./egress-allowlist-failure";
import { temuSellerAccountKeyFromMallId } from "./seller-account-key";

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
    | "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING"
    | "TEMU_EGRESS_IP_NOT_ALLOWLISTED";
  identity?: TemuAccessTokenIdentity;
  missingScopes?: string[];
};

const temuAccountIdentityPayloadKeySet = new Set<string>(
  Object.values(temuAccountIdentityPayloadKeys),
);

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  egress?: unknown;
}): TemuAccountIdentityVerification {
  const expected = readTemuAccountIdentityBinding(input.payload);
  if (!expected) {
    return {
      ok: false,
      verification: "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED",
    };
  }
  // A whitelist rejection is a transport-egress outcome, not an identity or
  // scope outcome. Classify it before any identity normalization so it is not
  // reported as an unverified read.
  const egressAllowlist = classifyTemuEgressAllowlistFailure({
    data: input.response,
    egress: input.egress,
  });
  if (egressAllowlist.notAllowlisted) {
    return {
      ok: false,
      verification: "TEMU_EGRESS_IP_NOT_ALLOWLISTED",
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
  egress?: unknown;
}) {
  const unboundPayload = withoutTemuAccountIdentityFields(input.payload);
  const remote = await (input.request ?? temuRequest)({
    payload: unboundPayload,
    type: "bg.open.accesstoken.info.get",
  });
  const egressAllowlist = classifyTemuEgressAllowlistFailure({
    status: remote.response.status,
    data: remote.data,
    egress: input.egress,
  });
  if (egressAllowlist.notAllowlisted) {
    console.error("[temu-identity] egress ip not allowlisted",
      remote.response.status,
      egressAllowlist.providerErrorCode ?? "unknown",
      egressAllowlist.egress.prefix ?? "unknown-prefix");
    throw new TemuEgressIpNotAllowlistedError({
      providerErrorCode: egressAllowlist.providerErrorCode,
      egress: egressAllowlist.egress,
    });
  }
  if (!remote.response.ok) {
    console.error("[temu-identity] read not ok", remote.response.status,
      Object.keys(remote.data ?? {}).join(","));
    throw new Error("TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED");
  }
  const identity = normalizeTemuAccessTokenIdentity({
    response: remote.data,
    responseText: remote.text,
  });
  if (!identity) {
    const result = (remote.data?.result ?? {}) as Record<string, unknown>;
    console.error("[temu-identity] normalize failed",
      remote.response.status,
      JSON.stringify({
        keys: Object.keys(remote.data ?? {}).join(","),
        success: remote.data?.success === true,
        errorCode: remote.data?.errorCode ?? null,
        errorMsg: String(remote.data?.errorMsg ?? "").slice(0, 160),
        mallId: Boolean(result.mallId),
        regionId: Boolean(result.regionId),
        mallType: Boolean(result.mallType),
        expiredTime: Boolean(result.expiredTime),
        scopes: Array.isArray(result.apiScopeList)
          ? result.apiScopeList.length
          : "none",
      }));
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
    egress: input.egress,
  });
  if (!verification.ok) throw new Error(verification.verification);
  // The certified seller-account key is derived only from the mall identity the
  // provider just attested, so a caller can persist it (idempotently) without
  // ever being able to write a key the provider did not attest. A rejected
  // attestation throws above and returns no seller account at all.
  const sellerAccount = temuSellerAccountKeyFromMallId(identity.mallId);
  if (!sellerAccount) throw new Error("TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED");
  return {
    payload,
    identity,
    sellerAccount,
    requestId: typeof remote.data.requestId === "string"
      ? remote.data.requestId.trim().slice(0, 160)
      : undefined,
  };
}
