import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  assertSourcePixelLabelBaseline,
  batchImageLabelFidelityReferencePaths,
  buildImageLabelFidelitySwiftArguments,
  evaluateImageLabelFidelityReport,
  imageLabelPixelDigest,
  mergeImageLabelFidelityReports,
} from "../lib/image-label-fidelity";

// ISO/IEC 15417 Code 128 patterns. Stop (106) is 13 modules; all others are 11.
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

function code128ModuleBits(payload: string): number[] {
  const codes = [104];
  for (const character of payload) {
    const code = character.charCodeAt(0) - 32;
    if (code < 0 || code > 94) {
      throw new Error(`unsupported Code 128 character ${character}`);
    }
    codes.push(code);
  }
  let checksum = codes[0];
  for (let index = 1; index < codes.length; index += 1) checksum += codes[index] * index;
  codes.push(checksum % 103, 106);
  const modules: number[] = [];
  const quiet = 12;
  for (let index = 0; index < quiet; index += 1) modules.push(0);
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    let bar = 1;
    for (const digit of pattern) {
      const run = Number(digit);
      for (let index = 0; index < run; index += 1) modules.push(bar);
      bar ^= 1;
    }
  }
  for (let index = 0; index < quiet; index += 1) modules.push(0);
  return modules;
}

async function writeCode128Png(outputPath: string, payload: string) {
  const modules = code128ModuleBits(payload);
  const moduleWidth = 5;
  const height = 160;
  const width = modules.length * moduleWidth;
  const raw = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (!modules[x]) continue;
      for (let k = 0; k < moduleWidth; k += 1) {
        const offset = (y * width + x * moduleWidth + k) * 3;
        raw[offset] = 0;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
      }
    }
  }
  await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(outputPath);
}

test("source-protected assets require a byte-identical target-scale label baseline", () => {
  const baseline = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
  const expectedDigest = imageLabelPixelDigest(baseline);
  assert.match(assertSourcePixelLabelBaseline({
    assetId: "hero",
    expectedDigest,
    baseline,
    candidate: Buffer.from(baseline),
  }), /^[a-f0-9]{64}$/);
  assert.throws(() => assertSourcePixelLabelBaseline({
    assetId: "hero",
    expectedDigest,
    baseline,
    candidate: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x03]),
  }), /원본 픽셀 기준 이미지와 최종 이미지가 일치하지 않습니다/);
  assert.throws(() => assertSourcePixelLabelBaseline({
    assetId: "hero",
    expectedDigest,
    baseline,
    candidate: Buffer.from([0x89, 0x50]),
  }), /원본 픽셀 기준 이미지와 최종 이미지가 일치하지 않습니다/);
  assert.throws(() => assertSourcePixelLabelBaseline({
    assetId: "hero",
    expectedDigest,
    baseline: Buffer.from("swapped"),
    candidate: Buffer.from("swapped"),
  }), /원본 픽셀 기준 이미지와 최종 이미지가 일치하지 않습니다/);
});

