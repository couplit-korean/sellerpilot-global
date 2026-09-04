import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertProviderAccountIdentity,
  assertShopeeShopProfileTarget,
  ebayProviderAccountIdentity,
  normalizeLazadaProviderAccountIdentity,
  parseEbayTradingGetUserIdentity,
  providerAccountIdentityVersionKey,
  providerAccountSubjectKey,
  readProviderAccountIdentity,
  shopeeProviderAccountIdentity,
  withLazadaProviderAccountIdentity,
  withProviderAccountIdentity,
  withoutShopeeOAuthAccountState,
} from "../lib/channels/provider-account-identity";
import {
  ensureEbayAccessToken,
  ensureLazadaAccessToken,
  ensureShopeeAccessToken,
} from "../lib/channels/protocols";

const lazadaSellerA = {
  account_platform: "seller_center",
  country_user_info: [
    { country: "SG", seller_id: 2002, user_id: "3002", short_code: "sg-shop" },
    { country: "my", seller_id: "2001", user_id: 3001, short_code: "my-shop" },
  ],
};

const ebayEiasA = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
const ebayEiasB = "WllYV1ZVVFNSUVBPTk1MS0pJSEdGRURDQkE=";

function ebayGetUserXml(eiasToken: string, userId = "seller-display") {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <User><EIASToken>${eiasToken}</EIASToken><UserID>${userId}</UserID></User>
    </GetUserResponse>`;
}

test("Lazada account subject is a stable base64url encoding of sorted official country tuples", () => {
  const first = normalizeLazadaProviderAccountIdentity(lazadaSellerA);
  const second = normalizeLazadaProviderAccountIdentity({
    account_platform: "SELLER_CENTER",
    country_user_info: [...lazadaSellerA.country_user_info].reverse(),
  });
  assert.equal(first.identity.subject, second.identity.subject);
  assert.match(first.identity.subject, /^lazada:v1:[A-Za-z0-9_-]{40,512}$/);
  assert.deepEqual(first.countryUserInfo.map((row) => row.country), ["my", "sg"]);

  const changed = normalizeLazadaProviderAccountIdentity({
    ...lazadaSellerA,
    country_user_info: [
      lazadaSellerA.country_user_info[0],
      { ...lazadaSellerA.country_user_info[1], seller_id: "9999" },
    ],
  });
  assert.notEqual(first.identity.subject, changed.identity.subject);

  const stored = withLazadaProviderAccountIdentity({ access_token: "vault-only" }, lazadaSellerA).payload;
  assert.equal(stored[providerAccountIdentityVersionKey], "v1");
  assert.equal(stored[providerAccountSubjectKey], first.identity.subject);
  assert.equal(readProviderAccountIdentity(stored, "lazada")?.subject, first.identity.subject);
});

test("Shopee reauthorization clears the previous account scope before staging the new identity", () => {
  const previousMain = withProviderAccountIdentity({
    partner_id: "2031489",
    partner_key: "static-partner-secret",
    main_account_id: "3001",
    main_account_access_token: "old-main-access",
    main_account_refresh_token: "old-main-refresh",
    shop_id: "4001",
    shop_ids: ["4001"],
    merchant_ids: ["5001"],
    access_token: "old-shop-access",
    refresh_token: "old-shop-refresh",
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: [{ type: "shop", id: "4001" }],
  }, shopeeProviderAccountIdentity({ mainAccountId: "3001" }));

  assert.deepEqual(withoutShopeeOAuthAccountState(previousMain), {
    partner_id: "2031489",
    partner_key: "static-partner-secret",
  });
});

test("Lazada refresh persists the provider response identity and fails closed on account change", async () => {
  const originalFetch = globalThis.fetch;
  const base = withLazadaProviderAccountIdentity({
    app_key: "app-key",
    app_secret: "app-secret",
    access_token: "expired-access",
    access_token_expires_at: "2000-01-01T00:00:00.000Z",
    refresh_token: "refresh-token",
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
  }, lazadaSellerA).payload;
  const staged: Array<{ recoveryOnly?: boolean; payload: Record<string, unknown> }> = [];
  try {
    globalThis.fetch = async () => Response.json({
      code: "0",
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      expires_in: 2_592_000,
      refresh_expires_in: 15_552_000,
      ...lazadaSellerA,
    });
    const same = await ensureLazadaAccessToken(base, undefined, () => {}, (refresh) => {
      staged.push(refresh);
    }, true);
    assert.equal(same.refreshed, true);
    assert.equal(same.payload[providerAccountSubjectKey], base[providerAccountSubjectKey]);
    assert.equal(staged.length, 2);
    assert.equal(staged[0]?.recoveryOnly, true);
    assert.equal(staged[0]?.payload[providerAccountIdentityVersionKey], undefined);
    assert.equal(staged[0]?.payload[providerAccountSubjectKey], undefined);
    assert.equal(staged[1]?.payload[providerAccountSubjectKey], base[providerAccountSubjectKey]);

    globalThis.fetch = async () => Response.json({
      code: "0",
      access_token: "other-access",
      refresh_token: "other-refresh",
      expires_in: 2_592_000,
      refresh_expires_in: 15_552_000,
      account_platform: "seller_center",
      country_user_info: [{ country: "my", seller_id: "9999", user_id: "9999" }],
    });
    await assert.rejects(
      ensureLazadaAccessToken(base, undefined, () => {}, (refresh) => {
        staged.push(refresh);
      }, true),
      (error: unknown) => error instanceof Error
        && error.message === "PROVIDER_ACCOUNT_IDENTITY_MISMATCH"
        && !error.message.includes("9999"),
    );
    assert.equal(staged.length, 3);
    assert.equal(staged[2]?.recoveryOnly, true);
    assert.equal(staged[2]?.payload[providerAccountIdentityVersionKey], undefined);
    assert.equal(staged[2]?.payload[providerAccountSubjectKey], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy Lazada credentials force an official refresh and stage provider identity even while access is valid", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let stagedPayload: Record<string, unknown> | null = null;
  const stagedSnapshots: Array<{ recoveryOnly?: boolean; payload: Record<string, unknown> }> = [];
  try {
    globalThis.fetch = async (input) => {
      events.push("refresh");
      assert.equal(new URL(String(input)).pathname, "/rest/auth/token/refresh");
      return Response.json({
        code: "0",
        access_token: "attested-access",
        refresh_token: "attested-refresh",
        expires_in: 2_592_000,
        refresh_expires_in: 15_552_000,
        ...lazadaSellerA,
      });
    };
    const result = await ensureLazadaAccessToken({
      app_key: "app-key",
      app_secret: "app-secret",
      access_token: "still-valid-access",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token: "legacy-refresh",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    }, undefined, () => {
      events.push("begin");
    }, (refresh) => {
      events.push("stage");
      stagedPayload = refresh.payload;
      stagedSnapshots.push(refresh);
    }, true);

    assert.deepEqual(events, ["begin", "refresh", "stage", "begin", "stage"]);
    assert.equal(stagedSnapshots[0]?.recoveryOnly, true);
    assert.equal(stagedSnapshots[0]?.payload[providerAccountSubjectKey], undefined);
    assert.equal(stagedSnapshots[1]?.recoveryOnly, undefined);
    assert.equal(result.refreshed, true);
    assert.equal(result.payload[providerAccountIdentityVersionKey], "v1");
    assert.match(String(result.payload[providerAccountSubjectKey]), /^lazada:v1:[A-Za-z0-9_-]{40,512}$/);
    assert.equal(stagedPayload?.[providerAccountSubjectKey], result.payload[providerAccountSubjectKey]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee identity distinguishes exact main-account and shop-only authorization targets", () => {
  const main = shopeeProviderAccountIdentity({ mainAccountId: "3001" });
  const shop = shopeeProviderAccountIdentity({ shopId: 1001 });
  assert.equal(main.subject, "shopee:main:3001");
  assert.equal(shop.subject, "shopee:shop:1001");
  assert.throws(
    () => shopeeProviderAccountIdentity({ mainAccountId: "3001", shopId: "1001" }),
    /SHOPEE_ACCOUNT_IDENTITY_INVALID/,
  );

  const mismatchedPayload = withProviderAccountIdentity({ main_account_id: "3002" }, main);
  assert.throws(
    () => assertProviderAccountIdentity(
      mismatchedPayload,
      shopeeProviderAccountIdentity({ mainAccountId: "3002" }),
    ),
    /PROVIDER_ACCOUNT_IDENTITY_MISMATCH/,
  );
});

test("Shopee shop-only credential cannot project or refresh a different shop target", async () => {
  const shop = shopeeProviderAccountIdentity({ shopId: "1001" });
  const payload = withProviderAccountIdentity({
    partner_id: "2031489",
    partner_key: "partner-secret-value",
    shop_id: "1001",
    access_token: "shop-one-access",
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_token: "shop-one-refresh",
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: [
      { type: "shop", id: "1001", access_token: "shop-one-access", refresh_token: "shop-one-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
      { type: "shop", id: "1002", access_token: "shop-two-access", refresh_token: "shop-two-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
    ],
  }, shop);
  await assert.rejects(
    ensureShopeeAccessToken(payload, "production", undefined, "1002", undefined, undefined, true),
    /PROVIDER_ACCOUNT_IDENTITY_MISMATCH/,
  );
});

test("legacy Shopee shop-only credential uses exact shop_info readback before staging identity", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let stagedPayload: Record<string, unknown> | null = null;
  const payload = {
    partner_id: "2031489",
    partner_key: "partner-secret-value",
    shop_id: "1001",
    access_token: "still-valid-access",
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_token: "legacy-refresh",
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
  };
  try {
    globalThis.fetch = async (input) => {
      events.push("shop_info");
      const url = new URL(String(input));
      assert.equal(url.pathname, "/api/v2/shop/get_shop_info");
      assert.equal(url.searchParams.get("shop_id"), "1001");
      return Response.json({ error: "", response: { shop_id: 1001 } });
    };
    const result = await ensureShopeeAccessToken(payload, "production", undefined, "", () => {
      events.push("begin");
    }, (refresh) => {
      events.push("stage");
      stagedPayload = refresh.payload;
    }, true);

    assert.deepEqual(events, ["shop_info", "begin", "stage"]);
    assert.equal(result.payload[providerAccountSubjectKey], "shopee:shop:1001");
    assert.equal(stagedPayload?.[providerAccountSubjectKey], "shopee:shop:1001");

    events.length = 0;
    globalThis.fetch = async () => {
      events.push("shop_info");
      return Response.json({ error: "", response: { shop_id: 1002 } });
    };
    await assert.rejects(
      ensureShopeeAccessToken(payload, "production", undefined, "", () => {
        events.push("begin");
      }, () => {
        events.push("stage");
      }, true),
      /SHOPEE_SHOP_IDENTITY_MISMATCH/,
    );
    assert.deepEqual(events, ["shop_info"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee refresh verifies the new access token against the exact shop before staging", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let returnedShopId = 1001;
  let staged = 0;
  const stagedSnapshots: Array<{ recoveryOnly?: boolean; payload: Record<string, unknown> }> = [];
  const payload = withProviderAccountIdentity({
    partner_id: "2031489",
    partner_key: "partner-secret-value",
    shop_id: "1001",
    access_token: "expired-access",
    access_token_expires_at: "2000-01-01T00:00:00.000Z",
    refresh_token: "shop-refresh",
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
  }, shopeeProviderAccountIdentity({ shopId: "1001" }));
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v2/auth/access_token/get") {
        events.push("refresh");
        assert.equal(JSON.parse(String(init?.body)).shop_id, 1001);
        return Response.json({
          error: "",
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expire_in: 14_400,
        });
      }
      events.push("shop_info");
      assert.equal(url.pathname, "/api/v2/shop/get_shop_info");
      assert.equal(url.searchParams.get("access_token"), "fresh-access");
      return Response.json({ error: "", response: { shop_id: returnedShopId } });
    };
    const same = await ensureShopeeAccessToken(payload, "production", undefined, "", () => {
      events.push("begin");
    }, (refresh) => {
      staged += 1;
      events.push("stage");
      stagedSnapshots.push(refresh);
    }, true);
    assert.deepEqual(events, ["begin", "refresh", "stage", "shop_info", "begin", "stage"]);
    assert.equal(same.payload[providerAccountSubjectKey], "shopee:shop:1001");
    assert.equal(staged, 2);
    assert.equal(stagedSnapshots[0]?.recoveryOnly, true);
    assert.equal(stagedSnapshots[0]?.payload[providerAccountIdentityVersionKey], undefined);
    assert.equal(stagedSnapshots[0]?.payload[providerAccountSubjectKey], undefined);
    assert.equal(stagedSnapshots[1]?.payload[providerAccountSubjectKey], "shopee:shop:1001");

    events.length = 0;
    returnedShopId = 1002;
    await assert.rejects(
      ensureShopeeAccessToken(payload, "production", undefined, "", () => {
        events.push("begin");
      }, (refresh) => {
        staged += 1;
        events.push("stage");
        stagedSnapshots.push(refresh);
      }, true),
      /SHOPEE_SHOP_IDENTITY_MISMATCH/,
    );
    assert.deepEqual(events, ["begin", "refresh", "stage", "shop_info"]);
    assert.equal(staged, 3);
    assert.equal(stagedSnapshots[2]?.recoveryOnly, true);
    assert.equal(stagedSnapshots[2]?.payload[providerAccountIdentityVersionKey], undefined);
    assert.equal(stagedSnapshots[2]?.payload[providerAccountSubjectKey], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy Shopee main-account credential fails closed until provider reconnection", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return Response.json({});
    };
    await assert.rejects(
      ensureShopeeAccessToken({
        partner_id: "2031489",
        partner_key: "partner-secret-value",
        main_account_id: "3001",
        shop_id: "1001",
        access_token: "still-valid-access",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_token: "legacy-refresh",
        refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
        authorization_expires_at: "2099-01-01T00:00:00.000Z",
      }, "production", undefined, "", () => {}, () => {}, true),
      /PROVIDER_ACCOUNT_IDENTITY_MISSING/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee shop profile validates echoed IDs and explicitly accepts a signed success without an echo", () => {
  assert.equal(assertShopeeShopProfileTarget({ response: { shop_id: 1001 } }, "1001"), "1001");
  assert.throws(
    () => assertShopeeShopProfileTarget({ response: { shop_id: 1002 } }, "1001"),
    /SHOPEE_SHOP_IDENTITY_MISMATCH/,
  );
  assert.throws(
    () => assertShopeeShopProfileTarget({ response: { shop_name: "No ID" } }, "1001"),
    /SHOPEE_SHOP_IDENTITY_MISSING/,
  );
  assert.equal(
    assertShopeeShopProfileTarget(
      { response: { shop_name: "Signed request shop" } },
      "1001",
      { acceptSignedRequestBinding: true },
    ),
    "1001",
  );
  assert.throws(
    () => assertShopeeShopProfileTarget({ shop_id: 1001, response: { shop_id: 1002 } }, "1001"),
    /SHOPEE_SHOP_IDENTITY_MISMATCH/,
  );
});

test("eBay Trading GetUser parses the immutable EIASToken without using mutable UserID as subject", () => {
  const parsed = parseEbayTradingGetUserIdentity(ebayGetUserXml(ebayEiasA, "mutable-name"));
  assert.equal(parsed.identity.subject, `ebay:eias:${ebayEiasA}`);
  assert.equal(parsed.userId, "mutable-name");
  assert.notEqual(parsed.identity.subject, `ebay:eias:${parsed.userId}`);
  assert.throws(
    () => parseEbayTradingGetUserIdentity("<GetUserResponse><Ack>Failure</Ack></GetUserResponse>"),
    /EBAY_ACCOUNT_IDENTITY_VERIFICATION_FAILED/,
  );
});

test("eBay refresh verifies GetUser identity before staging and rejects another account", async () => {
  const originalFetch = globalThis.fetch;
  const identity = ebayProviderAccountIdentity(ebayEiasA);
  const base = withProviderAccountIdentity({
    client_id: "client",
    client_secret: "secret",
    ru_name: "runame",
    access_token: "expired-access",
    access_token_expires_at: "2000-01-01T00:00:00.000Z",
    refresh_token: "refresh-token",
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
  }, identity);
  let identityResponse = ebayGetUserXml(ebayEiasA);
  let staged = 0;
  const calls: Array<{ url: string; headers: Headers; body: string }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      if (url.endsWith("/identity/v1/oauth2/token")) {
        return Response.json({ access_token: "fresh-access", expires_in: 7_200 });
      }
      return new Response(identityResponse, { status: 200, headers: { "content-type": "text/xml" } });
    };

    const same = await ensureEbayAccessToken(base, "sandbox", undefined, undefined, () => {
      staged += 1;
    }, true);
    assert.equal(same.payload[providerAccountSubjectKey], identity.subject);
    assert.equal(staged, 1);
    assert.equal(calls[1].url, "https://api.sandbox.ebay.com/ws/api.dll");
    assert.equal(calls[1].headers.get("x-ebay-api-call-name"), "GetUser");
    assert.equal(calls[1].headers.get("x-ebay-api-iaf-token"), "fresh-access");
    assert.doesNotMatch(calls[1].body, /fresh-access|refresh-token|client_secret/);

    identityResponse = ebayGetUserXml(ebayEiasB, "another-account");
    await assert.rejects(
      ensureEbayAccessToken(base, "sandbox", undefined, undefined, () => {
        staged += 1;
      }, true),
      (error: unknown) => error instanceof Error
        && error.message === "PROVIDER_ACCOUNT_IDENTITY_MISMATCH"
        && !error.message.includes(ebayEiasA)
        && !error.message.includes(ebayEiasB),
    );
    assert.equal(staged, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy eBay credential attests a valid access token with GetUser before begin and stage", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let stagedPayload: Record<string, unknown> | null = null;
  try {
    globalThis.fetch = async (input, init) => {
      events.push("get_user");
      const url = String(input);
      assert.equal(url, "https://api.ebay.com/ws/api.dll");
      assert.equal(new Headers(init?.headers).get("x-ebay-api-iaf-token"), "still-valid-access");
      return new Response(ebayGetUserXml(ebayEiasA), { status: 200 });
    };
    const result = await ensureEbayAccessToken({
      access_token: "still-valid-access",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    }, "production", undefined, () => {
      events.push("begin");
    }, (refresh) => {
      events.push("stage");
      stagedPayload = refresh.payload;
    }, true);

    assert.deepEqual(events, ["get_user", "begin", "stage"]);
    assert.equal(result.payload.access_token, "still-valid-access");
    assert.equal(result.payload[providerAccountSubjectKey], `ebay:eias:${ebayEiasA}`);
    assert.equal(stagedPayload?.[providerAccountSubjectKey], `ebay:eias:${ebayEiasA}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gateway worker removes cross-account Shopee fallback and requires provider identity on live refresh", async () => {
  const [worker, oauthRuntime, providerRuntime] = await Promise.all([
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/provider-oauth-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-gateway-provider.ts", import.meta.url), "utf8"),
  ]);
  const source = `${worker}\n${oauthRuntime}\n${providerRuntime}`;
  assert.doesNotMatch(source, /get_shops_by_partner|shopeePartnerRequest/);
  assert.match(
    providerRuntime,
    /assertShopeeShopProfileTarget\(remote\.data, shopId, \{ acceptSignedRequestBinding: true \}\)/,
  );
  assert.match(oauthRuntime, /fetchEbayTradingUserIdentity\(/);
  assert.match(worker, /rememberCredentialRefresh, true\)/);
  assert.match(
    oauthRuntime,
    /async function exchangeShopeeOAuth[\s\S]*payload: withoutProviderAccountIdentity\(nextSecret\)[\s\S]*recoveryOnly: true/,
  );
  assert.match(
    oauthRuntime,
    /async function exchangeEbayOAuth[\s\S]*exchangeEbayOAuthToken[\s\S]*withoutProviderAccountIdentity\(recoveryPayload\)[\s\S]*recoveryOnly: true[\s\S]*fetchEbayTradingUserIdentity[\s\S]*beginCredentialMutation\(hooks\)[\s\S]*oauthComplete: true/,
  );
  assert.doesNotMatch(source, /console\.(?:log|error)[^\n]*provider_account_subject/);
});
