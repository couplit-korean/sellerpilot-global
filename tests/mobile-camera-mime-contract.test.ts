import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const supportedCameraMimeTypes = "image/jpeg,image/png,image/webp";

test("mobile camera inputs advertise exactly the source formats accepted end to end", async () => {
  const [page, revisionPicker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-revision-image-picker.tsx", import.meta.url), "utf8"),
  ]);
  const pageCameraInputs = [...page.matchAll(/<input\b[^>]*capture="environment"[^>]*>/g)].map((match) => match[0]);
  const revisionCameraInputs = [...revisionPicker.matchAll(/<input\b[^>]*capture="environment"[^>]*>/g)].map((match) => match[0]);
  const cameraInputs = [...pageCameraInputs, ...revisionCameraInputs];

  assert.equal(pageCameraInputs.length, 3);
  assert.equal(revisionCameraInputs.length, 3);
  assert.equal(cameraInputs.length, 6);
  for (const input of cameraInputs) {
    assert.match(input, new RegExp(`accept="${supportedCameraMimeTypes}"`));
    assert.doesNotMatch(input, /accept="image\/\*"/);
  }

  const roleCamera = revisionCameraInputs.find((input) => input.includes("product-revision-${role.id}-camera"));
  const extraCamera = revisionCameraInputs.find((input) => input.includes('id="product-revision-extras-camera"'));
  assert.ok(roleCamera);
  assert.ok(extraCamera);
  assert.doesNotMatch(roleCamera, /\bmultiple\b/);
  assert.doesNotMatch(extraCamera, /\bmultiple\b/);
  assert.equal((revisionPicker.match(/\{ id: "[^"]+", label: "[^"]+" \}/g) ?? []).length, 8);
});
