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
