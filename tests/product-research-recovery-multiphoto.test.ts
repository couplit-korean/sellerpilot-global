import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { coreFirstDraftAssetIds } from "../lib/ai-generated-assets";
import { productResearchRecoveryImagesPending, verifyProductResearchRecoveryOriginals } from "../lib/product-research-recovery";
import { normalizedStudioImagePath, originalStudioImagePath, validatePreservedStudioUploadPaths } from "../lib/studio-image-paths";

const owner = "10000000-0000-4000-8000-000000000001";
const job = "20000000-0000-4000-8000-000000000001";

function fixture(count = 6) {
  const roles = ["main", "back", "left", "right", "label", "barcode"];
  const bytes = Array.from({ length: count }, (_, index) => Buffer.from(`preserved-original-${index}`));
  const originalPaths = bytes.map((_, index) => originalStudioImagePath(owner, job, index));
  const specs = bytes.map((data, index) => ({
    role: roles[index], originalPath: originalPaths[index], originalBytes: data.length,
    originalMediaType: "image/jpeg" as const, originalWidth: 1200, originalHeight: 1600,
  }));
  const evidence = bytes.map((data, index) => ({
    sourceIndex: index, inputRole: roles[index], sourceSha256: createHash("sha256").update(data).digest("hex"),
  }));
  const read: number[] = [];
  const input = {
    originalPaths, specs, sourcePhotoFingerprint: evidence[0].sourceSha256,
    sourcePhotoEvidence: evidence as unknown,
    download: async (path: string) => {
      const index = originalPaths.indexOf(path);
      read.push(index);
      return index < 0 ? null : new Blob([bytes[index]], { type: "image/jpeg" });
    },
  };
  return { input, bytes, evidence, read };
}

test("six-photo recovery hashes all six originals and retains source zero as its main fingerprint", async () => {
  const { input, read } = fixture();
  assert.equal(await verifyProductResearchRecoveryOriginals(input), input.sourcePhotoFingerprint);
  assert.deepEqual(read.sort(), [0, 1, 2, 3, 4, 5]);
  assert.ok(validatePreservedStudioUploadPaths(owner, job,
    input.originalPaths.map((_, index) => normalizedStudioImagePath(owner, job, index)), input.specs));
});

test("replacement of any original, including a non-main original with identical byte length, blocks recovery", async () => {
  for (let index = 0; index < 6; index += 1) {
    const { input, bytes } = fixture();
    bytes[index][0] ^= 1;
    assert.equal(await verifyProductResearchRecoveryOriginals(input), null, `source ${index}`);
  }
});

test("missing, reordered, mismatched-role, truncated, extra, and source-zero-drift evidence cannot recover six photos", async () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { value.input.sourcePhotoEvidence = undefined; },
    (value: ReturnType<typeof fixture>) => { value.evidence.reverse(); },
    (value: ReturnType<typeof fixture>) => { value.evidence[1].inputRole = "main"; },
    (value: ReturnType<typeof fixture>) => { value.evidence.pop(); },
    (value: ReturnType<typeof fixture>) => { value.evidence.push(value.evidence[5]); },
    (value: ReturnType<typeof fixture>) => { value.input.sourcePhotoFingerprint = "f".repeat(64); },
  ]) {
    const value = fixture();
    mutate(value);
    assert.equal(await verifyProductResearchRecoveryOriginals(value.input), null);
    assert.equal(value.read.length, 0);
  }
});

test("single-photo legacy recovery still verifies its fingerprint without evidence", async () => {
  const { input, bytes } = fixture(1);
  input.sourcePhotoEvidence = undefined;
  assert.equal(await verifyProductResearchRecoveryOriginals(input), input.sourcePhotoFingerprint);
  bytes[0][0] ^= 1;
  assert.equal(await verifyProductResearchRecoveryOriginals(input), null);
});

test("six-source ownership, order and job-scoped original paths remain enforced", () => {
  const { input } = fixture();
  const paths = input.originalPaths.map((_, index) => normalizedStudioImagePath(owner, job, index));
  assert.equal(validatePreservedStudioUploadPaths("30000000-0000-4000-8000-000000000001", job, paths, input.specs), null);
  assert.equal(validatePreservedStudioUploadPaths(owner, "40000000-0000-4000-8000-000000000001", paths, input.specs), null);
  const changed = structuredClone(input.specs);
  [changed[1].originalPath, changed[5].originalPath] = [changed[5].originalPath, changed[1].originalPath];
  assert.equal(validatePreservedStudioUploadPaths(owner, job, paths, changed), null);
});

test("only active catalog jobs are pending; completed, stopped and exhausted jobs cannot skip asset verification", () => {
  const catalog = Object.fromEntries(coreFirstDraftAssetIds.map(id => [id, { auditMode: "source-photo-catalog" }]));
  const generated = Object.fromEntries(coreFirstDraftAssetIds.map(id => [id, { auditMode: "segmented-source-composite" }]));
  assert.equal(productResearchRecoveryImagesPending({ status: "generating" }, catalog), true);
  assert.equal(productResearchRecoveryImagesPending({ status: "queued", exhausted: false }, catalog), true);
  for (const state of [null, { status: "done" }, { status: "cancelled" }, { status: "failed" }, { status: "queued", exhausted: true }]) {
    assert.equal(productResearchRecoveryImagesPending(state, catalog), false);
  }
  assert.equal(productResearchRecoveryImagesPending({ status: "generating" }, generated), false);
});

test("recovery route validates all sources before 202, hides generated URLs, and verifies completed assets before signing", async () => {
  const route = await readFile(new URL("../app/api/ai/product-research/recover/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /image(?:Paths|Specs)\.length !== 1/);
  const sourceCheck = route.indexOf("await verifyProductResearchRecoveryOriginals({");
  const pending = route.indexOf("if (imagesPending) {");
  const generatedCheck = route.indexOf("await verifyGeneratedStudioImages({");
  const responseSigning = route.indexOf("const [sourceSigning, generatedSigning]");
  assert.ok(sourceCheck > 0 && pending > sourceCheck && generatedCheck > pending && responseSigning > generatedCheck);
  assert.match(route.slice(pending, generatedCheck), /status: 202/);
  assert.match(route.slice(pending, generatedCheck), /generatedImages: \[\]/);
  assert.match(route.slice(pending, generatedCheck), /asset_storage_paths: undefined/);
  assert.match(route, /imagesPending \? \[\] : generatedEntries/);
});
