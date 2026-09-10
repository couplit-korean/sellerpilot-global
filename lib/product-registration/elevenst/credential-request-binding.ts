import { createHash } from "node:crypto";
import type { SecretPayload } from "../../channels/protocols";
import { assertElevenstCreateCredentialBinding } from "./create-verification";

export const elevenstCreateCredentialBindingArgument =
  "sellerpilotElevenstCredentialBinding";

export type ElevenstCreateCredentialRequestBinding = {
  contract: "sellerpilot_elevenst_credential_binding_v1";
  credentialId: string;
  credentialVersion: number;
  environment: "sandbox" | "production";
  sellerIdSha256: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedSellerId(credential: SecretPayload) {
  return typeof credential.seller_id === "string"
    ? credential.seller_id.trim()
    : "";
}

function sellerIdSha256(credential: SecretPayload) {
  assertElevenstCreateCredentialBinding(credential);
  return createHash("sha256")
    .update(`elevenst\u0000${normalizedSellerId(credential)}`)
    .digest("hex");
}

export function buildElevenstCreateCredentialRequestBinding(input: {
  credentialId: string;
  credentialVersion: number;
  environment: "sandbox" | "production";
  credential: SecretPayload;
}): ElevenstCreateCredentialRequestBinding {
  if (!uuidPattern.test(input.credentialId)
    || !Number.isSafeInteger(input.credentialVersion)
    || input.credentialVersion < 1) {
    throw new Error("ELEVENST_CREATE_CREDENTIAL_METADATA_INVALID");
  }
  return {
    contract: "sellerpilot_elevenst_credential_binding_v1",
    credentialId: input.credentialId,
    credentialVersion: input.credentialVersion,
    environment: input.environment,
    sellerIdSha256: sellerIdSha256(input.credential),
  };
}

export function assertElevenstCreateCredentialRequestBinding(input: {
  credentialId: string | undefined;
  credentialVersion: number | undefined;
  environment: "sandbox" | "production";
  credential: SecretPayload;
  binding: unknown;
}) {
  const binding = record(input.binding);
  if (!binding
    || binding.contract !== "sellerpilot_elevenst_credential_binding_v1"
    || typeof binding.credentialId !== "string"
    || !uuidPattern.test(binding.credentialId)
    || !Number.isSafeInteger(binding.credentialVersion)
    || Number(binding.credentialVersion) < 1
    || (binding.environment !== "sandbox" && binding.environment !== "production")
    || typeof binding.sellerIdSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(binding.sellerIdSha256)) {
    throw new Error("ELEVENST_CREATE_CREDENTIAL_BINDING_REQUIRED");
  }
  if (!input.credentialId || binding.credentialId !== input.credentialId) {
    throw new Error("ELEVENST_CREATE_CREDENTIAL_ID_MISMATCH");
  }
  if (!Number.isSafeInteger(input.credentialVersion)
    || Number(input.credentialVersion) < 1) {
    throw new Error("ELEVENST_CREATE_CREDENTIAL_VERSION_REQUIRED");
  }
  if (binding.credentialVersion !== input.credentialVersion) {
    throw new Error("ELEVENST_CREATE_CREDENTIAL_VERSION_MISMATCH");
  }
  if (binding.environment !== input.environment) {
    throw new Error("ELEVENST_CREATE_CREDENTIAL_ENVIRONMENT_MISMATCH");
  }
  if (binding.sellerIdSha256 !== sellerIdSha256(input.credential)) {
    throw new Error("ELEVENST_CREATE_SELLER_ID_MISMATCH");
  }
  return {
    credentialId: binding.credentialId,
    credentialVersion: Number(binding.credentialVersion),
  };
}
