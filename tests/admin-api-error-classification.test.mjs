import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const marker = "PRIVATE_TOKEN_SDK_BODY_MUST_NOT_ESCAPE";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const url = "https://sqaoqucxakebqkiygdxb.supabase.co";
const now = Math.floor(Date.now() / 1000);
const claimsData = {
  header: { alg: "ES256", kid: "fixture-key-id" },
  claims: { sub: userId, session_id: sessionId, iss: `${url}/auth/v1`, aud: "authenticated", role: "authenticated", iat: now - 60, exp: now + 3600 },
};
class TestResponse extends Response {
  static json(body, init = {}) { return new TestResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } }); }
}

// Complete helper source executes against import mocks only. No signed token,
// cookie access, DB call, server request or production Auth attempt is performed.
async function run({ mode = "getUser", authError = null, adminError = null, adminData = true, adminStatus = 200, missingAdminData = false,
  authThrows = false, adminThrows = false, sdkThrows = false, serviceThrows = false, user = { id: userId }, claims = claimsData,
  authorization = `Bearer ${marker}`, config = true, hang = null, timeoutMs = undefined } = {}) {
  const trace = [];
  let clientCount = 0, serviceCount = 0;
  const ctx = vm.createContext({
    exports: {}, setTimeout, clearTimeout, Date,
    process: { env: { SUPABASE_SECRET_KEY: config ? "fixture-service" : "" } },
    require(name) {
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name === "./supabase/config") return { supabaseUrl: url, supabasePublishableKey: "fixture-public" };
      if (name === "@supabase/supabase-js") return { createClient(_url, key, options) {
        clientCount++;
        if (sdkThrows) throw new Error(marker);
        if (key === "fixture-service") { serviceCount++; if (serviceThrows) throw new Error(marker); return { identity: "service" }; }
        assert.equal(key, "fixture-public");
        assert.equal(options.global.headers.Authorization, `Bearer ${marker}`);
        const auth = method => async token => {
          trace.push(method); assert.equal(token, marker);
          if (hang === "auth") return new Promise(() => {});
          if (authThrows) throw authError ?? new Error(marker);
          return { data: method === "getUser" ? { user } : claims, error: authError };
        };
        return { identity: "user", auth: { getUser: auth("getUser"), getClaims: auth("getClaims") },
          rpc: async name => {
            trace.push(name); assert.equal(name, "sellerpilot_is_admin");
            if (hang === "admin") return new Promise(() => {});
            if (adminThrows) throw adminError ?? new Error(marker);
            return { data: missingAdminData ? undefined : adminData, error: adminError, status: adminStatus };
          } };
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
    fetch() { assert.fail("No real network allowed"); },
    console: { log() { assert.fail("No logs allowed"); }, error() { assert.fail("No logs allowed"); } },
  });
  vm.runInContext(compiled, ctx, { timeout: 1000 });
  const result = await ctx.exports.authenticateAdminRequest(new Request("https://fixture.invalid", { headers: { authorization } }), {
    verifyAsymmetricClaimsLocally: mode === "claims", timeoutMs,
  });
  const isError = ctx.exports.isAdminApiError(result);
  const body = isError ? await result.json() : null;
  if (body) assert.doesNotMatch(JSON.stringify(body), new RegExp(marker));
  return { result, body, isError, trace, clientCount, serviceCount };
}
async function denied(options, status, code) {
  const r = await run(options);
  assert.equal(r.isError, true);
  assert.equal(r.result.status, status);
  if (code) assert.equal(r.body.code, code);
  assert.equal(r.serviceCount, 0, "No privileged client may be created on verification failure");
  if (code) assert.equal(r.result.headers.get("cache-control"), "no-store, max-age=0");
  return r;
}
for (const mode of ["getUser", "claims"]) {
  test(`${mode}: only a verified user and strict true admin yields original context`, async () => {
    const r = await run({ mode });
    assert.equal(r.isError, false); assert.equal(r.result.user.id, userId);
    assert.equal(r.result.userClient.identity, "user"); assert.equal(r.result.serviceClient.identity, "service");
    assert.equal(r.serviceCount, 1); assert.equal(r.clientCount, 2);
    assert.deepEqual(r.trace, [mode === "claims" ? "getClaims" : "getUser", "sellerpilot_is_admin"]);
  });
  test(`${mode}: explicit false alone returns real permission 403`, async () => {
    await denied({ mode, adminData: false }, 403, "ADMIN_ACCESS_DENIED");
  });
  for (const error of [
    { code: "PGRST002", message: marker, status: 503 },
    { code: "PGRST002", message: marker },
    { status: 503, message: marker },
    { code: "42501", message: marker },
    { code: "PGRST301", status: 401, message: marker },
    { name: "AbortError", message: marker },
    { name: "TypeError", message: marker },
  ]) {
    test(`${mode}: admin RPC ${error.code ?? error.status ?? error.name} is 503 even with true/false data`, async () => {
      for (const adminData of [true, false]) await denied({ mode, adminError: error, adminData }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
    });
  }
  for (const adminData of [null, undefined, 0, 1, "true", "false", [], {}]) {
    test(`${mode}: malformed admin result ${JSON.stringify(adminData)} is unverified`, async () => {
      await denied({ mode, adminData, missingAdminData: adminData === undefined }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
    });
  }
  test(`${mode}: RPC HTTP 503 cannot grant even when error null/data true`, async () => {
    await denied({ mode, adminStatus: 503 }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
  });
  for (const error of [
    { status: 500, code: "bad_jwt", message: marker },
    { status: 502, message: marker },
    { status: 503, message: marker },
    { status: 504, message: marker },
    { status: 429, message: marker },
    { name: "AuthRetryableFetchError", status: 0, message: marker },
    { name: "AuthUnknownError", message: marker },
  ]) {
    test(`${mode}: Auth service ${error.status ?? error.name} is 503, never a permission denial`, async () => {
      await denied({ mode, authError: error, adminData: false }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
    });
  }
  for (const error of [
    { status: 401, message: marker },
    { status: 403, message: marker },
    { status: 400, code: "bad_jwt", message: marker },
    { status: 400, code: "session_expired", message: marker },
    { status: 400, name: "AuthSessionMissingError", message: marker },
    { status: 400, name: "AuthInvalidJwtError", code: "invalid_jwt", message: marker },
  ]) {
    test(`${mode}: confirmed invalid session ${error.code ?? error.name ?? error.status} returns 401`, async () => {
      await denied({ mode, authError: error }, 401, "ADMIN_SESSION_INVALID");
      await denied({ mode, authError: error, authThrows: true }, 401, "ADMIN_SESSION_INVALID");
    });
  }
  test(`${mode}: thrown admin error is safely 503 and never raw`, async () => {
    await denied({ mode, adminThrows: true, adminError: { status: 401, message: marker } }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
  });
  test(`${mode}: missing user/claims is unknown, not permission false or approval`, async () => {
    await denied({ mode, user: null, claims: null }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
  });
  for (const hang of ["auth", "admin"]) {
    test(`${mode}: ${hang} timeout is bounded and never constructs privileged client`, async () => {
      const start = Date.now();
      await denied({ mode, hang, timeoutMs: 5 }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
      assert.ok(Date.now() - start < 1000);
    });
  }
}
for (const authorization of ["", "Bearer ", "Basic fixture"]) {
  test(`missing bearer ${JSON.stringify(authorization)} is 401 without network/client creation`, async () => {
    const r = await denied({ authorization }, 401, "ADMIN_SESSION_INVALID");
    assert.equal(r.clientCount, 0); assert.equal(r.trace.length, 0);
  });
}
test("malformed Auth user object cannot approve a context", async () => {
  for (const user of [{}, { id: "not-a-uuid" }]) await denied({ user }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
});
test("SDK construction errors have a safe 503 boundary", async () => {
  await denied({ sdkThrows: true }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
  const r = await run({ serviceThrows: true });
  assert.equal(r.isError, true); assert.equal(r.result.status, 503);
  assert.equal(r.body.code, "ADMIN_VERIFICATION_UNAVAILABLE");
});
test("missing server configuration stays 503 without clients or approval", async () => {
  const r = await denied({ config: false }, 503);
  assert.equal(r.clientCount, 0);
});
for (const patch of [
  { header: { alg: "HS256", kid: "fixture" } },
  { header: { alg: "ES256" } },
  { claims: { ...claimsData.claims, iss: "https://foreign.invalid/auth/v1" } },
  { claims: { ...claimsData.claims, role: "service_role" } },
  { claims: { ...claimsData.claims, aud: "anon" } },
  { claims: { ...claimsData.claims, session_id: "missing" } },
  { claims: { ...claimsData.claims, sub: "missing" } },
  { claims: { ...claimsData.claims, exp: now - 60 } },
]) {
  test(`local verified-claims fences remain fail-closed: ${JSON.stringify(patch)}`, async () => {
    const r = await denied({ mode: "claims", claims: { ...claimsData, ...patch } }, 401, "ADMIN_SESSION_INVALID");
    assert.equal(r.trace.includes("getUser"), false, "No identity-verification fallback");
  });
}

test("admin RPC missing/non-success status never authorizes even with strict true data", async () => {
  for (const adminStatus of [0, 199, 301, null, "200"]) await denied({ adminStatus }, 503, "ADMIN_VERIFICATION_UNAVAILABLE");
});
test("known invalid session remains 401 while a concurrent admin RPC is unavailable", async () => {
  await denied({ authError: { status: 401, message: marker }, adminError: { code: "PGRST002", message: marker } }, 401, "ADMIN_SESSION_INVALID");
});
