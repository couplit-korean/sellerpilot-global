type StudioImagePathSpec = {
  originalPath?: unknown;
};

const normalizedStudioImagePathPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/input\/([0-9]{3})\.jpg$/i;

export function normalizedStudioImagePath(userId: string, jobId: string, index: number) {
  return `${userId}/${jobId}/input/${String(index + 1).padStart(3, "0")}.jpg`;
}

export function originalStudioImagePath(userId: string, jobId: string, index: number) {
  return `${userId}/${jobId}/original/${String(index + 1).padStart(3, "0")}.source`;
}

export function originalStudioImagePathForNormalized(path: string) {
  const match = normalizedStudioImagePathPattern.exec(path);
  return match ? `${match[1]}/${match[2]}/original/${match[3]}.source` : null;
}

export function validatePreservedStudioUploadPaths(
  userId: string,
  jobId: string,
  imagePaths: readonly string[],
  imageSpecs: readonly StudioImagePathSpec[],
) {
  if (imagePaths.length < 1 || imagePaths.length > 100 || imageSpecs.length !== imagePaths.length) return null;
  const originalPaths: string[] = [];
  for (let index = 0; index < imagePaths.length; index += 1) {
    const normalizedPath = normalizedStudioImagePath(userId, jobId, index);
    const originalPath = originalStudioImagePath(userId, jobId, index);
    if (imagePaths[index] !== normalizedPath || imageSpecs[index]?.originalPath !== originalPath) return null;
    originalPaths.push(originalPath);
  }
  return {
    imagePaths: [...imagePaths],
    originalPaths,
    allPaths: imagePaths.flatMap((path, index) => [path, originalPaths[index]]),
  };
}

export function sourceImagePathsForWorker(
  imagePaths: readonly string[],
  imageSpecs: readonly StudioImagePathSpec[],
) {
  if (!imagePaths.length) return [];
  const candidates = imageSpecs.map((spec) => typeof spec?.originalPath === "string" ? spec.originalPath : "");
  if (candidates.every((path) => !path)) return [...imagePaths];
  if (candidates.length !== imagePaths.length || candidates.some((path) => !path)) {
    throw new Error("원본 상품 이미지 경로가 일부만 저장되어 작업을 안전하게 시작할 수 없습니다.");
  }
  for (let index = 0; index < imagePaths.length; index += 1) {
    if (originalStudioImagePathForNormalized(imagePaths[index]) !== candidates[index]) {
      throw new Error("원본 상품 이미지 경로가 파생 이미지와 일치하지 않습니다.");
    }
  }
  return candidates;
}

export function expandStudioCleanupStoragePaths(paths: readonly string[]) {
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    for (const candidate of [path, originalStudioImagePathForNormalized(path)]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      expanded.push(candidate);
    }
  }
  return expanded;
}
