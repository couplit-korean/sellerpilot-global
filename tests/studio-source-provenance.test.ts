import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  expandStudioCleanupStoragePaths,
  normalizedStudioImagePath,
  originalStudioImagePath,
  sourceImagePathsForWorker,
  validatePreservedStudioUploadPaths,
} from "../lib/studio-image-paths";
import {
  maximumPreservedStudioImageInspectionConcurrency,
  verifyOriginalStudioImages,
  verifyPreservedStudioImages,
} from "../lib/studio-image-validation";
import { uploadStudioStorageObject } from "../lib/studio-direct-upload";
import { assertStudioPhotoBatch, uploadStudioPhotoPairs } from "../lib/studio-photo-upload";
import { sourcePreservingProductImageSpecSchema } from "../lib/product-intake";
import {
  assertStudioSourceDimensions,
  assertStudioSourceFile,
  maximumStudioSourceImageBytes,
  studioPhotoPreparationConcurrency,
  studioPhotoUploadConcurrency,
} from "../lib/studio-source-photo-policy";

const userId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";

function png(width: number, height: number, type = "image/png") {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  bytes[16] = width >>> 24;
  bytes[17] = width >>> 16;
  bytes[18] = width >>> 8;
  bytes[19] = width;
  bytes[20] = height >>> 24;
  bytes[21] = height >>> 16;
  bytes[22] = height >>> 8;
  bytes[23] = height;
  return new Blob([bytes], { type });
}

function jpeg(width: number, height: number) {
  return new Blob([new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x07, 0x08,
    height >>> 8, height & 0xff,
    width >>> 8, width & 0xff,
    0xff, 0xd9,
  ])], { type: "image/jpeg" });
}

test("source paths are deterministic, pair-validated, and legacy worker jobs still fall back", () => {
  const normalized = [0, 1].map((index) => normalizedStudioImagePath(userId, jobId, index));
  const originals = [0, 1].map((index) => originalStudioImagePath(userId, jobId, index));
  const specs = originals.map((originalPath) => ({ originalPath }));
  assert.deepEqual(validatePreservedStudioUploadPaths(userId, jobId, normalized, specs), {
    imagePaths: normalized,
    originalPaths: originals,
    allPaths: [normalized[0], originals[0], normalized[1], originals[1]],
  });
  assert.deepEqual(sourceImagePathsForWorker(normalized, specs), originals);
  assert.deepEqual(sourceImagePathsForWorker(normalized, [{}, {}]), normalized);
  assert.throws(() => sourceImagePathsForWorker(normalized, [specs[0], {}]), /일부만/);
  assert.throws(() => sourceImagePathsForWorker(normalized, [specs[1], specs[0]]), /일치하지/);
  assert.equal(validatePreservedStudioUploadPaths(userId, jobId, normalized, [specs[1], specs[0]]), null);
  assert.equal(validatePreservedStudioUploadPaths(userId, jobId, [normalized[1], normalized[0]], specs), null);
});

test("retention cleanup expands normalized inputs to originals without changing generated assets", () => {
  const input = normalizedStudioImagePath(userId, jobId, 0);
  const original = originalStudioImagePath(userId, jobId, 0);
  const generated = `${userId}/${jobId}/result/hero.jpg`;
  assert.deepEqual(expandStudioCleanupStoragePaths([input, generated, input]), [input, original, generated]);
});

