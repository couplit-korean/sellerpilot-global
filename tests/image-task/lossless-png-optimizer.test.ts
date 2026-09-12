import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import {
  optimizePngWithSharp,
  verifyLosslessPngCandidate,
} from "../../lib/image-lossless-png-optimizer";
import {
  defaultOxipngBinaryPath,
  optimizePngLocally,
} from "../../scripts/product-ai-worker.oxipng-lossless.mjs";

async function uncompressedRgbaFixture() {
  const width = 96;
  const height = 72;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = (index * 17) % 256;
    pixels[index * 4 + 1] = (index * 31) % 256;
    pixels[index * 4 + 2] = (index * 47) % 256;
    pixels[index * 4 + 3] = index % 7 === 0 ? 0 : (index * 13) % 256;
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 0, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

function pngCrc(value: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.from(data);
  const result = Buffer.alloc(payload.length + 12);
  result.writeUInt32BE(payload.length, 0);
  typeBytes.copy(result, 4);
  payload.copy(result, 8);
  result.writeUInt32BE(pngCrc(Buffer.concat([typeBytes, payload])), payload.length + 8);
  return result;
}

function sixteenBitGrayPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 16;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0xab, 0xcd]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("Sharp optimizer chooses only a smaller byte-for-byte pixel and alpha equivalent PNG", async () => {
  const source = await uncompressedRgbaFixture();
  const optimized = await optimizePngWithSharp(source);

  assert.ok(optimized.afterBytes < optimized.beforeBytes);
  assert.notEqual(optimized.encoder, "original");
  assert.equal(optimized.afterBytes, optimized.bytes.length);
  assert.equal(optimized.savedBytes, source.length - optimized.bytes.length);
  await verifyLosslessPngCandidate(source, optimized.bytes);
});

test("protected ICC/EXIF/gamma/provenance metadata cannot be silently dropped", async () => {
  const source = await sharp({
    create: { width: 48, height: 48, channels: 4, background: "#87b5ff" },
  })
    .withMetadata({
      density: 144,
      exif: { IFD0: { Copyright: "SellerPilot lossless fixture" } },
    })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const optimized = await optimizePngWithSharp(source);

  await verifyLosslessPngCandidate(source, optimized.bytes);
  assert.ok(optimized.afterBytes < source.length);
  assert.notEqual(optimized.encoder, "original");
});

test("Vercel Sharp baseline selects a real encoder for the 1200x1500 metadata-free regression fixture", async () => {
  const source = await sharp({
    create: { width: 1200, height: 1500, channels: 3, background: "#abcdef" },
  })
    .png({ compressionLevel: 0, adaptiveFiltering: false, palette: false })
    .toBuffer();
  const optimized = await optimizePngWithSharp(source);

  assert.ok(source.length > 5_000_000);
  assert.ok(optimized.afterBytes < source.length / 100);
  assert.match(optimized.encoder, /^sharp-png9-/);
  assert.deepEqual(optimized.candidateFailures, []);
  await verifyLosslessPngCandidate(source, optimized.bytes);
});

test("transparent and already-optimized PNGs never grow and remain exactly verifiable", async () => {
  const transparent = await uncompressedRgbaFixture();
  const first = await optimizePngWithSharp(transparent);
  const second = await optimizePngWithSharp(first.bytes);

  assert.ok(first.afterBytes < transparent.length);
  assert.ok(second.afterBytes <= first.afterBytes);
  await verifyLosslessPngCandidate(transparent, first.bytes);
  await verifyLosslessPngCandidate(first.bytes, second.bytes);
});

test("APNG and 16-bit PNG inputs are preserved explicitly instead of being flattened or downsampled", async () => {
  const still = await sharp({
    create: { width: 4, height: 4, channels: 4, background: "#33669980" },
  }).png().toBuffer();
  const idatOffset = still.indexOf(Buffer.from("IDAT", "ascii")) - 4;
  assert.ok(idatOffset > 8);
  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(1, 0);
  const apng = Buffer.concat([
    still.subarray(0, idatOffset),
    pngChunk("acTL", animationControl),
    still.subarray(idatOffset),
  ]);
  const apngResult = await optimizePngWithSharp(apng);
  assert.equal(apngResult.encoder, "original");
  assert.deepEqual(apngResult.bytes, apng);
  assert.deepEqual(apngResult.candidateFailures, ["unsupported-apng"]);

  const depth16 = sixteenBitGrayPng();
  const depthResult = await optimizePngWithSharp(depth16);
  assert.equal(depthResult.encoder, "original");
  assert.deepEqual(depthResult.bytes, depth16);
  assert.deepEqual(depthResult.candidateFailures, ["unsupported-depth:ushort"]);
});

test("oversized decoded images fail closed at the configured pixel ceiling", async () => {
  const source = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#abcdef" },
  }).png().toBuffer();
  await assert.rejects(
    optimizePngWithSharp(source, 100),
    /pixel limit|Input image exceeds pixel limit/i,
  );
});

test("local OxiPNG max+Zopfli pass is bounded and still verifies exact decoded pixels", async (context) => {
  try {
    await access(defaultOxipngBinaryPath);
  } catch {
    context.skip("version-pinned local OxiPNG is not installed on this host");
    return;
  }
  const source = await uncompressedRgbaFixture();
  const optimized = await optimizePngLocally(source, { timeoutMs: 30_000 });

  assert.ok(["accepted", "not-smaller"].includes(optimized.nativeAttempt));
  assert.ok(optimized.afterBytes <= source.length);
  await verifyLosslessPngCandidate(source, optimized.bytes);
});

test("missing native optimizer fails back to the portable verified Sharp result", async () => {
  const source = await uncompressedRgbaFixture();
  const optimized = await optimizePngLocally(source, {
    binaryPath: "/definitely/missing/sellerpilot-oxipng",
    timeoutMs: 100,
  });

  assert.equal(optimized.nativeAttempt, "error");
  assert.ok(optimized.afterBytes <= source.length);
  await verifyLosslessPngCandidate(source, optimized.bytes);
});

test("both generators compress only new final composites before receipt fingerprints", async () => {
  const [worker, server] = await Promise.all([
    readFile(new URL("../../scripts/product-ai-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../lib/server-product-studio.ts", import.meta.url), "utf8"),
  ]);
  const workerCompression = worker.indexOf("const compression = await optimizePngLocally(normalized");
  const workerFingerprint = worker.indexOf("const fingerprint = await fingerprintGeneratedShot(preset.id, normalized)", workerCompression);
  assert.ok(workerCompression > 0 && workerFingerprint > workerCompression);
  const serverCompression = server.indexOf("const compression = await optimizePngWithSharp(generated.bytes");
  const serverFingerprint = server.indexOf("const fingerprint = await fingerprintAsset(input.asset.id, bytes)", serverCompression);
  assert.ok(serverCompression > 0 && serverFingerprint > serverCompression);
  assert.doesNotMatch(worker.slice(worker.indexOf("async function loadReusableFirstDraftAssets"), worker.indexOf("async function runStudioJob")), /optimizePngLocally/);
});
