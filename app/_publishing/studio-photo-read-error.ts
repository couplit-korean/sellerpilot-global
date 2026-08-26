export function normalizeStudioPhotoReadError(photoName: string, error: unknown) {
  const errorName = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
  if (errorName === "NotFoundError") {
    return new Error(`‘${photoName}’ 원본 파일을 다시 읽을 수 없습니다. 이 사진을 다시 선택한 뒤 상품 분석을 다시 시작해 주세요.`);
  }
  if (error instanceof Error) return error;
  return new Error(`${photoName} 이미지를 JPEG로 변환하지 못했습니다.`);
}
