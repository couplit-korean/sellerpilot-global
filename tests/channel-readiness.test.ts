import assert from "node:assert/strict";
import test from "node:test";
import {
  channelReadiness,
  channelReadinessObservedAt,
  resolveChannelGatewayActivity,
  resolveChannelReadiness,
  temuHistoricComplianceRejectedOn,
  TEMU_EXTERNAL_APPROVAL_UNKNOWN,
  type ChannelReadinessLiveMetric,
} from "../app/channel-readiness-data";

function temuReadiness() {
  const temu = channelReadiness.find((channel) => channel.key === "temu");
  assert.ok(temu);
  return temu;
}

function liveMetric(overrides: Partial<ChannelReadinessLiveMetric> = {}): ChannelReadinessLiveMetric {
  return {
    credentialStatus: "active",
    credentialLastCheckStatus: "passed",
    credentialLastCheckedAt: "2026-08-27T06:00:00.000Z",
    ...overrides,
  };
}

test("11번가는 운영 읽기·등록 성공과 아직 검증되지 않은 상품 변경·발송 범위를 분리해 표시한다", () => {
  const elevenst = channelReadiness.find((channel) => channel.key === "elevenst");

  assert.ok(elevenst);
  assert.equal(elevenst.overall, "partial");
  assert.equal(elevenst.consoleVerified, false);
  assert.equal(elevenst.apiReadPassed, true);
  assert.equal(elevenst.checks.find((check) => check.label === "실상품 등록·재조회")?.state, "verified");
  assert.equal(elevenst.checks.find((check) => check.label === "상품 콘텐츠 수정")?.state, "verified");
  assert.equal(elevenst.checks.find((check) => check.label === "미검증 가격·재고 변경")?.state, "blocked");
  assert.equal(elevenst.checks.find((check) => check.label === "미검증 발송 범위")?.state, "blocked");
  assert.match(elevenst.summary, /listing\.create가 HTTP 200/);
  assert.doesNotMatch(elevenst.summary, /성공 이력 없음/);
  assert.match(elevenst.nextAction, /원격 상품번호.*Seller Office/);
});

test("국내 채널은 운영 키 읽기 통과만으로 남은 기능 차단을 완료 상태로 숨기지 않는다", () => {
  for (const key of ["coupang", "elevenst", "smartstore"] as const) {
    const channel = channelReadiness.find((item) => item.key === key);
    assert.ok(channel);

    const resolved = resolveChannelReadiness(channel, liveMetric());

    assert.equal(resolved.apiReadPassed, true);
    assert.equal(resolved.overall, "partial");
    assert.ok(resolved.blockers.length > 0);
    assert.equal(resolved.checks.find((check) => check.label === "현재 운영 API 읽기")?.state, "verified");
  }
});

test("Temu 정적 스냅샷은 최신 이력을 날짜와 함께 외부 차단으로 표시하고 재제출 행동 루프를 만들지 않는다", () => {
  const temu = temuReadiness();

  assert.equal(channelReadinessObservedAt, "2026.08.24");
  assert.equal(temu.overall, "blocked");
  assert.equal(temu.apiReadPassed, false);
  assert.match(temu.summary, /2026-08-24/);
  assert.match(temu.summary, /재제출 전 마지막 스냅샷/);
  assert.match(temu.summary, /현재 심사 결과를 뜻하지 않습니다/);
  assert.match(temu.appState, new RegExp(temuHistoricComplianceRejectedOn));
  assert.match(temu.appState, /Rejected/);
  assert.match(temu.summary, /Inactive/);
  assert.match(temu.summary, /Rejected/);
  assert.match(temu.summary, /gateway job 0건/);
  assert.equal(temu.checks.find((check) => check.label === "Partner App")?.state, "blocked");
  assert.equal(temu.checks.find((check) => check.label === "컴플라이언스 설문")?.state, "blocked");
  assert.equal(temu.checks.find((check) => check.label === "V3 상품 발행 구현")?.state, "verified");
  assert.match(temu.nextAction, /외부 확인/);
  assert.doesNotMatch(temu.nextAction, /View\s*Details|Create\s*App|설문 수정|Vault 저장|Access Token 발급/i);
  assert.equal(temu.blockers.includes(TEMU_EXTERNAL_APPROVAL_UNKNOWN), true);
  assert.equal(temu.blockers.some((blocker) => /앱 발행/.test(blocker)), false);
  assert.doesNotMatch(temu.summary, /생성 불가|구현 없음|발행 능력 없음/);
});

