import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright-core";

const viewportWidths = [280, 320, 390];

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through explicit local browser candidates.
    }
  }
  return null;
}

function fixtureHtml(styles) {
  const components = ["상품가", "필수 옵션", "필수 배송비", "세금·관세", "확정 할인"]
    .map((label, index) => `<div><dt>${label}</dt><dd><b>${index === 2 ? "unknown" : "₩12,345"}</b><small>${index === 2 ? "0원으로 간주하지 않음" : "KRW 환산 ₩12,345"}</small></dd></div>`)
    .join("");
  const card = (index) => `<article class="competitor-observation-card exact" data-card>
    <header><span>IMG</span><div><small>아주 긴 판매처 provenance 이름 ${index}</small><b>아주 긴 동일상품 상품명과 모델번호 옵션 구성 ${index}</b><em>exact · 확정 · 99점</em></div><a href="#source-${index}" data-source-link aria-label="원본 링크">↗</a></header>
    <div class="competitor-total-price"><small>총구매가</small><strong>₩123,456</strong><em>원 통화 USD 90.12 · KRW 환산 ₩123,456</em></div>
    <dl class="competitor-price-components">${components}</dl>
    <div class="competitor-price-provenance"><span><b>원 통화·환율</b><small>USD 1 = KRW 1,370.123456 · 공식 환율 공급자 · 2026. 08. 31. 12:00</small></span><span><b>단위가격</b><small>USD 1.25 · KRW ₩1,713 / 100 ml</small></span></div>
    <div class="competitor-match-evidence"><b>동일상품 판정 근거</b><ul><li>manufacturerPartNumber · 기준 MODEL-VERY-LONG-123 / 관측 MODEL-VERY-LONG-123</li></ul></div>
    <footer><span>수집 2026. 08. 31. 12:00 · 재고 있음</span><em>최저가 포함 조건 충족</em></footer>
  </article>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{width:100%;max-width:100%;margin:0}body{padding:8px;font-family:Arial,sans-serif}.competitor-market-groups{width:100%}
    ${styles.replaceAll("</style", "<\\/style")}
  </style></head><body><main class="competitor-market-groups compact" data-root>
    <div class="competitor-lowest-summary"><span><small>조회 가능한 승인 공급자 범위의 동일상품 최저 총구매가</small><strong>₩123,456</strong><em>원 통화 USD 90.12 · exact · 재고 있음 · 최신 snapshot</em></span><small>전체 인터넷 최저가가 아님</small></div>
    <div class="competitor-retry"><span><span><b>자동 확인을 마쳤습니다.</b><small>현재 공란을 유지한 채 분석을 계속할 수 있습니다.</small></span></span><div class="competitor-retry-actions"><button>가격 다시 확인</button><button>가격 없이 계속</button></div></div>
    <div class="competitor-provider-summary"><span class="searched"><b>네이버 쇼핑 검색</b><em>조회 완료 · 후보 3건</em><small>마지막 조회 2026. 08. 31. 12:00</small></span><span class="failed"><b>11번가 상품검색</b><em>응답 실패</em><small>마지막 조회 2026. 08. 31. 12:00</small></span></div>
    <section><header><b>스마트스토어</b><small>exact 3개</small></header><div class="competitor-price-grid" data-grid>${card(1)}${card(2)}${card(3)}</div></section>
    <div class="competitor-price-follow excluded"><span><b>가격 추종 제외</b><small>경쟁 총구매가가 검증된 목표마진 제안가보다 낮아 추종하지 않습니다.</small></span><em>운영 판매가 변경은 사람 승인·채널 readback 후</em></div>
  </main></body></html>`;
}

test("competitor price cards and source links stay within 280, 320, and 390px", { timeout: 90_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "competitor price mobile geometry test requires Chrome");

  const styles = (await Promise.all([
    readFile(new URL("../app/commerce-ux-refactor.css", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
  ])).join("\n");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"],
  });

  try {
    for (const width of viewportWidths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await page.setContent(fixtureHtml(styles), { waitUntil: "load" });
      const geometry = await page.evaluate(() => {
        const grid = document.querySelector("[data-grid]");
        const cards = [...document.querySelectorAll("[data-card]")];
        const links = [...document.querySelectorAll("[data-source-link]")];
        const evidence = document.querySelector(".competitor-match-evidence li");
        const provider = document.querySelector(".competitor-provider-summary em");
        if (!(grid instanceof HTMLElement) || cards.length !== 3 || links.length !== 3 || !(evidence instanceof HTMLElement) || !(provider instanceof HTMLElement)) throw new Error("competitor fixture is incomplete");
        const bounds = (element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height };
        };
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          gridAutoFlow: getComputedStyle(grid).gridAutoFlow,
          cardBounds: cards.map(bounds),
          linkBounds: links.map(bounds),
          evidenceFontSize: Number.parseFloat(getComputedStyle(evidence).fontSize),
          providerFontSize: Number.parseFloat(getComputedStyle(provider).fontSize),
        };
      });
      assert.ok(geometry.documentWidth <= geometry.viewportWidth, `${width}px document overflowed: ${geometry.documentWidth}px`);
      assert.equal(geometry.gridAutoFlow, "row", `${width}px must use a vertical card flow`);
      for (const box of [...geometry.cardBounds, ...geometry.linkBounds]) {
        assert.ok(box.left >= -0.5, `${width}px element crossed the left viewport edge`);
        assert.ok(box.right <= width + 0.5, `${width}px element crossed the right viewport edge`);
        assert.ok(box.width > 0 && box.height > 0, `${width}px element lost measurable geometry`);
      }
      assert.ok(geometry.cardBounds[1].top > geometry.cardBounds[0].top, `${width}px cards did not stack to one column`);
      assert.ok(geometry.cardBounds[2].top > geometry.cardBounds[1].top, `${width}px third card did not stack`);
      assert.ok(geometry.evidenceFontSize >= 9, `${width}px evidence text is too small`);
      assert.ok(geometry.providerFontSize >= 9, `${width}px provider status text is too small`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
