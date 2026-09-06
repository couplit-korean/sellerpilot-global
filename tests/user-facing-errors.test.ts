import assert from "node:assert/strict";
import test from "node:test";
import { customerFacingCopy, userFacingErrorMessage, userNotice } from "../lib/user-facing-errors";

test("technical provider failures become actionable customer messages", () => {
  const samples = [
    "CHANNEL_GATEWAY_TIMEOUT: HTTP 504 from inventory.update",
    "GW.AUTHN.UNAUTHORIZED OAuth token expired",
    "HTTP 422 InvalidImageUrl payload={traceId:abc}",
    "No exactly matching API specification for listing.create",
  ];
  for (const sample of samples) {
    const message = userFacingErrorMessage(sample);
    assert.doesNotMatch(message, /CHANNEL_|HTTP|OAuth|payload|traceId|listing\.create|API/);
    assert.match(message, /[가-힣]/);
  }
});

test("useful Korean guidance is preserved and developer vocabulary is polished", () => {
  assert.equal(
    userFacingErrorMessage("대표사진을 다시 선택해 주세요."),
    "상품 사진을 등록 기준에 맞게 준비하지 못했습니다. JPG 또는 PNG 사진을 다시 선택하면 크기와 용량을 자동으로 맞춘 뒤 재등록합니다.",
  );
  assert.equal(
    customerFacingCopy("OAuth 연결과 Vault 저장이 완료됐습니다."),
    "판매자 계정 연결과 보안 저장소 저장이 완료됐습니다.",
  );
});

test("operation success messages use seller-friendly labels", () => {
  const notice = userNotice("쿠팡 inventory.update 작업이 정상 응답했습니다.");
  assert.deepEqual(notice, { message: "쿠팡 재고 변경이 완료됐습니다.", tone: "success" });
});

test("failure notices never use a success tone", () => {
  assert.equal(userNotice("HTTP 500 Internal Server Error").tone, "error");
  assert.equal(userNotice("로그인이 만료되었습니다.").tone, "warning");
});

test("shipping setup failures name the seller information to correct", () => {
  for (const [code, expected] of [
    ["COUPANG_SHIPPING_FEE_CONFIRMATION_REQUIRED", /쿠팡 배송비 유형과 금액/],
    ["SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED", /출고지·반품지/],
    ["LISTING_SHIPPING_CONFIRMATION_REQUIRED:shippingRule,packagingRule", /배송규칙·포장규칙/],
    ["QOO10_UPDATE_SHIPPING_UNVERIFIED", /현재 배송그룹을 확인하지 못해 수정을 중단/],
  ] as const) {
    const notice = userNotice(new Error(code));
    assert.match(notice.message, expected);
    assert.doesNotMatch(notice.message, /CONFIRMATION_REQUIRED|shippingRule|packagingRule/);
    assert.notEqual(notice.tone, "success");
  }
});

test("uncertain eBay shipment messages preserve the no-resend instruction before generic error mapping", () => {
  for (const code of ["EXISTING_CONFLICT", "WRITE_UNCERTAIN", "READBACK_UNAVAILABLE", "READBACK_MISMATCH"]) {
    const notice = userNotice(`EBAY_SHIPMENT_${code}: HTTP 503 timeout quantity`);
    assert.match(notice.message, /다시 전송하지 마세요/);
    assert.match(notice.message, /송장번호·주문 품목과 수량/);
    assert.doesNotMatch(notice.message, /다시 시도|HTTP|EBAY_SHIPMENT/);
    assert.equal(notice.tone, "warning");
  }
});
