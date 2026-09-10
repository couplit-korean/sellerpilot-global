import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const serverOnlyHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "data:text/javascript,export {};" }
      : nextResolve(specifier, context);
  },
});
const { processCommerceGatewayJob } = await import("../scripts/commerce-gateway-job.mjs");
serverOnlyHook.deregister();

const jobId = "33333333-3333-4333-8333-333333333333";
const claimToken = "44444444-4444-4444-8444-444444444444";
const credentialId = "55555555-5555-4555-8555-555555555555";
const merchantId = "5511564";
const shopId = "1719148844";
const future = "2099-01-01T00:00:00.000Z";

function credential() {
  return {
    partner_id: "2031489",
    partner_key: "fixture-partner-key",
    merchant_id: merchantId,
    shop_id: shopId,
    main_account_id: merchantId,
    provider_account_identity_version: "v1",
    provider_account_subject: `shopee:main:${merchantId}`,
    authorization_expires_at: future,
    shopee_targets: [
      {
        type: "merchant",
        id: merchantId,
        access_token: "merchant-access",
        refresh_token: "merchant-refresh",
        access_token_expires_at: future,
        refresh_token_expires_at: future,
      },
      {
        type: "shop",
        id: shopId,
        access_token: "shop-access",
        refresh_token: "shop-refresh",
        access_token_expires_at: future,
        refresh_token_expires_at: future,
      },
    ],
  };
}

test("local commerce worker exposes the one-shot fence and durable Shopee stage hooks", async () => {
  const persistenceCalls: Array<{ path: string; payload: Record<string, unknown> }> = [];
  let providerExecutionCalls = 0;
  await processCommerceGatewayJob({
    id: jobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "shopee",
    operation: "listing.create",
    environment: "production",
    request: {
      arguments: {
        globalProduct: true,
        market: "SG",
        merchantId,
        publish: { shop_id: shopId },
      },
    },
    credential: credential(),
    attempt_count: 1,
  }, {
    createGatewayHeartbeat: () => ({
      start: async () => undefined,
      stop: async () => undefined,
      assertHealthy: async () => undefined,
    }),
    persistWorkerCompletion: async (path: string, payload: Record<string, unknown>) => {
      persistenceCalls.push({ path, payload });
      if (path === "/api/channel-gateway/worker/shopee-create-stage") {
        if (payload.action === "state") {
          return Response.json({
            contract: "sellerpilot-shopee-sg-create-stage/1",
            nextSequence: 0,
            completedStages: [],
            startedStage: null,
          });
        }
        if (payload.action === "resume") {
          return Response.json({
            contract: "sellerpilot-shopee-sg-create-resume/1",
            status: "absent",
          });
        }
        return Response.json({
          contract: "sellerpilot-shopee-sg-create-stage/1",
          status: payload.action === "begin" ? "started" : "completed",
        });
      }
      return Response.json({ status: "recorded" });
    },
    executeCommerceOperation: async (input: Record<string, unknown>) => {
      providerExecutionCalls += 1;
      assert.equal(input.channel, "shopee");
      assert.equal(input.operation, "listing.create");
      assert.equal((input.payload as Record<string, unknown>).merchant_id, merchantId);
      assert.equal((input.shopeeShopCredential as Record<string, unknown>).shop_id, shopId);
      const hooks = input.providerMutationHooks as Record<string, (...args: unknown[]) => Promise<unknown>>;
      assert.equal(typeof hooks.begin, "function");
      assert.equal(typeof hooks.readShopeeSgCreateStageState, "function");
      assert.equal(typeof hooks.beginShopeeSgCreateStage, "function");
      assert.equal(typeof hooks.completeShopeeSgCreateStage, "function");
      assert.equal(typeof hooks.readShopeeSgCreateResume, "function");
      assert.equal(typeof hooks.recordShopeeSgGlobalCreateReadback, "function");
      await hooks.readShopeeSgCreateStageState();
      await hooks.begin();
      await hooks.beginShopeeSgCreateStage({
        contract: "sellerpilot-shopee-sg-create-stage/1",
        stageSequence: 0,
        stageName: "image",
        payloadSha256: "a".repeat(64),
        imageIndex: 0,
        imageUrl: "https://fixture.invalid/image-0.jpg",
        sourceSha256: "b".repeat(64),
      });
      await hooks.completeShopeeSgCreateStage({
        contract: "sellerpilot-shopee-sg-create-stage/1",
        stageSequence: 0,
        stageName: "image",
        payloadSha256: "a".repeat(64),
        imageIndex: 0,
        imageUrl: "https://fixture.invalid/image-0.jpg",
        sourceSha256: "b".repeat(64),
        outputId: "provider-image-0",
        result: { response: { image_info: { image_id: "provider-image-0" } } },
      });
      assert.equal(await hooks.readShopeeSgCreateResume(), null);
      await hooks.recordShopeeSgGlobalCreateReadback({
        globalItemId: "21000000000001",
        createResponse: { response: { global_item_id: 21000000000001 } },
        officialReadback: { response: { global_item_list: [] } },
      });
      return {
        ok: false,
        channel: "shopee",
        operation: "listing.create",
        steps: [{ name: "fixture-stop", ok: false, status: 409, data: {} }],
        safeMessage: "fixture stopped before provider mutation",
      };
    },
  });

  assert.equal(providerExecutionCalls, 1);
  assert.equal(
    persistenceCalls.filter(({ path }) => path === "/api/channel-gateway/worker/begin-mutation").length,
    1,
  );
  assert.deepEqual(
    persistenceCalls
      .filter(({ path }) => path === "/api/channel-gateway/worker/shopee-create-stage")
      .map(({ payload }) => payload.action),
    ["state", "begin", "complete", "resume", "record-global"],
  );
});

test("local worker classifies a response-lost image stage as reconciliation required", async () => {
  const completionStatuses: unknown[] = [];
  let uploadCalls = 0;
  await processCommerceGatewayJob({
    id: jobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "shopee",
    operation: "listing.create",
    environment: "production",
    request: {
      arguments: {
        globalProduct: true,
        market: "SG",
        merchantId,
        publish: { shop_id: shopId },
      },
    },
    credential: credential(),
    attempt_count: 1,
  }, {
    createGatewayHeartbeat: () => ({
      start: async () => undefined,
      stop: async () => undefined,
      assertHealthy: async () => undefined,
    }),
    persistWorkerCompletion: async (path: string, payload: Record<string, unknown>) => {
      if (path === "/api/channel-gateway/worker/complete") {
        completionStatuses.push(payload.status);
      }
      if (path === "/api/channel-gateway/worker/shopee-create-stage") {
        return Response.json({
          contract: "sellerpilot-shopee-sg-create-stage/1",
          status: payload.action === "begin" ? "started" : "ready",
          nextSequence: 0,
          completedStages: [],
          startedStage: payload.action === "state" ? null : undefined,
        });
      }
      return Response.json({ status: "recorded" });
    },
    executeCommerceOperation: async (input: Record<string, unknown>) => {
      const hooks = input.providerMutationHooks as Record<string, (...args: unknown[]) => Promise<unknown>>;
      await hooks.begin();
      await hooks.beginShopeeSgCreateStage({
        sequence: 0,
        stage: "image-upload",
        preparedPayloadSha256: "a".repeat(64),
        sourceUrl: "https://fixture.invalid/image-0.jpg",
        sourceSha256: "b".repeat(64),
      });
      uploadCalls += 1;
      throw new Error("fixture provider image response lost after upload call");
    },
  });

  assert.equal(uploadCalls, 1);
  assert.deepEqual(completionStatuses, ["reconciliation_required"]);
});
