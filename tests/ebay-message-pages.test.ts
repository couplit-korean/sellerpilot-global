import assert from "node:assert/strict";
import test from "node:test";
import { ebayMessageScope } from "../lib/channels/ebay-oauth-scopes";
import { readEbayConversationsPage, readEbayConversationMessagesPage, ebayConversationMessageRole } from "../lib/channels/ebay-message-pages";

const payload = { access_token: "fixture-token", scopes: ebayMessageScope };
const base = { payload, environment: "production" as const, type: "FROM_MEMBERS" as const };
const rawMessage = {
  messageId: "native-message-1", messageBody: "  original\n<literal text>  ", subject: "question",
  senderUsername: "buyer", recipientUsername: "seller", createdDate: "2026-08-01T12:30:00+09:00", readStatus: false,
};
const metadata = { conversationType: "FROM_MEMBERS", conversationStatus: "ACTIVE", conversationTitle: "title" };
const conversation = { ...metadata, conversationId: "native-conversation-1", createdDate: "2026-08-01T00:00:00Z", latestMessage: rawMessage };
function response(entries: unknown[], key: "messages" | "conversations", total = entries.length, offset = 0) {
  return { ...metadata, [key]: entries, total, limit: 25, offset };
}
async function mocked<T>(body: unknown, run: (calls: URL[]) => Promise<T>, status = 200) {
  const previous = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
    const target = new URL(String(url)); calls.push(target);
    assert.equal(target.origin, "https://api.ebay.com");
    assert.equal(target.searchParams.get("limit"), "25");
    return Response.json(body, { status });
  };
  try { return await run(calls); } finally { globalThis.fetch = previous; }
}

