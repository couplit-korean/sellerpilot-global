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
  new URL("../app/product-publish-workbench.css", import.meta.url),
];

const viewports = [
  { width: 280, height: 653 },
  { width: 320, height: 844 },
  { width: 344, height: 844 },
  { width: 360, height: 844 },
  { width: 390, height: 844 },
  { width: 412, height: 844 },
];

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
  <body><section class="app-main publishing-active"><div class="app-header-stack"><div class="commerce-service-rail"><strong>통합 판매관리</strong><span>판매 데이터 원장 연결</span><span>운영 키 확인 중</span><span>읽기 진단 확인 중</span><span>자동 동기화 확인 필요</span><em>운영 DB 연결 오류</em></div><header class="topbar"><div class="topbar-title"><button class="mobile-menu-button" data-header-action="menu" aria-label="전체 메뉴 열기">≡</button><div><h1>상품 등록 센터</h1></div></div><div class="topbar-actions has-operations-attention"><button type="button" class="demo-data-badge attention" data-operations-status data-header-action="operations" aria-label="연결 오류: 운영 DB 연결 오류"><b>연결 오류</b><small>운영 DB 연결 오류</small></button><button class="global-search" data-header-action="search" aria-label="통합 검색">⌕</button><div class="notification-wrap"><button class="top-icon-button" data-header-action="notification" aria-label="알림">!</button></div><button class="user-menu" data-header-action="account" aria-label="관리자 계정 설정"><span class="user-avatar">관</span></button></div></header></div><section class="mobile-push-gate browser" data-push-gate><button type="button" class="mobile-push-gate-dismiss" data-gate-dismiss>나중에</button><div class="mobile-push-gate-icon">!</div><div class="mobile-push-gate-copy"><h2>주문 배송 알림</h2><p>사진 입력을 가리지 않는 인플로우 설정창입니다.</p></div><div class="mobile-push-gate-actions"><button type="button">알림 허용</button></div></section><div class="mobile-push-chip"><span><b>주문·배송 알림 사용 중</b><small>새 주문과 배송 상태를 즉시 알려드립니다.</small></span><button type="button" class="mobile-push-chip-dismiss" data-push-chip-dismiss aria-label="주문 배송 알림 상태 닫기">×</button></div><main class="app-content"><section class="panel upload-panel">
    <section class="main-photo-section"><input class="visually-hidden" id="main-camera" type="file" capture="environment"><input class="visually-hidden" id="main-album" type="file"><div class="photo-source-actions" aria-label="대표사진 입력 방식"><label for="main-camera" data-action="main-camera"><span><b>사진 촬영</b></span></label><label for="main-album" data-action="main-album"><span><b>앨범에서 선택</b></span></label></div></section>
    <section class="option-photo-section"><div class="option-photo-grid">${Array.from({ length: 8 }, (_, index) => optionCard(index)).join("")}</div></section>
    <section class="extra-photo-section"><input class="visually-hidden" id="extra-camera" type="file" capture="environment"><input class="visually-hidden" id="extra-album" type="file" multiple><div class="photo-source-actions" aria-label="추가 사진 입력 방식"><label for="extra-camera" data-action="extra-camera"><span><b>사진 촬영</b></span></label><label for="extra-album" data-action="extra-album"><span><b>앨범에서 선택</b></span></label></div></section>
    <div class="analysis-start-bar not-ready" data-generation-status><span><b>0장</b> · 원본 별도 보존 · 분석용 1200×1200 JPG · 필수정보 미완료 · 대표사진 미완료<br><small>서버 AI 연결 상태를 확인하고 있습니다.</small></span><button type="button" disabled>서버 AI 연결 필요</button></div>
  </section></main></section>
  <div class="toast notice-info"><span class="toast-icon">!</span><span class="toast-copy"><b>진행 알림</b><span>등록 상태를 확인했습니다.</span></span><button type="button" data-toast-dismiss aria-label="알림 닫기">×</button></div>
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

function dashboardFixtureHtml(styles) {
  const channelCard = (code, name, state) => `<button type="button" class="channel-row" data-channel-card="${code}">
    <span class="channel-mark">${code}</span>
    <span class="channel-name"><strong>${name}</strong><span class="${state}"><i></i>${state === "connected" ? "연결됨" : "확인 필요"}</span></span>
    <span class="channel-metric channel-revenue"><small>선택 기간 매출</small><b>₩1,234,000</b></span>
    <span class="channel-metric channel-orders"><small>실주문</small><b>24</b></span>
    <span class="channel-progress"><span><i style="width:55%"></i></span><b>확인 중</b></span>
    <span aria-hidden="true">›</span>
  </button>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles.replaceAll("</style", "<\\/style")}</style></head>
  <body><main class="app-content"><div class="page-stack">
    <section class="dashboard-cs-pair" aria-label="CS 처리 현황">
      <button type="button" class="panel"><span class="metric-icon orange">!</span><span><small>미처리 CS</small><strong>12건</strong><em>답변 대기 · 처리 중</em></span><span aria-hidden="true">›</span></button>
      <button type="button" class="panel"><span class="metric-icon green">✓</span><span><small>완료 CS</small><strong>31건</strong><em>처리 완료 원장</em></span><span aria-hidden="true">›</span></button>
    </section>
    <section class="dashboard-lower-grid"><article class="panel channel-performance">
      <div class="panel-heading"><div><span class="panel-kicker">실계정 운영 상태</span><h3>채널별 실데이터</h3></div><span class="live-label"><i></i>LIVE</span></div>
      <div class="channel-list" data-channel-list>
        ${channelCard("N", "네이버 스마트스토어", "pending")}
        ${channelCard("11", "11번가", "connected")}
      </div>
    </article></section>
  </div></main></body></html>`;
}

function transientLayersHtml() {
  return `<div class="toast notice-info"><span class="toast-icon">!</span><span class="toast-copy"><b>진행 알림</b><span>화면의 마지막 작업을 가리지 않아야 합니다.</span></span><button type="button" data-toast-dismiss aria-label="알림 닫기">×</button></div>
  <nav class="mobile-bottom-nav"><button>대시보드</button><button>상품</button><button class="active">등록</button><button>주문</button><button>CS</button></nav>`;
}

