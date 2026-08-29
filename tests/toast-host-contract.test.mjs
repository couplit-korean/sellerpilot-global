import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const queueUrl = new URL("../app/_notifications/use-toast-queue.ts", import.meta.url);
const mobileStylesUrl = new URL("../app/mobile-optimization.css", import.meta.url);

test("operations and OAuth results share one accessible FIFO toast host", async () => {
  const [page, queue, mobileStyles] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(queueUrl, "utf8"),
    readFile(mobileStylesUrl, "utf8"),
  ]);

  assert.equal((page.match(/useToastQueue\(\)/g) ?? []).length, 1);
  assert.equal((page.match(/className=\{`toast notice-\$\{toastTone\}`\}/g) ?? []).length, 1);
  assert.doesNotMatch(page, /oauthToastMessage\s*&&\s*<div className="toast"/);
  assert.doesNotMatch(page, /setTimeout\(\(\) => setOAuthToastMessage\(""\)/);

  assert.match(page, /if \(!oauthToastMessage\) return;\s*notify\(oauthToastMessage\);\s*onOAuthToastQueued\(\);/);
  assert.match(page, /setOAuthToastMessage\(payload\.message\)/);
  assert.match(page, /setOAuthToastMessage\(oauthError instanceof Error \? oauthError\.message : "채널 OAuth 연결을 완료하지 못했습니다\."\)/);
  assert.match(page, /oauthToastMessage=\{oauthToastMessage\} onOAuthToastQueued=\{clearOAuthToastMessage\}/);

  assert.match(page, /className=\{`toast notice-\$\{toastTone\}`\} role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(page, /<button type="button" aria-label="알림 닫기" onClick=\{dismissToast\}>/);

  assert.match(queue, /export const toastDurationMs = 2_000/);
  assert.match(queue, /const currentToast = queue\[0\] \?\? null/);
  assert.match(queue, /setQueue\(\(current\) => appendToast\(current, message, id\)\)/);
  assert.match(queue, /setQueue\(shiftToastQueue\)/);
  assert.match(queue, /window\.setTimeout\(dismissToast, durationMs\)/);

  assert.match(mobileStyles, /body:has\(\.toast\) \.app-content\s*\{[^}]*padding-bottom:\s*calc\(104px \+ var\(--mobile-toast-lane-height\) \+ env\(safe-area-inset-bottom\)\)/);
});
