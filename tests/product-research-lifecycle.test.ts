import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedProductResearchValue,
  pendingProductResearchForOwner,
  ProductResearchNotFoundError,
  ProductResearchTerminalError,
  shouldClearPendingProductResearch,
} from "../app/_publishing/product-research-lifecycle";

const researchJobId = "46c1fb0c-59e3-4f07-a3b2-dc9ff05ea19a";
const sourcePhotoSha256 = "a".repeat(64);
const lineageReceipt = "v1.test-lineage-payload.test-lineage-signature";

test("pending product research recovery is scoped to the signed-in owner", () => {
  const stored = {
    jobId: researchJobId,
    researchInput: "롯데 샌드",
    ownerId: "owner-a",
    sourcePhotoSha256,
    lineageReceipt,
  };

  assert.deepEqual(
    pendingProductResearchForOwner(stored, "owner-a", "롯데 샌드", sourcePhotoSha256),
    stored,
  );
  assert.equal(pendingProductResearchForOwner(stored, "owner-b", "롯데 샌드", sourcePhotoSha256), null);
  assert.equal(pendingProductResearchForOwner(stored, "owner-a", "사조 참치", sourcePhotoSha256), null);
  assert.equal(pendingProductResearchForOwner(stored, "owner-a", "롯데 샌드", "b".repeat(64)), null);
  assert.equal(
    pendingProductResearchForOwner({ jobId: researchJobId, researchInput: "롯데 샌드", ownerId: "owner-a" }, "owner-a", "롯데 샌드", sourcePhotoSha256),
    null,
  );
  assert.equal(
    pendingProductResearchForOwner({ ...stored, jobId: "not-a-job-id" }, "owner-a", "롯데 샌드", sourcePhotoSha256),
    null,
  );
  assert.equal(
    pendingProductResearchForOwner({ ...stored, lineageReceipt: "" }, "owner-a", "롯데 샌드", sourcePhotoSha256),
    null,
  );
});
import { productResearchFailureMessage } from "../lib/product-research-failure";

test("unverified research placeholders never become seller facts", () => {
  assert.equal(confirmedProductResearchValue("공급처 확인 필요"), "");
  assert.equal(confirmedProductResearchValue("No Brand"), "");
  assert.equal(confirmedProductResearchValue("Kellogg Korea"), "Kellogg Korea");
});

test("terminal worker failures always release the pending product research job", () => {
  const arbitraryWorkerFailure = new ProductResearchTerminalError("원격 본문 파싱 단계에서 실패했습니다.");

  assert.equal(
    arbitraryWorkerFailure.message,
    "AI 상품정보 분석 서버에 일시적으로 연결하지 못했습니다. 잠시 후 같은 입력으로 다시 시도해 주세요.",
  );
  assert.equal(shouldClearPendingProductResearch(arbitraryWorkerFailure), true);
  assert.equal(shouldClearPendingProductResearch(new ProductResearchNotFoundError()), true);
});

test("terminal gateway reasons become actionable Korean messages without technical leakage", () => {
  const cases = [
    ["gateway_customer_verification_required", "Vercel AI Gateway 계정 확인·결제수단 확인 필요"],
    ["Server product research failed: gateway_authentication_error", "운영 연결"],
    ["Server product research failed: gateway_billing_required", "결제·사용량"],
    ["gateway_forbidden", "권한 설정"],
    ["gateway_model_not_found", "모델 설정"],
    ["gateway_rate_limited", "요청이 몰려"],
    ["gateway_timeout", "응답이 지연"],
    ["gateway_request_failed", "일시적으로 연결"],
  ] as const;
  for (const [reason, expected] of cases) {
    const failure = new ProductResearchTerminalError(reason);
    assert.match(failure.message, new RegExp(expected));
    assert.doesNotMatch(failure.message, /gateway_|Server product research failed/i);
  }
  assert.doesNotMatch(
    new ProductResearchTerminalError("secret provider response body").message,
    /secret|provider response/i,
  );
});

test("API-redacted product research failures keep their exact meaning in the browser", () => {
  for (const reason of [
    "gateway_customer_verification_required",
    "gateway_authentication_error",
    "gateway_billing_required",
    "gateway_forbidden",
    "gateway_model_not_found",
    "gateway_rate_limited",
    "gateway_timeout",
  ]) {
    const apiMessage = productResearchFailureMessage(reason);
    const browserFailure = new ProductResearchTerminalError(apiMessage);
    assert.equal(browserFailure.message, apiMessage);
    assert.doesNotMatch(browserFailure.message, /gateway_|Server product research failed/i);
  }
  assert.notEqual(
    new ProductResearchTerminalError("공급자 비공개 원문").message,
    "공급자 비공개 원문",
  );
});

test("transient polling failures preserve the pending product research job for safe recovery", () => {
  assert.equal(shouldClearPendingProductResearch(new Error("모바일 네트워크 상태 확인 실패")), false);
  assert.equal(shouldClearPendingProductResearch(new DOMException("사용자가 중단했습니다.", "AbortError")), false);
});

test("a succeeded job with an invalid result is represented as a terminal failure", () => {
  const invalidResult = new ProductResearchTerminalError("gateway_result_invalid");

  assert.equal(invalidResult.name, "ProductResearchTerminalError");
  assert.match(invalidResult.message, /반환한 상품정보 형식/);
  assert.equal(shouldClearPendingProductResearch(invalidResult), true);
});
