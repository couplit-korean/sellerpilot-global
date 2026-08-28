import assert from "node:assert/strict";
import test from "node:test";
import {
  isMissingGeneratedImageOutput,
  isObviousGeneratedImageDecodeFailure,
  RetryableGeneratedImageOutputError,
} from "../lib/generated-image-output-retry";

test("only a missing generated output path is classified as missing", () => {
  const missing = Object.assign(new Error("not found"), { code: "ENOENT" });
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });

  assert.equal(isMissingGeneratedImageOutput(missing), true);
  assert.equal(isMissingGeneratedImageOutput(denied), false);
  assert.equal(isMissingGeneratedImageOutput(new Error("ENOENT in model text")), false);
});

test("only explicit decoder failures are retryable", () => {
  for (const message of [
    "Input buffer contains unsupported image format",
    "pngload_buffer: libspng read error",
    "JPEGLOAD_BUFFER: premature end of input",
    "truncated image data",
  ]) {
    assert.equal(isObviousGeneratedImageDecodeFailure(new Error(message)), true, message);
  }

  for (const message of [
    "Input image exceeds pixel limit",
    "Out of memory while allocating image",
    "permission denied",
    "thumbnail-portrait 배경 장소·시간대·표면 검증에 실패했습니다.",
    "detail-package 라벨 픽셀 일치 검증에 실패했습니다.",
    "상품 정체성 원본 근거가 부족합니다.",
  ]) {
    assert.equal(isObviousGeneratedImageDecodeFailure(new Error(message)), false, message);
  }
});

test("retryable output errors expose only a bounded safe reason", () => {
  const error = new RetryableGeneratedImageOutputError("missing-output", "thumbnail-portrait");

  assert.equal(error.name, "RetryableGeneratedImageOutputError");
  assert.equal(error.reason, "missing-output");
  assert.match(error.message, /thumbnail-portrait/);
  assert.doesNotMatch(error.message, /ENOENT|\/var\/folders|prompt/i);
});
