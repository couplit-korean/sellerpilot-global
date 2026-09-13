import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateStudioTextWithCheckpoint, studioTextCheckpointIdentity } from "../scripts/studio-text-generation.mjs";

function inputs() {
  return {
    job: { id: "a51eb670-9ae8-46f0-ba92-1c860f284ec6", owner_id: "43434343-4343-4343-8343-434343434343",
      claim_token: "first-lease", request: { description: "verified product", manualFields: { productName: "Product", sellingPrice: 3000 },
        imageSpecs: [{ name: "front.png", role: "main", originalBytes: 100 }],
        images: [{ signedUrl: "https://example.test/signed?token=first" }],
        firstDraftQualityManifest: { version: 2, assets: { wide: { digest: "b".repeat(64) } } } } },
    imageFiles: [{ sourceIndex: 0, role: "main", sourceDigest: "a".repeat(64), sourceBytes: 100, file: "/tmp/first/input.png" }],
    referenceText: "verified reference", referenceWarnings: [], competitorContext: null,
  };
}
const body = { mode: "cli", product: { name: "Product" }, localizedListings: [{ title: "Saved title", description: "Saved body" }] };
const validateResult = (value) => value.mode === "cli" && value.product?.name === "Product"
  && value.localizedListings?.length === 1 && value.localizedListings[0].description === "Saved body";

test("new lease and signed URLs retain identity but source, facts, reference and manifest changes do not", () => {
  const initial = inputs();
  const identity = studioTextCheckpointIdentity(initial);
  const retry = structuredClone(initial);
  retry.job.claim_token = "second-lease";
  retry.job.request.images[0].signedUrl = "https://example.test/signed?token=second";
  retry.imageFiles[0].file = "/tmp/second/input.png";
  assert.deepEqual(studioTextCheckpointIdentity(retry), identity);
  for (const change of [
    (value) => { value.job.request.manualFields.sellingPrice = 4000; },
    (value) => { value.referenceText = "new evidence"; },
    (value) => { value.imageFiles[0].sourceDigest = "c".repeat(64); },
    (value) => { value.job.request.firstDraftQualityManifest.assets.wide.digest = "d".repeat(64); },
  ]) {
    const value = structuredClone(initial); change(value);
    assert.notDeepEqual(studioTextCheckpointIdentity(value), identity);
  }
  const ownerless = inputs(); delete ownerless.job.owner_id;
  assert.equal(studioTextCheckpointIdentity(ownerless), null);
});

test("completed text survives downstream image failure and the next claim skips all text generation", async () => {
  const cacheDir = await realpath(await mkdtemp(join(tmpdir(), "studio-text-generation-")));
  let generations = 0;
  let imageChecks = 0;
  const options = { ...inputs(), cacheDir, hmacKey: Buffer.alloc(32, 7), validateResult,
    generate: async () => { generations++; return structuredClone(body); } };
  try {
    const first = await generateStudioTextWithCheckpoint(options);
    assert.equal(first.reused, false);
    await assert.rejects(async () => { imageChecks++; throw new Error("detail-package OCR failed"); }, /OCR failed/);
    const secondInput = inputs();
    secondInput.job.claim_token = "new-claim";
    secondInput.job.request.images[0].signedUrl += "-new";
    const retry = await generateStudioTextWithCheckpoint({ ...options, ...secondInput });
    imageChecks++;
    assert.equal(retry.reused, true);
    assert.equal(retry.digest, first.digest);
    assert.deepEqual(retry.result, body);
    assert.equal(generations, 1, "new claim must not repeat master or any localization calls");
    assert.equal(imageChecks, 2, "only text is reused; downstream image checks run again");
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test("ownerless legacy claims never read or write a checkpoint", async () => {
  const cacheDir = join(tmpdir(), "must-not-exist-studio-text-legacy");
  const input = inputs(); delete input.job.owner_id;
  let generated = 0;
  const options = { ...input, cacheDir, hmacKey: Buffer.alloc(32, 7), validateResult,
    generate: async () => { generated++; return structuredClone(body); } };
  assert.equal((await generateStudioTextWithCheckpoint(options)).digest, null);
  assert.equal((await generateStudioTextWithCheckpoint(options)).reused, false);
  assert.equal(generated, 2);
});

test("worker connection validates cached text before facts, image verification and uploads", async () => {
  const worker = await readFile(new URL("../scripts/product-ai-worker.mjs", import.meta.url), "utf8");
  const start = worker.indexOf("const studioText = await generateStudioTextWithCheckpoint");
  const end = worker.indexOf("const identityCutouts = await prepareIdentityCutoutsForJob", start);
  const connection = worker.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(connection, /cliStudioResultSchema\.parse\(normalizeStudioResultForTerminalValidation\(studioText.result\)\)/);
  assert.match(connection, /bindPreparedImageProduct\(result, preparedFacts.data\)/);
  assert.ok(connection.includes('createHash("sha256").update("sellerpilot-studio-text-checkpoint/v1\\0").update(aiWorkerToken).digest()'));
});
