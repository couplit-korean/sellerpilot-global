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

test("Shopee Returns common normalization preserves detail changes without contact branches", () => {
  const normalize = (extra: Record<string, unknown> = {}) => normalizeChannelInquiries("shopee", result("shopee", [{
    sellerpilotProviderContext: { shopId: "1719148844", kind: "return_refund", returnSn: "RETURN1" },
    response: { return_sn: "RETURN1", reason: "NOT_RECEIPT", create_time: 1_788_000_000,
      status: "REQUESTED", image: [], buyer_videos: [], user: { email: "private@example.test" },
      return_pickup_address: { phone: "private-phone" }, ...extra },
  }]), timestamp)[0];
  const first = normalize();
  const changed = normalize({ reassessed_request_reason: "ITEM_MISSING", refund_amount: 12, currency: "SGD" });
  assert.notEqual(first.remoteMessageId, changed.remoteMessageId);
  assert.equal(changed.remoteMessageId, normalize({ reassessed_request_reason: "ITEM_MISSING", refund_amount: 12, currency: "SGD" }).remoteMessageId);
  assert.equal((changed.providerContext.returnDetail as Record<string, unknown>).reassessedReason, "ITEM_MISSING");
  assert.equal(changed.providerContext.replySupported, false);
  assert.deepEqual(changed.replyContext, {});
  assert.doesNotMatch(JSON.stringify(changed.providerContext), /private@example|private-phone/);
});

test("all implemented pull channels distinguish verified empty pages from unimportable data", () => {
  const pages = {
    coupang: (rows: unknown[]) => ({ data: { content: rows } }),
    smartstore: (rows: unknown[]) => ({ contents: rows }),
    qoo10: (rows: unknown[]) => ({ ResultObject: rows }),
    shopee: (rows: unknown[]) => ({
      sellerpilotProviderContext: { shopId: "1719148844" },
      response: { item_comment_list: rows, more: false, next_cursor: "" },
    }),
    ebay: (rows: unknown[]) => ({ memberMessages: rows }),
    temu: (rows: unknown[]) => ({ result: { data: rows } }),
  };
  for (const [key, page] of Object.entries(pages)) {
    const channel = key as ChannelOperationResult["channel"];
    assert.deepEqual(normalizeChannelInquiries(channel, result(channel, [page([])]), timestamp), []);
    for (const data of [{}, page([null]), page([{}])]) {
      assert.throws(() => normalizeChannelInquiries(channel, result(channel, [data]), timestamp), /INQUIRY_(PAGE|RECORD)_INVALID/);
    }
    const failed = result(channel, [page([])]);
    failed.steps.push({ name: "inquiries:2", ok: false, status: 429, data: {} });
    assert.throws(() => normalizeChannelInquiries(channel, failed, timestamp), /INQUIRY_RESULT_INVALID/);
  }
});

test("malformed elevenst pages and mismatched operations cannot report a successful empty import", () => {
  assert.throws(() => normalizeChannelInquiries("elevenst", result("elevenst", [{}]), timestamp), /INQUIRY_PAGE_INVALID:elevenst/);
  assert.deepEqual(normalizeChannelInquiries("elevenst", result("elevenst", [{ productQnas: [] }]), timestamp), []);
  const wrong = result("smartstore", [{ contents: [] }]);
  wrong.operation = "orders.list";
  assert.throws(() => normalizeChannelInquiries("smartstore", wrong, timestamp), /INQUIRY_RESULT_INVALID/);
  assert.throws(() => normalizeChannelInquiries("coupang", result("smartstore", []), timestamp), /INQUIRY_RESULT_INVALID/);
});

test("Shopee product comments retain exact shop, item, comment and reply lineage", () => {
  const rows = normalizeChannelInquiries("shopee", result("shopee", [{
    sellerpilotProviderContext: { shopId: "1719148844" },
    response: {
      item_comment_list: [{
        comment_id: 901,
        item_id: 902,
        order_sn: "ORDER-1",
        buyer_username: "buyer-1",
        comment: "배송이 빨랐어요",
        rating_star: 5,
        create_time: 1_788_000_000,
        comment_reply: { reply: "감사합니다", create_time: 1_788_000_100 },
      }],
      more: false,
      next_cursor: "",
    },
  }]), timestamp);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.externalTicketId, "shopee:1719148844:901");
  assert.match(rows[0]?.remoteMessageId ?? "", /^1719148844:901:[0-9a-f]{64}$/);
  assert.equal(rows[0]?.status, "resolved");
  assert.deepEqual(rows[0]?.replyContext, { shopId: "1719148844", commentId: "901", itemId: "902" });
  assert.equal(rows[0]?.providerContext.unsequencedAnswers, undefined);
  assert.equal(rows[1]?.senderRole, "seller");
  assert.equal(rows[1]?.message, "감사합니다");
  assert.equal(rows[1]?.receivedAt, new Date(1_788_000_100 * 1000).toISOString());
  assert.equal(rows[1]?.providerContext.historyOnly, true);
  assert.match(rows[1]?.remoteMessageId ?? "", /^1719148844:901:reply:[0-9a-f]{64}$/);
});

