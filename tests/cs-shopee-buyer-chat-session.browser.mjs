import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import ts from "typescript";
import { createServer } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const componentPath = `${repoRoot}/app/cs/channels/shopee/buyer-chat-status.tsx`;
const virtualId = "virtual:shopee-buyer-chat-session-03";
const resolvedVirtualId = `\0${virtualId}.tsx`;

async function firstExecutable(paths) {
  for (const candidate of paths) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* try the next local browser */ }
  }
  return null;
}

function status(session, shops) {
  const anyApproved = shops.some(shop => shop.ledgerPermissionState === "page_evidence_approved");
  return {
    contract: "sellerpilot-shopee-buyer-chat-status/1",
    checkedAt: "2026-09-09T21:00:00.000Z",
    ledgerPermissionState: anyApproved ? "page_evidence_approved" : "permission_pending",
    ledgerPermissionReason: anyApproved ? "approved_page_evidence" : "credential_unavailable",
    operationalReceive: false,
    automaticHistoryCollection: false,
    storedHistory: shops.some(shop => shop.storedHistory),
    reply: false,
    shops,
    transport: {
      state: "verified_push_receiver_implemented",
      trustedIngestEntrypoint: true,
      providerNetworkAdapter: true,
      automaticReads: false,
      webhookReceiver: true,
      reply: false,
    },
  };
}

function shop(session, suffix, messages, nextCursor = null, push = {}) {
  return {
    credentialId: session === "A"
      ? "00000000-0000-4000-8000-000000081001"
      : "00000000-0000-4000-8000-000000082001",
    shopId: session === "A" ? `18100000${suffix}` : `18200000${suffix}`,
    ledgerPermissionState: "page_evidence_approved",
    storedHistory: messages.length > 0,
    conversationCount: messages.length > 0 ? 1 : 0,
    messages: messages.map((body, index) => ({
      shopId: session === "A" ? `18100000${suffix}` : `18200000${suffix}`,
      conversationId: `conversation_${suffix}`,
      messageId: `${session.toLowerCase()}_${suffix}_${body.replaceAll(" ", "_")}`,
      identityDigest: `${session === "A" ? "a" : "b"}${suffix}${String(index)}${body.length.toString(16)}`.padEnd(64, "0"),
      senderRole: "buyer",
      body,
      bodyFingerprint: `${session === "A" ? "c" : "d"}${suffix}${String(index)}${body.length.toString(16)}`.padEnd(64, "0"),
      sentAt: `2026-09-09T20:00:0${index}.000Z`,
      orderSn: null,
      itemId: null,
      attachmentCount: 0,
      media: null,
    })),
    nextCursor,
    push: {
      credentialId: session === "A"
        ? "00000000-0000-4000-8000-000000081001"
        : "00000000-0000-4000-8000-000000082001",
      shopId: session === "A" ? `18100000${suffix}` : `18200000${suffix}`,
      receiverImplemented: true,
      credentialCurrent: true,
      entitlementCurrent: true,
      verifiedReceipt: false,
      lastVerifiedReceivedAt: null,
      currentConnectionVerified: false,
      ...push,
    },
  };
}

const harnessSource = `
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ShopeeBuyerChatStatus } from ${JSON.stringify(`/@fs/${componentPath}`)};

const requests = [];
let abortCount = 0;
function fetchFor(session) {
  return (input, init = {}) => new Promise((resolve, reject) => {
    const request = { session, input, signal: init.signal, settled: false, resolve, reject };
    requests.push(request);
    init.signal?.addEventListener("abort", () => { abortCount += 1; }, { once: true });
  });
}
function App() {
  const [session, setSession] = useState("A");
  const [mounted, setMounted] = useState(true);
  const authenticatedFetch = useMemo(() => fetchFor(session), [session]);
  return <>
    <p id="active-session">session {session}</p>
    <button id="session-a" onClick={() => setSession("A")}>session A</button>
    <button id="session-b" onClick={() => setSession("B")}>session B</button>
    <button id="unmount" onClick={() => setMounted(false)}>unmount</button>
    <button id="mount" onClick={() => setMounted(true)}>mount</button>
    {mounted ? <ShopeeBuyerChatStatus authenticatedFetch={authenticatedFetch} /> : null}
  </>;
}
window.__session03 = {
  requests,
  get abortCount() { return abortCount; },
  resolve(session, payload) {
    const request = requests.find(item => item.session === session && !item.settled);
    if (!request) throw new Error("missing request for " + session);
    request.settled = true;
    request.resolve(new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    }));
  },
  reject(session, message) {
    const request = requests.find(item => item.session === session && !item.settled);
    if (!request) throw new Error("missing request for " + session);
    request.settled = true;
    request.reject(new Error(message));
  },
};
createRoot(document.getElementById("root")).render(<App />);
`;

