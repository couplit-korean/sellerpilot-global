import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import vm from "node:vm";
import ts from "typescript";
import * as buyerChatContract from "../lib/cs/channels/shopee/buyer-chat-contract";
import {
  SHOPEE_BUYER_CHAT_TRANSPORT,
  createShopeeBuyerChatView,
  projectShopeeBuyerChatApi,
  shopeeBuyerChatApiSchema,
  shopeeBuyerChatMediaReadSchema,
  shopeeBuyerChatPushObservationSchema,
  shopeeBuyerChatReadQuerySchema,
  shopeeBuyerChatReadSchema,
} from "../lib/cs/channels/shopee/buyer-chat-contract";

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/shopee/buyer-chat/route.ts", import.meta.url,
), "utf8");
const uiSource = await readFile(new URL(
  "../app/cs/channels/shopee/buyer-chat-status.tsx", import.meta.url,
), "utf8");
const parentUiSource = await readFile(new URL(
  "../app/cs/channels/shopee/history-progress.tsx", import.meta.url,
), "utf8");
const capabilitySource = await readFile(new URL(
  "../lib/cs/capability-inventory.ts", import.meta.url,
), "utf8");
const transpiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
const transpiledUi = ts.transpileModule(uiSource, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiledRoute.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
assert.equal(transpiledUi.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const requireFromTest = createRequire(import.meta.url);

const credentialId = "00000000-0000-4000-8000-000000069003";
const pending = {
  contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
  state: "permission_pending", reason: "contract_permission_unverified",
  receive: false, history: false, storedHistory: false, reply: false, shops: [],
};

function pushObservation(data: { checkedAt: string;
  shops: Array<{ credentialId: string; shopId: string }> },
shopOverrides: Record<string, unknown> = {}) {
  return {
    contract: "sellerpilot-shopee-buyer-chat-push-status/1",
    checkedAt: data.checkedAt,
    receiverImplemented: true,
    operationalReceive: false,
    automaticHistoryCollection: false,
    reply: false,
    shops: data.shops.map((shop: { credentialId: string; shopId: string }) => ({
      credentialId: shop.credentialId,
      shopId: shop.shopId,
      receiverImplemented: true,
      credentialCurrent: false,
      entitlementCurrent: false,
      verifiedReceipt: false,
      lastVerifiedReceivedAt: null,
      currentConnectionVerified: false,
      ...shopOverrides,
    })),
  };
}

function loadRoute(data: unknown = pending, rpcError: unknown = null,
  pushData: unknown = pushObservation(pending), pushError: unknown = null,
  mediaData: unknown = { contract: "sellerpilot-shopee-buyer-chat-media-read/1",
    checkedAt: pending.checkedAt, records: [] }, mediaError: unknown = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({ exports: exportsObject, Request, Response, URL,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({ user: { id: "owner" }, userClient: {
          rpc: async (rpcName: string, args: Record<string, unknown>) => {
            calls.push({ name: rpcName, args });
            if (rpcName === "sellerpilot_read_cs_shopee_buyer_chat_push_status_v1") {
              return { data: pushData, error: pushError };
            }
            if (rpcName === "sellerpilot_read_cs_shopee_buyer_chat_media_v1") {
              return { data: mediaData, error: mediaError };
            }
            return { data, error: rpcError };
          },
        } }),
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (name.endsWith("/buyer-chat-contract")) {
        return { SHOPEE_BUYER_CHAT_TRANSPORT, projectShopeeBuyerChatApi,
          shopeeBuyerChatPushObservationSchema,
          shopeeBuyerChatMediaReadSchema,
          shopeeBuyerChatReadQuerySchema,
          shopeeBuyerChatReadSchema };
      }
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(transpiledRoute.outputText, sandbox);
  return { GET: exportsObject.GET as (request: Request) => Promise<Response>, calls };
}

function renderStatus(data: ReturnType<typeof createShopeeBuyerChatView>) {
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject,
    module: { exports: exportsObject },
    require(name: string) {
      if (name === "react" || name === "react/jsx-runtime") return requireFromTest(name);
      if (name.endsWith("/buyer-chat-contract")) return buyerChatContract;
      if (name.endsWith(".module.css")) {
        return { default: { panel: "panel", messages: "messages" } };
      }
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(transpiledUi.outputText, sandbox);
  const Content = exportsObject.ShopeeBuyerChatStatusContent as (props: {
    data: ReturnType<typeof createShopeeBuyerChatView>;
    loading: boolean;
    loadingScopeKey: string;
    error: string;
    onLoad: () => void;
    onLoadMore: () => void;
  }) => ReturnType<typeof createElement>;
  return renderToStaticMarkup(createElement(Content, {
    data, loading: false, loadingScopeKey: "", error: "", onLoad() {}, onLoadMore() {},
  }));
}

test("authenticated shared-admin GET sends only the exact bounded read scope to the RPC", async () => {
  const loaded = loadRoute();
  const response = await loaded.GET(new Request(
    `https://sellerpilot.invalid/buyer-chat?credentialId=${credentialId}&shopId=1719148844&conversationId=conversation_1&cursor=opaque%2B%2F%3D&limit=25`,
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls)), [{
    name: "sellerpilot_read_cs_shopee_buyer_chat_v1",
    args: { p_credential_id: credentialId, p_shop_id: "1719148844",
      p_conversation_id: "conversation_1",
      p_cursor: "opaque+/=", p_limit: 25 },
  }, {
    name: "sellerpilot_read_cs_shopee_buyer_chat_push_status_v1",
    args: { p_credential_id: credentialId, p_shop_id: "1719148844" },
  }, {
    name: "sellerpilot_read_cs_shopee_buyer_chat_media_v1",
    args: { p_scopes: [] },
  }]);
  const result = await response.json();
  assert.deepEqual(result, projectShopeeBuyerChatApi(
    pending, SHOPEE_BUYER_CHAT_TRANSPORT, pushObservation(pending),
  ));
  assert.equal(shopeeBuyerChatApiSchema.safeParse(result).success, true);
});

test("GET rejects widened or unbounded filters before DB access", async () => {
  for (const query of ["?limit=101", "?shopId=0", "?conversationId=has%20space",
    "?credentialId=not-a-uuid&shopId=1719148844", `?credentialId=${credentialId}`,
    "?cursor=unscoped", "?reply=must-not-send", `?cursor=${"x".repeat(1_025)}`]) {
    const loaded = loadRoute();
    const response = await loaded.GET(new Request(`https://sellerpilot.invalid/buyer-chat${query}`));
    assert.equal(response.status, 400); assert.equal(loaded.calls.length, 0);
  }
});

test("approved ledger GET and actual status content never claim operational receive", async () => {
  const message = {
    shopId: "1719148844", conversationId: "conversation_1", messageId: "message_1",
    identityDigest: "a".repeat(64), senderRole: "buyer", body: "stored buyer message",
    bodyFingerprint: "b".repeat(64), sentAt: "2026-09-09T09:00:00.000Z",
    orderSn: null, itemId: null, attachmentCount: 0,
  };
  const approved = shopeeBuyerChatReadSchema.parse({
    contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
    state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, storedHistory: true, reply: false,
    shops: [{ credentialId, shopId: "1719148844", state: "read_only_ready",
      runtimeReady: true, storedHistory: true, conversationCount: 1,
      messages: [message], nextCursor: "next-page" }],
  });
  const observed = pushObservation(approved, {
    credentialCurrent: true,
    entitlementCurrent: true,
    verifiedReceipt: true,
    lastVerifiedReceivedAt: "2026-09-09T09:30:00.000Z",
  });
  const response = await loadRoute(approved, null, observed).GET(
    new Request("https://sellerpilot.invalid/buyer-chat?limit=100"),
  );
  const status = shopeeBuyerChatApiSchema.parse(await response.json());
  assert.equal(status.operationalReceive, false);
  assert.equal(status.automaticHistoryCollection, false);
  assert.equal(status.shops[0].push.verifiedReceipt, true);
  assert.equal(status.shops[0].push.currentConnectionVerified, false);
  assert.equal("receive" in status, false);
  assert.equal("runtimeReady" in status.shops[0], false);
  const html = renderStatus(createShopeeBuyerChatView(status));
  assert.match(html, /Buyer Chat · 검증된 수신 기록 있음 · 현재 연결 미검증/u);
  assert.match(html, /검증된 수신 기록 있음 · 현재 수신 권한 유효 · 연결 미검증/u);
  assert.match(html, /마지막 검증된 수신/u);
  assert.match(html, /서명을 확인하는 Buyer Chat 수신 처리가 구현/u);
  assert.match(html, /자동 이력 조회와 Buyer Chat 답변 전송은 지원하지 않습니다/u);
  assert.doesNotMatch(html, /읽기 전용 수신·이력 확인 가능|Buyer Chat · 읽기 전용/u);
  const revoked = shopeeBuyerChatReadSchema.parse({
    ...approved,
    state: "permission_pending", reason: "credential_unavailable",
    receive: false, history: false,
    shops: [{ ...approved.shops[0], state: "permission_pending", runtimeReady: false }],
  });
  const revokedObservation = pushObservation(revoked, {
    verifiedReceipt: true,
    lastVerifiedReceivedAt: "2026-09-09T09:30:00.000Z",
  });
  const revokedResponse = await loadRoute(revoked, null, revokedObservation).GET(
    new Request("https://sellerpilot.invalid/buyer-chat?limit=100"),
  );
  const revokedStatus = shopeeBuyerChatApiSchema.parse(await revokedResponse.json());
  const revokedHtml = renderStatus(createShopeeBuyerChatView(revokedStatus));
  assert.equal(revokedStatus.operationalReceive, false);
  assert.match(revokedHtml, /과거 검증된 수신 기록 · 현재 수신 권한 없음/u);
  assert.match(revokedHtml, /현재 인증 정보 재승인 필요/u);
  assert.doesNotMatch(revokedHtml, /수신 가능|Buyer Chat · 읽기 전용/u);
});

test("route fails closed on DB errors and capability response drift", async () => {
  assert.equal((await loadRoute(null, { message: "db unavailable" }).GET(
    new Request("https://sellerpilot.invalid/buyer-chat"))).status, 503);
  assert.equal((await loadRoute({ ...pending, reply: true }).GET(
    new Request("https://sellerpilot.invalid/buyer-chat"))).status, 502);
  assert.equal((await loadRoute(pending, null, null, { message: "status unavailable" }).GET(
    new Request("https://sellerpilot.invalid/buyer-chat"))).status, 503);
  assert.equal((await loadRoute(pending, null, { ...pushObservation(pending),
    operationalReceive: true }).GET(
    new Request("https://sellerpilot.invalid/buyer-chat"))).status, 502);
  assert.equal((await loadRoute(pending, null, pushObservation(pending), null,
    null, { message: "media unavailable" }).GET(
    new Request("https://sellerpilot.invalid/buyer-chat"))).status, 503);
  assert.equal((await loadRoute(pending, null, pushObservation(pending), null,
    { contract: "drift", checkedAt: pending.checkedAt, records: [] }).GET(
    new Request("https://sellerpilot.invalid/buyer-chat"))).status, 502);
});

test("mounted UI is GET-only, states the permission gate, and exposes no reply action", () => {
  assert.match(parentUiSource, /<ShopeeBuyerChatStatus authenticatedFetch=\{authenticatedFetch\}/u);
  assert.match(parentUiSource, /JSON\.stringify\(\[historyRunId, scopeKey\]\)/u);
  assert.match(parentUiSource, /if \(abort\.signal\.aborted\) return;/u);
  for (const key of ["buyer_chat_push", "buyer_chat_history", "buyer_chat_reply"]) {
    assert.match(capabilitySource, new RegExp(`key:"${key}"[^\\n]+state:"permission_pending"`, "u"));
  }
  assert.match(capabilitySource, /endpoint·pagination·raw envelope를 추측하지 않음/u);
  assert.match(uiSource, /method: "GET"/u);
  assert.doesNotMatch(uiSource, /method: "POST"/u);
  assert.match(uiSource, /const loadMore = async \(credentialId: string, shopId: string, cursor: string\)/u);
  assert.match(uiSource, /new URLSearchParams\(\{ credentialId, shopId, cursor, limit: "100" \}\)/u);
  assert.match(uiSource, /mergeShopeeBuyerChatStatusPage/u);
  assert.match(uiSource, /requestSequence\.current === sequence/u);
  assert.match(uiSource, /data: null,[\s\S]*이전 결과를 폐기했습니다/u);
  assert.match(uiSource, /sessionState\.authenticatedFetch !== authenticatedFetch/u);
  assert.match(uiSource, /active[?][.]authenticatedFetch === authenticatedFetch/u);
  assert.match(uiSource, /requestController\.current[?][.]authenticatedFetch === sessionFetch/u);
  assert.match(uiSource, /\}, \[authenticatedFetch\]\);/u);
  assert.doesNotMatch(uiSource, /useEffect\([\s\S]{0,300}\}, \[\]\);/u);
  assert.match(uiSource, /이 shop 추가 이력 불러오기/u);
  assert.match(uiSource, /서명을 확인하는 Buyer Chat 수신 처리가 구현되어 있습니다/u);
  assert.match(uiSource, /과거 검증된 수신 기록만으로 현재 연결 또는 운영 수신 완료를 추정하지 않습니다/u);
  assert.match(uiSource, /자동 이력 조회와 Buyer Chat 답변 전송은 지원하지 않습니다/u);
  assert.match(uiSource, /원격 파일은 서버에서 자동으로 내려받지 않습니다/u);
  assert.match(uiSource, /현재 연결 검증: 미확인/u);
  assert.doesNotMatch(uiSource, /읽기 전용 수신·이력 확인 가능/u);
  assert.doesNotMatch(uiSource, /data[?][.]state === "read_only_ready"/u);
  assert.match(routeSource, /SHOPEE_BUYER_CHAT_TRANSPORT/u);
  assert.match(routeSource, /projectShopeeBuyerChatApi/u);
  assert.doesNotMatch(uiSource, /답변 전송<\/button>/u);
  for (const source of [uiSource, parentUiSource]) {
    const transpiled = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    });
    assert.equal(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
  }
});