test("Shopee rating-only and media comments remain visible without inventing customer text", () => {
  const rows = normalizeChannelInquiries("shopee", result("shopee", [{
    sellerpilotProviderContext: { shopId: "1719148844" },
    response: {
      item_comment_list: [{
        comment_id: 903,
        item_id: 904,
        buyer_username: "buyer-2",
        comment: "",
        rating_star: 2,
        image_info: [{ image_id: "image-1", image_url: "https://example.test/review.jpg" }],
        video_info: { video_id: "video-1" },
        create_time: 1_788_000_000,
      }],
      more: false,
      next_cursor: "",
    },
  }]), timestamp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.message, "본문 없는 Shopee 후기 · 2점 · 첨부 미디어 있음");
  assert.equal(rows[0]?.priority, 2);
  assert.deepEqual(rows[0]?.providerContext.nativeMedia, {
    image_info: [{ image_id: "image-1", image_url: "https://example.test/review.jpg" }],
    video_info: { video_id: "video-1" },
  });
});

test("Shopee rejects empty comments without rating or media and invalid provider ratings", () => {
  const page = (row: Record<string, unknown>) => result("shopee", [{
    sellerpilotProviderContext: { shopId: "1719148844" },
    response: { item_comment_list: [{
      comment_id: 905, item_id: 906, buyer_username: "buyer-3", comment: "", ...row,
    }] },
  }]);
  assert.throws(() => normalizeChannelInquiries("shopee", page({}), timestamp), /INQUIRY_RECORD_INVALID:shopee/);
  assert.throws(() => normalizeChannelInquiries("shopee", page({ rating_star: 0 }), timestamp), /INQUIRY_RECORD_INVALID:shopee/);
  assert.throws(() => normalizeChannelInquiries("shopee", page({ rating_star: 5, image_info: "x".repeat(40001) }), timestamp), /SHOPEE_COMMENT_MEDIA_LIMIT/);
});

test("Shopee comment and seller reply edits retain stable distinct revisions", () => {
  const page = (comment: string, reply: string) => ({
    sellerpilotProviderContext: { shopId: "1719148844" },
    response: { item_comment_list: [{
      comment_id: 907, item_id: 908, buyer_username: "buyer-4", rating_star: 4,
      comment, create_time: 1_788_000_000,
      comment_reply: { reply, create_time: 1_788_000_100 },
    }] },
  });
  const rows = normalizeChannelInquiries("shopee", result("shopee", [
    page("original", "first reply"), page("edited", "edited reply"), page("edited", "edited reply"),
  ]), timestamp);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.filter((row) => row.senderRole !== "seller").map((row) => row.message), ["original", "edited"]);
  assert.deepEqual(rows.filter((row) => row.senderRole === "seller").map((row) => row.message), ["first reply", "edited reply"]);
  assert.equal(new Set(rows.map((row) => row.inboundKey)).size, 4);
});

test("Shopee replies without provider time remain unsequenced seller notes", () => {
  const rows = normalizeChannelInquiries("shopee", result("shopee", [{
    sellerpilotProviderContext: { shopId: "1719148844" },
    response: { item_comment_list: [{
      comment_id: 909, item_id: 910, buyer_username: "buyer-5", rating_star: 5,
      comment: "review", create_time: 1_788_000_000, comment_reply: { reply: "undated reply" },
    }] },
  }]), timestamp);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.providerContext.unsequencedAnswers, [{
    body: "undated reply", reason: "provider_timestamp_unavailable",
  }]);
});

test("message identity collisions do not silently overwrite a different original", () => {
  const row = { INQ_TYPE: "MSG", QUESTION_NO: "1", SEQ_NO: "2", CONTENTS: "original" };
  assert.throws(() => normalizeChannelInquiries("qoo10", result("qoo10", [
    { ResultObject: [row] }, { ResultObject: [{ ...row, CONTENTS: "different" }] },
  ]), timestamp), /INQUIRY_MESSAGE_CONFLICT:qoo10/);
});

test("invalid answer arrays are not silently discarded from an otherwise valid inquiry", () => {
  for (const answers of [[null], "invalid"]) {
    assert.throws(() => normalizeChannelInquiries("smartstore", result("smartstore", [{ contents: [
      { questionId: 1, question: "question", answers },
    ] }]), timestamp), /INQUIRY_PAGE_INVALID:smartstore:answers/);
    assert.throws(() => normalizeChannelInquiries("coupang", result("coupang", [{ data: { content: [
      { inquiryId: 1, content: "question", commentDtoList: answers },
    ] } }]), timestamp), /INQUIRY_PAGE_INVALID:coupang:answers/);
  }
});

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

