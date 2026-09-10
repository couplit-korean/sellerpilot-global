import assert from "node:assert/strict";
import test from "node:test";
import { executeProviderOAuthExchange, type ProviderOAuthClaim } from "../lib/channels/provider-oauth-runtime";
import { shopeeProviderAccountIdentity, withProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import type { CredentialRefreshSnapshot } from "../lib/channels/protocols";

const PRIMARY = "1719148844";
const MAIN = "123456";
const SHOPS = [PRIMARY, "200000001", "200000002", "200000003", "200000004", "200000005", "200000006", "200000007"];
function claim(existing = true): ProviderOAuthClaim {
  const credential: Record<string, unknown> = { partner_id: "2031489", partner_key: "test-only-partner" };
  return {
    id: "11111111-1111-4111-8111-111111111111", claim_token: "22222222-2222-4222-8222-222222222222",
    credential_id: "33333333-3333-4333-8333-333333333333", attempt_count: 1,
    channel: "shopee", operation: "oauth.exchange", environment: "production",
    request: { code: "test-only-code", mainAccountId: MAIN },
    credential: existing ? withProviderAccountIdentity({ ...credential, main_account_id: MAIN, shop_id: PRIMARY,
      shop_ids: SHOPS, merchant_ids: ["900001"],
      shopee_targets: [...SHOPS.map(id => ({ type: "shop", id })), { type: "merchant", id: "900001" }],
    }, shopeeProviderAccountIdentity({ mainAccountId: MAIN })) : credential,
  };
}
async function run(job: ProviderOAuthClaim, options: { shops?: string[]; merchants?: string[]; returnedMain?: string; failShop?: string } = {}) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const stages: CredentialRefreshSnapshot[] = [];
  let fences = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path, body });
    assert.equal(init?.method, "POST");
    if (path === "/api/v2/auth/token/get") return Response.json({
      access_token: "test-main-access", refresh_token: "test-main-refresh",
      ...(body.main_account_id ? { main_account_id: options.returnedMain ?? MAIN } : {}),
      shop_id_list: options.shops ?? [...SHOPS].reverse(), merchant_id_list: options.merchants ?? ["900001"],
    });
    assert.equal(path, "/api/v2/auth/access_token/get");
    assert.equal(body.refresh_token, "test-main-refresh", "only the newly issued main grant is used");
    if (String(body.shop_id) === options.failShop) return Response.json({ error: "test_failure" });
    return Response.json({ access_token: `test-access-${body.shop_id ?? body.merchant_id}`,
      refresh_token: "test-target-refresh", expire_in: 14400 });
  };
  let error: unknown;
  let result: unknown;
  try {
    result = await executeProviderOAuthExchange(job, {
      assertLeaseHealthy: async () => undefined,
      beginCredentialMutation: async () => { fences++; },
      stageCredentialRefresh: async value => { stages.push(structuredClone(value)); },
    });
  } catch (caught) { error = caught; }
  finally { globalThis.fetch = originalFetch; }
  return { calls, stages, fences, error, result };
}

for (const [order, shops] of [[...SHOPS].reverse(), [...SHOPS.slice(1), PRIMARY], SHOPS].entries()) {
  test(`existing primary survives provider permutation ${order}`, async () => {
    const job = claim(); const before = structuredClone(job);
    // Untrusted callback metadata must not replace the injected Vault baseline.
    job.request.shop_id = SHOPS[1]; job.request.shop_ids = [SHOPS[1]];
    const r = await run(job, { shops }); assert.equal(r.error, undefined);
    assert.equal(r.calls.length, 10); assert.equal(r.calls[1].body.shop_id, Number(PRIMARY));
    assert.equal(r.stages.length, 11);
    assert.equal(r.stages[0].recoveryOnly, true);
    for (const stage of r.stages) {
      assert.equal(stage.payload.shop_id, PRIMARY);
      assert.equal(stage.payload.main_account_id, MAIN);
      assert.deepEqual(new Set(stage.payload.shop_ids as string[]), new Set(SHOPS));
      if (!stage.recoveryOnly) assert.equal(stage.payload.access_token, `test-access-${PRIMARY}`);
    }
    assert.equal(r.stages.at(-1)?.oauthComplete, true);
    assert.equal((r.stages.at(-1)?.payload.shopee_targets as unknown[]).length, 9);
    assert.deepEqual(job.credential, before.credential, "the injected Vault snapshot is not mutated");
  });
}

test("later target failure retains the SG primary in every partial, without complete", async () => {
  const r = await run(claim(), { failShop: SHOPS[7] });
  assert.match(String(r.error), /SHOPEE_OAUTH_TARGET_EXCHANGE_FAILED/);
  assert.equal(r.calls[1].body.shop_id, Number(PRIMARY));
  assert.equal(r.stages.length, 2);
  assert.equal(r.stages.every(s => s.payload.shop_id === PRIMARY && s.oauthComplete !== true), true);
});

