import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("../app/api/admin/listing-publication-release/route.ts", import.meta.url);
const runtimeCardUrl = new URL("../app/ai-cli-runtime-card.tsx", import.meta.url);
const operationsCssUrl = new URL("../app/operations-system.css", import.meta.url);

test("listing publication release admin route derives the exact SHA server-side", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.equal((route.match(/authenticateAdminRequest\(request/g) ?? []).length, 2);
  assert.equal((route.match(/verifyAsymmetricClaimsLocally: true/g) ?? []).length, 2);
  assert.match(route, /resolveRuntimeReleaseIdentity\(\)/);
  assert.match(route, /z\.discriminatedUnion\("action"/);
  assert.equal((route.match(/\.strict\(\)/g) ?? []).length, 5);
  assert.match(route, /"qoo10",\s*"shopee",\s*"lazada",\s*"coupang",\s*"elevenst",\s*"smartstore",\s*"ebay",\s*"temu"/s);
  assert.match(route, /p_release_sha: identity\.status === "valid" \? identity\.release : null/);
  assert.doesNotMatch(route, /parsed\.data\.(?:release|releaseSha|sha)/);
  assert.doesNotMatch(route, /process\.env/);
  assert.match(route, /status: "unavailable" as const, currentRelease: null/);
  assert.match(route, /code: "runtime_release_unavailable"/);
  assert.match(route, /headers: noStoreHeaders/);
  assert.match(route, /readGateStatusOrTimeout/);
  assert.match(route, /배포 SHA는 확인했습니다/);
});

test("admin auth timeouts are retryable 503s, not permission 403s", async () => {
  const adminApi = await readFile(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  assert.match(adminApi, /function isAbortOrTimeoutError/);
  assert.match(adminApi, /async function withTimeout/);
  assert.doesNotMatch(adminApi, /AbortSignal\.timeout/);
  assert.match(adminApi, /관리자 권한 확인이 지연되고 있습니다/);
  assert.match(adminApi, /status: 503/);
  assert.match(adminApi, /getClaims\(token\)/);
  assert.match(adminApi, /\["ES256", "RS256"\]\.includes\(algorithm\)/);
  assert.match(adminApi, /claims\.iss !== issuer/);
  assert.match(adminApi, /claims\.role !== "authenticated"/);
  assert.match(adminApi, /uuidPattern\.test\(sessionId\)/);
  assert.match(adminApi, /expiresAt <= now/);
});

test("listing publication release actions call only the fenced service RPCs", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(route, /sellerpilot_service_listing_mutation_release_gate_status/);
  assert.match(route, /sellerpilot_service_set_listing_publication_adapter_ready/);
  assert.match(route, /p_channel: parsed\.data\.channel,\s*p_ready: true,/s);
  assert.match(route, /sellerpilot_service_set_listing_publication_rechecker_ready/);
  assert.match(route, /sellerpilot_service_set_listing_mutation_release_gate/);
  assert.match(route, /sellerpilot_service_set_listing_channel_mutation_release_gate/);
  assert.match(route, /action === "open_channel_gate"/);
  assert.match(route, /p_channel: parsed\.data\.channel,\s*p_open: true,/s);
  assert.match(route, /parsed\.data\.action !== "close_gate" && identity\.status !== "valid"/);
  assert.match(route, /p_open: parsed\.data\.action === "open_gate"/);
  assert.match(route, /p_release_sha: parsed\.data\.action === "open_gate" && identity\.status === "valid"[\s\S]*?: null/);
  assert.match(route, /listing_release_gate_preconditions_unmet/);
  assert.match(route, /8개 어댑터·재조회기·현재 런타임 SHA/);
  assert.match(route, /같은 작업을 반복하지 말고 현재 상태를 먼저 확인해 주세요/);
  assert.doesNotMatch(route, /error\.message|error\.details|error\.hint/);
});

test("channel connection UI uses inline two-step confirmations for release writes", async () => {
  const runtimeCard = await readFile(runtimeCardUrl, "utf8");

  assert.match(runtimeCard, /authenticatedFetch\("\/api\/admin\/listing-publication-release"/);
  assert.match(runtimeCard, /AbortSignal\.timeout\(40_000\)/);
  assert.match(runtimeCard, /authenticatedFetch\("\/api\/admin\/listing-publication-release", \{\s*method: "POST"/s);
  assert.match(runtimeCard, /role="alertdialog" aria-label=\{copy\.title\}/);
  assert.match(runtimeCard, />취소<\/button>/);
  assert.match(runtimeCard, /executePendingConfirmation/);
  assert.match(runtimeCard, /setPendingConfirmation\(\{ kind: "runtime_activate" \}\)/);
  assert.doesNotMatch(runtimeCard, /window\.confirm\("현재 운영 배포/);
  assert.match(runtimeCard, /상품 게시를 자동 실행하지 않습니다/);
  assert.match(runtimeCard, /disabled=\{!listingRelease\.readyForOpen \|\| listingReleaseBusy/);
  assert.match(runtimeCard, /게시 게이트 닫기/);
  assert.match(runtimeCard, /Qoo10만 열기/);
  assert.match(runtimeCard, /다른 7개 채널은 계속 차단됩니다/);
  for (const label of ["Qoo10", "Shopee", "Lazada", "쿠팡", "11번가", "스마트스토어", "eBay", "Temu"]) {
    assert.match(runtimeCard, new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*확인 기록`, "s"));
  }
  assert.match(runtimeCard, /8개 채널 게시 릴리스 게이트/);
});

test("listing release controls remain usable without horizontal overflow on narrow screens", async () => {
  const css = await readFile(operationsCssUrl, "utf8");

  assert.match(css, /\.cli-listing-release-summary code \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.cli-release-confirmation \{ grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.cli-listing-release-summary \{ grid-template-columns: 1fr/);
  assert.match(css, /\.cli-listing-adapter-controls > div \{ display: grid; grid-template-columns: 1fr/);
});
