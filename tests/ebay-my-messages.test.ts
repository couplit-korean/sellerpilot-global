import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayTradingRequest,
  parseEbayTradingResponse,
  runWithProviderReadOnlyTransport,
} from "../lib/channels/protocols.ts";

function responseXml(messages: string, page = 1, pages = 1, entries = 1) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <Messages>${messages}</Messages>
  <PaginationResult><TotalNumberOfPages>${pages}</TotalNumberOfPages><TotalNumberOfEntries>${entries}</TotalNumberOfEntries></PaginationResult>
  <PageNumber>${page}</PageNumber>
</GetMyMessagesResponse>`;
}

const message = `<Message>
  <MessageID>mailbox-1</MessageID>
  <ExternalMessageID>asq-1</ExternalMessageID>
  <Sender>buyer-one</Sender>
  <RecipientUserID>seller-one</RecipientUserID>
  <Subject>배송 문의</Subject>
  <Content><![CDATA[  원문 <그대로>\n]]></Content>
  <ReceiveDate>2026-09-07T01:02:03.123Z</ReceiveDate>
  <ExpirationDate>2027-09-07T01:02:03.123Z</ExpirationDate>
  <ItemID>123456789</ItemID>
  <ItemTitle>Example item</ItemTitle>
  <MessageType>AskSellerQuestion</MessageType>
  <QuestionType>Shipping</QuestionType>
  <Read>false</Read><Replied>true</Replied><Flagged>false</Flagged><HighPriority>true</HighPriority>
  <ResponseDetails><ResponseEnabled>true</ResponseEnabled></ResponseDetails>
  <MessageMedia><MediaName>photo.jpg</MediaName><MediaURL>https://i.ebayimg.com/example.jpg</MediaURL></MessageMedia>
</Message>`;

test("GetMyMessages parser preserves exact mailbox identity, body, state and pagination", () => {
  const parsed = parseEbayTradingResponse("GetMyMessages", responseXml(message)) as Record<string, unknown>;
  const messages = parsed.myMessages as Array<Record<string, unknown>>;
  assert.equal(parsed.code, "SUCCESS");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, "mailbox-1");
  assert.equal(messages[0].externalMessageId, "asq-1");
  assert.equal(messages[0].content, "  원문 <그대로>\n");
  assert.equal(messages[0].contentOmitted, false);
  assert.equal(messages[0].contentBytes, Buffer.byteLength("  원문 <그대로>\n", "utf8"));
  assert.match(String(messages[0].contentSha256), /^[a-f0-9]{64}$/);
  assert.equal(messages[0].read, false);
  assert.equal(messages[0].replied, true);
  assert.equal(messages[0].highPriority, true);
  assert.equal(messages[0].responseEnabled, true);
  assert.deepEqual(messages[0].media, [{ name: "photo.jpg", url: "https://i.ebayimg.com/example.jpg" }]);
  assert.deepEqual(parsed.paginationResult, { totalNumberOfPages: 1, totalNumberOfEntries: 1 });
});

test("GetMyMessages marks an oversized body explicitly without retaining a partial original", () => {
  const oversized = message.replace(/<Content>[\s\S]*?<\/Content>/, `<Content>${"a".repeat(20_001)}</Content>`);
  const parsed = parseEbayTradingResponse("GetMyMessages", responseXml(oversized)) as Record<string, unknown>;
  const row = (parsed.myMessages as Array<Record<string, unknown>>)[0];
  assert.equal(row.content, "");
  assert.equal(row.contentOmitted, true);
  assert.equal(row.contentBytes, 20_001);
  assert.match(String(row.contentSha256), /^[a-f0-9]{64}$/);
});

test("GetMyMessages parser returns strict summary counts without mailbox content", () => {
  const xml = `<?xml version="1.0"?><GetMyMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Summary><FlaggedMessageCount>2</FlaggedMessageCount><NewHighPriorityCount>1</NewHighPriorityCount><NewMessageCount>18</NewMessageCount><TotalHighPriorityCount>3</TotalHighPriorityCount><TotalMessageCount>21</TotalMessageCount></Summary></GetMyMessagesResponse>`;
  const parsed = parseEbayTradingResponse("GetMyMessages", xml) as Record<string, unknown>;
  assert.deepEqual(parsed.summary, {
    flaggedMessageCount: 2,
    newHighPriorityCount: 1,
    newMessageCount: 18,
    totalHighPriorityCount: 3,
    totalMessageCount: 21,
  });
  assert.deepEqual(parsed.myMessages, []);
});

test("GetMyMessages keeps omitted summary counts unknown instead of inventing zero", () => {
  const xml = `<?xml version="1.0"?><GetMyMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Summary/></GetMyMessagesResponse>`;
  const parsed = parseEbayTradingResponse("GetMyMessages", xml) as Record<string, unknown>;
  assert.deepEqual(parsed.summary, {
    flaggedMessageCount: null,
    newHighPriorityCount: null,
    newMessageCount: null,
    totalHighPriorityCount: null,
    totalMessageCount: null,
  });
});

test("GetMyMessages rejects malformed booleans, nested bodies and oversized pages", () => {
  assert.throws(() => parseEbayTradingResponse("GetMyMessages", responseXml(message.replace("<Read>false</Read>", "<Read>maybe</Read>"))), /EBAY_TRADING_RESPONSE_INVALID/);
  assert.throws(() => parseEbayTradingResponse("GetMyMessages", responseXml(message.replace(/<Content>[\s\S]*?<\/Content>/, "<Content><b>nested</b></Content>"))), /EBAY_TRADING_RESPONSE_INVALID/);
  assert.throws(() => parseEbayTradingResponse("GetMyMessages", responseXml(message.repeat(201), 1, 1, 201)), /EBAY_TRADING_RESPONSE_INVALID/);
});

test("GetMyMessages is allowed only through the explicit read-only Trading transport", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ callName: string | null; body: string }> = [];
  globalThis.fetch = async (_url, init) => {
    calls.push({
      callName: new Headers(init?.headers).get("x-ebay-api-call-name"),
      body: String(init?.body ?? ""),
    });
    return new Response(responseXml("", 1, 0, 0), { status: 200, headers: { "content-type": "text/xml" } });
  };
  try {
    const request = () => ebayTradingRequest({
      payload: { access_token: "fixture-token" },
      environment: "production",
      callName: "GetMyMessages",
      marketplaceId: "EBAY_US",
      body: "<?xml version=\"1.0\" encoding=\"utf-8\"?><GetMyMessagesRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\"><DetailLevel>ReturnHeaders</DetailLevel><Pagination><EntriesPerPage>25</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetMyMessagesRequest>",
    });
    const result = await runWithProviderReadOnlyTransport(request);
    assert.equal(result.response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].callName, "GetMyMessages");
    assert.match(calls[0].body, /<DetailLevel>ReturnHeaders<\/DetailLevel>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
