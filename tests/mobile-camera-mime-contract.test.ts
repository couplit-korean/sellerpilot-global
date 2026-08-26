import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const supportedCameraMimeTypes = "image/jpeg,image/png,image/webp";

test("mobile camera inputs advertise exactly the source formats accepted end to end", async () => {
  const [page, revisionPicker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-revision-image-picker.tsx", import.meta.url), "utf8"),
  ]);
  const source = `${page}\n${revisionPicker}`;
  const cameraInputs = [...source.matchAll(/<input\b[^>]*capture="environment"[^>]*>/g)].map((match) => match[0]);

  assert.equal(cameraInputs.length, 4);
  for (const input of cameraInputs) {
    assert.match(input, new RegExp(`accept="${supportedCameraMimeTypes}"`));
    assert.doesNotMatch(input, /accept="image\/\*"/);
  }
});
