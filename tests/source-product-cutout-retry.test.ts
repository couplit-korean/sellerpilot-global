import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isTransientVisionCutoutFailure,
  runVisionCutoutWithTransientRetry,
} from "../lib/source-product-cutout-retry";

test("only explicit Vision, ANE, and transient Swift child failures are retryable", () => {
  for (const message of [
    "SELLERPILOT_TRANSIENT_VISION_FAILURE",
    "SELLERPILOT_TRANSIENT_SWIFT_CHILD_FAILURE",
    "RECOMPILE E5",
    "unable to create E5RT execution stream operation",
    "com.apple.Quagga: Inference failed",
    "Vision service temporarily unavailable",
  ]) {
    assert.equal(isTransientVisionCutoutFailure(new Error(message)), true, message);
  }
  const spawnBusy = Object.assign(new Error("spawn swift"), { code: "EAGAIN" });
  assert.equal(isTransientVisionCutoutFailure(spawnBusy), true);
  assert.equal(isTransientVisionCutoutFailure(new Error("unexpected child failure")), false);
  assert.equal(
    isTransientVisionCutoutFailure(new Error("원본 provenance 불일치 · RECOMPILE E5")),
    false,
  );
});

test("a transient cutout retries once only after the first attempt settles", async () => {
  const events: string[] = [];
  const result = await runVisionCutoutWithTransientRetry({
    mode: "front",
    backoffMs: 7,
    runAttempt: async (attempt) => {
      events.push(`run:${attempt}`);
      if (attempt === 1) {
        await Promise.resolve();
        events.push("close:1");
        throw new Error("RECOMPILE E5");
      }
      return "ok";
    },
    onRetry: (attempt, mode) => events.push(`retry:${mode}:${attempt}`),
    delay: async (milliseconds) => { events.push(`delay:${milliseconds}`); },
  });

  assert.equal(result, "ok");
  assert.deepEqual(events, ["run:1", "close:1", "retry:front:1", "delay:7", "run:2"]);
});

test("repeated transient failures stop at two attempts with a safe error", async () => {
  let attempts = 0;
  await assert.rejects(
    runVisionCutoutWithTransientRetry({
      mode: "subject",
      backoffMs: 0,
      runAttempt: async () => {
        attempts += 1;
        throw new Error("/private/job input · unable to create E5RT execution stream");
      },
    }),
    (error) => error instanceof Error
      && /일시적인 Vision 실행 오류가 반복/.test(error.message)
      && !error.message.includes("/private/"),
  );
  assert.equal(attempts, 2);
});

test("deterministic validation and lease cancellation never retry", async () => {
  let deterministicAttempts = 0;
  await assert.rejects(
    runVisionCutoutWithTransientRetry({
      mode: "front",
      runAttempt: async () => {
        deterministicAttempts += 1;
        throw new Error("원본 사진에서 단일 상품 포장을 신뢰도 높게 분리하지 못했습니다.");
      },
    }),
    /단일 상품 포장/,
  );
  assert.equal(deterministicAttempts, 1);

  const controller = new AbortController();
  const cancellation = new Error("lease cancelled");
  let cancelledAttempts = 0;
  await assert.rejects(
    runVisionCutoutWithTransientRetry({
      mode: "front",
      signal: controller.signal,
      runAttempt: async () => {
        cancelledAttempts += 1;
        controller.abort(cancellation);
        throw new Error("RECOMPILE E5");
      },
    }),
    (error) => error === cancellation,
  );
  assert.equal(cancelledAttempts, 1);
});

test("worker and Swift cutout keep the bounded safe retry contract", async () => {
  const [worker, swift] = await Promise.all([
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/source-product-cutout.swift", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /runVisionCutoutWithTransientRetry\(\{/);
  assert.match(worker, /signal: leaseSignal/);
  assert.match(worker, /\[원본 픽셀 보호 재시도\] mode=\$\{retryMode\} attempt=\$\{attempt\}/);
  assert.doesNotMatch(worker, /원본 픽셀 보호 재시도[^\n]*error/);
  assert.match(worker, /child\.once\("close",[\s\S]*finish\(/);
  assert.match(worker, /child\.stdout\.removeAllListeners\("data"\)/);
  assert.match(worker, /child\.stderr\.removeAllListeners\("data"\)/);
  assert.match(worker, /child\.removeAllListeners\("close"\)/);
  assert.match(swift, /case transientVisionExecution/);
  assert.match(swift, /SELLERPILOT_TRANSIENT_VISION_FAILURE/);
  assert.match(swift, /let lines = try recognizeText\(at: inputURL\)/);
  assert.doesNotMatch(swift, /\(try\? recognizeText\(at: inputURL\)\) \?\? \[\]/);
});
