import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);
const stylesUrl = new URL("../app/product-publish-workbench.css", import.meta.url);

test("상품 수정은 중앙 저장과 채널별 원격 반영을 분리해서 안내한다", async () => {
  const source = await readFile(workbenchUrl, "utf8");

  assert.match(source, /중앙 저장 후 채널별로 따로 반영합니다/);
  assert.match(source, /상품 상세에서 저장한 등록정보를 중앙 원장에서 다시 불러온 상태입니다/);
  assert.match(source, /아래 값을 바꾸면 채널 payload 초안만 갱신됩니다\. 중앙 상품을 다시 저장하는 입력란이 아닙니다/);
  assert.match(source, /중앙 재저장 아님/);
  assert.match(source, /채널마다 별도 실행/);
  assert.match(source, /지원 항목만 별도 원격 반영/);
  assert.match(source, /aria-describedby=\{remoteUpdate \? `\$\{channel\}-remote-action-scope` : undefined\}/);
});

test("지원되지 않은 가격 옵션 판매 구성은 원격 성공처럼 표시하지 않는다", async () => {
  const source = await readFile(workbenchUrl, "utf8");

  assert.match(source, /가격·옵션·판매 구성은 정확한 원격 SKU·통화·옵션 식별값이 검증되기 전에는 성공으로 표시하거나 전송하지 않습니다/);
  assert.match(source, /remoteListingSupportedFieldLabels[\s\S]*?operation === "listing\.update"[\s\S]*?state === "supported"/);
  assert.match(source, /remoteListingPartialFieldLabels[\s\S]*?operation === "listing\.update"[\s\S]*?state === "partial"/);
  assert.match(source, /remoteManualFieldLabels[\s\S]*?state === "blocked"/);
  assert.match(source, /재고는 이 버튼과 별도:[\s\S]*?재고 동기화 지원/);
  assert.match(source, /아래 상품 콘텐츠 반영 버튼은 재고를 변경하지 않습니다/);
  assert.match(source, /remoteCommerceUpdate \? "상품·단일 SKU 지원 항목" : "상품 콘텐츠만"/);
  assert.match(source, /가격·재고·옵션·판매 구성은 이 버튼으로 변경하지 않습니다/);
  assert.match(source, /일부 지원 필드도 채널 정책 보존 범위를 확인해야 합니다/);
  assert.match(source, /완전 반영 성공으로 표시하지 않습니다/);
  assert.match(source, /원격 반영 차단 · 판매자센터 수동 수정/);
  assert.match(source, /disabled aria-describedby=\{`\$\{channel\}-remote-blocked-reason`\}/);
  assert.match(source, /가격·재고·옵션·판매 구성은 변경하지 않음/);
  assert.doesNotMatch(source, /가격·옵션·판매 구성 원격 (?:반영|수정) (?:완료|성공)/);
});

test("Lazada MY 기존 단일 SKU는 5,000 KRW 환율 금액을 명시하고 나머지 채널과 분리한다", async () => {
  const source = await readFile(workbenchUrl, "utf8");

  assert.match(source, /fetch\("\/api\/exchange-rates"/);
  assert.match(source, /sellerpilotLazadaPricePolicyRequired: true/);
  assert.match(source, /verified KRW to MYR price policy/);
  assert.match(source, /sourcePriceKrw\.toLocaleString\(\)\} KRW 상당 \$\{lazadaFinalPricePolicy\.targetPriceMyr\.toFixed\(2\)\} MYR/);
  assert.match(source, /검증된 단일 SKU의 가격·재고를 포함하고 옵션·판매 구성은 변경하지 않습니다/);
  assert.match(source, /현재 환율을 확인하지 못하면 쓰기 전에 차단합니다/);
});

test("모바일 전용 스타일은 설명 전문과 44px 원격 액션을 보존한다", async () => {
  const [styles, layout] = await Promise.all([
    readFile(stylesUrl, "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /import "\.\/product-publish-workbench\.css"/);
  assert.match(styles, /\.product-edit-support-reason\s*\{[\s\S]*?overflow:\s*visible !important/);
  assert.match(styles, /\.product-edit-support-reason\s*\{[\s\S]*?-webkit-line-clamp:\s*initial !important/);
  assert.match(styles, /\.product-edit-remote-action,[\s\S]*?\.product-edit-blocked-action\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.product-edit-inventory-scope\s*\{[\s\S]*?background:\s*#eef4fb/);
  assert.match(styles, /@media \(max-width: 440px\)[\s\S]*?\.product-edit-support-grid > \.remote-edit-support\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
});
