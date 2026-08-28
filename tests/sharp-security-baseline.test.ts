import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

function versionAtLeast(actual: string | undefined, minimum: readonly [number, number, number]) {
  if (!actual) return false;
  const parts = actual.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index] !== minimum[index]) return (parts[index] ?? 0) > minimum[index];
  }
  return true;
}

test("sharp bundles the patched libheif security baseline", () => {
  assert.equal(versionAtLeast(sharp.versions.heif, [1, 23, 2]), true, `libheif ${sharp.versions.heif ?? "missing"}`);
});
