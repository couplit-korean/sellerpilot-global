import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const center = await readFile(new URL("../app/api-credential-center.tsx", import.meta.url), "utf8");
const actor = "11111111-1111-4111-8111-111111111111";
const credential = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const exactState = `sellerpilot-shopee-exact-${"e".repeat(43)}`;
const legacyState = `sellerpilot-shopee-${"n".repeat(32)}`;

const start = source.indexOf("    const startShopeeExact = async");
const end = source.indexOf("    const listener =", start);
assert.ok(start > 0 && end > start);
const startJs = ts.transpileModule(`${source.slice(start, end)}\nreturn startShopeeExact;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const scenario of ["prepare", "no-worker", "auth-mismatch", "bad-origin", "prepare-failure", "bad-partner", "bad-redirect", "bad-state", "ready"]) {
  test(`Shopee exact UI start ${scenario}`, async () => {
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
          : { status: "ready", authorizationUrl: `${scenario === "bad-origin" ? "https://evil.invalid" : "https://open.shopee.com"}/auth?state=${scenario === "bad-state" ? "invalid" : exactState}&partner_id=${scenario === "bad-partner" ? "1" : "2031489"}&auth_type=seller&response_type=code&redirect_uri=${encodeURIComponent(scenario === "bad-redirect" ? "https://evil.invalid/" : "https://sellerpilot-global.vercel.app/")}` };
      return { ok: scenario !== "prepare-failure", json: async () => scenario === "prepare-failure" ? { status: "blocked" } : payload };
    };
    const deps = {
      userId: actor,
      shopeeExactStarting: { current: false },
      createSupabaseClient: () => ({
        auth: { getSession: async () => ({ data: { session: { user: { id: scenario === "auth-mismatch" ? "other" : actor }, access_token: "fixture-token" } } }) },
      }),
      readShopeeExactBrowserSession: () => prepared,
      window: { sessionStorage: { setItem: (...args) => stored.push(args) }, location: { origin: "https://sellerpilot-global.vercel.app", assign: value => redirects.push(value) } },
      shopeeExactBrowserKey: "sellerpilot.shopee-exact-session.v1",
      setOAuthToastMessage: value => toasts.push(value),
      fetch,
      URL,
    };
    const handler = new Function(...Object.keys(deps), startJs)(...Object.values(deps));
    await handler({ detail: { credentialId: credential } });
    assert.equal(deps.shopeeExactStarting.current, false);
    assert.ok(sent.every(request => request.url === "/api/admin/channel-credentials/shopee/exact"));
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

for (const scenario of ["legacy", "stale-exact", "missing-main", "bind-failed", "exact"]) {
  test(`Shopee callback ${scenario}`, async () => {
    const calls = [];
    const removed = [];
    const toasts = [];
    const state = scenario === "legacy" ? legacyState : exactState;
    const exact = scenario === "legacy"
      ? null
      : { sessionId: session, credentialId: credential, actorId: actor, expiresAt: Date.now() + 60_000, state: scenario !== "stale-exact" ? exactState : `${exactState}x` };
    const fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: scenario !== "bind-failed", json: async () => url.endsWith("/exact") ? { status: scenario === "bind-failed" ? "blocked" : "bound" } : { message: "stored" } };
    };
    const deps = {
      pendingChannelOAuth: { channel: "shopee", state, code: "fixture-code", mainAccountId: scenario === "missing-main" ? undefined : "4940266" },
      userId: actor,
      createSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: actor }, access_token: "fixture-token" } } }) } }),
      readShopeeExactBrowserSession: () => exact,
      fetch,
      setOAuthToastMessage: value => toasts.push(value),
      setPendingChannelOAuth() {},
      window: { sessionStorage: { removeItem: key => removed.push(key) } },
      shopeeExactBrowserKey: "shopee",
    };
    const run = new Function(...Object.keys(deps), completeJs)(...Object.values(deps));
    await run();
    assert.equal(calls.length, ["stale-exact", "missing-main"].includes(scenario) ? 0 : 1);
    if (!["stale-exact", "missing-main"].includes(scenario)) {
      assert.equal(calls[0].url, scenario !== "legacy" ? "/api/admin/channel-credentials/shopee/exact" : "/api/admin/channel-credentials/shopee/authorize");
      assert.equal(calls[0].body.oauthState ?? calls[0].body.state, state);
      if (scenario !== "legacy") assert.equal(calls[0].body.mainAccountId, "4940266");
    }
    assert.equal(removed.includes("shopee"), ["stale-exact", "missing-main", "exact"].includes(scenario));
  });
}

test("credential center routes Shopee only through the exact event", () => {
  const start = center.indexOf("const startOAuth = async");
  const end = center.indexOf("\n\n  return (", start);
  const section = center.slice(start, end);
  assert.match(section, /credential\.channel === "shopee"[\s\S]{0,220}sellerpilot:shopee-exact-start/);
  assert.match(section, /sellerpilot:shopee-exact-start[\s\S]{0,120}return;/);
});

const readStart = source.indexOf("function readShopeeExactBrowserSession(");
const readEnd = source.indexOf("\nexport default function Home()", readStart);
const readJs = ts.transpileModule(`${source.slice(readStart, readEnd)}\nreturn readShopeeExactBrowserSession;`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for (const bad of ["none", "actor", "expiry", "state", "credential", "malformed"]) {
  test(`Shopee stored session rejects ${bad}`, () => {
    const value = { sessionId: session, credentialId: credential, actorId: actor, expiresAt: Date.now()+60_000, state: exactState };
    if (bad === "actor") value.actorId = "other";
    if (bad === "expiry") value.expiresAt = Date.now()-1;
    if (bad === "state") value.state = "sellerpilot-shopee-legacy";
    if (bad === "credential") value.credentialId = "wrong";
    const window = {sessionStorage:{getItem:()=>bad === "malformed" ? "{" : JSON.stringify(value)}};
    const read = new Function("window", "shopeeExactBrowserKey", readJs)(window,"fixture");
    assert.equal(Boolean(read(actor)), bad === "none");
  });
}
