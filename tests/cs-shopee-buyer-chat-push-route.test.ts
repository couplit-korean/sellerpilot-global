import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  readShopeeBuyerChatPushAddress,
  ShopeeBuyerChatPushError,
  shopeeBuyerChatPushTransportSchema,
  verifyAndNormalizeShopeeBuyerChatPush,
} from "../lib/channels/cs/shopee/buyer-chat-push";
import { ShopeeBuyerChatIngestError } from "../lib/channels/cs/shopee/buyer-chat-ingest";

const routeSource = await readFile(new URL(
  "../app/api/webhooks/shopee-buyer-chat/route.ts", import.meta.url,
), "utf8");
const transpiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)
  .length ?? 0, 0);

const callbackUrl = "https://sellerpilot.example/api/webhooks/shopee-buyer-chat";
const partnerKey = "fixture-partner-key-never-production";
const credentialId = "00000000-0000-4000-8000-000000089003";
const entitlementId = "00000000-0000-4000-8000-000000089004";
const shopId = "947042923";
const transport = {
  contract: "sellerpilot-shopee-buyer-chat-push-transport/1",
  credentialId, entitlementId, shopId, partnerKey, webhookEvent: "webchat_push",
};

function rawPush(requestId = "request-1") {
  return JSON.stringify({
    data: { type: "message", region: "ID", content: {
      message_id: "2302748948493123953", request_id: requestId,
      from_id: 165105353, to_id: 947151379,
      message_type: "text", content: { text: "Where is my order?" },
      conversation_id: "709122092476686867", created_timestamp: 1726044721,
      region: "ID", source_content: {}, business_type: 0,
      to_shop_id: Number(shopId), from_shop_id: 0,
    } },
    shop_id: Number(shopId), code: 10, timestamp: 1726044722,
  });
}

function authorization(rawBody: string) {
  return createHmac("sha256", partnerKey).update(`${callbackUrl}|${rawBody}`).digest("hex");
}

function loadRoute(options: {
  resolved?: unknown;
  resolverError?: unknown;
  resolverThrow?: Error;
  persistError?: Error;
  callback?: string;
  secretKey?: string;
} = {}) {
  const rpcCalls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const persistCalls: unknown[] = [];
  let createClientCalls = 0;
  const serviceClient = {
    async rpc(name: string, arguments_: Record<string, unknown>) {
      rpcCalls.push({ name, arguments_ });
      if (options.resolverThrow) throw options.resolverThrow;
      return { data: options.resolved === undefined ? transport : options.resolved,
        error: options.resolverError ?? null };
    },
  };
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject, Request, Response, URL, Headers, Buffer,
    console: { error() {}, warn() {}, info() {}, log() {} },
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@supabase/supabase-js") return {
        createClient() { createClientCalls += 1; return serviceClient; },
      };
      if (name.endsWith("/buyer-chat-push")) return {
        readShopeeBuyerChatPushAddress,
        ShopeeBuyerChatPushError,
        shopeeBuyerChatPushTransportSchema,
        verifyAndNormalizeShopeeBuyerChatPush,
        async persistVerifiedShopeeBuyerChatPush(input: unknown) {
          persistCalls.push(input);
          if (options.persistError) throw options.persistError;
          return { status: "ingested" };
        },
      };
      if (name.endsWith("/buyer-chat-ingest")) return { ShopeeBuyerChatIngestError };
      if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://example.supabase.co" };
      if (name.endsWith("/worker-rpc")) return { createBoundedSupabaseFetch: () => fetch };
      throw new Error(`unexpected import ${name}`);
    },
    process: { env: {
      SUPABASE_SECRET_KEY: options.secretKey ?? "secret",
      SHOPEE_BUYER_CHAT_PUSH_CALLBACK_URL: options.callback ?? callbackUrl,
    } },
  });
  vm.runInContext(transpiled.outputText, sandbox);
  return {
    POST: exportsObject.POST as (request: Request) => Promise<Response>, rpcCalls, persistCalls,
    get createClientCalls() { return createClientCalls; },
  };
}

