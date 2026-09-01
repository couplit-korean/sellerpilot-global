import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gatewayClaimSchema } from "../lib/channels/gateway-contract";
import {
  lazadaAuthorizationUrl,
  lazadaCountryFromOAuthState,
  lazadaOAuthState,
  lazadaTargetCountry,
  lazadaTargetMarketCode,
  lazadaTargetSyncRequiredCode,
} from "../lib/channels/lazada-my-contract";
import {
  activeLazadaSellerIdForMarket,
  lineageBoundLazadaTargetForMarket,
} from "../lib/channels/lazada-target-lineage";
import { executeProviderOAuthExchange, type ProviderOAuthClaim } from "../lib/channels/provider-oauth-runtime";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";

const credentialId = "21111111-1111-4111-8111-111111111111";

function oauthClaim(input: { requestedCountry?: string; credentialCountry?: string } = {}) {
  return gatewayClaimSchema.parse({
    id: "31111111-1111-4111-8111-111111111111",
    claim_token: "41111111-1111-4111-8111-111111111111",
    credential_id: credentialId,
    channel: "lazada",
    operation: "oauth.exchange",
    environment: "production",
    request: {
      code: "one-time-oauth-code",
      country: input.requestedCountry ?? lazadaTargetCountry,
    },
    credential: {
      app_key: "137451",
      app_secret: "private-app-secret",
      country: input.credentialCountry ?? lazadaTargetCountry,
    },
    attempt_count: 1,
  }) as ProviderOAuthClaim;
}

function providerToken(countryUserInfo: Array<Record<string, unknown>>) {
  return {
    code: "0",
    access_token: "fresh-access-token",
    refresh_token: "fresh-refresh-token",
    expires_in: 2_592_000,
    refresh_expires_in: 15_552_000,
    country: "my",
    account_platform: "seller_center",
    country_user_info: countryUserInfo,
  };
}

test("Lazada OAuth state, authorize URL, callback and gateway request are fixed to MY", async () => {
  const nonce = "a".repeat(32);
  const state = lazadaOAuthState(nonce);
  const authorizationUrl = lazadaAuthorizationUrl({
    appKey: "137451",
    redirectUri: "https://sellerpilot.example/",
    state,
  });
  assert.equal(lazadaCountryFromOAuthState(state), lazadaTargetCountry);
  assert.equal(lazadaCountryFromOAuthState(`sellerpilot-lazada-sg-${nonce}`), "");
  assert.equal(authorizationUrl.origin, "https://auth.lazada.com");
  assert.equal(authorizationUrl.pathname, "/oauth/authorize");
  assert.equal(authorizationUrl.searchParams.get("country"), lazadaTargetCountry);
  assert.equal(authorizationUrl.searchParams.get("state"), state);
  assert.throws(() => lazadaOAuthState("too-short"), /LAZADA_OAUTH_STATE_NONCE_INVALID/);

  const source = await readFile(
    new URL("../app/api/admin/channel-credentials/lazada/authorize/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /lazadaCountryFromOAuthState\(parsed\.data\.oauthState\)/u);
  assert.match(source, /request: \{ code: oauthCode, country: oauthStateCountry \}/u);
  assert.doesNotMatch(source, /request: \{ code: oauthCode, .*submittedCountry/u);
});

test("Lazada OAuth stages only a provider-attested MY seller identity", async () => {
  const originalFetch = globalThis.fetch;
  let staged: Record<string, unknown> | null = null;
  try {
    globalThis.fetch = async () => Response.json(providerToken([
      { country: "sg", seller_id: "2002", user_id: "3002" },
      { country: "my", seller_id: "2001", user_id: "3001", short_code: "my-store" },
    ]));
    const result = await executeProviderOAuthExchange(oauthClaim(), {
      assertLeaseHealthy: async () => undefined,
      beginCredentialMutation: async () => undefined,
      beginOAuthProviderCall: async () => undefined,
      stageCredentialRefresh: async (refresh) => { staged = refresh.payload; },
    });
    assert.equal(result.channel, "lazada");
    assert.equal(staged?.country, lazadaTargetCountry);
    assert.equal(activeLazadaSellerIdForMarket(staged, lazadaTargetMarketCode), "2001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada OAuth fails closed before staging when token identity has no MY seller", async () => {
  const originalFetch = globalThis.fetch;
  let stageCalls = 0;
  try {
    globalThis.fetch = async () => Response.json(providerToken([
      { country: "sg", seller_id: "2002", user_id: "3002" },
    ]));
    await assert.rejects(
      executeProviderOAuthExchange(oauthClaim(), {
        assertLeaseHealthy: async () => undefined,
        beginCredentialMutation: async () => undefined,
        beginOAuthProviderCall: async () => undefined,
        stageCredentialRefresh: async () => { stageCalls += 1; },
      }),
      /LAZADA_MY_SELLER_IDENTITY_MISSING/,
    );
    assert.equal(stageCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada OAuth rejects a non-MY request or credential before any provider call", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return Response.json(providerToken([
        { country: "my", seller_id: "2001", user_id: "3001" },
      ]));
    };
    for (const claim of [
      oauthClaim({ requestedCountry: "sg" }),
      oauthClaim({ credentialCountry: "sg" }),
    ]) {
      await assert.rejects(
        executeProviderOAuthExchange(claim, {
          assertLeaseHealthy: async () => undefined,
          beginCredentialMutation: async () => undefined,
          beginOAuthProviderCall: async () => undefined,
          stageCredentialRefresh: async () => undefined,
        }),
        /LAZADA_OAUTH_TARGET_COUNTRY_INVALID/,
      );
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada target cache decision is exact for the MY seller before and after persistence", () => {
  const activeSecret = withLazadaProviderAccountIdentity({ country: "my" }, {
    account_platform: "seller_center",
    country_user_info: [
      { country: "my", seller_id: "2001", user_id: "3001" },
      { country: "sg", seller_id: "2002", user_id: "3002" },
    ],
  }).payload;
  const stale = {
    targetId: "9999",
    displayName: "stale MY seller",
    marketCode: "MY",
    locale: "ms-MY",
    language: "Bahasa Melayu",
    currency: "MYR",
    verifiedAt: "2026-09-01T00:00:00.000Z",
  };
  const saved = {
    ...stale,
    targetId: "2001",
    displayName: "verified MY seller",
    verifiedAt: "2026-09-01T00:01:00.000Z",
  };
  assert.deepEqual(lineageBoundLazadaTargetForMarket([], activeSecret, "MY"), []);
  assert.deepEqual(lineageBoundLazadaTargetForMarket([stale], activeSecret, "MY"), []);
  assert.deepEqual(
    lineageBoundLazadaTargetForMarket([stale, saved], activeSecret, "MY").map((target) => target.targetId),
    ["2001"],
  );
});

test("Lazada target route exposes a typed sync-only 409 and blocks MY lineage mismatch", async () => {
  const source = await readFile(new URL("../app/api/admin/channel-targets/route.ts", import.meta.url), "utf8");
  assert.match(source, /code: lazadaTargetSyncRequiredCode/u);
  assert.match(source, /status: 409/u);
  assert.match(source, /code: lazadaMyTargetMismatchCode/u);
  assert.match(source, /lineageBoundLazadaTargetForMarket/u);
  assert.match(source, /lazadaTargetMarketCode/u);
  assert.equal(lazadaTargetSyncRequiredCode, "LAZADA_TARGET_SYNC_REQUIRED");
});
