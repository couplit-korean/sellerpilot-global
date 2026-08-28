export type RetryableGeneratedImageOutputReason =
  | "missing-output"
  | "empty-output"
  | "undecodable-output";

export class RetryableGeneratedImageOutputError extends Error {
  readonly reason: RetryableGeneratedImageOutputReason;

  constructor(reason: RetryableGeneratedImageOutputReason, assetId: string) {
    super(`${assetId} 이미지 생성기가 사용할 수 있는 산출물을 만들지 못했습니다.`);
    this.name = "RetryableGeneratedImageOutputError";
    this.reason = reason;
  }
}

export function isMissingGeneratedImageOutput(error: unknown) {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}

const unsafeDecodeRetryPattern = [
  /pixel limit/i,
  /exceeds?.*(?:pixel|size|limit)/i,
  /too (?:large|big)/i,
  /out of memory/i,
  /allocat(?:e|ion)/i,
  /permission denied/i,
  /operation not permitted/i,
  /\bEACCES\b/i,
].reduce((combined, pattern) => new RegExp(`${combined.source}|${pattern.source}`, "i"));

const obviousDecodeFailurePattern = [
  /unsupported image format/i,
  /input (?:buffer|file) contains unsupported/i,
  /(?:png|jpe?g|webp|gif|tiff|heif|avif|jxl)load(?:_buffer)?:/i,
  /libspng.*(?:error|invalid|eof)/i,
  /corrupt(?:ed)? (?:image|header|data)/i,
  /malformed (?:image|header|data)/i,
  /truncated (?:image|file|data)/i,
  /premature end/i,
  /unexpected end of (?:file|input|data)/i,
  /invalid (?:image|header|image data)/i,
  /bad (?:image|header|seek)/i,
].reduce((combined, pattern) => new RegExp(`${combined.source}|${pattern.source}`, "i"));

/**
 * Restricts retries to decoder-confirmed bad bytes. Safety limits, filesystem
 * policy failures, product identity checks and semantic quality gates must
 * continue to fail closed.
 */
export function isObviousGeneratedImageDecodeFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim();
  return message.length > 0
    && !unsafeDecodeRetryPattern.test(message)
    && obviousDecodeFailurePattern.test(message);
}