function workspaceFixtureHtml(styles, kind) {
  const content = kind === "activity"
    ? `<div class="page-stack registration-activity-page"><section class="registration-card-grid">
        <article class="panel registration-card"><header><span class="registration-status analyzing">분석 중</span><small>방금 전</small></header><button type="button" class="registration-card-inspect" aria-expanded="true"><span class="registration-product"><span></span><span><h3>롯데 샌드 과자 세트</h3><p>실시간 작업 상태</p></span></span><span class="registration-inspect-label">상세 상태</span></button><div class="registration-progress"><span><i style="width:42%"></i></span><small>서버 작업을 확인 중입니다.</small></div><section class="registration-live-detail"><header><span><b>현재 작업 상태</b></span><em>10초마다 운영 원장 갱신</em></header><p>상품 사실 검증과 이미지 생성을 진행하고 있습니다.</p></section><footer><button type="button" class="registration-stop-button">등록 작동 중지</button><button type="button" class="ghost-button">상품 보기</button></footer></article>
        <article class="panel registration-card"><header><span class="registration-status completed">등록 완료</span><small>5분 전</small></header><button type="button" class="registration-card-inspect"><span class="registration-product"><span></span><span><h3>사조 참치 통조림</h3><p>종료 상태 · 채널 응답</p></span></span><span class="registration-inspect-label">상세 상태</span></button><div class="registration-progress"><span><i style="width:100%"></i></span><small>등록 처리가 완료됐습니다.</small></div><footer><button type="button" class="ghost-button" data-workspace-action>상품 상세 보기</button></footer></article>
      </section></div>`
    : `<div class="page-stack product-detail-page saved-product-detail-page"><section class="product-detail-actions"><button type="button" class="product-detail-back">상품 목록</button><div><button type="button" class="primary-button">전체 정보 수정</button></div></section><section class="panel detail-preview-panel"><div class="detail-preview-toolbar"><span><b>상세페이지 라이브 미리보기</b><small>이미지 위에서도 세로 스크롤할 수 있습니다.</small></span><button type="button">편집기 열기</button></div><div class="detail-preview-scroll"><div class="detail-preview-canvas"><img data-preview-image alt="상품 상세페이지 미리보기" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='1400'%3E%3Crect width='600' height='1400' fill='%23eef4f1'/%3E%3C/svg%3E" style="display:block;width:100%;height:1400px"></div></div></section><button type="button" class="primary-button" data-workspace-action>상세 정보 수정 계속</button></div>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles.replaceAll("</style", "<\\/style")}</style></head><body><section class="app-main"><main class="app-content">${content}</main></section>${transientLayersHtml()}</body></html>`;
}

