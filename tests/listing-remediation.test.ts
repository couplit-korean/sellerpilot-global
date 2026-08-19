import assert from "node:assert/strict";
import test from "node:test";
import { applyListingRemediation, classifyListingFailure } from "../lib/channels/listing-remediation";
import type { ChannelOperationResult } from "../lib/channels/operations";

function failedResult(data: Record<string, unknown>, channel: ChannelOperationResult["channel"] = "lazada"): ChannelOperationResult {
  return {
    ok: false,
    channel,
    operation: "listing.create",
    steps: [{ name: "listing-create", ok: false, status: 422, data }],
    safeMessage: "원격 오류로 종료됐습니다.",
  };
}

test("restricted category responses stop retries and require a new category confirmation", () => {
  const result = failedResult({
    code: "4222",
    detail: [{ code: "BIZ_CHECK_RESTRICTED_CATEGORY_NO_AUTHORITY_PRE_QC_RESTRICTED_CATEGORY_ERROR", message: "You are not authorised to sell this category." }],
  });
  const remediation = classifyListingFailure(result);

  assert.equal(remediation?.kind, "category_permission");
  assert.equal(remediation?.rejectCategory, true);
  assert.match(applyListingRemediation(result).result.safeMessage, /다른 최종 카테고리/);
});

test("Qoo10 category permission failures use the same deterministic remediation", () => {
  const remediation = classifyListingFailure(failedResult({
    ResultCode: "-130",
    ResultMsg: "You do not have permission to list items in this category.",
  }, "qoo10"));

  assert.equal(remediation?.code, "CATEGORY_PERMISSION_REQUIRED");
  assert.equal(remediation?.retryableAfterCorrection, true);
});

test("Naver category authority failures stop retries and reject the saved category", () => {
  const remediation = classifyListingFailure(failedResult({
    code: "NotAuthority.product.category.id",
    message: "등록권한이 있어야만 판매가 가능합니다.",
  }));
  assert.equal(remediation?.kind, "category_permission");
  assert.equal(remediation?.rejectCategory, true);
});

test("image errors surface the automatic normalized-image recovery state", () => {
  const remediation = classifyListingFailure(failedResult({ error: "invalid image dimensions" }, "shopee"));

  assert.equal(remediation?.kind, "image");
  assert.equal(remediation?.rejectCategory, false);
  assert.match(remediation?.safeMessage ?? "", /크기와 용량을 자동/);
});

test("remediation keeps provider details out of the customer guidance", () => {
  const result = applyListingRemediation({
    ok: false,
    channel: "ebay",
    operation: "listing.create",
    safeMessage: "eBay listing.create failed · Brand is mandatory and must be an array",
    steps: [{ name: "inventory-item", ok: false, status: 400, data: { message: "Brand is mandatory and must be an array" } }],
  });
  assert.match(result.result.safeMessage, /직접 입력 필요/);
  assert.doesNotMatch(result.result.safeMessage, /Brand is mandatory|listing\.create/);
});

test("Temu and eBay image readback failures remain automatically retryable image errors", () => {
  for (const [channel, marker] of [
    ["temu", "TEMU_IMAGE_READBACK_MISSING"],
    ["ebay", "EBAY_IMAGE_READBACK_MISSING"],
  ] as const) {
    const remediation = classifyListingFailure(failedResult({ sellerpilotVerification: marker }, channel));
    assert.equal(remediation?.kind, "image");
    assert.equal(remediation?.retryableAfterCorrection, true);
  }
});

test("successful writes do not create remediation work", () => {
  const result: ChannelOperationResult = {
    ok: true,
    channel: "smartstore",
    operation: "listing.create",
    steps: [{ name: "listing-create", ok: true, status: 200, data: { code: "SUCCESS" } }],
    remoteId: "remote-1",
    safeMessage: "정상 응답했습니다.",
  };

  assert.equal(classifyListingFailure(result), null);
});
