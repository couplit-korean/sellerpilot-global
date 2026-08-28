import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright-core";

const cssUrls = [
  new URL("../app/globals.css", import.meta.url),
  new URL("../app/operations-system.css", import.meta.url),
  new URL("../app/commerce-ux-refactor.css", import.meta.url),
  new URL("../app/style-learning-center.css", import.meta.url),
  new URL("../app/mobile-optimization.css", import.meta.url),
  new URL("../app/interaction-layers.css", import.meta.url),
];

const viewportWidths = [280, 320, 344, 390, 412];

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the explicit release-QA browser candidates.
    }
  }
  return null;
}

function optionCard(index) {
  const label = ["정면", "후면", "좌측면", "우측면", "상단", "하단", "라벨", "구성품"][index];
  return `<div class="option-slot-wrap" data-card="${index}">
    <input class="visually-hidden" id="photo-${index}-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment">
    <label class="option-photo-slot" for="photo-${index}">
      <input class="visually-hidden" id="photo-${index}" type="file" accept="image/jpeg,image/png,image/webp">
      <span aria-hidden="true">+</span><b>${label}</b><small>상품 ${label} 안내</small>
    </label>
    <div class="photo-source-actions compact" aria-label="${label} 사진 입력 방식">
      <label for="photo-${index}-camera" data-action="${index}-camera"><span><b>촬영</b></span></label>
      <label for="photo-${index}" data-action="${index}-album"><span><b>앨범</b></span></label>
    </div>
  </div>`;
}

function fixtureHtml(styles) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles.replaceAll("</style", "<\\/style")}</style></head>
  <body><main class="app-content"><section class="panel upload-panel"><section class="option-photo-section"><div class="option-photo-grid">${Array.from({ length: 8 }, (_, index) => optionCard(index)).join("")}</div></section></section></main>
  <div class="toast"><div class="toast-copy"><span>등록 상태를 확인했습니다.</span></div></div>
  <div class="mobile-push-chip"><span>주문 배송 알림 사용 중</span></div>
  <nav class="mobile-bottom-nav"><button>대시보드</button><button>상품</button><button class="active">등록</button><button>주문</button><button>CS</button></nav>
  </body></html>`;
}

function interactionFixtureHtml(styles) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles.replaceAll("</style", "<\\/style")}</style></head>
  <body><main class="app-content">
    <section class="style-learning-table-wrap panel" data-table-wrap>
      <table class="style-learning-table"><thead><tr><th>번호</th><th>학습 상품</th><th>채널 · 국가</th><th>언어</th><th>현지어 검색 문구</th><th>검증</th></tr></thead>
      <tbody><tr><td>001</td><td>긴 학습 상품 이름</td><td>Marketplace · Country</td><td>한국어</td><td>localized same product search query</td><td><a href="#result" data-search-link>검색</a></td></tr></tbody></table>
    </section>
    <div style="height: 900px" aria-hidden="true"></div>
    <button type="button" data-last-action style="display:block;width:100%;min-height:44px">마지막 작업 계속</button>
  </main>
  <nav class="mobile-bottom-nav"><button>대시보드</button><button>상품</button><button class="active">등록</button><button>주문</button><button>CS</button></nav>
  </body></html>`;
}