function post(rawBody: string, signature = authorization(rawBody)) {
  return new Request(callbackUrl, {
    method: "POST",
    headers: { authorization: signature, "content-type": "application/json" },
    body: rawBody,
  });
}

test("signed raw provider message resolves server transport and returns empty 204 after persistence", async () => {
  const loaded = loadRoute();
  const response = await loaded.POST(post(rawPush()));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(loaded.createClientCalls, 1);
  assert.equal(JSON.stringify(loaded.rpcCalls), JSON.stringify([{
    name: "sellerpilot_service_resolve_shopee_buyer_chat_push_v1",
    arguments_: { p_shop_id: shopId },
  }]));
  assert.equal(loaded.persistCalls.length, 1);
  const persisted = loaded.persistCalls[0] as { transport: typeof transport;
    push: { page: { messages: Array<{ senderRole: string }> } } };
  assert.equal(persisted.transport.credentialId, credentialId);
  assert.equal(persisted.transport.entitlementId, entitlementId);
  assert.equal(persisted.push.page.messages[0].senderRole, "buyer");
});

test("caller cannot supply credential, entitlement, callback or trust evidence", async () => {
  const rawBody = JSON.stringify({ ...JSON.parse(rawPush()),
    credentialId: "00000000-0000-4000-8000-000000089999",
    entitlementId: "00000000-0000-4000-8000-000000089998",
    callbackUrl: "https://attacker.invalid/callback",
    permissionEvidence: { appApproval: { state: "approved" } },
  });
  const loaded = loadRoute();
  const response = await loaded.POST(post(rawBody));
  assert.equal(response.status, 204);
  const persisted = loaded.persistCalls[0] as { transport: typeof transport };
  assert.equal(persisted.transport.credentialId, credentialId);
  assert.equal(persisted.transport.entitlementId, entitlementId);
  assert.equal("permissionEvidence" in persisted.transport, false);
});

test("invalid signature and unresolved or scope-drifted shop transport fail closed", async () => {
  const unsigned = loadRoute();
  assert.equal((await unsigned.POST(post(rawPush(), "0".repeat(64)))).status, 401);
  assert.equal(unsigned.persistCalls.length, 0);
  const unresolved = loadRoute({ resolved: null });
  assert.equal((await unresolved.POST(post(rawPush()))).status, 403);
  assert.equal(unresolved.persistCalls.length, 0);
  const drift = loadRoute({ resolved: { ...transport, shopId: "947042924" } });
  assert.equal((await drift.POST(post(rawPush()))).status, 403);
  assert.equal(drift.persistCalls.length, 0);
  const unavailable = loadRoute({ resolverThrow: new Error("network unavailable") });
  assert.equal((await unavailable.POST(post(rawPush()))).status, 503);
  assert.equal(unavailable.persistCalls.length, 0);
});

test("unsupported event and persistence failure never receive a success acknowledgement", async () => {
  const notification = JSON.stringify({ data: { type: "notification", region: "ID",
    content: { conversation_id: "1", type: "mark_as_replied" } },
  shop_id: Number(shopId), code: 10, timestamp: 1726044722 });
  const unsupported = loadRoute();
  assert.equal((await unsupported.POST(post(notification))).status, 400);
  assert.equal(unsupported.persistCalls.length, 0);
  const failed = loadRoute({ persistError: new ShopeeBuyerChatPushError("RECEIPT_FAILED") });
  assert.equal((await failed.POST(post(rawPush()))).status, 503);
});

test("callback URL and server secret configuration are mandatory", async () => {
  const missingCallback = loadRoute({ callback: "" });
  assert.equal((await missingCallback.POST(post(rawPush()))).status, 403);
  assert.equal(missingCallback.createClientCalls, 0);
  const missingSecret = loadRoute({ secretKey: "" });
  assert.equal((await missingSecret.POST(post(rawPush()))).status, 403);
  assert.equal(missingSecret.createClientCalls, 0);
});
