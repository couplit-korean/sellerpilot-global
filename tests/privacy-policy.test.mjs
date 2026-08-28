import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("privacy policy describes the deployed Vercel gateway without inventing an execution region", async () => {
  const policy = await readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");

  assert.match(policy, /Vercel Static IP, 데이터베이스 허용 정책, 요청별 송신 경로 확인/);
  assert.match(policy, /하나라도 확인되지 않으면 호출하지 않습니다/);
  assert.match(policy, /AI 이미지 제작에 필요한 ChatGPT OAuth 처리/);
  assert.match(policy, /Supabase 싱가포르 리전/);
  assert.match(policy, /Vercel Static IP routing, the database allow policy, and request-scoped egress attestation/);
  assert.match(policy, /otherwise the operation is blocked/);
  assert.match(policy, /ChatGPT OAuth used for AI image production remains on an operator-managed worker/);
  assert.match(policy, /Supabase Singapore region/);
  assert.doesNotMatch(policy, /\bAWS\b/);
  assert.match(policy, /Policy version 1\.2/);
  assert.doesNotMatch(policy, /Vercel(?:의| in the) (?:미국|United States)/);
  assert.doesNotMatch(policy, /operator-managed worker in the Republic of Korea/);
  assert.doesNotMatch(policy, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
});
