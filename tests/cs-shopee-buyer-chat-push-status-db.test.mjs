import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import ts from "typescript";
import { createServer } from "vite";
import * as buyerChatContract from "../lib/cs/channels/shopee/buyer-chat-contract.ts";
import {
  persistVerifiedShopeeBuyerChatPush,
  readShopeeBuyerChatPushAddress,
  ShopeeBuyerChatPushError,
  shopeeBuyerChatPushTransportSchema,
  verifyAndNormalizeShopeeBuyerChatPush,
} from "../lib/channels/cs/shopee/buyer-chat-push.ts";
import { ingestAuthorizedShopeeBuyerChatPage, ShopeeBuyerChatIngestError } from
  "../lib/channels/cs/shopee/buyer-chat-ingest.ts";
import {
  createShopeeBuyerChatView,
  shopeeBuyerChatApiSchema,
  shopeeBuyerChatReadSchema,
} from
  "../lib/cs/channels/shopee/buyer-chat-contract.ts";

const [canonicalSql, entitlementSql, pushSql, statusSql, mediaSql, routeSource,
  adminRouteSource, uiSource] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260909165247_cs_shopee_buyer_chat_read_ledger.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909185400_cs_shopee_buyer_chat_ingest_entitlement.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909221500_cs_shopee_buyer_chat_push_transport.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909232000_cs_shopee_buyer_chat_push_status.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260910062000_cs_shopee_buyer_chat_push_media.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../app/api/webhooks/shopee-buyer-chat/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/cs/channels/shopee/buyer-chat/route.ts",
    import.meta.url), "utf8"),
  readFile(new URL("../app/cs/channels/shopee/buyer-chat-status.tsx", import.meta.url), "utf8"),
]);
const transpiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiledRoute.diagnostics?.filter(item =>
  item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const transpiledAdminRoute = ts.transpileModule(adminRouteSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
const transpiledUi = ts.transpileModule(uiSource, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
});
assert.equal(transpiledAdminRoute.diagnostics?.filter(item =>
  item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
assert.equal(transpiledUi.diagnostics?.filter(item =>
  item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const requireFromTest = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const componentPath = `${repoRoot}/app/cs/channels/shopee/buyer-chat-status.tsx`;

async function firstExecutable(paths) {
  for (const candidate of paths) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* try next */ }
  }
  return null;
}

async function verifyMountedStatus(status, expectedText = []) {
  const virtualId = "virtual:shopee-push-status-05";
  const resolvedVirtualId = `\0${virtualId}.tsx`;
  const harnessSource = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { ShopeeBuyerChatStatus } from ${JSON.stringify(`/@fs/${componentPath}`)};
    const payload=${JSON.stringify(status)};
    const authenticatedFetch=async()=>new Response(JSON.stringify(payload),{
      status:200,headers:{"content-type":"application/json"},
    });
    createRoot(document.getElementById("root")).render(
      <ShopeeBuyerChatStatus authenticatedFetch={authenticatedFetch}/>
    );
  `;
  const server = await createServer({
    root: repoRoot, logLevel: "error",
    cacheDir: `${repoRoot}/.local/vite-shopee-push-media-status`,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    resolve: { dedupe: ["react", "react-dom"] },
    plugins: [{
      name: "shopee-push-status-05",
      resolveId(id) { return id === virtualId ? resolvedVirtualId : null; },
      load(id) {
        if (id !== resolvedVirtualId) return null;
        return ts.transpileModule(harnessSource, { compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        } }).outputText;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__shopee_push_status_05__") return next();
          const html = await vite.transformIndexHtml(request.url,
            `<!doctype html><html><body><div id="root"></div><script type="module">import ${JSON.stringify(virtualId)};</script></body></html>`);
          response.statusCode = 200;
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(html);
        });
      },
    }],
  });
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]);
  assert.ok(executablePath);
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"] });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${address.port}/__shopee_push_status_05__`);
    await page.locator("summary").click();
    await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).click();
    await page.getByText("검증된 수신 기록 있음 · 현재 수신 권한 유효 · 연결 미검증").waitFor();
    await page.getByText(status.shops[0].push.lastVerifiedReceivedAt).waitFor();
    for (const value of expectedText) await page.getByText(value).waitFor();
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }
}

