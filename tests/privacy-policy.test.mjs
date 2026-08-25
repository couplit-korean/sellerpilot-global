import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("privacy policy names every confirmed Temu data-processing location and role", async () => {
  const policy = await readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");

  assert.match(policy, /대한민국에 위치한 운영자 관리 전용 작업자/);
  assert.match(policy, /Vercel의 미국 리전/);
  assert.match(policy, /AWS 싱가포르 리전의 Supabase/);
  assert.match(policy, /operator-managed worker in the Republic of Korea/);
  assert.match(policy, /Vercel in the United States/);
  assert.match(policy, /Supabase on AWS infrastructure in Singapore/);
  assert.match(policy, /Policy version 1\.1/);
  assert.doesNotMatch(policy, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
});
