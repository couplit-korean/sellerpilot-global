import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { build } from "vite";

const repositoryRoot = new URL("../..", import.meta.url);

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
import { RegistrationWaitingActions } from "../../../app/_publishing/registration-waiting-actions.tsx";
import "../../../app/globals.css";
function Fixture() {
 const [accepted, setAccepted] = useState(false);
 const [events, setEvents] = useState([]);
 const record = (event) => () => setEvents((current) => [...current, event]);
 return <main className="publishing-page publishing-busy">
  <section>배경 입력 화면</section>
  <div className="publishing-busy-overlay"><div className="publishing-busy-card">
   <b>상품 작업 대기</b><button onClick={() => setAccepted(true)}>접수 확인</button>
   <RegistrationWaitingActions canLeaveWaiting={accepted} acceptedActivity={accepted} controllingActivity={false}
    onAdditional={record("additional")} onBack={record("back")} onHistory={record("history")} onStop={record("stop")} onDelete={record("delete")} />
   <output data-events>{JSON.stringify(events)}</output>
  </div></div>
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

test("대기 오버레이 안에서 추가 상품·이전 화면·진행상황·중지·삭제를 누를 수 있다", { timeout: 90_000 }, async () => {
 const executablePath = await firstExecutable([process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Aside.app/Contents/MacOS/Aside"]);
 assert.ok(executablePath, "browser executable required");
 const workspace = await mkdtemp(new URL("outputs/registration-waiting-test-", repositoryRoot).pathname);
 let server, browser;
 try {
  const output = await buildFixture(workspace);
  const serving = await serveFixture(output); server = serving.server;
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(serving.url);
  for (const name of ["추가 상품 등록", "이전 화면", "진행상황 보기", "중지", "삭제"]) assert.equal(await page.getByRole("button", { name, exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "접수 확인", exact: true }).click();
  for (const name of ["추가 상품 등록", "이전 화면", "진행상황 보기", "중지", "삭제"]) {
    const button = page.getByRole("button", { name, exact: true });
    assert.equal(await button.isEnabled(), true);
    await button.click();
  }
  assert.deepEqual(JSON.parse(await page.locator("[data-events]").textContent()), ["additional", "back", "history", "stop", "delete"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
 } finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(workspace, { recursive: true, force: true });
 }
});