test("paired upload preserves raw bytes before derivatives with bounded mobile concurrency", async () => {
  const calls: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const units = Array.from({ length: 5 }, (_, index) => ({
    index,
    original: new Blob([`raw-${index}`], { type: "image/png" }),
    originalMediaType: "image/png",
    normalized: new Blob([`normalized-${index}`], { type: "image/jpeg" }),
    spec: { originalName: `photo-${index}.png`, originalBytes: 5 + String(index).length },
  }));
  const result = await uploadStudioPhotoPairs({
    userId,
    jobId,
    units,
    concurrency: 2,
    signal: new AbortController().signal,
    upload: async (path) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, path.includes("/original/") ? 2 : 1));
      calls.push(path);
      active -= 1;
    },
    cleanup: async () => assert.fail("successful upload must not clean up"),
  });
  assert.ok(maximumActive <= 2);
  for (let index = 0; index < units.length; index += 1) {
    const original = originalStudioImagePath(userId, jobId, index);
    const normalized = normalizedStudioImagePath(userId, jobId, index);
    assert.ok(calls.indexOf(original) < calls.indexOf(normalized));
    assert.equal(result.uploadedPaths[index], normalized);
    assert.equal(result.imageSpecs[index].originalPath, original);
  }
});

test("an original or derivative upload failure prevents job input completion and cleans every partial object", async () => {
  const uploaded: string[] = [];
  let cleaned: string[] = [];
  const units = [0, 1].map((index) => ({
    index,
    original: new Blob([`raw-${index}`], { type: "image/png" }),
    originalMediaType: "image/png",
    normalized: new Blob([`normalized-${index}`], { type: "image/jpeg" }),
    spec: { originalName: `photo-${index}.png` },
  }));
  await assert.rejects(uploadStudioPhotoPairs({
    userId,
    jobId,
    units,
    concurrency: 1,
    signal: new AbortController().signal,
    upload: async (path) => {
      if (path === originalStudioImagePath(userId, jobId, 1)) throw new Error("raw failed");
      uploaded.push(path);
    },
    cleanup: async (paths) => { cleaned = paths; },
  }), /raw failed/);
  assert.ok(!uploaded.includes(normalizedStudioImagePath(userId, jobId, 1)));
  assert.deepEqual(new Set(cleaned), new Set(units.flatMap((unit) => [
    originalStudioImagePath(userId, jobId, unit.index),
    normalizedStudioImagePath(userId, jobId, unit.index),
  ])));

  uploaded.length = 0;
  cleaned = [];
  await assert.rejects(uploadStudioPhotoPairs({
    userId,
    jobId,
    units: units.slice(0, 1),
    concurrency: 1,
    signal: new AbortController().signal,
    upload: async (path) => {
      if (path.includes("/input/")) throw new Error("derivative failed");
      uploaded.push(path);
    },
    cleanup: async (paths) => { cleaned = paths; },
  }), /derivative failed/);
  assert.deepEqual(cleaned, [
    originalStudioImagePath(userId, jobId, 0),
    normalizedStudioImagePath(userId, jobId, 0),
  ]);
});

test("lost upload responses clean every deterministic path in the current pre-enqueue batch", async () => {
  const remotelyCommitted: string[] = [];
  const cleanupCandidates: string[] = [];
  const observedCandidates: string[] = [];
  const units = [0, 1].map((index) => ({
    index,
    original: new Blob([`raw-${index}`], { type: "image/png" }),
    originalMediaType: "image/png",
    normalized: new Blob([`normalized-${index}`], { type: "image/jpeg" }),
    spec: { originalName: `photo-${index}.png` },
  }));

  await assert.rejects(uploadStudioPhotoPairs({
    userId,
    jobId,
    units,
    concurrency: 1,
    signal: new AbortController().signal,
    upload: async (path) => {
      remotelyCommitted.push(path);
      throw new Error("response lost after storage commit");
    },
    cleanup: async (paths) => { cleanupCandidates.push(...paths); },
    onCleanupCandidate: (path) => observedCandidates.push(path),
  }), /response lost/);

  const expected = units.flatMap((unit) => [
    originalStudioImagePath(userId, jobId, unit.index),
    normalizedStudioImagePath(userId, jobId, unit.index),
  ]);
  assert.deepEqual(observedCandidates, expected);
  assert.deepEqual(cleanupCandidates, expected);
  assert.deepEqual(remotelyCommitted, [expected[0]]);
});

