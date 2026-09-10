import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ProviderExecutionInput } from "../lib/channels/provider-execution-contract";
import {
  bindShopeeMultiShopContinuation,
  resolveShopeeMultiShopTarget,
} from "../lib/channels/cs/shopee/multi-shop-continuation";
import { buildShopeeHistoryRecoveryRequest } from "../lib/channels/cs/shopee/history-recovery";
import { withShopeeHistoryContinuation } from "../lib/channels/cs/shopee/history-event-evidence";
import { planShopeeReviewHistory } from "../lib/channels/cs/shopee/history-plan";
import type { ShopeeHistoryCheckpoint } from "../lib/channels/cs/shopee/history-progress";
import { executeCsProviderJob } from "../lib/cs/operations/provider";

const credentialId = "00000000-0000-4000-8000-000000039001";
const failedJobId = "00000000-0000-4000-8000-000000039002";
const historyRunId = "shopee-history-00000000000040008000000000039003";
const cursor = "opaque-combined+/cursor==";
const digest = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value), "utf8").digest("hex");

function credential(shopIds: string[], mainAccountId = "9001") {
  return {
    partner_id: "2031489",
    partner_key: "synthetic-partner-key",
    main_account_id: mainAccountId,
    provider_account_identity_version: "v1",
    provider_account_subject: `shopee:main:${mainAccountId}`,
    shop_id: shopIds[0],
    shop_ids: shopIds,
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: shopIds.map((id) => ({
      type: "shop",
      id,
      access_token: `access-${id}`,
      refresh_token: `refresh-${id}`,
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-02-01T00:00:00.000Z",
    })),
  };
}

function providerInput(arguments_: Record<string, unknown>, shopIds: string[], mainAccountId = "9001") {
  const events: string[] = [];
  const input: ProviderExecutionInput = {
    job: {
      id: "00000000-0000-4000-8000-000000039004",
      claim_token: "00000000-0000-4000-8000-000000039005",
      credential_id: credentialId,
      channel: "shopee",
      operation: "inquiries.list",
      environment: "production",
      request: { periodicKey: "inquiries:combined-integration", arguments: arguments_ },
      credential: credential(shopIds, mainAccountId),
      attempt_count: 1,
    },
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("provider-mutation"); },
      beginCredentialMutation: async () => { events.push("credential-mutation"); },
      stageCredentialRefresh: async () => { events.push("credential-stage"); },
    },
  };
  return { input, events };
}

function recoveryFixture(shopId = "1002") {
  const [scope] = planShopeeReviewHistory([{ shopId, country: "SG" }]);
  const initial = {
    ...scope.arguments,
    sellerpilotShopeeScopeKey: scope.scopeKey,
    sellerpilotShopeeHistoryRunId: historyRunId,
    sellerpilotShopeeHistorySequence: 1,
    sellerpilotShopeeInputCheckpointDigest: null,
  };
  const failedArguments = withShopeeHistoryContinuation(initial, {
    ...initial,
    cursor,
    sellerpilotPaginationDepth: 1,
    sellerpilotPaginationEpoch: 0,
    sellerpilotPaginationTrail: ["d".repeat(64)],
  });
  const checkpoint: ShopeeHistoryCheckpoint = {
    kind: "product_review",
    checkpointDigest: String(failedArguments.sellerpilotShopeeInputCheckpointDigest),
    cursorDigest: digest(cursor),
    paginationDepth: 1,
    paginationEpoch: 0,
  };
  const build = (recoveryCredentialId = credentialId) => buildShopeeHistoryRecoveryRequest({
    credentialId: recoveryCredentialId,
    historyRunId,
    scope,
    activeCheckpoint: checkpoint,
    failedJob: {
      id: failedJobId,
      credentialId,
      channel: "shopee",
      operation: "inquiries.list",
      status: "failed",
      request: { arguments: failedArguments },
    },
    interruption: {
      jobId: failedJobId,
      sequence: 2,
      checkpointDigest: checkpoint.checkpointDigest,
      reason: "failed",
    },
  });
  return { scope, checkpoint, failedArguments, build };
}

const success = (shopId: unknown) => ({
  ok: true as const,
  channel: "shopee" as const,
  operation: "inquiries.list" as const,
  steps: [{
    name: "inquiries",
    ok: true,
    status: 200,
    data: {
      sellerpilotProviderContext: { shopId },
      response: { item_comment_list: [], more: false, next_cursor: "" },
    },
  }],
  safeMessage: "synthetic read",
});

