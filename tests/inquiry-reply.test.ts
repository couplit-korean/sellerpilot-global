import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildInquiryReplyArguments,
  coupangContactCenterParentAnswerId,
  supportsInquiryReply,
} from "../lib/channels/inquiry-reply";
import { executeChannelOperation } from "../lib/channels/operations";

test("marketplace ticket identifiers become provider reply arguments", () => {
  assert.deepEqual(buildInquiryReplyArguments("qoo10", "qoo10:MSG:12345678:87654321", "확인했습니다."), {
    params: { inq_type: "MSG", question_no: "12345678", seq_no: "87654321", contents: "확인했습니다." },
  });
  assert.deepEqual(buildInquiryReplyArguments("lazada", "lazada-im:session-1", "We have checked."), {
    sessionId: "session-1",
    reply: "We have checked.",
  });
  assert.deepEqual(buildInquiryReplyArguments("coupang", "call-center:98765", "확인했습니다.", { parentAnswerId: "4321" }), {
    kind: "call-center",
    inquiryId: "98765",
    parentAnswerId: "4321",
    reply: "확인했습니다.",
  });
  assert.deepEqual(buildInquiryReplyArguments("smartstore", "456789", "확인했습니다."), {
    kind: "product",
    questionId: "456789",
    reply: "확인했습니다.",
  });
  assert.deepEqual(buildInquiryReplyArguments("smartstore", "customer:987654321", "확인했습니다."), {
    kind: "customer",
    inquiryNo: "987654321",
    reply: "확인했습니다.",
  });
  assert.deepEqual(buildInquiryReplyArguments(
    "shopee",
    "shopee:1719148844:901",
    "감사합니다.",
    { shopId: "1719148844", commentId: "901", itemId: "902" },
  ), {
    shopId: "1719148844",
    commentId: "901",
    itemId: "902",
    reply: "감사합니다.",
  });
  const conversationId = "conversation-native-1";
  const conversationTicketId = `ebay:conversation:${createHash("sha256")
    .update(`ebay-conversation-v1\u001f${conversationId}`).digest("hex")}`;
  assert.deepEqual(buildInquiryReplyArguments("ebay", conversationTicketId, "eBay 답변", {
    kind: "conversation", conversationId, conversationType: "FROM_MEMBERS",
    messageId: "message-native-1", replySupported: true,
  }), {
    kind: "conversation", conversationId, conversationType: "FROM_MEMBERS", reply: "eBay 답변",
  });
  assert.equal(supportsInquiryReply("ebay", "production", {
    providerCertified: true, sellerAccountVerified: true, marketplaceBound: false, conversationBound: true,
  }), true);
  assert.equal(supportsInquiryReply("temu"), false);
  assert.throws(() => buildInquiryReplyArguments("qoo10", "123", "답변"), /qoo10InquiryId/);
  assert.throws(
    () => buildInquiryReplyArguments("coupang", "call-center:98765", "확인했습니다."),
    /coupangParentAnswerId/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("coupang", "call-center:98765", "가", { parentAnswerId: "4321" }),
    /coupangReplyLength/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("smartstore", "customer:0", "확인했습니다."),
    /smartstoreInquiryNo/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("shopee", "shopee:1719148844:901", "감사합니다.", {
      shopId: "1719148844", commentId: "902", itemId: "902",
    }),
    /shopeeComment/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("shopee", "shopee:1719148844:9007199254740992", "감사합니다.", {
      shopId: "1719148844", commentId: "9007199254740992", itemId: "902",
    }),
    /shopeeComment/,
  );
  for (const [ticketId, reply, context] of [
    [conversationTicketId.replace(/.$/, "0"), "eBay 답변", { kind: "conversation", conversationId, conversationType: "FROM_MEMBERS", replySupported: true }],
    [conversationTicketId, "<b>unsafe</b>", { kind: "conversation", conversationId, conversationType: "FROM_MEMBERS", replySupported: true }],
    [conversationTicketId, "encoded &lt;b&gt;unsafe", { kind: "conversation", conversationId, conversationType: "FROM_MEMBERS", replySupported: true }],
    [conversationTicketId, "eBay 답변", { kind: "conversation", conversationId, conversationType: "FROM_EBAY", replySupported: true }],
    [conversationTicketId, "eBay 답변", { kind: "conversation", conversationId, conversationType: "FROM_MEMBERS", replySupported: false }],
  ] as const) {
    assert.throws(() => buildInquiryReplyArguments("ebay", ticketId, reply, context), /ebayConversationContext/);
  }
});

