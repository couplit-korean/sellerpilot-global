import { createHash } from "node:crypto";

export const temuCsAccountBindingContract = "sellerpilot-temu-cs-account-binding/1" as const;
export const temuAccountIdentityOperation = "bg.open.accesstoken.info.get" as const;
export const temuCatalogCredentialKeys = ["app_key", "app_secret", "access_token"] as const;

type TemuAccountBindingBlocker =
  | "TEMU_CREDENTIAL_FIELDS_INCOMPLETE"
  | "TEMU_ACCOUNT_BINDING_ENVIRONMENT_UNVERIFIED"
  | "TEMU_ACCOUNT_IDENTITY_READBACK_REQUIRED"
  | "TEMU_ACCOUNT_IDENTITY_READBACK_REJECTED"
  | "TEMU_ACCOUNT_IDENTITY_RESPONSE_INVALID"
  | "TEMU_ACCOUNT_IDENTITY_MALL_INVALID"
  | "TEMU_ACCOUNT_IDENTITY_SCOPES_INVALID"
  | "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING"
  | "TEMU_ACCOUNT_IDENTITY_OBSERVED_AT_INVALID"
  | "TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED"
  | "TEMU_SELLER_ACCOUNT_KEY_MISMATCH";

type TemuAccountIdentityObservation = {
  contract: "temu_exact_credential_identity_observation_v1";
  verified: true;
  mallId: string;
  sellerSubject: string;
  sellerAccountKey: string;
  apiScopeDigest: string;
  apiScopeCount: number;
  observedAt: string;
  digest: string;
};

type TemuAccountBindingBase = {
  contract: typeof temuCsAccountBindingContract;
  channel: "temu";
  environment: "production" | "sandbox";
  sourceOperation: typeof temuAccountIdentityOperation;
  credentialFieldKeys: typeof temuCatalogCredentialKeys;
};

export type TemuCsAccountBindingEvidence = TemuAccountBindingBase & (
  | {
      status: "verified";
      verified: true;
      identity: TemuAccountIdentityObservation;
    }
  | {
      status: "blocked";
      verified: false;
      blocker: TemuAccountBindingBlocker;
      observedIdentity?: TemuAccountIdentityObservation;
    }
);

type TemuAccountInfoRead = {
  ok: boolean;
  status: number;
  data: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function catalogCredentialValue(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized
      && normalized.length <= 4_096
      && !/\p{Cc}/u.test(normalized)
    ? normalized
    : "";
}

function exactLong(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return "";
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
  if (!/^[1-9]\d{0,18}$/u.test(normalized)) return "";
  try {
    return BigInt(normalized) <= BigInt("9223372036854775807") ? normalized : "";
  } catch {
    return "";
  }
}

function blocked(
  environment: "production" | "sandbox",
  blocker: TemuAccountBindingBlocker,
  observedIdentity?: TemuAccountIdentityObservation,
): TemuCsAccountBindingEvidence {
  return {
    contract: temuCsAccountBindingContract,
    channel: "temu",
    environment,
    sourceOperation: temuAccountIdentityOperation,
    credentialFieldKeys: temuCatalogCredentialKeys,
    status: "blocked",
    verified: false,
    blocker,
    ...(observedIdentity ? { observedIdentity } : {}),
  };
}

/**
 * Produces seller binding evidence only from the authenticated access-token-info
 * readback already used by the verified Temu credential-certification contract.
 * Catalog secrets and caller-supplied seller IDs are never promoted to identity.
 */
export function temuCsAccountBindingEvidence(input: {
  credential: Record<string, unknown>;
  environment: "production" | "sandbox";
  accessTokenInfo: TemuAccountInfoRead | null;
  expectedSellerAccountKey?: unknown;
  observedAt?: Date;
}): TemuCsAccountBindingEvidence {
  if (temuCatalogCredentialKeys.some((key) => !catalogCredentialValue(input.credential[key]))) {
    return blocked(input.environment, "TEMU_CREDENTIAL_FIELDS_INCOMPLETE");
  }
  if (input.environment !== "production") {
    return blocked(input.environment, "TEMU_ACCOUNT_BINDING_ENVIRONMENT_UNVERIFIED");
  }
  if (!input.accessTokenInfo) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_READBACK_REQUIRED");
  }
  if (!input.accessTokenInfo.ok
      || !Number.isInteger(input.accessTokenInfo.status)
      || input.accessTokenInfo.status < 200
      || input.accessTokenInfo.status > 299) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_READBACK_REJECTED");
  }
  const envelope = record(input.accessTokenInfo.data);
  const result = record(envelope?.result);
  if (envelope?.success !== true || !result) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_RESPONSE_INVALID");
  }
  const mallId = exactLong(result.mallId);
  if (!mallId) return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_MALL_INVALID");

  if (!Array.isArray(result.apiScopeList)
      || result.apiScopeList.length < 1
      || result.apiScopeList.length > 2_000) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_SCOPES_INVALID");
  }
  const scopes = result.apiScopeList.map((value) => typeof value === "string" ? value : "");
  if (scopes.some((scope) => !scope
      || scope !== scope.trim()
      || scope.length > 256
      || /\p{Cc}/u.test(scope))
      || new Set(scopes).size !== scopes.length) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_SCOPES_INVALID");
  }
  const uniqueScopes = [...scopes].sort();
  if (!uniqueScopes.includes(temuAccountIdentityOperation)) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING");
  }

  const observedAt = input.observedAt ?? new Date();
  if (!Number.isFinite(observedAt.getTime())) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_OBSERVED_AT_INVALID");
  }
  const sellerSubject = `temu:mall:${mallId}`;
  const sellerAccountKey = createHash("sha256")
    .update(`temu\u001fproduction\u001f${sellerSubject}`, "utf8")
    .digest("hex");
  const canonical = {
    contract: "temu_exact_credential_identity_observation_v1" as const,
    mallId,
    sellerSubject,
    sellerAccountKey,
    apiScopeDigest: sha256Json(uniqueScopes),
    apiScopeCount: uniqueScopes.length,
    observedAt: observedAt.toISOString(),
  };
  const identity: TemuAccountIdentityObservation = {
    ...canonical,
    verified: true,
    digest: sha256Json(canonical),
  };

  const expectedSellerAccountKey = typeof input.expectedSellerAccountKey === "string"
    ? input.expectedSellerAccountKey.trim()
    : "";
  if (!/^[a-f0-9]{64}$/u.test(expectedSellerAccountKey)) {
    return blocked(
      input.environment,
      "TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED",
      identity,
    );
  }
  if (expectedSellerAccountKey !== sellerAccountKey) {
    return blocked(input.environment, "TEMU_SELLER_ACCOUNT_KEY_MISMATCH", identity);
  }
  return {
    contract: temuCsAccountBindingContract,
    channel: "temu",
    environment: input.environment,
    sourceOperation: temuAccountIdentityOperation,
    credentialFieldKeys: temuCatalogCredentialKeys,
    status: "verified",
    verified: true,
    identity,
  };
}
