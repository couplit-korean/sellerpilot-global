import type { StudioValidationIssue } from "./studio-segment-generation";

export const SERVER_STUDIO_MAX_LOCALIZED_REPAIR_CALLS = 3;

/** One repair per chunk, sharing one claim-wide cap across both validation stages. */
export function createServerStudioLocalizedRepairBudget() {
  const repairedChunks = new Set<number>();
  return {
    take(chunkIndexes: readonly number[]) {
      const indexes = [...new Set(chunkIndexes)];
      if (!indexes.length || indexes.some((index) => !Number.isSafeInteger(index) || index < 0
          || repairedChunks.has(index))
          || repairedChunks.size + indexes.length > SERVER_STUDIO_MAX_LOCALIZED_REPAIR_CALLS) {
        return false;
      }
      indexes.forEach((index) => repairedChunks.add(index));
      return true;
    },
  };
}

/** Only trusted schema diagnostics, never rejected model output, enter repair guidance. */
export function serverStudioContractRepairGuidance(
  issues: readonly StudioValidationIssue[],
  listingOffset = 0,
) {
  return issues.slice(0, 12).map((issue) => {
    // Terminal issues use canonical 0..33 indexes; each repair response has
    // only 1..4 entries, in the same order as its exact_targets prompt.
    const localPath = issue.path[0] === "localizedListings" && typeof issue.path[1] === "number"
      ? [issue.path[0], issue.path[1] - listingOffset, ...issue.path.slice(2)]
      : issue.path;
    const path = localPath.map((part) => String(part).replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 48)).join(".");
    return `${path || "$"}: ${issue.message.slice(0, 240)}`;
  }).join("\n").slice(0, 3_000);
}
