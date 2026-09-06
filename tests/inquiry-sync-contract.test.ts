import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});
const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");
const timestamp = "2026-09-05T12:00:00.000Z";

function result(channel: ChannelOperationResult["channel"], pages: Record<string, unknown>[]): ChannelOperationResult {
  return {
    ok: true, channel, operation: "inquiries.list", safeMessage: "local fixture",
    steps: pages.map((data, index) => ({ name: `inquiries:${index + 1}`, ok: true, status: 200, data })),
  };
}

test("Qoo10 retains distinct message identities in one ticket while deduplicating page overlap", () => {
  const row = { INQ_TYPE: "MSG", QUESTION_NO: "123", SEQ_NO: "456", CONTENTS: "first message", MESSAGE_ID: "message-1" };
  const second = { ...row, MESSAGE_ID: "message-2", CONTENTS: "follow-up message" };
  const operation = result("qoo10", [{ ResultObject: [row, second] }, { ResultObject: [row] }]);
  const normalized = normalizeChannelInquiries("qoo10", operation, timestamp);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.map((item) => item.remoteMessageId), ["message-1", "message-2"]);
  assert.equal(new Set(normalized.map((item) => item.externalTicketId)).size, 1);
  assert.equal(new Set(normalized.map((item) => item.inboundKey)).size, 2);
  assert.deepEqual(normalizeChannelInquiries("qoo10", operation, timestamp), normalized);
});

test("Temu retains separate after-sales revisions returned across pages for one case", () => {
  const oldState = { parentAfterSalesSn: "case-1", parentOrderSn: "order-1", afterSalesStatusGroup: "1", updateAt: 1788600000000 };
  const newState = { ...oldState, afterSalesStatusGroup: "5", updateAt: 1788600100000 };
  const operation = result("temu", [
    { result: { data: [newState] } },
    { result: { data: [oldState, newState] } },
  ]);
  const normalized = normalizeChannelInquiries("temu", operation, timestamp);
  assert.equal(normalized.length, 2);
  assert.equal(new Set(normalized.map((item) => item.externalTicketId)).size, 1);
  assert.equal(new Set(normalized.map((item) => item.inboundKey)).size, 2);
  assert.deepEqual(normalized.map((item) => item.providerStatus), ["answered", "waiting"]);
});

test("same Qoo10 message identity still collapses repeated status observations", () => {
  const row = { INQ_TYPE: "ITEM", QUESTION_NO: "123", SEQ_NO: "456", CONTENTS: "question", MESSAGE_ID: "message-1" };
  const normalized = normalizeChannelInquiries("qoo10", result("qoo10", [
    { ResultObject: [{ ...row, STATUS: "S1" }] },
    { ResultObject: [{ ...row, STATUS: "S3" }] },
  ]), timestamp);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].providerStatus, "answered");
});


test("Lazada finalized history preserves buyer and seller identities across overlapping pages", () => {
  const session = { session_id: "session-full", title: "buyer", unread_count: 0 };
  const buyer1 = { message_id: "buyer-1", from_account_type: 1, send_time: "2026-09-05T10:00:00Z", content: { txt: "original", translateTxt: "translation" } };
  const seller1 = { message_id: "seller-1", from_account_type: 2, send_time: "2026-09-05T10:01:00Z", content: { txt: "seller answer" } };
  const buyer2 = { ...buyer1, message_id: "buyer-2", send_time: "2026-09-05T10:02:00Z", content: { txt: "follow-up" } };
  const operation: ChannelOperationResult = {
    ...result("lazada", []),
    steps: [[buyer2, seller1], [seller1, buyer1]].map((messages, index) => ({
      name: `inquiries-message:session-full:${index + 1}`, ok: true, status: 200,
      data: { sellerpilotSession: session, data: { message_list: messages } },
    })),
  };
  const history = normalizeChannelInquiries("lazada", operation, timestamp);
  assert.deepEqual(history.map((item) => item.remoteMessageId), ["buyer-1", "seller-1", "buyer-2"]);
  assert.deepEqual(history.map((item) => item.senderRole), ["customer", "seller", "customer"]);
  assert.deepEqual(history.map((item) => item.providerStatus), ["waiting", "answered", "waiting"]);
  assert.equal(history[0].message, "original");
  assert.equal(new Set(history.map((item) => item.inboundKey)).size, 3);
  assert.equal(new Set(history.map((item) => item.externalTicketId)).size, 1);
  assert.deepEqual(normalizeChannelInquiries("lazada", operation, timestamp), history);
});

test("Lazada does not fabricate messages from summaries, unknown senders or failed pages", () => {
  const base = { message_id: "id", from_account_type: 1, content: { txt: "valid text" } };
  const operation: ChannelOperationResult = {
    ...result("lazada", []),
    steps: [{ name: "inquiries-message:s:1", ok: true, status: 200, data: {
      sellerpilotSession: { session_id: "s", summary: "not a message" },
      data: { message_list: [
        { ...base, message_id: "" }, { ...base, content: {} },
        { ...base, from_account_type: undefined }, { ...base, from_account_type: 3 },
        { ...base, status: 1 },
      ] },
    } }, { name: "inquiries-message:s:2", ok: false, status: 500, data: {
      sellerpilotSession: { session_id: "s" }, data: { message_list: [base] },
    } }],
  };
  assert.deepEqual(normalizeChannelInquiries("lazada", operation, timestamp), []);
});

test("Lazada deduplicates within a session, not across sessions, including seller-only history", () => {
  const message = { message_id: "same-id", from_account_type: 2, send_time: 1788600000000, content: { txt: "seller text" } };
  const operation: ChannelOperationResult = {
    ...result("lazada", []),
    steps: ["s1", "s2"].map((sessionId) => ({
      name: `inquiries-message:${sessionId}:1`, ok: true, status: 200,
      data: { sellerpilotSession: { session_id: sessionId }, data: { message_list: [message, message] } },
    })),
  };
  const history = normalizeChannelInquiries("lazada", operation, timestamp);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((item) => item.senderRole), ["seller", "seller"]);
  assert.equal(new Set(history.map((item) => item.inboundKey)).size, 2);
});
