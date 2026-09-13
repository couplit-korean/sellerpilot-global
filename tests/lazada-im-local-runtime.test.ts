import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import { gatewayWorkerCompletionSchema, type GatewayClaim } from "../lib/channels/gateway-contract";
registerHooks({ resolve(s,c,n) { return s === "server-only"
  ? { shortCircuit: true, url: "data:text/javascript,export default {}" } : n(s,c); } });
const { processCommerceGatewayJob } = await import("../scripts/commerce-gateway-job.mjs");
const { executeServerlessGatewayProviderJob } = await import("../lib/channels/serverless-gateway-provider");
const noop = async () => {};

for (const runtime of ["local", "serverless"] as const) {
  test(`${runtime} exact IM diagnostic uses IM tokens and preserves proof through completion schema`, async () => {
    const identity = { account_platform: "seller_center", country_user_info: [
      { country: "my", seller_id: "300872000183", user_id: "100001" },
    ] };
    const credential = withLazadaProviderAccountIdentity({ ...identity, country: "my",
      app_key: "commerce-app", app_secret: "commerce-secret", access_token: "commerce-token",
      refresh_token: "commerce-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
      im_app_key: "im-app", im_app_secret: "im-secret", im_access_token: "old-im-token", im_refresh_token: "im-refresh",
    }, identity).payload;
    const job = { id: "11111111-1111-4111-8111-111111111111", claim_token: "22222222-2222-4222-8222-222222222222",
      credential_id: "33333333-3333-4333-8333-333333333333", channel: "lazada", operation: "diagnostic.test",
      environment: "production", credential, request: { arguments: { lazadaImCapabilityProbe: true, country: "my" } },
      attempt_count: 1 } as GatewayClaim;
    const previous = globalThis.fetch;
    const paths: string[] = [];
    const stages: Array<Record<string, unknown>> = [];
    let completion: unknown;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input)); paths.push(url.pathname);
      assert.equal(url.searchParams.get("app_key"), "im-app");
      if (url.pathname === "/rest/auth/token/refresh") {
        return Response.json({ ...identity, code: "0", access_token: "fresh-im-token", refresh_token: "fresh-im-refresh",
          expires_in: 3600, refresh_expires_in: 7200 });
      }
      assert.equal(url.pathname, "/rest/im/session/list");
      assert.equal(url.searchParams.get("access_token"), "fresh-im-token");
      return Response.json({ code: "0", data: { session_list: [] } });
    };
    try {
      if (runtime === "local") {
        await processCommerceGatewayJob(job, {
          createGatewayHeartbeat: () => ({ start: noop, stop: noop, assertHealthy: noop }),
          persistWorkerCompletion: async (path: string, payload: Record<string, unknown>) => {
            if (path.endsWith("/complete")) completion = payload;
            else if (payload.action === "stage") stages.push(payload.credentialRefresh as Record<string, unknown>);
            return Response.json({ status: "prepared" });
          },
        });
      } else {
        const result = await executeServerlessGatewayProviderJob({ job, signal: new AbortController().signal,
          hooks: { assertLeaseHealthy: noop, beginCredentialMutation: noop,
            beginProviderMutation: async () => { throw new Error("unexpected listing mutation"); },
            stageCredentialRefresh: async (snapshot) => { stages.push(snapshot); } } });
        completion = { jobId: job.id, claimToken: job.claim_token, status: "succeeded", result };
      }
      assert.deepEqual(paths, ["/rest/auth/token/refresh", "/rest/im/session/list"]);
      assert.equal(stages.length, 2);
      assert.equal(stages[0].recoveryOnly, true);
      assert.equal((stages[1].payload as Record<string, unknown>).provider_account_subject, credential.provider_account_subject);
      const parsed = gatewayWorkerCompletionSchema.parse(completion);
      assert.equal(parsed.status, "succeeded");
      assert.equal(parsed.status === "succeeded" && parsed.result.operation === "diagnostic.test"
        && parsed.result.diagnostic.lazadaImCapability?.country, "MY");
    } finally { globalThis.fetch = previous; }
  });
}
