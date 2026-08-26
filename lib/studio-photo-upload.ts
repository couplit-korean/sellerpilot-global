import {
  normalizedStudioImagePath,
  originalStudioImagePath,
} from "./studio-image-paths";
import { maximumStudioJobSourceBytes } from "./studio-source-photo-policy";

export function assertStudioPhotoBatch(
  photos: readonly Pick<Blob, "size">[],
) {
  if (photos.length < 1) throw new Error("업로드할 상품 사진이 없습니다.");
  if (photos.length > 100) throw new Error("한 작업에는 대표사진을 포함해 최대 100장까지 분석할 수 있습니다.");
  const sourceBytes = photos.reduce((total, photo) => total + photo.size, 0);
  if (sourceBytes > maximumStudioJobSourceBytes) {
    throw new Error("한 상품의 원본 사진 합계는 200MB 이하로 등록해 주세요.");
  }
}

type StudioPhotoUploadUnit<Spec extends object> = {
  index: number;
  original: Blob;
  originalMediaType: string;
  normalized: Blob;
  spec: Spec;
};

type UploadStudioPhotoPairsOptions<Spec extends object> = {
  userId: string;
  jobId: string;
  units: readonly StudioPhotoUploadUnit<Spec>[];
  concurrency: number;
  signal: AbortSignal;
  upload: (path: string, body: Blob, contentType: string) => Promise<void>;
  cleanup: (paths: string[]) => Promise<void>;
  onUploaded?: (path: string) => void;
  onCleanupCandidate?: (path: string) => void;
};

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("상품 사진 업로드를 중단했습니다.", "AbortError");
}

export async function uploadStudioPhotoPairs<Spec extends object>({
  userId,
  jobId,
  units,
  concurrency,
  signal,
  upload,
  cleanup,
  onUploaded,
  onCleanupCandidate,
}: UploadStudioPhotoPairsOptions<Spec>) {
  assertStudioPhotoBatch(units.map((unit) => unit.original));
  const results = new Array<{ path: string; spec: Spec & { originalPath: string } }>(units.length);
  const uploaded = new Set<string>();
  // Storage may commit an object even when its HTTP response is lost. Every
  // deterministic path in this pre-enqueue batch is therefore a cleanup
  // candidate before the first request starts, not only after a 2xx response.
  const cleanupCandidates = new Set<string>();
  for (const unit of units) {
    for (const path of [
      originalStudioImagePath(userId, jobId, unit.index),
      normalizedStudioImagePath(userId, jobId, unit.index),
    ]) {
      cleanupCandidates.add(path);
      onCleanupCandidate?.(path);
    }
  }
  let nextIndex = 0;
  let failure: unknown = null;

  const run = async () => {
    while (!failure) {
      try {
        throwIfAborted(signal);
        const resultIndex = nextIndex;
        nextIndex += 1;
        if (resultIndex >= units.length) return;
        const unit = units[resultIndex];
        const originalPath = originalStudioImagePath(userId, jobId, unit.index);
        const normalizedPath = normalizedStudioImagePath(userId, jobId, unit.index);
        await upload(originalPath, unit.original, unit.originalMediaType);
        uploaded.add(originalPath);
        onUploaded?.(originalPath);
        throwIfAborted(signal);
        await upload(normalizedPath, unit.normalized, "image/jpeg");
        uploaded.add(normalizedPath);
        onUploaded?.(normalizedPath);
        throwIfAborted(signal);
        results[resultIndex] = { path: normalizedPath, spec: { ...unit.spec, originalPath } };
      } catch (error) {
        failure ??= error;
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.max(1, Math.min(Math.trunc(concurrency), units.length)) },
    () => run(),
  ));
  if (failure) {
    await cleanup([...cleanupCandidates]).catch(() => undefined);
    throw failure;
  }
  return {
    uploadedPaths: results.map((result) => result.path),
    imageSpecs: results.map((result) => result.spec),
    allUploadedPaths: [...uploaded],
  };
}
