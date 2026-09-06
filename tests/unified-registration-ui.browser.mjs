import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { build } from "vite";

const repositoryRoot = new URL("..", import.meta.url);

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

function fixtureSource() {
  return `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChannelRegistrationFields } from "../../app/channel-registration-fields.tsx";
import { registrationPatches, setRegistrationValue } from "../../lib/channel-registration-form.ts";
import { restoreChannelRegistrationPatches } from "../../lib/publish-registration-draft.ts";
import "../../app/product-publish-workbench.css";

const initialDraft = {
  title: "자동 상품명",
  price: 0,
  requested: false,
  shipping: { fee: 0 },
  description: "사실에 근거한 상품 설명",
  facts: { noticeContent: { noticeCategoryName: "기타 재화", details: { "품명 및 모델명": "기존 머그", "제조국": "대한민국" } } },
  body: { items: [{ notices: [
    { noticeCategoryName: "기타 재화", noticeCategoryDetailName: "품명 및 모델명", content: "기존 머그" },
    { noticeCategoryName: "기타 재화", noticeCategoryDetailName: "제조국", content: "대한민국" },
  ] }] },
};
const requirements = [
  { key: "price", label: "판매가", source: "상품 정보", status: "manual", manualPath: ["price"], inputType: "number", help: "0을 빈 값으로 바꾸지 않습니다." },
  { key: "requested", label: "승인 요청", source: "상품 정보", status: "manual", manualPath: ["requested"], inputType: "boolean", help: "아니요도 명시적인 값입니다." },
  { key: "shipping-fee", label: "배송비", source: "상품 정보", status: "manual", manualPath: ["shipping", "fee"], inputType: "number" },
  { key: "account", label: "계정 정책", source: "판매자 계정", status: "runtime", help: "등록 전에 운영 계정에서 조회합니다." },
];

function Fixture() {
  const [draft, setDraft] = useState(initialDraft);
  const [editedPaths, setEditedPaths] = useState([]);
  const [savedPatches, setSavedPatches] = useState([]);
  return <main data-fixture>
    <ChannelRegistrationFields
      channel="coupang"
      draft={draft}
      requirements={requirements}
      editedPaths={editedPaths}
      onChange={(path, value) => {
        setDraft((current) => setRegistrationValue(current, path, value));
        setEditedPaths((current) => [...new Set([...current, JSON.stringify(path)])]);
      }}
    />
    <div data-draft-controls>
      <button type="button" onClick={() => setSavedPatches(registrationPatches(initialDraft, draft))}>초안 변경 저장</button>
      <button type="button" onClick={() => setDraft(structuredClone(initialDraft))}>초안 원본 복원</button>
      <button type="button" onClick={() => setDraft(restoreChannelRegistrationPatches(initialDraft, savedPatches))}>저장 초안 복원</button>
    </div>
    <output data-registration-state>{JSON.stringify(draft)}</output>
    <output data-registration-patches>{JSON.stringify(savedPatches)}</output>
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture />);
`;
}

async function buildFixture(workspace) {
  const fixtureRoot = join(workspace, "fixture");
  const output = join(workspace, "dist");
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(join(fixtureRoot, "index.html"), '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./src.tsx"></script></body></html>');
  await writeFile(join(fixtureRoot, "src.tsx"), fixtureSource());
  await build({
    root: fixtureRoot,
    base: "./",
    logLevel: "silent",
    build: { outDir: output, emptyOutDir: true },
  });
  return output;
}

