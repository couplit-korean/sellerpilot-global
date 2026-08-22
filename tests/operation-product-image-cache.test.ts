import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeOperationProductImages,
  type OperationProductImageCacheEntry,
} from "../lib/operation-product-image-cache.ts";

const cacheDurationMs = 55 * 60_000;

test("keeps the same signed image URL during data-only refreshes", () => {
  const cache = new Map<string, OperationProductImageCacheEntry>();
  const initial = mergeOperationProductImages([
    { id: "product-1", imageUrl: "https://signed.example/hero-a", imageVersion: "version-a" },
  ], cache, 1_000, cacheDurationMs);

  const refreshed = mergeOperationProductImages([
    { id: "product-1", imageUrl: null, imageVersion: "version-a" },
  ], cache, 61_000, cacheDurationMs);

  assert.equal(initial.products[0]?.imageUrl, "https://signed.example/hero-a");
  assert.equal(refreshed.products[0]?.imageUrl, "https://signed.example/hero-a");
  assert.equal(refreshed.missingVersionedImage, false);
});

test("does not reuse a signed URL after the underlying image changes", () => {
  const cache = new Map<string, OperationProductImageCacheEntry>();
  mergeOperationProductImages([
    { id: "product-1", imageUrl: "https://signed.example/hero-a", imageVersion: "version-a" },
  ], cache, 1_000, cacheDurationMs);

  const refreshed = mergeOperationProductImages([
    { id: "product-1", imageUrl: null, imageVersion: "version-b" },
  ], cache, 61_000, cacheDurationMs);

  assert.equal(refreshed.products[0]?.imageUrl, null);
  assert.equal(refreshed.missingVersionedImage, true);
});

test("does not reuse an expired signed URL", () => {
  const cache = new Map<string, OperationProductImageCacheEntry>();
  mergeOperationProductImages([
    { id: "product-1", imageUrl: "https://signed.example/hero-a", imageVersion: "version-a" },
  ], cache, 1_000, cacheDurationMs);

  const refreshed = mergeOperationProductImages([
    { id: "product-1", imageUrl: null, imageVersion: "version-a" },
  ], cache, 1_000 + cacheDurationMs, cacheDurationMs);

  assert.equal(refreshed.products[0]?.imageUrl, null);
  assert.equal(refreshed.missingVersionedImage, true);
});