async function createHarnessServer() {
  const server = await createServer({
    root: repoRoot,
    logLevel: "error",
    cacheDir: `${repoRoot}/.local/vite-shopee-buyer-chat-session`,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    resolve: { dedupe: ["react", "react-dom"] },
    plugins: [{
      name: "shopee-buyer-chat-session-03",
      resolveId(id) { return id === virtualId ? resolvedVirtualId : null; },
      load(id) {
        if (id !== resolvedVirtualId) return null;
        return ts.transpileModule(harnessSource, {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__shopee_session_03__") return next();
          const html = await vite.transformIndexHtml(request.url,
            `<!doctype html><html><body><div id="root"></div><script type="module">import ${JSON.stringify(virtualId)};</script></body></html>`);
          response.statusCode = 200;
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(html);
        });
      },
    }],
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}/__shopee_session_03__` };
}

async function openPanel(page) {
  await page.locator("summary").click();
  await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).waitFor();
}

async function waitForRequests(page, count) {
  await page.waitForFunction(expected => window.__session03.requests.length >= expected, count);
}

test("mounted Buyer Chat status isolates authenticated sessions and pending operations", async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]);
  assert.ok(executablePath, "SESSION-03 browser test requires a local Chromium executable");
  const { server, url } = await createHarnessServer();
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(url);
    await openPanel(page);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 1);
    await page.evaluate(payload => window.__session03.resolve("A", payload),
      status("A", [shop("A", "1", ["A loaded message"], "a-more", {
        verifiedReceipt: true,
        lastVerifiedReceivedAt: "2026-09-09T20:30:00.000Z",
      })]));
    await page.getByText("A loaded message").waitFor();
    await page.getByText("2026-09-09T20:30:00.000Z").waitFor();
    await page.locator("#session-b").click();
    await assert.doesNotReject(() => page.getByText("A loaded message").waitFor({ state: "detached" }));
    assert.equal(await page.getByText("2026-09-09T20:30:00.000Z").count(), 0);
    assert.equal(await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).isEnabled(), true);

    await page.reload();
    await openPanel(page);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 1);
    await page.locator("#session-b").click();
    assert.equal(await page.evaluate(() => window.__session03.abortCount), 1);
    assert.equal(await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).isEnabled(), true);
    await page.evaluate(payload => window.__session03.resolve("A", payload),
      status("A", [shop("A", "1", ["late A first page"])]));
    await page.waitForTimeout(25);
    assert.equal(await page.getByText("late A first page").count(), 0);
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 2);
    await page.evaluate(payload => window.__session03.resolve("B", payload),
      status("B", [shop("B", "1", ["B current message"])]));
    await page.getByText("B current message").waitFor();

    await page.reload();
    await openPanel(page);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 1);
    await page.evaluate(payload => window.__session03.resolve("A", payload),
      status("A", [shop("A", "1", ["A current page"], "a-next")]));
    await page.getByText("A current page").waitFor();
    await page.getByRole("button", { name: "이 shop 추가 이력 불러오기" }).click();
    await waitForRequests(page, 2);
    await page.locator("#session-b").click();
    assert.equal(await page.getByText("A current page").count(), 0);
    assert.equal(await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).isEnabled(), true);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 3);
    await page.evaluate(payload => window.__session03.resolve("B", payload),
      status("B", [shop("B", "1", ["B survives old load more"])]));
    await page.getByText("B survives old load more").waitFor();
    await page.evaluate(payload => window.__session03.resolve("A", payload),
      status("A", [shop("A", "1", ["late A older page"])]));
    await page.waitForTimeout(25);
    assert.equal(await page.getByText("late A older page").count(), 0);
    assert.equal(await page.getByText("B survives old load more").count(), 1);
    assert.equal(await page.getByRole("alert").count(), 0);

    await page.reload();
    await openPanel(page);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 1);
    await page.locator("#session-b").click();
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 2);
    await page.evaluate(payload => window.__session03.resolve("B", payload),
      status("B", [shop("B", "1", ["B before late error"])]));
    await page.getByText("B before late error").waitFor();
    await page.evaluate(() => window.__session03.reject("A", "late A error"));
    await page.waitForTimeout(25);
    assert.equal(await page.getByText("B before late error").count(), 1);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).isEnabled(), true);

    await page.reload();
    await openPanel(page);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 1);
    await page.locator("#unmount").click();
    assert.equal(await page.locator("summary").count(), 0);
    assert.equal(await page.evaluate(() => window.__session03.abortCount), 1);
    await page.evaluate(payload => window.__session03.resolve("A", payload),
      status("A", [shop("A", "1", ["late after unmount"])]));
    await page.locator("#mount").click();
    await openPanel(page);
    assert.equal(await page.getByText("late after unmount").count(), 0);
    assert.equal(await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).isEnabled(), true);

    await page.reload();
    await page.locator("#session-b").click();
    await openPanel(page);
    await page.getByRole("button", { name: "Buyer Chat 상태·저장 이력 새로고침" }).click();
    await waitForRequests(page, 1);
    await page.evaluate(payload => window.__session03.resolve("B", payload), status("B", [
      shop("B", "1", ["B shop one current"], "b-one-next"),
      shop("B", "2", ["B shop two preserved"]),
    ]));
    await page.getByText("B shop one current").waitFor();
    const firstShop = page.locator("article").filter({ hasText: "shop 182000001" });
    await firstShop.getByRole("button", { name: "이 shop 추가 이력 불러오기" }).click();
    await waitForRequests(page, 2);
    await page.evaluate(payload => window.__session03.resolve("B", payload),
      status("B", [shop("B", "1", ["B shop one older"])]));
    await page.getByText("B shop one older").waitFor();
    assert.equal(await page.getByText("B shop one current").count(), 1);
    assert.equal(await page.getByText("B shop two preserved").count(), 1);
    assert.equal(await page.locator("article").count(), 2);
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }
});