async function serveFixture(output) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture.local").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relativePath.includes("..")) {
      response.writeHead(400).end();
      return;
    }
    void readFile(join(output, relativePath)).then((content) => {
      const contentType = relativePath.endsWith(".js") ? "text/javascript"
        : relativePath.endsWith(".css") ? "text/css"
          : "text/html; charset=utf-8";
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" }).end(content);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not expose a local port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function draftState(page) {
  return JSON.parse(await page.locator("[data-registration-state]").textContent());
}

async function savedPatches(page) {
  return JSON.parse(await page.locator("[data-registration-patches]").textContent());
}

test("통합 등록 실제 React 폼은 필터·검색과 false/0 및 쿠팡 고시 편집을 보존한다", { timeout: 90_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "compiled registration UI test requires a local Chrome executable");

  const workspace = await mkdtemp(join(new URL(".", repositoryRoot).pathname, ".tmp-unified-registration-ui-"));
  const profile = await mkdtemp(join(tmpdir(), "sellerpilot-registration-profile-"));
  let context;
  let server;
  try {
    const output = await buildFixture(workspace);
    const fixture = await serveFixture(output);
    server = fixture.server;
    context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"],
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.route(/^https?:\/\//, (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "127.0.0.1" || host === "localhost") void route.continue();
      else void route.abort();
    });
    await page.goto(fixture.url, { waitUntil: "load" });

    const desktopGeometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      columns: getComputedStyle(document.querySelector(".registration-field-grid")).gridTemplateColumns.split(" ").filter(Boolean).length,
    }));
    assert.equal(desktopGeometry.documentWidth <= desktopGeometry.viewportWidth, true, "desktop form must not overflow horizontally");
    assert.equal(desktopGeometry.columns, 2, "desktop form should use the two-column review layout");

    const reviewLabels = await page.locator(".registration-field-title b").allTextContents();
    assert.ok(reviewLabels.includes("판매가"), JSON.stringify(reviewLabels));
    assert.ok(reviewLabels.includes("승인 요청"));
    assert.ok(reviewLabels.includes("배송비"));
    assert.equal(reviewLabels.includes("상품명"), false, "optional automatic fields stay out of review view");
    assert.equal(await page.getByLabel("승인 요청").inputValue(), "false", "boolean false is not rendered as blank");
    assert.equal(await page.getByLabel("판매가").inputValue(), "0", "numeric zero is not rendered as blank");
    assert.equal(await page.getByLabel("배송비").inputValue(), "0", "nested numeric zero is not rendered as blank");

    await page.getByRole("button", { name: /^전체 항목/ }).click();
    assert.equal(await page.getByLabel("상품명").inputValue(), "자동 상품명");
    await page.getByPlaceholder("상품명, 배송비, 고시…").fill("상품명");
    assert.deepEqual(await page.locator(".registration-field-title b").allTextContents(), ["상품명"]);
    await page.getByPlaceholder("상품명, 배송비, 고시…").fill("");

    await page.getByLabel("승인 요청").selectOption("true");
    await page.getByLabel("승인 요청").selectOption("false");
    await page.getByLabel("판매가").fill("15");
    await page.getByLabel("판매가").fill("0");
    let state = await draftState(page);
    assert.equal(state.requested, false);
    assert.equal(state.price, 0);

    const notice = page.locator(".registration-notice-form");
    await assert.doesNotReject(() => notice.waitFor({ state: "visible" }));
    assert.equal(await notice.getByLabel("고시 상품군").inputValue(), "기타 재화");
    assert.equal(await notice.locator(".registration-notice-row").count(), 2, "native Coupang notices use the structured editor");
    await notice.getByLabel("확인한 내용").first().fill("화이트 세라믹 머그");
    state = await draftState(page);
    assert.equal(state.body.items[0].notices[0].content, "화이트 세라믹 머그");
    assert.deepEqual(state.facts.noticeContent.details, { "품명 및 모델명": "화이트 세라믹 머그", "제조국": "대한민국" }, "native edits keep the compatibility envelope synchronized");
    assert.equal(await notice.locator("textarea").count(), 2, "notice content uses one structured textarea per item rather than a raw JSON textarea");

    await notice.getByLabel("고시 항목명").nth(1).fill("품명 및 모델명");
    await assert.doesNotReject(() => notice.getByRole("alert").waitFor({ state: "visible" }));
    assert.match(await notice.getByRole("alert").textContent(), /같을 수 없습니다/);
    assert.equal(await notice.getByLabel("고시 항목명").nth(1).inputValue(), "제조국", "a duplicate rename keeps the previous item name");
    state = await draftState(page);
    assert.deepEqual(state.body.items[0].notices.map((row) => row.noticeCategoryDetailName), ["품명 및 모델명", "제조국"], "a rejected duplicate rename cannot collapse a notice row");

    await notice.getByRole("button", { name: "품명 및 모델명 항목 삭제" }).click();
    await notice.getByRole("button", { name: "제조국 항목 삭제" }).click();
    state = await draftState(page);
    assert.deepEqual(state.body.items[0].notices, [], "deleting the final native notice stores an explicit empty array");
    assert.deepEqual(state.facts.noticeContent.details, {}, "deleting the final native notice clears the synchronized envelope");

    await page.getByRole("button", { name: "초안 변경 저장" }).click();
    const patches = await savedPatches(page);
    assert.ok(patches.some((patch) => JSON.stringify(patch.path) === JSON.stringify(["body", "items"])), "saved patches include the atomic native notices array");
    assert.ok(patches.some((patch) => JSON.stringify(patch.path) === JSON.stringify(["facts", "noticeContent", "details"]) && JSON.stringify(patch.value) === "{}"), "saved patches preserve the synchronized empty notice object");
    await page.getByRole("button", { name: "초안 원본 복원" }).click();
    assert.equal(await notice.locator(".registration-notice-row").count(), 2);
    await page.getByRole("button", { name: "저장 초안 복원" }).click();
    state = await draftState(page);
    assert.deepEqual(state.body.items[0].notices, [], "restoring saved patches preserves an explicit empty native notice array");
    assert.equal(await notice.locator(".registration-notice-row").count(), 0, "an empty native notice array remains authoritative after restore");

    await page.getByRole("button", { name: "초안 원본 복원" }).click();
    assert.equal(await notice.locator(".registration-notice-row").count(), 2, "screenshots exercise the populated native notice editor");
    const screenshotDirectory = join(tmpdir(), "sellerpilot-unified-registration-ui");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator(".registration-channel-form").screenshot({ path: join(screenshotDirectory, "desktop.png") });

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const geometry = await page.evaluate(() => {
        const controls = [...document.querySelectorAll(".registration-channel-form input,.registration-channel-form select,.registration-channel-form textarea")];
        const boxes = [...document.querySelectorAll(".registration-channel-form,.registration-form-toolbar,.registration-field,.registration-notice-form,.registration-notice-row")].map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right };
        });
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          columns: getComputedStyle(document.querySelector(".registration-field-grid")).gridTemplateColumns.split(" ").filter(Boolean).length,
          boxes,
          labels: controls.map((control) => ({ id: control.id, labels: control.labels?.length ?? 0 })),
        };
      });
      assert.equal(geometry.documentWidth <= geometry.viewportWidth, true, `${width}px viewport must not overflow horizontally`);
      assert.equal(geometry.columns, 1, `${width}px field grid must be a single column`);
      for (const box of geometry.boxes) {
        assert.ok(box.left >= -0.5 && box.right <= width + 0.5, `${width}px form element escapes viewport: ${JSON.stringify(box)}`);
      }
      for (const control of geometry.labels) assert.ok(control.labels > 0, `${width}px control lacks an associated label: ${control.id}`);
      await page.locator(".registration-channel-form").screenshot({ path: join(screenshotDirectory, `mobile-${width}.png`) });
    }
  } finally {
    await context?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await Promise.all([rm(profile, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })]);
  }
});
