import { aiGeneratedAssetSpecs, type AiGeneratedAssetId } from "./ai-generated-assets";

export type StudioGeneratedAssetEntry = readonly [AiGeneratedAssetId, string];

const uuidPathPart = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const claimScopedResultPath = new RegExp(
  `^results/(${uuidPathPart})/claims/(${uuidPathPart})/([^/]+)$`,
  "i",
);

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactGeneratedAssetKeys(record: Record<string, unknown>) {
  const actual = Object.keys(record).sort();
  const expected = aiGeneratedAssetSpecs.map((asset) => asset.id).sort();
  return actual.length === expected.length
    && actual.every((assetId, index) => assetId === expected[index]);
}

/**
 * Validates the complete 16-image result returned while polling one final
 * Studio job. Every asset must belong to that exact job and claim.
 */
export function validateFinalStudioAssetStoragePaths(
  expectedJobId: string,
  value: unknown,
): StudioGeneratedAssetEntry[] | null {
  const record = recordValue(value);
  if (!record || !exactGeneratedAssetKeys(record)) return null;

  let claimToken = "";
  const entries: StudioGeneratedAssetEntry[] = [];
  for (const asset of aiGeneratedAssetSpecs) {
    const path = record[asset.id];
    if (typeof path !== "string") return null;
    const match = claimScopedResultPath.exec(path);
    if (!match
        || match[1].toLowerCase() !== expectedJobId.toLowerCase()
        || match[3] !== asset.file
        || (claimToken && match[2].toLowerCase() !== claimToken)) return null;
    claimToken ||= match[2].toLowerCase();
    entries.push([asset.id, path]);
  }
  return entries;
}

/**
 * Validates the product ledger's current generated-image set. Individual
 * assets may belong to later regeneration jobs, so job/claim identity may
 * differ, but all 16 canonical roles and filenames must still be present.
 */
export function validateStoredProductGeneratedAssetPaths(
  value: unknown,
): StudioGeneratedAssetEntry[] | null {
  const record = recordValue(value);
  if (!record || !exactGeneratedAssetKeys(record)) return null;

  const paths = new Set<string>();
  const entries: StudioGeneratedAssetEntry[] = [];
  for (const asset of aiGeneratedAssetSpecs) {
    const path = record[asset.id];
    if (typeof path !== "string" || paths.has(path)) return null;
    const match = claimScopedResultPath.exec(path);
    if (!match || match[3] !== asset.file) return null;
    paths.add(path);
    entries.push([asset.id, path]);
  }
  return entries;
}
