import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { gatewayClaimSchema } from "../lib/channels/gateway-contract";
import {
  executeProviderOAuthExchange,
  LazadaOAuthProviderFailureError,
  type ProviderOAuthClaim,
} from "../lib/channels/provider-oauth-runtime";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  deriveServerlessCsGatewayCredentials,
  runOneServerlessCsGatewayJob,
} = await import("../lib/channels/serverless-cs-gateway");

const JOB_ID = "faee01e1-2d68-4f99-951c-15684822fc43";
const CLAIM_TOKEN = "99d45dd4-b36b-4da9-a269-8ee65720a3ac";
const CREDENTIAL_ID = "e39f346d-c2b0-4d58-966d-aae98ee4efc4";

function lazadaOAuthClaim(): ProviderOAuthClaim {
  return gatewayClaimSchema.parse({
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel: "lazada",
    operation: "oauth.exchange",
    environment: "production",
    request: { code: "private-one-time-authorization-code", country: "my" },
    credential: {
      app_key: "137451",
      app_secret: "private-app-secret-value",
    },
    attempt_count: 1,
  });
}

test("Lazada OAuth records its provider-call boundary before fetch and types unknown provider data safely", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  globalThis.fetch = async (input, init) => {
    events.push("fetch");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://auth.lazada.com");
    assert.equal(url.pathname, "/rest/auth/token/create");
    assert.equal(init?.method, "GET");
    assert.equal(url.searchParams.get("app_key"), "137451");
    assert.equal(url.searchParams.get("sign_method"), "sha256");
    assert.equal(url.searchParams.has("timestamp"), true);
    assert.match(url.searchParams.get("sign") ?? "", /^[A-F0-9]{64}$/u);
    return Response.json({
      type: "ISV",
      code: "seller-account-998877-private",
      message: "private-user@example.com used a private authorization code",
      request_id: "private-provider-request-id",
    });
  };

  try {
    let observed: unknown;
    try {
      await executeProviderOAuthExchange(lazadaOAuthClaim(), {
        assertLeaseHealthy: async () => undefined,
        beginCredentialMutation: async () => { events.push("credential-fence"); },
        beginOAuthProviderCall: async () => { events.push("provider-call-boundary"); },
        stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      });
    } catch (error) {
      observed = error;
    }

    assert.ok(observed instanceof LazadaOAuthProviderFailureError);
    assert.equal(observed.category, "ISV");
    assert.equal(observed.providerCode, "UNRECOGNIZED");
    assert.equal(
      observed.message,
      "LAZADA_OAUTH_PROVIDER_FAILURE:ISV:UNRECOGNIZED",
    );
    assert.deepEqual(events, ["credential-fence", "provider-call-boundary", "fetch"]);
    assert.doesNotMatch(
      JSON.stringify({
        name: observed.name,
        message: observed.message,
        category: observed.category,
        providerCode: observed.providerCode,
      }),
      /private|example\.com|998877|request-id/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada OAuth preserves an allowlisted error field when code is absent", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    type: "ISV",
    error: "InvalidCode",
    message: "private-user@example.com supplied a private authorization code",
  });

  try {
    await assert.rejects(
      executeProviderOAuthExchange(lazadaOAuthClaim(), {
        assertLeaseHealthy: async () => undefined,
        beginCredentialMutation: async () => undefined,
        beginOAuthProviderCall: async () => undefined,
        stageCredentialRefresh: async () => {
          throw new Error("unexpected credential stage");
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof LazadaOAuthProviderFailureError);
        assert.equal(error.category, "ISV");
        assert.equal(error.providerCode, "INVALID_CODE");
        assert.equal(
          error.message,
          "LAZADA_OAUTH_PROVIDER_FAILURE:ISV:INVALID_CODE",
        );
        assert.doesNotMatch(error.message, /private|example\.com|authorization/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada OAuth typed failures sanitize constructor misuse", () => {
  const malicious = new LazadaOAuthProviderFailureError(
    "ISV",
    "private-user@example.com:private-request-id",
  );
  assert.equal(malicious.category, "ISV");
  assert.equal(malicious.providerCode, "UNRECOGNIZED");
  assert.equal(
    malicious.message,
    "LAZADA_OAUTH_PROVIDER_FAILURE:ISV:UNRECOGNIZED",
  );
  assert.doesNotMatch(malicious.message, /private|example\.com|request-id/i);
});

test("serverless completion preserves only allowlisted Lazada provider failure evidence", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  const rpcCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const logs: Array<Record<string, string | number | boolean>> = [];
  let claimed = false;

  globalThis.fetch = async () => {
    events.push("fetch");
    return Response.json({
      type: "ISV",
      code: "IncompleteSignature",
      message: "private-user@example.com and private-code must never be stored",
      request_id: "private-request-id",
      account: "private-user@example.com",
    });
  };

  const { gatewayTokenHash } = deriveServerlessCsGatewayCredentials(
    "unit-test-serverless-cron-secret-value",
  );

  try {
    const response = await runOneServerlessCsGatewayJob({
      rpc: async (name, arguments_ = {}) => {
        rpcCalls.push({ name, arguments: arguments_ });
        if (name === "sellerpilot_claim_serverless_gateway_job") {
          if (claimed) return { data: null, error: null };
          claimed = true;
          return { data: lazadaOAuthClaim(), error: null };
        }
        if (name === "sellerpilot_touch_serverless_cs_job") {
          return { data: "running", error: null };
        }
        if (name === "sellerpilot_service_begin_serverless_cs_credential_refresh") {
          events.push("credential-fence");
          return { data: true, error: null };
        }
        if (name === "sellerpilot_service_mark_lazada_oauth_provider_call_started") {
          events.push("provider-call-boundary");
          return { data: true, error: null };
        }
        if (name === "sellerpilot_service_serverless_cs_completion_context") {
          return {
            data: {
              status: "running",
              channel: "lazada",
              operation: "oauth.exchange",
              normalization_timestamp: "2026-08-30T00:00:00.000Z",
            },
            error: null,
          };
        }
        if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
          return { data: { status: "completed" }, error: null };
        }
        return { data: null, error: { code: "unexpected_rpc" } };
      },
      logError: (_stage, details) => { logs.push(details); },
      heartbeatIntervalMs: 60_000,
    }, gatewayTokenHash);

    assert.equal(response.status, 200);
    assert.deepEqual(events, ["credential-fence", "provider-call-boundary", "fetch"]);
    const completion = rpcCalls.find(({ name }) =>
      name === "sellerpilot_service_complete_serverless_cs_transaction");
    assert.equal(completion?.arguments.p_status, "reconciliation_required");
    assert.equal(
      completion?.arguments.p_error_message,
      "LAZADA_OAUTH_PROVIDER_FAILURE:ISV:INCOMPLETE_SIGNATURE",
    );
    assert.equal(completion?.arguments.p_response_payload, null);
    assert.equal(completion?.arguments.p_credential_refresh, null);
    const observable = JSON.stringify({
      response: await response.json(),
      completion,
      logs,
    });
    assert.match(observable, /LAZADA_OAUTH_PROVIDER_FAILURE:ISV:INCOMPLETE_SIGNATURE/);
    assert.doesNotMatch(
      observable,
      /private-user|example\.com|private-code|private-request-id|app-secret|authorization-code/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
