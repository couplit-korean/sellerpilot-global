import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedChannelInquiry } from "../lib/channels/inquiry-sync";
import type { ChannelOperationResult } from "../lib/channels/operations";
import {
  shopeeHistoryInterruptionEvidence,
  shopeeHistoryPageEvidence,
  withShopeeHistoryContinuation,
} from "../lib/channels/cs/shopee/history-event-evidence";

const shopId = "1719148844";
const jobId = "00000000-0000-4000-8000-000000008001";
const reviewArguments = {
  kind: "product_review", shopId, cursor: "", pageSize: 100,
  sellerpilotShopeeScopeKey: `shopee:${shopId}:product_review:cursor-corpus`,
  sellerpilotShopeeHistoryRunId: "history-run-1",
  sellerpilotShopeeHistorySequence: 1,
  sellerpilotShopeeInputCheckpointDigest: null,
};

function inquiry(commentId: string, suffix: string): NormalizedChannelInquiry {
  return {
    externalTicketId: `shopee:${shopId}:${commentId}`, customerName: "synthetic",
    subject: "synthetic", message: "synthetic", status: "waiting", priority: 3,
    receivedAt: "2026-09-08T00:00:00.000Z", remoteMessageId: `${shopId}:${commentId}:${suffix}`,
    inboundKey: `shopee:${suffix.padEnd(64, "a").slice(0, 64)}`,
    providerStatus: "waiting", ticketKind: "conversation", senderRole: "customer",
    providerContext: { shopId, commentId, itemId: "9001" },
    replyContext: { shopId, commentId, itemId: "9001" },
  };
}

test("review evidence binds the page, duplicate comment revisions, and continuation", () => {
  const nextArguments = withShopeeHistoryContinuation(reviewArguments, {
    ...reviewArguments, cursor: "opaque-next-cursor", sellerpilotPaginationDepth: 1,
    sellerpilotPaginationEpoch: 0, sellerpilotPaginationTrail: ["a".repeat(64)],
  });
  const result: ChannelOperationResult = {
    ok: true, channel: "shopee", operation: "inquiries.list",
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      sellerpilotProviderContext: { shopId },
      response: { item_comment_list: [{ comment_id: 7001 }, { comment_id: 7002 }] },
    } }],
    continuation: { reason: "page_cap_reached", arguments: nextArguments }, safeMessage: "synthetic",
  };
  const event = shopeeHistoryPageEvidence({ jobId, arguments: reviewArguments, result,
    normalizedInquiries: [inquiry("7001", "one"), inquiry("7001", "revision"), inquiry("7002", "two")] });
  assert.equal(event.remoteRecordDigests.length, 2);
  assert.equal(event.normalizedRecordDigests.length, 2);
  assert.equal(event.projectedEventDigests.length, 3);
  assert.equal(event.excludedRecordDigests.length, 0);
  assert.equal(event.nextCheckpoint?.kind, "product_review");
  assert.equal(nextArguments.sellerpilotShopeeInputCheckpointDigest, event.nextCheckpoint?.checkpointDigest);
});

test("return evidence keeps a 10-detail page and the eleventh item as checkpoint remainder", () => {
  const args = {
    kind: "return_refund", shopId, createTimeFrom: 1_780_000_000, createTimeTo: 1_781_296_000,
    pageNo: 1, pageSize: 100,
    sellerpilotShopeeScopeKey: `shopee:${shopId}:return_refund:1780000000-1781296000`,
    sellerpilotShopeeHistoryRunId: "history-run-1", sellerpilotShopeeHistorySequence: 1,
    sellerpilotShopeeInputCheckpointDigest: null,
  };
  const next = withShopeeHistoryContinuation(args, {
    ...args, returnQueue: ["RETURN_11"], nextPageNo: 2,
    sellerpilotPaginationDepth: 1, sellerpilotPaginationEpoch: 0,
    sellerpilotPaginationTrail: ["b".repeat(64)],
  });
  const ids = Array.from({ length: 10 }, (_, index) => `RETURN_${index + 1}`);
  const result: ChannelOperationResult = {
    ok: true, channel: "shopee", operation: "inquiries.list",
    steps: ids.map((returnSn, index) => ({ name: index ? `inquiries:${index + 1}` : "inquiries",
      ok: true, status: 200, data: { sellerpilotProviderContext: { shopId, kind: "return_refund", returnSn },
        response: { return_sn: returnSn } } })),
    continuation: { reason: "page_cap_reached", arguments: next }, safeMessage: "synthetic",
  };
  const normalized = ids.map((returnSn, index) => ({
    ...inquiry(String(8000 + index), `return${index}`),
    externalTicketId: `shopee:return:${shopId}:${returnSn}`,
    providerContext: { shopId, returnSn, kind: "return_refund" }, ticketKind: "after_sales" as const,
  }));
  const event = shopeeHistoryPageEvidence({ jobId, arguments: args, result, normalizedInquiries: normalized });
  assert.equal(event.remoteRecordDigests.length, 10);
  assert.equal(event.nextCheckpoint?.kind, "return_refund");
  if (event.nextCheckpoint?.kind === "return_refund") {
    assert.equal(event.nextCheckpoint.pendingDetailCount, 1);
    assert.equal(event.nextCheckpoint.nextListPageNo, 2);
  }
});

test("401 and 403 become shop-local authorization interruptions", () => {
  for (const error of ["SHOPEE_401_ACCESS_TOKEN_EXPIRED", "SHOPEE_403_PERMISSION_DENIED"]) {
    const event = shopeeHistoryInterruptionEvidence({ jobId, arguments: reviewArguments, error });
    assert.equal(event.type, "interruption");
    assert.equal(event.reason, "authorization_required");
    assert.equal(event.shopId, shopId);
  }
});
