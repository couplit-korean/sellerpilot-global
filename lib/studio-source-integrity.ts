export function studioSourceDimensionsMatch(
  format: string | undefined,
  actualWidth: number | undefined,
  actualHeight: number | undefined,
  declaredWidth: number | undefined,
  declaredHeight: number | undefined,
) {
  if (![actualWidth, actualHeight, declaredWidth, declaredHeight].every(Number.isInteger)) return false;
  if (actualWidth === declaredWidth && actualHeight === declaredHeight) return true;
  return format === "jpeg" && actualWidth === declaredHeight && actualHeight === declaredWidth;
}

export type StudioSourceIntegrityRecord = {
  file: string;
  sourceDigest: string;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceFormat: string;
};

export async function assertStudioSourceFilesUnmodified(
  imageFiles: StudioSourceIntegrityRecord[],
  maximumPixels: number,
) {
  for (const [index, image] of imageFiles.entries()) {
    const fileStats = await lstat(image.file);
    if (!fileStats.isFile() || fileStats.isSymbolicLink() || fileStats.size !== image.sourceBytes) {
      throw new Error(`원본 이미지 ${index + 1}이 분석 과정에서 변경됐습니다.`);
    }
    const source = await readFile(image.file);
    if (source.length !== image.sourceBytes
        || createHash("sha256").update(source).digest("hex") !== image.sourceDigest) {
      throw new Error(`원본 이미지 ${index + 1}의 픽셀이 분석 과정에서 변경됐습니다.`);
    }
    const metadata = await sharp(source, { failOn: "warning", limitInputPixels: maximumPixels }).metadata();
    if (metadata.width !== image.sourceWidth
        || metadata.height !== image.sourceHeight
        || metadata.format !== image.sourceFormat) {
      throw new Error(`원본 이미지 ${index + 1}의 규격이 분석 과정에서 변경됐습니다.`);
    }
  }
}
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import sharp from "sharp";
