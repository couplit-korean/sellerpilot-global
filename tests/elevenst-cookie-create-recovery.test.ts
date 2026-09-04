import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  elevenstCookieCreateRecoveryGetMatches,
  elevenstCookieCreateRecoveryIdentity,
} from "../lib/channels/elevenst-cookie-create-recovery";
import { readElevenstSellerProdcode } from "../lib/channels/elevenst-sellerprodcode-read";

const apiKey = "A".repeat(32);
const identity = elevenstCookieCreateRecoveryIdentity;

function xmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/xml; charset=utf-8" } });
}

test("cookie 11st recovery identity is the observed GET tuple only", () => {
  assert.equal(identity.productId, "1ed4acfc-7603-48ec-a638-241131e59358");
  assert.equal(identity.listingId, "61b343f8-2e61-42a8-8a45-750f8b834edc");
  assert.equal(identity.sourceJobId, "b9faa28e-a73f-4457-bb34-d643cf9a9a74");
  assert.equal(identity.sourceAttemptId, "d1300c6b-410e-47be-a93f-0e2ba7d4bbf6");
  assert.equal(identity.sellerSku, "AUTO-780720401E2D4E4EA45F");
  assert.equal(identity.remoteId, "9598600918");
  assert.equal(identity.market, "");
  assert.equal(identity.targetId, "");
  assert.equal(identity.contract, "elevenst_cookie_create_get_only_v1");
});

test("cookie 11st recovery source never POSTs or rewrites the fenced create job", async () => {
  const [identitySource, routeSource, sql] = await Promise.all([
    readFile(new URL("../lib/channels/elevenst-cookie-create-recovery.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/elevenst-cookie-create-recovery/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260905012000_recover_exact_elevenst_cookie_create_get_only.sql", import.meta.url), "utf8"),
  ]);
  assert.match(identitySource, /elevenstCookieCreateRecoveryGetMatches/);
  assert.match(routeSource, /readElevenstSellerProdcode/);
  assert.doesNotMatch(identitySource, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(routeSource, /prodservices\/product|executeChannelOperation/);
  assert.doesNotMatch(sql, /update sellerpilot_private\.channel_gateway_jobs/);
  assert.doesNotMatch(sql, /prodservices\/product/);
});

test("cookie 11st recovery accepts only sellerprodcode+prodmarket identity match", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    calls.push(call);
    if (call.url.includes("/sellerprodcode/")) {
      return xmlResponse("<Product><prdNo>9598600918</prdNo><sellerPrdCd>AUTO-780720401E2D4E4EA45F</sellerPrdCd></Product>");
    }
    if (call.url.endsWith("/prodmarket/9598600918")) {
      return xmlResponse("<Product><prdNo>9598600918</prdNo><sellerPrdCd>AUTO-780720401E2D4E4EA45F</sellerPrdCd><selStatCd>103</selStatCd></Product>");
    }
    throw new Error(`unexpected URL ${call.url}`);
  };
  try {
    const result = await readElevenstSellerProdcode({
      payload: { api_key: apiKey },
      sellerProductCode: identity.sellerSku,
    });
    assert.equal(elevenstCookieCreateRecoveryGetMatches(result), true);
    assert.equal(result.prodmarket?.selStatCd, "103");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cookie 11st recovery rejects a different prdNo without following bind", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/sellerprodcode/")) {
      return xmlResponse("<Product><prdNo>1111111111</prdNo><sellerPrdCd>AUTO-780720401E2D4E4EA45F</sellerPrdCd></Product>");
    }
    return xmlResponse("<Product><prdNo>1111111111</prdNo><sellerPrdCd>AUTO-780720401E2D4E4EA45F</sellerPrdCd></Product>");
  };
  try {
    const result = await readElevenstSellerProdcode({
      payload: { api_key: apiKey },
      sellerProductCode: identity.sellerSku,
    });
    assert.equal(result.outcome, "present");
    assert.equal(elevenstCookieCreateRecoveryGetMatches(result), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
