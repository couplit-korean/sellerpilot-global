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
  assert.match(html, /상품부터 주문·문의까지/);
  assert.match(html, /SellerPilot 하나로/);
  assert.match(html, /SellerPilot 계정으로 시작하세요/);
  assert.match(html, /판매 채널 연결 정보는 암호화/);
  assert.match(html, /자동으로 최신 상태 유지/);
  assert.doesNotMatch(html, /demo@sellerpilot\.kr|seller2026|admin@company\.com|₩4,820,400|오늘의 운영 브리핑/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("contains the complete multi-channel operating storyboard and 175-item acceptance baseline", async () => {
  const [page, layout, styles, operationsStyles, packageJson, storyboard, channelConfig, acceptanceData, acceptancePage, exchangeRoute, readinessData, readinessPage, channelMapping] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-system.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/멀티채널_커머스_운영센터_스토리보드.md", import.meta.url), "utf8"),
    readFile(new URL("../app/channel-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/acceptance-checklist-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/acceptance-checklist.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/exchange-rates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/channel-readiness-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/channel-readiness.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/판매채널_실계정_UI_필드_매핑.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /오늘 할 일을 한눈에/);
  assert.match(page, /이번 달 판매 TOP 10/);
  assert.match(page, /기준 환율/);
  assert.match(page, /환율 새로고침/);
  assert.match(page, /3_600_000/);
  assert.doesNotMatch(page, /Math\.random/);
  assert.match(exchangeRoute, /api\.frankfurter\.dev\/v2\/rates/);
  assert.match(exchangeRoute, /daily-reference/);
  assert.match(page, /label: "상품"/);
  assert.match(page, /label: "상품 등록"/);
  assert.match(page, /label: "수익 계산"/);
  assert.match(page, /label: "주문"/);
  assert.match(page, /label: "고객 문의"/);
  assert.match(page, /Qoo10 Japan/);
  assert.match(page, /Shopee Global/);
  assert.match(page, /Lazada Malaysia/);
  assert.match(page, /쿠팡/);
  assert.match(page, /Temu/);
  assert.match(page, /네이버 스마트스토어/);
  assert.match(page, /eBay Global/);
  assert.doesNotMatch(page, /서비스 스토리보드/);
  assert.doesNotMatch(page, /개발 · 실검수/);
  assert.match(page, /dynamic\(\(\) => import\("\.\/api-credential-center"\)/);
  assert.match(page, /dynamic\(\(\) => import\("\.\/product-publish-workbench"\)/);
  assert.match(page, /label: "연결 상태"/);
  assert.match(page, /label: "채널 연결"/);
  assert.match(page, /commerce-service-rail/);
  assert.match(page, /통합 판매관리/);
  assert.match(page, /signInWithPassword/);
  assert.match(page, /Qoo10 Japan/);
  assert.match(page, /Shopee Global/);
  assert.match(page, /7개 판매 채널/);
  assert.match(page, /AI 답변을 준비합니다/);
  assert.match(page, /판매 카테고리/);
  assert.match(page, /대표사진 1장이 반드시 필요/);
  assert.match(page, /URL로 불러오기/);
  assert.match(page, /id: "front"/);
  assert.match(page, /id: "barcode"/);
  assert.match(page, /option-photo-\$\{slot\.id\}/);
  assert.match(page, /id="extra-product-photos"[^>]*multiple/);
  assert.match(page, /상품 사실 설명/);
  assert.match(page, /자료 출처·상품 링크/);
  assert.match(page, /1개 바로 분석/);
  assert.doesNotMatch(page, /DEMO_DATA_META|createDemoStudioResult|seed_demo/);
  assert.match(page, /MarginCalculatorPage/);
  assert.match(styles, /\.margin-workspace/);
  const marginCalculator = await readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8");
  assert.match(marginCalculator, /7 CHANNEL COMPARISON/);
  assert.match(marginCalculator, /손익분기 판매가/);
  assert.match(marginCalculator, /목표 마진 권장 판매가/);
  assert.match(marginCalculator, /계산 결과 저장/);
  assert.match(marginCalculator, /자동 등록 가능/);
  assert.equal((marginCalculator.match(/key: "/g) ?? []).length, 7);
  assert.match(channelConfig, /Shopee Global/);
  assert.match(channelConfig, /Alibaba\.com/);
  assert.match(channelConfig, /1688\.com/);
  assert.doesNotMatch(channelConfig, /sales:|revenue:|customer:|샘플/);
  assert.match(layout, /og-commerce\.png/);
  assert.match(layout, /customer-experience\.css/);
  const customerStyles = await readFile(new URL("../app/customer-experience.css", import.meta.url), "utf8");
  assert.match(customerStyles, /\.mobile-bottom-nav/);
  assert.match(customerStyles, /env\(safe-area-inset-bottom\)/);
  assert.match(customerStyles, /font-size: 16px !important/);
  assert.match(customerStyles, /@media \(max-width: 420px\)/);
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
  assert.match(readinessPage, /판매 채널이 잘 연결되어 있는지/);
  assert.match(readinessPage, /연결 정보 안전 보호/);
  assert.match(readinessPage, /다음 단계/);
  assert.doesNotMatch(readinessPage, /QSM 개별 상품등록 필드 맵|API E2E 통과/);
  assert.match(readinessData, /Shopee Open Platform/);
  assert.match(readinessData, /Access 4시간 · Refresh 30일/);
  assert.match(readinessData, /Test·Live 모두 https:\/\/sellerpilot-global\.vercel\.app 반영/);
  assert.match(readinessData, /AppWhiteIpLimit/);
  assert.match(readinessData, /Access 30일 · Refresh 180일/);
  assert.match(readinessData, /대표 1장, 추가 최대 50장, 동영상 최대 1개/);
  assert.match(channelMapping, /Qoo10 QSM 실제 상품등록 필드/);
  assert.match(channelMapping, /Shopee Open Platform 준비도/);
  assert.match(channelMapping, /Lazada Open Platform/);
  const credentialPage = await readFile(new URL("../app/api-credential-center.tsx", import.meta.url), "utf8");
  const credentialTestRoute = await readFile(new URL("../app/api/admin/channel-credentials/test/route.ts", import.meta.url), "utf8");
  const gatewayCompleteRoute = await readFile(new URL("../app/api/channel-gateway/worker/complete/route.ts", import.meta.url), "utf8");
  const cliRuntimeCard = await readFile(new URL("../app/ai-cli-runtime-card.tsx", import.meta.url), "utf8");
  const cliWorker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const categoryWorkbench = await readFile(new URL("../app/category-classification-workbench.tsx", import.meta.url), "utf8");
  const publishWorkbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
  const cliMigration = await readFile(new URL("../supabase/migrations/20260816065848_sellerpilot_ai_cli_jobs.sql", import.meta.url), "utf8");
  const credentialMigration = await readFile(new URL("../supabase/migrations/20260816060000_channel_credentials_and_roles.sql", import.meta.url), "utf8");
  const operationsMigration = await readFile(new URL("../supabase/migrations/20260816104732_operations_core.sql", import.meta.url), "utf8");
  const operationsRoute = await readFile(new URL("../app/api/operations/snapshot/route.ts", import.meta.url), "utf8");
  const cliControlsMigration = await readFile(new URL("../supabase/migrations/20260816103854_ai_operations_controls.sql", import.meta.url), "utf8");
  assert.match(credentialPage, /연결 정보 안전 보호/);
  assert.match(cliRuntimeCard, /로컬 Codex AI 작업자/);
  assert.match(cliRuntimeCard, /npm run ai:worker:install/);
  assert.match(cliWorker, /codex-image/);
  assert.match(cliWorker, /--enable", "image_generation/);
  assert.match(cliWorker, /codexEnv\.PATH = \[codexDirectory/);
  assert.match(cliWorker, /mcp_servers\.lovable\.enabled=false/);
  assert.match(cliWorker, /buildFallbackStudioResult/);
  assert.match(cliWorker, /createFallbackAsset/);
  assert.match(cliWorker, /이미지 안전 모드/);
  assert.doesNotMatch(cliWorker, /import sharp from "sharp"/);
  assert.match(cliWorker, /await import\("sharp"\)/);
  assert.match(cliWorker, /fallbackEnglishProductLabel/);
  assert.match(cliWorker, /formulation: "Stick"/);
  assert.match(cliWorker, /categoryId === 101642/);
  assert.match(cliWorker, /\[100782, 100797, 100824\]\.includes\(categoryId\)/);
  assert.match(categoryWorkbench, /row\.status === "active" && row\.environment === "production"/);
  assert.match(publishWorkbench, /existingListing\?\.status === "failed" \? crypto\.randomUUID\(\)/);
  assert.doesNotMatch(packageJson, /local-analyzer-server|run-local-demo/);
  assert.match(cliMigration, /sellerpilot_claim_ai_job/);
  assert.match(cliMigration, /sellerpilot-ai/);
  assert.match(cliControlsMigration, /sellerpilot_retry_ai_job/);
  assert.match(cliControlsMigration, /sellerpilot_prune_ai_jobs/);
  assert.match(operationsMigration, /sellerpilot_get_operations_snapshot/);
  assert.match(operationsMigration, /sellerpilot_seed_demo_operations/);
  assert.match(operationsRoute, /margin_save/);
  assert.match(operationsRoute, /ticket_update/);
  assert.doesNotMatch(credentialPage, /Project API Key|OpenAI API/);
  assert.match(credentialPage, /연결 갱신 일정/);
  assert.match(credentialPage, /연결 확인/);
  assert.match(credentialTestRoute, /parsed\.data\.channel === "shopee"/);
  assert.match(credentialTestRoute, /parsed\.data\.channel === "lazada"/);
  assert.match(gatewayCompleteRoute, /refreshedCredentialId/);
  assert.match(gatewayCompleteRoute, /sellerpilot_record_credential_test/);
  assert.match(credentialPage, /공식 연결 안내/);
  assert.doesNotMatch(credentialPage, /API 실행 검수|중복 방지 키|operation-console|confirmWrite/);
  assert.match(credentialMigration, /sellerpilot_rotate_credential/);
  assert.match(credentialMigration, /vault\.create_secret/);
  assert.match(credentialMigration, /sellerpilot_list_credential_audit/);
  assert.match(credentialMigration, /sellerpilot_get_active_credential_secret/);
  const lazadaAuthorizeRoute = await readFile(new URL("../app/api/admin/channel-credentials/lazada/authorize/route.ts", import.meta.url), "utf8");
  const maintenanceRoute = await readFile(new URL("../app/api/internal/maintenance/route.ts", import.meta.url), "utf8");
  const refreshMigration = await readFile(new URL("../supabase/migrations/20260816110000_lazada_token_refresh.sql", import.meta.url), "utf8");
  const connectorMigration = await readFile(new URL("../supabase/migrations/20260816120321_expand_channel_connectors.sql", import.meta.url), "utf8");
  const shopeeMigration = await readFile(new URL("../supabase/migrations/20260816133601_add_shopee_connector.sql", import.meta.url), "utf8");
  const channelCatalog = await readFile(new URL("../lib/channels/catalog.ts", import.meta.url), "utf8");
  const channelProtocols = await readFile(new URL("../lib/channels/protocols.ts", import.meta.url), "utf8");
  const channelOperations = await readFile(new URL("../lib/channels/operations.ts", import.meta.url), "utf8");
  assert.match(channelOperations, /approvalWasAlreadySubmitted && initialReadback\.providerAndIdentityOk/);
  const channelOperationsRoute = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const channelOperationsContract = await readFile(new URL("../docs/판매채널_실행_API_계약.md", import.meta.url), "utf8");
  const channelTargetClient = await readFile(new URL("../app/channel-target-client.ts", import.meta.url), "utf8");
  const ebayAuthorizeRoute = await readFile(new URL("../app/api/admin/channel-credentials/ebay/authorize/route.ts", import.meta.url), "utf8");
  assert.match(lazadaAuthorizeRoute, /sellerpilot_lazada_oauth/);
  assert.match(lazadaAuthorizeRoute, /timingSafeEqual/);
  assert.match(lazadaAuthorizeRoute, /response\.cookies\.set/);
  assert.match(lazadaAuthorizeRoute, /p_environment: credentialEnvironment/);
  assert.match(maintenanceRoute, /sellerpilot_service_refresh_lazada/);
  assert.match(refreshMigration, /token_refreshed/);
  assert.match(connectorMigration, /coupang.*elevenst.*smartstore.*ebay/);
  assert.match(connectorMigration, /sellerpilot_service_refresh_ebay/);
  assert.match(shopeeMigration, /sellerpilot_service_refresh_shopee/);
  assert.match(shopeeMigration, /'qoo10', 'shopee', 'lazada'/);
  assert.equal((channelCatalog.match(/key: "(?:qoo10|shopee|lazada|coupang|smartstore|ebay|temu)"/g) ?? []).length, 7);
  assert.match(channelCatalog, /temu\.local\.goods\.v3\.add/);
  assert.match(channelProtocols, /CEA algorithm=HmacSHA256/);
  assert.match(channelProtocols, /client_secret_sign/);
  assert.match(channelProtocols, /ebayjapan\.qapi/);
  assert.match(channelProtocols, /buildShopeeSignature/);
  assert.match(channelProtocols, /ensureShopeeAccessToken/);
  assert.match(channelOperations, /executeChannelOperation/);
  assert.match(channelOperations, /\/product\/price_quantity\/update/);
  assert.match(channelOperations, /\/v2\/products\/origin-products/);
  assert.match(channelOperations, /shipping_fulfillment/);
  assert.match(channelOperationsRoute, /confirmWrite/);
  assert.match(channelOperationsRoute, /idempotencyKey/);
  assert.match(channelOperationsRoute, /sellerpilot_claim_channel_operation/);
  assert.match(channelOperationsRoute, /ensureEbayAccessToken/);
  assert.match(channelTargetClient, /cached\.status === 401/);
  assert.match(channelTargetClient, /request\("POST"\)/);
  assert.match(channelTargetClient, /pendingTargetRequests/);
  assert.match(connectorMigration, /channel_operation_attempts/);
  assert.match(connectorMigration, /sellerpilot_claim_channel_operation/);
  assert.match(connectorMigration, /sellerpilot_service_complete_channel_operation/);
  assert.match(channelOperationsContract, /`POST \/api\/admin\/channel-operations`/);
  assert.match(ebayAuthorizeRoute, /sellerpilot_ebay_oauth/);
  const shopeeAuthorizeRoute = await readFile(new URL("../app/api/admin/channel-credentials/shopee/authorize/route.ts", import.meta.url), "utf8");
  assert.match(shopeeAuthorizeRoute, /sellerpilot_shopee_oauth/);
  assert.match(shopeeAuthorizeRoute, /timingSafeEqual/);
  for (const protectedPattern of [/authorization[_ ]?code\s*[:=]/i, /access[_ ]?token\s*[:=]/i, /app[_ ]?secret\s*[:=]/i, /partner[_ ]?key\s*[:=]/i]) {
    assert.doesNotMatch(`${readinessData}\n${channelMapping}`, protectedPattern);
  }
  assert.match(packageJson, /lucide-react/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