test("shared source batch policy rejects count and aggregate bytes before any upload", async () => {
  assert.throws(
    () => assertStudioPhotoBatch(Array.from({ length: 101 }, () => ({ size: 1 }))),
    /최대 100장/,
  );
  assert.throws(
    () => assertStudioPhotoBatch([{ size: 200 * 1024 * 1024 }, { size: 1 }]),
    /합계는 200MB/,
  );

  let uploadCount = 0;
  await assert.rejects(uploadStudioPhotoPairs({
    userId,
    jobId,
    units: Array.from({ length: 101 }, (_, index) => ({
      index,
      original: new Blob(["raw"], { type: "image/png" }),
      originalMediaType: "image/png",
      normalized: new Blob(["normalized"], { type: "image/jpeg" }),
      spec: {},
    })),
    concurrency: 2,
    signal: new AbortController().signal,
    upload: async () => { uploadCount += 1; },
    cleanup: async () => undefined,
  }), /최대 100장/);
  assert.equal(uploadCount, 0);
});

test("direct browser upload is abortable, non-upserting, and does not copy raw bytes into JSON", async () => {
  const raw = new Blob(["preserved raw bytes"], { type: "image/png" });
  let inspected = false;
  await uploadStudioStorageObject({
    accessToken: "test-user-token",
    path: originalStudioImagePath(userId, jobId, 0),
    body: raw,
    contentType: "image/png",
    cacheControl: "31536000",
    parentSignal: new AbortController().signal,
    timeoutMs: 1_000,
    configuration: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "publishable-test-key",
    },
    fetcher: async (input, init) => {
      inspected = true;
      assert.equal(String(input), `https://project.supabase.co/storage/v1/object/sellerpilot-ai/${originalStudioImagePath(userId, jobId, 0)}`);
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("x-upsert"), "false");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-user-token");
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("cacheControl"), "31536000");
      const uploaded = init.body.get("");
      assert.ok(uploaded instanceof Blob);
      assert.equal(await uploaded.text(), await raw.text());
      assert.ok(init.signal instanceof AbortSignal);
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(inspected, true);

  const controller = new AbortController();
  controller.abort(new DOMException("screen closed", "AbortError"));
  await assert.rejects(uploadStudioStorageObject({
    accessToken: "test-user-token",
    path: originalStudioImagePath(userId, jobId, 0),
    body: raw,
    contentType: "image/png",
    cacheControl: "31536000",
    parentSignal: controller.signal,
    timeoutMs: 1_000,
    configuration: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "publishable-test-key",
    },
    fetcher: async (_input, init) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      return new Response(null, { status: 200 });
    },
  }), /screen closed/);
});

test("source policy and server inspection enforce raw MIME, bytes, dimensions, and mobile caps", async () => {
  assert.doesNotThrow(() => assertStudioSourceFile({ type: "image/png", size: 2_000_000 }));
  assert.throws(() => assertStudioSourceFile({ type: "image/gif", size: 1_000 }), /JPG/);
  assert.throws(() => assertStudioSourceFile({ type: "image/png", size: maximumStudioSourceImageBytes + 1 }), /20MB/);
  assert.doesNotThrow(() => assertStudioSourceDimensions(3_000, 4_000));
  assert.throws(() => assertStudioSourceDimensions(599, 4_000), /600/);
  assert.throws(() => assertStudioSourceDimensions(50_001, 600), /1,600/);
  assert.throws(() => assertStudioSourceDimensions(10_000, 10_000), /1,600/);

  const contractSpec = {
    name: "source.jpg",
    role: "main",
    originalName: "source.png",
    originalBytes: 24,
    originalMediaType: "image/png" as const,
    originalPath: `${userId}/${jobId}/original/001.source`,
    originalWidth: 3_000,
    originalHeight: 4_000,
    width: 1200 as const,
    height: 1200 as const,
    bytes: 100,
    mediaType: "image/jpeg" as const,
    fit: "contain" as const,
  };
  assert.equal(sourcePreservingProductImageSpecSchema.safeParse(contractSpec).success, true);
  assert.equal(sourcePreservingProductImageSpecSchema.safeParse({ ...contractSpec, originalWidth: 599 }).success, false);
  assert.equal(sourcePreservingProductImageSpecSchema.safeParse({ ...contractSpec, originalWidth: 50_001 }).success, false);

  const source = png(3_000, 4_000);
  const spec = [{
    originalBytes: source.size,
    originalMediaType: "image/png" as const,
    originalWidth: 3_000,
    originalHeight: 4_000,
  }];
  assert.equal(await verifyOriginalStudioImages(["original"], spec, async () => source), true);
  assert.equal(await verifyOriginalStudioImages(["original"], [{ ...spec[0], originalBytes: source.size + 1 }], async () => source), false);
  assert.equal(await verifyOriginalStudioImages(["original"], [{ ...spec[0], originalWidth: 3_001 }], async () => source), false);
  assert.equal(await verifyOriginalStudioImages(["original"], [{ ...spec[0], originalMediaType: "image/jpeg" }], async () => source), false);
  const tooSmall = png(599, 600);
  assert.equal(await verifyOriginalStudioImages(["original"], [{ ...spec[0], originalBytes: tooSmall.size, originalWidth: 599, originalHeight: 600 }], async () => tooSmall), false);
  const tooWide = png(50_001, 600);
  assert.equal(await verifyOriginalStudioImages(["original"], [{ ...spec[0], originalBytes: tooWide.size, originalWidth: 50_001, originalHeight: 600 }], async () => tooWide), false);
});

