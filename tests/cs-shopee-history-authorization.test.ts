import assert from "node:assert/strict";
import test from "node:test";
import { shopeeHistoryAuthorizationError } from "../lib/channels/cs/shopee/history-authorization";

const history = { sellerpilotShopeeHistoryRunId: "shopee-history-test" };

test("401 and 403 history failures become exact shop-local authorization codes", () => {
  for (const status of [401, 403]) {
    assert.equal(shopeeHistoryAuthorizationError(history, {
      ok: false, steps: [{ ok: false, status }],
    }), `SHOPEE_${status}_AUTHORIZATION_REQUIRED`);
  }
});

test("ordinary Shopee pulls and non-authorization failures retain their current behavior", () => {
  assert.equal(shopeeHistoryAuthorizationError({}, {
    ok: false, steps: [{ ok: false, status: 403 }],
  }), null);
  assert.equal(shopeeHistoryAuthorizationError(history, {
    ok: false, steps: [{ ok: false, status: 429 }],
  }), null);
  assert.equal(shopeeHistoryAuthorizationError(history, {
    ok: true, steps: [{ ok: true, status: 200 }],
  }), null);
});