test("Fold widths keep every camera and album action in flow and touchable", { timeout: 60_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "UI geometry release test requires Chrome; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or CHROME_PATH");

  const styles = (await Promise.all(cssUrls.map((url) => readFile(url, "utf8")))).join("\n");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"],
  });

  try {
    for (const width of viewportWidths) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.setContent(fixtureHtml(styles), { waitUntil: "load" });

      const geometry = await page.locator(".option-slot-wrap").evaluateAll((cards) => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        cards: cards.map((card) => {
          const photo = card.querySelector(".option-photo-slot");
          const actions = card.querySelector(".photo-source-actions.compact");
          if (!(photo instanceof HTMLElement) || !(actions instanceof HTMLElement)) throw new Error("fixture is missing a photo or action row");
          const cardBox = card.getBoundingClientRect();
          const photoBox = photo.getBoundingClientRect();
          const actionBox = actions.getBoundingClientRect();
          const targets = [...actions.querySelectorAll("label")].map((target) => {
            const targetBox = target.getBoundingClientRect();
            return { width: targetBox.width, height: targetBox.height };
          });
          return {
            cardTop: cardBox.top,
            cardBottom: cardBox.bottom,
            photoBottom: photoBox.bottom,
            actionTop: actionBox.top,
            actionBottom: actionBox.bottom,
            targets,
          };
        }),
      }));

      assert.equal(geometry.viewportWidth, width, `${width}px release fixture must use the exact CSS viewport`);
      assert.ok(geometry.documentWidth <= width, `${width}px registration fixture must not create horizontal overflow`);
      for (const [index, card] of geometry.cards.entries()) {
        assert.ok(card.actionTop >= card.photoBottom - 0.5, `${width}px card ${index + 1}: action row overlaps the photo row`);
        assert.ok(card.cardBottom >= card.actionBottom - 0.5, `${width}px card ${index + 1}: wrapper does not include its action row`);
        if (index < geometry.cards.length - 2) {
          assert.ok(geometry.cards[index + 2].cardTop >= card.actionBottom - 0.5, `${width}px card ${index + 1}: the next grid row covers its actions`);
        }
        for (const [targetIndex, target] of card.targets.entries()) {
          assert.ok(target.width > 0 && target.height >= 44, `${width}px card ${index + 1} action ${targetIndex + 1}: touch target is smaller than 44px`);
        }
      }

      for (const actionId of Array.from({ length: 8 }, (_, index) => [`${index}-camera`, `${index}-album`]).flat()) {
        const action = page.locator(`[data-action="${actionId}"]`);
        await action.evaluate((element) => {
          const box = element.getBoundingClientRect();
          window.scrollTo({
            top: window.scrollY + box.top - (window.innerHeight - box.height) / 2,
            behavior: "instant",
          });
        });
        await page.waitForTimeout(20);
        const probe = await action.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            hit: target instanceof Element ? target.closest("[data-action]")?.getAttribute("data-action") ?? null : null,
            target: target instanceof Element ? `${target.tagName}.${target.className}` : null,
            box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
            scrollY: window.scrollY,
            viewportHeight: window.innerHeight,
            documentHeight: document.documentElement.scrollHeight,
          };
        });
        assert.equal(probe.hit, actionId, `${width}px ${actionId}: center touch is intercepted by another card or overlay (${JSON.stringify(probe)})`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("Fold widths preserve scrollable learning data and keep transient layers off actions", { timeout: 60_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "UI geometry release test requires Chrome; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or CHROME_PATH");

  const styles = (await Promise.all(cssUrls.map((url) => readFile(url, "utf8")))).join("\n");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"],
  });

  try {
    for (const width of viewportWidths) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.setContent(interactionFixtureHtml(styles), { waitUntil: "load" });

      const learningGeometry = await page.evaluate(() => {
        const wrap = document.querySelector("[data-table-wrap]");
        const table = document.querySelector(".style-learning-table");
        const link = document.querySelector("[data-search-link]");
        if (!(wrap instanceof HTMLElement) || !(table instanceof HTMLElement) || !(link instanceof HTMLElement)) throw new Error("learning fixture is incomplete");
        const linkBox = link.getBoundingClientRect();
        wrap.scrollLeft = 100;
        return {
          documentWidth: document.documentElement.scrollWidth,
          wrapClientWidth: wrap.clientWidth,
          wrapScrollWidth: wrap.scrollWidth,
          tableWidth: table.getBoundingClientRect().width,
          linkWidth: linkBox.width,
          linkHeight: linkBox.height,
          scrollLeft: wrap.scrollLeft,
        };
      });
      assert.ok(learningGeometry.documentWidth <= width, `${width}px learning ledger must not widen the document`);
      assert.ok(learningGeometry.wrapClientWidth <= width, `${width}px learning ledger must fit the viewport`);
      assert.ok(learningGeometry.wrapScrollWidth >= 900, `${width}px learning ledger must retain its 900px data width`);
      assert.ok(learningGeometry.tableWidth >= 900, `${width}px learning table columns must not collapse`);
      assert.ok(learningGeometry.scrollLeft > 0, `${width}px learning ledger must scroll horizontally`);
      assert.ok(learningGeometry.linkWidth >= 44 && learningGeometry.linkHeight >= 44, `${width}px learning search action must be at least 44px`);

      await page.evaluate(() => {
        const popover = document.createElement("div");
        popover.className = "notification-popover";
        popover.innerHTML = `<div><h4>실시간 알림 <small>1</small></h4><span><button>전체 닫기</button><button>닫기</button></span></div><div class="notification-item"><button class="notification-item-open"><span class="alert-icon">!</span><span><b>등록 완료</b><small>상세 상태를 확인하세요.</small></span></button><button class="notification-item-dismiss">×</button></div>`;
        document.body.append(popover);
      });
      const notificationGeometry = await page.evaluate(() => {
        const row = document.querySelector(".notification-item");
        const open = document.querySelector(".notification-item-open");
        const dismiss = document.querySelector(".notification-item-dismiss");
        if (!(row instanceof HTMLElement) || !(open instanceof HTMLElement) || !(dismiss instanceof HTMLElement)) throw new Error("notification fixture is incomplete");
        const rowBox = row.getBoundingClientRect();
        const openBox = open.getBoundingClientRect();
        const dismissBox = dismiss.getBoundingClientRect();
        return { rowHeight: rowBox.height, openHeight: openBox.height, dismissWidth: dismissBox.width, dismissHeight: dismissBox.height };
      });
      assert.ok(notificationGeometry.openHeight >= 44, `${width}px notification open action must be at least 44px tall`);
      assert.ok(notificationGeometry.openHeight >= notificationGeometry.rowHeight - 1.5, `${width}px notification open action must fill its row except the divider (${JSON.stringify(notificationGeometry)})`);
      assert.ok(notificationGeometry.dismissWidth >= 44 && notificationGeometry.dismissHeight >= 44, `${width}px notification dismiss action must be at least 44px`);

      const paddingWithoutToast = await page.locator(".app-content").evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
      await page.evaluate(() => {
        document.querySelector(".notification-popover")?.remove();
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.innerHTML = `<div class="toast-copy"><b>상품 상태 변경</b><span>마지막 작업 버튼을 가리지 않아야 합니다.</span></div>`;
        document.body.append(toast);
      });
      const paddingWithToast = await page.locator(".app-content").evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
      assert.ok(paddingWithToast >= paddingWithoutToast + 90, `${width}px toast must reserve a temporary content lane`);

      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await page.waitForTimeout(20);
      const finalActionGeometry = await page.evaluate(() => {
        const action = document.querySelector("[data-last-action]");
        const toast = document.querySelector(".toast");
        if (!(action instanceof HTMLElement) || !(toast instanceof HTMLElement)) throw new Error("toast fixture is incomplete");
        const actionBox = action.getBoundingClientRect();
        const toastBox = toast.getBoundingClientRect();
        const hit = document.elementFromPoint(actionBox.left + actionBox.width / 2, actionBox.top + actionBox.height / 2);
        return {
          actionBottom: actionBox.bottom,
          toastTop: toastBox.top,
          hitLastAction: hit instanceof Element && Boolean(hit.closest("[data-last-action]")),
        };
      });
      assert.ok(finalActionGeometry.actionBottom <= finalActionGeometry.toastTop + 0.5, `${width}px toast must not cover the last page action`);
      assert.equal(finalActionGeometry.hitLastAction, true, `${width}px last action must remain touchable while the toast is visible`);

      await page.locator(".toast").evaluate((element) => element.remove());
      const paddingAfterToast = await page.locator(".app-content").evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
      assert.ok(Math.abs(paddingAfterToast - paddingWithoutToast) <= 0.5, `${width}px toast lane must be released after dismissal`);

      await context.close();
    }
  } finally {
    await browser.close();
  }
});