async function createCanonicalUiBridge(scopes, bridge) {
  const virtualId = "virtual:shopee-media-07-canonical-ui";
  const resolvedVirtualId = `\0${virtualId}.tsx`;
  const harnessSource = `
    import React, { useMemo, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { ShopeeBuyerChatStatus } from ${JSON.stringify(`/@fs/${componentPath}`)};
    const scopes=${JSON.stringify(scopes)};
    function scopedFetch(scope) {
      return (input, init = {}) => {
        const url = new URL(input, window.location.origin);
        url.searchParams.set("credentialId", scope.credentialId);
        url.searchParams.set("shopId", scope.shopId);
        return window.fetch(url, init);
      };
    }
    function App() {
      const [session, setSession] = useState("A");
      const authenticatedFetch = useMemo(() => scopedFetch(scopes[session]), [session]);
      return <>
        <p id="active-session">session {session}</p>
        <button id="media-session-a" onClick={() => setSession("A")}>session A</button>
        <button id="media-session-b" onClick={() => setSession("B")}>session B</button>
        <ShopeeBuyerChatStatus authenticatedFetch={authenticatedFetch}/>
      </>;
    }
    createRoot(document.getElementById("root")).render(<App/>);
  `;
  const server = await createServer({
    root: repoRoot, logLevel: "error",
    cacheDir: `${repoRoot}/.local/vite-shopee-media-07-canonical-ui`,
    optimizeDeps: { noDiscovery: true },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    resolve: { dedupe: ["react", "react-dom"] },
    plugins: [{
      name: "shopee-media-07-canonical-ui",
      resolveId(id) { return id === virtualId ? resolvedVirtualId : null; },
      load(id) {
        if (id !== resolvedVirtualId) return null;
        return ts.transpileModule(harnessSource, { compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        } }).outputText;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          try {
            const requestUrl = request.url ?? "/";
            if (request.method === "POST"
                && requestUrl === "/api/webhooks/shopee-buyer-chat") {
              const chunks = [];
              for await (const chunk of request) chunks.push(Buffer.from(chunk));
              const result = await bridge.POST(new Request(bridge.callbackUrl, {
                method: "POST",
                headers: {
                  authorization: String(request.headers.authorization ?? ""),
                  "content-type": String(request.headers["content-type"] ?? ""),
                },
                body: Buffer.concat(chunks),
              }));
              response.statusCode = result.status;
              for (const [name, value] of result.headers) response.setHeader(name, value);
              response.end(Buffer.from(await result.arrayBuffer()));
              return;
            }
            if (request.method === "GET" && requestUrl.startsWith(
              "/api/admin/cs/channels/shopee/buyer-chat?",
            )) {
              const result = await bridge.GET(new Request(`${bridge.origin}${requestUrl}`));
              response.statusCode = result.status;
              for (const [name, value] of result.headers) response.setHeader(name, value);
              response.end(Buffer.from(await result.arrayBuffer()));
              return;
            }
            if (requestUrl !== "/__shopee_media_07__") return next();
            const html = await vite.transformIndexHtml(requestUrl,
              `<!doctype html><html><body><div id="root"></div><script type="module">import ${JSON.stringify(virtualId)};</script></body></html>`);
            response.statusCode = 200;
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.end(html);
          } catch (error) {
            response.statusCode = 500;
            response.end(error instanceof Error ? error.message : "bridge failure");
          }
        });
      },
    }],
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === "object");
  bridge.origin = `http://127.0.0.1:${address.port}`;
  bridge.postUrl = `${bridge.origin}/api/webhooks/shopee-buyer-chat`;
  bridge.callbackUrl = `https://127.0.0.1:${address.port}/api/webhooks/shopee-buyer-chat`;
  return { server, pageUrl: `${bridge.origin}/__shopee_media_07__` };
}

const owner = "00000000-0000-4000-8000-000000099001";
const admin = "00000000-0000-4000-8000-000000099002";
const credentialId = "00000000-0000-4000-8000-000000099003";
const entitlementId = "00000000-0000-4000-8000-000000099004";
const vaultSecretId = "00000000-0000-4000-8000-000000099005";
const shopId = "947042923";
const sellerAccountKey = "a".repeat(64);
const capabilityEvidence = "c".repeat(64);
const verifiedAt = "2026-09-09T00:03:00.000Z";
const callbackUrl = "https://sellerpilot.example/api/webhooks/shopee-buyer-chat";
const partnerKey = "fixture-partner-key-never-production";
const sha = value => createHash("sha256").update(value).digest("hex");
const shopBinding = sha([
  "sellerpilot-shopee-buyer-chat-shop-binding/1", credentialId,
  sellerAccountKey, "production", shopId,
].join("\n"));

function rawPush(requestId = "request-1") {
  return JSON.stringify({
    data: { type: "message", region: "ID", content: {
      message_id: "2302748948493123953", request_id: requestId,
      from_id: 165105353, to_id: 947151379,
      message_type: "text", content: { text: "Where is my order?" },
      conversation_id: "709122092476686867", created_timestamp: 1726044721,
      region: "ID", source_content: { order_sn: "ORDER_20260909" }, business_type: 0,
      to_shop_id: Number(shopId), from_shop_id: 0,
    } },
    shop_id: Number(shopId), code: 10, timestamp: 1726044722,
  });
}

function rawMediaPush(type, options = {}) {
  const value = JSON.parse(rawPush(options.requestId ?? `request-${type}`));
  const content = value.data.content;
  content.message_id = options.messageId ?? `23027489484931239${
    type === "image" ? "61" : type === "video" ? "62" : "63"}`;
  content.message_type = type;
  content.created_timestamp = options.createdTimestamp ?? 1726044723;
  content.to_shop_id = options.seller ? 0 : Number(shopId);
  content.from_shop_id = options.seller ? Number(shopId) : 0;
  if (type === "image") {
    content.content = options.content ?? {
      url: "https://cf.shopee.vn/file/09591ecdc9f1dc7bd507817797d826fe_dynamic",
      thumb_url: "b9591ecdc9f1dc7bd507817797d826fe_dynamic_tn",
      thumb_height: 711, thumb_width: 400, file_server_id: 0,
    };
    content.source_content = {};
  } else if (type === "video") {
    content.content = options.content ?? {
      video_url: "cf03c9e1fe2c0992cdb51c3cb6eab2bd",
      thumb_url: "6c710d7679c9f3a9a7287250421d17d3_dynamic_tn",
      thumb_width: 399, thumb_height: 713, duration_seconds: 15,
    };
    content.source_content = {};
  } else {
    content.content = options.content ?? { shop_id: 109157255, item_id: 9112503530 };
    content.source_content = options.sourceContent ?? { item_id: 4112503530 };
  }
  value.timestamp = content.created_timestamp;
  return JSON.stringify(value);
}

function signedRequest(rawBody, authorization = createHmac("sha256", partnerKey)
  .update(`${callbackUrl}|${rawBody}`).digest("hex")) {
  return new Request(callbackUrl, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: rawBody,
  });
}

