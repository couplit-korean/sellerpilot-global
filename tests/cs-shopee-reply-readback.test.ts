import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import type { CsOperationResult } from "../lib/cs/operations/contracts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  }
  return nextResolve(specifier, context);
} });

const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");
const {
  shopeeReplyReadbackContext,
  shopeeReplyReadbackRpcArguments,
  verifyShopeeReplyReadback,
} = await import("../lib/channels/cs/shopee/reply-readback");

const deliveryId = "00000000-0000-4000-8000-000000049001";
const sourceJobId = "00000000-0000-4000-8000-000000049002";
const ticketId = "00000000-0000-4000-8000-000000049003";
const shopId = "1002";
const commentId = "7002";
const itemId = "8002";
const reply = "정확한 판매자 답변";
const fingerprint = (value: string) => createHash("sha256").update(value.trim()).digest("hex");

function request(attempt = 1) {
  return {
    periodicKey: `inquiries:reply-readback:shopee:${deliveryId}:${attempt}`,
    arguments: { kind: "product_review", shopId, commentId, itemId, cursor: "", pageSize: 100 },
    sellerpilotShopeeReplyReadback: {
      contract: "sellerpilot-shopee-reply-readback/1",
      deliveryId,
      sourceJobId,
      ticketId,
      expectedInboundKey: `shopee:${"a".repeat(64)}`,
      expectedReplyFingerprint: fingerprint(reply),
      shopId,
      commentId,
      itemId,
      attempt,
    },
  };
}

function providerResult(options: {
  reply?: string;
  replyTime?: number | null;
  observedShopId?: string;
  observedCommentId?: string;
  observedItemId?: string;
} = {}): CsOperationResult {
  const observedShopId = options.observedShopId ?? shopId;
  const observedCommentId = options.observedCommentId ?? commentId;
  const observedItemId = options.observedItemId ?? itemId;
  return {
    ok: true,
    channel: "shopee",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotProviderContext: { shopId: observedShopId },
        response: {
          item_comment_list: [{
            comment_id: observedCommentId,
            item_id: observedItemId,
            comment: "구매자 후기",
            buyer_username: "buyer",
            create_time: 1_788_800_000,
            ...(options.reply === undefined ? {} : {
              comment_reply: {
                reply: options.reply,
                ...(options.replyTime === null ? {} : { create_time: options.replyTime ?? 1_788_800_030 }),
              },
            }),
          }],
          more: false,
          next_cursor: "",
        },
      },
    }],
    safeMessage: "synthetic read",
  };
}

function verify(result: CsOperationResult, attempt = 1) {
  const context = shopeeReplyReadbackContext(request(attempt))!;
  return verifyShopeeReplyReadback({
    context,
    result,
    normalizedInquiries: normalizeChannelInquiries("shopee", result, "2026-09-09T10:00:00.000Z"),
  });
}

test("exact readback context binds one delivery, job, shop, item, comment, body digest, and attempt", () => {
  const context = shopeeReplyReadbackContext(request(2))!;
  assert.equal(context.shopId, shopId);
  assert.equal(context.commentId, commentId);
  assert.equal(context.itemId, itemId);
  assert.equal(context.attempt, 2);
  assert.equal(context.expectedReplyFingerprint, fingerprint(reply));
  assert.throws(() => shopeeReplyReadbackContext({ ...request(2), periodicKey: "forged" }),
    /SHOPEE_REPLY_READBACK_CONTEXT_INVALID/u);
  assert.throws(() => shopeeReplyReadbackContext({ ...request(2), arguments: {
    ...request(2).arguments, shopId: "9999",
  } }), /SHOPEE_REPLY_READBACK_CONTEXT_INVALID/u);
});

test("exact seller body and binding become observed and remain read-only", () => {
  const context = shopeeReplyReadbackContext(request())!;
  const outcome = verify(providerResult({ reply }));
  assert.deepEqual(outcome, {
    state: "observed",
    reason: "exact_reply_observed",
    attempt: 1,
    matchingSellerReplies: 1,
    replyContentObserved: true,
    automaticResendAllowed: false,
  });
  assert.deepEqual(shopeeReplyReadbackRpcArguments({
    tokenHash: "b".repeat(64),
    jobId: "00000000-0000-4000-8000-000000049004",
    claimToken: "00000000-0000-4000-8000-000000049005",
    context,
    verification: outcome,
  }).p_outcome, outcome);
});

test("missing reply is delayed before the bound and final missing at attempt three", () => {
  const result = providerResult();
  assert.deepEqual(verify(result, 1), {
    state: "delayed", reason: "exact_reply_not_yet_observed", attempt: 1,
    matchingSellerReplies: 0, replyContentObserved: false, automaticResendAllowed: false,
  });
  assert.deepEqual(verify(result, 3), {
    state: "missing", reason: "exact_reply_missing_after_bound", attempt: 3,
    matchingSellerReplies: 0, replyContentObserved: false, automaticResendAllowed: false,
  });
});

test("wrong body, wrong target, and missing timestamp never count as remote observation", () => {
  assert.equal(verify(providerResult({ reply: "다른 판매자 답변" })).reason, "reply_body_mismatch");
  assert.equal(verify(providerResult({ reply, observedCommentId: "7999" })).reason, "reply_target_mismatch");
  assert.deepEqual(verify(providerResult({ reply, replyTime: null })), {
    state: "incomplete", reason: "reply_timestamp_unavailable", attempt: 1,
    matchingSellerReplies: 0, replyContentObserved: false, automaticResendAllowed: false,
  });
});
