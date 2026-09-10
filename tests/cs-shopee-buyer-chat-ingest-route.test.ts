import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  ShopeeBuyerChatIngestError,
  shopeeBuyerChatWorkerIngestRequestSchema,
} from "../lib/channels/cs/shopee/buyer-chat-ingest";

const routeSource = await readFile(new URL(
  "../app/api/channel-gateway/worker/shopee-buyer-chat/ingest/route.ts", import.meta.url,
), "utf8");
const transpiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)
  .length ?? 0, 0);

const workerToken = `spw_${"a".repeat(32)}`;
const requestBody = {
  credentialId: "00000000-0000-4000-8000-000000079003",
  shopId: "1719148844",
  entitlementId: "00000000-0000-4000-8000-000000079004",
  workerVersion: "sellerpilot-cli-worker/test",
  page: {
    contract: "sellerpilot-shopee-buyer-chat-authorized-page/1",
    shopId: "1719148844", conversationId: "conversation_1",
    inputCursor: null, nextCursor: null, pageSize: 1,
    messages: [{ conversationId: "conversation_1", messageId: "message_1",
      senderRole: "buyer", body: "Where is my order?",
      sentAt: "2026-09-09T00:00:00.000Z" }],
  },
};

function loadRoute(options: { workerAuthorized?: unknown; workerError?: unknown;
  ingestError?: ShopeeBuyerChatIngestError } = {}) {
  const rpcCalls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const ingestCalls: unknown[] = [];
  let createClientCalls = 0;
  const serviceClient = {
    async rpc(name: string, arguments_: Record<string, unknown>) {
      rpcCalls.push({ name, arguments_ });
      return { data: options.workerAuthorized ?? true, error: options.workerError ?? null };
    },
  };
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject, Request, Response, URL, Headers, Buffer,
    console: { error() {}, warn() {}, info() {}, log() {} },
    require(name: string) {
      if (name === "node:crypto") return { createHash };
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@supabase/supabase-js") return {
        createClient() { createClientCalls += 1; return serviceClient; },
      };
      if (name.endsWith("/buyer-chat-ingest")) return {
        ShopeeBuyerChatIngestError,
        shopeeBuyerChatWorkerIngestRequestSchema,
        async ingestAuthorizedShopeeBuyerChatPage(input: unknown) {
          ingestCalls.push(input);
          if (options.ingestError) throw options.ingestError;
          return {
            contract: "sellerpilot-shopee-buyer-chat-authorized-ingest/1",
            status: "ingested", credentialId: requestBody.credentialId,
            shopId: requestBody.shopId, conversationId: "conversation_1",
            acceptedCount: 1, committedCursor: null, reply: false,
          };
        },
      };
      if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://example.supabase.co" };
      if (name.endsWith("/worker-rpc")) return { createBoundedSupabaseFetch: () => fetch };
      throw new Error(`unexpected import ${name}`);
    },
    process: { env: { SUPABASE_SECRET_KEY: "secret" } },
  });
  vm.runInContext(transpiled.outputText, sandbox);
  return {
    POST: exportsObject.POST as (request: Request) => Promise<Response>, rpcCalls, ingestCalls,
    get createClientCalls() { return createClientCalls; },
  };
}

function post(body: unknown, token = workerToken) {
  return new Request("https://sellerpilot.invalid/ingest", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("worker-authenticated POST invokes only the trusted server ingest pipeline", async () => {
  const loaded = loadRoute();
  const response = await loaded.POST(post(requestBody));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(loaded.createClientCalls, 1);
  assert.equal(loaded.rpcCalls[0].name, "sellerpilot_service_validate_worker_token");
  assert.equal(loaded.rpcCalls[0].arguments_.p_worker_version, requestBody.workerVersion);
  assert.equal(loaded.ingestCalls.length, 1);
  assert.equal("permissionEvidence" in (loaded.ingestCalls[0] as Record<string, unknown>), false);
  assert.equal((await response.json() as { status: string }).status, "ingested");
});

test("missing worker auth and caller-supplied approval are rejected before server RPC", async () => {
  const missing = loadRoute();
  assert.equal((await missing.POST(post(requestBody, "bad"))).status, 401);
  assert.equal(missing.createClientCalls, 0);
  const forged = loadRoute();
  assert.equal((await forged.POST(post({ ...requestBody,
    permissionEvidence: { appApproval: { state: "approved" } },
  }))).status, 400);
  assert.equal(forged.createClientCalls, 0);
  assert.equal(forged.ingestCalls.length, 0);
});

test("worker and entitlement failures stay fail-closed", async () => {
  assert.equal((await loadRoute({ workerAuthorized: false }).POST(post(requestBody))).status, 401);
  assert.equal((await loadRoute({ workerError: { code: "08000" } }).POST(post(requestBody))).status,
    503);
  const unavailable = loadRoute({
    ingestError: new ShopeeBuyerChatIngestError("ENTITLEMENT_UNAVAILABLE"),
  });
  assert.equal((await unavailable.POST(post(requestBody))).status, 403);
});

test("entrypoint contains no provider network adapter or reply action", () => {
  assert.doesNotMatch(routeSource, /open[.]shopee|sellerchat[/_.-]|messages[/_.-]list/u);
  assert.doesNotMatch(routeSource, /reply|sendMessage|fetch\(/u);
});