async function fixture(fixtureCallbackUrl = callbackUrl) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create schema vault;
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable
      security definer set search_path='' as $$select exists(
        select 1 from sellerpilot_private.admin_users where user_id=auth.uid()
      )$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid,channel text,environment text,status text,
      expires_at timestamptz,seller_account_key text,
      seller_account_key_source text not null,seller_account_verified_at timestamptz,
      vault_secret_id uuid
    );
    insert into auth.users values('${owner}'),('${admin}');
    insert into sellerpilot_private.admin_users values('${admin}');
    insert into vault.decrypted_secrets values(
      '${vaultSecretId}',
      '{"partner_id":"123456","partner_key":"${partnerKey}","shop_id":"${shopId}"}'
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credentialId}','${owner}','shopee','production','active',null,
      '${sellerAccountKey}','provider_certified_v1','${verifiedAt}','${vaultSecretId}'
    );
  `);
  await db.exec(canonicalSql);
  await db.exec(entitlementSql);
  await db.exec(pushSql);
  await db.exec(statusSql);
  await db.exec(mediaSql);
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities(
    owner_id,credential_id,shop_id,state,contract_revision,contract_source_url,
    contract_verified_at,app_approved_at,webhook_verified_at,evidence_sha256,
    credential_environment,credential_seller_account_key,
    credential_seller_account_verified_at,shop_binding_sha256
  ) values($1,$2,$3,'approved','revision_1',
    'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
    '2026-09-09T00:01:00Z','2026-09-09T00:02:00Z',$4,'production',$5,$6,$7)`,
  [owner, credentialId, shopId, capabilityEvidence, sellerAccountKey, verifiedAt, shopBinding]);
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements(
    entitlement_id,owner_id,credential_id,shop_id,state,entitlement_revision,
    contract_revision,contract_source_url,contract_verified_at,app_type,app_approved_at,
    webhook_event,webhook_verified_at,capability_evidence_sha256,credential_environment,
    credential_seller_account_key,credential_seller_account_verified_at,shop_binding_sha256,
    issued_at,expires_at
  ) values($1,$2,$3,$4,'approved','entitlement_1','revision_1',
    'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
    'seller_in_house_system','2026-09-09T00:01:00Z','webchat_push',
    '2026-09-09T00:02:00Z',$5,'production',$6,$7,$8,now()-interval '1 day',
    now()+interval '30 days')`,
  [entitlementId, owner, credentialId, shopId, capabilityEvidence,
    sellerAccountKey, verifiedAt, shopBinding]);

  const rpcCalls = [];
  const rpcErrors = [];
  const serviceClient = {
    async rpc(name, arguments_) {
      rpcCalls.push({ name, arguments_ });
      try {
        if (name === "sellerpilot_service_resolve_shopee_buyer_chat_push_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_resolve_shopee_buyer_chat_push_v1($1)
            result`, [arguments_.p_shop_id]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_read_shopee_chat_entitlement_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_read_shopee_chat_entitlement_v1(
              $1,$2,$3
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1(
              $1,$2,$3,$4::jsonb
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id, JSON.stringify(arguments_.p_page)]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_ingest_shopee_buyer_chat_push_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(
              $1,$2,$3,$4::jsonb,$5::jsonb
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id, JSON.stringify(arguments_.p_evidence),
            JSON.stringify(arguments_.p_page)]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_ingest_shopee_buyer_chat_media_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_ingest_shopee_buyer_chat_media_v1(
              $1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id, JSON.stringify(arguments_.p_evidence),
            JSON.stringify(arguments_.p_page), JSON.stringify(arguments_.p_media)]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_read_cs_shopee_buyer_chat_v1") {
          const result = await db.query(`select public.sellerpilot_read_cs_shopee_buyer_chat_v1(
            $1,$2,$3,$4,$5
          ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_conversation_id, arguments_.p_cursor, arguments_.p_limit]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_read_cs_shopee_buyer_chat_push_status_v1") {
          const result = await db.query(`select
            public.sellerpilot_read_cs_shopee_buyer_chat_push_status_v1($1,$2) result`,
          [arguments_.p_credential_id, arguments_.p_shop_id]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_read_cs_shopee_buyer_chat_media_v1") {
          const result = await db.query(`select
            public.sellerpilot_read_cs_shopee_buyer_chat_media_v1($1::jsonb) result`,
          [JSON.stringify(arguments_.p_scopes)]);
          return { data: result.rows[0].result, error: null };
        }
        throw new Error(`unexpected RPC ${name}`);
      } catch (error) {
        rpcErrors.push({ name, code: error.code, message: error.message });
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  };

  const exportsObject = {};
  const sandbox = vm.createContext({
    exports: exportsObject, Request, Response, URL, Headers, Buffer,
    console: { error() {}, warn() {}, info() {}, log() {} },
    require(name) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@supabase/supabase-js") return { createClient: () => serviceClient };
      if (name.endsWith("/buyer-chat-push")) return {
        persistVerifiedShopeeBuyerChatPush,
        readShopeeBuyerChatPushAddress,
        ShopeeBuyerChatPushError,
        shopeeBuyerChatPushTransportSchema,
        verifyAndNormalizeShopeeBuyerChatPush,
      };
      if (name.endsWith("/buyer-chat-ingest")) return { ShopeeBuyerChatIngestError };
      if (name.endsWith("/supabase/config")) {
        return { supabaseUrl: "https://fixture.supabase.co" };
      }
      if (name.endsWith("/worker-rpc")) return { createBoundedSupabaseFetch: () => fetch };
      throw new Error(`unexpected import ${name}`);
    },
    process: { env: {
      SUPABASE_SECRET_KEY: "fixture-service-secret",
      SHOPEE_BUYER_CHAT_PUSH_CALLBACK_URL: fixtureCallbackUrl,
    } },
  });
  vm.runInContext(transpiledRoute.outputText, sandbox);

  const adminExports = {};
  const adminSandbox = vm.createContext({
    exports: adminExports, Request, Response, URL,
    require(name) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => {
          await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
          return { user: { id: admin }, userClient: serviceClient };
        },
        isAdminApiError: value => value instanceof Response,
      };
      if (name.endsWith("/buyer-chat-contract")) return buyerChatContract;
      throw new Error(`unexpected admin import ${name}`);
    },
  });
  vm.runInContext(transpiledAdminRoute.outputText, adminSandbox);

  const uiExports = {};
  const uiSandbox = vm.createContext({
    exports: uiExports, module: { exports: uiExports },
    require(name) {
      if (name === "react" || name === "react/jsx-runtime") return requireFromTest(name);
      if (name.endsWith("/buyer-chat-contract")) return buyerChatContract;
      if (name.endsWith(".module.css")) return { default: { messages: "messages" } };
      throw new Error(`unexpected UI import ${name}`);
    },
  });
  vm.runInContext(transpiledUi.outputText, uiSandbox);
  const Content = uiExports.ShopeeBuyerChatStatusContent;
  const renderStatus = data => renderToStaticMarkup(createElement(Content, {
    data: createShopeeBuyerChatView(data), loading: false, loadingScopeKey: "", error: "",
    onLoad() {}, onLoadMore() {},
  }));
  return { db, rpcCalls, rpcErrors, serviceClient, POST: exportsObject.POST,
    GET: adminExports.GET, renderStatus };
}

test("actual signed route persists canonical message and exact replay only once", async () => {
  const { db, POST } = await fixture();
  try {
    const rawBody = rawPush();
    const first = await POST(signedRequest(rawBody));
    assert.equal(first.status, 204);
    assert.equal(await first.text(), "");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    const read = (await db.query(`select public.sellerpilot_read_cs_shopee_buyer_chat_v1(
      $1,$2,'709122092476686867',null,100
    ) result`, [credentialId, shopId])).rows[0].result;
    const ledger = shopeeBuyerChatReadSchema.parse(read);
    assert.equal(ledger.shops[0].messages[0].body, "Where is my order?");
    assert.equal(ledger.shops[0].messages[0].orderSn, "ORDER_20260909");
    assert.equal(ledger.reply, false);

    const replay = await POST(signedRequest(rawBody));
    assert.equal(replay.status, 204);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_messages`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_push_receipts`)).rows[0].n, 1);

    const drift = rawPush("request-2");
    assert.equal((await POST(signedRequest(drift))).status, 503);
    assert.equal((await POST(signedRequest(rawBody, "0".repeat(64)))).status, 401);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_messages`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_push_receipts`)).rows[0].n, 1);

    await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
      set state='revoked',revoked_at=now() where entitlement_id=$1`, [entitlementId]);
    assert.equal((await POST(signedRequest(rawBody))).status, 403);
  } finally { await db.close(); }
});

