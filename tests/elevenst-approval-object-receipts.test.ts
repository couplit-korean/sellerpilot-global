import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readElevenstApprovalObjectReceipts } from "../lib/product-registration/elevenst/approval-object-receipts";
import { elevenstNewProductSourceDigest } from "../lib/product-registration/elevenst/new-product-input-source";
import { canonicalProductDetailImageManifestInput, defaultProductDetailImageRoles } from "../lib/product-detail-image-manifest";

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

function generatedInput() {
  const prefix="results/a51eb670-9ae8-46f0-ba92-1c860f284ec6/claims/ad367681-a280-44b8-9651-bb293baf5351/";
  const entries=defaultProductDetailImageRoles.map(role=>({role,path:`${prefix}${role}.png`,sourceSha256:createHash("sha256").update(`${prefix}${role}.png`).digest("hex")}));
  return {...input,productImagePaths:entries.slice(0,4).map(entry=>entry.path),detailImagePaths:entries.map(entry=>entry.path),
    productImageSha256s:entries.slice(0,4).map(entry=>entry.sourceSha256),detailImageSha256s:entries.map(entry=>entry.sourceSha256),
    detailManifestDigest:createHash("sha256").update(canonicalProductDetailImageManifestInput(entries)).digest("hex")};
}

test("approved generated gallery uses the same claim and first four manifest assets with actual byte hashes",async()=>{
  const approved=generatedInput();
  const read=async(_bucket:string,path:string)=>({data:new Blob([path],{type:"image/png"}),error:null});
  const result=await readElevenstApprovalObjectReceipts(approved,read);
  assert.deepEqual(result.productImagePaths,approved.detailImagePaths.slice(0,4));
  assert.deepEqual(result.objectReceipts.slice(0,4).map(row=>row.bytesSha256),approved.productImageSha256s);
  assert.equal(result.objectReceipts.length,12);
  assert.equal(JSON.stringify(result).includes("expectedSha256"),false,"expected hashes are verification inputs, not extra receipt schema fields");
  await assert.rejects(readElevenstApprovalObjectReceipts(approved,async()=>({data:new Blob(["replaced storage bytes"],{type:"image/png"}),error:null})),/ASSET_BYTES_MISMATCH/);
});

test("generated gallery rejects absent manifest, changed claim, source-photo mixing and hash drift before storage access",async()=>{
  const good=generatedInput();let reads=0;
  const read=async()=>{reads++;return {data:null,error:null};};
  const otherClaim=structuredClone(good);otherClaim.detailImagePaths[7]=otherClaim.detailImagePaths[7].replace("ad367681","bd367681");
  const mixed=structuredClone(good);mixed.productImagePaths[0]="owner/original.jpg";
  const changedHash=structuredClone(good);changedHash.productImageSha256s[0]="0".repeat(64);
  for(const bad of [{...good,detailImageSha256s:undefined},{...good,detailManifestDigest:"0".repeat(64)},otherClaim,mixed,changedHash]) {
    await assert.rejects(readElevenstApprovalObjectReceipts(bad,read),/PATH_INVALID|BINDING_INVALID|MANIFEST_MISMATCH/);
  }
  assert.equal(reads,0);
});
