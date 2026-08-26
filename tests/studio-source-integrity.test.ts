import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { assertStudioSourceFilesUnmodified, studioSourceDimensionsMatch } from "../lib/studio-source-integrity";

test("preserved JPEG dimensions accept EXIF-oriented quarter-turn swaps only", () => {
  assert.equal(studioSourceDimensionsMatch("jpeg", 3024, 4032, 3024, 4032), true);
  assert.equal(studioSourceDimensionsMatch("jpeg", 4032, 3024, 3024, 4032), true);
  assert.equal(studioSourceDimensionsMatch("png", 4032, 3024, 3024, 4032), false);
  assert.equal(studioSourceDimensionsMatch("jpeg", 4000, 3000, 3024, 4032), false);
});

test("source integrity recheck rejects a pixel mutation after analysis", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-source-integrity-"));
  const file = join(directory, "input.jpg");
  try {
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "#2255aa" } }).jpeg().toFile(file);
    const original = await readFile(file);
    const record = {
      file,
      sourceDigest: createHash("sha256").update(original).digest("hex"),
      sourceBytes: original.length,
      sourceWidth: 320,
      sourceHeight: 240,
      sourceFormat: "jpeg",
    };
    await assert.doesNotReject(assertStudioSourceFilesUnmodified([record], 16_000_000));
    const altered = Buffer.from(original);
    altered[Math.floor(altered.length / 2)] ^= 0x01;
    await writeFile(file, altered);
    await assert.rejects(assertStudioSourceFilesUnmodified([record], 16_000_000), /픽셀이 분석 과정에서 변경/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
