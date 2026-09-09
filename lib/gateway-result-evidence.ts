// Transport evidence only. Domain-specific completion policies belong to their owners.
export function gatewayResultRequiresAdditionalEvidence(
  steps: ReadonlyArray<unknown> = [],
): boolean {
  return steps.some((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return false;
    const data = (step as { data?: unknown }).data;
    return Boolean(data && typeof data === "object" && !Array.isArray(data)
      && (data as Record<string, unknown>).sellerpilotAdditionalEvidenceRequired === true);
  });
}
