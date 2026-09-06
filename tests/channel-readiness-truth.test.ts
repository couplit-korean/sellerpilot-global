import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  channelOverviewHealthLabel,
  channelReadiness,
  channelStepSelectionLabel,
  resolveChannelReadiness,
  temuHistoricComplianceRejectedOn,
  TEMU_EXTERNAL_APPROVAL_UNKNOWN,
  type ChannelReadinessLiveMetric,
} from "../app/channel-readiness-data";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const actionLoop = /View\s*Details|Create\s*App|설문 수정|설문 제출|Vault 저장|Access Token 발급|키 저장/i;
const resubmitCta = /재제출/;

function liveMetric(overrides: Partial<ChannelReadinessLiveMetric> = {}): ChannelReadinessLiveMetric {
  return {
    credentialStatus: "active",
    credentialLastCheckStatus: "passed",
    credentialLastCheckedAt: "2026-08-27T06:00:00.000Z",
    failedAttemptCount: 0,
    ...overrides,
  };
}

function channel(key: (typeof channelReadiness)[number]["key"]) {
  const found = channelReadiness.find((item) => item.key === key);
  assert.ok(found);
  return found;
}

function actionSurface(value: { nextAction: string; blockers: string[] }) {
  return `${value.nextAction}\n${value.blockers.join("\n")}`;
}

test("all eight marketplaces stay visible instead of being broadly excluded", () => {
  assert.deepEqual(
    channelReadiness.map((item) => item.key),
    ["qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay"],
  );
});

test("Temu implementation present is not live read or current approval", () => {
  const temu = channel("temu");
  assert.equal(temu.checks.find((check) => check.label === "V3 상품 발행 구현")?.state, "verified");
  assert.equal(temu.apiReadPassed, false);
  assert.equal(temu.overall, "blocked");
  assert.equal(temu.checks.find((check) => check.label === "Partner App")?.state, "blocked");
  assert.match(temu.summary, new RegExp(temuHistoricComplianceRejectedOn));
  assert.match(temu.summary, /Rejected/);
  assert.doesNotMatch(temu.summary, /생성 불가|구현 없음|발행 능력 없음/);
  assert.doesNotMatch(actionSurface(temu), actionLoop);
});

test("missing live key is not_configured and keeps dated Rejected as history not live", () => {
  const resolved = resolveChannelReadiness(channel("temu"), liveMetric({
    credentialStatus: "missing",
    credentialLastCheckStatus: null,
    credentialLastCheckedAt: null,
  }));
  assert.equal(resolved.overall, "not_configured");
  assert.equal(resolved.apiReadPassed, false);
  assert.match(resolved.appState, /Vault 운영 키 미등록/);
  assert.doesNotMatch(resolved.appState, /Rejected/);
  assert.match(resolved.summary, /Rejected/);
  assert.match(resolved.summary, new RegExp(temuHistoricComplianceRejectedOn));
  assert.equal(resolved.blockers.includes(TEMU_EXTERNAL_APPROVAL_UNKNOWN), true);
  assert.doesNotMatch(actionSurface(resolved), actionLoop);
  assert.doesNotMatch(resolved.nextAction, resubmitCta);
});

test("failed live diagnostic stays blocked without a resubmit CTA", () => {
  const resolved = resolveChannelReadiness(channel("temu"), liveMetric({
    credentialStatus: "unverified",
    credentialLastCheckStatus: "failed",
  }));
  assert.equal(resolved.overall, "blocked");
  assert.equal(resolved.apiReadPassed, false);
  assert.match(resolved.appState, /최근 API 읽기 진단 실패/);
  assert.doesNotMatch(resolved.appState, /Rejected/);
  assert.doesNotMatch(actionSurface(resolved), actionLoop);
  assert.doesNotMatch(resolved.nextAction, resubmitCta);
});

test("stale historic Rejected is dated context and not silent live approval", () => {
  const resolved = resolveChannelReadiness(channel("temu"), liveMetric({
    credentialStatus: "unverified",
    credentialLastCheckStatus: null,
  }));
  assert.equal(resolved.overall, "partial");
  assert.equal(resolved.apiReadPassed, false);
  assert.doesNotMatch(resolved.appState, /Rejected/);
  assert.match(resolved.summary, new RegExp(`${temuHistoricComplianceRejectedOn}[\\s\\S]*Rejected`));
  assert.match(resolved.summary, /현재 live 승인 상태가 아닙니다/);
  assert.equal(resolved.blockers.includes(TEMU_EXTERNAL_APPROVAL_UNKNOWN), true);
});

