import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const diagnosticSource = await readFile(new URL("../lib/channel-diagnostics.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/admin/channel-credentials/test/route.ts", import.meta.url), "utf8");
const privateMarker = "private-secret-provider-or-db-message";
const credentialId = "32de2968-d4b7-4fda-a84b-16a7ce0257cc";
const owner = "11111111-1111-4111-8111-111111111111";
const payload = { vendor_id: "A01601472", access_key: "fixture-access", secret_key: privateMarker };
const diagnostic = { status: "passed", message: "fixture verified diagnostic" };
const normalize = value => JSON.parse(JSON.stringify(value));

// Execute complete transpiled source, mocking imports only. No auth bypass,
// production request, Supabase connection, credential file or provider network.
function load(source, modules) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = vm.createContext({
    exports: {}, URLSearchParams, Request, Response,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-service" } },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
    fetch() { throw new Error("UNEXPECTED_REAL_NETWORK"); },
    console: { log() { assert.fail("No logs expected"); }, error() { assert.fail("No logs expected"); } },
  });
  vm.runInContext(js, context, { timeout: 1_000 });
  return context.exports;
}
function diagnosticFixture({ data = { code: "SUCCESS", data: [{ vendorId: "A01601472" }] }, ok = true, status = 200, error = null } = {}) {
  const calls = [];
  const remote = async input => {
    calls.push(input);
    if (error) throw error;
    return { response: { ok, status }, data };
  };
  const protocols = Object.fromEntries([
    "coupangRequest", "elevenstRequest", "ebayRequest", "lazadaRequest", "naverRequest", "qoo10Request", "shopeeRequest", "temuRequest",
  ].map(name => [name, remote]));
  protocols.textValue = (value, key) => typeof value[key] === "string" ? value[key].trim() : "";
  protocols.fetchNaverAccessToken = async () => ({ accessToken: "fixture-only", expiresIn: 3600 });
  return { calls, run: load(diagnosticSource, {
    "./channels/protocols": protocols,
    "./channels/catalog": { isActiveChannelKey: key => ["coupang", "qoo10", "shopee", "lazada", "smartstore", "elevenst", "ebay", "temu"].includes(key) },
  }).runChannelDiagnostic };
}

test("Coupang passed requires exact SUCCESS, one row and the requested A01601472 seller", async () => {
  const f = diagnosticFixture();
  const result = await f.run("coupang", payload);
  assert.equal(result.status, "passed");
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.method, "GET");
  assert.equal(call.path, "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products");
  assert.equal(call.query.toString(), "vendorId=A01601472&maxPerPage=1");
  assert.equal(call.body, undefined);
});
for (const code of [undefined, null, "", 0, "success", " Success", "ERROR", "FAIL", privateMarker]) {
  test(`Coupang rejects non-exact SUCCESS code ${String(code)}`, async () => {
    const f = diagnosticFixture({ data: { code, data: [{ vendorId: payload.vendor_id }], message: privateMarker, requestId: privateMarker } });
    const result = await f.run("coupang", payload);
    assert.equal(result.status, "failed");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateMarker));
  });
}
for (const data of [undefined, null, {}, "[]", [{ vendorId: "A01601472" }, { vendorId: "A01601472" }], [null], [[]], [{}], [{ vendorId: "OTHER" }], [{ vendorId: 1601472 }], [{ vendorId: " A01601472" }]]) {
  test(`Coupang rejects invalid list or seller readback ${JSON.stringify(data)}`, async () => {
    const f = diagnosticFixture({ data: { code: "SUCCESS", data } });
    assert.equal((await f.run("coupang", payload)).status, "failed");
  });
}
test("Coupang empty array reports successful read scope but manual/unverified seller readback", async () => {
  const f = diagnosticFixture({ data: { code: "SUCCESS", data: [] } });
  const result = await f.run("coupang", payload);
  assert.equal(result.status, "manual");
  assert.match(result.message, /읽기 범위는 성공/);
  assert.match(result.message, /판매자 ID readback은 미확인/);
});
test("Coupang HTTP failure cannot pass despite SUCCESS and correct identity", async () => {
  const f = diagnosticFixture({ ok: false, status: 403 });
  assert.equal((await f.run("coupang", payload)).status, "failed");
});
test("Coupang vendor is credential-bound, never invented or replaced with this account", async () => {
  const f = diagnosticFixture({ data: { code: "SUCCESS", data: [{ vendorId: "A09999999" }] } });
  assert.equal((await f.run("coupang", { ...payload, vendor_id: "A09999999" })).status, "passed");
  assert.equal(f.calls[0].query.get("vendorId"), "A09999999");
  const missing = diagnosticFixture();
  assert.equal((await missing.run("coupang", { ...payload, vendor_id: "" })).status, "failed");
  assert.equal(missing.calls.length, 0);
});
test("Coupang transport exceptions remain failed and sanitized", async () => {
  const f = diagnosticFixture({ error: new Error(privateMarker) });
  const result = await f.run("coupang", payload);
  assert.equal(result.status, "failed");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateMarker));
});

for (const [channel, credentials, data] of [
  ["lazada", { country: "my" }, { code: "0" }],
  ["shopee", { partner_id: "1", partner_key: "fixture", shop_id: "2", access_token: "fixture" }, {}],
  ["qoo10", { api_key: "fixture", seller_id: "fixture", test_item_code: "fixture" }, { ResultCode: "0", ResultObject: {} }],
  ["elevenst", { api_key: "a".repeat(32) }, { accepted: true }],
  ["smartstore", {}, {}],
  ["ebay", { access_token: "fixture", refresh_token: "fixture" }, { sellerRegistrationCompleted: true }],
  ["temu", { app_key: "fixture", app_secret: "fixture", access_token: "fixture" }, { success: true }],
]) {
  test(`other channel diagnostic behavior preserved: ${channel}`, async () => {
    const f = diagnosticFixture({ data });
    assert.equal((await f.run(channel, credentials)).status, "passed");
    const failed = diagnosticFixture({ data, ok: false, status: 403 });
    assert.equal((await failed.run(channel, credentials)).status, "failed");
  });
}

