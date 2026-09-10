import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { defaultProductDetailImageRoles } from "../lib/product-detail-image-manifest";
import { validateStoredProductGeneratedAssetPaths } from "../lib/studio-result-assets";
import {
  assertExternalDetailImportByteSet,
  bindExternalDetailImportRequest,
  externalDetailImportRequestSchema,
  inspectExternalDetailImportPng,
  type ExternalDetailImportServerContext,
} from "../lib/server-external-detail-import";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const referenceHash = hash("synthetic original photo fixture");
const context: ExternalDetailImportServerContext = {
  actorId: id(1), ownerId: id(2), productId: id(3),
  productUpdatedAt: "2026-09-05T12:00:00.123456+00:00", detailVersion: 1,
  aiJobId: id(4), verifiedReferenceSha256s: [referenceHash],
};
async function fixture() {
  const bytes = await Promise.all(defaultProductDetailImageRoles.map((_role, index) =>
    sharp({ create: { width: 600, height: 600, channels: 3, background: { r: index * 25, g: 80, b: 170 } } }).png().toBuffer()));
  const request = externalDetailImportRequestSchema.parse({
    importId: id(5), productId: context.productId,
    expectedProductUpdatedAt: context.productUpdatedAt,
    expectedDetailVersion: context.detailVersion, expectedAiJobId: context.aiJobId,
    source: { kind: "external_generated", tool: "synthetic test only", referenceSha256s: [referenceHash] },
    assets: defaultProductDetailImageRoles.map((role, index) => ({
      assetId: id(10 + index), role, originalFileName: `fixture-${index}.png`, mediaType: "image/png",
      byteLength: bytes[index].length, sourceSha256: hash(bytes[index]),
      alt: `Test fixture ${index}`, caption: "AI 설정샷 테스트. 소품 미포함. 실제 포장과 차이가 있을 수 있음.",
    })), imageRightsConfirmed: true, regeneratedPreviewAcknowledged: true,
  });
  return { request, bytes };
}