test("Temu live API 통과는 발행·CS 완료나 현재 승인으로 승격하지 않는다", () => {
  const resolved = resolveChannelReadiness(temuReadiness(), liveMetric());

  assert.equal(resolved.overall, "partial");
  assert.equal(resolved.apiReadPassed, true);
  assert.match(resolved.appState, /운영 DB 실시간/);
  assert.match(resolved.appState, /API 읽기 진단 통과/);
  assert.doesNotMatch(resolved.appState, /Rejected/);
  assert.match(resolved.summary, /현재 운영 DB에서 유효한 자격증명/);
  assert.match(resolved.summary, /상품 발행이나 CS 전체 연결과 같지 않습니다/);
  assert.match(resolved.summary, new RegExp(`마지막 콘솔 스냅샷\\(${channelReadinessObservedAt.replaceAll(".", "\\.")}\\)`));
  assert.match(resolved.summary, new RegExp(temuHistoricComplianceRejectedOn));
  assert.match(resolved.summary, /Rejected/);
  assert.equal(resolved.checks.find((check) => check.label === "현재 운영 API 읽기")?.state, "verified");
  assert.equal(resolved.checks.find((check) => check.label === "컴플라이언스 설문")?.state, "blocked");
  assert.equal(resolved.checks.find((check) => check.label === "V3 상품 발행 구현")?.state, "verified");
  assert.equal(resolved.checks.some((check) => check.label === "실계정 E2E"), false);
  assert.equal(resolved.blockers.includes(TEMU_EXTERNAL_APPROVAL_UNKNOWN), true);
  assert.match(resolved.nextAction, /상품 발행·CS 전체 준비와 같지 않습니다/);
  assert.match(resolved.nextAction, /외부 확인/);
  assert.doesNotMatch(resolved.nextAction, /View\s*Details|Create\s*App|재제출|설문 수정|Vault 저장|Access Token 발급/i);
});

test("Temu live credential 누락은 키 미등록으로 두고 과거 Rejected를 현재 승인처럼 쓰지 않는다", () => {
  const resolved = resolveChannelReadiness(temuReadiness(), liveMetric({
    credentialStatus: "missing",
    credentialLastCheckStatus: null,
    credentialLastCheckedAt: null,
  }));

  assert.equal(resolved.overall, "not_configured");
  assert.equal(resolved.apiReadPassed, false);
  assert.match(resolved.appState, /Vault 운영 키 미등록/);
  assert.doesNotMatch(resolved.appState, /Rejected/);
  assert.match(resolved.summary, /활성 production 자격증명이 없습니다/);
  assert.match(resolved.summary, new RegExp(temuHistoricComplianceRejectedOn));
  assert.match(resolved.summary, /Rejected/);
  assert.equal(resolved.checks.find((check) => check.label === "현재 운영 API 읽기")?.state, "not_configured");
  assert.equal(resolved.blockers.includes(TEMU_EXTERNAL_APPROVAL_UNKNOWN), true);
  assert.equal(resolved.blockers.some((blocker) => /App Key·Secret.*Access Token 연결/.test(blocker)), false);
  assert.match(resolved.nextAction, /외부 확인/);
  assert.doesNotMatch(resolved.nextAction, /View\s*Details|Create\s*App|Vault 저장|Access Token 발급|설문 수정/i);
});

