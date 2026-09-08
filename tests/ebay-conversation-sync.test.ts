import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executeEbayInquiry } from "../lib/channels/ebay-inquiries";
import { ebayMessageScope } from "../lib/channels/ebay-oauth-scopes";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";

const payload = {
  access_token: "fixture-token",
  scopes: ebayMessageScope,
  ebay_user_id: "seller-user",
  provider_account_identity_version: "v1",
  provider_account_subject: "ebay:eias:seller-immutable",
};
const input = {
  operation: "inquiries.list" as const,
  payload,
  environment: "production" as const,
  arguments: {
    kind: "conversation",
    conversationType: "FROM_MEMBERS",
    startTime: "2026-09-01T00:00:00.000Z",
    endTime: "2026-09-08T00:00:00.000Z",
    conversationOffset: 0,
  },
};
function rawMessage(messageId: string, senderUsername = "buyer-user", recipientUsername = "seller-user") {
  return {
    messageId,
    messageBody: `message body ${messageId}`,
    subject: `subject ${messageId}`,
    senderUsername,
    recipientUsername,
    createdDate: `2026-09-0${messageId.endsWith("2") ? "2" : "1"}T01:00:00.123456Z`,
    readStatus: false,
    messageMedia: messageId.endsWith("1")
      ? [{ mediaName: "proof.pdf", mediaType: "PDF", mediaUrl: "https://files.example.test/proof.pdf?signature=opaque" }]
      : [],
  };
}
function conversation(conversationId: string, latestMessage: ReturnType<typeof rawMessage>) {
  return {
    conversationId,
    conversationType: "FROM_MEMBERS",
    conversationStatus: "ACTIVE",
    conversationTitle: `title ${conversationId}`,
    createdDate: latestMessage.createdDate,
    latestMessage,
  };
}

test("Commerce Message discovery drains each conversation before advancing the provider page", async () => {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    calls.push(`${target.pathname}?${target.searchParams}`);
    if (target.pathname === "/commerce/message/v1/conversation") {
      return Response.json({
        conversations: [
          conversation("conversation-1", rawMessage("message-1")),
          conversation("conversation-2", rawMessage("message-2")),
        ],
        total: 2, limit: 10, offset: 0,
      });
    }
    if (target.pathname.endsWith("conversation-1")) return Response.json({
      conversationType: "FROM_MEMBERS", conversationStatus: "ACTIVE", conversationTitle: "title conversation-1",
      messages: [rawMessage("message-1")], total: 1, limit: 25, offset: 0,
    });
    if (target.pathname.endsWith("conversation-2")) return Response.json({
      conversationType: "FROM_MEMBERS", conversationStatus: "ACTIVE", conversationTitle: "title conversation-2",
      messages: [rawMessage("message-2")], total: 1, limit: 25, offset: 0,
    });
    throw new Error(`unexpected ${target}`);
  };
  try {
    const first = await executeEbayInquiry(input);
    assert.deepEqual(first.continuationArguments, {
      kind: "conversation",
      conversationType: "FROM_MEMBERS",
      startTime: input.arguments.startTime,
      endTime: input.arguments.endTime,
      conversationId: "conversation-2",
      conversationQueue: [],
      messageOffset: 0,
    });
    assert.equal(first.steps[0]?.name, "inquiry-conversation-discovery");
    assert.equal(first.steps[1]?.name, "inquiries");
    const firstRows = normalizeChannelInquiries("ebay", {
      ok: true, channel: "ebay", operation: "inquiries.list", steps: first.steps, safeMessage: "read",
    }, "2026-09-08T00:00:00.000Z");
    assert.equal(firstRows.length, 1);
    assert.equal(firstRows[0]?.senderRole, "customer");
    assert.equal(firstRows[0]?.replyContext.replySupported, true);
    assert.equal((firstRows[0]?.providerContext.nativeMedia as { media: unknown[] }).media.length, 1);
    const expectedTicketId = `ebay:conversation:${createHash("sha256").update("ebay-conversation-v1\u001fconversation-1").digest("hex")}`;
    assert.equal(firstRows[0]?.externalTicketId, expectedTicketId);

    const second = await executeEbayInquiry({ ...input, arguments: first.continuationArguments! });
    assert.equal(second.continuationArguments, undefined);
    assert.equal(second.steps.length, 1);
    assert.equal(normalizeChannelInquiries("ebay", {
      ok: true, channel: "ebay", operation: "inquiries.list", steps: second.steps, safeMessage: "read",
    }, "2026-09-08T00:00:00.000Z")[0]?.providerContext.conversationId, "conversation-2");
    assert.deepEqual(calls.map(call => call.split("?")[0]), [
      "/commerce/message/v1/conversation",
      "/commerce/message/v1/conversation/conversation-1",
      "/commerce/message/v1/conversation/conversation-2",
    ]);
  } finally { globalThis.fetch = previous; }
});

