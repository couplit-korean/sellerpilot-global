import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "data:text/javascript,export default {}" }
      : nextResolve(specifier, context);
  },
});

const { processCommerceGatewayJob } = await import("../scripts/commerce-gateway-job.mjs");

const eiasToken = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
const getUserXml = `<?xml version="1.0" encoding="UTF-8"?>
  <GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">
    <Ack>Success</Ack>
    <User><EIASToken>${eiasToken}</EIASToken><UserID>seller-fixture</UserID></User>
  </GetUserResponse>`;
const noop = async () => {};

type PersistedCall = {
  path: string;
  payload: Record<string, unknown>;
};

function workerDependencies(calls: PersistedCall[]) {
  return {
    createGatewayHeartbeat: () => ({
      start: noop,
      stop: noop,
      assertHealthy: noop,
    }),
    persistWorkerCompletion: async (path: string, payload: Record<string, unknown>) => {
      calls.push({ path, payload });
      return Response.json({ status: "fixture-stored" });
    },
  };
}

function ebayDiagnosticJob(id: string, credentialId: string, credential: Record<string, unknown>) {
  return {
    id,
    claim_token: "22222222-2222-4222-8222-222222222222",
    credential_id: credentialId,
    channel: "ebay",
    operation: "diagnostic.test",
    environment: "sandbox",
    request: { arguments: {} },
    credential,
    attempt_count: 1,
  } as const;
}

test("eBay gateway durably stages a stale-token refresh and reuses the staged payload on the next claim", async () => {
  const originalFetch = globalThis.fetch;
  const firstCalls: PersistedCall[] = [];
  const providerCalls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      providerCalls.push(url);
      if (url.endsWith("/identity/v1/oauth2/token")) {
        assert.match(String(init?.body ?? ""), /grant_type=refresh_token/);
        return Response.json({ access_token: "fresh-access-token", expires_in: 7_200 });
      }
      if (url.endsWith("/ws/api.dll")) {
        assert.equal(new Headers(init?.headers).get("x-ebay-api-iaf-token"), "fresh-access-token");
        return new Response(getUserXml, { status: 200, headers: { "content-type": "text/xml" } });
      }
      if (url.endsWith("/sell/account/v1/privilege/")) {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fresh-access-token");
        return Response.json({ sellerRegistrationCompleted: true });
      }
      throw new Error(`unexpected provider request: ${url}`);
    };

    await processCommerceGatewayJob(ebayDiagnosticJob(
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
      {
        client_id: "fixture-client",
        client_secret: "fixture-secret",
        ru_name: "fixture-runame",
        access_token: "stale-access-token",
        access_token_expires_at: "2000-01-01T00:00:00.000Z",
        refresh_token: "fixture-refresh-token",
        refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
        provider_account_identity_version: "v1",
        provider_account_subject: `ebay:eias:${eiasToken}`,
      },
    ), workerDependencies(firstCalls));

    assert.deepEqual(firstCalls.map(({ path, payload }) => `${path}:${String(payload.action ?? payload.status)}`), [
      "/api/channel-gateway/worker/credential-refresh:begin",
      "/api/channel-gateway/worker/credential-refresh:stage",
      "/api/channel-gateway/worker/complete:succeeded",
    ]);
    const stagedRefresh = firstCalls[1].payload.credentialRefresh as {
      payload: Record<string, unknown>;
      expiresAt: string;
    };
    assert.equal(stagedRefresh.payload.access_token, "fresh-access-token");
    assert.equal(stagedRefresh.payload.refresh_token, "fixture-refresh-token");
    assert.equal(stagedRefresh.payload.provider_account_subject, `ebay:eias:${eiasToken}`);
    assert.deepEqual(firstCalls[2].payload.credentialRefresh, stagedRefresh);
    assert.deepEqual(providerCalls.map((url) => new URL(url).pathname), [
      "/identity/v1/oauth2/token",
      "/ws/api.dll",
      "/sell/account/v1/privilege/",
    ]);

    const secondCalls: PersistedCall[] = [];
    providerCalls.length = 0;
    await processCommerceGatewayJob(ebayDiagnosticJob(
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      stagedRefresh.payload,
    ), workerDependencies(secondCalls));

    assert.deepEqual(providerCalls.map((url) => new URL(url).pathname), [
      "/sell/account/v1/privilege/",
    ]);
    assert.deepEqual(secondCalls.map(({ path }) => path), [
      "/api/channel-gateway/worker/complete",
    ]);
    assert.equal(Object.hasOwn(secondCalls[0].payload, "credentialRefresh"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay refresh staging rotates the active Vault credential and claims decrypt the rebound credential", async () => {
  const [refreshMigration, claimMigration] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260825104500_prepare_gateway_credential_refresh.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260904232000_persist_live_gateway_claim_routing.sql", import.meta.url), "utf8"),
  ]);
  const ebayRefreshBranch = refreshMigration.slice(
    refreshMigration.indexOf("when 'ebay' then public.sellerpilot_service_refresh_ebay"),
    refreshMigration.indexOf("return jsonb_build_object(\n    'status', 'prepared'", refreshMigration.indexOf("when 'ebay' then public.sellerpilot_service_refresh_ebay")),
  );
  assert.match(ebayRefreshBranch, /sellerpilot_service_refresh_ebay\(/);
  assert.match(ebayRefreshBranch, /queued\.credential_id = v_job\.credential_id[\s\S]*queued\.status = 'queued'/);
  assert.match(ebayRefreshBranch, /set credential_id = v_refreshed_credential_id,[\s\S]*prepared_credential_id = v_refreshed_credential_id/);
  assert.match(ebayRefreshBranch, /credential_refresh_in_flight = false/);

  const claimPayload = claimMigration.slice(
    claimMigration.indexOf("select jsonb_build_object("),
    claimMigration.indexOf("if v_result is null then", claimMigration.indexOf("select jsonb_build_object(")),
  );
  assert.match(claimPayload, /'credential_id', j\.credential_id/);
  assert.match(claimPayload, /'credential', d\.decrypted_secret::jsonb/);
  assert.match(claimPayload, /join sellerpilot_private\.channel_credentials c on c\.id = j\.credential_id/);
  assert.match(claimPayload, /join vault\.decrypted_secrets d on d\.id = c\.vault_secret_id/);
  assert.match(claimPayload, /c\.status = 'active'/);
});
