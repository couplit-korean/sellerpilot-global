import assert from "node:assert/strict";
import test from "node:test";
import { ebayMessageScope, hasRecordedEbayMessageScope, probeEbayMessageAccess } from "../lib/channels/ebay-message-history";

const payload = { access_token: "fixture-secret", scopes: ebayMessageScope };
async function probe(body: unknown, status = 200) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(target.origin, "https://api.ebay.com");
    assert.equal(target.pathname, "/commerce/message/v1/conversation");
    assert.deepEqual([...target.searchParams], [["conversation_type", "FROM_MEMBERS"], ["limit", "1"], ["offset", "0"]]);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-secret");
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  try { return await probeEbayMessageAccess({ payload, environment: "production" }); }
  finally { globalThis.fetch = originalFetch; }
}

test("recorded scope is an exact scope token and is not proof of provider access", () => {
  assert.equal(hasRecordedEbayMessageScope({}), false);
  assert.equal(hasRecordedEbayMessageScope({ scopes: `${ebayMessageScope}.readonly` }), false);
  assert.equal(hasRecordedEbayMessageScope({ scopes: `base\n${ebayMessageScope} ` }), true);
});

test("empty successful read reports zero without claiming history or reply completion", async () => {
  assert.deepEqual(await probe({ conversations: [], total: 0, limit: 1, offset: 0 }), {
    recordedScope: true, httpStatus: 200, status: "readable", pageCount: 0, total: 0, hasMore: false,
  });
});

test("probe exposes only counts and HTTP evidence, never customer bodies or identifiers", async () => {
  const result = await probe({ conversations: [{ conversationId: "private-id", latestMessage: { messageBody: "private customer body" } }], total: 17, limit: 1, offset: 0, next: "https://attacker.invalid/private" });
  assert.deepEqual(result, { recordedScope: true, httpStatus: 200, status: "readable", pageCount: 1, total: 17, hasMore: true });
  assert.doesNotMatch(JSON.stringify(result), /private|fixture-secret|attacker/);
});

test("HTTP rejection is not an empty mailbox and API errors are not exposed", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const result = await probe({ errors: [{ message: "private provider error" }] }, status);
    assert.equal(result.status, [401, 403].includes(status) ? "authorization_required" : "unverified");
    assert.equal(result.total, null);
    assert.equal(result.pageCount, null);
    assert.equal(result.hasMore, null);
  }
});

test("malformed or inconsistent successful pages stay unverified", async () => {
  for (const body of [
    {}, { conversations: [], total: 1, limit: 1, offset: 0 },
    { conversations: [], total: 0, limit: 25, offset: 0 },
    { conversations: [], total: "0", limit: 1, offset: 0 },
    { conversations: [{}, {}], total: 2, limit: 1, offset: 0 },
  ]) assert.equal((await probe(body)).status, "unverified");
});
