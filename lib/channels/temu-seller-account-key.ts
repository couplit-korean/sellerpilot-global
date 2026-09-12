import { createHash } from "node:crypto";

/**
 * The single canonical Temu seller-account key derivation.
 *
 * Every Temu surface that names a seller account (the CS credential binding,
 * the credential lineage ledger, and the provider-certified listing lineage)
 * must agree on this digest of the provider-attested mall id, so the formula
 * lives in one place and is only ever fed a shape-checked mall id.
 */
export const temuCertifiedSellerAccountKeySource = "provider_certified_v1" as const;
export const temuIncarnationSellerAccountKeySource = "credential_incarnation_v1" as const;

/** Exact positive long (the Temu mallId contract) or nothing. */
export function canonicalTemuMallId(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
  if (!/^[1-9]\d{0,18}$/u.test(normalized)) return null;
  try {
    return BigInt(normalized) <= BigInt("9223372036854775807") ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * Derives the certified seller account key for a provider-attested mall.
 * Returns null for anything the provider did not attest.
 */
export function temuSellerAccountKeyFromMallId(mallId: unknown) {
  const normalized = canonicalTemuMallId(mallId);
  if (!normalized) return null;
  const sellerSubject = `temu:mall:${normalized}`;
  return {
    mallId: normalized,
    sellerSubject,
    sellerAccountKey: createHash("sha256")
      .update(`temu\u001fproduction\u001f${sellerSubject}`, "utf8")
      .digest("hex"),
    sellerAccountKeySource: temuCertifiedSellerAccountKeySource,
  } as const;
}