test("100 preserved pairs verify concurrently with one bounded six-request budget", async () => {
  const normalizedPaths = Array.from({ length: 100 }, (_, index) => `normalized-${index}`);
  const originalPaths = Array.from({ length: 100 }, (_, index) => `original-${index}`);
  const normalized = jpeg(1200, 1200);
  const original = png(600, 600);
  const specs = originalPaths.map(() => ({
    originalBytes: original.size,
    originalMediaType: "image/png" as const,
    originalWidth: 600,
    originalHeight: 600,
  }));
  let active = 0;
  let maximumActive = 0;
  const startedAt = performance.now();
  const result = await verifyPreservedStudioImages({
    normalizedPaths,
    originalPaths,
    specs,
    download: async (path) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return path.startsWith("normalized-") ? normalized : original;
    },
  });
  const wallTimeMs = performance.now() - startedAt;
  assert.deepEqual(result, { normalized: true, originals: true });
  assert.equal(maximumPreservedStudioImageInspectionConcurrency, 6);
  assert.ok(maximumActive <= maximumPreservedStudioImageInspectionConcurrency);
  assert.ok(wallTimeMs < 1_500, `100-pair validation took ${wallTimeMs.toFixed(1)}ms`);
});

test("browser and server integration keep originals separate from previews and sign originals for workers", async () => {
  const [studio, claimRoute, maintenance] = await Promise.all([
    readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/maintenance/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(studio, /FileReader|readAsDataURL|blobToDataUrl/);
  assert.match(studio, /original:\s*sourceBatch\[offset\]\.file/);
  assert.match(studio, /originalMediaType:\s*sourceBatch\[offset\]\.file\.type/);
  assert.equal(studioPhotoPreparationConcurrency, 2);
  assert.equal(studioPhotoUploadConcurrency, 2);
  assert.match(claimRoute, /sourceImagePathsForWorker\(paths, imageSpecs\)/);
  assert.match(claimRoute, /createSignedUrls\(sourcePaths, 10 \* 60\)/);
  assert.match(maintenance, /expandStudioCleanupStoragePaths\(claim\.paths\)/);
});

test("the private AI bucket accepts the same bounded source formats and 20MB limit as the application", async () => {
  const migration = await readFile(new URL(
    "../supabase/migrations/20260826091300_preserve_studio_source_uploads.sql",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /where id = 'sellerpilot-ai'/);
  assert.match(migration, /file_size_limit = 20971520/);
  assert.match(migration, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]/);
  assert.match(migration, /v_updated <> 1/);
});
