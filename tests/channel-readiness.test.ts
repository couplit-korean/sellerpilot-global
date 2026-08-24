import assert from "node:assert/strict";
import test from "node:test";
import { channelReadiness } from "../app/channel-readiness-data";

test("11번가는 운영 읽기·등록 성공과 Seller Office 세션 만료를 분리해 표시한다", () => {
  const elevenst = channelReadiness.find((channel) => channel.key === "elevenst");

  assert.ok(elevenst);
  assert.equal(elevenst.overall, "partial");
  assert.equal(elevenst.consoleVerified, false);
  assert.equal(elevenst.apiReadPassed, true);
  assert.equal(elevenst.checks.find((check) => check.label === "실상품 등록·재조회")?.state, "verified");
  assert.match(elevenst.summary, /listing\.create가 HTTP 200/);
  assert.match(elevenst.nextAction, /원격 상품번호 화면 대조/);
});
