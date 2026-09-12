import { createHash } from "node:crypto";

import { readTemuAccountIdentityBinding } from "../../temu-identity-binding";
import {
  canonicalTemuMallId,
  temuCertifiedSellerAccountKeySource,
  temuIncarnationSellerAccountKeySource,
  temuSellerAccountKeyFromMallId,
} from "../../temu-seller-account-key";

export const temuCsAccountBindingContract = "sellerpilot-temu-cs-account-binding/1" as const;
export const temuCsAccountBindingComparisonContract =
  "temu_cs_account_binding_comparison_v1" as const;
export {
  temuCertifiedSellerAccountKeySource,
  temuIncarnationSellerAccountKeySource,
  temuSellerAccountKeyFromMallId,
};
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
  | "TEMU_SELLER_ACCOUNT_KEY_SOURCE_UNVERIFIED"
  | "TEMU_SELLER_ACCOUNT_KEY_MISMATCH"
  | "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED"
  | "TEMU_ACCOUNT_IDENTITY_BINDING_MISMATCH";

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

/**
 * Failure detail an operator can act on without seeing any secret. The shape of
 * both compared sides is recorded so a bare "mismatch" becomes diagnosable: the
 * relational credential key, its provenance, the provider-derived digest, and
 * per-field agreement with the credential's attested identity binding.
 */
export type TemuCsAccountBindingComparisonField = {
  field: "mallId" | "regionId" | "mallType" | "semiUniqueId";
  /** The token-info readback only carries mallId, so other fields are unverifiable here. */
  liveComparable: boolean;
  expectedPresent: boolean;
  observedPresent: boolean;
  equal: boolean;
  /** Bounded non-secret value; withheld for opaque identifiers (semiUniqueId). */
  expected: string | null;
  observed: string | null;
  expectedSha256Prefix: string | null;
  observedSha256Prefix: string | null;
};

type TemuCsAccountBindingComparisonBase = {
  contract: typeof temuCsAccountBindingComparisonContract;
  relationalKeySource: string | null;
  relationalKeySourceCertified: boolean;
  relationalKeyPresent: boolean;
  relationalKeyPrefix: string | null;
  relationalKeyMatchesProviderIdentity: boolean;
  providerSellerAccountKeyPrefix: string;
  credentialAttestedBindingPresent: boolean;
  fields: TemuCsAccountBindingComparisonField[];
};

export type TemuCsAccountBindingComparison = TemuCsAccountBindingComparisonBase & (
  | { resolution: "relational_provider_certified_key" }
  | { resolution: "blocked" }
);

