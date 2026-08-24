import assert from "node:assert/strict";
import test from "node:test";
import { channelReadiness } from "../app/channel-readiness-data";

test("11번가는 운영 읽기·등록 성공과 아직 검증되지 않은 상품 변경·발송 범위를 분리해 표시한다", () => {
  const elevenst = channelReadiness.find((channel) => channel.key === "elevenst");

  assert.ok(elevenst);
  assert.equal(elevenst.overall, "partial");
  assert.equal(elevenst.consoleVerified, false);
  assert.equal(elevenst.apiReadPassed, true);
  assert.equal(elevenst.checks.find((check) => check.label === "실상품 등록·재조회")?.state, "verified");
  assert.equal(elevenst.checks.find((check) => check.label === "미검증 상품 변경 범위")?.state, "blocked");
  assert.equal(elevenst.checks.find((check) => check.label === "미검증 발송 범위")?.state, "blocked");
  assert.match(elevenst.summary, /listing\.create가 HTTP 200/);
  assert.doesNotMatch(elevenst.summary, /성공 이력 없음/);
  assert.match(elevenst.nextAction, /원격 상품번호.*Seller Office/);
});