test("read-passed diagnostic is not publication or CS-complete and does not manufacture approval", () => {
  const resolved = resolveChannelReadiness(channel("temu"), liveMetric());
  assert.equal(resolved.overall, "partial");
  assert.notEqual(resolved.overall, "verified");
  assert.equal(resolved.apiReadPassed, true);
  assert.match(resolved.summary, /상품 발행이나 CS 전체 연결과 같지 않습니다/);
  assert.match(resolved.summary, /Rejected/);
  assert.doesNotMatch(resolved.appState, /Approved|승인 완료/);
  assert.equal(resolved.blockers.includes(TEMU_EXTERNAL_APPROVAL_UNKNOWN), true);
  assert.doesNotMatch(actionSurface(resolved), actionLoop);
  assert.doesNotMatch(resolved.nextAction, resubmitCta);
});

test("Qoo10 live active is not all CS ready", () => {
  const resolved = resolveChannelReadiness(channel("qoo10"), liveMetric());
  assert.equal(resolved.apiReadPassed, true);
  assert.equal(resolved.overall, "partial");
  assert.match(resolved.summary, /상품 발행이나 CS 전체 연결과 같지 않습니다/);
  assert.ok(resolved.blockers.length > 0);
});

test("Coupang static WING/API normal is historical until live evidence arrives", () => {
  const coupang = channel("coupang");
  assert.equal(coupang.apiReadPassed, false);
  assert.match(coupang.appState, /2026-08-24/);
  assert.match(coupang.appState, /당시 WING 로그인·Open API 읽기 정상/);
  assert.match(coupang.appState, /현재 연결은 운영 live로만 판정/);
  assert.equal(coupang.checks.some((check) => check.label === "현재 읽기 진단"), false);

  const missing = resolveChannelReadiness(coupang, liveMetric({
    credentialStatus: "missing",
    credentialLastCheckStatus: null,
    credentialLastCheckedAt: null,
  }));
  assert.equal(missing.overall, "not_configured");
  assert.equal(missing.apiReadPassed, false);

  const passed = resolveChannelReadiness(coupang, liveMetric());
  assert.equal(passed.apiReadPassed, true);
  assert.equal(passed.overall, "partial");
  assert.match(passed.summary, /상품 발행이나 CS 전체 연결과 같지 않습니다/);
});

test("overview health uses live evidence instead of treating zero errors as 정상", () => {
  assert.equal(channelOverviewHealthLabel({ credentialStatus: "missing", failedAttemptCount: 0 }), "키 필요");
  assert.equal(channelOverviewHealthLabel({ credentialStatus: "unverified", failedAttemptCount: 0 }), "진단 필요");
  assert.equal(channelOverviewHealthLabel({ credentialStatus: "active", failedAttemptCount: 0 }), "읽기 진단 통과");
  assert.equal(channelOverviewHealthLabel({ credentialStatus: "active", failedAttemptCount: 3 }), "오류 3");
  assert.notEqual(channelOverviewHealthLabel({ credentialStatus: "missing", failedAttemptCount: 0 }), "정상");
});

test("Step 3 reports selected count rather than 준비N", () => {
  assert.equal(channelStepSelectionLabel(0), "0개 선택");
  assert.equal(channelStepSelectionLabel(3), "3개 선택");
  assert.match(page, /channelStepSelectionLabel\(selectedChannels\.length\)/);
  assert.doesNotMatch(page, /개 채널 준비/);
  assert.match(page, /selected \? "3단계"/);
});

test("overview and intake handoff keep live selectable and 3-step copy", () => {
  assert.match(page, /channelOverviewHealthLabel\(channel\)/);
  assert.doesNotMatch(page, /failedAttemptCount \? `오류 \$\{channel\.failedAttemptCount\}` : "정상"/);
  assert.match(page, /metric\.credentialStatus === "active"/);
  assert.match(page, /운영 읽기 진단을 통과한 채널만 선택할 수 있습니다/);
  assert.match(page, /읽기 진단 통과 · 3단계 검증 필요/);
  assert.match(page, /const channelRuleHandoffs/);
  assert.match(page, /qoo10: "일본어 상품명/);
  assert.match(page, /ebay: "필수 상품 속성/);
  assert.match(page, /className="mobile-bottom-nav"/);
  assert.doesNotMatch(page, /ViewDetails|CreateApp/);
});