test("Shopee product comments paginate with exact cursors and reply to the exact comment", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
    if (call.method === "GET") {
      const cursor = new URL(call.url).searchParams.get("cursor");
      return Response.json({
        error: "",
        request_id: `request-${calls.length}`,
        response: cursor
          ? { item_comment_list: [{ comment_id: 902, item_id: 8002, buyer_username: "buyer-2", comment: "두 번째" }], more: false, next_cursor: "" }
          : { item_comment_list: [{ comment_id: 901, item_id: 8001, buyer_username: "buyer-1", comment: "첫 번째" }], more: true, next_cursor: "cursor-2" },
      });
    }
    return Response.json({
      error: "",
      request_id: "reply-request",
      response: { result_list: [{ comment_id: 901, fail_error: "", fail_message: "" }] },
    });
  };
  const payload = { partner_id: "2031489", partner_key: "partner-secret", shop_id: "1719148844", access_token: "access-token" };
  try {
    const list = await executeChannelOperation({
      channel: "shopee",
      operation: "inquiries.list",
      payload,
      arguments: { cursor: "", pageSize: 100 },
      environment: "production",
    });
    assert.equal(list.ok, true);
    assert.equal(list.steps.length, 2);
    assert.equal(new URL(calls[0].url).pathname, "/api/v2/product/get_comment");
    assert.equal(new URL(calls[0].url).searchParams.get("cursor"), "");
    assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "cursor-2");
    assert.ok(list.steps.every((item) => item.data.sellerpilotProviderContext.shopId === "1719148844"));

    const reply = await executeChannelOperation({
      channel: "shopee",
      operation: "inquiries.reply",
      payload,
      arguments: buildInquiryReplyArguments(
        "shopee",
        "shopee:1719148844:901",
        "감사합니다.",
        { shopId: "1719148844", commentId: "901", itemId: "8001" },
      ),
      environment: "production",
    });
    assert.equal(reply.ok, true);
    assert.equal(new URL(calls[2].url).pathname, "/api/v2/product/reply_comment");
    assert.equal(calls[2].method, "POST");
    assert.deepEqual(JSON.parse(calls[2].body), {
      comment_list: [{ comment_id: 901, comment: "감사합니다." }],
    });
    assert.equal(reply.remoteId, "1719148844:901");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee comment pages and per-comment reply failures fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const payload = { partner_id: "2031489", partner_key: "partner-secret", shop_id: "1719148844", access_token: "access-token" };
  try {
    globalThis.fetch = async () => Response.json({
      error: "", request_id: "bad-page", response: { item_comment_list: [], more: true, next_cursor: "cursor-2" },
    });
    await assert.rejects(executeChannelOperation({
      channel: "shopee", operation: "inquiries.list", payload, arguments: {}, environment: "production",
    }), /SHOPEE_COMMENT_CURSOR_INVALID/);

    globalThis.fetch = async () => Response.json({
      error: "", request_id: "failed-reply", response: { result_list: [{ comment_id: 901, fail_error: "error", fail_message: "failed" }] },
    });
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "inquiries.reply",
      payload,
      arguments: { shopId: "1719148844", commentId: "901", itemId: "8001", reply: "감사합니다." },
      environment: "production",
    });
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang contact-center normalization preserves only an actionable parent answer", () => {
  assert.equal(coupangContactCenterParentAnswerId([
    { answerId: 10, needAnswer: false, partnerTransferStatus: "answered" },
    { answerId: 11, needAnswer: true, partnerTransferStatus: "requestAnswer" },
  ]), "11");
  assert.equal(coupangContactCenterParentAnswerId([
    { answerId: 10, needAnswer: false, partnerTransferStatus: "answered" },
  ]), "");
});