test("Coupang product answer history preserves originals, IDs and true order references",()=>{
 const row={inquiryId:901,content:'  question\n',inquiryAt:'2026-09-01T00:00:00Z',vendorItemId:1234,orderIds:[4567],
  commentDtoList:[{inquiryCommentId:902,content:'  answer\n',inquiryCommentAt:'2026-09-01T00:01:00.123456+09:00'}]};
 const rows=normalizeChannelInquiries('coupang',result('coupang',[{data:{content:[row]}}]),timestamp);
 assert.equal(rows.length,2);assert.equal(rows[0].externalOrderReference,'4567');assert.equal(rows[1].message,'  answer\n');
 assert.equal(rows[1].senderRole,'seller');assert.equal(rows[1].providerContext.historyOnly,true);assert.equal(rows[1].providerContext.answerId,'902');
 const noOrder=normalizeChannelInquiries('coupang',result('coupang',[{data:{content:[{...row,orderIds:[]}]}}]),timestamp);
 assert.equal(noOrder[0].externalOrderReference,undefined);
});

test("Coupang center notices and seller replies retain distinct roles and current request status",()=>{
 const row={inquiryId:901,content:'center inquiry',inquiryAt:'2026-09-01T00:00:00Z',csPartnerCounselingStatus:'requestAnswer',
  replies:[{answerId:902,content:'old seller answer',answerType:'vendor',replyAt:'2026-09-01T00:01:00Z'},
   {answerId:903,content:'new transfer',answerType:'csAgent',needAnswer:true,partnerTransferStatus:'requestAnswer',replyAt:'2026-09-01T00:02:00Z'}]};
 const rows=normalizeChannelInquiries('coupang',result('coupang',[{sellerpilotInquiryKind:'call-center',data:{content:[row]}}]),timestamp);
 assert.equal(rows.length,3);assert.deepEqual(rows.map(row=>row.senderRole??'customer'),['customer','seller','system']);
 assert.equal(rows[0].providerStatus,'waiting');assert.equal(rows[1].providerContext.historyOnly,true);
 assert.equal(rows[0].providerContext.parentAnswerId,'903');
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
  const oldState = { parentAfterSalesSn: "case-1", parentOrderSn: "order-1", afterSalesStatusGroup: "1", updateAt: 1788600000 };
  const newState = { ...oldState, afterSalesStatusGroup: "5", updateAt: 1788600100 };
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
  const buyer1 = { message_id: "buyer-1", from_account_type: 1, status: 0, type: 1, template_id: 1, send_time: "2026-09-05T10:00:00Z", content: { txt: "original", translateTxt: "translation" } };
  const seller1 = { message_id: "seller-1", from_account_type: 2, status: 0, type: 1, template_id: 1, send_time: "2026-09-05T10:01:00Z", content: { txt: "seller answer" } };
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

test("Lazada history quarantines blocked seller content and projects persisted system events", () => {
 const row={message_id:'blocked',from_account_type:2,send_time:'2026-09-01T00:01:00Z',content:{txt:'  blocked original\n'},process_msg:'not delivered'};
 const operation: ChannelOperationResult={...result('lazada',[]),steps:[{name:'inquiries-message:s:1',ok:true,status:200,data:{sellerpilotSession:{session_id:'s'},data:{message_list:[row]}}}]};
 const rows=normalizeChannelInquiries('lazada',operation,timestamp,{lazadaRawStorageReady:true});
 assert.equal(rows.length,1);assert.equal(rows[0].message,'Lazada 전달 차단 ·   blocked original\n');
 assert.equal(rows[0].orderingStatus,'unverified');assert.equal(rows[0].receivedAt,'');
 assert.equal(rows[0].providerStatus,'waiting');
 for (const unsupported of [{...row,message_id:'system',type:2},{...row,message_id:'translated',content:{translateTxt:'translation'}}]) {
   operation.steps[0].data.data = {message_list:[row,unsupported]};
   const projected=normalizeChannelInquiries('lazada',operation,timestamp,{lazadaRawStorageReady:true});
   assert.equal(projected.length,2);
   assert.equal(projected.some((message)=>message.remoteMessageId===unsupported.message_id),true);
 }
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
  assert.throws(() => normalizeChannelInquiries("lazada", operation, timestamp), /LAZADA_HISTORY_MESSAGE_STORAGE_REQUIRED/);
  // Failed pages alone are never normalized into customer messages.
  assert.deepEqual(normalizeChannelInquiries("lazada", { ...operation, steps: operation.steps.slice(1) }, timestamp), []);
});

test("Lazada deduplicates within a session, not across sessions, including seller-only history", () => {
  const message = { message_id: "same-id", from_account_type: 2, status: 0, type: 1, template_id: 1, send_time: 1788600000000, content: { txt: "seller text" } };
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
