import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as contract from "../lib/channels/lazada-my-contract";

const source = await readFile(new URL("../app/api/admin/channel-credentials/lazada/authorize/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const credentialId = "11111111-1111-4111-8111-111111111111";
const otherCredentialId = "22222222-2222-4222-8222-222222222222";
const state = contract.lazadaOAuthState("a".repeat(32));
const cookie = `${state}.${credentialId}`;

class RouteResponse extends Response {
  cookies = { set() {} };
  static json(body: unknown, init?: ResponseInit) {
    return new RouteResponse(JSON.stringify(body), init);
  }
}

function fixture(options: { claimedId?: string | null; claimError?: boolean; admin?: boolean } = {}) {
  let consumed = false;
  const calls: string[] = [];
  const rpc = async (name: string) => {
    calls.push(name);
    if (name === "sellerpilot_is_admin") return { data: options.admin ?? true, error: null };
    if (name === "sellerpilot_list_credentials") return { data: [{ id: credentialId, channel: "lazada", status: "active" }], error: null };
    if (name === "sellerpilot_service_claim_channel_oauth_state") {
      if (options.claimError) return { data: null, error: { message: "fixture DB failure" } };
      const data = consumed ? null : Object.hasOwn(options, "claimedId") ? options.claimedId : credentialId;
      consumed = true;
      return { data, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  const sandbox = vm.createContext({
    exports: {}, Buffer, Request, Response, URL,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-service" } },
    require(name: string) {
      if (name === "node:crypto") return crypto;
      if (name === "zod") return { z };
      if (name === "next/server") return { NextResponse: RouteResponse };
      if (name === "@supabase/supabase-js") return {
        createClient: () => ({ rpc, auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } }, error: null }) } }),
      };
      if (name.endsWith("/lazada-my-contract")) return contract;
      if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://fixture.supabase.co", supabasePublishableKey: "fixture-publishable" };
      if (name.endsWith("/gateway")) return {
        exchangeOAuthViaChannelGateway: async (input: { credentialId: string; request: { country: string } }) => {
          assert.equal(input.credentialId, credentialId);
          assert.equal(input.request.country, "my");
          calls.push("exchange");
        },
        ChannelGatewayInProgressError: class extends Error {},
        ChannelGatewayReconciliationRequiredError: class extends Error {},
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(compiled, sandbox);
  const invoke = async (cookieValue = cookie) => {
    const request = Object.assign(new Request("https://fixture.test/api/admin/channel-credentials/lazada/authorize", {
      method: "POST",
      headers: { authorization: "Bearer fixture-user", "content-type": "application/json" },
      body: JSON.stringify({ oauthState: state, secretPayload: { authorization_code: "fixture-code", country: "my" } }),
    }), {
      nextUrl: new URL("https://fixture.test"),
      cookies: { get: () => cookieValue ? { value: cookieValue } : undefined },
    });
    return await sandbox.exports.POST(request) as Response;
  };
  return { invoke, calls };
}

test("actual Lazada route rejects missing or mismatched cookies before consuming state", async () => {
  for (const value of ["", `${contract.lazadaOAuthState("b".repeat(32))}.${credentialId}`, `${state}.invalid`]) {
    const f = fixture();
    assert.equal((await f.invoke(value)).status, 403);
    assert.equal(f.calls.includes("sellerpilot_service_claim_channel_oauth_state"), false);
    assert.equal(f.calls.includes("exchange"), false);
  }
});

test("actual Lazada route cannot exchange an absent or expired DB state using a live cookie", async () => {
  const f = fixture({ claimedId: null });
  assert.equal((await f.invoke()).status, 403);
  assert.equal(f.calls.includes("exchange"), false);
});

test("actual Lazada route requires the claimed credential to match the cookie", async () => {
  const f = fixture({ claimedId: otherCredentialId });
  assert.equal((await f.invoke()).status, 403);
  assert.equal(f.calls.includes("exchange"), false);
});

test("actual Lazada route exchanges once and rejects a replay after the mock RPC consumes state", async () => {
  const f = fixture();
  assert.equal((await f.invoke()).status, 200);
  assert.equal((await f.invoke()).status, 403);
  assert.equal(f.calls.filter(name => name === "exchange").length, 1);
});

test("actual Lazada route rejects DB errors and non-admins without exchange", async () => {
  for (const options of [{ claimError: true }, { admin: false }]) {
    const f = fixture(options);
    assert.equal((await f.invoke()).status, 403);
    assert.equal(f.calls.includes("exchange"), false);
    if (options.admin === false) assert.equal(f.calls.includes("sellerpilot_service_claim_channel_oauth_state"), false);
  }
});
