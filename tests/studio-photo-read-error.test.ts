import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeStudioPhotoReadError } from "../app/_publishing/studio-photo-read-error";

test("stale browser File errors name the photo and require a fresh selection", () => {
  const result = normalizeStudioPhotoReadError(
    "sajo-main.jpg",
    new DOMException("A requested file or directory could not be found.", "NotFoundError"),
  );

  assert.match(result.message, /sajo-main\.jpg/);
  assert.match(result.message, /원본 파일을 다시 읽을 수 없습니다/);
  assert.match(result.message, /사진을 다시 선택/);
});

test("non-stale abort and timeout errors retain their existing identity", () => {
  const abort = new DOMException("상품 등록 화면이 닫혔습니다.", "AbortError");
  const timeout = new Error("파일을 30초 안에 읽지 못했습니다.");

  assert.equal(normalizeStudioPhotoReadError("photo.jpg", abort), abort);
  assert.equal(normalizeStudioPhotoReadError("photo.jpg", timeout), timeout);
});

test("small studio jobs optimize every photo before the first storage upload", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const preoptimizationIndex = studio.indexOf("if (photos.length <= studioPreUploadOptimizationLimit)");
  const uploadIndex = studio.indexOf("const uploaded = await uploadStudioPhotoPairs({");

  assert.ok(preoptimizationIndex > 0);
  assert.ok(uploadIndex > preoptimizationIndex);
  assert.match(studio, /const studioPreUploadOptimizationLimit = 9/);
  assert.match(studio, /preoptimizedPhotos\.push\([\s\S]*?optimizePhoto\(photo\)/);
});
