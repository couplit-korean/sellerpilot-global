const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fingerprintPattern = /^[A-Fa-f0-9]{12,64}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Local eBay listing.create claims need attempt/version/fingerprint. Other
 * channels, including jobs whose attempt_id is still null, must pass through.
 */
export function attachEbayCreateClaimIncarnation(claimed: unknown) {
  if (claimed == null) return claimed;
  const job = record(claimed);
  if (!job) throw new Error("EBAY_CREATE_CLAIM_LINEAGE_INVALID");
  if (job.channel !== "ebay" || job.operation !== "listing.create") {
    return claimed;
  }
  const attemptId = typeof job.attempt_id === "string" ? job.attempt_id : "";
  const version = Number(job.credential_version);
  const fingerprint = typeof job.credential_fingerprint === "string"
    ? job.credential_fingerprint
    : "";
  if (!uuidPattern.test(attemptId)
      || !Number.isSafeInteger(version)
      || version < 1
      || !fingerprintPattern.test(fingerprint)) {
    throw new Error("EBAY_CREATE_CLAIM_INCARNATION_UNAVAILABLE");
  }
  return claimed;
}
