import assert from "node:assert/strict";
import test from "node:test";
import { sellerSafeAiJobFailure } from "../lib/ai-worker-error-safety";

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

test("AI worker failure messages preserve concise actionable Korean validation errors", () => {
  assert.equal(
    sellerSafeAiJobFailure(new Error("원본 상품 기획 검증 실패 · 구성 수량 근거를 확인해 주세요.")),
    "원본 상품 기획 검증 실패 · 구성 수량 근거를 확인해 주세요.",
  );
  assert.equal(
    sellerSafeAiJobFailure(new Error("hero 이미지 업로드 실패: 일시적인 저장소 응답입니다.")),
    "hero 이미지 업로드 실패: 일시적인 저장소 응답입니다.",
  );
});
