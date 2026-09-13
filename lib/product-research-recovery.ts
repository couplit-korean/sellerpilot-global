import { coreFirstDraftAssetIds } from "./ai-generated-assets";
import { sha256PreservedStudioOriginalImage } from "./studio-image-validation";

type OriginalSpec = Parameters<typeof sha256PreservedStudioOriginalImage>[1] & { role: string };

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Bind every preserved original to its indexed research evidence, keeping
 * legacy single-photo jobs bound to their original source fingerprint. */
export async function verifyProductResearchRecoveryOriginals(input: {
  originalPaths: string[];
  specs: OriginalSpec[];
  sourcePhotoFingerprint: string;
  sourcePhotoEvidence: unknown;
  download: Parameters<typeof sha256PreservedStudioOriginalImage>[2];
}): Promise<string | null> {
  const count = input.originalPaths.length;
  if (count < 1 || count > 100 || input.specs.length !== count
      || input.specs[0]?.role !== "main"
      || !/^[a-f0-9]{64}$/.test(input.sourcePhotoFingerprint)) return null;
  const evidence = input.sourcePhotoEvidence;
  let expected: string[];
  if (evidence === undefined && count === 1) {
    expected = [input.sourcePhotoFingerprint];
  } else {
    if (!Array.isArray(evidence) || evidence.length !== count) return null;
    expected = [];
    for (let index = 0; index < count; index += 1) {
      const source = record(evidence[index]);
      if (!source || source.sourceIndex !== index
          || source.inputRole !== input.specs[index].role
          || typeof source.sourceSha256 !== "string"
          || !/^[a-f0-9]{64}$/.test(source.sourceSha256)) return null;
      expected.push(source.sourceSha256);
    }
    if (expected[0] !== input.sourcePhotoFingerprint) return null;
  }
  let nextIndex = 0;
  let valid = true;
  await Promise.all(Array.from({ length: Math.min(3, count) }, async () => {
    while (valid && nextIndex < count) {
      const index = nextIndex++;
      const digest = await sha256PreservedStudioOriginalImage(
        input.originalPaths[index], input.specs[index], input.download,
      ).catch(() => null);
      if (digest !== expected[index]) valid = false;
    }
  }));
  return valid && nextIndex === count ? expected[0] : null;
}

export function productResearchRecoveryImagesPending(generation: unknown, lineage: unknown) {
  const state = record(generation);
  const assets = record(lineage);
  if (!state || !assets || state.exhausted === true
      || (state.status !== "queued" && state.status !== "generating")) return false;
  return coreFirstDraftAssetIds.some((id) => record(assets[id])?.auditMode === "source-photo-catalog");
}
