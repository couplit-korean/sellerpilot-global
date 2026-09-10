import assert from "node:assert/strict";
import test from "node:test";
import { inquiryCoverageEvidence } from "../lib/channels/inquiry-coverage";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import type { ChannelOperationResult } from "../lib/channels/operations";

const at = "2026-09-08T00:00:00.000Z";

test("coverage keeps provider rows, projected events and unique observations separate", () => {
  const result: ChannelOperationResult = {
    ok: true,
    channel: "shopee",
    operation: "inquiries.list",
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      sellerpilotProviderContext: { shopId: "1719148844" },
      response: { item_comment_list: [{
        comment_id: 101,
        item_id: 202,
        buyer_username: "buyer",
        comment: "문의",
        create_time: 1_788_200_000,
        comment_reply: { reply: "답변", create_time: 1_788_200_100 },
      }] },
    } }],
    safeMessage: "ok",
  };
  const inquiries = normalizeChannelInquiries("shopee", result, at);
  const evidence = inquiryCoverageEvidence("shopee", result, inquiries);
  assert.equal(evidence.providerRowCount, 1);
  assert.equal(evidence.projectedEventCount, 2);
  assert.equal(evidence.eventRowComparable, false);
  assert.equal(evidence.observationDigests.length, 2);
  assert.equal(new Set(evidence.observationDigests).size, 2);
});

test("coverage records explicit exclusions without inventing missing rows", () => {
  const result: ChannelOperationResult = {
    ok: true,
    channel: "ebay",
    operation: "inquiries.list",
    steps: [{ name: "inquiries", ok: true, status: 200, data: { myMessages: [{
      messageId: "1", externalMessageId: "external-1", messageType: "AskSellerQuestion",
      sender: "buyer", itemId: "123", marketplaceId: "EBAY_US", responseEnabled: true,
      content: "duplicate ASQ", subject: "question", receiveDate: at,
    }] } }],
    safeMessage: "ok",
  };
  const inquiries = normalizeChannelInquiries("ebay", result, at);
  const evidence = inquiryCoverageEvidence("ebay", result, inquiries);
  assert.equal(inquiries.length, 0);
  assert.equal(evidence.providerRowCount, 1);
  assert.equal(evidence.excludedCount, 1);
  assert.equal(evidence.eventRowComparable, true);
});

test("coverage preserves terminal-page evidence and does not infer a total", () => {
  const result: ChannelOperationResult = {
    ok: true,
    channel: "qoo10",
    operation: "inquiries.list",
    steps: [{ name: "inquiries", ok: true, status: 200, data: { ResultObject: [] } }],
    safeMessage: "empty",
  };
  assert.deepEqual(inquiryCoverageEvidence("qoo10", result, []), {
    contractVersion: "sellerpilot-inquiry-coverage/1",
    providerRowCount: 0,
    projectedEventCount: 0,
    excludedCount: 0,
    eventRowComparable: true,
    observationDigests: [],
    hasContinuation: false,
  });
});
