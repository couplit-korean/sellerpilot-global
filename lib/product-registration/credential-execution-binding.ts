import type { ActiveChannelKey } from "../channels/catalog";

export const productRegistrationCredentialBindingContract =
  "product_registration_credential_binding_v1" as const;

export const productRegistrationRequestIdentityContract =
  "product_registration_request_identity_v2" as const;

export type ProductRegistrationCredentialBinding = {
  contract: typeof productRegistrationCredentialBindingContract;
  credentialId: string;
  credentialVersion: number | null;
  credentialFingerprint: string | null;
  channel: ActiveChannelKey;
  environment: "sandbox" | "production";
  expiresAt: string | null;
};

export type ProductRegistrationCredentialRequestIdentity = Omit<
  ProductRegistrationCredentialBinding,
  "expiresAt"
>;

export type ProductRegistrationCredentialBindingResult =
  | { ok: true; binding: ProductRegistrationCredentialBinding }
  | {
    ok: false;
    reason:
      | "identity_mismatch"
      | "inactive"
      | "revision_invalid"
      | "revision_mismatch"
      | "expired";
  };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Returns only immutable credential-incarnation fields for request identity.
 * `expiresAt` remains a required execution-time policy check, but operators
 * may extend it without changing the identity of an already accepted request.
 */
export function productRegistrationCredentialRequestIdentity(
  binding: ProductRegistrationCredentialBinding,
): ProductRegistrationCredentialRequestIdentity {
  return {
    contract: binding.contract,
    credentialId: binding.credentialId,
    credentialVersion: binding.credentialVersion,
    credentialFingerprint: binding.credentialFingerprint,
    channel: binding.channel,
    environment: binding.environment,
  };
}

/**
 * Produces the non-secret credential incarnation that is hashed into every
 * product mutation request. The provider secret is deliberately excluded.
 *
 * A requested version is optional for older API callers, but whenever a
 * caller supplies one it must match the current active row. This makes the
 * current workbench fail closed after an in-place credential rotation while
 * preserving parse compatibility for already queued requests.
 */
export function productRegistrationCredentialBinding(input: {
  metadata: unknown;
  credentialId: string;
  channel: ActiveChannelKey;
  requestedVersion?: number;
  now?: Date;
}): ProductRegistrationCredentialBindingResult {
  const row = record(input.metadata);
  if (!row
      || row.id !== input.credentialId
      || row.channel !== input.channel) {
    return { ok: false, reason: "identity_mismatch" };
  }
  if (row.status !== "active") return { ok: false, reason: "inactive" };

  const environment = row.environment === "sandbox"
    ? "sandbox" as const
    : row.environment === "production"
      ? "production" as const
      : null;
  if (!environment) return { ok: false, reason: "identity_mismatch" };

  const version = row.version === undefined || row.version === null
    ? null
    : Number(row.version);
  const fingerprint = typeof row.fingerprint === "string"
    && /^[A-Za-z0-9:_-]{8,128}$/u.test(row.fingerprint.trim())
    ? row.fingerprint.trim()
    : null;
  if ((version !== null && (!Number.isSafeInteger(version) || version < 1))
      || (row.fingerprint !== undefined && row.fingerprint !== null && !fingerprint)) {
    return { ok: false, reason: "revision_invalid" };
  }
  if (input.requestedVersion !== undefined
      && (version === null || input.requestedVersion !== version)) {
    return { ok: false, reason: "revision_mismatch" };
  }

  let expiresAt: string | null = null;
  if (row.expires_at !== undefined && row.expires_at !== null) {
    if (typeof row.expires_at !== "string") {
      return { ok: false, reason: "revision_invalid" };
    }
    const expires = Date.parse(row.expires_at);
    if (!Number.isFinite(expires)) {
      return { ok: false, reason: "revision_invalid" };
    }
    if (expires <= (input.now ?? new Date()).getTime()) {
      return { ok: false, reason: "expired" };
    }
    expiresAt = new Date(expires).toISOString();
  }

  return {
    ok: true,
    binding: {
      contract: productRegistrationCredentialBindingContract,
      credentialId: input.credentialId,
      credentialVersion: version,
      credentialFingerprint: fingerprint,
      channel: input.channel,
      environment,
      expiresAt,
    },
  };
}
