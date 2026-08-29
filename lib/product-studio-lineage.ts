export type ProductResearchLineageFailure =
  | "read_failed"
  | "not_visible"
  | "identity_mismatch"
  | "wrong_kind"
  | "not_succeeded";

export type ProductResearchLineageValidation =
  | { valid: true }
  | { valid: false; reason: ProductResearchLineageFailure };

export function validateVisibleSucceededProductResearchJob(input: {
  expectedJobId: string;
  data: unknown;
  error: unknown;
}): ProductResearchLineageValidation {
  if (input.error) return { valid: false, reason: "read_failed" };
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
    return { valid: false, reason: "not_visible" };
  }

  const job = input.data as Record<string, unknown>;
  if (job.id !== input.expectedJobId) return { valid: false, reason: "identity_mismatch" };
  if (job.kind !== "product_research") return { valid: false, reason: "wrong_kind" };
  if (job.status !== "succeeded") return { valid: false, reason: "not_succeeded" };
  return { valid: true };
}
