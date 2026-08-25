import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedProductResearchValue,
  ProductResearchNotFoundError,
  ProductResearchTerminalError,
  shouldClearPendingProductResearch,
} from "../app/_publishing/product-research-lifecycle";

test("unverified research placeholders never become seller facts", () => {
  assert.equal(confirmedProductResearchValue("공급처 확인 필요"), "");
  assert.equal(confirmedProductResearchValue("No Brand"), "");
  assert.equal(confirmedProductResearchValue("Kellogg Korea"), "Kellogg Korea");
});

test("terminal worker failures always release the pending product research job", () => {
  const arbitraryWorkerFailure = new ProductResearchTerminalError("원격 본문 파싱 단계에서 실패했습니다.");

  assert.equal(arbitraryWorkerFailure.message, "원격 본문 파싱 단계에서 실패했습니다.");
  assert.equal(shouldClearPendingProductResearch(arbitraryWorkerFailure), true);
  assert.equal(shouldClearPendingProductResearch(new ProductResearchNotFoundError()), true);
});

test("transient polling failures preserve the pending product research job for safe recovery", () => {
  assert.equal(shouldClearPendingProductResearch(new Error("모바일 네트워크 상태 확인 실패")), false);
  assert.equal(shouldClearPendingProductResearch(new DOMException("사용자가 중단했습니다.", "AbortError")), false);
});

test("a succeeded job with an invalid result is represented as a terminal failure", () => {
  const invalidResult = new ProductResearchTerminalError("완료된 상품정보 작업의 결과 형식을 확인하지 못했습니다.");

  assert.equal(invalidResult.name, "ProductResearchTerminalError");
  assert.equal(shouldClearPendingProductResearch(invalidResult), true);
});
