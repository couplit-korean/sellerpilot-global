import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright-core";

const viewportWidths = [280, 390];

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through explicit release-QA browser candidates.
    }
  }
  return null;
}

function fixtureHtml(styles) {
  const supportFields = ["상품명", "설명", "옵션", "판매 구성", "필수정보", "이미지", "가격", "재고"]
    .map((label, index) => `<span class="${index < 3 ? "supported" : index === 3 ? "partial" : "blocked"}"><b>${label}</b><small>${index < 3 ? "원격 수정" : index === 3 ? "원격 일부" : "중앙만"}</small><small class="remote-edit-support-reason product-edit-support-reason">정확한 원격 SKU와 readback이 확인되지 않아 이 값은 자동 전송하지 않고 판매자센터에서 수동 반영해야 합니다.</small></span>`)
    .join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{width:100%;max-width:100%;margin:0;overflow-x:clip;font-family:Arial,sans-serif}body{padding:8px}.product-publish-workbench{display:grid;min-width:0;gap:12px}.remote-edit-support{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.remote-edit-support>span{display:grid;min-width:0;gap:3px;border:1px solid #ddd;padding:8px}.publish-execute{display:flex;width:100%;align-items:center;justify-content:center;border:0;padding:10px 12px}.publish-execute:disabled{opacity:.7}
    ${styles.replaceAll("</style", "<\\/style")}
  </style></head><body><main class="product-publish-workbench">
    <section class="product-edit-handoff" data-handoff><header><span><b>중앙 저장 후 채널별로 따로 반영합니다.</b></span><em>수정 대상 1개 채널</em></header><ol><li><span>1</span><div><b>중앙 상품 먼저 저장</b><small>중앙 원장값 확인</small></div></li><li><span>2</span><div><b>지원·차단 이유 확인</b><small>지원 상태 확인</small></div></li><li><span>3</span><div><b>채널마다 별도 실행</b><small>지원 항목만 전송</small></div></li></ol><p><span><b>자동 반영하지 않는 항목</b><small>가격·옵션·판매 구성은 자동 전송하지 않습니다.</small></span></p></section>
    <div class="product-edit-draft-scope" data-draft-scope><div><b>채널 전송용 공통 초안</b><small>중앙 상품을 다시 저장하는 입력란이 아닙니다.</small></div><span>중앙 재저장 아님</span></div>
    <article class="product-edit-support-section" data-support-section><header class="product-edit-support-header"><div><b>이 채널의 원격 수정 범위</b><small>일부 지원 필드는 원격 반영 후 수동 확인도 필요합니다.</small></div><span>완전 3 · 일부 1 · 수동 5</span></header><div class="product-edit-support-grid"><div class="remote-edit-support">${supportFields}</div></div><p class="product-edit-manual-scope"><span><b>별도 수동 확인·반영: 필수정보 · 옵션 · 판매 구성 · 가격 · 재고</b><small>일부 지원 필드도 완전 반영 성공으로 표시하지 않습니다.</small></span></p></article>
    <p class="product-edit-action-scope" id="qoo10-remote-action-scope"><span><b>Qoo10에 별도 원격 반영</b><small>지원 범위만 전송합니다.</small></span></p>
    <button type="button" class="publish-execute product-edit-remote-action" data-remote-action>Qoo10 지원 항목만 별도 원격 반영</button>
    <button type="button" class="publish-execute product-edit-blocked-action" data-blocked-action disabled>원격 반영 차단 · 판매자센터 수동 수정</button>
  </main></body></html>`;
}

test("상품 수정 handoff는 280px와 390px에서 넘치지 않고 원격 액션을 누를 수 있다", { timeout: 60_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "product workbench mobile geometry test requires Chrome");

  const styles = await readFile(new URL("../app/product-publish-workbench.css", import.meta.url), "utf8");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"],
  });

  try {
    for (const width of viewportWidths) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await page.setContent(fixtureHtml(styles), { waitUntil: "load" });

      const geometry = await page.evaluate(() => {
        const handoff = document.querySelector("[data-handoff]");
        const draftScope = document.querySelector("[data-draft-scope]");
        const support = document.querySelector("[data-support-section]");
        const action = document.querySelector("[data-remote-action]");
        const blocked = document.querySelector("[data-blocked-action]");
        if (!(handoff instanceof HTMLElement) || !(draftScope instanceof HTMLElement) || !(support instanceof HTMLElement) || !(action instanceof HTMLElement) || !(blocked instanceof HTMLElement)) throw new Error("workbench fixture is incomplete");
        const boxes = [handoff, draftScope, support, action, blocked].map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, height: box.height };
        });
        const stages = [...handoff.querySelectorAll("li")].map((element) => element.getBoundingClientRect());
        const reasons = [...support.querySelectorAll(".product-edit-support-reason")].map((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflow: getComputedStyle(element).overflow,
        }));
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          boxes,
          stageLefts: stages.map((box) => box.left),
          stageTops: stages.map((box) => box.top),
          reasons,
          actionHeight: action.getBoundingClientRect().height,
          blockedHeight: blocked.getBoundingClientRect().height,
        };
      });

      assert.equal(geometry.viewportWidth, width);
      assert.ok(geometry.documentWidth <= width, `${width}px workbench must not create horizontal overflow`);
      for (const box of geometry.boxes) {
        assert.ok(box.left >= -0.5 && box.right <= width + 0.5, `${width}px workbench element escapes the viewport: ${JSON.stringify(box)}`);
      }
      assert.ok(geometry.stageTops[1] > geometry.stageTops[0] && geometry.stageTops[2] > geometry.stageTops[1], `${width}px handoff stages must stack for readable mobile flow`);
      assert.ok(geometry.stageLefts.every((left) => Math.abs(left - geometry.stageLefts[0]) <= 0.5), `${width}px handoff stages must share the same left edge`);
      for (const reason of geometry.reasons) {
        assert.ok(reason.scrollHeight <= reason.clientHeight + 1, `${width}px support reason must remain fully visible: ${JSON.stringify(reason)}`);
        assert.equal(reason.overflow, "visible", `${width}px support reason must not be clipped`);
      }
      assert.ok(geometry.actionHeight >= 44, `${width}px remote action must be at least 44px`);
      assert.ok(geometry.blockedHeight >= 44, `${width}px blocked action must be at least 44px`);

      await page.locator("[data-remote-action]").scrollIntoViewIfNeeded();
      const hit = await page.locator("[data-remote-action]").evaluate((element) => {
        const box = element.getBoundingClientRect();
        const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return target instanceof Element && Boolean(target.closest("[data-remote-action]"));
      });
      assert.equal(hit, true, `${width}px remote action center must be touchable`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