function productEditFixtureHtml(styles) {
  const fields = Array.from({ length: 12 }, (_, index) => `<label><span>상품 정보 ${index + 1}</span><input value="운영 상품 수정값 ${index + 1}"></label>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles.replaceAll("</style", "<\\/style")}</style></head><body><div class="product-edit-overlay"><section class="product-edit-dialog"><header><div><h2>상품 전체 정보 수정</h2><p>등록 때 입력한 상품 정보를 다시 수정합니다.</p></div><button type="button" data-edit-close aria-label="상품 수정 닫기">×</button></header><form class="product-edit-form">${fields}<label class="product-edit-description"><span>상품 설명</span><textarea>상세 상품 설명을 수정합니다.</textarea></label></form><div class="intake-confirmations"><label><input type="checkbox" checked><span><b>상품 사실 확인</b><small>수정 내용을 확인했습니다.</small></span></label></div><footer><button type="button" class="ghost-button" data-edit-action>취소</button><button type="button" class="primary-button" data-edit-action>수정 저장</button></footer></section></div>${transientLayersHtml()}</body></html>`;
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
    for (const { width, height } of viewports) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.setContent(fixtureHtml(styles), { waitUntil: "load" });
      await page.waitForTimeout(250);

      const geometry = await page.locator(".option-slot-wrap").evaluateAll((cards) => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        topbar: (() => {
          const header = document.querySelector(".topbar");
          const title = header?.querySelector(".topbar-title");
          const heading = title?.querySelector("h1");
          const actions = header?.querySelector(".topbar-actions.has-operations-attention");
          if (!(header instanceof HTMLElement) || !(title instanceof HTMLElement) || !(heading instanceof HTMLElement) || !(actions instanceof HTMLElement)) throw new Error("fixture is missing the attention topbar");
          const headerBox = header.getBoundingClientRect();
          const titleBox = title.getBoundingClientRect();
          const headingBox = heading.getBoundingClientRect();
          const actionsBox = actions.getBoundingClientRect();
          const controls = [...header.querySelectorAll("[data-header-action]")].map((control) => {
            if (!(control instanceof HTMLElement)) throw new Error("header action is not an HTML element");
            const box = control.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return {
              action: control.dataset.headerAction,
              width: box.width,
              height: box.height,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
              left: box.left,
              hit: hit instanceof Element && Boolean(hit.closest(`[data-header-action="${control.dataset.headerAction}"]`)),
            };
          });
          return {
            height: headerBox.height,
            right: headerBox.right,
            left: headerBox.left,
            titleTop: titleBox.top,
            titleRight: titleBox.right,
            titleBottom: titleBox.bottom,
            titleLeft: titleBox.left,
            headingWidth: headingBox.width,
            headingClientWidth: heading.clientWidth,
            headingScrollWidth: heading.scrollWidth,
            actionsTop: actionsBox.top,
            actionsRight: actionsBox.right,
            actionsBottom: actionsBox.bottom,
            actionsLeft: actionsBox.left,
            controls,
          };
        })(),
        operationsStatus: (() => {
          const status = document.querySelector("[data-operations-status]");
          if (!(status instanceof HTMLElement)) throw new Error("fixture is missing the operations attention button");
          const box = status.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            display: getComputedStyle(status).display,
            width: box.width,
            height: box.height,
            hit: hit instanceof Element && Boolean(hit.closest("[data-operations-status]")),
          };
        })(),
        pushGate: (() => {
          const gate = document.querySelector(".app-main > .mobile-push-gate.browser");
          const dismiss = gate?.querySelector("[data-gate-dismiss]");
          const actions = gate?.querySelector(".mobile-push-gate-actions");
          const action = actions?.querySelector("button");
          if (!(gate instanceof HTMLElement) || !(dismiss instanceof HTMLElement) || !(actions instanceof HTMLElement) || !(action instanceof HTMLElement)) throw new Error("fixture is missing the in-flow push gate");
          const box = gate.getBoundingClientRect();
          const dismissBox = dismiss.getBoundingClientRect();
          const actionBox = action.getBoundingClientRect();
          const hit = document.elementFromPoint(dismissBox.left + dismissBox.width / 2, dismissBox.top + dismissBox.height / 2);
          return {
            position: getComputedStyle(gate).position,
            height: box.height,
            actionHeight: actionBox.height,
            actionColumns: getComputedStyle(actions).gridTemplateColumns.split(" ").filter(Boolean).length,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            dismiss: { top: dismissBox.top, right: dismissBox.right, bottom: dismissBox.bottom, left: dismissBox.left },
            dismissHit: hit instanceof Element && Boolean(hit.closest("[data-gate-dismiss]")),
          };
        })(),
        pushStatus: (() => {
          const chip = document.querySelector(".app-main > .mobile-push-chip");
          const dismiss = chip?.querySelector("[data-push-chip-dismiss]");
          if (!(chip instanceof HTMLElement) || !(dismiss instanceof HTMLElement)) throw new Error("fixture is missing the in-flow push status");
          const box = chip.getBoundingClientRect();
          const dismissBox = dismiss.getBoundingClientRect();
          const hit = document.elementFromPoint(dismissBox.left + dismissBox.width / 2, dismissBox.top + dismissBox.height / 2);
          return {
            position: getComputedStyle(chip).position,
            zIndex: getComputedStyle(chip).zIndex,
            top: box.top,
            bottom: box.bottom,
            dismissWidth: dismissBox.width,
            dismissHeight: dismissBox.height,
            dismissHit: hit instanceof Element && Boolean(hit.closest("[data-push-chip-dismiss]")),
          };
        })(),
        generationStatus: (() => {
          const status = document.querySelector("[data-generation-status]");
          const action = status?.querySelector("button");
          if (!(status instanceof HTMLElement) || !(action instanceof HTMLElement)) throw new Error("fixture is missing the generation status");
          const box = status.getBoundingClientRect();
          const actionBox = action.getBoundingClientRect();
          return {
            position: getComputedStyle(status).position,
            zIndex: getComputedStyle(status).zIndex,
            top: box.top,
            bottom: box.bottom,
            actionWidth: actionBox.width,
            actionHeight: actionBox.height,
          };
        })(),
        transientLayers: (() => {
          const toast = document.querySelector(".toast");
          const toastDismiss = toast?.querySelector("[data-toast-dismiss]");
          const navigation = document.querySelector(".mobile-bottom-nav");
          if (!(toast instanceof HTMLElement) || !(toastDismiss instanceof HTMLElement) || !(navigation instanceof HTMLElement)) throw new Error("fixture is missing a transient layer");
          const toastBox = toast.getBoundingClientRect();
          const dismissBox = toastDismiss.getBoundingClientRect();
          const navigationBox = navigation.getBoundingClientRect();
          const hit = document.elementFromPoint(dismissBox.left + dismissBox.width / 2, dismissBox.top + dismissBox.height / 2);
          return {
            toastPosition: getComputedStyle(toast).position,
            toastZIndex: Number.parseInt(getComputedStyle(toast).zIndex, 10),
            toastTop: toastBox.top,
            toastRight: toastBox.right,
            toastBottom: toastBox.bottom,
            toastLeft: toastBox.left,
            dismissWidth: dismissBox.width,
            dismissHeight: dismissBox.height,
            dismissHit: hit instanceof Element && Boolean(hit.closest("[data-toast-dismiss]")),
            navigationPosition: getComputedStyle(navigation).position,
            navigationZIndex: Number.parseInt(getComputedStyle(navigation).zIndex, 10),
            navigationTop: navigationBox.top,
            navigationBottom: navigationBox.bottom,
          };
        })(),
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
      assert.ok(geometry.topbar.height >= 100, `${width}px attention topbar must reserve two readable rows (${geometry.topbar.height}px)`);
      assert.ok(geometry.topbar.left >= -0.5 && geometry.topbar.right <= width + 0.5, `${width}px attention topbar must fit the viewport`);
      assert.ok(geometry.topbar.titleLeft >= geometry.topbar.left - 0.5 && geometry.topbar.titleRight <= geometry.topbar.right + 0.5, `${width}px title row must fit the topbar`);
      assert.ok(geometry.topbar.headingWidth >= 80, `${width}px page heading must retain readable width (${geometry.topbar.headingWidth}px)`);
      assert.ok(geometry.topbar.headingScrollWidth <= geometry.topbar.headingClientWidth + 1, `${width}px page heading must not be clipped (${JSON.stringify(geometry.topbar)})`);
      assert.ok(geometry.topbar.actionsTop >= geometry.topbar.titleBottom - 0.5, `${width}px attention actions must use a separate row from the title`);
      assert.ok(geometry.topbar.actionsLeft >= geometry.topbar.left - 0.5 && geometry.topbar.actionsRight <= geometry.topbar.right + 0.5, `${width}px attention action row must fit the topbar`);
      assert.equal(geometry.topbar.controls.length, 5, `${width}px attention topbar must retain menu, status, search, bell and account controls`);
      for (const control of geometry.topbar.controls) {
        assert.ok(control.width >= 44 && control.height >= 44, `${width}px ${control.action} topbar control must retain a 44px target (${JSON.stringify(control)})`);
        assert.ok(control.left >= -0.5 && control.right <= width + 0.5, `${width}px ${control.action} topbar control must remain inside the viewport`);
        assert.equal(control.hit, true, `${width}px ${control.action} topbar control center must remain touchable`);
      }
      assert.equal(geometry.operationsStatus.display, "grid", `${width}px warning/error operations status must remain visible`);
      assert.ok(geometry.operationsStatus.width >= 44 && geometry.operationsStatus.height >= 44, `${width}px operations status must retain a 44px target`);
      assert.equal(geometry.operationsStatus.hit, true, `${width}px operations status center must remain touchable`);
      assert.equal(geometry.pushGate.position, "relative", `${width}px push gate must remain in flow and anchor its dismiss button`);
      assert.ok(geometry.pushGate.dismiss.top >= geometry.pushGate.top - 0.5, `${width}px push dismiss escapes above its gate`);
      assert.ok(geometry.pushGate.dismiss.right <= geometry.pushGate.right + 0.5, `${width}px push dismiss escapes the right edge of its gate`);
      assert.ok(geometry.pushGate.dismiss.bottom <= geometry.pushGate.bottom + 0.5, `${width}px push dismiss escapes below its gate`);
      assert.ok(geometry.pushGate.dismiss.left >= geometry.pushGate.left - 0.5, `${width}px push dismiss escapes the left edge of its gate`);
      assert.equal(geometry.pushGate.dismissHit, true, `${width}px push dismiss center must remain touchable`);
      if (width <= 344) {
        assert.ok(geometry.pushGate.height <= 132, `${width}px publishing push gate must stay compact (${geometry.pushGate.height}px)`);
        assert.equal(geometry.pushGate.actionColumns, 2, `${width}px publishing push actions must retain two compact columns`);
        assert.ok(geometry.pushGate.actionHeight >= 44, `${width}px publishing push action must retain a 44px touch target`);
      }
      assert.equal(geometry.pushStatus.position, "relative", `${width}px push status must remain in document flow`);
      assert.equal(geometry.pushStatus.zIndex, "auto", `${width}px in-flow push status must not create an overlay layer`);
      assert.ok(geometry.pushStatus.dismissWidth >= 44 && geometry.pushStatus.dismissHeight >= 44, `${width}px push status dismiss must retain a 44px target`);
      assert.equal(geometry.pushStatus.dismissHit, true, `${width}px push status dismiss center must remain touchable`);
      assert.ok(geometry.pushGate.bottom <= geometry.pushStatus.top, `${width}px push gate must not cover the push status`);
      assert.ok(geometry.pushStatus.bottom <= geometry.cards[0].cardTop, `${width}px push status must not cover the first photo row`);
      assert.equal(geometry.generationStatus.position, "static", `${width}px generation status must remain in page flow`);
      assert.equal(geometry.generationStatus.zIndex, "auto", `${width}px generation status must not float over photo controls`);
      assert.ok(geometry.generationStatus.actionWidth > 0 && geometry.generationStatus.actionHeight >= 44, `${width}px generation action must retain a 44px target`);
      assert.ok(geometry.cards.at(-1).cardBottom <= geometry.generationStatus.top + 0.5, `${width}px generation status must follow the photo grid instead of covering it`);
      assert.equal(geometry.transientLayers.toastPosition, "fixed", `${width}px toast must remain a transient fixed notice`);
      assert.equal(geometry.transientLayers.navigationPosition, "fixed", `${width}px mobile navigation must remain fixed`);
      assert.ok(geometry.transientLayers.toastLeft >= -0.5 && geometry.transientLayers.toastRight <= width + 0.5, `${width}px toast must fit the viewport`);
      assert.ok(geometry.transientLayers.toastBottom <= geometry.transientLayers.navigationTop + 0.5, `${width}px toast must stay above mobile navigation`);
      assert.ok(geometry.transientLayers.navigationBottom <= height + 0.5, `${width}px mobile navigation must honor the viewport bottom inset`);
      assert.ok(geometry.transientLayers.toastZIndex > geometry.transientLayers.navigationZIndex, `${width}px toast must render above navigation without sharing its lane`);
      assert.ok(geometry.transientLayers.dismissWidth >= 43.5 && geometry.transientLayers.dismissHeight >= 43.5, `${width}px toast dismiss must retain a 44px CSS target (${JSON.stringify(geometry.transientLayers)})`);
      assert.equal(geometry.transientLayers.dismissHit, true, `${width}px toast dismiss center must remain touchable`);
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

      const actionIds = [
        "main-camera",
        "main-album",
        ...Array.from({ length: 8 }, (_, index) => [`${index}-camera`, `${index}-album`]).flat(),
        "extra-camera",
        "extra-album",
      ];
      for (const actionId of actionIds) {
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
          const fixedLayerTops = [".toast", ".mobile-bottom-nav"]
            .map((selector) => document.querySelector(selector)?.getBoundingClientRect().top)
            .filter((value) => typeof value === "number");
          const occlusionTop = Math.min(window.innerHeight, ...fixedLayerTops);
          const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            hit: target instanceof Element ? target.closest("[data-action]")?.getAttribute("data-action") ?? null : null,
            target: target instanceof Element ? `${target.tagName}.${target.className}` : null,
            occlusionTop,
            box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
            scrollY: window.scrollY,
            viewportHeight: window.innerHeight,
            documentHeight: document.documentElement.scrollHeight,
          };
        });
        assert.ok(probe.box.top >= -0.5, `${width}x${height} ${actionId}: target scrolled above the viewport (${JSON.stringify(probe)})`);
        assert.ok(probe.box.bottom <= probe.occlusionTop + 0.5, `${width}x${height} ${actionId}: navigation or toast covers the action (${JSON.stringify(probe)})`);
        assert.ok(probe.box.bottom - probe.box.top >= 44, `${width}x${height} ${actionId}: touch target is smaller than 44px`);
        assert.equal(probe.hit, actionId, `${width}x${height} ${actionId}: center touch is intercepted by another card or overlay (${JSON.stringify(probe)})`);
      }

      const popoverGeometry = await page.evaluate(() => {
        const wrap = document.querySelector(".notification-wrap");
        const headerStack = document.querySelector(".app-header-stack");
        const navigation = document.querySelector(".mobile-bottom-nav");
        if (!(wrap instanceof HTMLElement) || !(headerStack instanceof HTMLElement) || !(navigation instanceof HTMLElement)) throw new Error("notification clearance fixture is incomplete");
        const popover = document.createElement("div");
        popover.className = "notification-popover";
        popover.innerHTML = `<div><h4>실시간 알림 <small>1</small></h4><span><button type="button" data-notification-close>전체 닫기</button><button type="button" data-notification-close>닫기</button></span></div><div class="notification-item"><button class="notification-item-open">등록 상태 보기</button><button class="notification-item-dismiss" data-notification-close>×</button></div>`;
        wrap.append(popover);
        const stackBox = headerStack.getBoundingClientRect();
        const popoverBox = popover.getBoundingClientRect();
        const navigationBox = navigation.getBoundingClientRect();
        const closes = [...popover.querySelectorAll("[data-notification-close]")].map((close) => {
          const box = close.getBoundingClientRect();
          return { width: box.width, height: box.height };
        });
        popover.remove();
        return {
          headerBottom: stackBox.bottom,
          popoverTop: popoverBox.top,
          popoverBottom: popoverBox.bottom,
          navigationTop: navigationBox.top,
          closes,
        };
      });
      assert.ok(popoverGeometry.popoverTop >= popoverGeometry.headerBottom + 6.5, `${width}px notification popover must clear the expanded attention header (${JSON.stringify(popoverGeometry)})`);
      assert.ok(popoverGeometry.popoverBottom <= popoverGeometry.navigationTop - 7.5, `${width}px notification popover must clear mobile navigation`);
      for (const close of popoverGeometry.closes) {
        assert.ok(close.width >= 44 && close.height >= 44, `${width}px notification close must retain a 44px target`);
      }

      const disabledProbe = await page.locator('.option-slot-wrap[data-card="0"] .photo-source-actions').evaluate((actions) => {
        actions.setAttribute("aria-disabled", "true");
        const target = actions.querySelector("[data-action]");
        if (!(target instanceof HTMLElement)) throw new Error("fixture is missing a disabled photo action");
        target.setAttribute("aria-disabled", "true");
        const box = target.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          pointerEvents: getComputedStyle(target).pointerEvents,
          hitDisabledAction: hit instanceof Element && Boolean(hit.closest(`[data-action="${target.dataset.action}"]`)),
        };
      });
      assert.equal(disabledProbe.pointerEvents, "none", `${width}px disabled photo labels must reject pointer input`);
      assert.equal(disabledProbe.hitDisabledAction, false, `${width}px disabled photo action must not receive the center touch`);

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
    for (const { width, height } of viewports) {
      const context = await browser.newContext({
        viewport: { width, height },
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

test("Fold cover dashboard gives marketplace status cards readable rows without collapsing the CS pair", { timeout: 60_000 }, async () => {
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
    for (const { width, height } of viewports) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.setContent(dashboardFixtureHtml(styles), { waitUntil: "load" });

      const geometry = await page.evaluate(() => {
        const csPair = document.querySelector(".dashboard-cs-pair");
        const channelList = document.querySelector("[data-channel-list]");
        if (!(csPair instanceof HTMLElement) || !(channelList instanceof HTMLElement)) throw new Error("dashboard fixture is incomplete");
        const columnCount = (element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
        const boxOf = (element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height, top: box.top, right: box.right, bottom: box.bottom, left: box.left };
        };
        const csCards = [...csPair.querySelectorAll(":scope > button")].map((card) => boxOf(card));
        const channelCards = [...channelList.querySelectorAll(":scope > .channel-row")].map((card) => {
          if (!(card instanceof HTMLElement)) throw new Error("channel card is not an HTML element");
          const name = card.querySelector(".channel-name");
          const strong = name?.querySelector("strong");
          if (!(name instanceof HTMLElement) || !(strong instanceof HTMLElement)) throw new Error("channel card is missing its name");
          const range = document.createRange();
          range.selectNodeContents(strong);
          const textLines = [...range.getClientRects()].filter((box) => box.width > 0 && box.height > 0).length;
          return {
            ...boxOf(card),
            nameWidth: name.getBoundingClientRect().width,
            textLines,
          };
        });
        return {
          documentWidth: document.documentElement.scrollWidth,
          csColumns: columnCount(csPair),
          channelColumns: columnCount(channelList),
          csCards,
          channelCards,
        };
      });

      assert.ok(geometry.documentWidth <= width, `${width}px dashboard must not create horizontal overflow`);
      assert.equal(geometry.csColumns, 2, `${width}px CS summary must keep its independent two-card contract`);
      assert.equal(geometry.csCards.length, 2, `${width}px CS fixture must render two summary cards`);
      for (const [index, card] of geometry.csCards.entries()) {
        assert.ok(card.width > 0 && card.height >= 44, `${width}px CS card ${index + 1} must remain touchable`);
        assert.ok(card.left >= -0.5 && card.right <= width + 0.5, `${width}px CS card ${index + 1} must stay inside the viewport`);
      }

      assert.equal(geometry.channelColumns, width <= 360 ? 1 : 2, `${width}px dashboard channel grid uses the wrong responsive column count`);
      assert.equal(geometry.channelCards.length, 2, `${width}px dashboard fixture must render two channel cards`);
      for (const [index, card] of geometry.channelCards.entries()) {
        assert.ok(card.width > 0 && card.height >= 44, `${width}px channel card ${index + 1} must remain touchable`);
        assert.ok(card.left >= -0.5 && card.right <= width + 0.5, `${width}px channel card ${index + 1} must stay inside the viewport`);
        assert.ok(card.nameWidth >= 80, `${width}px channel card ${index + 1} name column is too narrow (${card.nameWidth}px)`);
        assert.ok(card.textLines <= 2, `${width}px channel card ${index + 1} name became a vertical label (${card.textLines} lines)`);
      }

      if (width <= 360) {
        assert.ok(geometry.channelCards[1].top >= geometry.channelCards[0].bottom - 0.5, `${width}px channel cards must occupy separate rows`);
      } else {
        assert.ok(Math.abs(geometry.channelCards[1].top - geometry.channelCards[0].top) <= 0.5, `${width}px wider phones should retain the two-column channel row`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("Fold workspaces keep history, detail preview and product edit actions clear of transient layers", { timeout: 90_000 }, async () => {
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
    for (const { width, height } of viewports) {
      for (const kind of ["activity", "detail"]) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        await page.setContent(workspaceFixtureHtml(styles, kind), { waitUntil: "load" });
        await page.waitForTimeout(250);

        const baseGeometry = await page.evaluate(() => {
          const navigation = document.querySelector(".mobile-bottom-nav");
          const toast = document.querySelector(".toast");
          const toastDismiss = toast?.querySelector("[data-toast-dismiss]");
          if (!(navigation instanceof HTMLElement) || !(toast instanceof HTMLElement) || !(toastDismiss instanceof HTMLElement)) throw new Error("workspace transient layers are incomplete");
          const navigationBox = navigation.getBoundingClientRect();
          const toastBox = toast.getBoundingClientRect();
          const dismissBox = toastDismiss.getBoundingClientRect();
          return {
            documentWidth: document.documentElement.scrollWidth,
            documentHeight: document.documentElement.scrollHeight,
            navigationTop: navigationBox.top,
            navigationBottom: navigationBox.bottom,
            navigationZIndex: Number.parseInt(getComputedStyle(navigation).zIndex, 10),
            toastTop: toastBox.top,
            toastBottom: toastBox.bottom,
            toastZIndex: Number.parseInt(getComputedStyle(toast).zIndex, 10),
            dismissWidth: dismissBox.width,
            dismissHeight: dismissBox.height,
          };
        });
        assert.ok(baseGeometry.documentWidth <= width, `${width}px ${kind} workspace must not create horizontal overflow`);
        if (kind === "detail") assert.ok(baseGeometry.documentHeight > height, `${width}px detail workspace must retain vertical scrolling`);
        assert.ok(baseGeometry.toastBottom <= baseGeometry.navigationTop + 0.5, `${width}px ${kind} toast must stay above navigation`);
        assert.ok(baseGeometry.navigationBottom <= height + 0.5, `${width}px ${kind} navigation must honor the viewport bottom`);
        assert.ok(baseGeometry.toastZIndex > baseGeometry.navigationZIndex, `${width}px ${kind} toast must render above navigation`);
        assert.ok(baseGeometry.dismissWidth >= 43.5 && baseGeometry.dismissHeight >= 43.5, `${width}px ${kind} toast close must retain a 44px CSS target`);

        if (kind === "detail") {
          const preview = await page.locator("[data-preview-image]").evaluate((image) => {
            const scroll = image.closest(".detail-preview-scroll");
            if (!(scroll instanceof HTMLElement)) throw new Error("detail preview scroll region is missing");
            const imageBox = image.getBoundingClientRect();
            window.scrollTo({ top: window.scrollY + imageBox.top + 180, behavior: "instant" });
            const settledBox = image.getBoundingClientRect();
            return {
              scrollOverflow: getComputedStyle(scroll).overflow,
              scrollTouchAction: getComputedStyle(scroll).touchAction,
              imageTouchAction: getComputedStyle(image).touchAction,
              imagePointerEvents: getComputedStyle(image).pointerEvents,
              pointX: Math.max(1, Math.min(window.innerWidth - 1, settledBox.left + settledBox.width / 2)),
              pointY: Math.max(1, Math.min(window.innerHeight - 1, settledBox.top + 180)),
              before: window.scrollY,
            };
          });
          assert.equal(preview.scrollOverflow, "visible", `${width}px detail preview must use the page scroll on mobile`);
          assert.equal(preview.scrollTouchAction, "pan-y", `${width}px detail preview must allow vertical touch panning`);
          assert.equal(preview.imageTouchAction, "pan-y", `${width}px detail image must allow vertical touch panning`);
          assert.equal(preview.imagePointerEvents, "none", `${width}px detail image must not intercept page gestures`);
          await page.mouse.move(preview.pointX, preview.pointY);
          await page.mouse.wheel(0, 260);
          await page.waitForTimeout(40);
          const after = await page.evaluate(() => window.scrollY);
          assert.ok(after > preview.before, `${width}px wheel/touch-equivalent input over the detail image must scroll the page`);
        } else {
          const activityCards = await page.locator(".registration-card").evaluateAll((cards) => cards.map((card) => {
            const box = card.getBoundingClientRect();
            const footerActions = [...card.querySelectorAll(":scope > footer > button")].map((action) => action.getBoundingClientRect().height);
            return { right: box.right, left: box.left, width: box.width, footerActions };
          }));
          for (const [index, card] of activityCards.entries()) {
            assert.ok(card.width > 0 && card.left >= -0.5 && card.right <= width + 0.5, `${width}px activity card ${index + 1} must fit the viewport`);
            for (const actionHeight of card.footerActions) assert.ok(actionHeight >= 44, `${width}px activity card ${index + 1} footer action must retain a 44px target`);
          }
        }

        const action = page.locator("[data-workspace-action]");
        await action.evaluate((element) => {
          const box = element.getBoundingClientRect();
          window.scrollTo({ top: window.scrollY + box.top - (window.innerHeight - box.height) / 2, behavior: "instant" });
        });
        await page.waitForTimeout(20);
        const actionGeometry = await action.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const fixedLayerTops = [".toast", ".mobile-bottom-nav"].map((selector) => document.querySelector(selector)?.getBoundingClientRect().top).filter((value) => typeof value === "number");
          const occlusionTop = Math.min(window.innerHeight, ...fixedLayerTops);
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { width: box.width, height: box.height, top: box.top, bottom: box.bottom, occlusionTop, hit: hit instanceof Element && Boolean(hit.closest("[data-workspace-action]")) };
        });
        assert.ok(actionGeometry.width > 0 && actionGeometry.height >= 44, `${width}px ${kind} final action must retain a 44px target`);
        assert.ok(actionGeometry.top >= -0.5 && actionGeometry.bottom <= actionGeometry.occlusionTop + 0.5, `${width}px ${kind} final action must remain above transient layers`);
        assert.equal(actionGeometry.hit, true, `${width}px ${kind} final action center must remain touchable`);
        await context.close();
      }

      const editContext = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      const editPage = await editContext.newPage();
      await editPage.setContent(productEditFixtureHtml(styles), { waitUntil: "load" });
      const editGeometry = await editPage.evaluate(() => {
        const overlay = document.querySelector(".product-edit-overlay");
        const dialog = document.querySelector(".product-edit-dialog");
        const form = dialog?.querySelector(".product-edit-form");
        const footer = dialog?.querySelector(":scope > footer");
        const close = dialog?.querySelector("[data-edit-close]");
        const navigation = document.querySelector(".mobile-bottom-nav");
        const toast = document.querySelector(".toast");
        if (!(overlay instanceof HTMLElement) || !(dialog instanceof HTMLElement) || !(form instanceof HTMLElement) || !(footer instanceof HTMLElement) || !(close instanceof HTMLElement) || !(navigation instanceof HTMLElement) || !(toast instanceof HTMLElement)) throw new Error("product edit fixture is incomplete");
        form.scrollTop = form.scrollHeight;
        const dialogBox = dialog.getBoundingClientRect();
        const footerBox = footer.getBoundingClientRect();
        const closeBox = close.getBoundingClientRect();
        const actions = [...footer.querySelectorAll("[data-edit-action]")].map((action) => {
          const box = action.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { width: box.width, height: box.height, hit: hit instanceof Element && Boolean(hit.closest("[data-edit-action]")) };
        });
        return {
          documentWidth: document.documentElement.scrollWidth,
          overlayPosition: getComputedStyle(overlay).position,
          overlayZIndex: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
          dialogTop: dialogBox.top,
          dialogRight: dialogBox.right,
          dialogBottom: dialogBox.bottom,
          dialogLeft: dialogBox.left,
          formClientHeight: form.clientHeight,
          formScrollHeight: form.scrollHeight,
          formScrollTop: form.scrollTop,
          footerTop: footerBox.top,
          footerBottom: footerBox.bottom,
          closeWidth: closeBox.width,
          closeHeight: closeBox.height,
          actions,
          navigationPointerEvents: getComputedStyle(navigation).pointerEvents,
          toastPointerEvents: getComputedStyle(toast).pointerEvents,
        };
      });
      assert.ok(editGeometry.documentWidth <= width, `${width}px edit modal must not create horizontal overflow`);
      assert.equal(editGeometry.overlayPosition, "fixed", `${width}px edit overlay must own the viewport`);
      assert.ok(editGeometry.overlayZIndex >= 300, `${width}px edit overlay must render above transient layers`);
      assert.ok(editGeometry.dialogTop >= -0.5 && editGeometry.dialogRight <= width + 0.5 && editGeometry.dialogBottom <= height + 0.5 && editGeometry.dialogLeft >= -0.5, `${width}px edit dialog must fit the dynamic viewport`);
      assert.ok(editGeometry.formScrollHeight > editGeometry.formClientHeight && editGeometry.formScrollTop > 0, `${width}px edit form must preserve its own scroll region`);
      assert.ok(editGeometry.footerTop >= editGeometry.dialogTop && editGeometry.footerBottom <= editGeometry.dialogBottom + 0.5, `${width}px edit footer must remain inside the dialog`);
      assert.ok(editGeometry.closeWidth >= 44 && editGeometry.closeHeight >= 44, `${width}px edit close must retain a 44px target`);
      assert.equal(editGeometry.actions.length, 2, `${width}px edit footer must retain cancel and save actions`);
      for (const action of editGeometry.actions) {
        assert.ok(action.width > 0 && action.height >= 44, `${width}px edit footer action must retain a 44px target`);
        assert.equal(action.hit, true, `${width}px edit footer action center must remain touchable`);
      }
      assert.equal(editGeometry.navigationPointerEvents, "none", `${width}px modal must block bottom navigation pointer input`);
      assert.equal(editGeometry.toastPointerEvents, "none", `${width}px modal must block toast pointer input`);
      await editContext.close();
    }
  } finally {
    await browser.close();
  }
});

const fullReleaseViewports = [
  { width: 280, height: 653 },
  { width: 320, height: 844 },
  { width: 344, height: 844 },
  { width: 390, height: 844 },
  { width: 412, height: 844 },
  { width: 768, height: 844 },
  { width: 1440, height: 844 },
];

function toastClearanceFixtureHtml(styles) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles.replaceAll("</style", "<\\/style")}</style></head><body>
    <section class="app-main"><main class="app-content"><div style="height:1000px" aria-hidden="true"></div><button type="button" data-last-release-action style="display:block;width:100%;min-height:48px">마지막 작업 계속</button></main></section>
    <div class="toast notice-info"><span class="toast-icon">!</span><span class="toast-copy"><b>진행 알림</b><span>마지막 작업을 가리지 않아야 합니다.</span></span><button type="button" data-toast-dismiss aria-label="알림 닫기">×</button></div>
    <nav class="mobile-bottom-nav"><button>대시보드</button><button>상품</button><button>등록</button><button>주문</button><button>CS</button></nav>
  </body></html>`;
}

function responsiveControlsFixtureHtml(styles) {
  const orderHeadings = ["선택", "주문번호", "채널", "구매자", "상품", "금액", "상태", "정산", "시간", "상세"];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles.replaceAll("</style", "<\\/style")}</style></head><body>
    <section class="app-main"><div class="app-header-stack"><div class="commerce-service-rail"><strong>통합 판매관리</strong><span>판매 데이터</span><span>운영 키</span><span>동기화</span><span>자동화</span></div><header class="topbar"><div class="topbar-title"><button class="mobile-menu-button" data-touch-target aria-label="메뉴">≡</button><div><h1>등록 진행 · 히스토리</h1></div></div><div class="topbar-actions"><button type="button" class="demo-data-badge"><b>실데이터</b><small>연결됨</small></button><button type="button" class="global-search" data-touch-target aria-label="검색">⌕</button><div class="notification-wrap"><button type="button" class="top-icon-button" data-touch-target aria-label="알림">!</button><div class="notification-popover"><div><h4>실시간 알림</h4><button type="button" data-touch-target>모두 닫기</button></div><div class="notification-item"><button type="button" class="notification-item-open" data-touch-target><span>!</span><span>상품 등록 상태</span></button><button type="button" class="notification-item-dismiss" data-touch-target aria-label="알림 하나 닫기">×</button></div></div></div><button type="button" class="user-menu" data-touch-target aria-label="계정"><span class="user-avatar">관</span></button></div></header></div>
      <section class="mobile-push-gate browser"><div class="mobile-push-gate-copy"><h2>주문 알림</h2></div><div class="mobile-push-gate-actions"><button type="button" data-touch-target>알림 허용</button></div></section><div class="mobile-push-chip"><span><b>주문 알림 사용 중</b></span><button type="button" data-touch-target>테스트</button><button type="button" class="mobile-push-chip-dismiss" data-touch-target aria-label="푸시 상태 닫기">×</button></div>
      <main class="app-content"><section class="panel sales-calendar-panel"><div class="sales-range-control"><div class="segmented-control"><button type="button" data-touch-target>일</button><button type="button" data-touch-target>주</button><button type="button" data-touch-target>월</button><button type="button" data-touch-target>연</button><button type="button" data-touch-target>직접</button></div></div><div class="sales-calendar-pager"><button type="button" data-touch-target>‹</button><span><b>2026년</b></span><button type="button" data-touch-target>›</button></div></section>
        <section class="panel upload-panel"><div class="option-slot-wrap"><div class="photo-source-actions compact"><label data-touch-target>촬영</label><label data-touch-target>앨범</label></div></div><div class="analysis-start-bar"><span>분석 준비</span><button type="button" data-touch-target>상품 분석 시작</button></div></section>
        <article class="panel registration-card"><button type="button" class="registration-card-inspect"><span>등록 작업 상세</span></button><footer><button type="button" class="credential-secondary" data-touch-target>등록 재시도</button></footer></article>
        <section class="product-detail-actions"><button type="button" class="credential-secondary" data-touch-target>목록</button><div><button type="button" class="primary-button" data-touch-target>전체 정보 수정</button></div></section>
        <section class="product-edit-dialog"><header><div><h2>상품 전체 정보 수정</h2></div><button type="button" data-touch-target aria-label="수정 닫기">×</button></header><form class="product-edit-form"><label><span>상품명</span><input data-touch-target value="상품명"></label><section class="product-revision-images"><div class="product-revision-main"><div class="product-revision-source-actions"><label data-touch-target>촬영</label><button type="button" data-touch-target>앨범</button></div></div><div class="product-revision-role-grid"><div><label>정면</label><button type="button" data-touch-target aria-label="사진 삭제">×</button></div></div><div class="product-revision-extras"><label data-touch-target>추가 사진</label></div></section></form><div></div><footer><button type="button" class="credential-secondary" data-touch-target>취소</button><button type="button" class="publish-execute" data-touch-target>저장</button></footer></section>
        <div class="table-wrap" data-order-table-wrap><table class="data-table order-table"><thead><tr>${orderHeadings.map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody><tr><td><input type="checkbox"></td><td><button type="button" class="order-detail-link">ORD-123456</button></td><td>11번가</td><td>고객</td><td><button type="button" class="order-product-button" data-touch-target>매우 긴 상품명</button></td><td>10,000원</td><td>결제완료</td><td>정산대기</td><td>오늘</td><td><button type="button" class="table-action">›</button></td></tr></tbody></table></div><div class="bulk-order-bar"><button type="button" data-touch-target>일괄 출고 처리</button></div>
        <fieldset class="shipment-draft-list"><article><label><span>택배사</span><input data-touch-target value="carrier"></label><label><span>참조 종류</span><select data-touch-target><option>PackingNo</option></select></label></article></fieldset>
        <section class="credential-modal"><header><div><h3>채널 연결</h3></div><button type="button" data-touch-target aria-label="연결 창 닫기">×</button></header><fieldset class="credential-form-grid"><label><span>API 키</span><span class="credential-input"><input data-touch-target value="masked"></span></label></fieldset><footer><button type="button" class="credential-secondary" data-touch-target>취소</button><button type="button" class="credential-primary" data-touch-target>저장</button></footer></section>
      </main></section><nav class="mobile-bottom-nav"><button>대시보드</button><button>상품</button><button>등록</button><button>주문</button><button>CS</button></nav>
  </body></html>`;
}

test("280 through 1440 release widths keep the last action above fixed toasts", { timeout: 90_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "release geometry test requires Chrome");
  const styles = (await Promise.all(cssUrls.map((url) => readFile(url, "utf8")))).join("\n");
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"] });
  try {
    for (const { width, height } of fullReleaseViewports) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: width <= 412 });
      const page = await context.newPage();
      await page.setContent(toastClearanceFixtureHtml(styles), { waitUntil: "load" });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      const geometry = await page.evaluate(() => {
        const action = document.querySelector("[data-last-release-action]");
        const toast = document.querySelector(".toast");
        const dismiss = document.querySelector("[data-toast-dismiss]");
        if (!(action instanceof HTMLElement) || !(toast instanceof HTMLElement) || !(dismiss instanceof HTMLElement)) throw new Error("toast fixture is incomplete");
        const actionBox = action.getBoundingClientRect();
        const toastBox = toast.getBoundingClientRect();
        const dismissBox = dismiss.getBoundingClientRect();
        const pointX = Math.max(actionBox.left + 1, Math.min(actionBox.right - 1, toastBox.left + toastBox.width / 2));
        const hit = document.elementFromPoint(pointX, actionBox.top + actionBox.height / 2);
        return { documentWidth: document.documentElement.scrollWidth, actionBottom: actionBox.bottom, toastTop: toastBox.top, dismissWidth: dismissBox.width, dismissHeight: dismissBox.height, hit: hit instanceof Element && Boolean(hit.closest("[data-last-release-action]")) };
      });
      assert.ok(geometry.documentWidth <= width, `${width}px toast fixture must not widen the document`);
      assert.ok(geometry.actionBottom <= geometry.toastTop + 0.5, `${width}px last action must settle above the fixed toast (${JSON.stringify(geometry)})`);
      assert.equal(geometry.hit, true, `${width}px last action must remain topmost while the toast is visible`);
      if (width <= 900) assert.ok(geometry.dismissWidth >= 43.5 && geometry.dismissHeight >= 43.5, `${width}px toast close must retain a 44px CSS target (${JSON.stringify(geometry)})`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("phone and tablet release widths preserve titles, order data and 44px controls", { timeout: 90_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "release geometry test requires Chrome");
  const styles = (await Promise.all(cssUrls.map((url) => readFile(url, "utf8")))).join("\n");
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"] });
  try {
    for (const { width, height } of fullReleaseViewports) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: width <= 412 });
      const page = await context.newPage();
      await page.setContent(responsiveControlsFixtureHtml(styles), { waitUntil: "load" });
      const geometry = await page.evaluate(() => {
        const title = document.querySelector(".topbar-title h1");
        const wrap = document.querySelector("[data-order-table-wrap]");
        if (!(title instanceof HTMLElement) || !(wrap instanceof HTMLElement)) throw new Error("release controls fixture is incomplete");
        wrap.scrollLeft = 100;
        const stickyWidths = [...document.querySelectorAll(".order-table tbody td")]
          .filter((cell) => getComputedStyle(cell).position === "sticky")
          .map((cell) => cell.getBoundingClientRect().width);
        const targets = [...document.querySelectorAll("[data-touch-target]")].map((target) => {
          const box = target.getBoundingClientRect();
          return { tag: target.tagName, className: target.className, width: box.width, height: box.height };
        });
        return { documentWidth: document.documentElement.scrollWidth, titleClientWidth: title.clientWidth, titleScrollWidth: title.scrollWidth, tableClientWidth: wrap.clientWidth, tableScrollWidth: wrap.scrollWidth, tableScrollLeft: wrap.scrollLeft, stickyWidth: stickyWidths.reduce((sum, value) => sum + value, 0), targets };
      });
      assert.ok(geometry.documentWidth <= width, `${width}px controls fixture must not widen the document`);
      if (width <= 412) assert.ok(geometry.titleClientWidth + 0.5 >= geometry.titleScrollWidth, `${width}px full workspace title must remain readable (${geometry.titleClientWidth}/${geometry.titleScrollWidth})`);
      if (width <= 900) {
        for (const target of geometry.targets) assert.ok(target.width >= 43.5 && target.height >= 43.5, `${width}px ${target.tag}.${target.className} must retain a 44px CSS target (${target.width}x${target.height})`);
        assert.ok(geometry.tableScrollWidth > geometry.tableClientWidth && geometry.tableScrollLeft > 0, `${width}px order ledger must remain horizontally scrollable`);
      }
      if (width <= 412) assert.ok(geometry.tableClientWidth - geometry.stickyWidth >= 100, `${width}px sticky order edges must leave at least 100px for central data (${geometry.tableClientWidth - geometry.stickyWidth}px)`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