test("label fidelity batches up to one hundred references and merges their token union", () => {
  const paths = Array.from({ length: 100 }, (_, index) => `/tmp/reference-${index}.png`);
  const batches = batchImageLabelFidelityReferencePaths("/tmp/baseline.png", paths);
  assert.equal(batches.length, 10);
  assert.ok(batches.every((batch) => batch.length === 10));
  assert.deepEqual(new Set(batches.flat()).size, 100);

  const merged = mergeImageLabelFidelityReports([
    { referenceTokens: ["SAJO", "150g"], requiredTokens: ["SAJO"], candidateTokens: ["SAJO", "150g"] },
    { referenceTokens: ["참치", "150g"], requiredTokens: ["SAJO"], candidateTokens: ["150g", "SAJO"] },
  ]);
  assert.deepEqual(merged.referenceTokens, ["SAJO", "150g"]);
  const evaluated = evaluateImageLabelFidelityReport(merged);
  assert.equal(evaluated.passed, true);
  assert.throws(() => mergeImageLabelFidelityReports([
    { referenceTokens: ["SAJO"], requiredTokens: ["SAJO"], candidateTokens: ["SAJO"] },
    { referenceTokens: ["SAJO"], requiredTokens: ["SAJO"], candidateTokens: ["Sajo"] },
  ]), /배치별로 일치하지 않습니다/);

  const noisyReports = Array.from({ length: 10 }, (_, batch) => ({
    referenceTokens: [
      ...Array.from({ length: 60 }, (_, index) => `unrelated-${batch}-${index}`),
      ...(batch === 9 ? ["SAJO", "150g"] : []),
    ],
    requiredTokens: ["SAJO"],
    candidateTokens: ["SAJO", "150g"],
  }));
  const noisyMerged = mergeImageLabelFidelityReports(noisyReports);
  assert.deepEqual(noisyMerged.referenceTokens, ["SAJO", "150g"]);
  assert.equal(evaluateImageLabelFidelityReport(noisyMerged).passed, true);
});

