import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { processCsGatewayJob } from "../scripts/cs-gateway-job.mjs";
import { executeCsProviderJob } from "../lib/cs/operations/provider";
import { gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";

const key = createHash("sha256").update("temu\u001fproduction\u001ftemu:mall:1024").digest("hex");
async function run(expectedKey: string) {
  const originalFetch = globalThis.fetch;
  let inquiryCalls = 0;
  const completions: Record<string, any>[] = [];
  globalThis.fetch = async () => Response.json({ success: true, result: { mallId: 1024,
    apiScopeList: ["bg.open.accesstoken.info.get", "bg.aftersales.parentaftersales.list.get"] } });
  try {
    await processCsGatewayJob({
      id: "11111111-1111-4111-8111-111111111111", claim_token: "22222222-2222-4222-8222-222222222222",
      credential_id: "33333333-3333-4333-8333-333333333333", channel: "temu", operation: "inquiries.list",
      environment: "production", attempt_count: 1,
      credential: { app_key: "fixture-app", app_secret: "fixture-secret", access_token: "fixture-token" },
      request: { arguments: { kind: "after_sales", seller_id: "untrusted-request-seller" } },
      credential_binding_context: { status: "verified", sellerAccountKey: expectedKey, sellerAccountKeySource: "provider_certified_v1" },
    }, {
      createGatewayHeartbeat: () => ({ start: async()=>{}, assertHealthy: async()=>{}, stop: async()=>{} }),
      persistWorkerCompletion: async (path: string, body: Record<string, any>) => {
        assert.equal(path, "/api/channel-gateway/worker/complete");
        completions.push(body);
      },
      reserveProviderRequest: async()=>{},
      executeProvider: (input: Parameters<typeof executeCsProviderJob>[0]) => executeCsProviderJob(input, async () => {
        inquiryCalls++;
        return { ok: true, channel: "temu", operation: "inquiries.list", steps: [{ name: "inquiries", ok: true,
          status: 200, data: { success: true, result: { total: 0, pageNumber: 0, data: [] } } }], safeMessage: "empty page" };
      }),
    });
  } finally { globalThis.fetch = originalFetch; }
  return { completions, inquiryCalls };
}

test("Mac Temu completion carries the observed mall binding through the HTTP schema", async () => {
  const { completions, inquiryCalls } = await run(key);
  assert.equal(inquiryCalls, 1);
  assert.equal(completions.length, 1);
  const body = gatewayWorkerCompletionSchema.parse(completions[0]);
  assert.equal(body.status, "succeeded");
  assert.equal(body.credentialBinding?.sellerAccountKey, key);
  assert.deepEqual(body.credentialBinding?.targetFingerprints, [key]);
  assert.doesNotMatch(JSON.stringify(body), /fixture-secret|fixture-token/);
  for (const sellerAccountKey of [undefined, "f".repeat(64), "invalid"]) {
    assert.equal(gatewayWorkerCompletionSchema.safeParse({ ...completions[0],
      credentialBinding: { ...completions[0].credentialBinding, sellerAccountKey },
    }).success, false);
  }
});
test("a different certified mall cannot become a successful Mac inquiry completion", async () => {
  const { completions, inquiryCalls } = await run("f".repeat(64));
  assert.equal(inquiryCalls, 0);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].status, "failed");
  assert.match(completions[0].error, /TEMU_SELLER_ACCOUNT_KEY_MISMATCH/);
  assert.equal(completions[0].credentialBinding, undefined);
});
