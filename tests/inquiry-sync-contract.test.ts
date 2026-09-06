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

test("Smartstore retains product answer lists, original bytes and stable overlap identities", () => {
  const row = { questionId: 901, question: "  original question\n", createDate: "2026-09-01T12:00:00+09:00", answered: true,
    answer: "  first answer\n", answers: [
      { answer: "  first answer\n", createDate: "2026-09-01T12:01:00+09:00" },
      { answer: "second answer", createDate: "2026-09-01T12:02:00+09:00" },
    ] };
  const operation = result("smartstore", [{ contents: [row] }, { contents: [row] }]);
  const rows = normalizeChannelInquiries("smartstore", operation, timestamp);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].message, row.question);
  assert.deepEqual(rows.slice(1).map(row => row.message), row.answers.map(row => row.answer));
  assert.deepEqual(rows.slice(1).map(row => row.receivedAt), ["2026-09-01T03:01:00.000Z", "2026-09-01T03:02:00.000Z"]);
  assert.ok(rows.slice(1).every(row => row.senderRole === "seller"));
  assert.equal(new Set(rows.map(row => row.externalTicketId)).size, 1);
  assert.equal(new Set(rows.map(row => row.inboundKey)).size, 3);
  assert.deepEqual(normalizeChannelInquiries("smartstore", operation, "2026-09-06T12:00:00Z"), rows);
});

test("Smartstore customer answer keeps provider ID and latest-only scope without replacing buyer identity", () => {
  const row = { inquiryNo: 701, inquiryContent: "question", inquiryRegistrationDateTime: "2026-09-01T00:00:00Z",
    answerContent: "  current answer\n", answerContentId: 702, answerRegistrationDateTime: "2026-09-01T00:01:00Z", answered: true };
  const rows = normalizeChannelInquiries("smartstore", result("smartstore", [{ sellerpilotInquiryKind: "customer", content: [row] }]), timestamp);
  assert.equal(rows.length, 2); assert.equal(rows[0].remoteMessageId, "701");
  assert.equal(rows[1].message, row.answerContent); assert.equal(rows[1].providerContext.answerContentId, "702");
  assert.equal(rows[1].providerContext.answerScope, "latest_answer");
  assert.notEqual(rows[1].inboundKey, rows[0].inboundKey);
});

test("undated Smartstore answers remain original notes and never become ordered seller turns", () => {
  for (const value of [null, "", "0", "2026-02-30T00:00:00Z", "2026-09-01T00:00:00"]) {
    const row = { questionId: 901, question: "question", createDate: "2026-09-01T00:00:00Z", answered: true,
      answers: [{ answer: "  undated original\n", createDate: value }] };
    const rows = normalizeChannelInquiries("smartstore", result("smartstore", [{ contents: [row] }]), timestamp);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].providerContext.unsequencedAnswers, [{ body: "  undated original\n", reason: "provider_timestamp_unavailable" }]);
  }
});

test("Smartstore legacy product answer is retained; later complete response clears its unsequenced note", () => {
  const row = { questionId: 901, question: "question", createDate: "2026-09-01T00:00:00Z", answer: "legacy answer", answered: true };
  const normalize = row => normalizeChannelInquiries("smartstore", result("smartstore", [{ contents: [row] }]), timestamp);
  assert.equal(normalize(row)[0].providerContext.unsequencedAnswers[0].body, "legacy answer");
  const resolved = normalize({ ...row, answers: [{ answer: row.answer, createDate: "2026-09-01T00:01:00Z" }] });
  assert.deepEqual(resolved[0].providerContext.unsequencedAnswers, []);
  assert.equal(resolved.length, 2);
});

test("Smartstore changed answer observations retain separate revisions and reject oversized data", () => {
  const row = { inquiryNo: 701, inquiryContent: "question", inquiryRegistrationDateTime: "2026-09-01T00:00:00Z",
    answerContentId: 702, answerRegistrationDateTime: "2026-09-01T00:01:00Z", answered: true };
  const make = body => ({ sellerpilotInquiryKind: "customer", content: [{ ...row, answerContent: body }] });
  const rows = normalizeChannelInquiries("smartstore", result("smartstore", [make("old"), make("new")]), timestamp);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter(row => row.senderRole === "seller").map(row => row.message), ["old", "new"]);
  assert.throws(() => normalizeChannelInquiries("smartstore", result("smartstore", [make("x".repeat(20001))]), timestamp), /SMARTSTORE_ANSWER_BODY_LIMIT/);
});

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

test("Lazada history quarantines blocked seller content and excludes system/translation-only notices", () => {
 const row={message_id:'blocked',from_account_type:2,send_time:'2026-09-01T00:01:00Z',content:{txt:'  blocked original\n'},process_msg:'not delivered'};
 const operation: ChannelOperationResult={...result('lazada',[]),steps:[{name:'inquiries-message:s:1',ok:true,status:200,data:{sellerpilotSession:{session_id:'s'},data:{message_list:[row,{...row,message_id:'system',type:2},{...row,message_id:'translated',content:{translateTxt:'translation'}}]}}}]};
 const rows=normalizeChannelInquiries('lazada',operation,timestamp);
 assert.equal(rows.length,1);assert.equal(rows[0].message,'  blocked original\n');
 assert.equal(rows[0].orderingStatus,'unverified');assert.equal(rows[0].receivedAt,'');
 assert.equal(rows[0].providerStatus,'waiting');
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
