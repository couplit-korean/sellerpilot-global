import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { z } from "zod";
import { chromium, type Browser } from "playwright-core";
import { build } from "vite";
import {
  createLazadaProductReviewReplyMemoryStore,
  createLazadaProductReviewReplyUiWorkflow,
  lazadaProductReviewReplyCapabilitySchema,
} from "../lib/cs/channels/lazada/product-review-reply-ui";
import * as replyContracts from "../lib/cs/channels/lazada/product-review-reply";
import * as replyUiContracts from "../lib/cs/channels/lazada/product-review-reply-ui";
import type { LazadaSupplementalStoredEvent } from "../lib/cs/channels/lazada/supplemental-contract";

const composerSource = await readFile(new URL(
  "../app/cs/channels/lazada/product-review-reply-composer.tsx", import.meta.url,
), "utf8");

function loadComposer() {
  const compiled = ts.transpileModule(composerSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({ module: moduleRecord, exports: moduleRecord.exports, window: undefined,
    require: (name: string) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name.endsWith("/product-review-reply-ui")) return replyUiContracts;
      if (name.endsWith(".module.css")) return new Proxy({}, { get: (_target, key) => String(key) });
      throw new Error(`unexpected composer import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  return moduleRecord.exports as {
    LazadaProductReviewReplyComposer: React.ComponentType<Record<string, unknown>>;
    lazadaProductReviewReplySelectionFromEvent(event: LazadaSupplementalStoredEvent): typeof selection | null;
  };
}

const credentialId = "00000000-0000-4000-8000-000000008101";
const deliveryId = "00000000-0000-4000-8000-000000008102";
const jobId = "00000000-0000-4000-8000-000000008103";
const viewerId = "00000000-0000-4000-8000-000000008104";
const selection = {
  credentialId,
  country: "MY" as const,
  reviewId: "11111111111",
  generation: 1788991200000,
  eventKey: "a".repeat(64),
};

function prepared(status: "prepared" | "queued" | "running" | "readback_required" | "verified" | "failed" = "queued") {
  return {
    contract: "sellerpilot-lazada-product-review-reply-prepare/1",
    deliveryId, credentialId, country: "MY", sellerAccountKey: "b".repeat(64),
    reviewId: selection.reviewId, generation: selection.generation,
    identityFingerprint: "c".repeat(64), status, replayed: false,
    providerMutationPerformed: false,
  };
}

function submission(status: "queued" | "running" | "readback_required" | "verified" | "failed" = "queued") {
  return { submission: {
    contract: "sellerpilot-lazada-product-review-reply-submit/1",
    prepared: prepared(status),
    enqueue: { contract: "sellerpilot-lazada-product-review-reply-enqueue/1", deliveryId, jobId,
      status, replayed: false, providerMutationPerformed: false, automaticResendAllowed: false },
    providerMutationPerformed: false, automaticResendAllowed: false,
  } };
}

function status(value: "queued" | "running" | "readback_required" | "verified" | "failed") {
  return { delivery: {
    contract: "sellerpilot-lazada-product-review-reply-status/1", deliveryId, credentialId,
    country: "MY", reviewId: selection.reviewId, generation: selection.generation, status: value,
    gatewayJobId: jobId, readbackJobId: value === "verified" ? jobId : null, revision: 1,
    providerReadbackVerified: value === "verified", automaticResendAllowed: false,
  } };
}

test("response loss keeps one exact body and never silently coalesces a changed double-click", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let postAttempt = 0;
  const fetcher = async (input: string, init?: RequestInit) => {
    calls.push({ input, init });
    if (init?.method === "POST") {
      postAttempt += 1;
      if (postAttempt === 1) { await gate; throw new Error("response lost after commit"); }
      return Response.json(submission());
    }
    return Response.json(status("queued"));
  };
  const store = createLazadaProductReviewReplyMemoryStore();
  const workflow = createLazadaProductReviewReplyUiWorkflow(fetcher, store);
  workflow.activate(selection);
  const first = workflow.submit(selection, "Thank you.");
  assert.equal(workflow.submit(selection, "Thank you."), first);
  await assert.rejects(workflow.submit(selection, "Changed body"), /PENDING_BODY_CONFLICT/u);
  release();
  await assert.rejects(first, /response lost after commit/u);
  assert.equal(workflow.pending(selection)?.outcomeUnknown, true);
  await assert.rejects(workflow.submit(selection, "Changed body"), /PENDING_BODY_CONFLICT/u);
  const recovered = await workflow.submit(selection, "Thank you.");
  assert.equal(recovered.status, "applied");
  assert.equal(workflow.pending(selection)?.status, "queued");
  assert.equal(calls.filter((call) => call.init?.method === "POST").length, 2);
  assert.equal(calls.filter((call) => call.init?.method === "GET").length, 1);
  const bodies = calls.filter((call) => call.init?.method === "POST").map((call) => call.init?.body);
  assert.deepEqual(bodies, [bodies[0], bodies[0]]);
});

test("definitive permission and conflict responses clear poisoned retry state", async () => {
  for (const code of [403, 409]) {
    let attempt = 0;
    const store = createLazadaProductReviewReplyMemoryStore();
    const workflow = createLazadaProductReviewReplyUiWorkflow(async (input, init) => {
      if (init?.method === "POST" && attempt++ === 0) return Response.json({}, { status: code });
      if (init?.method === "POST") return Response.json(submission());
      return Response.json(status("queued"));
    }, store);
    workflow.activate(selection);
    await assert.rejects(workflow.submit(selection, "first"), code === 403 ? /PERMISSION_REQUIRED/u : /CONFLICT/u);
    assert.equal(workflow.pending(selection), null);
    const corrected = await workflow.submit(selection, "corrected");
    assert.equal(corrected.status, "applied");
  }
});

test("full composer selection is projected to the exact two-field capability request", async () => {
  const calls: string[] = [];
  const capability = await replyUiContracts.fetchLazadaProductReviewReplyCapability(async (input) => {
    calls.push(input);
    return Response.json({ capability: {
      contract: "sellerpilot-lazada-product-review-reply-capability/1", credentialId, country: "MY",
      permissionState: "authorized", viewerId, replyPath: "/review/seller/reply/add",
      readbackPath: "/review/seller/list/v2", automaticReplyEnabled: false,
    } });
  }, selection);
  assert.equal(capability.permissionState, "authorized");
  assert.deepEqual(calls, [
    `/api/admin/cs/channels/lazada/product-review/reply?credentialId=${credentialId}&country=MY`,
  ]);
});

test("late old failure and success cannot clear or overwrite a remounted workflow owner", async () => {
  for (const lateResult of ["failure", "success"] as const) {
    const store = createLazadaProductReviewReplyMemoryStore();
    let release!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    const old = createLazadaProductReviewReplyUiWorkflow(async () => gate, store);
    old.activate(selection);
    const waiting = old.submit(selection, "Thank you.").catch(() => null);
    old.activate(null);

    const fresh = createLazadaProductReviewReplyUiWorkflow(async (_input, init) =>
      Response.json(init?.method === "POST" ? submission() : status("queued")), store);
    fresh.activate(selection);
    const current = await fresh.submit(selection, "Thank you.");
    assert.equal(current.status, "applied");
    const freshOwner = fresh.pending(selection)?.ownerId;
    assert.equal(fresh.pending(selection)?.deliveryId, deliveryId);

    release(lateResult === "failure" ? Response.json({}, { status: 403 }) : Response.json(submission()));
    await waiting;
    assert.equal(fresh.pending(selection)?.deliveryId, deliveryId);
    assert.equal(fresh.pending(selection)?.ownerId, freshOwner);
    assert.equal(fresh.pending(selection)?.outcomeUnknown, false);
  }
});

test("readback is one explicit PUT and verification needs a later explicit refresh", async () => {
  const calls: Array<{ input: string; method: string }> = [];
  let nextStatus: "readback_required" | "verified" = "readback_required";
  const workflow = createLazadaProductReviewReplyUiWorkflow(async (input, init) => {
    calls.push({ input, method: init?.method ?? "GET" });
    if (init?.method === "POST") return Response.json(submission("readback_required"));
    if (init?.method === "PUT") return Response.json({ readback: { status: "queued" } }, { status: 202 });
    return Response.json(status(nextStatus));
  }, createLazadaProductReviewReplyMemoryStore());
  workflow.activate(selection);
  const submitted = await workflow.submit(selection, "Thank you.");
  assert.equal(submitted.status, "applied");
  assert.equal(submitted.pending.status, "readback_required");
  const before = calls.length;
  await workflow.requestReadback(selection);
  assert.deepEqual(calls.slice(before).map((call) => call.method), ["PUT"]);
  assert.equal(workflow.pending(selection)?.status, "readback_required");
  nextStatus = "verified";
  const verified = await workflow.refresh(selection);
  assert.equal(verified.status, "applied");
  assert.equal(verified.pending.status, "verified");
  assert.equal(calls.at(-1)?.method, "GET");
});

test("composer derives the immutable event generation and renders fail-closed before capability readback", () => {
  const { LazadaProductReviewReplyComposer, lazadaProductReviewReplySelectionFromEvent } = loadComposer();
  const event: LazadaSupplementalStoredEvent = {
    credentialId, country: "MY", surface: "product_review", sourcePath: "/review/seller/list",
    resourceKey: selection.reviewId, eventKey: selection.eventKey, status: "published",
    title: "상품 리뷰 · 평점 5", body: "good", externalOrderId: null, externalItemId: "22222222222",
    rating: 5, occurredAt: "2026-09-09T21:00:00.000Z", observedAt: "2026-09-09T22:00:00.000Z",
    providerContext: { reviewId: selection.reviewId, itemId: "22222222222" },
  };
  assert.deepEqual(lazadaProductReviewReplySelectionFromEvent(event), selection);
  const html = renderToStaticMarkup(createElement(LazadaProductReviewReplyComposer, {
    event, authenticatedFetch: async () => { throw new Error("effects do not run on SSR"); },
  }));
  assert.match(html, /정확한 계정·국가 답글 권한 확인 중/u);
  assert.match(html, /disabled="" data-lazada-product-review-reply-submit="true"/u);
  assert.match(html, /자동 답글 및 자동 재전송 비활성/u);
  assert.doesNotMatch(html, /전송 완료/u);
  assert.equal(lazadaProductReviewReplySelectionFromEvent({ ...event, resourceKey: "legacy-review",
    providerContext: { reviewId: "legacy-review" } }), null);
});

async function firstBrowserExecutable(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* Continue. */ }
  }
  return null;
}

function mountedComposerFixtureSource() {
  return `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LazadaProductReviewReplyComposer } from "../app/cs/channels/lazada/product-review-reply-composer.tsx";

const credentialId = "00000000-0000-4000-8000-000000008101";
const deliveryId = "00000000-0000-4000-8000-000000008102";
const jobId = "00000000-0000-4000-8000-000000008103";
const calls = [];
let resolveB;
const eventA = {
  credentialId, country: "MY", surface: "product_review", sourcePath: "/review/seller/list",
  resourceKey: "11111111111", eventKey: "${"a".repeat(64)}", status: "published",
  title: "상품 리뷰 · 평점 5", body: "good", externalOrderId: null, externalItemId: "33333333333",
  rating: 5, occurredAt: "2026-09-09T21:00:00.000Z", observedAt: "2026-09-09T22:00:00.000Z",
  providerContext: { reviewId: "11111111111", itemId: "33333333333" },
};
const eventB = {
  ...eventA, country: "SG", resourceKey: "22222222222", eventKey: "${"b".repeat(64)}",
  observedAt: "2026-09-09T22:00:01.000Z", providerContext: { reviewId: "22222222222", itemId: "44444444444" },
};

function capability(country, permissionState) {
  return { capability: { contract: "sellerpilot-lazada-product-review-reply-capability/1",
    credentialId, country, permissionState, viewerId: ${JSON.stringify(viewerId)}, replyPath: "/review/seller/reply/add",
    readbackPath: "/review/seller/list/v2", automaticReplyEnabled: false } };
}

function fetcherFor(session) {
  return async (input, init = {}) => {
    const method = init.method || "GET";
    calls.push({ session, input: String(input), method, body: init.body || "" });
    if (method === "GET" && String(input).includes("credentialId=")) {
      if (session === "B") return new Promise((resolve) => { resolveB = resolve; });
      return Response.json(capability("MY", "authorized"));
    }
    if (method === "POST") {
      const request = JSON.parse(init.body);
      const prepared = { contract: "sellerpilot-lazada-product-review-reply-prepare/1", deliveryId,
        credentialId, country: request.country, sellerAccountKey: "${"c".repeat(64)}",
        reviewId: request.reviewId, generation: request.generation, identityFingerprint: "${"d".repeat(64)}",
        status: "queued", replayed: false, providerMutationPerformed: false };
      return Response.json({ submission: { contract: "sellerpilot-lazada-product-review-reply-submit/1",
        prepared, enqueue: { contract: "sellerpilot-lazada-product-review-reply-enqueue/1", deliveryId,
          jobId, status: "queued", replayed: false, providerMutationPerformed: false,
          automaticResendAllowed: false }, providerMutationPerformed: false, automaticResendAllowed: false } });
    }
    if (method === "GET" && String(input).includes("deliveryId=")) {
      return Response.json({ delivery: { contract: "sellerpilot-lazada-product-review-reply-status/1",
        deliveryId, credentialId, country: "MY", reviewId: "11111111111", generation: 1788991200000,
        status: "queued", gatewayJobId: jobId, readbackJobId: null, revision: 1,
        providerReadbackVerified: false, automaticResendAllowed: false } });
    }
    throw new Error("unexpected fixture request " + method + " " + input);
  };
}
const fetchA = fetcherFor("A");
const fetchB = fetcherFor("B");

function Fixture() {
  const [session, setSession] = useState("A");
  globalThis.testHarness = {
    switchSession: setSession,
    resolveB() { resolveB(Response.json(capability("SG", "permission_pending"))); },
    calls: () => calls.slice(),
  };
  return <main data-session={session}>
    <LazadaProductReviewReplyComposer event={session === "A" ? eventA : eventB}
      authenticatedFetch={session === "A" ? fetchA : fetchB} />
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture />);
`;
}

async function serveFixture(output: string) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture.local").pathname);
    if (pathname === "/favicon.ico") return void response.writeHead(204).end();
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relativePath.includes("..")) return void response.writeHead(400).end();
    void readFile(join(output, relativePath)).then((content) => {
      response.writeHead(200, { "content-type": relativePath.endsWith(".js")
        ? "text/javascript" : "text/html; charset=utf-8" }).end(content);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server port unavailable");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

test("mounted composer performs permission GET, submit POST and status GET then resets on selection and fetcher change", {
  timeout: 90_000,
}, async () => {
  const executablePath = await firstBrowserExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
  ]);
  assert.ok(executablePath, "mounted composer test requires local Chrome");
  const repositoryRoot = new URL("..", import.meta.url).pathname;
  const workspace = await mkdtemp(join(repositoryRoot, ".tmp-lazada-reply-composer-"));
  let browser: Browser | undefined;
  let server: Server | undefined;
  try {
    await mkdir(join(workspace, "dist"), { recursive: true });
    await writeFile(join(workspace, "index.html"),
      '<!doctype html><html lang="ko"><body><div id="root"></div><script type="module" src="./src.tsx"></script></body></html>');
    await writeFile(join(workspace, "src.tsx"), mountedComposerFixtureSource());
    await build({ root: workspace, base: "./", logLevel: "silent",
      build: { outDir: join(workspace, "dist"), emptyOutDir: true } });
    const fixture = await serveFixture(join(workspace, "dist"));
    server = fixture.server;
    browser = await chromium.launch({ executablePath, headless: true,
      args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"] });
    const page = await browser.newPage();
    const browserErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    await page.goto(fixture.url, { waitUntil: "load" });
    await page.getByText(/답글 권한이 확인되었습니다/u).waitFor();
    await page.getByLabel(/11111111111 판매자 답글/u).fill("Thank you.");
    await page.locator('[data-lazada-product-review-reply-submit="true"]').click();
    await page.getByText(/제공자 전송 작업이 대기 중입니다/u).waitFor();
    const firstCalls = await page.evaluate(() => (globalThis as typeof globalThis & {
      testHarness: { calls(): Array<{ input: string; method: string; body: string }> };
    }).testHarness.calls());
    assert.deepEqual(firstCalls.map((call: { method: string }) => call.method), ["GET", "POST", "GET"]);
    assert.match(firstCalls[0].input, /credentialId=.*&country=MY/u);
    assert.doesNotMatch(firstCalls[0].input, /reviewId|generation|eventKey/u);

    await page.evaluate(() => (globalThis as typeof globalThis & {
      testHarness: { switchSession(session: string): void };
    }).testHarness.switchSession("B"));
    await page.locator('main[data-session="B"]').waitFor();
    await page.getByText(/정확한 계정·국가 답글 권한 확인 중/u).waitFor();
    assert.equal(await page.getByLabel(/22222222222 판매자 답글/u).inputValue(), "");
    assert.equal(await page.locator('[data-lazada-product-review-reply-submit="true"]').isDisabled(), true);
    assert.doesNotMatch(await page.locator("main").innerText(), /권한이 확인되었습니다|전송 작업이 대기 중|처리 중/u);
    await page.evaluate(() => (globalThis as typeof globalThis & {
      testHarness: { resolveB(): void };
    }).testHarness.resolveB());
    await page.getByText(/답글 권한 미확인 · 접수 차단/u).waitFor();
    const allCalls = await page.evaluate(() => (globalThis as typeof globalThis & {
      testHarness: { calls(): Array<{ input: string; method: string; body: string }> };
    }).testHarness.calls());
    assert.match(allCalls.at(-1).input, /credentialId=.*&country=SG/u);
    assert.deepEqual(browserErrors, []);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await rm(workspace, { recursive: true, force: true });
  }
});

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/lazada/product-review/reply/route.ts", import.meta.url,
), "utf8");

function loadRoute() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module: moduleRecord, exports: moduleRecord.exports, Request, Response, URL, z,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      if (name === "zod") return { z };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({ user: { id: viewerId }, userClient: { rpc: async (rpcName: string, args: Record<string, unknown>) => {
          calls.push({ name: rpcName, args });
          if (rpcName.includes("capability")) return { data: {
            contract: "sellerpilot-lazada-product-review-reply-capability/1", credentialId, country: "MY",
            permissionState: "authorized", replyPath: "/review/seller/reply/add",
            readbackPath: "/review/seller/list/v2", automaticReplyEnabled: false,
          }, error: null };
          if (rpcName.includes("get_lazada")) return { data: status("queued").delivery, error: null };
          if (rpcName.includes("prepare")) return { data: prepared(), error: null };
          return { data: submission().submission.enqueue, error: null };
        } } }),
        isAdminApiError: () => false,
      };
      if (name.endsWith("/product-review-reply-ui")) return replyUiContracts;
      if (name.endsWith("/product-review-reply")) return replyContracts;
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  return { route: moduleRecord.exports as Record<string, (request: Request) => Promise<Response>>, calls };
}

test("admin route exposes exact capability, submission, status and readback RPCs without direct provider fetch", async () => {
  const { route, calls } = loadRoute();
  const base = "https://sellerpilot.test/api/admin/cs/channels/lazada/product-review/reply";
  const capability = await route.GET(new Request(`${base}?credentialId=${credentialId}&country=MY`));
  assert.equal(capability.status, 200);
  assert.equal(lazadaProductReviewReplyCapabilitySchema.parse((await capability.json()).capability).permissionState, "authorized");
  const post = await route.POST(new Request(base, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...selection, eventKey: undefined, reply: "Thank you." }) }));
  assert.equal(post.status, 202);
  assert.equal((await route.GET(new Request(`${base}?deliveryId=${deliveryId}`))).status, 200);
  assert.equal((await route.PUT(new Request(base, { method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliveryId }) }))).status, 202);
  assert.deepEqual(calls.map((call) => call.name), [
    "sellerpilot_get_lazada_product_review_reply_capability_v1",
    "sellerpilot_prepare_lazada_product_review_reply_v1",
    "sellerpilot_enqueue_lazada_product_review_reply_v1",
    "sellerpilot_get_lazada_product_review_reply_v1",
    "sellerpilot_enqueue_lazada_product_review_readback_v1",
  ]);
  assert.doesNotMatch(routeSource, /fetch\(|lazadaRequest|reply\/add/u);
});