test("Temu live read 실패는 verified로 승격하지 않고 재제출 CTA 없이 실패를 유지한다", () => {
  const resolved = resolveChannelReadiness(temuReadiness(), liveMetric({
    credentialStatus: "unverified",
    credentialLastCheckStatus: "failed",
  }));

  assert.equal(resolved.overall, "blocked");
  assert.equal(resolved.apiReadPassed, false);
  assert.match(resolved.appState, /최근 API 읽기 진단 실패/);
  assert.doesNotMatch(resolved.appState, /Rejected/);
  assert.match(resolved.summary, /읽기 진단은 실패했습니다/);
  assert.equal(resolved.checks.find((check) => check.label === "현재 운영 API 읽기")?.state, "blocked");
  assert.equal(resolved.blockers.some((blocker) => /API 읽기 진단 실패 원인 해소/.test(blocker)), true);
  assert.equal(resolved.blockers.includes(TEMU_EXTERNAL_APPROVAL_UNKNOWN), true);
  assert.match(resolved.nextAction, /오류 확인.*API 읽기 진단 재실행/);
  assert.doesNotMatch(resolved.nextAction, /View\s*Details|Create\s*App|재제출|설문 수정|Vault 저장/i);
});

test("게이트웨이 대기·실행 상태는 자격증명 읽기 통과와 분리해 일부 준비로 표시한다", () => {
  const ebay = channelReadiness.find((channel) => channel.key === "ebay");
  assert.ok(ebay);
  const gateway = resolveChannelGatewayActivity("ebay", [
    { channel_key: "ebay", data_type: "orders", status: "queued", last_error: null },
    { channel_key: "ebay", data_type: "inquiries", status: "running", last_error: null },
  ]);
  assert.ok(gateway);
  assert.equal(gateway.state, "running");

  const resolved = resolveChannelReadiness(ebay, liveMetric(), gateway);
  assert.equal(resolved.apiReadPassed, true);
  assert.equal(resolved.overall, "partial");
  assert.match(resolved.appState, /게이트웨이 실행 중/);
  assert.equal(resolved.checks.find((check) => check.label === "현재 게이트웨이 작업")?.state, "partial");
  assert.match(resolved.summary, /완료 전에는 최신 데이터 연결을 주장하지 않습니다/);
});

test("게이트웨이 reconciliation marker는 읽기 통과보다 우선해 채널을 차단한다", () => {
  const lazada = channelReadiness.find((channel) => channel.key === "lazada");
  assert.ok(lazada);
  const gateway = resolveChannelGatewayActivity("lazada", [{
    channel_key: "lazada",
    data_type: "orders",
    status: "failed",
    last_error: "provider outcome requires reconciliation",
  }]);
  assert.ok(gateway);
  assert.equal(gateway.state, "reconciliation_required");

  const resolved = resolveChannelReadiness(lazada, liveMetric(), gateway);
  assert.equal(resolved.apiReadPassed, true);
  assert.equal(resolved.overall, "blocked");
  assert.match(resolved.appState, /게이트웨이 원장 확인 필요/);
  assert.equal(resolved.checks.find((check) => check.label === "현재 게이트웨이 작업")?.state, "blocked");
  assert.equal(resolved.blockers.some((blocker) => /주문 게이트웨이 원장 확인 필요/.test(blocker)), true);
  assert.match(resolved.nextAction, /원격 결과 대조.*원장 조정 완료/);
});

test("자격증명 manual 판정은 단순 미확정이 아니라 연결 원장 차단으로 표시한다", () => {
  const shopee = channelReadiness.find((channel) => channel.key === "shopee");
  assert.ok(shopee);
  const resolved = resolveChannelReadiness(shopee, liveMetric({
    credentialStatus: "unverified",
    credentialLastCheckStatus: "manual",
  }));

  assert.equal(resolved.overall, "blocked");
  assert.equal(resolved.apiReadPassed, false);
  assert.match(resolved.appState, /연결 원장 수동 확인 필요/);
  assert.equal(resolved.blockers.some((blocker) => /연결 원장의 수동 확인 완료/.test(blocker)), true);
});
