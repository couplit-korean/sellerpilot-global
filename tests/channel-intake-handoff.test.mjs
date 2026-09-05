import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, css, publishWorkbench, categoryWorkbench] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/commerce-ux-refactor.css", import.meta.url), "utf8"),
  readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/category-classification-workbench.tsx", import.meta.url), "utf8"),
]);

test("Step 1 labels credentials separately from actual upload readiness", () => {
  assert.match(page, /운영 키 등록과 실제 업로드 가능은 다릅니다/);
  assert.match(page, /운영 키 등록 · 3단계 검증 필요/);
  assert.doesNotMatch(page, /공식 API 등록 가능/);
});

test("Step 1 exposes a channel-specific handoff for every active marketplace", () => {
  for (const channel of ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]) {
    assert.match(page, new RegExp(`\\n  ${channel}: "`));
  }
  assert.match(page, /aria-label="선택 채널별 후속 필수 확인"/);
  assert.match(page, /selectedChannels\.map\(\(key\) =>/);
  assert.match(css, /\.channel-rule-handoff \{/);
  assert.match(css, /grid-template-columns: minmax\(38px, max-content\) minmax\(0, 1fr\) auto/);
});

test("Step 1 progress includes conditional GTIN, condition, and currency checks", () => {
  assert.match(page, /productConditions\.includes\(intake\.condition\)/);
  assert.match(page, /intake\.gtinStatus === "HAS_GTIN" && \/\^\\d\{8,14\}\$\//);
  assert.match(page, /intake\.gtinStatus === "NO_GTIN" && intake\.gtin\.trim\(\) === ""/);
  assert.match(page, /productCurrencies\.includes\(intake\.currency\)/);
});

test("publish workbench never paints invented fallback commerce facts", () => {
  assert.doesNotMatch(publishWorkbench, /useState\(2500\)/);
  assert.doesNotMatch(publishWorkbench, /useState\(12\.9\)/);
  assert.doesNotMatch(publishWorkbench, /weight: 0\.35, length: 12, width: 12, height: 10/);
  assert.match(publishWorkbench, /useState<PackageFields>\(\{ weight: 0, length: 0, width: 0, height: 0 \}\)/);
});

test("restored 11st food state receives new required notices and cannot remain falsely confirmed", () => {
  assert.match(categoryWorkbench, /appendChannelRequiredAttributes\(channel, state\.selected\.id, restoredAttributes\)/);
  assert.match(categoryWorkbench, /restoredPhase === "confirmed"/);
  assert.match(categoryWorkbench, /attributes\.some\(\(attribute\) => attribute\.required && !restoredValues\[attribute\.id\]\?\.trim\(\)\)/);
});
