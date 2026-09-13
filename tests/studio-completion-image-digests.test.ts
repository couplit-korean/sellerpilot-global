import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { collectStudioCompletionImageDigests } from "../lib/studio-completion-image-digests";

const jobId = "10000000-0000-4000-8000-000000000001";
const claimToken = "20000000-0000-4000-8000-000000000001";
const paths = Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [asset.id, aiGeneratedAssetPath(jobId, asset, claimToken)]));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=", "base64");
const input = { jobId, claimToken, paths };
const response = (bytes: Uint8Array = png, headers: Record<string, string> = {}) => new Response(bytes, { headers: { "content-type": "image/png", ...headers } });

test("all 16 digests use actual stored PNG bytes with at most 3 concurrent downloads", async () => {
  let active = 0;
  let maximum = 0;
  const visited: string[] = [];
  const result = await collectStudioCompletionImageDigests({ ...input, download: async (path) => {
    visited.push(path); maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--; return response();
  } });
  assert.equal(Object.keys(result).length, 16);
  assert.deepEqual(new Set(visited), new Set(Object.values(paths)));
  assert.equal(maximum, 3);
  assert.ok(Object.values(result).every((value) => value === createHash("sha256").update(png).digest("hex")));
});

test("cross-claim and unknown paths are rejected before any Storage request", async () => {
  let calls = 0;
  const download = async () => { calls++; return response(); };
  await assert.rejects(collectStudioCompletionImageDigests({ ...input, paths: { hero: paths.hero.replace(claimToken, jobId) }, download }), /PATH_INVALID/);
  await assert.rejects(collectStudioCompletionImageDigests({ ...input, paths: { unknown: paths.hero }, download }), /PATH_INVALID/);
  assert.equal(calls, 0);
});

test("a missing object, failed response, wrong MIME, truncated or non-PNG bytes cannot create a digest ledger", async () => {
  for (const download of [
    async () => null,
    async () => new Response("missing", { status: 404 }),
    async () => response(png, { "content-type": "text/plain" }),
    async () => response(Buffer.from("not a png ".repeat(8))),
    async () => response(png.subarray(0, 8)),
    async () => response(png, { "content-length": String(png.length + 1) }),
    async () => response(png, { "content-length": "NaN" }),
  ]) await assert.rejects(collectStudioCompletionImageDigests({ ...input, paths: { hero: paths.hero }, download }));
});

test("stream byte limit works without Content-Length and cancels oversized bodies", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(collectStudioCompletionImageDigests({ ...input, paths: { hero: paths.hero },
    download: async () => new Response(stream, { headers: { "content-type": "image/png" } }),
  }), /TOO_LARGE/);
  assert.equal(cancelled, true);
});

test("single asset regeneration gets its own exact stored-byte digest", async () => {
  const result = await collectStudioCompletionImageDigests({ ...input, paths: { hero: paths.hero },
    download: async () => new Blob([png], { type: "image/png" }),
  });
  assert.deepEqual(result, { hero: createHash("sha256").update(png).digest("hex") });
});

test("completion route authorizes the claim and validates paths before hashes, and hashes before DB completion", async () => {
  const route = await readFile(new URL("../app/api/ai/worker/complete/route.ts", import.meta.url), "utf8");
  const authorize = route.indexOf('"sellerpilot_service_begin_ai_job_completion"');
  const validate = route.indexOf('completion.assetStoragePaths[asset.id] !== expectedPath');
  const hash = route.indexOf('resultPayload.asset_storage_sha256s = await collectStudioCompletionImageDigests');
  const complete = route.indexOf('serviceClient.rpc("sellerpilot_complete_ai_job_with_image_context"');
  assert.ok(authorize < validate && validate < hash && hash < complete);
  assert.match(route.slice(hash, complete), /catch[\s\S]*return NextResponse.json[\s\S]*status: 503/);
});
