import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { z } from "zod";

export const temuVerifiedCollectorSource =
  "service_verified_signed_local_collector_v1" as const;
export const temuCollectorAttestationContract =
  "temu_operator_collector_attestation_v1" as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveId = z.string().regex(/^[1-9]\d{0,31}$/u);

export const temuCollectorAttestationSchema = z.object({
  contract: z.literal(temuCollectorAttestationContract),
  uiContractSha256: digest,
  keyId: z.string().trim().min(1).max(128),
  receiptKeyId: z.string().trim().min(1).max(128),
  challengeId: z.string().uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  ownerId: z.string().uuid(),
  productId: z.string().uuid(),
  credentialId: z.string().uuid(),
  credentialVersion: z.number().int().positive(),
  credentialFingerprint: digest,
  credentialVaultSecretId: z.string().uuid(),
  productRevisionFingerprint: digest,
  partnerAccountSubject: z.string().regex(
    /^temu-account:sha256:[a-f0-9]{64}$/u,
  ),
  appId: z.string().trim().min(1).max(256),
  appState: z.enum(["active", "inactive", "unknown"]),
  complianceState: z.enum(["approved", "rejected", "reviewing", "unknown"]),
  rejectionReason: z.string().trim().min(1).max(1_000).nullable(),
  observedAt: z.string().datetime({ offset: true }),
  mallId: positiveId,
  regionId: positiveId,
  shipping: z.object({
    defaultTemplateId: z.string().trim().min(1).max(256),
    warehouseVerified: z.boolean(),
    feeRuleVerified: z.boolean(),
    returnPolicyVerified: z.boolean(),
  }).strict(),
  egress: z.object({
    state: z.enum(["static_ip_verified", "provider_confirmed_no_allowlist",
      "blocked_until_stable_ip", "unknown"]),
    verificationMethod: z.enum(["temu_allowlist_readback",
      "temu_provider_policy_readback", "temu_global_endpoint_probe"]),
  }).strict(),
}).strict();

export const temuSignedCollectorEnvelopeSchema = z.object({
  attestation: temuCollectorAttestationSchema,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
}).strict();

export type TemuCollectorAttestation = z.infer<
  typeof temuCollectorAttestationSchema
>;

export function canonicalTemuCollectorAttestation(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalTemuCollectorAttestation).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalTemuCollectorAttestation(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function temuCollectorAttestationSha256(
  attestation: TemuCollectorAttestation,
) {
  return createHash("sha256")
    .update(canonicalTemuCollectorAttestation(attestation), "utf8")
    .digest("hex");
}

export function verifyTemuCollectorAttestation(input: {
  attestation: TemuCollectorAttestation;
  signature: string;
  publicKeyPem: string;
  expectedKeyId?: string;
}) {
  if (input.expectedKeyId
    && input.attestation.keyId !== input.expectedKeyId) return false;
  try {
    const key = createPublicKey(input.publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" && key.asymmetricKeyType !== "ec") return false;
    if (key.asymmetricKeyType === "ec"
      && key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return false;
    const signature = Buffer.from(input.signature, "base64");
    if (signature.length !== 64) return false;
    return verifySignature(
      key.asymmetricKeyType === "ed25519" ? null : "sha256",
      Buffer.from(canonicalTemuCollectorAttestation(input.attestation), "utf8"),
      key.asymmetricKeyType === "ed25519" ? key : { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}
