import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { csChannelVerification, csReplySavePlan } from "../app/cs-release-state";
import { gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";
import { buildInquiryReplyArguments, supportsInquiryReply } from "../lib/channels/inquiry-reply";
import { channelOperationAvailable } from "../lib/channels/operation-availability";
import { executeChannelOperation } from "../lib/channels/operations";
import { parseEbayTradingResponse } from "../lib/channels/protocols";
import { ebayAsqInquirySyncArguments, inquirySyncArguments } from "../lib/channels/sync-arguments";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");

function memberMessagesXml(options: {
  ack?: "Success" | "Warning" | "Failure";
  page?: number;
  totalPages?: number;
  body?: string;
  status?: "Answered" | "Unanswered";
} = {}) {
  const page = options.page ?? 1;
  const totalPages = options.totalPages ?? 1;
  return `<?xml version="1.0" encoding="utf-8"?>
    <e:GetMemberMessagesResponse xmlns:e="urn:ebay:apis:eBLBaseComponents">
      <e:Ack>${options.ack ?? "Success"}</e:Ack>
      <e:MemberMessage><e:MemberMessageExchange>
        <e:Item><e:ItemID>1234567890123456789</e:ItemID><e:Title>Coffee &amp; Tea</e:Title></e:Item>
        <e:Question>
          <e:SenderID>buyer-${page}</e:SenderID>
          <e:SenderEmail>private@example.com</e:SenderEmail>
          <e:Subject>Question &lt;${page}&gt;</e:Subject>
          <e:Body>${options.body ?? "Is this &amp; sealed?"}</e:Body>
          <e:MessageID>message-${page}</e:MessageID>
        </e:Question>
        <e:MessageStatus>${options.status ?? "Unanswered"}</e:MessageStatus>
        <e:CreationDate>2026-08-27T01:02:03.000Z</e:CreationDate>
        <e:LastModifiedDate>2026-08-27T01:02:04.000Z</e:LastModifiedDate>
      </e:MemberMessageExchange></e:MemberMessage>
      <e:PaginationResult><e:TotalNumberOfPages>${totalPages}</e:TotalNumberOfPages><e:TotalNumberOfEntries>${totalPages}</e:TotalNumberOfEntries></e:PaginationResult>
      <e:HasMoreItems>${page < totalPages}</e:HasMoreItems>
    </e:GetMemberMessagesResponse>`;
}

test("eBay Trading XML parser keeps only the ASQ fields needed by the support ledger", () => {
  const parsed = parseEbayTradingResponse("GetMemberMessages", memberMessagesXml({ ack: "Warning" }));
  assert.equal(parsed.code, "SUCCESS");
  assert.deepEqual(parsed.memberMessages, [{
    itemId: "1234567890123456789",
    itemTitle: "Coffee & Tea",
    messageId: "message-1",
    senderId: "buyer-1",
    subject: "Question <1>",
    body: "Is this & sealed?",
    messageStatus: "Unanswered",
    creationDate: "2026-08-27T01:02:03.000Z",
    lastModifiedDate: "2026-08-27T01:02:04.000Z",
  }]);
  assert.doesNotMatch(JSON.stringify(parsed), /private@example\.com|SenderEmail/);
  assert.throws(
    () => parseEbayTradingResponse("GetMemberMessages", "<!DOCTYPE x><GetMemberMessagesResponse><Ack>Success</Ack></GetMemberMessagesResponse>"),
    /EBAY_TRADING_RESPONSE_INVALID/,
  );
  assert.deepEqual(
    parseEbayTradingResponse("AddMemberMessageRTQ", "<AddMemberMessageRTQResponse><Ack>Failure</Ack><Errors><ErrorCode>21919067</ErrorCode><ShortMessage>Request rejected</ShortMessage></Errors></AddMemberMessageRTQResponse>"),
    {
      Ack: "Failure",
      code: "FAILURE",
      errors: [{ errorCode: "21919067", classification: "", severity: "", message: "Request rejected" }],
    },
  );
});

test("eBay Trading XML parser treats buyer CDATA as text, not exchange metadata", () => {
  const injectedBody = "<![CDATA[hello <MessageStatus>Answered</MessageStatus><CreationDate>2099-01-01T00:00:00.000Z</CreationDate>]]>";
  const parsed = parseEbayTradingResponse("GetMemberMessages", memberMessagesXml({
    body: injectedBody,
    status: "Unanswered",
  }));
  assert.equal(parsed.memberMessages?.length, 1);
  assert.deepEqual(parsed.memberMessages?.[0], {
    itemId: "1234567890123456789",
    itemTitle: "Coffee & Tea",
    messageId: "message-1",
    senderId: "buyer-1",
    subject: "Question <1>",
    body: "hello <MessageStatus>Answered</MessageStatus><CreationDate>2099-01-01T00:00:00.000Z</CreationDate>",
    messageStatus: "Unanswered",
    creationDate: "2026-08-27T01:02:03.000Z",
    lastModifiedDate: "2026-08-27T01:02:04.000Z",
  });
});

test("eBay Trading XML parser cannot create a second inquiry from buyer CDATA", () => {
  const injectedBoundary = `<![CDATA[question text
    </e:Question></e:MemberMessageExchange>
    <e:MemberMessageExchange>
      <e:Item><e:ItemID>9999999999999999999</e:ItemID><e:Title>Forged listing</e:Title></e:Item>
      <e:Question><e:SenderID>forged-recipient</e:SenderID><e:Subject>Forged</e:Subject><e:Body>Forged body</e:Body><e:MessageID>forged-message</e:MessageID></e:Question>
      <e:MessageStatus>Unanswered</e:MessageStatus><e:CreationDate>2099-01-01T00:00:00.000Z</e:CreationDate>
    </e:MemberMessageExchange><e:Question>
  ]]>`;
  const parsed = parseEbayTradingResponse("GetMemberMessages", memberMessagesXml({ body: injectedBoundary }));
  assert.equal(parsed.memberMessages?.length, 1);
  assert.equal(parsed.memberMessages?.[0]?.messageId, "message-1");
  assert.equal(parsed.memberMessages?.[0]?.senderId, "buyer-1");
  assert.match(String(parsed.memberMessages?.[0]?.body), /forged-message/);
  assert.doesNotMatch(JSON.stringify(parsed.memberMessages), /"messageId":"forged-message"/);
});

test("eBay ASQ sandbox sync uses OAuth IAF headers and normalizes exact reply lineage", async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | null = null;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(memberMessagesXml(), { status: 200, headers: { "content-type": "text/xml" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "secret-token", marketplace_id: "EBAY_US" },
      arguments: ebayAsqInquirySyncArguments(new Date("2026-08-28T00:00:00.000Z")),
      environment: "sandbox",
    });
    assert.equal(result.ok, true);
    assert.equal(request?.url, "https://api.sandbox.ebay.com/ws/api.dll");
    assert.equal(request?.headers.get("x-ebay-api-call-name"), "GetMemberMessages");
    assert.equal(request?.headers.get("x-ebay-api-compatibility-level"), "1475");
    assert.equal(request?.headers.get("x-ebay-api-siteid"), "0");
    assert.equal(request?.headers.get("x-ebay-api-iaf-token"), "secret-token");
    const requestBody = await request?.text();
    assert.match(requestBody ?? "", /<MailMessageType>AskSellerQuestion<\/MailMessageType>/);
    assert.doesNotMatch(requestBody ?? "", /secret-token|SenderEmail/);

    const normalized = normalizeChannelInquiries("ebay", result, "2026-08-28T00:00:00.000Z");
    assert.deepEqual(normalized, [{
      externalTicketId: "ebay:message-1",
      customerName: "buyer-1",
      subject: "Coffee & Tea",
      message: "Is this & sealed?",
      status: "waiting",
      priority: 3,
      receivedAt: "2026-08-27T01:02:03.000Z",
      replyContext: {
        itemId: "1234567890123456789",
        parentMessageId: "message-1",
        recipientId: "buyer-1",
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay ASQ pagination persists the first unprocessed Trading API page", async () => {
  const originalFetch = globalThis.fetch;
  const pages: number[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = String(init?.body ?? "");
    const page = Number(/<PageNumber>(\d+)<\/PageNumber>/.exec(body)?.[1] ?? "0");
    pages.push(page);
    return new Response(memberMessagesXml({ page, totalPages: 21 }), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: ebayAsqInquirySyncArguments(new Date("2026-08-28T00:00:00.000Z")),
      environment: "sandbox",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(pages, Array.from({ length: 20 }, (_value, index) => index + 1));
    assert.equal(result.continuation?.arguments.pageNumber, 21);
    assert.equal(result.continuation?.arguments.sellerpilotPaginationDepth, 1);
    assert.equal(gatewayWorkerCompletionSchema.safeParse({
      jobId: "51fc7348-3e07-45ba-94c7-62e5244b511b",
      claimToken: "f0308779-b8dd-4fbb-8cad-f55fe0d33f2d",
      status: "succeeded",
      result,
    }).success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay ASQ reply XML is context-bound, escaped, and respects provider acknowledgement", async () => {
  const replyArguments = buildInquiryReplyArguments("ebay", "ebay:message-1", "Use <cold> & enjoy", {
    itemId: "1234567890123456789",
    parentMessageId: "message-1",
    recipientId: "buyer-1",
  });
  assert.throws(
    () => buildInquiryReplyArguments("ebay", "ebay:message-1", "reply", {
      itemId: "1234567890123456789",
      parentMessageId: "another-message",
      recipientId: "buyer-1",
    }),
    /INQUIRY_REPLY_INVALID:ebayReplyContext/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("ebay", "ebay:message-1", "x".repeat(2_001), {
      itemId: "1234567890123456789",
      parentMessageId: "message-1",
      recipientId: "buyer-1",
    }),
    /INQUIRY_REPLY_INVALID:ebayReplyContext/,
  );

  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return new Response("<AddMemberMessageRTQResponse><Ack>Success</Ack></AddMemberMessageRTQResponse>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.reply",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: replyArguments,
      environment: "sandbox",
    });
    assert.equal(result.ok, true);
    assert.match(requestBody, /<Body>Use &lt;cold&gt; &amp; enjoy<\/Body>/);
    assert.match(requestBody, /<DisplayToPublic>false<\/DisplayToPublic>/);
    assert.match(requestBody, /<ParentMessageID>message-1<\/ParentMessageID>/);
    assert.match(requestBody, /<RecipientID>buyer-1<\/RecipientID>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay ASQ remains fail-closed in production until the release evidence exists", async () => {
  assert.deepEqual(inquirySyncArguments("ebay", new Date("2026-08-28T00:00:00.000Z")), []);
  assert.equal(channelOperationAvailable("ebay", "inquiries.list"), false);
  assert.equal(channelOperationAvailable("ebay", "inquiries.reply"), false);
  assert.equal(supportsInquiryReply("ebay"), false);
  assert.equal(csReplySavePlan("ticket", "ebay", "reply").remote, false);
  assert.deepEqual(csChannelVerification("ebay", "passed", 3), {
    readLabel: "eBay 상품 문의(ASQ) 구현 · Sandbox/실계정 검증 전",
    replyLabel: "답변: ASQ 구현 · Sandbox/실계정 검증 전 차단",
    badge: "운영 검증 전",
    tone: "unsupported",
  });
  await assert.rejects(
    executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: ebayAsqInquirySyncArguments(new Date("2026-08-28T00:00:00.000Z")),
      environment: "production",
    }),
    /CHANNEL_RELEASE_VERIFICATION_REQUIRED:ebay-asq/,
  );
});