test("reordered authorized shops continue with the immutable next shop ID", async () => {
  const calls: string[] = [];
  const firstInput = providerInput({ kind: "product_review", cursor: "", pageSize: 100 },
    ["1001", "1002", "1003"]);
  const first = await executeCsProviderJob(firstInput.input, async (request) => {
    calls.push(String(request.arguments.shopId));
    return success(request.arguments.shopId);
  });
  assert.equal(first.continuation?.arguments.sellerpilotShopeeTargetShopId, "1002");

  const reorderedInput = providerInput(first.continuation!.arguments, ["1003", "1001", "1002"]);
  await executeCsProviderJob(reorderedInput.input, async (request) => {
    calls.push(String(request.arguments.shopId));
    return success(request.arguments.shopId);
  });
  assert.deepEqual(calls, ["1001", "1002"]);
  assert.equal(firstInput.events.includes("provider-mutation"), false);
  assert.equal(reorderedInput.events.includes("provider-mutation"), false);
});

test("added or removed authorized shops fail before any provider call", async () => {
  const target = resolveShopeeMultiShopTarget(["1001", "1002", "1003"], {});
  const bound = bindShopeeMultiShopContinuation({
    kind: "product_review",
    cursor: "",
    pageSize: 100,
  }, target, "1002");
  let providerCalls = 0;
  for (const changedPlan of [
    ["1003", "1002", "1001", "1004"],
    ["1002", "1001"],
  ]) {
    const attempted = providerInput(bound, changedPlan);
    await assert.rejects(
      executeCsProviderJob(attempted.input, async (request) => {
        providerCalls += 1;
        return success(request.arguments.shopId);
      }),
      /SHOPEE_INQUIRY_TARGET_PLAN_CHANGED/u,
    );
    assert.equal(attempted.events.length, 0);
  }
  assert.equal(providerCalls, 0);
});

test("history recovery bypasses plan order but preserves the confirmed shop, cursor, and checkpoint", async () => {
  const fixture = recoveryFixture();
  const recovered = fixture.build();
  const attempted = providerInput(recovered.request.arguments, ["1003", "1001", "1002"]);
  const providerCalls: Array<Record<string, unknown>> = [];
  await executeCsProviderJob(attempted.input, async (request) => {
    providerCalls.push({
      shopId: request.arguments.shopId,
      cursor: request.arguments.cursor,
      checkpoint: request.arguments.sellerpilotShopeeInputCheckpointDigest,
      accessToken: request.payload.access_token,
    });
    return success(request.arguments.shopId);
  });

  assert.deepEqual(providerCalls, [{
    shopId: "1002",
    cursor,
    checkpoint: fixture.checkpoint.checkpointDigest,
    accessToken: "access-1002",
  }]);
  const changedKeys = Object.keys(recovered.request.arguments).filter((key) =>
    recovered.request.arguments[key] !== fixture.failedArguments[key]);
  assert.deepEqual(changedKeys.sort(), [
    "sellerpilotShopeeHistoryRecoveryAttempt",
    "sellerpilotShopeeHistoryRecoveryContract",
    "sellerpilotShopeeHistoryRecoveryOfJobId",
    "sellerpilotShopeeHistorySequence",
  ]);
  assert.equal(attempted.events.includes("provider-mutation"), false);
});

test("wrong credential lineage and wrong provider account fail before the provider executor", async () => {
  const fixture = recoveryFixture();
  assert.throws(
    () => fixture.build("00000000-0000-4000-8000-000000039099"),
    /SHOPEE_HISTORY_RECOVERY_JOB_INVALID/u,
  );

  const recovered = fixture.build();
  const wrongAccount = providerInput(recovered.request.arguments, ["1002"], "9999");
  wrongAccount.input.job.credential.provider_account_subject = "shopee:main:9001";
  let providerCalls = 0;
  await assert.rejects(
    executeCsProviderJob(wrongAccount.input, async (request) => {
      providerCalls += 1;
      return success(request.arguments.shopId);
    }),
    /PROVIDER_ACCOUNT_IDENTITY_MISMATCH/u,
  );
  assert.equal(providerCalls, 0);
  assert.deepEqual(wrongAccount.events, ["lease"]);
});
