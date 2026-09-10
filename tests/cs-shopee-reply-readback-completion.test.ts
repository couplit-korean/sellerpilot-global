import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ProviderJob } from "../lib/channels/provider-execution-contract";
import type { CsOperationResult } from "../lib/cs/operations/contracts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  return nextResolve(specifier, context);
} });
const { completeCsClaim } = await import("../lib/cs/operations/complete");
const { executeCsProviderJob } = await import("../lib/cs/operations/provider");

const deliveryId = "00000000-0000-4000-8000-000000069001";
const sourceJobId = "00000000-0000-4000-8000-000000069002";
const readJobId = "00000000-0000-4000-8000-000000069003";
const claimToken = "00000000-0000-4000-8000-000000069004";
const ticketId = "00000000-0000-4000-8000-000000069005";
const credentialId = "00000000-0000-4000-8000-000000069006";
const reply = "정확한 판매자 답변";
const replyFingerprint = createHash("sha256").update(reply).digest("hex");
const shopId = "1002";
const commentId = "7002";
const itemId = "8002";

function job(attempt = 1): ProviderJob {
  return {
    id: readJobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "shopee",
    operation: "inquiries.list",
    environment: "production",
    attempt_count: 1,
    credential: {},
    request: {
      periodicKey: `inquiries:reply-readback:shopee:${deliveryId}:${attempt}`,
      arguments: { kind: "product_review", shopId, commentId, itemId, cursor: "", pageSize: 100 },
      sellerpilotShopeeReplyReadback: {
        contract: "sellerpilot-shopee-reply-readback/1",
        deliveryId,
        sourceJobId,
        ticketId,
        expectedInboundKey: `shopee:${"a".repeat(64)}`,
        expectedReplyFingerprint: replyFingerprint,
        shopId,
        commentId,
        itemId,
        attempt,
      },
    },
  };
}

function result(observedReply?: string): CsOperationResult {
  return {
    ok: true,
    channel: "shopee",
    operation: "inquiries.list",
    safeMessage: "synthetic read",
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      sellerpilotProviderContext: { shopId },
      response: { item_comment_list: [{
        comment_id: commentId,
        item_id: itemId,
        comment: "구매자 후기",
        buyer_username: "buyer",
        create_time: 1_788_800_000,
        ...(observedReply === undefined ? {} : {
          comment_reply: { reply: observedReply, create_time: 1_788_800_030 },
        }),
      }], more: false, next_cursor: "" },
    } }],
  };
}

async function run(providerResult: CsOperationResult, attempt = 1, readJob = job(attempt)) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const outcome = await completeCsClaim({ rpc: async (name, args = {}) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "sellerpilot_service_serverless_cs_completion_context") return { data: {
      status: "running", channel: "shopee", operation: "inquiries.list",
      normalization_timestamp: "2026-09-09T10:00:00.000Z",
    }, error: null };
    if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
      return { data: { status: "completed" }, error: null };
    }
    if (name === "sellerpilot_service_observe_inquiry_replies_v1") return { data: {
      contract: "sellerpilot-reply-observation-result/1",
      received: 1, stored: 1, matched: 1, unmatched: 0, ambiguous: 0,
    }, error: null };
    if (name === "sellerpilot_service_record_shopee_reply_readback_v1") return { data: {
      contract: "sellerpilot-shopee-reply-readback-result/1",
      deliveryId,
      attempt,
      state: (args.p_outcome as Record<string, unknown>).state,
      automaticResendAllowed: false,
    }, error: null };
    return { data: null, error: { code: "unexpected_rpc" } };
  } }, "e".repeat(64), readJob, { status: "succeeded", result: providerResult });
  return { outcome, calls };
}

async function executeReadJob() {
  const readJob = job();
  readJob.credential = {
    partner_id: "2031489",
    partner_key: "synthetic-partner-key",
    main_account_id: "9001",
    provider_account_identity_version: "v1",
    provider_account_subject: "shopee:main:9001",
    shop_id: shopId,
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: [{ type: "shop", id: shopId, access_token: "access-token",
      refresh_token: "refresh-token", access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-02-01T00:00:00.000Z" }],
  };
  const calls: Array<{ operation: string; arguments: Record<string, unknown> }> = [];
  let providerMutation = false;
  const providerResult = await executeCsProviderJob({
    job: readJob,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => {},
      beginProviderMutation: async () => { providerMutation = true; },
      beginCredentialMutation: async () => {},
      stageCredentialRefresh: async () => {},
    },
  }, async (input) => {
    calls.push({ operation: input.operation, arguments: input.arguments });
    return result(reply);
  });
  return { providerResult, calls, providerMutation };
}

test("completion stores the read, observes the exact seller echo, then records the delivery-bound outcome", async () => {
  const executed = await executeReadJob();
  assert.deepEqual(executed.calls, [{ operation: "inquiries.list", arguments: {
    kind: "product_review", shopId, commentId, itemId, cursor: "", pageSize: 100,
  } }]);
  assert.equal(executed.providerMutation, false);
  const { outcome, calls } = await run(executed.providerResult);
  assert.equal(outcome, "completed");
  const completed = calls.find((call) => call.name === "sellerpilot_service_complete_serverless_cs_transaction")!;
  const observations = calls.find((call) => call.name === "sellerpilot_service_observe_inquiry_replies_v1")!;
  const readback = calls.find((call) => call.name === "sellerpilot_service_record_shopee_reply_readback_v1")!;
  assert.equal((completed.args.p_normalized_inquiries as unknown[]).length, 1);
  assert.equal((observations.args.p_observations as unknown[]).length, 1);
  assert.equal((readback.args.p_outcome as Record<string, unknown>).state, "observed");
  assert.equal((readback.args.p_outcome as Record<string, unknown>).automaticResendAllowed, false);
  assert.ok(calls.indexOf(readback) > calls.indexOf(observations));
});

test("missing and mismatched replies are recorded without invoking a reply operation", async () => {
  const delayed = await run(result(), 1);
  const delayedReadback = delayed.calls.find((call) => call.name === "sellerpilot_service_record_shopee_reply_readback_v1")!;
  assert.equal((delayedReadback.args.p_outcome as Record<string, unknown>).state, "delayed");
  assert.equal(delayed.calls.some((call) => call.name === "sellerpilot_service_observe_inquiry_replies_v1"), false);

  const mismatch = await run(result("다른 판매자 답변"), 2);
  const mismatchReadback = mismatch.calls.find((call) => call.name === "sellerpilot_service_record_shopee_reply_readback_v1")!;
  assert.equal((mismatchReadback.args.p_outcome as Record<string, unknown>).state, "mismatch");
  assert.equal(mismatch.calls.some((call) => call.name.includes("reply")
    && !call.name.includes("readback") && !call.name.includes("observation")), false);
});


test("malformed readback context fails closed without invoking a completion mutation", async () => {
  const readJob = job();
  readJob.request.sellerpilotShopeeReplyReadback = null;
  const { outcome, calls } = await run(result(), 1, readJob);
  assert.equal(outcome, "ownership_lost");
  assert.equal(calls.some(call => call.name.includes("complete_serverless")), false);
});
