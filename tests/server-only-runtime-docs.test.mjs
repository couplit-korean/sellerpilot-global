import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("example environment documents server-only runtime integrations without secret values", async () => {
  const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const requiredNames = [
    "SELLERPILOT_AI_WORKER_TOKEN",
    "AI_GATEWAY_API_KEY",
    "SELLERPILOT_RELEASE_SHA",
    "CRON_SECRET",
    "SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS",
    "VERCEL_ACCESS_TOKEN",
    "VERCEL_TEAM_ID",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_ORGANIZATION_SLUG",
    "NAVER_SEARCH_CLIENT_ID",
    "NAVER_SEARCH_CLIENT_SECRET",
    "ELEVENST_OPEN_API_KEY",
    "EBAY_BROWSE_CLIENT_ID",
    "EBAY_BROWSE_CLIENT_SECRET",
    "BRAVE_SEARCH_API_KEY",
  ];

  for (const name of requiredNames) {
    assert.match(example, new RegExp(`^${name}=$`, "m"));
  }
  assert.doesNotMatch(example, /^VERCEL_OIDC_TOKEN=/m);
  assert.match(example, /Vercel injects the request-scoped OIDC token automatically/);
  assert.match(example, /This does not configure Vercel Cron/);

  const documentedSensitiveAssignments = example
    .split(/\r?\n/u)
    .filter((line) => requiredNames.some((name) => line.startsWith(`${name}=`)));
  assert.ok(
    documentedSensitiveAssignments.every((line) => line.endsWith("=")),
    "documented server and provider variables must not contain credentials or placeholder secrets",
  );
});

test("operations checklist treats Vercel as the only production product worker", async () => {
  const [checklist, credentialGuide] = await Promise.all([
    readFile(new URL("../docs/운영_배포_인증_체크리스트.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/API_키_인증_운영가이드.md", import.meta.url), "utf8"),
  ]);

  assert.match(checklist, /## 7\. Vercel 서버 AI 스튜디오/);
  assert.match(checklist, /Production 상품 분석·이미지 제작은 Vercel Node 런타임만 사용한다/);
  assert.match(checklist, /Mac LaunchAgent[\s\S]*운영 선행조건이나 장애 시 자동 대체 경로가 아니다/);
  assert.match(checklist, /마지막 Mac heartbeat나 구성 감지만 운영 준비 판정에 사용하지 않는다/);
  assert.match(checklist, /5분 일정은 응답 직후 `after\(\)` 실행이 끊긴 경우 상품 스튜디오 큐를 먼저 복구/);
  assert.match(checklist, /### 서버 AI 토큰 불일치·만료 복구/);
  assert.match(checklist, /토큰 상태 조회 실패[^\n]*만료의 증거가 아니므로 토큰부터 교체하지 않는다/);
  assert.match(checklist, /`running > 0`[^\n]*토큰 교체와 작업 재시도를 중단/);
  assert.match(checklist, /마지막 정상 배포를 정확히 식별할 수 있으면 원문을 꺼내지 말고 그 배포를 복원/);
  assert.match(checklist, /32바이트 이상의 난수로 `spw_` 토큰을 한 번만 생성/);
  assert.match(checklist, /Supabase에는 원문을 보내지 않고 해시·지문·`ai` 범위·만료일만 사용/);
  assert.match(checklist, /제한된 database-owner 트랜잭션[^\n]*`token_revoked`·`token_issued` 감사를 함께 기록/);
  assert.match(checklist, /claim·heartbeat·terminal completion receipt/);
  assert.match(checklist, /SellerPilot 웹은 토큰 원문을 발급·조회·복사하거나 교체 mutation을 호출하지 않는다/);
  assert.doesNotMatch(checklist, /codex login status/);
  assert.doesNotMatch(checklist, /ai:worker:install:ai-only -- --rotate-token/);

  assert.match(credentialGuide, /서버 AI의 `SELLERPILOT_AI_WORKER_TOKEN`은 이 웹 입력 절차의 대상이 아니다/);
  assert.match(credentialGuide, /읽기 전용 상태·처리 건수·토큰 불일치 또는 만료 복구 안내 UI 구현\(웹 발급·교체·원문 표시 없음\)/);
  assert.doesNotMatch(credentialGuide, /범위 분리 작업자 토큰 발급·교체·만료·상태·처리 건수 UI 구현/);
  assert.match(credentialGuide, /서버 AI 토큰은 웹 입력창의 대상이 아니며 server-only 복구 절차만 사용한다/);
});