test("Commerce Message continuation and seller identity fail closed before ingest", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    const target = new URL(String(url));
    if (target.pathname === "/commerce/message/v1/conversation") return Response.json({
      conversations: [conversation("conversation-unknown", rawMessage("message-1", "unknown", "also-unknown"))],
      total: 1, limit: 10, offset: 0,
    });
    return Response.json({
      conversationType: "FROM_MEMBERS", conversationStatus: "ACTIVE", conversationTitle: "unknown",
      messages: [rawMessage("message-1", "unknown", "also-unknown")], total: 1, limit: 25, offset: 0,
    });
  };
  try {
    const result = await executeEbayInquiry(input);
    assert.equal(result.steps.at(-1)?.ok, false);
    assert.equal(result.steps.at(-1)?.data.code, "EBAY_MESSAGE_ACCOUNT_IDENTITY_UNVERIFIED");
    assert.equal(result.continuationArguments, undefined);
    await assert.rejects(executeEbayInquiry({
      ...input,
      arguments: { ...input.arguments, conversationId: "conversation-1", conversationOffset: 10 },
    }), /conversationContinuation/);
    await assert.rejects(executeEbayInquiry({
      ...input,
      arguments: { ...input.arguments, nextConversationOffset: 1 },
    }), /nextConversationOffset/);
    await assert.rejects(executeEbayInquiry({
      ...input,
      arguments: { ...input.arguments, startTime: "2026-01-01T00:00:00Z" },
    }), /inquiryTimeRange/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = previous; }
});

test("Commerce discovery does not stop on an empty page with a verified next cursor", async () => {
  const previous = globalThis.fetch;
  const offsets: string[] = [];
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    offsets.push(target.searchParams.get("offset") ?? "");
    if (target.searchParams.get("offset") === "0") return Response.json({
      conversations: [], limit: 10, offset: 0,
      next: "https://api.ebay.com/commerce/message/v1/conversation?conversation_type=FROM_MEMBERS&limit=10&offset=10&start_time=2026-09-01T00%3A00%3A00.000Z&end_time=2026-09-08T00%3A00%3A00.000Z",
    });
    return Response.json({ conversations: [], limit: 10, offset: 10 });
  };
  try {
    const first = await executeEbayInquiry(input);
    assert.equal(first.steps.at(-1)?.data.conversationMessages.length, 0);
    assert.equal(first.continuationArguments?.conversationOffset, 10);
    const second = await executeEbayInquiry({ ...input, arguments: first.continuationArguments! });
    assert.equal(second.continuationArguments, undefined);
    assert.deepEqual(offsets, ["0", "10"]);
  } finally { globalThis.fetch = previous; }
});

