import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { z } from "zod";

// Temu rejects API calls that do not originate from the seller's allowlisted
// IP with `errorCode 5000003 NOT_IN_IP_WHITE_LIST`. The app server cannot hold
// a stable allowlisted address, so the official identity read is performed by
// the local machine that owns the allowlisted address and the result is signed
// with a Secure Enclave key. The server only accepts such a result when the
// signature, the owner, the freshness and the credential payload fingerprint
// all match.
export const temuCredentialIdentityAttestationContract =
  "temu_credential_identity_attestation_v1" as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveId = z.string().regex(/^[1-9]\d{0,31}$/u);
const scopePattern = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/u;

export const temuCredentialIdentityAttestationSchema = z.object({
  contract: z.literal(temuCredentialIdentityAttestationContract),
  keyId: z.string().trim().min(1).max(128),
  ownerId: z.string().uuid(),
  payloadFingerprintSha256: digest,
  mallId: positiveId,
  regionId: positiveId,
  mallType: z.union([z.literal(1), z.literal(100)]),
  semiUniqueId: z.string().trim().min(1).max(256).nullable(),
  apiScopes: z.array(z.string().trim().min(1).max(256)).min(1).max(2_048),
  observedAt: z.string().datetime({ offset: true }),
  egress: z.object({
    state: z.enum(["static_ip_verified", "provider_confirmed_no_allowlist"]),
    verificationMethod: z.enum([
      "temu_allowlist_readback",
      "temu_provider_policy_readback",
      "temu_global_endpoint_probe",
    ]),
  }).strict(),
}).strict();

export type TemuCredentialIdentityAttestation =
  z.infer<typeof temuCredentialIdentityAttestationSchema>;

export const temuCredentialIdentityEnvelopeSchema = z.object({
  attestation: temuCredentialIdentityAttestationSchema,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
}).strict();

export function canonicalTemuCredentialIdentityAttestation(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalTemuCredentialIdentityAttestation).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) =>
        `${JSON.stringify(key)}:${canonicalTemuCredentialIdentityAttestation(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function temuCredentialIdentityAttestationSha256(
  attestation: TemuCredentialIdentityAttestation,
) {
  return createHash("sha256")
    .update(canonicalTemuCredentialIdentityAttestation(attestation), "utf8")
    .digest("hex");
}

export function temuCredentialPayloadFingerprintSha256(
  payload: Record<string, unknown>,
) {
  const binding = {
    app_key: String(payload.app_key ?? ""),
    app_secret: String(payload.app_secret ?? ""),
    access_token: String(payload.access_token ?? ""),
  };
  return createHash("sha256")
    .update(canonicalTemuCredentialIdentityAttestation(binding), "utf8")
    .digest("hex");
}

export function verifyTemuCredentialIdentityAttestationSigning(input: {
  attestation: TemuCredentialIdentityAttestation;
  signature: string;
  publicKeyPem: string;
  expectedKeyId?: string;
}) {
  if (input.expectedKeyId && input.attestation.keyId !== input.expectedKeyId) {
    return false;
  }
  try {
    const key = createPublicKey(input.publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" && key.asymmetricKeyType !== "ec") {
      return false;
    }
    if (key.asymmetricKeyType === "ec"
      && key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return false;
    const signature = Buffer.from(input.signature, "base64");
    if (signature.length !== 64) return false;
    return verifySignature(
      key.asymmetricKeyType === "ed25519" ? null : "sha256",
      Buffer.from(
        canonicalTemuCredentialIdentityAttestation(input.attestation), "utf8"),
      key.asymmetricKeyType === "ed25519" ? key : { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}

export function verifyTemuCredentialIdentityAttestation(input: {
  attestation: TemuCredentialIdentityAttestation;
  signature: string;
  publicKeyPem: string;
  expectedKeyId?: string;
  ownerId: string;
  payloadFingerprintSha256: string;
  requiredScopes: readonly string[];
  nowMs?: number;
  maxAgeMs?: number;
}) {
  if (input.attestation.ownerId !== input.ownerId) return false;
  if (input.attestation.payloadFingerprintSha256 !== input.payloadFingerprintSha256) {
    return false;
  }
  const observedEpoch = Date.parse(input.attestation.observedAt);
  const now = input.nowMs ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? 5 * 60_000;
  if (!Number.isFinite(observedEpoch) || observedEpoch > now) return false;
  if (now - observedEpoch > maxAgeMs) return false;
  const scopes = input.attestation.apiScopes;
  if (new Set(scopes).size !== scopes.length) return false;
  if (scopes.some((scope) => !scopePattern.test(scope))) return false;
  const granted = new Set(scopes);
  if (input.requiredScopes.some((scope) => !granted.has(scope))) return false;
  return verifyTemuCredentialIdentityAttestationSigning(input);
}
