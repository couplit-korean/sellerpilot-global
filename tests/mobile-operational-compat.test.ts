import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI studio fences optional AbortSignal APIs and retains cleanup fallbacks", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");

  assert.match(studio, /typeof AbortSignal\.timeout === "function"\s*\? AbortSignal\.timeout\(15_000\)\s*:\s*null/);
  assert.match(studio, /typeof AbortSignal\.any === "function"\) \{\s*signal = AbortSignal\.any\(signals\)/);
  assert.equal((studio.match(/AbortSignal\.timeout\(/g) ?? []).length, 1);
  assert.equal((studio.match(/AbortSignal\.any\(/g) ?? []).length, 1);
  assert.match(studio, /const timeoutController = new AbortController\(\)[\s\S]{0,240}window\.setTimeout/);
  assert.match(studio, /window\.clearTimeout\(fallbackTimeoutId\)/);
  assert.match(studio, /removeEventListener\("abort", listener\)/);
  assert.match(studio, /finally \{\s*abortScope\.cleanup\(\)/);
  assert.match(studio, /return \(\) => \{\s*controller\.abort\(\);\s*abortScope\?\.cleanup\(\)/);
});

test("AI studio fallback aborts and times out when optional AbortSignal APIs are absent", async () => {
  const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
    Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: undefined });
    const { createStudioAbortScope } = await import("../app/ai-product-studio");

    const first = new AbortController();
    const second = new AbortController();
    const combined = createStudioAbortScope([first.signal, second.signal]);
    const reason = new DOMException("화면을 떠났습니다.", "AbortError");
    second.abort(reason);
    assert.equal(combined.signal.aborted, true);
    assert.equal(combined.signal.reason, reason);
    combined.cleanup();

    const deadline = createStudioAbortScope([], 5);
    await new Promise<void>((resolve) => deadline.signal.addEventListener("abort", () => resolve(), { once: true }));
    assert.equal(deadline.didTimeout(), true);
    assert.equal(deadline.signal.reason instanceof DOMException && deadline.signal.reason.name, "TimeoutError");
    deadline.cleanup();

    const cancelledDeadline = createStudioAbortScope([], 20);
    cancelledDeadline.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(cancelledDeadline.signal.aborted, false);
  } finally {
    if (anyDescriptor) Object.defineProperty(AbortSignal, "any", anyDescriptor);
    else Reflect.deleteProperty(AbortSignal, "any");
    if (timeoutDescriptor) Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor);
    else Reflect.deleteProperty(AbortSignal, "timeout");
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("mobile CSS keeps worker and operational database/error indicators visible", async () => {
  const [globalStyles, mobileStyles] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
  ]);

  assert.match(globalStyles, /@media \(max-width: 720px\)[\s\S]*?\.demo-data-badge \{ display: inline-flex; min-height: 44px; \}/);
  const visibilityLayer = mobileStyles.slice(mobileStyles.indexOf("/* Keep live operational health visible on phones."));
  assert.ok(visibilityLayer.length > 0);
  assert.match(visibilityLayer, /@media \(max-width: 720px\)/);
  assert.match(visibilityLayer, /\.commerce-service-rail span:nth-of-type\(4\)[\s\S]{0,180}?display: inline-flex/);
  assert.match(visibilityLayer, /\.topbar-actions \.demo-data-badge \{[\s\S]{0,180}?display: grid;[\s\S]{0,180}?min-height: 44px/);
  assert.match(visibilityLayer, /\.topbar-actions \.demo-data-badge small \{[\s\S]{0,120}?font-size: 7px/);
  assert.doesNotMatch(visibilityLayer, /\.commerce-service-rail span:nth-of-type\(4\)[^{]*\{[^}]*display:\s*none/);
  assert.match(visibilityLayer, /@media \(max-width: 319px\)[\s\S]*?\.topbar-actions \.demo-data-badge\s*\{[^}]*display:\s*none/);
});
