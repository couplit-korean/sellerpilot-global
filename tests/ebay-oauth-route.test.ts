import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as scopes from "../lib/channels/ebay-oauth-scopes";
import { buildEbayConsentUrl, textValue } from "../lib/channels/protocols";

const source = await readFile(new URL("../app/api/admin/channel-credentials/ebay/authorize/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const id = "11111111-1111-4111-8111-111111111111";
const state = `sellerpilot-ebay-${"a".repeat(32)}`;
class TestResponse extends Response {
  savedCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  cookies = { set: (name: string, value: string, options: Record<string, unknown>) => this.savedCookies.push({ name, value, options }) };
  static json(body: unknown, init?: ResponseInit) { return new TestResponse(JSON.stringify(body), init); }
}

async function call(body: unknown, { cookie = "", denied = false, previousScopes = "" } = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "sellerpilot_is_admin") return { data: !denied, error: null };
    if (name === "sellerpilot_list_credentials") return { data: [{ id, channel: "ebay", status: "active", environment: "production" }], error: null };
    if (name === "sellerpilot_decrypt_credential") return { data: { client_id: "fixture-client", client_secret: "fixture-secret", ru_name: "fixture-runame", access_token: "fixture-token", scopes: previousScopes }, error: null };
    throw new Error(`unexpected mutation ${name}`);
  };
  const sandbox = vm.createContext({ exports: {}, Buffer, Request, Response, URL, process: { env: { SUPABASE_SECRET_KEY: "fixture-service" } }, require(name: string) {
    if (name === "node:crypto") return crypto;
    if (name === "zod") return { z };
    if (name === "next/server") return { NextResponse: TestResponse };
    if (name === "@supabase/supabase-js") return { createClient: () => ({ rpc, auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) } }) };
    if (name.endsWith("/protocols")) return { buildEbayConsentUrl, textValue };
    if (name.endsWith("/ebay-oauth-scopes")) return scopes;
    if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://fixture.supabase.co", supabasePublishableKey: "fixture-publishable" };
    if (name.endsWith("/gateway")) return {
      exchangeOAuthViaChannelGateway: async (args: Record<string, unknown>) => { calls.push({ name: "exchange", args }); },
      ChannelGatewayInProgressError: class extends Error {}, ChannelGatewayReconciliationRequiredError: class extends Error {},
    };
    throw new Error(`unexpected import ${name}`);
  } });
  vm.runInContext(compiled, sandbox);
  const request = Object.assign(new Request("https://fixture.test/api/admin/channel-credentials/ebay/authorize", {
    method: "POST", headers: { authorization: "Bearer fixture-user", "content-type": "application/json" }, body: JSON.stringify(body),
  }), { nextUrl: new URL("https://fixture.test"), cookies: { get: () => cookie ? { value: cookie } : undefined } });
  return { response: await sandbox.exports.POST(request) as TestResponse, calls };
}

test("message consent URL retains selling scopes without rotating the active credential", async () => {
  for (const includeMessages of [false, true]) {
    const result = await call({ credentialId: id, startOAuth: true, includeMessages });
    assert.equal(result.response.status, 200);
    const body = await result.response.json();
    const url = new URL(body.authorizationUrl);
    assert.equal(url.origin, "https://auth.ebay.com");
    assert.deepEqual(url.searchParams.get("scope")?.split(" "), scopes.ebayOAuthScopes({}, includeMessages));
    assert.equal(result.calls.some(c => c.name === "exchange" || c.name.includes("rotate")), false);
    const cookie = result.response.savedCookies[0];
    assert.equal(scopes.parseEbayOAuthCookie(cookie.value)?.includeMessages, includeMessages);
    assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.secure, true);
    assert.doesNotMatch(JSON.stringify(body), /fixture-secret|fixture-token/);
  }
});

test("ordinary reconnection preserves an existing message grant", async () => {
  const result = await call({ credentialId: id, startOAuth: true }, { previousScopes: scopes.ebayMessageScope });
  assert.equal(scopes.parseEbayOAuthCookie(result.response.savedCookies[0].value)?.includeMessages, true);
});

test("callback capability comes from the consent cookie, never the callback body", async () => {
  for (const includeMessages of [false, true]) {
    const result = await call({ credentialId: id, oauthState: state, includeMessages: !includeMessages, secretPayload: { authorization_code: "fixture-code" } }, {
      cookie: `${state}.${id}${includeMessages ? ".messages" : ""}`,
    });
    assert.equal(result.response.status, 200);
    const request = result.calls.find(c => c.name === "exchange")?.args?.request;
    assert.deepEqual(JSON.parse(JSON.stringify(request)), { code: "fixture-code", includeMessages });
    if (includeMessages) assert.match((await result.response.json()).message, /별도 조회 검증/);
  }
});

test("unauthorized, expired or mismatched callbacks never enqueue exchange", async () => {
  for (const options of [{ denied: true }, { cookie: "" }, { cookie: `${state}.${id}.bad` }, { cookie: `${state.replace(/a/g, "b")}.${id}` }]) {
    const result = await call({ oauthState: state, secretPayload: { authorization_code: "fixture-code" } }, options);
    assert.equal(result.response.status, 403);
    assert.equal(result.calls.some(c => c.name === "exchange"), false);
  }
});

test("callback credential must belong to the authenticated owner's active eBay list", async () => {
  const otherId = "99999999-9999-4999-8999-999999999999";
  const result = await call({ oauthState: state, secretPayload: { authorization_code: "fixture-code" } }, { cookie: `${state}.${otherId}.messages` });
  assert.equal(result.response.status, 409);
  assert.equal(result.calls.some(c => c.name === "exchange" || c.name === "sellerpilot_decrypt_credential"), false);
});
