import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const policyUrl = new URL("../app/privacy/page.tsx", import.meta.url);

// Evidence: docs/현재상태.md:109-125 (no paid Static IP, observed Mac egress),
// docs/출시준비-작업로그.md:411-418 (bounded local recovery, not all-channel operation),
// Temu Partner Platform: SellerPilot compliance Rejected / security Approved / Inactive,
// checked 2026-09-06. These tests do not certify live connectivity or app approval.
test("privacy network description does not imply paid Static IP is provisioned", async () => {
  const policy = await readFile(policyUrl, "utf8");
  assert.match(policy, /유료 Vercel Static IP는 사용하지 않습니다/);
  assert.match(policy, /Paid Vercel Static IP is not used/);
  assert.doesNotMatch(policy, /Vercel Static IP, 데이터베이스 허용 정책, 요청별 송신 경로 확인/);
  assert.doesNotMatch(policy, /Vercel Static IP routing, the database allow policy/);
  assert.match(policy, /채널별 승인·인증·허용 IP와 실제 송신 경로가 확인되지 않으면 호출하지 않습니다/);
  assert.match(policy, /Channel approval, authentication, allowed source IPs, and the actual egress route must be verified; otherwise the operation is blocked/);
});

test("Korean worker design and inactive Temu are explicit in both languages", async () => {
  const policy = await readFile(policyUrl, "utf8");
  assert.match(policy, /한국의 운영자 관리 worker 경로는 설계된 경로이며, 채널 승인이나 현재 실행 가능성을 뜻하지 않습니다/);
  assert.match(policy, /operator-managed worker in the Republic of Korea is a designed route[^.]*not proof of channel approval or current execution availability/);
  assert.match(policy, /2026-09-06 확인 기준 Temu 앱은 준법 심사 거절로 미활성 상태이며 API 실행이 불가능합니다/);
  assert.match(policy, /As verified on 2026-09-06, the Temu app is inactive following compliance rejection and cannot execute API operations/);
  assert.match(policy, /한국 worker를 통한 Temu 연결이나 개인정보 처리가 운영 중이라고 표시하지 않습니다/);
  assert.match(policy, /Temu connectivity or personal-data processing through the Korean worker is not represented as operational/);
});

test("network-only correction preserves established storage and AI security disclosures without inventing regions", async () => {
  const policy = await readFile(policyUrl, "utf8");
  assert.match(policy, /서버리스 실행이 허용된 마켓플레이스 API 작업은 운영 프로젝트의 Vercel 인프라에서 처리/);
  assert.match(policy, /marketplace API operations permitted for serverless execution run on the production project&apos;s Vercel infrastructure/);
  assert.match(policy, /AI 상품 분석과 이미지 제작도 Vercel 서버에서 처리/);
  assert.match(policy, /AI Gateway에는 Vercel이 발급한 단기 OIDC를 사용/);
  assert.match(policy, /Supabase 싱가포르 리전/);
  assert.match(policy, /AI product analysis and image production also run on the Vercel server/);
  assert.match(policy, /AI Gateway with short-lived OIDC issued by Vercel/);
  assert.match(policy, /does not store a separate OpenAI API key/);
  assert.match(policy, /Supabase Singapore region/);
  // Current project metadata confirms ap-southeast-1, not a named cloud-provider field.
  assert.doesNotMatch(policy, /\bAWS\b/);
  assert.doesNotMatch(policy, /Vercel(?:의| in the) (?:미국|United States)/);
  assert.doesNotMatch(policy, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  assert.match(policy, /Policy version 1\.4/);
  assert.match(policy, /Last reviewed: 2026-09-06/);
  assert.match(policy, /목적 종료 후 최대 30일 이내 자동 익명화/);
  assert.match(policy, /본 정책은 최소 반기마다/);
  assert.match(policy, /through the marketplace privacy channel or the operator&apos;s contractual contact/);
});
