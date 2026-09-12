import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  buildDifferenceHash,
  SHOT_DHASH_BYTES,
  SHOT_DHASH_COLUMNS,
  SHOT_DHASH_ROWS,
  type ShotFingerprint,
} from "./image-shot-uniqueness";

/**
 * Canonical visual fingerprint used by both first-draft and final Studio image
 * batches. Keeping the resize, alpha flattening and dHash geometry here avoids
 * the two lanes silently applying different duplicate gates.
 */
export async function fingerprintImageAsset(
  assetId: string,
  value: Uint8Array,
  maximumBytes: number,
  maximumPixels: number,
): Promise<ShotFingerprint> {
  const buffer = Buffer.from(value);
  if (!buffer.length || buffer.length > maximumBytes) {
    throw new Error(`${assetId} 이미지 바이트 크기가 안전 한도를 벗어났습니다.`);
  }
  const pixels = await sharp(buffer, { failOn: "warning", limitInputPixels: maximumPixels })
    .resize(SHOT_DHASH_COLUMNS + 1, SHOT_DHASH_ROWS, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer();
  if (pixels.length !== (SHOT_DHASH_COLUMNS + 1) * SHOT_DHASH_ROWS) {
    throw new Error(`${assetId} 이미지 dHash 픽셀 검증 실패`);
  }
  const visualHash = Buffer.from(buildDifferenceHash(pixels));
  if (visualHash.length !== SHOT_DHASH_BYTES) {
    throw new Error(`${assetId} 이미지 dHash 규격 검증 실패`);
  }
  return {
    assetId,
    digest: createHash("sha256").update(buffer).digest("hex"),
    visualHash,
  };
}
