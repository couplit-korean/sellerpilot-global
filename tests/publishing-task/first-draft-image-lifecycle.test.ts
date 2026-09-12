import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { coreFirstDraftAssetIds } from "../../lib/ai-generated-assets";
import {
  classifyFirstDraftImageResult,
  createFirstDraftJobFence,
  type FirstDraftImageResult,
} from "../../app/_publishing/use-first-draft-images";

const firstJobId = "11111111-1111-4111-8111-111111111111";
const secondJobId = "22222222-2222-4222-8222-222222222222";

function images(count = coreFirstDraftAssetIds.length) {
  return coreFirstDraftAssetIds.slice(0, count).map((id) => ({ id, url: `https://example.test/${id}.png` }));
}

function resultWithLineage(
  modes: Array<"source-photo-catalog" | "segmented-source-composite">,
  imageCount = coreFirstDraftAssetIds.length,
  sameDigest = false,
): FirstDraftImageResult {
  return {
    generatedImages: images(imageCount),
    preflightAssetLineage: Object.fromEntries(coreFirstDraftAssetIds.map((id, index) => [id, {
      auditMode: modes[index] ?? modes.at(-1),
      digest: sameDigest ? "a".repeat(64) : (index + 1).toString(16).repeat(64),
    }])),
  };
}

test("six source-photo catalog URLs stay provisional rather than becoming generated-complete", () => {
  const snapshot = classifyFirstDraftImageResult(resultWithLineage(["source-photo-catalog"]));
  assert.equal(snapshot.phase, "source-photo-catalog");
  assert.equal(snapshot.images.length, 6);
  assert.equal(snapshot.confirmedGeneratedCount, 0);
});

test("missing lineage, partial assets, mixed lineage, and genuine six-role completion are distinct", () => {
  assert.equal(classifyFirstDraftImageResult({ generatedImages: images() }).phase, "unknown");
  assert.equal(classifyFirstDraftImageResult({ generatedImages: images(3) }).phase, "partial");

  const mixed = resultWithLineage([
    "segmented-source-composite",
    "segmented-source-composite",
    "source-photo-catalog",
  ]);
  assert.deepEqual(
    { phase: classifyFirstDraftImageResult(mixed).phase, count: classifyFirstDraftImageResult(mixed).confirmedGeneratedCount },
    { phase: "partial", count: 2 },
  );

  const complete = classifyFirstDraftImageResult(resultWithLineage(["segmented-source-composite"]));
  assert.deepEqual({ phase: complete.phase, count: complete.confirmedGeneratedCount }, { phase: "complete", count: 6 });

  const duplicated = classifyFirstDraftImageResult(resultWithLineage(["segmented-source-composite"], 6, true));
  assert.notEqual(duplicated.phase, "complete");
  assert.equal(duplicated.confirmedGeneratedCount, 1);
});

test("one job deduplicates requests, a failed request retries, and the next job can enqueue", () => {
  const fence = createFirstDraftJobFence();
  fence.activate(firstJobId);
  const firstRequest = fence.beginRequest(firstJobId);
  assert.ok(firstRequest);
  assert.equal(fence.beginRequest(firstJobId), null);

  fence.releaseRequest(firstRequest);
  const retry = fence.beginRequest(firstJobId);
  assert.ok(retry);
  assert.equal(fence.beginRequest(firstJobId), null);

  fence.activate(secondJobId);
  const secondRequest = fence.beginRequest(secondJobId);
  assert.ok(secondRequest);
  assert.equal(fence.beginRequest(firstJobId), null);
});

test("late responses lose ownership after job change, reset, and unmount", () => {
  const fence = createFirstDraftJobFence();
  fence.activate(firstJobId);
  const oldRequest = fence.beginRequest(firstJobId);
  assert.ok(oldRequest);

  fence.activate(secondJobId);
  assert.equal(fence.isCurrent(oldRequest), false);
  const currentRequest = fence.beginRequest(secondJobId);
  assert.ok(currentRequest);
  assert.equal(fence.isCurrent(currentRequest), true);

  fence.reset();
  assert.equal(fence.isCurrent(currentRequest), false);
  fence.activate(secondJobId);
  const unmountedRequest = fence.beginRequest(secondJobId);
  assert.ok(unmountedRequest);
  fence.unmount();
  assert.equal(fence.isCurrent(unmountedRequest), false);
  assert.equal(fence.activate(firstJobId), null);
  fence.mount();
  assert.ok(fence.activate(firstJobId));
  assert.equal(fence.isCurrent(unmountedRequest), false);
});

test("the browser hook binds fetches and timers to the active job and cleans them on unmount", async () => {
  const source = await readFile(new URL("../../app/_publishing/use-first-draft-images.ts", import.meta.url), "utf8");
  assert.match(source, /requestControllerRef\.current\?\.abort/);
  assert.match(source, /pollControllerRef\.current\?\.abort/);
  assert.match(source, /window\.clearTimeout\(pollTimerRef\.current\)/);
  assert.match(source, /signal\.aborted \|\| !fence\.isCurrent\(token\)/);
  assert.match(source, /payload\.jobId !== jobId/);
  assert.match(source, /signal,\s*\n\s*\}\);/);
  assert.match(source, /useEffect\(\(\) => \{\s*fence\.mount\(\);[\s\S]*stopAsyncLifecycle[\s\S]*fence\.unmount\(\)/);
});
