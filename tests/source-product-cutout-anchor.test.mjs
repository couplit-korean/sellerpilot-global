import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import sharp from "sharp";

test("Swift identity keeps a brand-equal product name but requires distinguishing variants when available", {
  skip: process.platform !== "darwin", timeout: 60_000,
}, async () => {
  const source = await readFile(new URL("../scripts/source-product-cutout.swift", import.meta.url), "utf8");
  // Execute the production identity code with Foundation only; no customer image
  // fixture or Vision device is needed for this name-normalization regression.
  const anchor = source.slice(source.indexOf("struct IdentityAnchor:"), source.indexOf("struct IdentityMatchEvidence"));
  const functions = source.slice(source.indexOf("func identityTokens("), source.indexOf("func normalizedDigits("));
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-anchor-test-"));
  try {
    const script = join(directory, "anchor.swift");
    await writeFile(script, `import Foundation\n${anchor}\n${functions}\n
let inputs = [
  IdentityAnchor(productName: "나랑드사이다", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: nil),
  IdentityAnchor(productName: "나랑드사이다 파인애플 500ml", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: nil),
  IdentityAnchor(productName: "500ml 12개", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: nil),
  IdentityAnchor(productName: "", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: "나랑드사이다")
]
print(String(data: try JSONEncoder().encode(inputs.map { anchorProductTokens($0).sorted() }), encoding: .utf8)!)
`);
    const { stdout } = await promisify(execFile)("/usr/bin/swift", [script], { timeout: 55_000 });
    assert.deepEqual(JSON.parse(stdout), [["나랑드사이다"], ["파인애플"], [], ["나랑드사이다"]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Core Image source pixels follow all eight EXIF orientations before Vision mask composition", {
  skip: process.platform !== "darwin", timeout: 60_000,
}, async () => {
  const source = await readFile(new URL("../scripts/source-product-cutout.swift", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("func normalizedImage("), source.indexOf("struct RecognitionScore"));
  assert.match(source, /guard let source = orientedSourceImage\(at: inputURL\)/);
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-orientation-test-"));
  try {
    const raw = Buffer.alloc(160 * 120 * 3);
    const colors = [[225, 30, 35], [25, 200, 50], [30, 50, 220], [220, 190, 25]];
    for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) {
      raw.set(colors[(y >= 60 ? 2 : 0) + (x >= 80 ? 1 : 0)], (y * 160 + x) * 3);
    }
    for (let orientation = 1; orientation <= 8; orientation++) {
      await sharp(raw, { raw: { width: 160, height: 120, channels: 3 } })
        .withMetadata({ orientation }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
        .toFile(join(directory, `${orientation}.jpg`));
    }
    const script = join(directory, "orientation.swift");
    await writeFile(script, `import Foundation\nimport CoreImage\n${loader}\n
let directory = CommandLine.arguments[1]
for orientation in 1...8 {
  let image = orientedSourceImage(at: URL(fileURLWithPath: "\\(directory)/\\(orientation).jpg"))!
  try CIContext().writePNGRepresentation(of: image, to: URL(fileURLWithPath: "\\(directory)/\\(orientation).png"), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
}
`);
    await promisify(execFile)("/usr/bin/swift", [script, directory], { timeout: 55_000 });
    for (let orientation = 1; orientation <= 8; orientation++) {
      const expected = await sharp(join(directory, `${orientation}.jpg`)).autoOrient().removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const actual = await sharp(join(directory, `${orientation}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(actual.info.width, expected.info.width, `orientation ${orientation} width`);
      assert.equal(actual.info.height, expected.info.height, `orientation ${orientation} height`);
      for (const fy of [0.25, 0.75]) for (const fx of [0.25, 0.75]) {
        const index = (Math.floor(fy * actual.info.height) * actual.info.width + Math.floor(fx * actual.info.width)) * 3;
        for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(actual.data[index + channel] - expected.data[index + channel]) <= 5, `orientation ${orientation} source quadrant`);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
