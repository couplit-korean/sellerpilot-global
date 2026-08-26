import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildImageLabelFidelitySwiftArguments,
  evaluateImageLabelFidelityReport,
} from "../lib/image-label-fidelity";

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
