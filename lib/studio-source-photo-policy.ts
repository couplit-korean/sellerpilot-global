export const studioSourceImageMediaTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export type StudioSourceImageMediaType = (typeof studioSourceImageMediaTypes)[number];

export const maximumStudioSourceImageBytes = 20 * 1024 * 1024;
export const maximumStudioJobSourceBytes = 200 * 1024 * 1024;
export const maximumStudioSourceImagePixels = 16_000_000;
export const maximumStudioSourceImageDimension = 50_000;
export const minimumStudioSourceImageDimension = 600;
export const studioPhotoPreparationConcurrency = 2;
export const studioPhotoUploadConcurrency = 2;

export function isStudioSourceImageMediaType(value: string): value is StudioSourceImageMediaType {
  return studioSourceImageMediaTypes.includes(value as StudioSourceImageMediaType);
}

export function assertStudioSourceFile(file: Pick<File, "size" | "type">) {
  if (!isStudioSourceImageMediaType(file.type)) {
    throw new Error("JPG, PNG, WEBP 이미지만 등록할 수 있습니다.");
  }
  if (file.size < 1 || file.size > maximumStudioSourceImageBytes) {
    throw new Error("원본 이미지는 20MB 이하로 등록해 주세요.");
  }
}

export function assertStudioSourceDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < minimumStudioSourceImageDimension
      || height < minimumStudioSourceImageDimension) {
    throw new Error("이미지는 최소 600×600px 이상이어야 합니다.");
  }
  if (width > maximumStudioSourceImageDimension
      || height > maximumStudioSourceImageDimension
      || width * height > maximumStudioSourceImagePixels) {
    throw new Error("원본 픽셀·문구 보존을 위해 이미지는 1,600만 픽셀 이하여야 합니다.");
  }
}