test("general conversation pages preserve native IDs and separate listing reference from orders", async () => {
  await mocked(response([{ ...conversation, referenceType: "LISTING", referenceId: "123456789" }], "conversations"), async calls => {
    const page = await readEbayConversationsPage({ ...base, startTime: "2026-08-01T00:00:00+09:00", endTime: "2026-09-01T00:00:00+09:00" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, "/commerce/message/v1/conversation");
    assert.equal(calls[0].searchParams.get("start_time"), "2026-08-01T00:00:00+09:00");
    assert.equal(page.entries[0].conversationId, "native-conversation-1");
    assert.equal(page.entries[0].referenceId, "123456789");
    assert.equal(page.entries[0].latestMessage.body, rawMessage.messageBody);
    assert.equal(page.nextOffset, null);
  });
});

test("message pages preserve original text, timestamps and attachment-only messages without fetching media", async () => {
  const attachment = { ...rawMessage, messageId: "attachment-only", messageBody: "", messageMedia: [{ mediaName: "photo.jpg", mediaType: "IMAGE", mediaUrl: "https://files.example.test/photo.jpg?signature=private" }] };
  await mocked(response([rawMessage, attachment], "messages"), async calls => {
    const result = await readEbayConversationMessagesPage({ ...base, conversationId: "thread/with?reserved" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, "/commerce/message/v1/conversation/thread%2Fwith%3Freserved");
    assert.equal(result.entries[0].createdAt, rawMessage.createdDate);
    assert.equal(result.entries[0].body, rawMessage.messageBody);
    assert.equal(result.entries[1].body, "");
    assert.deepEqual(result.entries[1].media, [{ name: "photo.jpg", type: "IMAGE", url: attachment.messageMedia[0].mediaUrl }]);
  });
});

test("pagination continues by numeric offset and never follows provider next URLs", async () => {
  const entries = Array.from({ length: 25 }, (_, n) => ({ ...rawMessage, messageId: String(n) }));
  await mocked({ ...response(entries, "messages", 26), next: "https://attacker.invalid/steal-token" }, async calls => {
    const result = await readEbayConversationMessagesPage({ ...base, conversationId: "thread" });
    assert.equal(calls.length, 1); assert.equal(result.nextOffset, 25);
  });
  await mocked(response([rawMessage], "messages", 26, 25), async calls => {
    const result = await readEbayConversationMessagesPage({ ...base, conversationId: "thread", offset: 25 });
    assert.equal(calls[0].searchParams.get("offset"), "25"); assert.equal(result.nextOffset, null);
  });
});

test("provider sub-millisecond timestamps and unnamed attachments retain their original values", async () => {
  const createdDate = "2026-08-01T12:30:00.123456+09:00";
  await mocked(response([{ ...rawMessage, createdDate, messageMedia: [{ mediaType: "PDF", mediaUrl: "https://files.example.test/original.pdf" }] }], "messages"), async () => {
    const result = await readEbayConversationMessagesPage({ ...base, conversationId: "thread" });
    assert.equal(result.entries[0].createdAt, createdDate);
    assert.equal(result.entries[0].media[0].name, null);
  });
});

test("missing consent, unsupported filters and invalid cursors fail before any provider call", async () => {
  await mocked({}, async calls => {
    await assert.rejects(readEbayConversationsPage({ ...base, payload: { access_token: "fixture-token" } }), /CONSENT_REQUIRED/);
    await assert.rejects(readEbayConversationsPage({ ...base, type: "FROM_EBAY", startTime: "2026-08-01T00:00:00Z" }), /systemDateFilter/);
    for (const offset of [-1, 1, 2.5, NaN, 10_000_025]) await assert.rejects(readEbayConversationsPage({ ...base, offset }), /offset/);
    await assert.rejects(readEbayConversationsPage({ ...base, startTime: "2026-02-30T00:00:00Z", endTime: "2026-09-01T00:00:00Z" }), /startTime/);
    assert.equal(calls.length, 0);
  });
});

test("HTTP rejection and incomplete pagination are never normalized to an empty successful page", async () => {
  for (const status of [401, 403, 429, 500]) await mocked({ privateError: "do not expose" }, async () => {
    await assert.rejects(readEbayConversationsPage(base), new RegExp(`^Error: EBAY_MESSAGE_READ_HTTP_${status}$`));
  }, status);
  for (const body of [response([], "messages", 3), response([rawMessage], "messages", 4), { ...response([], "messages"), limit: 50 }, { ...response([], "messages"), next: "unexpected" }]) await mocked(body, async () => {
    await assert.rejects(readEbayConversationMessagesPage({ ...base, conversationId: "thread" }), /pagination/);
  });
});

test("unrecognized media, invalid dates, oversized or blank messages are not silently discarded", async () => {
  for (const row of [
    { ...rawMessage, messageBody: "x".repeat(20001) }, { ...rawMessage, messageBody: "" },
    { ...rawMessage, createdDate: "2026-02-30T00:00:00Z" }, { ...rawMessage, createdDate: 123 },
    { ...rawMessage, messageMedia: [{ mediaType: "VIDEO", mediaUrl: "https://files.example.test/x", mediaName: "x" }] },
    { ...rawMessage, messageMedia: [{ mediaType: "IMAGE", mediaUrl: "javascript:alert(1)", mediaName: "x" }] },
    { ...rawMessage, messageMedia: [{ mediaType: "IMAGE", mediaUrl: "https://user:secret@files.example.test/x", mediaName: "x" }] },
  ]) await mocked(response([row], "messages"), async () => {
    await assert.rejects(readEbayConversationMessagesPage({ ...base, conversationId: "thread" }), /EBAY_MESSAGE_CONTRACT_INVALID/);
  });
});

test("duplicate native identities cannot masquerade as distinct entries on a page", async () => {
  await mocked(response([rawMessage, rawMessage], "messages"), async () => {
    await assert.rejects(readEbayConversationMessagesPage({ ...base, conversationId: "thread" }), /duplicatePageIdentity/);
  });
  await mocked(response([conversation, conversation], "conversations"), async () => {
    await assert.rejects(readEbayConversationsPage(base), /duplicatePageIdentity/);
  });
});

test("roles require an exact verified seller identity and eBay notifications remain system messages", async () => {
  await mocked(response([rawMessage], "messages"), async () => {
    const row = (await readEbayConversationMessagesPage({ ...base, conversationId: "thread" })).entries[0];
    assert.equal(ebayConversationMessageRole(row, "FROM_MEMBERS", ["seller"]), "customer");
    assert.equal(ebayConversationMessageRole(row, "FROM_MEMBERS", ["buyer"]), "seller");
    assert.equal(ebayConversationMessageRole(row, "FROM_EBAY", ["seller"]), "system");
    for (const ids of [[], ["unknown-immutable-id"], ["seller", "buyer"]]) assert.equal(ebayConversationMessageRole(row, "FROM_MEMBERS", ids), "unverified");
    assert.equal(ebayConversationMessageRole(row, "FROM_EBAY", ["buyer"]), "unverified");
  });
});
