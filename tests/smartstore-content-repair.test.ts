import assert from "node:assert/strict";
import test from "node:test";
import { prepareSmartstoreContentRepairBody, smartstoreContentRepairArgument, smartstoreContentRepairBodyHashes, smartstoreContentRepairBinding } from "../lib/channels/smartstore-content-repair";
function fixture() {
  const currentOriginProduct = { name: "old", detailContent: "old detail", images: { representativeImage: { url: "old" } },
    salePrice: 3190, stockQuantity: 1, leafCategoryId: "50001578", statusType: "SALE",
    deliveryInfo: { deliveryFee: { deliveryFeeType: "PAID", baseFee: 3000 } },
    detailAttribute: { sellerCodeInfo: { sellerManagementCode: "TEST-ONLY" }, unitCapacity: { totalCapacityValue: 315 }, productInfoProvidedNotice: { productInfoProvidedNoticeType: "ETC" } } };
  const currentChannelProduct = { channelProductName: "old channel", channelProductDisplayStatusType: "ON", naverShoppingRegistration: true };
  const hashes = smartstoreContentRepairBodyHashes({ originProduct: currentOriginProduct, smartstoreChannelProduct: currentChannelProduct });
  const uuid = "10000000-0000-4000-8000-000000000001";
  const marker = { contract: "smartstore_existing_content_repair_job_v1", ownerId: uuid, baselineId: uuid, productId: uuid,
    listingId: uuid, sourceJobId: uuid, sourceAttemptId: uuid, credentialId: uuid, sellerAccountKey: "c".repeat(64),
    sellerSku: "TEST-ONLY", originProductNo: "13688607602", channelProductNo: "13749310594",
    approvalRevision: 1, contentSha256: "a".repeat(64), manifestDigest: "b".repeat(64), ...hashes };
  const argumentsValue = { originProductNo: marker.originProductNo, [smartstoreContentRepairArgument]: marker,
    body: { originProduct: { name: "approved", detailContent: "approved detail", images: { representativeImage: { url: "approved" } } }, smartstoreChannelProduct: { channelProductName: "approved channel" } } };
  return { currentOriginProduct, currentChannelProduct, argumentsValue, marker };
}
test("repair changes only approved content and preserves every commercial field", () => {
  const input = fixture(); const before = structuredClone(input);
  const result = prepareSmartstoreContentRepairBody(input);
  assert.equal(result.originProduct.name, "approved");
  assert.equal(result.originProduct.salePrice, 3190); assert.equal(result.originProduct.stockQuantity, 1);
  assert.deepEqual(result.originProduct.deliveryInfo, input.currentOriginProduct.deliveryInfo);
  assert.deepEqual(result.originProduct.detailAttribute, input.currentOriginProduct.detailAttribute);
  assert.equal(smartstoreContentRepairBodyHashes(result).protectedBodySha256, input.marker.protectedBodySha256);
  assert.deepEqual(input, before);
});
test("prewrite content-only drift also requires a new baseline instead of overwriting concurrent edits", () => {
  const input = fixture(); input.currentOriginProduct.detailContent = "seller edit";
  assert.throws(() => prepareSmartstoreContentRepairBody(input), /PREWRITE_DRIFT/);
});
for (const field of ["salePrice", "stockQuantity", "leafCategoryId", "deliveryInfo", "detailAttribute", "statusType"]) {
  test(`source repair rejects ${field} in browser-independent request body`, () => {
    const input = fixture(); (input.argumentsValue.body.originProduct as Record<string, unknown>)[field] = "forbidden";
    assert.throws(() => prepareSmartstoreContentRepairBody(input), /FIELDS_FORBIDDEN/);
  });
}
test("image-prepared body may retain protected fields but must not change even one of them", () => {
  const input = fixture(); const body = prepareSmartstoreContentRepairBody(input);
  const args = { ...input.argumentsValue, body };
  assert.deepEqual(prepareSmartstoreContentRepairBody({ ...input, argumentsValue: args, phase: "prepared" }), body);
  body.originProduct.stockQuantity = 50;
  assert.throws(() => prepareSmartstoreContentRepairBody({ ...input, argumentsValue: args, phase: "prepared" }), /PROTECTED_FIELDS_CHANGED/);
});
test("malformed marker, wrong target and extra top-level body fields fail before mutation", () => {
  const input = fixture();
  assert.throws(() => smartstoreContentRepairBinding({ [smartstoreContentRepairArgument]: { ...input.marker, extra: true } }), /MARKER_INVALID/);
  assert.throws(() => prepareSmartstoreContentRepairBody({ ...input, argumentsValue: { ...input.argumentsValue, originProductNo: "99999999999" } }), /IDENTITY_REQUIRED/);
  assert.throws(() => prepareSmartstoreContentRepairBody({ ...input, argumentsValue: { ...input.argumentsValue, body: { ...input.argumentsValue.body, unknown: 1 } } }), /FIELDS_FORBIDDEN/);
});
test("hash follows shared SQL canonical key ordering, and full/content-protected digests differ appropriately", () => {
  const input = fixture();
  const reordered = Object.fromEntries(Object.entries(input.currentOriginProduct).reverse());
  assert.deepEqual(smartstoreContentRepairBodyHashes({ originProduct: reordered, smartstoreChannelProduct: input.currentChannelProduct }), { baselineBodySha256: input.marker.baselineBodySha256, protectedBodySha256: input.marker.protectedBodySha256 });
  reordered.name = "new content";
  const changed = smartstoreContentRepairBodyHashes({ originProduct: reordered, smartstoreChannelProduct: input.currentChannelProduct });
  assert.notEqual(changed.baselineBodySha256, input.marker.baselineBodySha256);
  assert.equal(changed.protectedBodySha256, input.marker.protectedBodySha256);
});
