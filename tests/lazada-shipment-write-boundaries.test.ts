import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  return next(specifier, context);
} });
const { executeServerlessGatewayProviderJob } = await import("../lib/channels/serverless-gateway-provider");
const shipment = {
  channel: "lazada" as const, operation: "shipment.confirm" as const, environment: "production" as const,
  payload: { app_key: "fixture", app_secret: "fixture", access_token: "fixture", country: "my" },
  arguments: { orderId: "ORDER-1", carrierCode: "FM49", providerContext: { orderId: "ORDER-1", orderItemIds: ["ITEM-1"], deliveryType: "dropship" } },
};
const providers = { code: "0", result: { success: "true", error_code: "0", data: { shipment_providers: [{ name: "LEX", provider_code: "FM49" }], shipping_allocate_type: "TFS" } } };
const pack = { code: "0", result: { success: "true", error_code: "0", data: { packages: [{ package_id: "PK-1", tracking_number: "TRACK-1" }] } } };

async function run(options: { missing?: boolean; block?: number; leaseAfterBegin?: boolean; packFails?: boolean; providerFails?: boolean } = {}) {
  const original = globalThis.fetch;
  const events: string[] = [];
  let begins = 0;
  globalThis.fetch = async (input) => {
    const endpoint = new URL(String(input)).pathname;
    events.push(endpoint);
    if (endpoint.endsWith("/providers/get")) return Response.json(options.providerFails ? { code: "1" } : providers);
    if (endpoint.endsWith("/fulfill/pack")) return Response.json(options.packFails ? { code: "1" } : pack);
    if (endpoint.endsWith("/package/rts")) return Response.json(pack);
    throw new Error(`unexpected fixture request ${endpoint}`);
  };
  try {
    const promise = executeChannelOperation({ ...shipment, ...(options.missing ? {} : { providerMutationHooks: {
      assertLeaseHealthy: async () => { events.push("lease"); if (options.leaseAfterBegin && begins === 2) throw new Error("LEASE_LOST"); },
      begin: async () => { begins += 1; events.push("begin"); if (begins === options.block) throw new Error("OWNERSHIP_BLOCKED"); },
    } }) });
    if (options.missing || options.block || options.leaseAfterBegin) {
      await assert.rejects(promise, /HOOKS_REQUIRED|OWNERSHIP_BLOCKED|LEASE_LOST/);
    } else {
      const result = await promise;
      assert.equal(result.ok, !options.packFails && !options.providerFails);
    }
    return { events, begins };
  } finally { globalThis.fetch = original; }
}

test("Lazada pack and RTS each require a fresh begin bracketed by lease checks", async () => {
  const { events, begins } = await run();
  assert.equal(begins, 2);
  assert.deepEqual(events, ["/rest/order/shipment/providers/get", "lease", "begin", "lease", "/rest/order/fulfill/pack", "lease", "begin", "lease", "/rest/order/package/rts"]);
});

test("Lazada ownership rejection or lease loss after pack permits zero RTS calls", async () => {
  for (const options of [{ block: 2 }, { leaseAfterBegin: true }]) {
    const { events } = await run(options);
    assert.equal(events.filter((event) => event.endsWith("/fulfill/pack")).length, 1);
    assert.equal(events.filter((event) => event.endsWith("/package/rts")).length, 0);
  }
});

test("missing or rejected shipment hooks cannot reach pack; read and failed-pack paths are unchanged", async () => {
  for (const options of [{ missing: true }, { block: 1 }]) {
    const { events } = await run(options);
    assert.equal(events.filter((event) => event.endsWith("/fulfill/pack")).length, 0);
  }
  assert.equal((await run({ providerFails: true })).begins, 0);
  const failedPack = await run({ packFails: true });
  assert.equal(failedPack.begins, 1);
  assert.equal(failedPack.events.filter((event) => event.endsWith("/package/rts")).length, 0);
});

test("serverless passes Lazada per-write hooks without consuming a whole-operation fence", async () => {
  let begins = 0;
  const attested = withLazadaProviderAccountIdentity({ ...shipment.payload, access_token_expires_at: "2099-01-01T00:00:00Z" }, {
    account_platform: "seller_center", country_user_info: [{ country: "my", seller_id: "2001", user_id: "3001", short_code: "local-shop" }],
  }).payload;
  const job: GatewayClaim = { id: "51000000-0000-4000-8000-000000000001", claim_token: "52000000-0000-4000-8000-000000000001", credential_id: "53000000-0000-4000-8000-000000000001", channel: "lazada", operation: "shipment.confirm", environment: "production", request: { arguments: shipment.arguments }, credential: attested, attempt_count: 1 };
  await executeServerlessGatewayProviderJob({ job, signal: new AbortController().signal, hooks: {
    assertLeaseHealthy: async () => {}, beginProviderMutation: async () => { begins += 1; },
    beginCredentialMutation: async () => { throw new Error("unexpected OAuth mutation"); }, stageCredentialRefresh: async () => {},
  } }, async (input) => {
    assert.equal(begins, 0);
    assert.ok(input.providerMutationHooks);
    await input.providerMutationHooks.begin();
    await input.providerMutationHooks.begin();
    return { channel: "lazada", operation: "shipment.confirm", ok: true, steps: [], safeMessage: "local fixture" };
  });
  assert.equal(begins, 2);
});

test("local worker forwards uncached Lazada hooks and keeps other operations' original fence", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /const lazadaShipmentBoundary = job.channel === "lazada" && job.operation === "shipment.confirm"/);
  assert.match(worker, /writeChannelOperations.has\(job.operation\) && !lazadaShipmentBoundary/);
  assert.match(worker, /providerMutationHooks: \{\s*begin: markExternalWriteStarted,\s*assertLeaseHealthy: assertGatewayLeaseHealthy/);
  const begin = worker.slice(worker.indexOf("const markExternalWriteStarted = async"), worker.indexOf("const markExternalMutationStarted = async"));
  assert.match(begin, /await persistWorkerCompletion\(\s*"\/api\/channel-gateway\/worker\/begin-mutation"/);
  assert.doesNotMatch(begin, /if \(externalWriteStarted\)|fencePromise|providerMutationFenced/);
});
