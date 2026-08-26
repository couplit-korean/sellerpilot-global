import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveStudioAdmission } from "../lib/studio-job-admission";

const jobId = "22222222-2222-4222-8222-222222222222";

test("a committed job with a lost create response preserves uploads and reconciles exact identity", async () => {
  let cleanupCalls = 0;
  const resolution = await resolveStudioAdmission({
    jobId,
    createJob: async () => { throw new Error("response lost after commit"); },
    readExactJob: async () => ({
      data: { id: jobId, kind: "product_studio", status: "queued" },
      error: null,
    }),
    cleanupUploads: async () => { cleanupCalls += 1; },
  });

  assert.deepEqual(resolution, { outcome: "accepted", reconciled: true });
  assert.equal(cleanupCalls, 0);
});

test("definite exact-job absence cleans uploads and returns a terminal rejection", async () => {
  let cleanupCalls = 0;
  const resolution = await resolveStudioAdmission({
    jobId,
    createJob: async () => ({ data: null, error: { code: "create_failed" } }),
    readExactJob: async () => ({ data: null, error: null }),
    cleanupUploads: async () => { cleanupCalls += 1; },
  });

  assert.deepEqual(resolution, { outcome: "rejected", cleanupPending: false });
  assert.equal(cleanupCalls, 1);
});

test("an unreadable exact-job state is ambiguous and never deletes source uploads", async () => {
  let cleanupCalls = 0;
  const resolution = await resolveStudioAdmission({
    jobId,
    createJob: async () => ({ data: null, error: { code: "timeout" } }),
    readExactJob: async () => ({ data: null, error: { code: "readback_timeout" } }),
    cleanupUploads: async () => { cleanupCalls += 1; },
  });

  assert.deepEqual(resolution, { outcome: "ambiguous" });
  assert.equal(cleanupCalls, 0);
});

test("client cleanup is fenced to pre-enqueue or definite terminal rejection boundaries", async () => {
  const [studio, route] = await Promise.all([
    readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/product-studio/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /let enqueueStarted = false/);
  assert.match(studio, /enqueueStarted = true;[\s\S]*fetchJsonWithStudioJobTimeout\("\/api\/ai\/product-studio"/);
  assert.match(studio, /\(!enqueueStarted \|\| terminallyRejected\)[\s\S]*cleanupUnenqueuedStudioPhotos/);
  assert.match(studio, /preserveMissingAdmission: reconcileAdmission/);
  assert.match(studio, /lifecycleController\.signal, 90_000,[\s\S]*CLI 작업 등록 응답/);
  assert.match(route, /export const maxDuration = 300/);
  assert.equal((route.match(/createSignedUrls\(/g) ?? []).length, 1);
  assert.match(route, /verifyPreservedStudioImages/);
  assert.match(route, /cleanupStudioUploadsOnlyWhenJobIsAbsent/);
});
