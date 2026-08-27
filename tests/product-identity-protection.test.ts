import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  buildDifferenceHash,
  MINIMUM_SHOT_HASH_DISTANCE,
  SHOT_DHASH_COLUMNS,
  SHOT_DHASH_ROWS,
  visualHashDistance,
} from "../lib/image-shot-uniqueness";
import {
  assertIdentityBackgroundPlate,
  assertIdentityEvidenceLinkage,
  compositeIdentityForeground,
  isRepairableMissingIdentitySupportBoundary,
  loadVisionIdentityForeground,
  planIdentityEvidenceAttempt,
  repairMissingIdentitySupportSurface,
  renderIdentityEvidenceBoard,
  renderIdentityEvidencePanel,
  renderIdentityOnNeutralCanvas,
  renderMissingIdentityEvidence,
  selectCanonicalWholeProductIdentityView,
  type IdentityForeground,
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

async function syntheticEvidenceForeground(
  sourceDigest: string,
  bodyColor: string,
  accentColor: string,
  accentSide: "left" | "right",
): Promise<IdentityForeground> {
  const body = await sharp({
    create: { width: 230, height: 410, channels: 4, background: bodyColor },
  }).png().toBuffer();
  const accent = await sharp({
    create: { width: 46, height: 330, channels: 4, background: accentColor },
  }).png().toBuffer();
  const buffer = await sharp({
    create: { width: 340, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: body, left: 55, top: 45 },
    { input: accent, left: accentSide === "left" ? 72 : 222, top: 84 },
  ]).png().toBuffer();
  return {
    buffer,
    width: 340,
    height: 500,
    sourceDigest,
    retainedPixelRatio: 0.55,
  };
}

async function syntheticSolidEvidenceForeground(
  sourceDigest: string,
  color: string,
  width: number,
  height: number,
): Promise<IdentityForeground> {
  return {
    buffer: await sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer(),
    width,
    height,
    sourceDigest,
    retainedPixelRatio: 0.55,
  };
}

async function shotHash(buffer: Buffer) {
  const pixels = await sharp(buffer)
    .resize(SHOT_DHASH_COLUMNS + 1, SHOT_DHASH_ROWS, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer();
  return buildDifferenceHash(pixels);
}

async function syntheticSurfacePlate(
  spec: { width: number; height: number },
  {
    seamY,
    diagonalRise = 0,
    verticalIntrusion = false,
    transitionWidth = 0,
    samePlaneStripe = false,
  }: {
    seamY: number;
    diagonalRise?: number;
    verticalIntrusion?: boolean;
    transitionWidth?: number;
    samePlaneStripe?: boolean;
  },
) {
  const pixels = Buffer.alloc(spec.width * spec.height * 3);
  const intrusionX = Math.round(spec.width * 0.38);
  const backingColor = [228, 223, 215];
  const supportColor = [184, 170, 154];
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      const localSeamY = seamY + Math.round((x / Math.max(1, spec.width - 1) - 0.5) * diagonalRise);
      const transition = transitionWidth > 0
        ? Math.min(1, Math.max(0, (y - (localSeamY - transitionWidth / 2)) / transitionWidth))
        : Number(y >= localSeamY);
      let color = backingColor.map((channel, index) => Math.round(
        channel * (1 - transition) + supportColor[index] * transition,
      ));
      if (samePlaneStripe) color = Math.abs(y - localSeamY) <= 1 ? supportColor : backingColor;
      if (verticalIntrusion && y >= localSeamY && x >= intrusionX) color = [92, 78, 66];
      const offset = (y * spec.width + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return sharp(pixels, { raw: { width: spec.width, height: spec.height, channels: 3 } }).png().toBuffer();
}

async function assertReservedZoneFailure(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error);
    const reservedZoneError = error as Error & {
      failedDimensions?: string[];
      retryAuditFeedback?: { failedDimensions?: string[] };
      safeForRetryComparison?: boolean;
    };
    assert.match(reservedZoneError.message, /reserved-zone/);
    assert.deepEqual(reservedZoneError.failedDimensions, ["reserved-zone"]);
    assert.deepEqual(reservedZoneError.retryAuditFeedback?.failedDimensions, ["reserved-zone"]);
    assert.equal(reservedZoneError.safeForRetryComparison, undefined);
    return true;
  });
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

test("whole-product assets require the single-instance canonical subject and ignore partial label views", async () => {
  const wide = aiGeneratedAssetSpecs.find((asset) => asset.id === "wide");
  const square = aiGeneratedAssetSpecs.find((asset) => asset.id === "square");
  assert.ok(wide);
  assert.ok(square);
  const canonicalWhole = {
    foreground: await syntheticSolidEvidenceForeground("c".repeat(64), "#173d70", 420, 260),
    report: { ...frontReport, inputRole: "front", method: "single-instance" as const, instanceCount: 1 },
  };
  const partialLabel = {
    foreground: await syntheticSolidEvidenceForeground("d".repeat(64), "#275d9a", 220, 180),
    report: { ...frontReport, inputIndex: 0, inputRole: "main", method: "rectangle" as const },
  };

  const statutoryCutouts = {
    canonicalWhole,
    canonicalCompletenessProof: "front-full-instance" as const,
    front: canonicalWhole,
    statutoryIdentity: true,
  };
  assert.strictEqual(selectCanonicalWholeProductIdentityView(statutoryCutouts, wide), canonicalWhole);
  assert.strictEqual(selectCanonicalWholeProductIdentityView(statutoryCutouts, square), canonicalWhole);
  assert.throws(
    () => selectCanonicalWholeProductIdentityView({
      canonicalWhole: partialLabel,
      canonicalCompletenessProof: "front-full-instance",
      front: canonicalWhole,
      statutoryIdentity: true,
    }, wide),
    /완전한 canonical 정면 상품 컷아웃/,
  );
});

test("statutory canonical subjects require same-source identity linkage and complete single-instance geometry", async () => {
  const wide = aiGeneratedAssetSpecs.find((asset) => asset.id === "wide");
  assert.ok(wide);
  const foreground = await syntheticSolidEvidenceForeground("f".repeat(64), "#173d70", 420, 260);
  const front = { foreground, report: { ...frontReport, inputRole: "front" } };
  const valid = { foreground, report: { ...frontReport, inputRole: "front" } };
  assert.doesNotThrow(() => selectCanonicalWholeProductIdentityView({
    canonicalWhole: valid,
    canonicalCompletenessProof: "front-full-instance",
    front,
    statutoryIdentity: true,
  }, wide));

  const lowCoverageWholeSubject = {
    ...valid,
    report: { ...valid.report, boundingCoverage: 0.89 },
  };
  assert.throws(() => selectCanonicalWholeProductIdentityView({
    canonicalWhole: lowCoverageWholeSubject,
    canonicalCompletenessProof: "front-full-instance",
    front,
    statutoryIdentity: true,
  }, wide), /완전한 canonical 정면 상품 컷아웃/);
  assert.doesNotThrow(() => selectCanonicalWholeProductIdentityView({
    canonicalWhole: lowCoverageWholeSubject,
    canonicalCompletenessProof: "subject-full-instance",
    front,
    statutoryIdentity: true,
  }, wide));

  const invalidCanonicalViews = [
    { ...valid, report: { ...valid.report, inputIndex: 9 } },
    { ...valid, report: { ...valid.report, productNameMatches: 0, gtinMatch: false } },
    { ...valid, report: { ...valid.report, method: "rectangle" as const } },
    { ...valid, report: { ...valid.report, instanceCount: 2 } },
    { ...valid, report: { ...valid.report, boundingCoverage: 0.3 } },
    { ...valid, report: { ...valid.report, boundingCoverage: 1.02 } },
    { ...valid, foreground: { ...foreground, retainedPixelRatio: 0.99 } },
    { ...valid, foreground: { ...foreground, width: 100 } },
  ];
  for (const canonicalWhole of invalidCanonicalViews) {
    assert.throws(() => selectCanonicalWholeProductIdentityView({
      canonicalWhole,
      canonicalCompletenessProof: "front-full-instance",
      front,
      statutoryIdentity: true,
    }, wide), /완전한 canonical 정면 상품 컷아웃/);
  }

  const unlabelledSingleSubject = {
    ...valid,
    report: { ...valid.report, productNameMatches: 0, brandMatches: 0, gtinMatch: false },
  };
  assert.doesNotThrow(() => selectCanonicalWholeProductIdentityView({
    canonicalWhole: unlabelledSingleSubject,
    canonicalCompletenessProof: "subject-full-instance",
    front: unlabelledSingleSubject,
    statutoryIdentity: false,
  }, wide));
});

test("source-composite places the canonical product bottom on the audited support contact line", async () => {
  const wide = aiGeneratedAssetSpecs.find((asset) => asset.id === "wide");
  assert.ok(wide);
  const foreground = await syntheticSolidEvidenceForeground("e".repeat(64), "#d62626", 420, 200);
  const background = await sharp({
    create: { width: wide.width, height: wide.height, channels: 3, background: "#f2f2f2" },
  }).png().toBuffer();
  const rendered = await compositeIdentityForeground(background, foreground, wide);
  const pixels = await sharp(rendered).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let maximumProductY = -1;
  for (let y = 0; y < pixels.info.height; y += 1) {
    for (let x = 0; x < pixels.info.width; x += 1) {
      const offset = (y * pixels.info.width + x) * pixels.info.channels;
      if (pixels.data[offset] > 140 && pixels.data[offset + 1] < 90 && pixels.data[offset + 2] < 90) {
        maximumProductY = y;
      }
    }
  }
  const expectedContactY = Math.round(wide.height * wide.identityPolicy.placement.top)
    + Math.round(wide.height * wide.identityPolicy.placement.height) - 1;
  assert.ok(maximumProductY >= expectedContactY - 1 && maximumProductY <= expectedContactY);

  const suspended = await compositeIdentityForeground(background, foreground, wide, "suspended-or-planar");
  const suspendedPixels = await sharp(suspended).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let suspendedMaximumProductY = -1;
  for (let y = 0; y < suspendedPixels.info.height; y += 1) {
    for (let x = 0; x < suspendedPixels.info.width; x += 1) {
      const offset = (y * suspendedPixels.info.width + x) * suspendedPixels.info.channels;
      if (suspendedPixels.data[offset] > 140
          && suspendedPixels.data[offset + 1] < 90
          && suspendedPixels.data[offset + 2] < 90) {
        suspendedMaximumProductY = y;
      }
    }
  }
  assert.ok(suspendedMaximumProductY < expectedContactY - 100);
  await assert.rejects(
    compositeIdentityForeground(background, foreground, wide, "unknown" as "surface-supported"),
    /접촉 방식이 올바르지/,
  );
});

test("ACV-like single package evidence escapes square and rejected centered views through deterministic asymmetric panels", async () => {
  const square = aiGeneratedAssetSpecs.find((asset) => asset.id === "square");
  const packageAsset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package");
  assert.ok(square);
  assert.ok(packageAsset);
  const sources = [
    await syntheticSolidEvidenceForeground("1".repeat(64), "#4d5865", 300, 300),
    await syntheticSolidEvidenceForeground("2".repeat(64), "#9a3038", 210, 300),
  ];
  const squareImage = await renderIdentityOnNeutralCanvas(sources[0], square);
  const centeredPackage = await renderIdentityOnNeutralCanvas(sources[0], packageAsset);
  const panels = await Promise.all([1, 2, 3].map((variant) => (
    renderIdentityEvidencePanel(sources[0], packageAsset, variant)
  )));
  const repeatedFirstPanel = await renderIdentityEvidencePanel(sources[0], packageAsset, 1);
  assert.deepEqual(repeatedFirstPanel, panels[0], "the same source provenance and panel variant must be byte deterministic");
  const [squareHash, centeredPackageHash, ...panelHashes] = await Promise.all([
    squareImage,
    centeredPackage,
    ...panels,
  ].map(shotHash));
  assert.ok(visualHashDistance(centeredPackageHash, squareHash) < MINIMUM_SHOT_HASH_DISTANCE);
  for (const panelHash of panelHashes) {
    assert.ok(visualHashDistance(panelHash, squareHash) >= MINIMUM_SHOT_HASH_DISTANCE);
    assert.ok(visualHashDistance(panelHash, centeredPackageHash) >= MINIMUM_SHOT_HASH_DISTANCE);
  }
  for (let left = 0; left < panelHashes.length; left += 1) {
    for (let right = left + 1; right < panelHashes.length; right += 1) {
      assert.ok(visualHashDistance(panelHashes[left], panelHashes[right]) >= MINIMUM_SHOT_HASH_DISTANCE);
    }
  }
  for (const panel of panels) {
    const metadata = await sharp(panel).metadata();
    assert.equal(metadata.width, packageAsset.width);
    assert.equal(metadata.height, packageAsset.height);
    assert.equal(metadata.format, "png");
  }
});

test("two package evidence sources retain the second full view and two deterministic boards", async () => {
  const square = aiGeneratedAssetSpecs.find((asset) => asset.id === "square");
  const packageAsset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package");
  assert.ok(square);
  assert.ok(packageAsset);
  const sources = [
    await syntheticSolidEvidenceForeground("1".repeat(64), "#4d5865", 300, 300),
    await syntheticSolidEvidenceForeground("2".repeat(64), "#9a3038", 210, 300),
  ];
  const squareImage = await renderIdentityOnNeutralCanvas(sources[0], square);
  const boards = await Promise.all([1, 2].map((variant) => (
    renderIdentityEvidenceBoard(sources, packageAsset, variant)
  )));
  const repeatedFirstBoard = await renderIdentityEvidenceBoard(sources, packageAsset, 1);
  assert.deepEqual(repeatedFirstBoard, boards[0], "the same evidence provenance and variant must be byte deterministic");
  const [squareHash, ...boardHashes] = await Promise.all([
    squareImage,
    ...boards,
  ].map(shotHash));
  assert.ok(boardHashes.every((hash) => visualHashDistance(hash, squareHash) >= MINIMUM_SHOT_HASH_DISTANCE));
  for (let left = 0; left < boardHashes.length; left += 1) {
    for (let right = left + 1; right < boardHashes.length; right += 1) {
      assert.ok(visualHashDistance(boardHashes[left], boardHashes[right]) >= MINIMUM_SHOT_HASH_DISTANCE);
    }
  }
  for (const board of boards) {
    const metadata = await sharp(board).metadata();
    assert.equal(metadata.width, packageAsset.width);
    assert.equal(metadata.height, packageAsset.height);
    assert.equal(metadata.format, "png");
  }
});

test("package evidence attempt plans stay bounded without duplicating a one-source product", () => {
  assert.deepEqual(
    [1, 2, 3, 4].map((attempt) => planIdentityEvidenceAttempt(1, attempt)),
    [
      { mode: "full-view", sourceIndexes: [0], variant: 0 },
      { mode: "single-source-panel", sourceIndexes: [0], variant: 1 },
      { mode: "single-source-panel", sourceIndexes: [0], variant: 2 },
      { mode: "single-source-panel", sourceIndexes: [0], variant: 3 },
    ],
  );
  assert.deepEqual(
    [1, 2, 3, 4].map((attempt) => planIdentityEvidenceAttempt(2, attempt)),
    [
      { mode: "full-view", sourceIndexes: [0], variant: 0 },
      { mode: "full-view", sourceIndexes: [1], variant: 0 },
      { mode: "two-source-board", sourceIndexes: [0, 1], variant: 1 },
      { mode: "two-source-board", sourceIndexes: [0, 1], variant: 2 },
    ],
  );
  assert.equal(planIdentityEvidenceAttempt(0, 1), null);
  assert.equal(planIdentityEvidenceAttempt(1, 5), null);
});

test("package evidence fallback refuses one source or two copies of the same verified source", async () => {
  const packageAsset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package");
  assert.ok(packageAsset);
  const source = await syntheticEvidenceForeground("a".repeat(64), "#153f73", "#f2c84b", "left");
  await assert.rejects(renderIdentityEvidenceBoard([source], packageAsset, 1), /서로 다른 검증 원본 이미지가 2장/);
  await assert.rejects(renderIdentityEvidenceBoard([source, { ...source }], packageAsset, 1), /서로 다른 검증 원본 이미지가 2장/);
});

test("unsafe flood-fill and whole-photo identity renderers are absent", async () => {
  const source = await readFile(new URL("../lib/product-identity-protection.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /extractIdentityForeground|renderSourceIdentityAsset|cornerBackground|flood/i);
  const panelRenderer = source.match(/export async function renderIdentityEvidencePanel[\s\S]+?\n}\n\n\/\*\*[\s\S]*?export async function renderIdentityEvidenceBoard/)?.[0] ?? "";
  assert.match(panelRenderer, /fit: "inside"/);
  assert.equal([...panelRenderer.matchAll(/input: source\.data/g)].length, 1);
  assert.doesNotMatch(panelRenderer, /\.extract\(|\.rotate\(|\.flip\(|\.flop\(|text:/);
  const boardRenderer = source.match(/export async function renderIdentityEvidenceBoard[\s\S]+?\n}\n\nexport async function renderMissingIdentityEvidence/)?.[0] ?? "";
  assert.match(boardRenderer, /fit: "inside"/);
  assert.match(boardRenderer, /distinctSources\.map[\s\S]*sourceBuffers\.map/);
  assert.doesNotMatch(boardRenderer, /\.extract\(|\.rotate\(|\.flip\(|\.flop\(/);
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
  await assert.doesNotReject(assertIdentityBackgroundPlate(safe, portrait, "suspended-or-planar"));

  const opaqueRgba = await sharp({
    create: {
      width: portrait.width,
      height: portrait.height,
      channels: 4,
      background: { r: 236, g: 232, b: 223, alpha: 1 },
    },
  }).png().toBuffer();
  await assert.doesNotReject(assertIdentityBackgroundPlate(opaqueRgba, portrait, "suspended-or-planar"));

  for (const alpha of [0, 253 / 255]) {
    const transparent = await sharp({
      create: {
        width: portrait.width,
        height: portrait.height,
        channels: 4,
        background: { r: 236, g: 232, b: 223, alpha },
      },
    }).png().toBuffer();
    await assert.rejects(assertIdentityBackgroundPlate(transparent, portrait, "suspended-or-planar"), /완전히 불투명/);
  }

  const cornerPixels = await sharp(opaqueRgba).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  cornerPixels.data[3] = 254;
  const transparentCorner = await sharp(cornerPixels.data, {
    raw: {
      width: cornerPixels.info.width,
      height: cornerPixels.info.height,
      channels: cornerPixels.info.channels,
    },
  }).png().toBuffer();
  await assert.rejects(assertIdentityBackgroundPlate(transparentCorner, portrait, "suspended-or-planar"), /완전히 불투명/);

  const pixels = Buffer.alloc(portrait.width * portrait.height * 3);
  for (let y = 0; y < portrait.height; y += 1) {
    for (let x = 0; x < portrait.width; x += 1) {
      const value = (Math.floor(x / 48) + Math.floor(y / 48)) % 2 ? 255 : 0;
      pixels.fill(value, (y * portrait.width + x) * 3, (y * portrait.width + x) * 3 + 3);
    }
  }
  const busy = await sharp(pixels, { raw: { width: portrait.width, height: portrait.height, channels: 3 } }).png().toBuffer();
  await assert.rejects(assertIdentityBackgroundPlate(busy, portrait, "suspended-or-planar"), /고대비 물체/);
});

test("surface-supported background plates require one horizontal seam inside the contact band", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const spec = { ...portrait, width: 320, height: 400 };
  const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
  const supported = await syntheticSurfacePlate(spec, { seamY: contactY });
  await assert.doesNotReject(assertIdentityBackgroundPlate(supported, spec, "surface-supported"));
});

test("final support fallback repairs only a missing boundary and preserves candidate-specific outer pixels", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const spec = { ...portrait, width: 320, height: 400 };
  const candidates = await Promise.all(["#d8cbb8", "#314b60"].map((background) => sharp({
    create: { width: spec.width, height: spec.height, channels: 3, background },
  }).png().toBuffer()));

  for (const candidate of candidates) {
    await assert.rejects(
      assertIdentityBackgroundPlate(candidate, spec, "surface-supported"),
      (error: unknown) => isRepairableMissingIdentitySupportBoundary(error),
    );
  }

  const repaired = await Promise.all(candidates.map((candidate) => (
    repairMissingIdentitySupportSurface(candidate, spec)
  )));
  await Promise.all(repaired.map((candidate) => (
    assertIdentityBackgroundPlate(candidate, spec, "surface-supported")
  )));
  assert.notEqual(
    createHash("sha256").update(repaired[0]).digest("hex"),
    createHash("sha256").update(repaired[1]).digest("hex"),
    "the fallback palette and texture must remain derived from each generated candidate",
  );

  const [originalPixels, repairedPixels] = await Promise.all([
    sharp(candidates[0]).removeAlpha().raw().toBuffer(),
    sharp(repaired[0]).removeAlpha().raw().toBuffer(),
  ]);
  const outsideReservedZoneOffset = ((20 * spec.width) + 20) * 3;
  assert.deepEqual(
    repairedPixels.subarray(outsideReservedZoneOffset, outsideReservedZoneOffset + 3),
    originalPixels.subarray(outsideReservedZoneOffset, outsideReservedZoneOffset + 3),
    "outer architecture above the support plane must remain pixel-identical",
  );
  const preservedReservedUpperOffset = ((80 * spec.width) + 120) * 3;
  assert.deepEqual(
    repairedPixels.subarray(preservedReservedUpperOffset, preservedReservedUpperOffset + 3),
    originalPixels.subarray(preservedReservedUpperOffset, preservedReservedUpperOffset + 3),
    "the fallback must not flatten the already-safe upper product backing",
  );
});

test("stripe and intrusion failures are never eligible for the missing-support fallback", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const spec = { ...portrait, width: 320, height: 400 };
  const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
  const unsafe = [
    await syntheticSurfacePlate(spec, { seamY: contactY, samePlaneStripe: true }),
    await syntheticSurfacePlate(spec, { seamY: contactY, verticalIntrusion: true }),
  ];
  for (const candidate of unsafe) {
    await assert.rejects(assertIdentityBackgroundPlate(candidate, spec, "surface-supported"), (error: unknown) => {
      assert.equal(isRepairableMissingIdentitySupportBoundary(error), false);
      return true;
    });
  }
});

test("surface-supported background plates reject a seam outside the contact band", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const spec = { ...portrait, width: 320, height: 400 };
  const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
  const misplaced = await syntheticSurfacePlate(spec, { seamY: contactY - 18 });
  await assertReservedZoneFailure(assertIdentityBackgroundPlate(misplaced, spec, "surface-supported"));
});

test("surface-supported background plates reject a contact-band edge seam that cannot meet the fixed composite bottom", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const spec = { ...portrait, width: 320, height: 400 };
  const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
  const bandEdge = await syntheticSurfacePlate(spec, { seamY: contactY + 7 });
  await assertReservedZoneFailure(assertIdentityBackgroundPlate(bandEdge, spec, "surface-supported"));
});

test("portrait and wide plates reject a same-plane stripe at the nominal contact line", async () => {
  for (const assetId of ["portrait", "wide"] as const) {
    const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    assert.ok(asset);
    const dimensions = assetId === "portrait" ? { width: 320, height: 400 } : { width: 480, height: 270 };
    const spec = { ...asset, ...dimensions };
    const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
    const stripe = await syntheticSurfacePlate(spec, { seamY: contactY, samePlaneStripe: true });
    await assertReservedZoneFailure(assertIdentityBackgroundPlate(stripe, spec, "surface-supported"));
  }
});

test("portrait and wide plates accept a 1.2 percent soft support transition as one gradient ridge", async () => {
  for (const assetId of ["portrait", "wide"] as const) {
    const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    assert.ok(asset);
    const dimensions = assetId === "portrait" ? { width: 320, height: 400 } : { width: 480, height: 270 };
    const spec = { ...asset, ...dimensions };
    const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
    const soft = await syntheticSurfacePlate(spec, {
      seamY: contactY,
      transitionWidth: Math.max(3, Math.round(spec.height * 0.012)),
    });
    await assert.doesNotReject(assertIdentityBackgroundPlate(soft, spec, "surface-supported"));
  }
});

test("surface-supported background plates reject a diagonal contact seam", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const spec = { ...portrait, width: 320, height: 400 };
  const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
  const diagonal = await syntheticSurfacePlate(spec, { seamY: contactY, diagonalRise: 30 });
  await assertReservedZoneFailure(assertIdentityBackgroundPlate(diagonal, spec, "surface-supported"));
});

test("surface-supported background plates reject a long vertical edge below the seam", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const spec = { ...portrait, width: 320, height: 400 };
  const contactY = Math.round(spec.height * (spec.identityPolicy.placement.top + spec.identityPolicy.placement.height));
  const intruded = await syntheticSurfacePlate(spec, { seamY: contactY, verticalIntrusion: true });
  await assertReservedZoneFailure(assertIdentityBackgroundPlate(intruded, spec, "surface-supported"));
});

test("suspended-or-planar background plates do not require a support seam", async () => {
  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const flat = await sharp({
    create: { width: 320, height: 400, channels: 3, background: "#e8e4dc" },
  }).png().toBuffer();
  await assert.doesNotReject(assertIdentityBackgroundPlate(
    flat,
    { ...portrait, width: 320, height: 400 },
    "suspended-or-planar",
  ));
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

test("missing package and contents evidence render distinct honest placeholders", async () => {
  const assets = ["detail-package", "detail-contents"].map((id) => aiGeneratedAssetSpecs.find((asset) => asset.id === id));
  assert.ok(assets.every(Boolean));
  const hashes = await Promise.all(assets.map(async (asset) => {
    const placeholder = await renderMissingIdentityEvidence(asset!);
    const pixels = await sharp(placeholder)
      .resize(SHOT_DHASH_COLUMNS + 1, SHOT_DHASH_ROWS, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    return buildDifferenceHash(pixels);
  }));
  assert.ok(visualHashDistance(hashes[0], hashes[1]) >= MINIMUM_SHOT_HASH_DISTANCE);
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

test("a non-statutory dedicated alternate view still requires one linked product instance", async () => {
  const fixture = await syntheticCutout();
  try {
    await assert.rejects(loadVisionIdentityForeground(fixture.file, {
      ...frontReport,
      inputIndex: 7,
      inputRole: "back",
      instanceCount: 2,
    }, "alternate"), /단일 상품/);
    const foreground = await loadVisionIdentityForeground(fixture.file, frontReport, "front");
    await assert.doesNotReject(assertIdentityEvidenceLinkage(
      { foreground, report: frontReport },
      {
        foreground,
        report: {
          ...frontReport,
          inputIndex: 7,
          inputRole: "back",
          gtinExpected: false,
          gtinMatch: false,
        },
      },
      "evidence",
    ));
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