test("binds server owner/actor/product/fences and a new non-Studio storage namespace", async () => {
  const { request } = await fixture();
  const record = bindExternalDetailImportRequest(request, context);
  assert.equal(record.ownerId, context.ownerId);
  assert.equal(record.actorId, context.actorId);
  assert.match(record.requestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(record.requestSha256, bindExternalDetailImportRequest(request, context).requestSha256);
  assert.ok(record.assets.every((a) => a.storagePath.startsWith(`external-detail/${context.ownerId}/${context.productId}/${request.importId}/`)));
  assert.equal(validateStoredProductGeneratedAssetPaths(Object.fromEntries(record.assets.map((a) => [a.role, a.storagePath]))), null);
  assert.equal(Object.hasOwn(record, "approvedManifest"), false);
});

test("rejects injected owner/path/job success/approval fields rather than silently stripping", async () => {
  const { request } = await fixture();
  for (const field of ["ownerId", "actorId", "approvedManifest", "status", "assetStoragePaths"]) {
    assert.equal(externalDetailImportRequestSchema.safeParse({ ...request, [field]: "forged" }).success, false, field);
  }
  const input = structuredClone(request) as unknown as { assets: Record<string, unknown>[] };
  input.assets[0].storagePath = "results/another-job/claims/another-claim/hero.png";
  assert.equal(externalDetailImportRequestSchema.safeParse(input).success, false);
});

test("rejects stale product, microsecond timestamp, detail version and AI lineage", async () => {
  const { request } = await fixture();
  for (const patch of [{ productId: id(100) }, { expectedDetailVersion: 2 },
    { expectedProductUpdatedAt: "2026-09-05T12:00:00.123457+00:00" }, { expectedAiJobId: null }]) {
    assert.throws(() => bindExternalDetailImportRequest({ ...request, ...patch }, context), /PRODUCT_VERSION_CONFLICT/u);
  }
});

test("reference evidence must be server verified; tool name alone is not provenance proof", async () => {
  const { request } = await fixture();
  assert.throws(() => bindExternalDetailImportRequest({ ...request, source: { ...request.source, referenceSha256s: [hash("other")] } }, context), /REFERENCE_UNVERIFIED/u);
});

test("requires eight distinct roles, IDs, hashes and nonempty captions/rights", async () => {
  const { request } = await fixture();
  for (const field of ["role", "assetId", "sourceSha256"] as const) {
    const input = structuredClone(request);
    input.assets[1][field] = input.assets[0][field] as never;
    assert.equal(externalDetailImportRequestSchema.safeParse(input).success, false, field);
  }
  assert.equal(externalDetailImportRequestSchema.safeParse({ ...request, assets: request.assets.slice(0, 7) }).success, false);
  assert.equal(externalDetailImportRequestSchema.safeParse({ ...request, imageRightsConfirmed: false }).success, false);
  const input = structuredClone(request); input.assets[0].caption = " ";
  assert.equal(externalDetailImportRequestSchema.safeParse(input).success, false);
});

test("decodes eight actual PNGs and records byte evidence, never visual approval", async () => {
  const { request, bytes } = await fixture();
  const inspected = await Promise.all(request.assets.map((asset, index) => inspectExternalDetailImportPng(asset, bytes[index])));
  assertExternalDetailImportByteSet(request, inspected);
  assert.ok(inspected.every((entry) => entry.width === 600 && entry.verification === "bytes_only_not_approved"));
  assert.throws(() => assertExternalDetailImportByteSet(request, [...inspected].reverse()), /BYTE_SET_MISMATCH/u);
  const duplicatePixels = inspected.map((entry) => ({ ...entry, decodedRgbaSha256: inspected[0].decodedRgbaSha256 }));
  assert.throws(() => assertExternalDetailImportByteSet(request, duplicatePixels), /BYTE_SET_MISMATCH/u);
});

test("rejects byte tampering, false length, non-PNG, truncated PNG and too-small image", async () => {
  const { request, bytes } = await fixture(); const asset = request.assets[0];
  const tampered = Buffer.from(bytes[0]); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(inspectExternalDetailImportPng(asset, tampered), /SOURCE_HASH_MISMATCH/u);
  await assert.rejects(inspectExternalDetailImportPng({ ...asset, byteLength: asset.byteLength + 1 }, bytes[0]), /SOURCE_HASH_MISMATCH/u);
  const html = Buffer.from("<html>not an image</html>");
  await assert.rejects(inspectExternalDetailImportPng({ ...asset, byteLength: html.length, sourceSha256: hash(html) }, html), /PNG_REQUIRED/u);
  const truncated = bytes[0].subarray(0, bytes[0].length - 3);
  await assert.rejects(inspectExternalDetailImportPng({ ...asset, byteLength: truncated.length, sourceSha256: hash(truncated) }, truncated), /PNG_INVALID/u);
  const small = await sharp({ create: { width: 599, height: 600, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(inspectExternalDetailImportPng({ ...asset, byteLength: small.length, sourceSha256: hash(small) }, small), /DIMENSIONS_INVALID/u);
});

test("rejects animation-control chunks before decoding", async () => {
  const { request, bytes } = await fixture();
  const chunk = Buffer.alloc(12); chunk.write("acTL", 4, "ascii");
  const animated = Buffer.concat([bytes[0].subarray(0, 8), chunk, bytes[0].subarray(8)]);
  await assert.rejects(inspectExternalDetailImportPng({ ...request.assets[0], byteLength: animated.length, sourceSha256: hash(animated) }, animated), /ANIMATION_REJECTED/u);
});

test("caption, source and asset order are part of the immutable request fingerprint", async () => {
  const { request } = await fixture(); const baseline = bindExternalDetailImportRequest(request, context).requestSha256;
  const changed = structuredClone(request); changed.assets[0].caption += " changed";
  assert.notEqual(bindExternalDetailImportRequest(changed, context).requestSha256, baseline);
  assert.notEqual(bindExternalDetailImportRequest({ ...request, assets: [...request.assets].reverse() }, context).requestSha256, baseline);
});

test("module has no upload, fetch, RPC, manifest save, or job-success mutation", async () => {
  const source = await readFile(new URL("../lib/server-external-detail-import.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|\.rpc\s*\(|\.upload\s*\(|\.upsert\s*\(|sellerpilot_save_product_detail_page|status:\s*["']succeeded/u);
});
