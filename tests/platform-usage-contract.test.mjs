import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform usage route is admin-only, bounded and honest about missing connections", async () => {
  const [route, helper, component, css] = await Promise.all([
    readFile(new URL("../app/api/admin/platform-usage/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform-usage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/platform-usage-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform-usage-page.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /export async function GET\(request: Request\) \{\s*const auth = await authenticateAdminRequest/);
  assert.match(route, /if \(isAdminApiError\(auth\)\) return auth;/);
  assert.match(route, /VERCEL_ACCESS_TOKEN/);
  assert.match(route, /VERCEL_TEAM_ID/);
  assert.match(route, /SUPABASE_ACCESS_TOKEN/);
  assert.match(route, /SUPABASE_PROJECT_REF/);
  assert.match(route, /SUPABASE_ORGANIZATION_SLUG/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_(?:VERCEL|SUPABASE)_ACCESS_TOKEN/);
  assert.match(route, /platformUsageCacheSeconds \* 1_000/);
  assert.match(route, /next: \{ revalidate: platformUsageCacheSeconds \}/);
  assert.match(helper, /platformUsageCacheSeconds = 600/);
  assert.match(helper, /platformUsageProviderTimeoutMs = 8_000/);
  assert.match(route, /AbortSignal\.timeout\(platformUsageProviderTimeoutMs\)/);
  assert.match(route, /response too large/);
  assert.match(route, /cache-control": "private, no-store, max-age=0"/);
  assert.match(route, /Vercel Management API 연결정보가 없습니다/);
  assert.match(route, /Supabase Management API 연결정보가 없습니다/);
  assert.match(route, /\/v1\/billing\/charges/);
  assert.match(route, /\/v2\/teams\//);
  assert.match(route, /usage\.api-counts/);
  assert.match(route, /\/config\/disk\/util/);
  assert.match(route, /\/billing\/addons/);

  assert.match(component, /공식 API에서 제공하지 않는 과금 지표/);
  assert.match(component, /연결 대상/);
  assert.match(component, /1일 간격 API 집계/);
  assert.match(component, /공급자 반환 범위 합계/);
  assert.doesNotMatch(component, /최근 1일 API 요청/);
  assert.match(component, /확인되지 않은 백분율은 표시하지 않습니다/);
  assert.match(component, /과금 quota가 아닌 현재 디스크 사용률입니다/);
  assert.match(component, /cache: "no-store"/);
  assert.match(css, /@media \(max-width: 330px\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /min-height: 44px/);
});