test("Coupang does not guess among multiple actionable transfers or accept zero IDs", () => {
  const first = { answerId: 11, needAnswer: true, partnerTransferStatus: "requestAnswer" };
  const second = { answerId: 12, needAnswer: true, partnerTransferStatus: "requestAnswer" };
  assert.equal(coupangContactCenterParentAnswerId([first, second]), "");
  assert.equal(coupangContactCenterParentAnswerId([second, first]), "");
  assert.equal(coupangContactCenterParentAnswerId([first, { ...first }]), "11");
  assert.equal(coupangContactCenterParentAnswerId([{ answerId: 0, needAnswer: true }]), "");
  assert.throws(() => buildInquiryReplyArguments("coupang", "call-center:98765", "확인했습니다.", {
    parentAnswerId: coupangContactCenterParentAnswerId([first, second]),
  }), /coupangParentAnswerId/);
});

test("Qoo10 reply calls CSCenter.SetInquiryMessage with the official fields", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return Response.json({ ResultCode: 0, ResultObject: { SEQ_NO: 87654321 } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "inquiries.reply",
      payload: { api_key: "test-secret" },
      arguments: buildInquiryReplyArguments("qoo10", "qoo10:MSG:12345678:87654321", "확인했습니다."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calledUrl, /CSCenter\.SetInquiryMessage/);
    assert.deepEqual(JSON.parse(calledBody), {
      returnType: "json",
      inq_type: "MSG",
      question_no: "12345678",
      seq_no: "87654321",
      contents: "확인했습니다.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada reply sends a text message to the synced IM session", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = new URLSearchParams();
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = new URLSearchParams(String(init?.body ?? ""));
    return Response.json({ code: "0", message: "success" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "inquiries.reply",
      payload: {
        app_key: "commerce-app-key",
        app_secret: "commerce-app-secret",
        access_token: "commerce-access-token",
        im_app_key: "im-app-key",
        im_app_secret: "im-app-secret",
        im_access_token: "im-access-token",
        country: "my",
      },
      arguments: buildInquiryReplyArguments("lazada", "lazada-im:session-1", "We have checked."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calledUrl, /\/rest\/im\/message\/send$/);
    assert.equal(calledBody.get("session_id"), "session-1");
    assert.equal(calledBody.get("template_id"), "1");
    assert.equal(calledBody.get("txt"), "We have checked.");
    assert.equal(calledBody.get("app_key"), "im-app-key");
    assert.equal(calledBody.get("access_token"), "im-access-token");
    assert.notEqual(calledBody.get("app_key"), "commerce-app-key");
    assert.notEqual(calledBody.get("access_token"), "commerce-access-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang reply uses the inquiry kind and WING responder ID", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return Response.json({ code: "200", message: "OK" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.reply",
      payload: {
        vendor_id: "A00012345",
        access_key: "test-access",
        secret_key: "test-secret",
        requested_by: "test-wing-user",
      },
      arguments: buildInquiryReplyArguments("coupang", "product:846", "입고 일정을 확인했습니다."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calledUrl, /\/vendors\/A00012345\/onlineInquiries\/846\/replies$/);
    assert.deepEqual(JSON.parse(calledBody), {
      content: "입고 일정을 확인했습니다.",
      vendorId: "A00012345",
      replyBy: "test-wing-user",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang contact-center reply includes the exact inquiry and parent answer IDs", async () => {
  const originalFetch = globalThis.fetch;
  let calledBody = "";
  globalThis.fetch = async (_input, init) => {
    calledBody = String(init?.body ?? "");
    return Response.json({ code: "200", message: "OK" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.reply",
      payload: {
        vendor_id: "A00012345",
        access_key: "test-access",
        secret_key: "test-secret",
        requested_by: "test-wing-user",
      },
      arguments: buildInquiryReplyArguments(
        "coupang",
        "call-center:98765",
        "확인했습니다.",
        { parentAnswerId: "4321" },
      ),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(calledBody), {
      vendorId: "A00012345",
      inquiryId: "98765",
      content: "확인했습니다.",
      replyBy: "test-wing-user",
      parentAnswerId: "4321",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore reply exchanges a token then updates the product Q&A", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
    if (call.url.includes("/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 10_800 });
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.reply",
      payload: {
        client_id: "test-client",
        client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
        token_type: "SELF",
      },
      arguments: buildInquiryReplyArguments("smartstore", "456789", "확인했습니다."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/external\/v1\/contents\/qnas\/456789$/);
    assert.equal(calls[1].method, "PUT");
    assert.deepEqual(JSON.parse(calls[1].body), { answerContent: "확인했습니다." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore customer reply accepts the official empty 200 response", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
    if (call.url.includes("/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 10_800 });
    return new Response(null, { status: 200 });
  };
  try {
    const execute = () => executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.reply",
      payload: {
        client_id: "test-client",
        client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
        token_type: "SELF",
      },
      arguments: {
        ...buildInquiryReplyArguments("smartstore", "customer:987654321", "확인했습니다."),
        answerTemplateId: "template-123",
      },
      environment: "production",
    });
    const result = await execute();
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/external\/v1\/pay-merchant\/inquiries\/987654321\/answer$/);
    assert.equal(calls[1].method, "POST");
    assert.deepEqual(JSON.parse(calls[1].body), {
      answerComment: "확인했습니다.",
      answerTemplateId: "template-123",
    });
    assert.equal(result.steps[0]?.data.sellerpilotInquiryKind, "customer");
    assert.equal(result.steps[0]?.data.sellerpilotVerification, "SMARTSTORE_CUSTOMER_INQUIRY_REPLY_HTTP_ACK");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CS route accepts one durable reply job and exposes delivery polling", () => {
  const route = readFileSync(new URL("../app/api/admin/cs/reply/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260825111757_harden_inquiry_reply_delivery_fence.sql", import.meta.url), "utf8");
  const lineageMigration = readFileSync(new URL("../supabase/migrations/20260825111810_harden_inquiry_reply_account_lineage.sql", import.meta.url), "utf8");
  const inquirySync = readFileSync(new URL("../lib/channels/inquiry-sync.ts", import.meta.url), "utf8");

  assert.match(route, /enqueueInquiryReplyViaChannelGateway/);
  assert.match(route, /sellerpilot_get_inquiry_reply_delivery/);
  assert.match(route, /status: 202/);
  assert.match(route, /accepted: true/);
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(
    route,
    /function noStoreAdminError\(response: NextResponse\)[\s\S]*response\.clone\(\)[\s\S]*headers\.set\("cache-control", noStoreHeaders\["cache-control"\]\)/,
  );
  assert.equal(
    route.match(/if \(isAdminApiError\(admin\)\) return noStoreAdminError\(admin\);/g)?.length,
    2,
  );
  assert.doesNotMatch(route, /executeInquiryReplyViaChannelGateway/);
  assert.doesNotMatch(route, /executeChannelOperation/);
  assert.doesNotMatch(route, /sellerpilot_update_ticket/);
  assert.match(route, /CHANNEL_GATEWAY_STATIC_EGRESS_REQUIRED/);
  assert.match(route, /SERVERLESS_STATIC_EGRESS_REQUIRED/);
  assert.match(route, /staticEgressReady: false/);
  assert.match(route, /status: 409/);
  assert.match(migration, /sellerpilot_enqueue_inquiry_reply_gateway_job/);
  assert.match(migration, /for update/);
  assert.match(migration, /INQUIRY_REPLY_CONFLICT/);
  assert.match(migration, /guard_and_finalize_inquiry_reply_job/);
  assert.match(migration, /'ticket_reply_delivered'/);
  assert.match(migration, /'inquiries\.reply'/);
  assert.match(lineageMigration, /INQUIRY_REPLY_LINEAGE_UNBOUND/);
  assert.match(lineageMigration, /reply_gateway_job_id/);
  assert.match(lineageMigration, /DEDICATED_INQUIRY_REPLY_ENQUEUE_REQUIRED/);
  assert.match(lineageMigration, /reply_delivery_status = 'reconciliation_required'/);
  assert.match(lineageMigration, /parentAnswerId/);
  assert.match(inquirySync, /qoo10:\$\{inquiryType\}:\$\{questionNo\}:\$\{sequenceNo\}/);
});
