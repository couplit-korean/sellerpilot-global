export const MINIMUM_SHOT_HASH_DISTANCE = 48;
export const MAXIMUM_SHOT_GENERATION_ATTEMPTS = 3;

export type ShotFingerprint = {
  assetId: string;
  digest: string;
  visualHash: Uint8Array;
};

export function visualHashDistance(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let difference = left[index] ^ right[index];
    while (difference) {
      distance += difference & 1;
      difference >>>= 1;
    }
  }
  return distance;
}

export function findDuplicateShot(
  candidate: ShotFingerprint,
  existing: ShotFingerprint[],
  minimumDistance = MINIMUM_SHOT_HASH_DISTANCE,
) {
  return existing
    .map((shot) => ({
      assetId: shot.assetId,
      exact: candidate.digest === shot.digest,
      distance: visualHashDistance(candidate.visualHash, shot.visualHash),
    }))
    .filter((match) => match.exact || match.distance < minimumDistance)
    .sort((left, right) => Number(right.exact) - Number(left.exact) || left.distance - right.distance)[0] ?? null;
}

export function buildDuplicateRetryGuidance(assetId: string, conflictingAssetId: string, attempt: number) {
  return `Anti-duplicate retry ${attempt} for ${assetId}: the previous draft was visually too similar to ${conflictingAssetId}. Recompose from a substantially different camera height and angle, move the subject to a different frame position, replace the background layout and prop arrangement, and preserve only the factual product identity. Do not create a recolor, small crop change or mirrored copy.`;
}