test("push transport resolver and canonical ingest stay service-role only", async () => {
  const { db } = await fixture();
  try {
    const signatures = [
      "public.sellerpilot_service_read_shopee_chat_entitlement_v1(uuid,text,uuid)",
      "public.sellerpilot_service_resolve_shopee_buyer_chat_push_v1(text)",
      "public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(uuid,text,uuid,jsonb,jsonb)",
      "public.sellerpilot_service_ingest_shopee_buyer_chat_media_v1(uuid,text,uuid,jsonb,jsonb,jsonb)",
    ];
    for (const signature of signatures) {
      for (const role of ["anon", "authenticated"]) {
        assert.equal((await db.query(`select has_function_privilege($1,$2,'execute') allowed`,
          [role, signature])).rows[0].allowed, false);
      }
      assert.equal((await db.query(`select has_function_privilege('service_role',$1,'execute')
        allowed`, [signature])).rows[0].allowed, true);
    }
  } finally { await db.close(); }
});

test("signed image, video and item pushes reach exact admin GET and mounted UI", async () => {
  const { db, POST, GET, renderStatus, rpcCalls, rpcErrors } = await fixture();
  const imageRaw = rawMediaPush("image", { messageId: "2302748948493123961" });
  const videoRaw = rawMediaPush("video", {
    messageId: "2302748948493123962", seller: true, createdTimestamp: 1726044724,
  });
  const itemRaw = rawMediaPush("item", {
    messageId: "2302748948493123963", createdTimestamp: 1726044725,
  });
  try {
    for (const rawBody of [imageRaw, videoRaw, itemRaw]) {
      const response = await POST(signedRequest(rawBody));
      assert.equal(response.status, 204,
        `${JSON.parse(rawBody).data.content.message_type}: ${await response.clone().text()} ${
          JSON.stringify(rpcErrors.at(-1))}`);
      assert.equal(await response.text(), "");
    }
    const response = await GET(new Request(
      `https://sellerpilot.invalid/buyer-chat?credentialId=${credentialId}&shopId=${shopId}&limit=100`,
    ));
    assert.equal(response.status, 200);
    const status = shopeeBuyerChatApiSchema.parse(await response.json());
    const image = status.shops[0].messages.find(message => message.media?.type === "image");
    const video = status.shops[0].messages.find(message => message.media?.type === "video");
    const item = status.shops[0].messages.find(message => message.media?.type === "item");
    assert.ok(image?.media?.type === "image");
    assert.equal(image.senderRole, "buyer");
    assert.equal(image.body, "Shopee 이미지 첨부");
    assert.equal(image.media.imageUrl,
      "https://cf.shopee.vn/file/09591ecdc9f1dc7bd507817797d826fe_dynamic");
    assert.equal(image.media.thumbnailReference,
      "b9591ecdc9f1dc7bd507817797d826fe_dynamic_tn");
    assert.equal(image.media.fileServerId, "0");
    assert.ok(video?.media?.type === "video");
    assert.equal(video.senderRole, "seller");
    assert.equal(video.media.videoReference, "cf03c9e1fe2c0992cdb51c3cb6eab2bd");
    assert.equal(video.media.durationSeconds, 15);
    assert.ok(item?.media?.type === "item");
    assert.equal(item.itemId, "9112503530");
    assert.equal(item.media.itemShopId, "109157255");
    assert.equal(item.media.sourceItemId, "4112503530");
    assert.equal(status.operationalReceive, false);
    assert.equal(status.automaticHistoryCollection, false);
    assert.equal(status.reply, false);
    const html = renderStatus(status);
    assert.match(html, /Shopee 원본 이미지 열기/u);
    assert.match(html, /동영상 첨부 · 15초 · 399×713/u);
    assert.match(html, /상품 정보 · 상품 shop 109157255 · item 9112503530/u);
    await verifyMountedStatus(status, ["Shopee 원본 이미지 열기",
      "동영상 첨부 · 15초 · 399×713",
      "상품 정보 · 상품 shop 109157255 · item 9112503530"]);

    assert.equal((await POST(signedRequest(imageRaw))).status, 204);
    for (const table of ["cs_shopee_buyer_chat_messages",
      "cs_shopee_buyer_chat_push_receipts", "cs_shopee_buyer_chat_message_media"]) {
      assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.${table}`))
        .rows[0].n, 3);
    }
    const imageCall = rpcCalls.find(call => call.name ===
      "sellerpilot_service_ingest_shopee_buyer_chat_media_v1");
    assert.ok(imageCall);
    await assert.rejects(db.query(`select
      public.sellerpilot_service_ingest_shopee_buyer_chat_media_v1(
        $1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb
      )`, [imageCall.arguments_.p_credential_id, imageCall.arguments_.p_shop_id,
      imageCall.arguments_.p_entitlement_id, JSON.stringify(imageCall.arguments_.p_evidence),
      JSON.stringify(imageCall.arguments_.p_page), JSON.stringify({
        ...imageCall.arguments_.p_media, descriptorDigest: "0".repeat(64),
      })]), /SHOPEE_BUYER_CHAT_MEDIA_EVIDENCE_INVALID/u);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    const wrongScope = (await db.query(`select
      public.sellerpilot_read_cs_shopee_buyer_chat_media_v1($1::jsonb) result`,
    [JSON.stringify([{ credentialId: "00000000-0000-4000-8000-000000099999",
      shopId, messages: [{ conversationId: image.conversationId,
        messageId: image.messageId }] }])])).rows[0].result;
    assert.deepEqual(wrongScope.records, []);

    const malicious = rawMediaPush("image", { messageId: "2302748948493123971",
      content: { url: "https://evil.test/file/payload", thumb_url: "safe_thumb",
        thumb_height: 100, thumb_width: 100, file_server_id: 0 } });
    const malformedVideo = rawMediaPush("video", { messageId: "2302748948493123972",
      content: { video_url: "opaque", thumb_url: "safe_thumb",
        thumb_height: 100, thumb_width: 100 } });
    const malformedItem = rawMediaPush("item", { messageId: "2302748948493123973",
      sourceContent: {} });
    for (const rawBody of [malicious, malformedVideo, malformedItem]) {
      assert.equal((await POST(signedRequest(rawBody))).status, 400);
    }
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_messages`)).rows[0].n, 3);
  } finally { await db.close(); }
});

