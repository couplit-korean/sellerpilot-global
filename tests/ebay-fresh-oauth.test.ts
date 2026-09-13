import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import type { ServerlessCsGatewayDependencies } from "../lib/channels/serverless-gateway";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  return nextResolve(specifier, context);
} });
const { exchangeFreshEbayOAuth } = await import("../lib/channels/ebay-fresh-oauth");
const { EbayOAuthProviderFailureError } = await import("../lib/channels/provider-oauth-runtime");
const input = {
  actorId: "10000000-0000-4000-8000-000000000001",
  credentialId: "20000000-0000-4000-8000-000000000001",
  code: "fixture-fresh-authorization", includeMessages: true,
};
const job = {
  id: "30000000-0000-4000-8000-000000000001",
  claim_token: "40000000-0000-4000-8000-000000000001",
  credential_id: input.credentialId, channel: "ebay", operation: "oauth.exchange",
  environment: "production", request: { code: input.code, includeMessages: true },
  credential: { client_id: "fixture-client", client_secret: "fixture-secret" }, attempt_count: 1,
};
function fixture(options: { claim?: unknown; failedCompletion?: boolean; failedFinalization?: boolean; providerFailure?: boolean } = {}) {
  const calls: string[] = [];
  const completions: Record<string, unknown>[] = [];
  let executions = 0;
  const dependencies: ServerlessCsGatewayDependencies = {
    cronSecret: "fixture-cron-secret-at-least-sixteen", releaseId: "a".repeat(40),
    heartbeatIntervalMs: 100_000, logError: () => {},
    rpc: async (name, args = {}) => {
      calls.push(name);
      let data: unknown;
      if (name === "sellerpilot_service_claim_ebay_fresh_oauth") data = options.claim ?? { status: "claimed", job };
      else if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") data = { contract: "sellerpilot-provider-rate-budget/1", status: "reserved" };
      else if (name === "sellerpilot_touch_serverless_cs_job") data = "running";
      else if (name === "sellerpilot_service_begin_serverless_cs_credential_refresh") data = true;
      else if (name === "sellerpilot_service_prepare_serverless_cs_credential_refresh") data = { status: "prepared", credential_id: input.credentialId };
      else if (name === "sellerpilot_service_serverless_cs_completion_context") data = { status: "running", channel: "ebay", operation: "oauth.exchange" };
      else if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        completions.push(args);
        if (options.failedCompletion) return { data: null, error: { code: "57014" } };
        data = { status: "completed" };
      } else if (name === "sellerpilot_service_finalize_ebay_fresh_oauth") data = { status: options.failedFinalization ? "completion_required" : "finalized" };
      else throw new Error(`Unexpected RPC ${name}`);
      return { data, error: null };
    },
    executeProvider: async ({ hooks }) => {
      executions += 1;
      await hooks.beginCredentialMutation();
      if (options.providerFailure) throw new EbayOAuthProviderFailureError(400, "invalid_grant");
      await hooks.stageCredentialRefresh({ payload: { access_token: "fixture-new-token" }, expiresAt: "2099-01-01T00:00:00.000Z", oauthComplete: true });
      return { ok: true, channel: "ebay", operation: "oauth.exchange", expiresAt: "2099-01-01T00:00:00.000Z", safeMessage: "New authorization received" };
    },
  };
  return { dependencies, calls, completions, executions: () => executions };
}
test("fresh consent executes its exact claim and persists completion before supersession", async () => {
  const f = fixture();
  assert.equal((await exchangeFreshEbayOAuth(input, f.dependencies)).status, "completed");
  assert.equal(f.executions(), 1);
  assert.ok(f.calls.indexOf("sellerpilot_service_complete_serverless_cs_transaction") < f.calls.indexOf("sellerpilot_service_finalize_ebay_fresh_oauth"));
  assert.equal(f.calls.includes("sellerpilot_claim_serverless_gateway_job"), false);
  assert.equal(f.calls.some(n => n.includes("elevenst")), false);
});
test("duplicate callbacks never repeat the token exchange, including terminal results", async () => {
  for (const jobStatus of ["running", "succeeded", "reconciliation_required"]) {
    const f = fixture({ claim: { status: "already_submitted", jobId: job.id, jobStatus } });
    const result = await exchangeFreshEbayOAuth(input, f.dependencies);
    assert.notEqual(result.status, "completed");
    assert.equal(f.executions(), 0);
    assert.equal(f.calls.length, 1);
  }
});
test("mismatched credential or consent capability refuses provider execution", async () => {
  for (const mismatch of [{ credential_id: input.actorId }, { request: { code: input.code, includeMessages: false } }, { channel: "lazada" }]) {
    const f = fixture({ claim: { status: "claimed", job: { ...job, ...mismatch } } });
    assert.equal((await exchangeFreshEbayOAuth(input, f.dependencies)).status, "blocked");
    assert.equal(f.executions(), 0);
  }
});
test("a lost callback can read its finalized durable result without another exchange", async () => {
  const f = fixture({ claim: { status: "already_submitted", jobId: job.id, jobStatus: "succeeded", finalized: true } });
  assert.equal((await exchangeFreshEbayOAuth(input, f.dependencies)).status, "completed");
  assert.equal(f.executions(), 0);
});
test("completion or finalization loss is never reported as completed", async () => {
  for (const options of [{ failedCompletion: true }, { failedFinalization: true }]) {
    const f = fixture(options);
    assert.equal((await exchangeFreshEbayOAuth(input, f.dependencies)).status, "reconciliation_required");
    assert.equal(f.executions(), 1);
    if (options.failedCompletion) assert.equal(f.calls.includes("sellerpilot_service_finalize_ebay_fresh_oauth"), false);
  }
});
test("invalid grant retains uncertainty while recording only the allowlisted error", async () => {
  const f = fixture({ providerFailure: true });
  assert.equal((await exchangeFreshEbayOAuth(input, f.dependencies)).status, "reconciliation_required");
  assert.equal(f.completions.at(-1)?.p_status, "reconciliation_required");
  assert.equal(f.completions.at(-1)?.p_error_message, "EBAY_OAUTH_PROVIDER_FAILURE:HTTP_4XX:INVALID_GRANT");
  assert.equal(f.calls.includes("sellerpilot_service_finalize_ebay_fresh_oauth"), false);
});
test("OAuth diagnostics never echo an unknown token-bearing provider error", () => {
  assert.equal(new EbayOAuthProviderFailureError(500, "token=private-value").message, "EBAY_OAUTH_PROVIDER_FAILURE:HTTP_5XX:UNRECOGNIZED");
});
