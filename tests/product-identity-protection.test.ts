import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  assertIdentityBackgroundPlate,
  assertIdentityEvidenceLinkage,
  loadVisionIdentityForeground,
  renderIdentityOnNeutralCanvas,
  renderMissingIdentityEvidence,
  type VisionCutoutReport,
} from "../lib/product-identity-protection";

const frontReport: VisionCutoutReport = {
  inputIndex: 1,
  inputRole: "extra-1",
  method: "single-instance",
  score: 42,
  textCount: 12,
  identityMatches: 2,
  productTokenCount: 2,
  productNameMatches: 2,
  brandMatches: 1,
  manufacturerMatches: 0,
  gtinExpected: false,
  gtinMatch: false,
  evidenceSignals: 1,
  instanceCount: 1,
  retainedRatio: 0.34,
  boundingCoverage: 0.95,
};

async function syntheticCutout(primarySize = 150, secondarySize = 3) {
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-identity-test-"));
  const file = join(directory, "cutout.png");
  const primary = await sharp({
    create: { width: primarySize, height: primarySize, channels: 4, background: "#1769aa" },
  }).png().toBuffer();
  const secondary = await sharp({
    create: { width: secondarySize, height: secondarySize, channels: 4, background: "#ff0000" },
  }).png().toBuffer();
  await sharp({
    create: { width: 320, height: 320, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: primary, left: Math.floor((320 - primarySize) / 2), top: Math.floor((320 - primarySize) / 2) },
    { input: secondary, left: 2, top: 2 },
  ]).png().toFile(file);
  return { directory, file };
}