test("signed push receipt reaches exact admin status and UI without promoting connection", async () => {
  const { db, POST, GET, renderStatus } = await fixture();
  const query = `?credentialId=${credentialId}&shopId=${shopId}&limit=100`;
  const readStatus = async (suffix = query) => {
    const response = await GET(new Request(`https://sellerpilot.invalid/buyer-chat${suffix}`));
    assert.equal(response.status, 200);
    return shopeeBuyerChatApiSchema.parse(await response.json());
  };
  try {
    const empty = await readStatus();
    assert.equal(empty.shops[0].push.receiverImplemented, true);
    assert.equal(empty.shops[0].push.credentialCurrent, true);
    assert.equal(empty.shops[0].push.entitlementCurrent, true);
    assert.equal(empty.shops[0].push.verifiedReceipt, false);
    assert.equal(empty.operationalReceive, false);
    assert.match(renderStatus(empty), /현재 수신 권한 유효 · 검증된 수신 기록 0건/u);

    const rawBody = rawPush();
    assert.equal((await POST(signedRequest(rawBody, "0".repeat(64)))).status, 401);
    assert.equal((await readStatus()).shops[0].push.verifiedReceipt, false);

    assert.equal((await POST(signedRequest(rawBody))).status, 204);
    const received = await readStatus();
    assert.equal(received.shops[0].push.verifiedReceipt, true);
    assert.ok(received.shops[0].push.lastVerifiedReceivedAt);
    assert.equal(received.shops[0].push.currentConnectionVerified, false);
    assert.equal(received.operationalReceive, false);
    const receivedHtml = renderStatus(received);
    assert.match(receivedHtml, /검증된 수신 기록 있음 · 현재 수신 권한 유효 · 연결 미검증/u);
    assert.match(receivedHtml, /마지막 검증된 수신/u);
    await verifyMountedStatus(received);
    const serialized = JSON.stringify(received);
    for (const forbidden of [partnerKey, callbackUrl, "authorizationSha256",
      "rawBodySha256", "callbackUrlSha256", "requestId"]) {
      assert.equal(serialized.includes(forbidden), false);
    }

    const mismatchCredential = "00000000-0000-4000-8000-000000099999";
    const mismatch = await readStatus(
      `?credentialId=${mismatchCredential}&shopId=${shopId}&limit=100`,
    );
    assert.deepEqual(mismatch.shops, []);

    await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
      set state='revoked',revoked_at=now() where entitlement_id=$1`, [entitlementId]);
    const revokedEntitlement = await readStatus();
    assert.equal(revokedEntitlement.shops[0].push.verifiedReceipt, true);
    assert.equal(revokedEntitlement.shops[0].push.credentialCurrent, true);
    assert.equal(revokedEntitlement.shops[0].push.entitlementCurrent, false);
    assert.equal(revokedEntitlement.operationalReceive, false);
    assert.match(renderStatus(revokedEntitlement), /과거 검증된 수신 기록 · 현재 수신 권한 없음/u);

    await db.query(`update sellerpilot_private.channel_credentials set status='revoked'
      where id=$1`, [credentialId]);
    const revokedCredential = await readStatus();
    assert.equal(revokedCredential.shops[0].push.verifiedReceipt, true);
    assert.equal(revokedCredential.shops[0].push.credentialCurrent, false);
    assert.equal(revokedCredential.shops[0].push.entitlementCurrent, false);
    assert.equal(revokedCredential.operationalReceive, false);

    const rotatedCredential = "00000000-0000-4000-8000-000000099013";
    const rotatedEntitlement = "00000000-0000-4000-8000-000000099014";
    const rotatedVault = "00000000-0000-4000-8000-000000099015";
    const rotatedBinding = sha([
      "sellerpilot-shopee-buyer-chat-shop-binding/1", rotatedCredential,
      sellerAccountKey, "production", shopId,
    ].join("\n"));
    await db.query(`insert into vault.decrypted_secrets values($1,$2)`, [rotatedVault,
      JSON.stringify({ partner_id: "123456", partner_key: partnerKey, shop_id: shopId })]);
    await db.query(`insert into sellerpilot_private.channel_credentials values(
      $1,$2,'shopee','production','active',null,$3,'provider_certified_v1',$4,$5
    )`, [rotatedCredential, owner, sellerAccountKey, verifiedAt, rotatedVault]);
    await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities(
      owner_id,credential_id,shop_id,state,contract_revision,contract_source_url,
      contract_verified_at,app_approved_at,webhook_verified_at,evidence_sha256,
      credential_environment,credential_seller_account_key,
      credential_seller_account_verified_at,shop_binding_sha256
    ) values($1,$2,$3,'approved','revision_1',
      'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
      '2026-09-09T00:01:00Z','2026-09-09T00:02:00Z',$4,'production',$5,$6,$7)`,
    [owner, rotatedCredential, shopId, "d".repeat(64), sellerAccountKey,
      verifiedAt, rotatedBinding]);
    await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements(
      entitlement_id,owner_id,credential_id,shop_id,state,entitlement_revision,
      contract_revision,contract_source_url,contract_verified_at,app_type,app_approved_at,
      webhook_event,webhook_verified_at,capability_evidence_sha256,credential_environment,
      credential_seller_account_key,credential_seller_account_verified_at,shop_binding_sha256,
      issued_at,expires_at
    ) values($1,$2,$3,$4,'approved','entitlement_2','revision_1',
      'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
      'seller_in_house_system','2026-09-09T00:01:00Z','webchat_push',
      '2026-09-09T00:02:00Z',$5,'production',$6,$7,$8,now()-interval '1 day',
      now()+interval '30 days')`,
    [rotatedEntitlement, owner, rotatedCredential, shopId, "d".repeat(64),
      sellerAccountKey, verifiedAt, rotatedBinding]);
    const rotated = await readStatus(
      `?credentialId=${rotatedCredential}&shopId=${shopId}&limit=100`,
    );
    assert.equal(rotated.shops[0].push.credentialCurrent, true);
    assert.equal(rotated.shops[0].push.entitlementCurrent, true);
    assert.equal(rotated.shops[0].push.verifiedReceipt, false);
    assert.equal(rotated.shops[0].push.lastVerifiedReceivedAt, null);
    assert.equal(rotated.operationalReceive, false);
  } finally { await db.close(); }
});

test("push observation is authenticated-admin only and exact-scope bounded", async () => {
  const { db } = await fixture();
  const signature =
    "public.sellerpilot_read_cs_shopee_buyer_chat_push_status_v1(uuid,text)";
  try {
    assert.equal((await db.query(`select has_function_privilege('authenticated',$1,'execute')
      allowed`, [signature])).rows[0].allowed, true);
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(`select has_function_privilege($1,$2,'execute') allowed`,
        [role, signature])).rows[0].allowed, false);
    }
    const mediaSignature = "public.sellerpilot_read_cs_shopee_buyer_chat_media_v1(jsonb)";
    assert.equal((await db.query(`select has_function_privilege('authenticated',$1,'execute')
      allowed`, [mediaSignature])).rows[0].allowed, true);
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(`select has_function_privilege($1,$2,'execute') allowed`,
        [role, mediaSignature])).rows[0].allowed, false);
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await assert.rejects(db.query(`select
      public.sellerpilot_read_cs_shopee_buyer_chat_push_status_v1($1,$2)`,
    [credentialId, shopId]), /administrator required/u);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await assert.rejects(db.query(`select
      public.sellerpilot_read_cs_shopee_buyer_chat_push_status_v1($1,null)`,
    [credentialId]), /PUSH_STATUS_SCOPE_INVALID/u);
    await assert.rejects(db.query(`select
      public.sellerpilot_read_cs_shopee_buyer_chat_media_v1($1::jsonb)`,
    [JSON.stringify([{ credentialId, shopId, messages: [
      { conversationId: "conversation_1", messageId: "message_1" },
      { conversationId: "conversation_1", messageId: "message_1" },
    ] }])]), /MEDIA_SCOPE_INVALID/u);
  } finally { await db.close(); }
});

test("central: unfiltered status and ledger select the same eight credential scopes", async () => {
  const { db, GET } = await fixture();
  try {
    for (let index = 1; index <= 8; index++) {
      const extraId = `00000000-0000-4000-8000-${String(100000 + index).padStart(12, "0")}`;
      const extraShop = String(900000000 - index);
      await db.query(`insert into sellerpilot_private.channel_credentials
        select $1,created_by,channel,environment,status,expires_at,seller_account_key,
          seller_account_key_source,seller_account_verified_at,vault_secret_id
        from sellerpilot_private.channel_credentials where id=$2`, [extraId, credentialId]);
      await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities
        (owner_id,credential_id,shop_id) values($1,$2,$3)`, [owner,extraId,extraShop]);
    }
    const response = await GET(new Request("https://sellerpilot.invalid/buyer-chat?limit=100"));
    assert.equal(response.status, 200);
    const result = shopeeBuyerChatApiSchema.parse(await response.json());
    assert.equal(result.shops.length, 8);
    assert.ok(result.shops.some(shop => shop.credentialId === credentialId));
    for (const shop of result.shops) {
      assert.equal(shop.push.credentialId, shop.credentialId);
      assert.equal(shop.push.shopId, shop.shopId);
    }
  } finally { await db.close(); }
});

