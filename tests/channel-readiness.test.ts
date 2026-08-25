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

test("Temu 자체개발 앱은 별도 발행 단계 없이 Online 전환과 수동 판매자 승인을 안내한다", () => {
  const temu = channelReadiness.find((channel) => channel.key === "temu");

  assert.ok(temu);
  assert.match(temu.nextAction, /앱 Online 전환/);
  assert.match(temu.nextAction, /App Key·Secret/);
  assert.match(temu.nextAction, /한국 Seller Center 수동 승인/);
  assert.match(temu.nextAction, /Access Token/);
  assert.doesNotMatch(temu.nextAction, /승인·발행/);
  assert.equal(temu.blockers.some((blocker) => /앱 발행/.test(blocker)), false);
});
