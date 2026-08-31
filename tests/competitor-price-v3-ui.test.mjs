import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiUrl = new URL("../app/_publishing/competitor-price-v3-ui.tsx", import.meta.url);

test("competitor v3 UI keeps exact pricing, review tiers, provenance, and nonblocking copy distinct", async () => {
  const [ui, page, mobileStyles] = await Promise.all([
    readFile(uiUrl, "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
  ]);

  assert.match(ui, /lowestEligibleCompetitorPrice\(v3Items\)/);
  assert.match(ui, /조회 가능한 승인 공급자 범위의 동일상품 최저 총구매가/);
  assert.match(ui, /전체 인터넷 최저가가 아님/);
  assert.match(ui, /확정 동일상품 없음/);
  assert.match(ui, /probable · 사람 검토 후보/);
  assert.match(ui, /rejected · \{Math\.round\(item\.matchScore\)\}점 · 가격 계산 제외/);
  const rejectedBlock = ui.slice(ui.indexOf("rejectedItems.length > 0"), ui.indexOf("legacyItems.length > 0"));
  assert.doesNotMatch(rejectedBlock, /formatMoney\(item\.price/);
  assert.match(ui, /\["itemPrice", "상품가"\]/);
  assert.match(ui, /\["requiredOptionSurcharge", "필수 옵션"\]/);
  assert.match(ui, /\["shipping", "필수 배송비"\]/);
  assert.match(ui, /\["taxAndDuty", "세금·관세"\]/);
  assert.match(ui, /0원으로 간주하지 않음/);
  assert.match(ui, /원 통화·환율/);
  assert.match(ui, /단위가격/);
  assert.match(ui, /동일상품 판정 근거/);
  assert.match(ui, /원본 링크/);
  assert.match(ui, /조회 완료 · 후보 \$\{provider\.count\}건/);
  assert.match(ui, /provider\.status === "pending" \? "조회 진행 중"/);
  assert.match(ui, /provider\.status === "failed" \? "응답 실패" : "미연결"/);
  assert.doesNotMatch(ui, /provider\.status !== "searched"[^\n]*0건/);
  assert.match(ui, /수동·기존 matcher 기준가격/);
  assert.match(ui, /가격 추종 제외/);
  assert.match(ui, /검증된 목표마진 제안가/);
  assert.match(ui, /운영 판매가 변경은 사람 승인·채널 readback 후/);
  assert.doesNotMatch(ui, /가격 (?:적용|변경) 버튼|onApplyPrice|applyCompetitorPrice/);
  assert.match(ui, /상세페이지 제작과 상품 등록을 차단하지 않습니다/);

  const authoring = page.slice(page.indexOf("const startAutomation = () =>"), page.indexOf("const totalPhotoCount ="));
  assert.doesNotMatch(authoring, /competitorResearchBlocksAnalysis/);
  assert.match(page, /\.filter\(isEligibleCompetitorObservation\)/);
  assert.match(page, /lastCheckedAt=\{competitorFetchedAt\}/);
  assert.match(mobileStyles, /@media \(max-width: 390px\)[\s\S]*?\.competitor-market-groups \.competitor-price-grid,[\s\S]*?grid-auto-flow: row;[\s\S]*?overflow-x: visible/);
});

test("admin competitor lookup forwards structured identity and returns real snapshot time with partial status", async () => {
  const [route, polling] = await Promise.all([
    readFile(new URL("../app/api/admin/competitor-prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_publishing/competitor-research-polling.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /productName: z\.string/);
  assert.match(route, /gtin: z\.string/);
  assert.match(route, /identity \? \{ identity \} : undefined/);
  assert.match(route, /const fetchedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(route, /status: partial \? 207 : 200/);
  assert.match(route, /verifiedSameProduct: "matchTier" in item && item\.matchTier === "exact"/);
  assert.match(polling, /typeof payload!\.fetchedAt === "string" \? payload!\.fetchedAt : latest\.fetchedAt/);
  assert.doesNotMatch(polling, /fetchedAt:\s*(?:Date\.now|new Date)/);
});