test("signed localhost media reaches canonical SQL, actual admin GET and mounted UI", async () => {
  const rotatedCredential = "00000000-0000-4000-8000-000000099013";
  const rotatedEntitlement = "00000000-0000-4000-8000-000000099014";
  const rotatedVault = "00000000-0000-4000-8000-000000099015";
  const bridge = {};
  const { server, pageUrl } = await createCanonicalUiBridge({
    A: { credentialId, shopId },
    B: { credentialId: rotatedCredential, shopId },
  }, bridge);
  const runtime = await fixture(bridge.callbackUrl);
  bridge.POST = runtime.POST;
  bridge.GET = runtime.GET;
  const { db, serviceClient } = runtime;
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]);
  assert.ok(executablePath);
  let browser;
  let page;
  const sign = rawBody => createHmac("sha256", partnerKey)
    .update(`${bridge.callbackUrl}|${rawBody}`).digest("hex");
  const post = rawBody => fetch(bridge.postUrl, {
    method: "POST",
    headers: { authorization: sign(rawBody), "content-type": "application/json" },
    body: rawBody,
  });
  const adminRead = async (scopeCredential = credentialId) => {
    const url = new URL("/api/admin/cs/channels/shopee/buyer-chat", bridge.origin);
    url.searchParams.set("credentialId", scopeCredential);
    url.searchParams.set("shopId", shopId);
    url.searchParams.set("limit", "100");
    const response = await fetch(url);
    assert.equal(response.status, 200);
    return shopeeBuyerChatApiSchema.parse(await response.json());
  };
  const imageRaw = rawMediaPush("image", { messageId: "2302748948493123981" });
  const videoRaw = rawMediaPush("video", {
    messageId: "2302748948493123982", seller: true, createdTimestamp: 1726044724,
  });
  const itemRaw = rawMediaPush("item", {
    messageId: "2302748948493123983", createdTimestamp: 1726044725,
  });
  try {
    const historyRaw = rawPush("history-media-07");
    const normalizedHistory = verifyAndNormalizeShopeeBuyerChatPush({
      callbackUrl: bridge.callbackUrl,
      rawBody: historyRaw,
      partnerKey,
      authorization: sign(historyRaw),
      expectedShopId: shopId,
    });
    const history = await ingestAuthorizedShopeeBuyerChatPage({
      credentialId, shopId, entitlementId,
      page: { ...normalizedHistory.page, nextCursor: "history-page-2" },
    }, serviceClient);
    assert.equal(history.committedCursor, "history-page-2");

    for (const rawBody of [imageRaw, videoRaw, itemRaw]) {
      const response = await post(rawBody);
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
    }
    const maliciousRaw = rawMediaPush("image", {
      messageId: "2302748948493123984",
      content: { url: "https://evil.test/file/payload", thumb_url: "safe_thumb",
        thumb_height: 100, thumb_width: 100, file_server_id: 0 },
    });
    assert.equal((await post(maliciousRaw)).status, 400);

    const countsBeforeReplay = {};
    for (const table of ["cs_shopee_buyer_chat_messages",
      "cs_shopee_buyer_chat_push_receipts", "cs_shopee_buyer_chat_message_media"]) {
      countsBeforeReplay[table] = (await db.query(`select count(*)::int n
        from sellerpilot_private.${table}`)).rows[0].n;
    }
    assert.deepEqual(countsBeforeReplay, {
      cs_shopee_buyer_chat_messages: 4,
      cs_shopee_buyer_chat_push_receipts: 3,
      cs_shopee_buyer_chat_message_media: 3,
    });
    assert.equal((await post(imageRaw)).status, 204);
    for (const [table, count] of Object.entries(countsBeforeReplay)) {
      assert.equal((await db.query(`select count(*)::int n
        from sellerpilot_private.${table}`)).rows[0].n, count);
    }
    assert.equal((await db.query(`select committed_cursor
      from sellerpilot_private.cs_shopee_buyer_chat_ingest_progress`))
      .rows[0].committed_cursor, "history-page-2");

    const databaseMedia = (await db.query(`select message_id,media_type
      from sellerpilot_private.cs_shopee_buyer_chat_message_media
      order by message_id`)).rows;
    assert.deepEqual(databaseMedia, [
      { message_id: "2302748948493123981", media_type: "image" },
      { message_id: "2302748948493123982", media_type: "video" },
      { message_id: "2302748948493123983", media_type: "item" },
    ]);
    const api = await adminRead();
    const apiMessages = api.shops[0].messages;
    for (const expected of databaseMedia) {
      const message = apiMessages.find(value => value.messageId === expected.message_id);
      assert.equal(message?.conversationId, "709122092476686867");
      assert.equal(message?.media?.type, expected.media_type);
    }
    assert.equal(apiMessages.find(value => value.messageId ===
      "2302748948493123981")?.senderRole, "buyer");
    assert.equal(apiMessages.find(value => value.messageId ===
      "2302748948493123982")?.senderRole, "seller");
    assert.ok(apiMessages.some(value => value.body === "Where is my order?"));

    browser = await chromium.launch({ executablePath, headless: true,
      args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"] });
    page = await browser.newPage();
    page.setDefaultTimeout(8_000);
    const externalRequests = [];
    page.on("request", request => {
      if (!request.url().startsWith(bridge.origin)) externalRequests.push(request.url());
    });
    await page.goto(pageUrl);
    await page.locator("summary").click();
    await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).click();
    await page.getByRole("link", { name: "Shopee 원본 이미지 열기" }).waitFor();
    for (const expected of databaseMedia) {
      const row = page.locator(`[data-message-id="${expected.message_id}"]`);
      await row.waitFor();
      assert.equal(await row.getAttribute("data-conversation-id"), "709122092476686867");
    }
    assert.equal(await page.locator('[data-message-id="2302748948493123981"]')
      .getAttribute("data-sender-role"), "buyer");
    assert.equal(await page.locator('[data-message-id="2302748948493123982"]')
      .getAttribute("data-sender-role"), "seller");
    assert.equal(await page.getByRole("link", { name: "Shopee 원본 이미지 열기" })
      .getAttribute("href"),
    "https://cf.shopee.vn/file/09591ecdc9f1dc7bd507817797d826fe_dynamic");
    await page.getByText("동영상 첨부 · 15초 · 399×713").waitFor();
    await page.getByText("상품 정보 · 상품 shop 109157255 · item 9112503530").waitFor();
    await page.getByText("Where is my order?").waitFor();
    assert.equal(await page.locator('a[href*="evil.test"]').count(), 0);
    await page.waitForTimeout(100);
    assert.deepEqual(externalRequests, []);

    await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
      set state='revoked',revoked_at=now() where entitlement_id=$1`, [entitlementId]);
    await db.query(`update sellerpilot_private.channel_credentials set status='revoked'
      where id=$1`, [credentialId]);
    const rotatedBinding = sha([
      "sellerpilot-shopee-buyer-chat-shop-binding/1", rotatedCredential,
      sellerAccountKey, "production", shopId,
    ].join("\n"));
    await db.query(`insert into vault.decrypted_secrets values($1,$2)`, [rotatedVault,
      JSON.stringify({ partner_id: "123456", partner_key: partnerKey, shop_id: shopId })]);
    await db.query(`insert into sellerpilot_private.channel_credentials values(
      $1,$2,'shopee','production','active',null,$3,'provider_certified_v1',$4,$5
    )`, [rotatedCredential, owner, sellerAccountKey, verifiedAt, rotatedVault]);
    await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities(
      owner_id,credential_id,shop_id,state,contract_revision,contract_source_url,
      contract_verified_at,app_approved_at,webhook_verified_at,evidence_sha256,
      credential_environment,credential_seller_account_key,
      credential_seller_account_verified_at,shop_binding_sha256
    ) values($1,$2,$3,'approved','revision_1',
      'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
      '2026-09-09T00:01:00Z','2026-09-09T00:02:00Z',$4,'production',$5,$6,$7)`,
    [owner, rotatedCredential, shopId, "d".repeat(64), sellerAccountKey,
      verifiedAt, rotatedBinding]);
    await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements(
      entitlement_id,owner_id,credential_id,shop_id,state,entitlement_revision,
      contract_revision,contract_source_url,contract_verified_at,app_type,app_approved_at,
      webhook_event,webhook_verified_at,capability_evidence_sha256,credential_environment,
      credential_seller_account_key,credential_seller_account_verified_at,shop_binding_sha256,
      issued_at,expires_at
    ) values($1,$2,$3,$4,'approved','entitlement_2','revision_1',
      'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
      'seller_in_house_system','2026-09-09T00:01:00Z','webchat_push',
      '2026-09-09T00:02:00Z',$5,'production',$6,$7,$8,now()-interval '1 day',
      now()+interval '30 days')`,
    [rotatedEntitlement, owner, rotatedCredential, shopId, "d".repeat(64),
      sellerAccountKey, verifiedAt, rotatedBinding]);

    await page.locator("#media-session-b").click();
    await page.getByRole("link", { name: "Shopee 원본 이미지 열기" })
      .waitFor({ state: "detached" });
    for (const expected of databaseMedia) {
      assert.equal(await page.locator(`[data-message-id="${expected.message_id}"]`).count(), 0);
    }
    await page.getByRole("button", {
      name: "Buyer Chat 상태·저장 이력 새로고침",
    }).click();
    await page.getByText("현재 수신 권한 유효 · 검증된 수신 기록 0건").waitFor();
    const rotatedApi = await adminRead(rotatedCredential);
    assert.equal(rotatedApi.shops[0].messages.length, 0);
    assert.equal(await page.getByRole("link", { name: "Shopee 원본 이미지 열기" }).count(), 0);
    assert.equal(await page.locator('a[href*="evil.test"]').count(), 0);
    assert.deepEqual(externalRequests, []);
    assert.equal((await db.query(`select committed_cursor
      from sellerpilot_private.cs_shopee_buyer_chat_ingest_progress`))
      .rows[0].committed_cursor, "history-page-2");
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    await server.close();
    await db.close();
  }
});
