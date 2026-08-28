import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { csChannelVerification, csReplySavePlan } from "../app/cs-release-state";
import { gatewayJobCompletionStatus, gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";
import { buildInquiryReplyArguments, supportsInquiryReply } from "../lib/channels/inquiry-reply";
import { ebayAsqOperationMarketplaceId } from "../lib/channels/ebay-asq";
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

const [{ normalizeChannelInquiries }, { executeInquiryReplyViaChannelGateway }] = await Promise.all([
  import("../lib/channels/inquiry-sync"),
  import("../lib/channels/gateway"),
]);

function memberMessagesXml(options: {
  ack?: "Success" | "Warning" | "Failure";
  page?: number;
  totalPages?: number;
  body?: string;
  status?: "Answered" | "Unanswered";
  itemId?: string;
} = {}) {
  const page = options.page ?? 1;
  const totalPages = options.totalPages ?? 1;
  return `<?xml version="1.0" encoding="utf-8"?>
    <e:GetMemberMessagesResponse xmlns:e="urn:ebay:apis:eBLBaseComponents">
      <e:Ack>${options.ack ?? "Success"}</e:Ack>
      <e:MemberMessage><e:MemberMessageExchange>
        <e:Item><e:ItemID>${options.itemId ?? "1234567890123456789"}</e:ItemID><e:Title>Coffee &amp; Tea</e:Title></e:Item>
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

function getItemXml(itemId = "1234567890123456789", site = "UK") {
  return `<?xml version="1.0" encoding="utf-8"?><GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Item><ItemID>${itemId}</ItemID><Site>${site}</Site></Item></GetItemResponse>`;
}

const hashedEbayTicketId = `ebay:${"a".repeat(64)}`;

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
  assert.deepEqual(parseEbayTradingResponse("GetItem", getItemXml()), {
    Ack: "Success",
    code: "SUCCESS",
    item: { itemId: "1234567890123456789", site: "UK" },
  });
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
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return request.headers.get("x-ebay-api-call-name") === "GetItem"
      ? new Response(getItemXml(), { status: 200, headers: { "content-type": "text/xml" } })
      : new Response(memberMessagesXml(), { status: 200, headers: { "content-type": "text/xml" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "secret-token", marketplace_id: "EBAY_US" },
      arguments: ebayAsqInquirySyncArguments(new Date("2026-08-28T00:00:00.000Z"), "EBAY_GB"),
      environment: "sandbox",
    });
    const request = requests.find((item) => item.headers.get("x-ebay-api-call-name") === "GetMemberMessages") ?? null;
    const siteRequest = requests.find((item) => item.headers.get("x-ebay-api-call-name") === "GetItem") ?? null;
    assert.equal(result.ok, true);
    assert.equal(request?.url, "https://api.sandbox.ebay.com/ws/api.dll");
    assert.equal(request?.headers.get("x-ebay-api-call-name"), "GetMemberMessages");
    assert.equal(request?.headers.get("x-ebay-api-compatibility-level"), "1475");
    assert.equal(request?.headers.get("x-ebay-api-siteid"), "3");
    assert.equal(request?.headers.get("x-ebay-api-iaf-token"), "secret-token");
    assert.equal(siteRequest?.headers.get("x-ebay-api-call-name"), "GetItem");
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
        marketplaceId: "EBAY_GB",
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay ASQ pagination persists the first unprocessed Trading API page", async () => {
  const originalFetch = globalThis.fetch;
  const pages: number[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.headers.get("x-ebay-api-call-name") === "GetItem") {
      const itemId = /<ItemID>(\d+)<\/ItemID>/.exec(String(init?.body ?? ""))?.[1] ?? "";
      return new Response(getItemXml(itemId, "US"), { status: 200 });
    }
    const body = String(init?.body ?? "");
    const page = Number(/<PageNumber>(\d+)<\/PageNumber>/.exec(body)?.[1] ?? "0");
    pages.push(page);
    return new Response(memberMessagesXml({
      page,
      totalPages: 21,
      itemId: `${page}`.padStart(19, "1"),
    }), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: ebayAsqInquirySyncArguments(new Date("2026-08-28T00:00:00.000Z"), "EBAY_US"),
      environment: "sandbox",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(pages, [1, 2]);
    assert.equal(result.continuation?.arguments.pageNumber, 3);
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
  const replyArguments = buildInquiryReplyArguments("ebay", hashedEbayTicketId, "Use 2 < 3 & enjoy", {
    itemId: "1234567890123456789",
    parentMessageId: "message-1",
    recipientId: "buyer-1",
    marketplaceId: "EBAY_DE",
  });
  assert.throws(
    () => buildInquiryReplyArguments("ebay", hashedEbayTicketId, "Use <b>HTML</b>", {
      itemId: "1234567890123456789",
      parentMessageId: "message-1",
      recipientId: "buyer-1",
      marketplaceId: "EBAY_DE",
    }),
    /INQUIRY_REPLY_INVALID:ebayReplyContext/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("ebay", hashedEbayTicketId, "Use &lt;b&gt;HTML&lt;/b&gt;", {
      itemId: "110099887766",
      parentMessageId: "message-1",
      recipientId: "buyer-1",
      marketplaceId: "EBAY_US",
    }),
    /INQUIRY_REPLY_INVALID:ebayReplyContext/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("ebay", "ebay:not-a-hash", "reply", {
      itemId: "1234567890123456789",
      parentMessageId: "message-1",
      recipientId: "buyer-1",
      marketplaceId: "EBAY_DE",
    }),
    /INQUIRY_REPLY_INVALID:ebayReplyContext/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("ebay", hashedEbayTicketId, "x".repeat(2_001), {
      itemId: "1234567890123456789",
      parentMessageId: "message-1",
      recipientId: "buyer-1",
      marketplaceId: "EBAY_DE",
    }),
    /INQUIRY_REPLY_INVALID:ebayReplyContext/,
  );

  const originalFetch = globalThis.fetch;
  let requestBody = "";
  let replyRequest: Request | null = null;
  globalThis.fetch = async (input, init) => {
    replyRequest = new Request(input, init);
    requestBody = await replyRequest.text();
    return new Response("<AddMemberMessageRTQResponse><Ack>Success</Ack></AddMemberMessageRTQResponse>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.reply",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: replyArguments,
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(requestBody, /<Body>Use 2 &lt; 3 &amp; enjoy<\/Body>/);
    assert.match(requestBody, /<DisplayToPublic>false<\/DisplayToPublic>/);
    assert.match(requestBody, /<ParentMessageID>message-1<\/ParentMessageID>/);
    assert.match(requestBody, /<RecipientID>buyer-1<\/RecipientID>/);
    assert.equal(replyRequest?.headers.get("x-ebay-api-siteid"), "77");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay ASQ preserves a safe result for a non-XML HTTP 429", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>edge rate limit</html>", {
    status: 429,
    headers: { "content-type": "text/html" },
  });
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.reply",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        itemId: "1234567890123456789",
        parentMessageId: "message-429",
        recipientId: "buyer-429",
        marketplaceId: "EBAY_US",
        reply: "Plain text reply",
      },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.steps, [{
      name: "inquiry-reply",
      ok: false,
      status: 429,
      requestId: undefined,
      data: {
        Ack: "Failure",
        code: "FAILURE",
        errors: [{
          errorCode: "HTTP_429",
          classification: "SystemError",
          severity: "Error",
          message: "eBay Trading API rate limit exceeded.",
        }],
      },
    }]);
    assert.doesNotMatch(JSON.stringify(result), /edge rate limit|<html>/i);

    const completionStatus = gatewayJobCompletionStatus(result.operation, result.ok, result.steps);
    assert.equal(completionStatus, "succeeded");
    assert.equal(gatewayWorkerCompletionSchema.safeParse({
      jobId: "e2ea4331-7206-4ce3-ad26-7f34217fbb7a",
      claimToken: "ab1ecf8b-6487-4c3e-8675-ed6080c1a65c",
      status: completionStatus,
      result,
    }).success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay operator API derives release availability from the selected credential environment", () => {
  const route = readFileSync(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const consoleSource = readFileSync(new URL("../app/api-credential-center.tsx", import.meta.url), "utf8");
  const environmentOffset = route.indexOf("const environment =");
  const releaseOffset = route.indexOf("channelOperationRelease(channel, operation, environment)");
  assert.ok(environmentOffset > 0);
  assert.ok(releaseOffset > environmentOffset);
  assert.match(consoleSource, /channelOperationAvailable\(target\.channel\.key, item\.value, target\.credential\.environment\)/);
  assert.match(consoleSource, /startCreationTime:[\s\S]*endCreationTime:[\s\S]*marketplaceId: "EBAY_US"/);
});

test("periodic eBay ASQ sync uses the credential marketplace while manual reads stay explicit", () => {
  assert.equal(ebayAsqOperationMarketplaceId({
    periodic: true,
    credentialMarketplaceId: "EBAY_DE",
    requestedMarketplaceId: "EBAY_US",
  }), "EBAY_DE");
  assert.equal(ebayAsqOperationMarketplaceId({
    periodic: false,
    credentialMarketplaceId: "EBAY_DE",
    requestedMarketplaceId: "EBAY_GB",
  }), "EBAY_GB");
  assert.throws(() => ebayAsqOperationMarketplaceId({
    periodic: true,
    credentialMarketplaceId: "NOT_A_MARKET",
    requestedMarketplaceId: "EBAY_US",
  }), /CHANNEL_ARGUMENT_INVALID:marketplaceId/);
  assert.throws(() => ebayAsqOperationMarketplaceId({
    periodic: true,
    credentialMarketplaceId: "",
    requestedMarketplaceId: "EBAY_US",
  }), /CHANNEL_ARGUMENT_INVALID:marketplaceId/);
});

test("eBay provider rate fence reaches the CS route as a retryable rate error", async () => {
  await assert.rejects(
    executeInquiryReplyViaChannelGateway({
      serviceClient: {
        rpc: async () => ({
          data: null,
          error: { message: "EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS" },
        }),
      } as never,
      ticketId: "e2ea4331-7206-4ce3-ad26-7f34217fbb7a",
      channel: "ebay",
      reply: "reply",
      arguments: {},
    }),
    /EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS/,
  );
});

test("eBay ASQ exposes reads and lineage-gated RTQ replies in both official environments", () => {
  assert.deepEqual(
    inquirySyncArguments("ebay", new Date("2026-08-28T00:00:00.000Z")),
    [ebayAsqInquirySyncArguments(new Date("2026-08-28T00:00:00.000Z"))],
  );
  assert.deepEqual(
    inquirySyncArguments("ebay", new Date("2026-08-28T00:00:00.000Z"), {
      environment: "sandbox",
      marketplaceId: "EBAY_DE",
    }),
    [ebayAsqInquirySyncArguments(new Date("2026-08-28T00:00:00.000Z"), "EBAY_DE")],
  );
  assert.equal(channelOperationAvailable("ebay", "inquiries.list"), true);
  assert.equal(channelOperationAvailable("ebay", "inquiries.list", "sandbox"), true);
  assert.equal(channelOperationAvailable("ebay", "inquiries.reply"), false);
  assert.equal(channelOperationAvailable("ebay", "inquiries.reply", "sandbox"), false);
  assert.equal(supportsInquiryReply("ebay"), false);
  assert.equal(supportsInquiryReply("ebay", "sandbox", {
    providerCertified: true,
    sellerAccountVerified: true,
    marketplaceBound: true,
  }), true);
  assert.equal(supportsInquiryReply("ebay", "production", {
    providerCertified: true,
    sellerAccountVerified: true,
    marketplaceBound: true,
  }), true);
  assert.equal(csReplySavePlan("ticket", "ebay", "reply").remote, true);
  assert.deepEqual(csChannelVerification("ebay", "passed", 3), {
    readLabel: "eBay 상품 문의(ASQ) 조회 성공 · 원장 3건",
    replyLabel: "답변: 검증된 계정·사이트·문의 계보만 보안 게이트웨이 전송",
    badge: "조회 성공",
    tone: "passed",
  });
});
