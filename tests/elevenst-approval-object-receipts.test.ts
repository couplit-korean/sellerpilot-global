import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readElevenstApprovalObjectReceipts } from "../lib/product-registration/elevenst/approval-object-receipts";
import { elevenstNewProductSourceDigest } from "../lib/product-registration/elevenst/new-product-input-source";

const input = {
  ownerId: "owner",
  productImagePaths: Array.from({ length: 4 }, (_, i) => `owner/${i}.jpg`),
  detailImagePaths: Array.from({ length: 8 }, (_, i) => `results/job/${i}.jpg`),
  detailImageBucket: "sellerpilot-ai" as const,
};

test("approval reads actual bytes with bounded concurrency and stable role order", async () => {
  let active = 0;
  let maximum = 0;
  const result = await readElevenstApprovalObjectReceipts(input, async (_bucket, path) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, path.includes("/0.") ? 5 : 1));
    active -= 1;
    return { data: new Blob([path], { type: "image/jpeg" }), error: null };
  });
  assert.equal(maximum, 3);
  assert.deepEqual(result.objectReceipts.map(row => row.path), [...input.productImagePaths, ...input.detailImagePaths]);
  for (const row of result.objectReceipts) {
    assert.equal(row.bytesSha256, createHash("sha256").update(row.path).digest("hex"));
    assert.equal(row.contentLength, Buffer.byteLength(row.path));
  }
  assert.equal(result.objectReceiptsSha256, elevenstNewProductSourceDigest(result.objectReceipts));
});

test("cross-owner paths are rejected before storage access", async () => {
  let reads = 0;
  await assert.rejects(readElevenstApprovalObjectReceipts({ ...input, productImagePaths: ["foreign/1.jpg", ...input.productImagePaths.slice(1)] }, async () => {
    reads += 1; return { data: null, error: null };
  }), /PATH_INVALID/);
  assert.equal(reads, 0);
});

for (const blob of [new Blob([], { type: "image/jpeg" }), new Blob(["login required"], { type: "text/html" })]) {
  test(`rejects unavailable image bytes (${blob.type}, ${blob.size})`, async () => {
    await assert.rejects(readElevenstApprovalObjectReceipts(input, async () => ({ data: blob, error: null })), /OBJECT_UNAVAILABLE/);
  });
}