for (const missing of [PRIMARY, SHOPS[2], "merchant"]) {
  test(`missing existing ${missing === "merchant" ? "merchant" : "shop"} fails closed before target grants`, async () => {
    const r = await run(claim(), { shops: SHOPS.filter(id => id !== missing), merchants: missing === "merchant" ? [] : undefined });
    assert.match(String(r.error), /SHOPEE_OAUTH_EXISTING_TARGET_MISSING/);
    assert.equal(r.calls.length, 1); assert.equal(r.stages.length, 1);
    assert.equal(r.stages[0].recoveryOnly, true); assert.equal(r.stages[0].payload.shop_id, PRIMARY);
    assert.equal(r.stages[0].oauthComplete, undefined);
  });
}

test("main-account callback mismatch is rejected before provider mutation", async () => {
  const job = claim(); job.request.mainAccountId = "999999";
  const r = await run(job); assert.match(String(r.error), /SHOPEE_OAUTH_MAIN_ACCOUNT_MISMATCH/);
  assert.equal(r.fences, 0); assert.equal(r.calls.length, 0); assert.equal(r.stages.length, 0);
});

test("provider main-account mismatch is never staged", async () => {
  const r = await run(claim(), { returnedMain: "999999" });
  assert.match(String(r.error), /SHOPEE_OAUTH_MAIN_ACCOUNT_MISMATCH/);
  assert.equal(r.calls.length, 1); assert.equal(r.stages.length, 0);
});

test("existing main-account cannot downgrade to single-shop authorization", async () => {
  const job = claim(); delete job.request.mainAccountId; job.request.shopId = PRIMARY;
  const r = await run(job); assert.match(String(r.error), /SHOPEE_OAUTH_MAIN_ACCOUNT_MISMATCH/);
  assert.equal(r.calls.length, 0);
});

test("certified account subject conflict is rejected before exchange", async () => {
  const job = claim(); job.credential = withProviderAccountIdentity(job.credential, shopeeProviderAccountIdentity({ mainAccountId: "999999" }));
  const r = await run(job); assert.match(String(r.error), /PROVIDER_ACCOUNT_IDENTITY_MISMATCH/);
  assert.equal(r.calls.length, 0);
});

test("existing target list without primary cannot silently pick first", async () => {
  const job = claim(); delete job.credential.shop_id;
  const r = await run(job); assert.match(String(r.error), /SHOPEE_OAUTH_EXISTING_PRIMARY_REQUIRED/);
  assert.equal(r.calls.length, 0);
});

test("targets-only Vault bindings also protect missing shop membership", async () => {
  const job = claim(); delete job.credential.shop_ids;
  const r = await run(job, { shops: SHOPS.filter(id => id !== SHOPS[3]) });
  assert.match(String(r.error), /SHOPEE_OAUTH_EXISTING_TARGET_MISSING/);
  assert.equal(r.calls.length, 1);
});

test("first authorization retains the existing first-provider-shop fallback", async () => {
  const shops = [SHOPS[4], PRIMARY]; const r = await run(claim(false), { shops, merchants: [] });
  assert.equal(r.error, undefined); assert.equal(r.stages[0].recoveryOnly, true);
  assert.equal(r.stages[0].payload.shop_id, undefined);
  assert.equal(r.calls[1].body.shop_id, Number(shops[0]));
  assert.equal(r.stages.at(-1)?.payload.shop_id, shops[0]);
  assert.equal(r.stages.at(-1)?.oauthComplete, true);
});

for (const existing of [false, true]) {
  test(`single-shop ${existing ? "reauthorization" : "first authorization"} retains its contract`, async () => {
    const job = claim(false); job.request = { code: "test-only-code", shopId: PRIMARY };
    if (existing) job.credential = withProviderAccountIdentity({ ...job.credential, shop_id: PRIMARY, shop_ids: [PRIMARY] }, shopeeProviderAccountIdentity({ shopId: PRIMARY }));
    const r = await run(job); assert.equal(r.error, undefined);
    assert.equal(r.calls.length, 1); assert.equal(r.stages.length, 1);
    assert.equal(r.stages[0].payload.shop_id, PRIMARY); assert.equal(r.stages[0].oauthComplete, true);
  });
}

test("preserved primary target failure leaves only recovery-only evidence", async () => {
  const r = await run(claim(), { failShop: PRIMARY });
  assert.match(String(r.error), /SHOPEE_OAUTH_TARGET_EXCHANGE_FAILED/);
  assert.equal(r.calls.length, 2); assert.equal(r.stages.length, 1);
  assert.equal(r.stages[0].recoveryOnly, true); assert.equal(r.stages[0].payload.shop_id, PRIMARY);
  assert.equal(r.stages[0].payload.access_token, undefined);
});