test("equal Commerce bodies with different native IDs remain separate message events", () => {
  const common = {
    body: "identical customer body", subject: "same", senderUsername: "buyer-user", recipientUsername: "seller-user",
    createdAt: "2026-09-01T01:00:00.123456Z", read: false, media: [], conversationId: "conversation-1",
    conversationType: "FROM_MEMBERS", conversationStatus: "ACTIVE", conversationTitle: "title", role: "customer",
  };
  const rows = normalizeChannelInquiries("ebay", {
    ok: true, channel: "ebay", operation: "inquiries.list", safeMessage: "read",
    steps: [{ name: "inquiries", ok: true, status: 200, data: { conversationMessages: [
      { ...common, messageId: "native-1" }, { ...common, messageId: "native-2" },
    ] } }],
  }, "2026-09-08T00:00:00.000Z");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.externalTicketId, rows[1]?.externalTicketId);
  assert.notEqual(rows[0]?.remoteMessageId, rows[1]?.remoteMessageId);
  assert.notEqual(rows[0]?.inboundKey, rows[1]?.inboundKey);
});

test("Commerce Message reply returns only the provider acceptance identity", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    if (init?.method === "GET") return Response.json({
      conversationType: "FROM_MEMBERS", conversationStatus: "ACTIVE", conversationTitle: "title conversation-1",
      messages: [rawMessage("message-1")], total: 1, limit: 25, offset: 0,
    });
    assert.equal(target.pathname, "/commerce/message/v1/send_message");
    assert.deepEqual(JSON.parse(String(init?.body)), { conversationId: "conversation-1", messageText: "reply body" });
    return Response.json({ messageId: "provider-sent-1", createdDate: "2026-09-08T02:00:00.123456Z" }, { status: 200 });
  };
  try {
    const result = await executeEbayInquiry({
      operation: "inquiries.reply", payload, environment: "production",
      arguments: { kind: "conversation", conversationType: "FROM_MEMBERS", conversationId: "conversation-1", messageId: "message-1", reply: "reply body" },
    });
    assert.equal(result.remoteId, "provider-sent-1");
    assert.equal(result.steps[0]?.data.providerMessageId, "provider-sent-1");
    assert.equal(result.steps[0]?.data.createdAt, "2026-09-08T02:00:00.123456Z");
    assert.deepEqual(result.steps[0]?.data.sellerpilotReplyReadback, {
      pages: 1, messageCount: 1, latestCustomerMessageId: "message-1",
    });
    assert.deepEqual(result.steps[0]?.data.sellerpilotReplyAcceptance, {
      contract: "sellerpilot-reply-acceptance/1",
      level: "provider_accepted",
      channel: "ebay",
      kind: "conversation",
      bindingDigest: createHash("sha256").update(JSON.stringify({
        conversationId: "conversation-1", conversationType: "FROM_MEMBERS", messageId: "message-1",
      })).digest("hex"),
    });
  } finally { globalThis.fetch = previous; }
});

test("Commerce reply blocks FROM_EBAY, stale customer lineage and a newer seller response", async () => {
  const previous = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { posts += 1; return Response.json({}); }
    return Response.json({
      conversationType: "FROM_MEMBERS", conversationStatus: "ACTIVE", conversationTitle: "title",
      messages: [
        rawMessage("message-1"),
        { ...rawMessage("message-2", "seller-user", "buyer-user"), createdDate: "2026-09-03T01:00:00.123456Z" },
      ], total: 2, limit: 25, offset: 0,
    });
  };
  try {
    await assert.rejects(executeEbayInquiry({
      operation: "inquiries.reply", payload, environment: "production",
      arguments: { kind: "conversation", conversationType: "FROM_EBAY", conversationId: "conversation-1", messageId: "message-1", reply: "reply" },
    }), /conversationType/);
    await assert.rejects(executeEbayInquiry({
      operation: "inquiries.reply", payload, environment: "production",
      arguments: { kind: "conversation", conversationType: "FROM_MEMBERS", conversationId: "conversation-1", messageId: "message-1", reply: "reply" },
    }), /EBAY_MESSAGE_REPLY_STALE/);
    assert.equal(posts, 0);
  } finally { globalThis.fetch = previous; }
});
