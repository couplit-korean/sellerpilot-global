import assert from "node:assert/strict";
import test from "node:test";
import { ebayDefaultScopes, ebayMessageScope, ebayOAuthScopes, parseEbayOAuthCookie } from "../lib/channels/ebay-oauth-scopes";
import { ensureEbayAccessToken, type CredentialRefreshSnapshot } from "../lib/channels/protocols";
import { executeProviderOAuthExchange, type ProviderOAuthClaim } from "../lib/channels/provider-oauth-runtime";

const identityXml = '<GetUserResponse><Ack>Success</Ack><User><UserID>seller-fixture</UserID><EIASToken>QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=</EIASToken></User></GetUserResponse>';

test("message consent is explicit while recorded message scope survives ordinary refresh", () => {
  assert.deepEqual(ebayOAuthScopes({}), ebayDefaultScopes);
  assert.deepEqual(ebayOAuthScopes({}, true), [...ebayDefaultScopes, ebayMessageScope]);
  assert.deepEqual(ebayOAuthScopes({ scopes: `${ebayMessageScope} evil-scope` }), [...ebayDefaultScopes, ebayMessageScope]);
  assert.deepEqual(ebayOAuthScopes({ scopes: `${ebayMessageScope}.readonly` }), ebayDefaultScopes);
});

test("OAuth cookie binds the requested capability and rejects malformed modes", () => {
  const state = `sellerpilot-ebay-${"a".repeat(32)}`;
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseEbayOAuthCookie(`${state}.${id}`), { state, credentialId: id, includeMessages: false });
  assert.deepEqual(parseEbayOAuthCookie(`${state}.${id}.messages`), { state, credentialId: id, includeMessages: true });
  for (const value of ["", `${state}.${id}.true`, `${state}.${id}.messages.extra`, `x.${id}`, `${state}.bad`]) assert.equal(parseEbayOAuthCookie(value), null);
});

test("refresh sends only the recorded scope set and never expands legacy grants", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const includeMessages of [false, true]) {
      let scope = "";
      globalThis.fetch = async (url, init) => {
        assert.equal(new URL(String(url)).pathname, "/identity/v1/oauth2/token");
        scope = new URLSearchParams(String(init?.body)).get("scope") ?? "";
        return Response.json({ access_token: "new-fixture-access", expires_in: 7200 });
      };
      await ensureEbayAccessToken({
        client_id: "fixture", client_secret: "fixture", ru_name: "fixture", refresh_token: "fixture",
        scopes: ebayOAuthScopes({}, includeMessages).join(" "), access_token_expires_at: "2000-01-01T00:00:00Z",
      }, "sandbox");
      assert.deepEqual(scope.split(" "), ebayOAuthScopes({}, includeMessages));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("OAuth exchange stages the consent scope with new tokens and preserves account certification", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const includeMessages of [false, true, "true"]) {
      const stages: CredentialRefreshSnapshot[] = [];
      globalThis.fetch = async (url) => new URL(String(url)).pathname === "/identity/v1/oauth2/token"
        ? Response.json({ access_token: "new-fixture-access", refresh_token: "new-fixture-refresh", expires_in: 7200 })
        : new Response(identityXml, { headers: { "content-type": "text/xml" } });
      const claim = {
        id: "11111111-1111-4111-8111-111111111111", claim_token: "22222222-2222-4222-8222-222222222222",
        credential_id: "33333333-3333-4333-8333-333333333333", attempt_count: 1,
        channel: "ebay", operation: "oauth.exchange", environment: "sandbox",
        credential: { client_id: "fixture", client_secret: "fixture", ru_name: "fixture" },
        request: { code: "fixture-code", includeMessages },
      } as ProviderOAuthClaim;
      await executeProviderOAuthExchange(claim, {
        beginCredentialMutation: async () => {}, assertLeaseHealthy: async () => {},
        stageCredentialRefresh: async (value) => { stages.push(value); },
      });
      assert.equal(stages.length, 2);
      assert.equal(stages[0].recoveryOnly, true);
      assert.equal(stages[1].oauthComplete, true);
      assert.equal(stages[1].payload.scopes, ebayOAuthScopes({}, includeMessages === true).join(" "));
      assert.equal(stages[1].payload.provider_account_identity_version, "v1");
      assert.equal(stages[1].payload.ebay_user_id, "seller-fixture");
    }
  } finally { globalThis.fetch = originalFetch; }
});
