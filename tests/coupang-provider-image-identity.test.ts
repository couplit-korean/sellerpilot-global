import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  listingPublicationProviderAssetEvidence,
  verifyListingPublicationContent,
} from "../lib/channels/listing-publication-content";

const remoteId = "16375780938";
const vendorItemId = "96027942778";
const realFirstDigest = "3a0764aa924756de829dbfb5f79597c55a10845ce5bca0c47af38aafd5aeec06";
const digests = [
  realFirstDigest,
  ...Array.from({ length: 7 }, (_, index) =>
    createHash("sha256").update(`coupang-provider-image-${index + 2}`, "utf8").digest("hex")),
];
const sourceUrls = digests.map((digest) =>
  `https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
const providerPaths = digests.map((digest) =>
  `vendor_inventory/${digest.slice(0, 4)}/${digest.slice(4)}.jpg`);
const roles = Array.from({ length: 8 }, (_, index) => `detail-section-${index + 1}`);
const title = "파스퇴르 순우유맛으로 채우는 간식 시간";
const description = "우유의 고소한 풍미와 제품 구성 및 보관 방법을 확인한 상품 상세 설명입니다.";
const resources = { sellerProductId: remoteId, vendorItemIds: [vendorItemId] };

function contents(images: readonly string[]) {
  return [
    { contentsType: "TEXT", contentDetails: [{ detailType: "TEXT", content: description }] },
    ...images.map((image) => ({
      contentsType: "IMAGE",
      contentDetails: [{ detailType: "IMAGE", content: image }],
    })),
  ];
}

function coupangRoot(images: readonly string[]) {
  return {
    sellerProductId: remoteId,
    sellerProductName: title,
    displayProductName: title,
    items: [{ vendorItemId, itemName: title, contents: contents(images) }],
  };
}

function assetBinding(urls = sourceUrls) {
  const approvedDetailImages = urls.map((publicUrl, index) => {
    const contentSha256 = /\/([0-9a-f]{64})\.jpg$/u.exec(new URL(publicUrl).pathname)?.[1];
    assert.ok(contentSha256);
    return {
      role: roles[index],
      approvedObjectPath: `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/${roles[index]}.png`,
      approvedSourceSha256: createHash("sha256").update(`approved-${index}`, "utf8").digest("hex"),
      publicUrl,
      objectPath: `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`,
      contentSha256,
    };
  });
  return {
    contract: "sellerpilot_publication_asset_binding_v1" as const,
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailImages,
    providerImageSurface: "detail_content" as const,
    providerTransportImages: approvedDetailImages.map((image) => ({
      role: image.role,
      publicUrl: image.publicUrl,
      objectPath: image.objectPath,
      contentSha256: image.contentSha256,
    })),
  };
}

function verification(input: {
  source?: readonly string[];
  sourceReadback?: readonly string[];
  remote?: readonly string[];
}) {
  const source = input.source ?? sourceUrls;
  const sourceArguments = {
    body: coupangRoot(source),
    sellerpilotPublicationAssetBinding: assetBinding(source),
  };
  const publicationAssetBinding = listingPublicationProviderAssetEvidence({
    channel: "coupang",
    remoteId,
    sourceArguments,
    providerArguments: sourceArguments,
  });
  assert.ok(publicationAssetBinding);
  return verifyListingPublicationContent({
    channel: "coupang",
    expectedLocale: "ko-KR",
    expectedImageCount: 8,
    remoteId,
    sourceArguments,
    sourceResponsePayload: {
      remoteState: {
        resources,
        evidence: { publicationAssetBinding },
      },
    },
    sourceRemotePayload: { code: "SUCCESS", data: coupangRoot(input.sourceReadback ?? providerPaths) },
    remotePayload: { code: "SUCCESS", data: coupangRoot(input.remote ?? providerPaths) },
    remoteResources: resources,
  });
}

test("Coupang provider paths preserve the exact ordered Supabase content digests", () => {
  const result = verification({});
  assert.equal(result.verified, true);
  assert.equal(result.detailImageCountVerified, true);
  assert.equal(result.contentDigestVerified, true);
  assert.equal(result.sourceImageDigest, result.remoteImageDigest);
  assert.deepEqual(result.mismatchFields, []);
});

test("Coupang provider image identity rejects hash and order drift", () => {
  const changedDigest = `${digests[3].slice(0, -1)}${digests[3].endsWith("0") ? "1" : "0"}`;
  const hashDrift = [...providerPaths];
  hashDrift[3] = `vendor_inventory/${changedDigest.slice(0, 4)}/${changedDigest.slice(4)}.jpg`;
  assert.equal(verification({ remote: hashDrift }).verified, false);

  const orderDrift = [...providerPaths];
  [orderDrift[2], orderDrift[3]] = [orderDrift[3], orderDrift[2]];
  assert.equal(verification({ remote: orderDrift }).verified, false);
});

test("Coupang provider image identity rejects invalid host, path, length, extension, and duplicates", () => {
  const attacks = [
    providerPaths.map((value, index) => index === 0 ? `https://image.coupangcdn.com/${value}` : value),
    providerPaths.map((value, index) => index === 0 ? value.replace("vendor_inventory/", "vendor-inventory/") : value),
    providerPaths.map((value, index) => index === 0 ? `${value.slice(0, -5)}.jpg` : value),
    providerPaths.map((value, index) => index === 0 ? value.replace(/\.jpg$/u, ".png") : value),
    providerPaths.map((value, index) => index === 7 ? providerPaths[0] : value),
  ];
  for (const remote of attacks) {
    const result = verification({ remote });
    assert.equal(result.verified, false);
    assert.equal(result.detailImageCountVerified, false);
  }
});

test("non-production Supabase fixtures retain exact literal comparison", () => {
  const literalDigests = Array.from({ length: 8 }, (_, index) =>
    createHash("sha256").update(`literal-image-${index}`, "utf8").digest("hex"));
  const literalUrls = literalDigests.map((digest) =>
    `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
  const result = verification({ source: literalUrls, sourceReadback: literalUrls, remote: literalUrls });
  assert.equal(result.verified, true);
  assert.equal(result.detailImageCountVerified, true);
});
