export const SHOT_DHASH_COLUMNS = 16;
export const SHOT_DHASH_ROWS = 16;
export const SHOT_DHASH_BYTES = (SHOT_DHASH_COLUMNS * SHOT_DHASH_ROWS) / 8;
export const MINIMUM_SHOT_HASH_DISTANCE = 64;
export const MAXIMUM_SHOT_GENERATION_RETRIES = 3;
export const MAXIMUM_SHOT_GENERATION_ATTEMPTS = MAXIMUM_SHOT_GENERATION_RETRIES + 1;

export type ShotFingerprint = {
  assetId: string;
  digest: string;
  visualHash: Uint8Array;
};

export function buildDifferenceHash(
  grayscalePixels: Uint8Array,
  rowStride = SHOT_DHASH_COLUMNS + 1,
  rows = SHOT_DHASH_ROWS,
) {
  if (!Number.isInteger(rowStride) || rowStride < 2 || !Number.isInteger(rows) || rows < 1) {
    throw new Error("dHash 픽셀 격자 크기가 올바르지 않습니다.");
  }
  const requiredPixels = rowStride * rows;
  if (grayscalePixels.length < requiredPixels) {
    throw new Error(`dHash 픽셀이 부족합니다. expected=${requiredPixels} actual=${grayscalePixels.length}`);
  }
  const columns = rowStride - 1;
  const visualHash = new Uint8Array(Math.ceil((columns * rows) / 8));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const bitIndex = row * columns + column;
      if (grayscalePixels[row * rowStride + column] > grayscalePixels[row * rowStride + column + 1]) {
        visualHash[Math.floor(bitIndex / 8)] |= 1 << (7 - (bitIndex % 8));
      }
    }
  }
  return visualHash;
}

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

export function buildDuplicateRetryGuidance(
  assetId: string,
  conflictingAssetId: string,
  retry: number,
  mode: "product-mockup" | "source-evidence" = "product-mockup",
) {
  const boundedRetry = Math.max(1, Math.min(Math.trunc(retry), MAXIMUM_SHOT_GENERATION_RETRIES));
  const strategy = mode === "source-evidence"
    ? boundedRetry >= MAXIMUM_SHOT_GENERATION_RETRIES
      ? "Use the most different permitted verified source view, evidence crop, or role-safe framing that remains available; reverse crop pressure and negative-space direction without fabricating a camera view or hidden product plane."
      : "Use a substantially different permitted verified source view, evidence crop, or role-safe framing; change crop pressure and negative-space direction without fabricating a camera view or hidden product plane."
    : boundedRetry >= MAXIMUM_SHOT_GENERATION_RETRIES
      ? "Use the slot's opposite permitted camera height and a clearly different azimuth, move the subject to the opposite frame third or depth plane, reverse the foreground/background hierarchy, and replace every non-product prop and surface layout allowed by the slot."
      : "Use a substantially different camera height and angle by changing azimuth at least 45 degrees within this slot's role, move the subject away from the previous frame zone, switch foreground depth and negative-space direction, and rebuild the allowed prop and surface arrangement from scratch.";
  const blacklistDimensions = mode === "source-evidence"
    ? "crop, placement, depth hierarchy or negative-space direction"
    : "camera, crop, placement, prop arrangement, depth hierarchy or negative-space direction";
  const identityContract = mode === "source-evidence"
    ? "Preserve the hard shot class, unchanged source product pixels and factual identity; never invent or redraw package text."
    : "Preserve the hard shot class and factual product identity; keep every visible label character, logo, color, count and package feature faithful to the supplied references without inventing text or hidden structure.";
  return `Anti-duplicate retry ${boundedRetry} of ${MAXIMUM_SHOT_GENERATION_RETRIES} for ${assetId}: the previous draft was visually too similar to ${conflictingAssetId}. HARD ROLE BLACKLIST: ${conflictingAssetId}; do not reuse its ${blacklistDimensions}. ${strategy} ${identityContract} Do not create a recolor, mirrored copy, small crop, background swap with the same layout, or another slot's role.`;
}
