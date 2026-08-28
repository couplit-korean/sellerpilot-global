import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("privacy policy describes the deployed Vercel gateway without inventing an execution region", async () => {
  const policy = await readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");

  assert.match(policy, /Vercel Static IP, 데이터베이스 허용 정책, 요청별 송신 경로 확인/);
  assert.match(policy, /하나라도 확인되지 않으면 호출하지 않습니다/);
  assert.match(policy, /AI 상품 분석과 이미지 제작도 Vercel 서버에서 처리/);
  assert.match(policy, /AI Gateway에는 Vercel이 발급한 단기 OIDC를 사용/);
  assert.match(policy, /Supabase 싱가포르 리전/);
  assert.match(policy, /Vercel Static IP routing, the database allow policy, and request-scoped egress attestation/);
  assert.match(policy, /otherwise the operation is blocked/);
  assert.match(policy, /AI product analysis and image production also run on the Vercel server/);
  assert.match(policy, /AI Gateway with short-lived OIDC issued by Vercel/);
  assert.match(policy, /does not store a separate OpenAI API key/);
  assert.match(policy, /Supabase Singapore region/);
  assert.doesNotMatch(policy, /\bAWS\b/);
  assert.match(policy, /Policy version 1\.3/);
  assert.doesNotMatch(policy, /Vercel(?:의| in the) (?:미국|United States)/);
  assert.doesNotMatch(policy, /operator-managed worker in the Republic of Korea/);
  assert.doesNotMatch(policy, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
});