export type TemuCsAccountBindingEvidence = TemuAccountBindingBase & (
  | {
      status: "verified";
      verified: true;
      resolution: "relational_provider_certified_key";
      identity: TemuAccountIdentityObservation;
      comparison: TemuCsAccountBindingComparison;
    }
  | {
      status: "blocked";
      verified: false;
      blocker: TemuAccountBindingBlocker;
      observedIdentity?: TemuAccountIdentityObservation;
      comparison?: TemuCsAccountBindingComparison;
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

function blocked(
  environment: "production" | "sandbox",
  blocker: TemuAccountBindingBlocker,
  observedIdentity?: TemuAccountIdentityObservation,
  comparison?: TemuCsAccountBindingComparison,
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
    ...(comparison ? { comparison } : {}),
  };
}

function digestPrefix(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function sha256Prefix(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

/** Only bounded, non-control-character values are echoed back to an operator. */
function comparableValue(value: string | null | undefined, field: string) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (field === "semiUniqueId") return null;
  return value.length <= 32 && !/\p{Cc}/u.test(value) ? value : null;
}

function comparisonField(
  field: TemuCsAccountBindingComparisonField["field"],
  expected: string | null,
  observed: string | null,
) {
  const expectedPresent = typeof expected === "string" && expected.length > 0;
  const observedPresent = typeof observed === "string" && observed.length > 0;
  return {
    field,
    liveComparable: field === "mallId" && observedPresent,
    expectedPresent,
    observedPresent,
    equal: expectedPresent && observedPresent && expected === observed,
    expected: comparableValue(expected, field),
    observed: comparableValue(observed, field),
    expectedSha256Prefix: expectedPresent ? sha256Prefix(expected!.replace("\u001f", ":")) : null,
    observedSha256Prefix: observedPresent ? sha256Prefix(observed!.replace("\u001f", ":")) : null,
  } satisfies TemuCsAccountBindingComparisonField;
}

function bindingComparison(input: {
  credential: Record<string, unknown>;
  mallId: string;
  providerSellerAccountKey: string;
  relationalKey: string;
  relationalKeySource: string;
  resolution: TemuCsAccountBindingComparison["resolution"];
}): TemuCsAccountBindingComparison {
  const attested = readTemuAccountIdentityBinding(input.credential);
  return {
    contract: temuCsAccountBindingComparisonContract,
    resolution: input.resolution,
    relationalKeySource: input.relationalKeySource || null,
    relationalKeySourceCertified:
      input.relationalKeySource === temuCertifiedSellerAccountKeySource,
    relationalKeyPresent: /^[a-f0-9]{64}$/u.test(input.relationalKey),
    relationalKeyPrefix: input.relationalKey
      ? input.relationalKey.slice(0, 12)
      : null,
    relationalKeyMatchesProviderIdentity:
      input.relationalKey === input.providerSellerAccountKey,
    providerSellerAccountKeyPrefix: input.providerSellerAccountKey.slice(0, 12),
    credentialAttestedBindingPresent: attested !== null,
    fields: [
      comparisonField("mallId", attested?.mallId ?? null, input.mallId),
      comparisonField("regionId", attested?.regionId ?? null, null),
      comparisonField(
        "mallType",
        attested ? String(attested.mallType) : null,
        null,
      ),
      comparisonField(
        "semiUniqueId",
        attested?.semiUniqueId ?? null,
        null,
      ),
    ],
  };
}

/**
 * Bounded, secret-free failure summary recorded with the job error so an
 * operator can see which side of the binding mismatched.
 */
export function temuCsAccountBindingFailureDetail(
  evidence: Extract<TemuCsAccountBindingEvidence, { status: "blocked" }>,
) {
  const comparison = evidence.comparison;
  if (!comparison) return "identity-compare-not-reached";
  const fields = comparison.fields.map((field) => {
    const expected = field.expectedPresent
      ? field.expected ?? `#${field.expectedSha256Prefix}`
      : "none";
    const observed = field.observedPresent
      ? field.observed ?? `#${field.observedSha256Prefix}`
      : field.liveComparable ? "none" : "unread";
    return `${field.field}=${expected}->${observed}${field.equal ? "=" : "!"}`;
  });
  return [
    `source=${comparison.relationalKeySource ?? "unknown"}`,
    `relationalKey=${comparison.relationalKeyPresent ? comparison.relationalKeyPrefix : "none"}${comparison.relationalKeyMatchesProviderIdentity ? "=" : "!"}${comparison.providerSellerAccountKeyPrefix}`,
    `attestedBinding=${comparison.credentialAttestedBindingPresent ? "present" : "absent"}`,
    ...fields,
  ].join(" ").slice(0, 320);
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
  /**
   * Provenance of the relational key. The Temu credential ledger derives its
   * key from the credential incarnation unless a provider readback certified a
   * mall identity, so an uncertified key can never be compared to the
   * provider-derived digest and must be rejected as such.
   */
  expectedSellerAccountKeySource?: unknown;
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
  const mallId = canonicalTemuMallId(result.mallId);
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
  const derivedSellerAccount = temuSellerAccountKeyFromMallId(mallId);
  if (!derivedSellerAccount) {
    return blocked(input.environment, "TEMU_ACCOUNT_IDENTITY_MALL_INVALID");
  }
  const sellerSubject = derivedSellerAccount.sellerSubject;
  const sellerAccountKey = derivedSellerAccount.sellerAccountKey;
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
  const expectedSellerAccountKeySource = typeof input.expectedSellerAccountKeySource === "string"
    ? input.expectedSellerAccountKeySource.trim()
    : "";
  const comparisonFor = (resolution: TemuCsAccountBindingComparison["resolution"]) =>
    bindingComparison({
      credential: input.credential,
      mallId,
      providerSellerAccountKey: sellerAccountKey,
      relationalKey: /^[a-f0-9]{64}$/u.test(expectedSellerAccountKey)
        ? expectedSellerAccountKey
        : "",
      relationalKeySource: expectedSellerAccountKeySource,
      resolution,
    });
  const attestedBinding = readTemuAccountIdentityBinding(input.credential);
  // The attestation binding is written only from a verified access-token-info
  // readback, so a credential whose attested mall is not the mall we just read
  // is a different seller account than the job claims.
  if (attestedBinding && attestedBinding.mallId !== mallId) {
    return blocked(
      input.environment,
      "TEMU_ACCOUNT_IDENTITY_BINDING_MISMATCH",
      identity,
      comparisonFor("blocked"),
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedSellerAccountKey)) {
    return blocked(
      input.environment,
      "TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED",
      identity,
      comparisonFor("blocked"),
    );
  }
  if (expectedSellerAccountKeySource
      && expectedSellerAccountKeySource !== temuCertifiedSellerAccountKeySource
      && expectedSellerAccountKeySource !== temuIncarnationSellerAccountKeySource) {
    return blocked(
      input.environment,
      "TEMU_SELLER_ACCOUNT_KEY_SOURCE_UNVERIFIED",
      identity,
      comparisonFor("blocked"),
    );
  }
  if (expectedSellerAccountKeySource === temuCertifiedSellerAccountKeySource
      && expectedSellerAccountKey !== sellerAccountKey) {
    return blocked(
      input.environment,
      "TEMU_SELLER_ACCOUNT_KEY_MISMATCH",
      identity,
      comparisonFor("blocked"),
    );
  }
  if (expectedSellerAccountKeySource === temuIncarnationSellerAccountKeySource
      && expectedSellerAccountKey !== sellerAccountKey) {
    // Temu credentials start as a credential-incarnation lineage whose key is
    // random by construction, so it can never equal the provider-derived
    // digest. Only the provider-attested identity may certify the key.
    return blocked(
      input.environment,
      attestedBinding
        ? "TEMU_SELLER_ACCOUNT_KEY_SOURCE_UNVERIFIED"
        : "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED",
      identity,
      comparisonFor("blocked"),
    );
  }
  if (expectedSellerAccountKey !== sellerAccountKey) {
    return blocked(
      input.environment,
      "TEMU_SELLER_ACCOUNT_KEY_MISMATCH",
      identity,
      comparisonFor("blocked"),
    );
  }
  return {
    contract: temuCsAccountBindingContract,
    channel: "temu",
    environment: input.environment,
    sourceOperation: temuAccountIdentityOperation,
    credentialFieldKeys: temuCatalogCredentialKeys,
    status: "verified",
    verified: true,
    resolution: "relational_provider_certified_key",
    identity,
    comparison: comparisonFor("relational_provider_certified_key"),
  };
}

/**
 * Reads the provider-verified Temu binding that the CS provider lane already
 * recorded as a step of its result. Callers must not trust request arguments:
 * only this verified step may name the seller account a CS read belongs to.
 */
export function readVerifiedTemuCsBindingFromResult(result: unknown) {
  const steps = record(result) && Array.isArray((result as Record<string, unknown>).steps)
    ? (result as Record<string, unknown>).steps as unknown[]
    : [];
  for (const step of steps) {
    const entry = record(step);
    if (entry?.name !== "credential-binding:temu" || !entry.ok) continue;
    const data = record(entry.data);
    if (data?.contract !== temuCsAccountBindingContract
        || data.status !== "verified"
        || data.verified !== true) continue;
    const identity = record(data.identity);
    const key = typeof identity?.sellerAccountKey === "string"
      ? identity.sellerAccountKey.trim()
      : "";
    const mallId = canonicalTemuMallId(identity?.mallId);
    if (!/^[a-f0-9]{64}$/u.test(key) || !mallId) continue;
    const expected = temuSellerAccountKeyFromMallId(mallId);
    if (!expected || expected.sellerAccountKey !== key) continue;
    return {
      sellerAccountKey: key,
      mallId,
      sellerSubject: `temu:mall:${mallId}`,
    } as const;
  }
  return null;
}
