import { createHash, timingSafeEqual } from "node:crypto";

export type ImageLabelFidelityReport = {
  referenceLines?: unknown;
  candidateLines?: unknown;
  referenceTokens?: unknown;
  requiredTokens?: unknown;
  candidateTokens?: unknown;
  unsupportedTokens?: unknown;
  missingTokens?: unknown;
  [key: string]: unknown;
};

export type ImageLabelFidelityInput = {
  candidatePath: string;
  requiredReferencePath: string;
  referencePaths: readonly string[];
};

const MAXIMUM_REFERENCE_IMAGES = 12;
const MAXIMUM_TOKEN_COUNT = 512;
const MAXIMUM_TOKEN_LENGTH = 160;
const MAXIMUM_REFERENCE_SCAN_TOKEN_COUNT = 8_192;
export const MAXIMUM_IMAGE_LABEL_REFERENCE_PATHS_PER_RUN = 10;

export function imageLabelPixelDigest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSourcePixelLabelBaseline(input: {
  assetId: string;
  expectedDigest: string;
  baseline: Uint8Array;
  candidate: Uint8Array;
}) {
  const assetId = input.assetId.trim() || "source-protected";
  const baseline = Buffer.from(input.baseline);
  const candidate = Buffer.from(input.candidate);
  const baselineDigest = imageLabelPixelDigest(baseline);
  const candidateDigest = imageLabelPixelDigest(candidate);
  if (baseline.length === 0
    || baseline.length !== candidate.length
    || !/^[a-f0-9]{64}$/.test(input.expectedDigest)
    || baselineDigest !== input.expectedDigest
    || candidateDigest !== input.expectedDigest
    || !timingSafeEqual(baseline, candidate)) {
    throw new Error(`${assetId} 원본 픽셀 기준 이미지와 최종 이미지가 일치하지 않습니다.`);
  }
  return input.expectedDigest;
}

export function batchImageLabelFidelityReferencePaths(
  requiredReferencePath: string,
  referencePaths: readonly string[],
) {
  const required = checkedPath(requiredReferencePath, "필수 원본");
  const unique = referencePaths
    .map((path) => checkedPath(path, "허용 원본"))
    .filter((path, index, paths) => path !== required && paths.indexOf(path) === index);
  if (unique.length === 0) return [[]] as string[][];
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += MAXIMUM_IMAGE_LABEL_REFERENCE_PATHS_PER_RUN) {
    batches.push(unique.slice(index, index + MAXIMUM_IMAGE_LABEL_REFERENCE_PATHS_PER_RUN));
  }
  return batches;
}

export function mergeImageLabelFidelityReports(inputs: readonly unknown[]) {
  if (inputs.length === 0) throw new Error("라벨 OCR 배치 결과가 없습니다.");
  const reports = inputs.map((value) => value && typeof value === "object" ? value as ImageLabelFidelityReport : {});
  const parsedReports = reports.map((report) => ({
    required: checkedTokens(report.requiredTokens),
    candidate: checkedTokens(report.candidateTokens),
  }));
  if (parsedReports.some((report) => report.required.overflow || report.candidate.overflow)) {
    throw new Error("라벨 OCR 배치 토큰이 안전 한도를 초과했습니다.");
  }
  const firstRequired = parsedReports[0].required.tokens;
  const firstCandidate = parsedReports[0].candidate.tokens;
  const sameTokens = (left: string[], right: string[]) => left.length === right.length
    && left.every((token) => right.includes(token));
  for (const report of parsedReports.slice(1)) {
    if (!sameTokens(firstRequired, report.required.tokens)
      || !sameTokens(firstCandidate, report.candidate.tokens)) {
      throw new Error("라벨 OCR 후보·필수 토큰이 배치별로 일치하지 않습니다.");
    }
  }
  const targetTokens = new Set([...firstRequired, ...firstCandidate]);
  const supportedTokens = new Set<string>();
  for (const report of reports) {
    if (!Array.isArray(report.referenceTokens)
      || report.referenceTokens.length > MAXIMUM_REFERENCE_SCAN_TOKEN_COUNT) {
      throw new Error("라벨 OCR 허용 원본 토큰이 안전 한도를 초과했습니다.");
    }
    for (const item of report.referenceTokens) {
      if (typeof item !== "string") continue;
      const token = item.trim();
      if (token.length <= MAXIMUM_TOKEN_LENGTH && targetTokens.has(token)) supportedTokens.add(token);
    }
  }
  return {
    referenceTokens: [...supportedTokens],
    requiredTokens: firstRequired,
    candidateTokens: firstCandidate,
  };
}