test("Vision cutout keeps one dominant source-pixel component and records input provenance", async () => {
  const fixture = await syntheticCutout();
  try {
    const foreground = await loadVisionIdentityForeground(fixture.file, frontReport, "front");
    assert.equal(foreground.width, 150);
    assert.equal(foreground.height, 150);
    assert.ok(foreground.retainedPixelRatio > 0.2);
    const raw = await sharp(foreground.buffer).raw().toBuffer({ resolveWithObject: true });
    assert.equal(raw.data[0], 0x17);
    assert.equal(raw.data[1], 0x69);
    assert.equal(raw.data[2], 0xaa);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Vision cutout fails closed for ambiguous scene unions, missing name evidence and opaque all-scene masks", async () => {
  const ambiguous = await syntheticCutout(120, 80);
  const opaqueDirectory = await mkdtemp(join(tmpdir(), "sellerpilot-identity-opaque-"));
  const opaqueFile = join(opaqueDirectory, "opaque.png");
  await sharp({ create: { width: 200, height: 200, channels: 4, background: "#224466" } }).png().toFile(opaqueFile);
  try {
    await assert.rejects(loadVisionIdentityForeground(ambiguous.file, frontReport, "front"), /상품 외 장면/);
    await assert.rejects(loadVisionIdentityForeground(opaqueFile, frontReport, "front"), /장면 전체/);
    await assert.rejects(loadVisionIdentityForeground(opaqueFile, {
      ...frontReport,
      identityMatches: 0,
      productNameMatches: 0,
    }, "front"), /상품명과 일치/);
  } finally {
    await rm(ambiguous.directory, { recursive: true, force: true });
    await rm(opaqueDirectory, { recursive: true, force: true });
  }
});

test("source assets render only the verified foreground on the declared neutral canvas", async () => {
  const fixture = await syntheticCutout();
  try {
    const foreground = await loadVisionIdentityForeground(fixture.file, frontReport, "front");
    const square = aiGeneratedAssetSpecs.find((asset) => asset.id === "square");
    assert.ok(square);
    const rendered = await renderIdentityOnNeutralCanvas(foreground, square);
    const metadata = await sharp(rendered).metadata();
    assert.equal(metadata.width, square.width);
    assert.equal(metadata.height, square.height);
    assert.equal(metadata.format, "png");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("unsafe flood-fill and whole-photo identity renderers are absent", async () => {
  const source = await readFile(new URL("../lib/product-identity-protection.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /extractIdentityForeground|renderSourceIdentityAsset|cornerBackground|flood/i);
  const policies = new Map(aiGeneratedAssetSpecs.map((asset) => [asset.id, asset.identityPolicy.mode]));
  assert.equal(policies.get("hero"), "source-catalog");
  assert.equal(policies.get("square"), "source-catalog");
  assert.equal(policies.get("detail-package"), "source-evidence");
});

test("identity background plates fail closed when the reserved product zone is visually busy", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const safe = await sharp({
    create: { width: portrait.width, height: portrait.height, channels: 3, background: "#ece8df" },
  }).png().toBuffer();
  await assert.doesNotReject(assertIdentityBackgroundPlate(safe, portrait));

  const pixels = Buffer.alloc(portrait.width * portrait.height * 3);
  for (let y = 0; y < portrait.height; y += 1) {
    for (let x = 0; x < portrait.width; x += 1) {
      const value = (Math.floor(x / 48) + Math.floor(y / 48)) % 2 ? 255 : 0;
      pixels.fill(value, (y * portrait.width + x) * 3, (y * portrait.width + x) * 3 + 3);
    }
  }
  const busy = await sharp(pixels, { raw: { width: portrait.width, height: portrait.height, channels: 3 } }).png().toBuffer();
  await assert.rejects(assertIdentityBackgroundPlate(busy, portrait), /고대비 물체/);
});

test("missing dedicated package evidence renders an honest empty neutral slot", async () => {
  const packageAsset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package");
  assert.ok(packageAsset);
  const placeholder = await renderMissingIdentityEvidence(packageAsset);
  const metadata = await sharp(placeholder).metadata();
  assert.equal(metadata.width, packageAsset.width);
  assert.equal(metadata.height, packageAsset.height);
  assert.equal(metadata.format, "png");
});

test("statutory evidence with no seller-anchor identity match cannot link by packaging color", async () => {
  const fixture = await syntheticCutout();
  try {
    const foreground = await loadVisionIdentityForeground(fixture.file, frontReport, "front");
    await assert.rejects(assertIdentityEvidenceLinkage(
      { foreground, report: frontReport },
      {
        foreground,
        report: {
          ...frontReport,
          inputIndex: 8,
          inputRole: "back",
          identityMatches: 0,
          productNameMatches: 0,
          brandMatches: 1,
          manufacturerMatches: 1,
          evidenceSignals: 15,
        },
      },
    ), /고유 상품명과 브랜드·제조사/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("same-brand wrong SKU cannot satisfy front or statutory evidence identity", async () => {
  const fixture = await syntheticCutout();
  try {
    await assert.rejects(loadVisionIdentityForeground(fixture.file, {
      ...frontReport,
      productTokenCount: 3,
      productNameMatches: 1,
      brandMatches: 1,
      manufacturerMatches: 1,
    }, "front"), /상품명과 일치/);
    const foreground = await loadVisionIdentityForeground(fixture.file, frontReport, "front");
    await assert.rejects(assertIdentityEvidenceLinkage(
      { foreground, report: frontReport },
      {
        foreground,
        report: {
          ...frontReport,
          inputIndex: 4,
          inputRole: "back",
          productTokenCount: 3,
          productNameMatches: 1,
          brandMatches: 1,
          manufacturerMatches: 1,
          evidenceSignals: 9,
        },
      },
    ), /고유 상품명과 브랜드·제조사/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("confirmed GTIN statutory evidence requires an exact barcode match", async () => {
  const fixture = await syntheticCutout();
  try {
    const foreground = await loadVisionIdentityForeground(fixture.file, frontReport, "front");
    await assert.rejects(assertIdentityEvidenceLinkage(
      { foreground, report: frontReport },
      {
        foreground,
        report: {
          ...frontReport,
          inputIndex: 5,
          inputRole: "barcode",
          gtinExpected: true,
          gtinMatch: false,
        },
      },
    ), /GTIN과 정확히 일치/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
