import assert from "node:assert/strict";
import test from "node:test";
import { syncExistingShopeeTarget } from "../app/shopee-target-sync-client";

const oldId = "10000000-0000-4000-8000-000000000001";
const newId = "20000000-0000-4000-8000-000000000001";
const selection = { targetId: "1719148844", marketCode: "SG" };
const input = { accessToken: "test-session", selection, signal: new AbortController().signal };
const stale = () => Response.json({ channel: "shopee", credentialId: oldId, code: "SHOPEE_TARGET_CACHE_CREDENTIAL_MISMATCH" }, { status: 409 });
const ready = (id = newId, targetId = selection.targetId) => Response.json({
  contractVersion: 2, channel: "shopee", credentialId: id, credentialVersion: 91,
  targets: [{ credentialId: id, targetId, marketCode: "SG", displayName: "기존 숍", locale: "en-SG", language: "English", currency: "SGD" }],
});
function mock(steps: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = steps.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "unexpected extra request");
    return next;
  };
  return { calls, fetcher };
}

test("fresh exact target performs GET only without OAuth or provider sync", async () => {
  const mockFetch = mock([ready()]);
  assert.equal((await syncExistingShopeeTarget({ ...input, fetcher: mockFetch.fetcher })).target?.credentialId, newId);
  assert.deepEqual(mockFetch.calls.map((call) => call.init?.method), ["GET"]);
});

test("explicit sync uses selected shop and latest initial credential then verifies rotated credential with GET", async () => {
  const mockFetch = mock([stale(), ready(), ready()]);
  const result = await syncExistingShopeeTarget({ ...input, fetcher: mockFetch.fetcher });
  assert.equal(result.target?.credentialId, newId);
  assert.deepEqual(mockFetch.calls.map((call) => call.init?.method), ["GET", "POST", "GET"]);
  assert.deepEqual(JSON.parse(String(mockFetch.calls[1]?.init?.body)), { channel: "shopee", credentialId: oldId, ...selection });
  assert.ok(mockFetch.calls.every((call) => call.url.startsWith("/api/admin/channel-targets?") && call.url.includes("targetId=1719148844")));
});

test("lost POST response reads back success without resending", async () => {
  const mockFetch = mock([stale(), new Error("response lost"), ready()]);
  assert.ok((await syncExistingShopeeTarget({ ...input, fetcher: mockFetch.fetcher })).target);
  assert.equal(mockFetch.calls.filter((call) => call.init?.method === "POST").length, 1);
});

test("uncertain sync stays pending and its next click is GET only", async () => {
  const first = mock([stale(), new Error("timeout"), stale()]);
  assert.equal((await syncExistingShopeeTarget({ ...input, fetcher: first.fetcher })).pending, true);
  const retry = mock([stale()]);
  assert.equal((await syncExistingShopeeTarget({ ...input, checkOnly: true, fetcher: retry.fetcher })).pending, true);
  assert.deepEqual(retry.calls.map((call) => call.init?.method), ["GET"]);
});

test("server finds an existing job after reload and suppresses POST even without local pending state", async () => {
  for (const status of [202, 409, 503]) {
    const existing = mock([Response.json({ channel: "shopee", credentialId: oldId, pending: true,
      code: "SHOPEE_TARGET_DISCOVERY_PENDING", message: "기존 조회 처리 중" }, { status })]);
    const result = await syncExistingShopeeTarget({ ...input, fetcher: existing.fetcher });
    assert.equal(result.pending, true);
    assert.deepEqual(existing.calls.map(call => call.init?.method), ["GET"]);
  }
});

test("unauthorized targets and mismatched readback never become ready", async () => {
  const denied = mock([Response.json({ channel: "shopee", credentialId: oldId, code: "SHOPEE_TARGET_NOT_AUTHORIZED" }, { status: 409 })]);
  assert.equal((await syncExistingShopeeTarget({ ...input, fetcher: denied.fetcher })).target, null);
  assert.equal(denied.calls.length, 1);
  const wrong = mock([stale(), ready(), ready(newId, "9999999999")]);
  assert.equal((await syncExistingShopeeTarget({ ...input, fetcher: wrong.fetcher })).target, null);
});

test("invalid shop IDs and unsupported selected markets do not send requests or silently use SG", async () => {
  const unused = mock([]);
  for (const selection of [{ targetId: "", marketCode: "SG" }, { targetId: "01", marketCode: "SG" }, { targetId: "1719148844", marketCode: "MY" }]) {
    await assert.rejects(syncExistingShopeeTarget({ ...input, selection, fetcher: unused.fetcher }));
  }
  assert.equal(unused.calls.length, 0);
});