async function routeFixture({ channel = "coupang", result = diagnostic, recordMode = "ok", executionThrows = false, admin = true, token = true, active = true } = {}) {
  const calls = [];
  const recordCalls = [];
  const sdk = {
    createClient(_url, key) {
      if (key === "fixture-public") return {
        auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) },
        rpc: async name => ({ data: name === "sellerpilot_is_admin" ? admin : [{ id: credentialId, channel, status: active ? "active" : "revoked", environment: "production" }], error: null }),
      };
      assert.equal(key, "fixture-service");
      return { rpc: async (name, args) => {
        calls.push(name);
        if (name === "sellerpilot_decrypt_credential") return { data: payload, error: null };
        assert.equal(name, "sellerpilot_record_credential_test");
        recordCalls.push(normalize(args));
        if (recordMode === "throw") throw new Error(privateMarker);
        return { data: null, error: recordMode === "error" ? { message: privateMarker, details: privateMarker } : null };
      } };
    },
  };
  const execute = async () => { calls.push("diagnostic"); if (executionThrows) throw new Error(privateMarker); return result; };
  const { POST } = load(routeSource, {
    "@supabase/supabase-js": sdk,
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    zod: { z },
    "../../../../../lib/channel-diagnostics": { runChannelDiagnostic: execute },
    "../../../../../lib/channels/gateway": { executeDiagnosticViaChannelGateway: execute },
    "../../../../../lib/logistics/tracx": { runTracxDiagnostic: execute },
    "../../../../../lib/supabase/config": { supabasePublishableKey: "fixture-public", supabaseUrl: "https://fixture.invalid" },
  });
  const response = await POST(new Request("https://fixture.invalid/api/admin/channel-credentials/test", {
    method: "POST", headers: { ...(token ? { authorization: "Bearer fixture-token" } : {}), "content-type": "application/json" },
    body: JSON.stringify({ credentialId, channel }),
  }));
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), new RegExp(privateMarker));
  return { response, body, calls, recordCalls };
}
for (const status of ["passed", "manual", "failed"]) {
  for (const recordMode of ["error", "throw"]) {
    test(`record ${recordMode} after ${status} returns 503, not provider-failure retry or 200`, async () => {
      const r = await routeFixture({ result: { ...diagnostic, status }, recordMode });
      assert.equal(r.response.status, 503);
      assert.equal(r.body.code, "CREDENTIAL_TEST_RECORD_FAILED");
      assert.equal(r.body.diagnosticStatus, status);
      assert.equal(r.body.recordingStatus, "unverified");
      assert.equal(r.recordCalls.length, 1);
      assert.equal(r.recordCalls[0].p_status, status);
      assert.equal(r.calls.filter(x => x === "diagnostic").length, 1);
      assert.equal(r.response.headers.get("cache-control"), "no-store, max-age=0");
    });
  }
  test(`successful recording preserves ${status} diagnostic and response status`, async () => {
    const r = await routeFixture({ result: { ...diagnostic, status } });
    assert.equal(r.response.status, status === "failed" ? 422 : 200);
    assert.deepEqual(r.body, { ...diagnostic, status });
    assert.equal(r.recordCalls.length, 1);
    assert.equal(r.recordCalls[0].p_credential_id, credentialId);
  });
}
for (const channel of ["coupang", "lazada", "shopee", "elevenst", "smartstore", "ebay", "temu", "qoo10", "tracx"]) {
  test(`all route recording paths check RPC errors without changing diagnostics: ${channel}`, async () => {
    const good = await routeFixture({ channel });
    assert.equal(good.response.status, 200);
    assert.deepEqual(good.body, diagnostic);
    const failed = await routeFixture({ channel, recordMode: "error" });
    assert.equal(failed.response.status, 503);
    assert.equal(failed.recordCalls.length, 1);
    assert.equal(failed.recordCalls[0].p_status, "passed");
  });
}
for (const channel of ["coupang", "tracx"]) {
  test(`execution failure ${channel} records failed once; record failure remains distinct`, async () => {
    const good = await routeFixture({ channel, executionThrows: true });
    assert.equal(good.response.status, 422);
    assert.equal(good.body.status, "failed");
    assert.equal(good.recordCalls.length, 1);
    const bad = await routeFixture({ channel, executionThrows: true, recordMode: "throw" });
    assert.equal(bad.response.status, 503);
    assert.equal(bad.body.diagnosticStatus, "failed");
    assert.equal(bad.recordCalls.length, 1);
  });
}
test("empty Coupang scope flows through route as manual, never persisted as passed", async () => {
  const f = diagnosticFixture({ data: { code: "SUCCESS", data: [] } });
  const result = await f.run("coupang", payload);
  const r = await routeFixture({ result });
  assert.equal(r.response.status, 200);
  assert.equal(r.body.status, "manual");
  assert.equal(r.recordCalls[0].p_status, "manual");
  assert.match(r.body.message, /readback은 미확인/);
});
test("existing authorization and active-credential gates still prevent execution and recording", async () => {
  for (const [options, expected] of [[{ token: false }, 401], [{ admin: false }, 403], [{ active: false }, 409]]) {
    const r = await routeFixture(options);
    assert.equal(r.response.status, expected);
    assert.equal(r.recordCalls.length, 0);
    assert.equal(r.calls.length, 0);
  }
});