test("label fidelity passes only an exact non-empty protected-token match", () => {
  const result = evaluateImageLabelFidelityReport({
    referenceTokens: ["BeyondOrigin", "500mg"],
    requiredTokens: ["BeyondOrigin"],
    candidateTokens: ["BeyondOrigin", "500mg"],
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.failureReasons, []);
});

test("label fidelity fails closed when reference, selected source or candidate OCR is empty", () => {
  const emptyReference = evaluateImageLabelFidelityReport({ referenceTokens: [], requiredTokens: [], candidateTokens: ["BeyondOrigin"] });
  assert.equal(emptyReference.passed, false);
  assert.ok(emptyReference.failureReasons.includes("reference-token-empty"));
  assert.ok(emptyReference.failureReasons.includes("required-token-empty"));

  const emptyRequired = evaluateImageLabelFidelityReport({ referenceTokens: ["BeyondOrigin"], requiredTokens: [], candidateTokens: ["BeyondOrigin"] });
  assert.equal(emptyRequired.passed, false);
  assert.ok(emptyRequired.failureReasons.includes("required-token-empty"));

  const emptyCandidate = evaluateImageLabelFidelityReport({ referenceTokens: ["BeyondOrigin"], requiredTokens: ["BeyondOrigin"], candidateTokens: [] });
  assert.equal(emptyCandidate.passed, false);
  assert.ok(emptyCandidate.failureReasons.includes("candidate-token-empty"));
  assert.deepEqual(emptyCandidate.missingTokens, ["BeyondOrigin"]);
});

test("label fidelity rejects omission, invented tokens and English brand case mutation", () => {
  const omitted = evaluateImageLabelFidelityReport({
    referenceTokens: ["BeyondOrigin", "500mg"],
    requiredTokens: ["BeyondOrigin"],
    candidateTokens: ["500mg"],
  });
  assert.equal(omitted.passed, false);
  assert.deepEqual(omitted.missingTokens, ["BeyondOrigin"]);

  const recased = evaluateImageLabelFidelityReport({
    referenceTokens: ["BeyondOrigin"],
    requiredTokens: ["BeyondOrigin"],
    candidateTokens: ["Beyondorigin"],
    unsupportedTokens: [],
    missingTokens: [],
  });
  assert.equal(recased.passed, false);
  assert.deepEqual(recased.missingTokens, ["BeyondOrigin"]);
  assert.deepEqual(recased.unsupportedTokens, ["Beyondorigin"]);

  const invalidRequiredSource = evaluateImageLabelFidelityReport({
    referenceTokens: ["BeyondOrigin"],
    requiredTokens: ["DifferentSource"],
    candidateTokens: ["DifferentSource"],
  });
  assert.equal(invalidRequiredSource.passed, false);
  assert.ok(invalidRequiredSource.failureReasons.includes("required-token-not-in-reference"));
});

test("label fidelity fails closed instead of truncating token arrays", () => {
  const referenceTokens = Array.from({ length: 513 }, (_, index) => `Token${index}`);
  const result = evaluateImageLabelFidelityReport({
    referenceTokens,
    requiredTokens: referenceTokens,
    candidateTokens: referenceTokens,
    unsupportedTokens: [],
    missingTokens: [],
  });
  assert.equal(result.passed, false);
  assert.ok(result.failureReasons.includes("token-count-overflow"));
});

test("source-pixel crop evidence requires visible text when the selected source has text and never invents a token", () => {
  const cropped = evaluateImageLabelFidelityReport({
    referenceTokens: ["BeyondOrigin", "500mg"],
    requiredTokens: ["BeyondOrigin", "500mg"],
    candidateTokens: ["BeyondOrigin"],
    unsupportedTokens: [],
    missingTokens: ["500mg"],
  }, { allowMissingRequiredTokens: true, allowEmptySourceText: true });
  assert.equal(cropped.passed, true);

  const blankLabel = evaluateImageLabelFidelityReport({
    referenceTokens: ["BeyondOrigin", "500mg"],
    requiredTokens: ["BeyondOrigin", "500mg"],
    candidateTokens: [],
    unsupportedTokens: [],
    missingTokens: ["BeyondOrigin", "500mg"],
  }, { allowMissingRequiredTokens: true, allowEmptySourceText: true });
  assert.equal(blankLabel.passed, false);
  assert.ok(blankLabel.failureReasons.includes("candidate-token-empty"));

  const genuinelyTextless = evaluateImageLabelFidelityReport({
    referenceTokens: [],
    requiredTokens: [],
    candidateTokens: [],
    unsupportedTokens: [],
    missingTokens: [],
  }, { allowMissingRequiredTokens: true, allowEmptySourceText: true });
  assert.equal(genuinelyTextless.passed, true);

  const invented = evaluateImageLabelFidelityReport({
    referenceTokens: ["BeyondOrigin", "500mg"],
    requiredTokens: ["BeyondOrigin", "500mg"],
    candidateTokens: ["BeyondOrigins"],
    unsupportedTokens: ["BeyondOrigins"],
    missingTokens: ["BeyondOrigin", "500mg"],
  }, { allowMissingRequiredTokens: true, allowEmptySourceText: true });
  assert.equal(invented.passed, false);
  assert.ok(invented.failureReasons.includes("unsupported-token"));
});

test("Swift arguments keep the exact selected source separate from the allowed reference union", () => {
  const args = buildImageLabelFidelitySwiftArguments({
    candidatePath: "/tmp/candidate.png",
    requiredReferencePath: "/tmp/back.png",
    referencePaths: ["/tmp/main.png", "/tmp/back.png", "/tmp/label.png"],
  });
  assert.deepEqual(args.slice(0, 4), [
    "--candidate", "/tmp/candidate.png",
    "--required-reference", "/tmp/back.png",
  ]);
  const references = args.flatMap((value, index) => value === "--reference" ? [args[index + 1]] : []);
  assert.deepEqual(references, ["/tmp/back.png", "/tmp/main.png", "/tmp/label.png"]);
  assert.throws(() => buildImageLabelFidelitySwiftArguments({
    candidatePath: "/tmp/candidate.png",
    requiredReferencePath: "/tmp/main.png",
    referencePaths: Array.from({ length: 12 }, (_, index) => `/tmp/reference-${index}.png`),
  }), /최대 12장/);
});

test("Swift token extraction preserves camel-case brand and unit case", { skip: !existsSync("/usr/bin/swift") }, () => {
  const script = new URL("../scripts/image-label-fidelity.swift", import.meta.url).pathname;
  const result = spawnSync("/usr/bin/swift", [
    script,
    "--compare-text",
    "--candidate", "BeyondOrigin 500mg",
    "--required-reference", "BeyondOrigin 500mg",
    "--reference", "BeyondOrigin 500mg",
    "--reference", "LOTTE 315g",
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { requiredTokens: string[]; candidateTokens: string[]; unsupportedTokens: string[]; missingTokens: string[] };
  assert.ok(report.requiredTokens.includes("BeyondOrigin"));
  assert.ok(report.requiredTokens.includes("500mg"));
  assert.deepEqual(report.unsupportedTokens, []);
  assert.deepEqual(report.missingTokens, []);
});

test("a package board permits the other canonical source tokens while validating one required source", { skip: !existsSync("/usr/bin/swift") }, () => {
  const script = new URL("../scripts/image-label-fidelity.swift", import.meta.url).pathname;
  const sourceA = "ACV Apple Cider Vinegar 500ml";
  const sourceB = "LOT 20260827 8801234567890";
  const candidate = `${sourceA} ${sourceB}`;
  const result = spawnSync("/usr/bin/swift", [
    script,
    "--compare-text",
    "--candidate", candidate,
    "--required-reference", sourceA,
    "--reference", sourceA,
    "--reference", sourceB,
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const evaluated = evaluateImageLabelFidelityReport(report);
  assert.equal(evaluated.passed, true);
  assert.ok(evaluated.candidateTokens.includes("8801234567890"));
  assert.deepEqual(evaluated.unsupportedTokens, []);
});

test("Swift token extraction rejects Korean, mixed-case and CJK brand mutations", { skip: !existsSync("/usr/bin/swift") }, () => {
  const script = new URL("../scripts/image-label-fidelity.swift", import.meta.url).pathname;
  for (const [reference, candidate, expectedMissing, expectedUnsupported] of [
    ["첵스 570g", "췍스 570g", "첵스", "췍스"],
    ["iPhone 128GB", "xPhone 128GB", "iPhone", "xPhone"],
    ["資生堂 50ml", "資生當 50ml", "資生堂", "資生當"],
  ]) {
    const result = spawnSync("/usr/bin/swift", [
      script,
      "--compare-text",
      "--candidate", candidate,
      "--required-reference", reference,
      "--reference", reference,
    ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as { unsupportedTokens: string[]; missingTokens: string[] };
    assert.ok(report.missingTokens.includes(expectedMissing), `${reference} missing token`);
    assert.ok(report.unsupportedTokens.includes(expectedUnsupported), `${candidate} unsupported token`);
  }
});

test("final package evidence rejects an exact source barcode that became unreadable after layout scaling", { skip: !existsSync("/usr/bin/swift") }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-barcode-fidelity-"));
  const required = join(directory, "required.png");
  const unreadable = join(directory, "unreadable.png");
  const payload = "8801234567890";
  try {
    await writeCode128Png(required, payload);
    const crushed = await sharp(required)
      .resize(4, 2, { fit: "fill" })
      .png()
      .toBuffer();
    await sharp(crushed)
      .resize(600, 240, { fit: "fill", kernel: sharp.kernel.nearest })
      .png()
      .toFile(unreadable);
    const fidelityScript = new URL("../scripts/image-label-fidelity.swift", import.meta.url).pathname;
    const inspect = (candidate: string) => spawnSync("/usr/bin/swift", [
      fidelityScript,
      "--candidate", candidate,
      "--required-reference", required,
      "--reference", required,
    ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
    const readableResult = inspect(required);
    assert.equal(readableResult.status, 0, readableResult.stderr);
    const readableReport = JSON.parse(readableResult.stdout) as {
      requiredTokens: string[];
      candidateTokens: string[];
    };
    assert.ok(readableReport.requiredTokens.includes(payload));
    assert.ok(readableReport.candidateTokens.includes(payload));

    const unreadableResult = inspect(unreadable);
    assert.equal(unreadableResult.status, 0, unreadableResult.stderr);
    const unreadableReport = JSON.parse(unreadableResult.stdout);
    const evaluated = evaluateImageLabelFidelityReport(unreadableReport);
    assert.equal(evaluated.passed, false);
    assert.ok(evaluated.missingTokens.includes(payload));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
