import assert from "node:assert/strict";
import test from "node:test";
import { AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE } from "../lib/ai-gateway-failure";
import { sellerSafeAiJobFailure } from "../lib/ai-worker-error-safety";
import { StudioSegmentContractError } from "../lib/studio-segment-generation";

test("AI worker failure messages never expose prompts, credentials, or local runtime paths", () => {
  assert.equal(
    sellerSafeAiJobFailure(new Error(
      "features enabled: chronicle. ERROR rmcp::transport::worker AuthRequired "
      + 'www_authenticate_header="Bearer realm=\\"mcp\\"" https://mcp.example.test',
    )),
    "AI 생성 도구 연결이 중단되었습니다. 작업자를 다시 시작한 뒤 다시 실행해 주세요.",
  );
  assert.equal(
    sellerSafeAiJobFailure("Subject: same hero Primary request: sketch-to-render ```"),
    "AI 이미지 생성 도구가 올바른 결과를 반환하지 못했습니다. 작업자를 다시 시작한 뒤 다시 실행해 주세요.",
  );
  assert.equal(
    sellerSafeAiJobFailure("ENOENT /Users/example/private/node_modules/runtime.js"),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
  assert.equal(
    sellerSafeAiJobFailure("access_token=do-not-display"),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
});

test("AI worker failure messages fail closed for arbitrary upstream Korean text", () => {
  assert.equal(
    sellerSafeAiJobFailure(new Error("원본 상품 기획 검증 실패 · 구성 수량 근거를 확인해 주세요.")),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
  assert.equal(
    sellerSafeAiJobFailure(new Error("hero 이미지 업로드 실패: 일시적인 저장소 응답입니다.")),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
  assert.equal(
    sellerSafeAiJobFailure("공급자 내부 진단: 요청 원문과 고객 데이터가 포함될 수 있습니다."),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
});

test("AI worker preserves only its exact allowlisted seller-facing messages", () => {
  for (const upstream of [
    new Error("rmcp::transport::worker AuthRequired"),
    new Error("Primary request: sketch-to-render ```"),
  ]) {
    const safe = sellerSafeAiJobFailure(upstream);
    assert.equal(sellerSafeAiJobFailure(safe), safe);
  }
  assert.equal(
    sellerSafeAiJobFailure("AI 생성 도구 연결이 중단되었습니다. 작업자를 다시 시작한 뒤 다시 실행해 주세요. private"),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
});

test("AI worker exposes only the allowlisted Vercel customer verification guidance", () => {
  assert.equal(
    sellerSafeAiJobFailure("gateway_customer_verification_required"),
    AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
  );
  assert.equal(
    sellerSafeAiJobFailure("Server product studio failed: gateway_customer_verification_required"),
    AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
  );
  assert.equal(
    sellerSafeAiJobFailure(AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE),
    AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
    "a second API sanitization pass must preserve the approved Korean message",
  );
  assert.equal(
    sellerSafeAiJobFailure("gateway_customer_verification_required private provider body"),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
});

test("AI worker failure messages preserve only allowlisted studio contract diagnostics", () => {
  assert.equal(
    sellerSafeAiJobFailure(new StudioSegmentContractError(
      "budget-exhausted",
      "Studio master execution budget is exhausted.",
    )),
    "AI 마스터 기획 보정 시간이 모두 사용되었습니다. 입력 사진과 설명을 확인한 뒤 다시 실행해 주세요. [studio-budget-exhausted]",
  );
  assert.equal(
    sellerSafeAiJobFailure(sellerSafeAiJobFailure(new StudioSegmentContractError(
      "budget-exhausted",
      "Studio master execution budget is exhausted.",
    ))),
    "AI 마스터 기획 보정 시간이 모두 사용되었습니다. 입력 사진과 설명을 확인한 뒤 다시 실행해 주세요. [studio-budget-exhausted]",
    "the completion route's second sanitization pass must preserve the safe diagnostic",
  );
  assert.equal(
    sellerSafeAiJobFailure(new StudioSegmentContractError(
      "duplicate-target",
      "Duplicate localized target: shopee:MY.",
    )),
    "AI 현지화 대상이 중복되어 완료하지 못했습니다. 다시 실행해 주세요. [studio-duplicate-target]",
  );

  const untrusted = Object.assign(new Error("/Users/private/operator secret=do-not-display"), {
    name: "StudioSegmentContractError",
    code: "unrecognized-provider-error",
  });
  assert.equal(
    sellerSafeAiJobFailure(untrusted),
    "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.",
  );
});


test("AI worker distinguishes the exact gateway rate limit without leaking upstream diagnostics", () => {
  const expected = "AI 제공자의 요청 한도에 도달했습니다. 연속 재시도하지 말고 잠시 후 같은 작업을 다시 실행해 주세요. [gateway-rate-limited]";
  for (const value of [
    "gateway_rate_limited",
    "Server product studio failed: gateway_rate_limited",
    "Server product research failed: gateway_rate_limited",
    new Error("gateway_rate_limited"),
  ]) {
    assert.equal(sellerSafeAiJobFailure(value), expected);
    assert.equal(sellerSafeAiJobFailure(sellerSafeAiJobFailure(value)), expected);
  }
  for (const value of [
    "gateway_rate_limited private provider body",
    "gateway_rate_limited access_token=do-not-display",
    "provider says gateway_rate_limited",
    `${expected} private`,
  ]) {
    assert.equal(sellerSafeAiJobFailure(value), "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.");
  }
});
