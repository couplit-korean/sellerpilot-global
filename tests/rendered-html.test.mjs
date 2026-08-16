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
  assert.match(html, /주문·상품·문의 업무를/);
  assert.match(html, /하나의 작업대에서/);
  assert.match(html, /운영센터 로그인/);
  assert.match(html, /Supabase Auth/);
  assert.doesNotMatch(html, /demo@sellerpilot\.kr|seller2026/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("contains the complete multi-channel operating storyboard and 175-item acceptance baseline", async () => {
  const [page, layout, styles, operationsStyles, packageJson, storyboard, mockData, acceptanceData, acceptancePage, exchangeRoute, readinessData, readinessPage, channelMapping] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-system.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/멀티채널_커머스_운영센터_스토리보드.md", import.meta.url), "utf8"),
    readFile(new URL("../app/mock-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/acceptance-checklist-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/acceptance-checklist.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/exchange-rates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/channel-readiness-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/channel-readiness.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/판매채널_실계정_UI_필드_매핑.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /통합 대시보드/);
  assert.match(page, /이번 달 판매 TOP 10/);
  assert.match(page, /기준 환율/);
  assert.match(page, /환율 새로고침/);
  assert.match(page, /3_600_000/);
  assert.doesNotMatch(page, /Math\.random/);
  assert.match(exchangeRoute, /api\.frankfurter\.dev\/v2\/rates/);
  assert.match(exchangeRoute, /daily-reference/);
  assert.match(page, /상품 관리/);
  assert.match(page, /상품 등록 센터/);
  assert.match(page, /마진 계산/);
  assert.match(page, /주문 · 판매/);
  assert.match(page, /CS 통합함/);
  assert.match(page, /Qoo10 Japan/);
  assert.match(page, /Shopee Singapore/);
  assert.match(page, /Lazada Malaysia/);
  assert.match(page, /쿠팡/);
  assert.match(page, /11번가/);
  assert.match(page, /네이버 스마트스토어/);
  assert.match(page, /eBay Global/);
  assert.match(page, /서비스 스토리보드/);
  assert.match(page, /개발 · 실검수/);
  assert.match(page, /채널 연동 준비/);
  assert.match(page, /API 키 · 인증/);
  assert.match(page, /commerce-service-rail/);
  assert.match(page, /통합 판매관리/);
  assert.match(page, /signInWithPassword/);
  assert.match(page, /판매자 콘솔 확인 · QAPI 미검증/);
  assert.match(page, /개발자 앱 Online · 라이브 푸시 OFF/);
  assert.match(page, /개발자 앱 Online · 웹훅 미구성/);
  assert.match(page, /AI가 주문 정보와 정책을 반영한 답변 초안/);
  assert.match(page, /신뢰도 97% 이상/);
  assert.match(page, /대표사진 1장이 반드시 필요/);
  assert.match(page, /id: "front"/);
  assert.match(page, /id: "barcode"/);
  assert.match(page, /option-photo-\$\{slot\.id\}/);
  assert.match(page, /id="extra-product-photos"[^>]*multiple/);
  assert.match(page, /상품 간략 설명/);
  assert.match(page, /참고 상품 링크/);
  assert.match(page, /AI 상품 분석 시작/);
  assert.match(page, /DEMO_DATA_META\.label/);
  assert.match(page, /MarginCalculatorPage/);
  assert.match(styles, /\.margin-workspace/);
  const marginCalculator = await readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8");
  assert.match(marginCalculator, /7 CHANNEL COMPARISON/);
  assert.match(marginCalculator, /손익분기 판매가/);
  assert.match(marginCalculator, /목표 마진 권장 판매가/);
  assert.match(marginCalculator, /계산 결과 저장/);
  assert.match(marginCalculator, /자동 등록 가능/);
  assert.equal((marginCalculator.match(/key: "/g) ?? []).length, 7);
  assert.match(mockData, /화면 검증용 임시 데이터/);
  assert.match(mockData, /레티놀 퍼밍 나이트 세럼/);
  assert.match(mockData, /Rina Kobayashi/);
  assert.match(mockData, /CS-2828/);
  assert.match(mockData, /콜드브루 콜라겐 젤리 14포/);
  assert.match(mockData, /제주 비자림 클렌징 밤/);
  assert.equal((mockData.match(/sales:/g) ?? []).length, 10);
  assert.match(layout, /og-commerce\.png/);
  assert.match(styles, /@media \(max-width: 1360px\)/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.match(operationsStyles, /SellerPilot Commerce Control · 2026-08-16/);
  assert.match(operationsStyles, /--primary: #e85d04/);
  assert.match(operationsStyles, /\.commerce-service-rail/);
  assert.match(styles, /\.ticket-list \{ display: block; max-height: 360px/);
  assert.match(styles, /\.publish-channel-list \{ grid-template-columns: 1fr/);
  assert.match(storyboard, /핵심 사용자 여정/);
  assert.match(storyboard, /단계별 구축 범위/);
  const acceptanceRaw = acceptanceData.slice(acceptanceData.indexOf("const rawSections"), acceptanceData.indexOf("// 화면·계산"));
  assert.equal((acceptanceRaw.match(/\["/g) ?? []).length, 175);
  assert.match(acceptanceData, /PostgreSQL 중앙DB와 접근차단/);
  assert.match(acceptanceData, /10,000건 동시주문 시뮬레이션/);
  assert.match(acceptancePage, /PPT 31장 기반 · 175개 인수 항목/);
  assert.match(acceptancePage, /화면 완성과 실제 작동을/);
  assert.match(readinessPage, /로그인됐다는 사실과/);
  assert.match(readinessPage, /QSM 개별 상품등록 필드 맵/);
  assert.match(readinessPage, /API E2E 통과/);
  assert.match(readinessData, /Get Live Push OFF/);
  assert.match(readinessData, /Access 30일 · Refresh 180일/);
  assert.match(readinessData, /대표 1장, 추가 최대 50장, 동영상 최대 1개/);
  assert.match(channelMapping, /Qoo10 QSM 실제 상품등록 필드/);
  assert.match(channelMapping, /Shopee Open Platform 준비도/);
  assert.match(channelMapping, /Lazada Open Platform 준비도/);
  const credentialPage = await readFile(new URL("../app/api-credential-center.tsx", import.meta.url), "utf8");
  const credentialMigration = await readFile(new URL("../db/supabase/0001_channel_credentials.sql", import.meta.url), "utf8");
  assert.match(credentialPage, /Supabase Vault/);
  assert.match(credentialPage, /키 수명 · 교체 일정/);
  assert.match(credentialPage, /연결 검사/);
  assert.match(credentialMigration, /sellerpilot_rotate_credential/);
  assert.match(credentialMigration, /vault\.create_secret/);
  assert.match(credentialMigration, /sellerpilot_list_credential_audit/);
  for (const protectedValue of ["137451", "137571", "k931103", "MY4NNISR2D", "SGYEZULX"]) {
    assert.doesNotMatch(`${readinessData}\n${channelMapping}`, new RegExp(protectedValue, "i"));
  }
  assert.match(packageJson, /lucide-react/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
