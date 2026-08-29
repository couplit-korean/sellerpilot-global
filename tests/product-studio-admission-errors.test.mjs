import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");

test("known pre-enqueue Studio rejections release the exact local job before generic 5xx reconciliation", () => {
  const deterministicGuard = studio.indexOf("const deterministicPreEnqueueRejection");
  const ambiguousGuard = studio.indexOf("const ambiguousResponse", deterministicGuard);

  assert.ok(deterministicGuard > 0, "the deterministic admission guard must exist");
  assert.ok(ambiguousGuard > deterministicGuard, "known pre-enqueue errors must be classified before generic 5xx ambiguity");

  const deterministicBlock = studio.slice(deterministicGuard, ambiguousGuard);
  assert.match(deterministicBlock, /response\.status === 503 && queued\.code === "SOURCE_RESEARCH_UNAVAILABLE"/);
  assert.match(deterministicBlock, /response\.status === 409 && queued\.code === "SOURCE_RESEARCH_REQUIRED"/);
  assert.match(deterministicBlock, /response\.status === 503 && queued\.code === "SOURCE_RESEARCH_REQUIRED"/);
  assert.match(deterministicBlock, /response\.status === 409 && queued\.code === "SOURCE_PHOTO_MISMATCH"/);
  assert.match(deterministicBlock, /terminallyRejected = true/);
  assert.match(deterministicBlock, /clearActiveStudioJob\(jobId\)/);
  assert.match(deterministicBlock, /releaseOwnJob\(jobId\)/);
  assert.doesNotMatch(deterministicBlock, /monitorOwnStudioJob/);

  const ambiguousBlock = studio.slice(ambiguousGuard, studio.indexOf("if (!response.ok || !queued.jobId)", ambiguousGuard));
  assert.match(ambiguousBlock, /response\.status >= 500/);
  assert.match(ambiguousBlock, /monitorOwnStudioJob\(queuedJob, accessToken, true\)/);
});
