import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the SellerPilot login experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>SellerPilot \| 멀티채널 커머스 운영센터<\/title>/i);
  assert.match(html, /한 번의 등록/);
  assert.match(html, /모든 마켓에/);
  assert.match(html, /운영센터 로그인/);
  assert.match(html, /demo@sellerpilot\.kr/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("contains the complete multi-channel operating storyboard", async () => {
  const [page, layout, packageJson, storyboard, mockData] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/멀티채널_커머스_운영센터_스토리보드.md", import.meta.url), "utf8"),
    readFile(new URL("../app/mock-data.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /통합 대시보드/);
  assert.match(page, /이번 달 판매 1위/);
  assert.match(page, /상품 관리/);
  assert.match(page, /상품 등록 센터/);
  assert.match(page, /주문 · 판매/);
  assert.match(page, /CS 통합함/);
  assert.match(page, /Qoo10 Japan/);
  assert.match(page, /Shopee Singapore/);
  assert.match(page, /Lazada Malaysia/);
  assert.match(page, /서비스 스토리보드/);
  assert.match(page, /AI가 주문 정보와 정책을 반영한 답변 초안/);
  assert.match(page, /신뢰도 97% 이상/);
  assert.match(page, /DEMO_DATA_META\.label/);
  assert.match(mockData, /화면 검증용 임시 데이터/);
  assert.match(mockData, /레티놀 퍼밍 나이트 세럼/);
  assert.match(mockData, /Rina Kobayashi/);
  assert.match(mockData, /CS-2828/);
  assert.match(layout, /og-commerce\.png/);
  assert.match(storyboard, /핵심 사용자 여정/);
  assert.match(storyboard, /단계별 구축 범위/);
  assert.match(packageJson, /lucide-react/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
