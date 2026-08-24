import assert from "node:assert/strict";
import test from "node:test";
import { channelReadiness } from "../app/channel-readiness-data";

test("11번가는 실판매자 등록 검증 전까지 연결 완료로 표시하지 않는다", () => {
  const elevenst = channelReadiness.find((channel) => channel.key === "elevenst");

  assert.ok(elevenst);
  assert.equal(elevenst.overall, "blocked");
  assert.equal(elevenst.consoleVerified, false);
  assert.equal(elevenst.apiReadPassed, false);
  assert.equal(elevenst.checks.find((check) => check.label === "실상품 등록·재조회")?.state, "blocked");
  assert.match(elevenst.nextAction, /테스트상품 1건 생성·재조회/);
});
