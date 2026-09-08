import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";
import { executeChannelOperation } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});
const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");

function response(messages: string, page = 1, pages = 1, entries = 1) {
  return `<?xml version="1.0"?><GetMyMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Messages>${messages}</Messages><PaginationResult><TotalNumberOfPages>${pages}</TotalNumberOfPages><TotalNumberOfEntries>${entries}</TotalNumberOfEntries></PaginationResult><PageNumber>${page}</PageNumber></GetMyMessagesResponse>`;
}

function responseWithoutPagination(messages: string) {
  return `<?xml version="1.0"?><GetMyMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Messages>${messages}</Messages></GetMyMessagesResponse>`;
}

function message(id: string, options: { external?: string; type?: string; sender?: string; response?: boolean } = {}) {
  return `<Message><MessageID>${id}</MessageID>${options.external ? `<ExternalMessageID>${options.external}</ExternalMessageID>` : ""}${options.sender ? `<Sender>${options.sender}</Sender>` : ""}<Subject>safe-${id}</Subject><Content>body-${id}</Content><ReceiveDate>2026-09-07T01:02:03.123Z</ReceiveDate><ItemID>123456789</ItemID><ItemTitle>Example item</ItemTitle><MessageType>${options.type ?? "AccountMessage"}</MessageType><Read>false</Read><Replied>false</Replied><Flagged>false</Flagged><HighPriority>false</HighPriority>${options.response === undefined ? "" : `<ResponseDetails><ResponseEnabled>${options.response}</ResponseEnabled></ResponseDetails>`}</Message>`;
}

test("eBay mailbox sync follows the official header then ten-ID detail contract", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? "");
    bodies.push(body);
    assert.equal(new Headers(init?.headers).get("x-ebay-api-call-name"), "GetMyMessages");
    if (body.includes("ReturnHeaders")) {
      assert.match(body, /<FolderID>0<\/FolderID>/);
      assert.match(body, /<Pagination><EntriesPerPage>25<\/EntriesPerPage><PageNumber>1<\/PageNumber><\/Pagination>/);
      return new Response(response(
        message("platform-1") + message("member-1", { external: "external-1", sender: "buyer-one", response: true }),
        1,
        1,
        2,
      ), { status: 200 });
    }
    assert.match(body, /<DetailLevel>ReturnMessages<\/DetailLevel>/);
    assert.equal((body.match(/<MessageID>/g) ?? []).length, 2);
    return new Response(response(
      message("platform-1") + message("member-1", { external: "external-1", sender: "buyer-one", response: true }),
      1,
      1,
      2,
    ), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      environment: "production",
      arguments: {
        kind: "mailbox",
        startTime: "2026-09-01T00:00:00.000Z",
        endTime: "2026-09-08T00:00:00.000Z",
        folderId: 0,
        pageNumber: 1,
        entriesPerPage: 25,
        marketplaceId: "EBAY_US",
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.continuation, undefined);
    assert.equal(bodies.length, 2);
    const rows = normalizeChannelInquiries("ebay", result as ChannelOperationResult, "2026-09-08T00:00:01.000Z");
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.senderRole, "system");
    assert.equal(rows[0]?.status, "resolved");
    assert.equal(rows[1]?.senderRole, "customer");
    assert.equal(rows[1]?.status, "waiting");
    assert.equal(rows[1]?.replyContext.replySupported, false);
    assert.equal(rows[1]?.replyContext.parentMessageId, undefined);
    assert.equal(rows[1]?.providerContext.replySupported, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay mailbox ASQ echo is not duplicated beside GetMemberMessages", () => {
  const result: ChannelOperationResult = {
    ok: true,
    channel: "ebay",
    operation: "inquiries.list",
    safeMessage: "ok",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        myMessages: [{
          messageId: "mailbox-asq",
          externalMessageId: "provider-asq",
          sender: "buyer-one",
          subject: "question",
          content: "same question",
          receiveDate: "2026-09-07T01:02:03.123Z",
          itemId: "123456789",
          messageType: "AskSellerQuestion",
          responseEnabled: true,
          marketplaceId: "EBAY_US",
        }],
      },
    }],
  };
  assert.deepEqual(normalizeChannelInquiries("ebay", result, "2026-09-08T00:00:01.000Z"), []);
});

test("eBay mailbox refuses incomplete detail readback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? "");
    return new Response(body.includes("ReturnHeaders")
      ? response(message("mailbox-1"), 1, 1, 1)
      : response("", 1, 0, 0), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      environment: "production",
      arguments: {
        kind: "mailbox",
        startTime: "2026-09-01T00:00:00.000Z",
        endTime: "2026-09-08T00:00:00.000Z",
        folderId: 0,
        pageNumber: 1,
        entriesPerPage: 25,
        marketplaceId: "EBAY_US",
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps.at(-1)?.data.code, "EBAY_MAILBOX_DETAIL_MISSING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay mailbox refuses a detail ID that was not requested by the header page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? "");
    return new Response(body.includes("ReturnHeaders")
      ? response(message("header-1"), 1, 1, 1)
      : response(message("different-detail-1"), 1, 1, 1), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay", operation: "inquiries.list",
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" }, environment: "production",
      arguments: {
        kind: "mailbox", startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
        folderId: 0, pageNumber: 1, entriesPerPage: 25, marketplaceId: "EBAY_US",
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps.at(-1)?.data.code, "EBAY_MAILBOX_DETAIL_ID_MISMATCH");
  } finally { globalThis.fetch = originalFetch; }
});

test("eBay mailbox accepts a short terminal page when the provider omits optional pagination totals", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? "");
    return new Response(responseWithoutPagination(body.includes("ReturnHeaders")
      ? message("mailbox-1")
      : message("mailbox-1")), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      environment: "production",
      arguments: {
        kind: "mailbox",
        startTime: "2026-09-01T00:00:00.000Z",
        endTime: "2026-09-08T00:00:00.000Z",
        folderId: 0,
        pageNumber: 1,
        entriesPerPage: 25,
        marketplaceId: "EBAY_US",
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.continuation, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay mailbox continues empty known-intermediate and full unknown-total pages", async () => {
  const baseArguments = {
    kind: "mailbox",
    startTime: "2026-09-01T00:00:00.000Z",
    endTime: "2026-09-08T00:00:00.000Z",
    folderId: 0,
    pageNumber: 1,
    entriesPerPage: 25,
    marketplaceId: "EBAY_US",
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(response("", 1, 2, 1), { status: 200 });
    const empty = await executeChannelOperation({
      channel: "ebay", operation: "inquiries.list", payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      environment: "production", arguments: baseArguments,
    });
    assert.equal(empty.ok, true);
    assert.equal(empty.continuation?.arguments.pageNumber, 2);

    const full = Array.from({ length: 25 }, (_, index) => message(`mailbox-${index + 1}`)).join("");
    globalThis.fetch = async (_url, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("ReturnHeaders")) return new Response(responseWithoutPagination(full), { status: 200 });
      const requested = [...body.matchAll(/<MessageID>([^<]+)<\/MessageID>/g)].map(match => message(match[1]));
      return new Response(responseWithoutPagination(requested.join("")), { status: 200 });
    };
    const unknown = await executeChannelOperation({
      channel: "ebay", operation: "inquiries.list", payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      environment: "production", arguments: baseArguments,
    });
    assert.equal(unknown.ok, true);
    assert.equal(unknown.steps[0]?.data.paginationResult.totalNumberOfEntries, null);
    assert.equal(unknown.continuation?.arguments.pageNumber, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
