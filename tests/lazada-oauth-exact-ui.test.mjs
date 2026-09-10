import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const center = await readFile(new URL("../app/api-credential-center.tsx", import.meta.url), "utf8");
const actor = "11111111-1111-4111-8111-111111111111";
const credential = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const exactState = `sellerpilot-lazada-my-${"e".repeat(32)}`;
const legacyState = `sellerpilot-lazada-${"n".repeat(32)}`;

const start = source.indexOf("    const startExact = async");
const end = source.indexOf("    const listener =", start);
assert.ok(start > 0 && end > start);
const startJs = ts.transpileModule(`${source.slice(start, end)}\nreturn startExact;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const scenario of ["prepare", "no-worker", "auth-mismatch", "bad-origin", "prepare-failure", "ready"]) {
  test(`Lazada exact UI start ${scenario}`, async () => {
    const sent = [];
    const redirects = [];
    const toasts = [];
    const stored = [];
    const prepared = scenario === "prepare" || scenario === "prepare-failure"
      ? null
      : { credentialId: credential, sessionId: session, actorId: actor, expiresAt: Date.now() + 60_000 };
    const fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push({ url, body });
      const payload = scenario === "prepare"
        ? { status: "executor_required", sessionId: session }
        : scenario === "no-worker"
          ? { status: "executor_required" }
          : { status: "ready", authorizationUrl: `${scenario === "bad-origin" ? "https://evil.invalid" : "https://auth.lazada.com"}/oauth/authorize?state=${exactState}` };
      return { ok: scenario !== "prepare-failure", json: async () => scenario === "prepare-failure" ? { status: "blocked" } : payload };
    };
    const deps = {
      userId: actor,
      lazadaExactStarting: { current: false },
      createSupabaseClient: () => ({
        auth: { getSession: async () => ({ data: { session: { user: { id: scenario === "auth-mismatch" ? "other" : actor }, access_token: "fixture-token" } } }) },
      }),
      readLazadaExactBrowserSession: () => prepared,
      window: { sessionStorage: { setItem: (...args) => stored.push(args) }, location: { assign: value => redirects.push(value) } },
      lazadaExactBrowserKey: "sellerpilot.lazada-exact-session.v1",
      setOAuthToastMessage: value => toasts.push(value),
      fetch,
      URL,
    };
    const handler = new Function(...Object.keys(deps), startJs)(...Object.values(deps));
    await handler({ detail: { credentialId: credential } });
    assert.equal(deps.lazadaExactStarting.current, false);
    assert.ok(sent.every(request => request.url === "/api/admin/channel-credentials/lazada/exact"));
    assert.equal(sent.length, scenario === "auth-mismatch" ? 0 : 1);
    assert.equal(redirects.length, scenario === "ready" ? 1 : 0);
    assert.equal(stored.length, ["prepare", "ready"].includes(scenario) ? 1 : 0);
    if (scenario === "ready") assert.equal(JSON.parse(stored[0][1]).state, exactState);
  });
}

const completeStart = source.indexOf("    const completeChannelOAuth = async () => {");
const completeEnd = source.indexOf("    void completeChannelOAuth();", completeStart);
assert.ok(completeStart > 0 && completeEnd > completeStart);
const completeJs = ts.transpileModule(`${source.slice(completeStart, completeEnd)}\nreturn completeChannelOAuth;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const scenario of ["legacy", "stale-exact", "exact"]) {
  test(`Lazada callback ${scenario}`, async () => {
    const calls = [];
    const removed = [];
    const toasts = [];
    const state = scenario === "legacy" ? legacyState : exactState;
    const exact = scenario === "legacy"
      ? null
      : { sessionId: session, credentialId: credential, actorId: actor, expiresAt: Date.now() + 60_000, state: scenario === "exact" ? exactState : `${exactState}x` };
    const fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => url.endsWith("/exact") ? { status: "bound" } : { message: "stored" } };
    };
    const deps = {
      pendingChannelOAuth: { channel: "lazada", state, code: "fixture-code" },
      userId: actor,
      createSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: actor }, access_token: "fixture-token" } } }) } }),
      readLazadaExactBrowserSession: () => exact,
      fetch,
      setOAuthToastMessage: value => toasts.push(value),
      setPendingChannelOAuth() {},
      window: { sessionStorage: { removeItem: key => removed.push(key) } },
      lazadaExactBrowserKey: "lazada",
    };
    const run = new Function(...Object.keys(deps), completeJs)(...Object.values(deps));
    await run();
    assert.equal(calls.length, scenario === "stale-exact" ? 0 : 1);
    if (scenario !== "stale-exact") {
      assert.equal(calls[0].url, scenario === "exact" ? "/api/admin/channel-credentials/lazada/exact" : "/api/admin/channel-credentials/lazada/authorize");
      assert.equal(calls[0].body.oauthState ?? calls[0].body.state, state);
    }
    assert.equal(removed.includes("lazada"), scenario === "stale-exact" || scenario === "exact");
  });
}

test("credential center routes Lazada only through the exact event", () => {
  const start = center.indexOf("const startOAuth = async");
  const end = center.indexOf("\n\n  return (", start);
  const section = center.slice(start, end);
  assert.match(section, /credential\.channel === "lazada"[\s\S]{0,220}sellerpilot:lazada-exact-start/);
  assert.match(section, /sellerpilot:lazada-exact-start[\s\S]{0,120}return;/);
});