function checkedTokens(value: unknown) {
  if (!Array.isArray(value)) return { tokens: [] as string[], overflow: false };
  const strings: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAXIMUM_TOKEN_COUNT)) {
    if (typeof item !== "string") continue;
    const token = item.trim();
    if (!token || token.length > MAXIMUM_TOKEN_LENGTH || seen.has(token)) continue;
    seen.add(token);
    strings.push(token);
  }
  return { tokens: strings, overflow: value.length > MAXIMUM_TOKEN_COUNT };
}

function checkedPath(value: string, field: string) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || path.includes("\0")) throw new Error(`${field} 이미지 경로가 올바르지 않습니다.`);
  return path;
}

/**
 * Builds an explicit Swift CLI contract. The source view actually used for the
 * candidate is always a distinct required reference; the union of every
 * supplied view is used only to reject invented OCR tokens.
 */
export function buildImageLabelFidelitySwiftArguments(input: ImageLabelFidelityInput) {
  const candidatePath = checkedPath(input.candidatePath, "검수 대상");
  const requiredReferencePath = checkedPath(input.requiredReferencePath, "필수 원본");
  const references = [requiredReferencePath, ...input.referencePaths.map((path) => checkedPath(path, "허용 원본"))]
    .filter((path, index, paths) => paths.indexOf(path) === index);
  if (references.length > MAXIMUM_REFERENCE_IMAGES) {
    throw new Error(`라벨 검수 원본은 최대 ${MAXIMUM_REFERENCE_IMAGES}장까지 사용할 수 있습니다.`);
  }
  return [
    "--candidate", candidatePath,
    "--required-reference", requiredReferencePath,
    ...references.flatMap((path) => ["--reference", path]),
  ];
}

export function evaluateImageLabelFidelityReport(
  input: unknown,
  options: { allowMissingRequiredTokens?: boolean; allowEmptySourceText?: boolean } = {},
) {
  const report = input && typeof input === "object" ? input as ImageLabelFidelityReport : {};
  const reference = checkedTokens(report.referenceTokens);
  const required = checkedTokens(report.requiredTokens);
  const candidate = checkedTokens(report.candidateTokens);
  const reportedUnsupported = checkedTokens(report.unsupportedTokens);
  const reportedMissing = checkedTokens(report.missingTokens);
  const referenceTokens = reference.tokens;
  const requiredTokens = required.tokens;
  const candidateTokens = candidate.tokens;
  const referenceSet = new Set(referenceTokens);
  const candidateSet = new Set(candidateTokens);
  const unsupportedRequiredTokens = requiredTokens.filter((token) => !referenceSet.has(token));
  const unsupportedTokens = candidateTokens.filter((token) => !referenceSet.has(token));
  const missingTokens = requiredTokens.filter((token) => !candidateSet.has(token));
  const emptySourceText = Boolean(options.allowEmptySourceText)
    && requiredTokens.length === 0
    && candidateTokens.length === 0;
  const reportMismatch = Array.isArray(report.unsupportedTokens) && (
    reportedUnsupported.tokens.length !== unsupportedTokens.length
    || reportedUnsupported.tokens.some((token) => !unsupportedTokens.includes(token))
  ) || Array.isArray(report.missingTokens) && (
    reportedMissing.tokens.length !== missingTokens.length
    || reportedMissing.tokens.some((token) => !missingTokens.includes(token))
  );
  const failureReasons = [
    ...([reference, required, candidate, reportedUnsupported, reportedMissing].some((entry) => entry.overflow) ? ["token-count-overflow"] : []),
    ...(referenceTokens.length === 0 && !emptySourceText ? ["reference-token-empty"] : []),
    ...(requiredTokens.length === 0 && !emptySourceText ? ["required-token-empty"] : []),
    ...(candidateTokens.length === 0 && !emptySourceText ? ["candidate-token-empty"] : []),
    ...(unsupportedRequiredTokens.length > 0 ? ["required-token-not-in-reference"] : []),
    ...(unsupportedTokens.length > 0 ? ["unsupported-token"] : []),
    ...(missingTokens.length > 0 && !options.allowMissingRequiredTokens ? ["missing-token"] : []),
    ...(reportMismatch ? ["report-token-mismatch"] : []),
  ];

  return {
    ...report,
    referenceTokens,
    requiredTokens,
    candidateTokens,
    unsupportedRequiredTokens,
    unsupportedTokens,
    missingTokens,
    failureReasons,
    passed: failureReasons.length === 0,
  };
}
