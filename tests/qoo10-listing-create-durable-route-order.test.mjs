import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("actual admin route reads durable QSM source before fingerprint/claim/enqueue", async () => {
  const source = await readFile(new URL(
    "../app/api/admin/channel-operations/route.ts", import.meta.url,
  ), "utf8");
  const rejectClient = source.indexOf("qoo10DurableCreateFulfillmentBindingArgument");
  const bind = source.indexOf("bindQoo10ListingCreateApprovalFromDurableSource({");
  const fingerprint = source.indexOf("const baseRequestFingerprint");
  const claim = source.indexOf('userClient.rpc("sellerpilot_claim_channel_operation"');
  const enqueue = source.indexOf("executeViaChannelGateway({");
  assert.ok(rejectClient > 0);
  assert.ok(bind > rejectClient);
  assert.ok(fingerprint > bind);
  assert.ok(claim > fingerprint);
  assert.ok(enqueue > claim);
  assert.match(source.slice(bind, fingerprint), /productId:\s*parsed\.data\.productId!/u);
  assert.match(source.slice(bind, fingerprint), /targetId:\s*parsed\.data\.targetId/u);
});

test("actual worker delays Qoo10 create mutation and actual executor CAS precedes SetNewGoods", async () => {
  const provider = await readFile(new URL(
    "../lib/channels/commerce-provider.ts", import.meta.url,
  ), "utf8");
  const worker = await readFile(new URL(
    "../lib/channels/serverless-gateway.ts", import.meta.url,
  ), "utf8");
  const qoo10 = await readFile(new URL(
    "../lib/product-registration/channels/qoo10.ts", import.meta.url,
  ), "utf8");
  assert.match(provider, /const delayedQoo10CreateBoundary[\s\S]*?!delayedQoo10CreateBoundary[\s\S]*?providerMutationHooks/u);
  assert.match(worker, /beginProviderMutation: async[\s\S]*?beginQoo10GatewayCreateMutationBoundary[\s\S]*?qoo10CreateBoundaryCrossed = true/u);
  assert.doesNotMatch(
    worker.slice(worker.indexOf('job.channel === "qoo10"'), worker.indexOf("readShopeeSgCreateStageState")),
    /assertQoo10CreateFulfillmentMutationFence[\s\S]*?beginProviderMutation\(dependencies/u,
  );
  const finalFreshness = qoo10.indexOf("qoo10-create-final-approval-freshness-prewrite");
  const cas = qoo10.indexOf("await input.providerMutationHooks.begin()", finalFreshness);
  const providerCall = qoo10.indexOf("const remote = await qoo10Request({", cas);
  assert.ok(finalFreshness > 0);
  assert.ok(cas > finalFreshness);
  assert.ok(providerCall > cas);
});
