import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import { inquiryCoverageEvidence } from "../lib/channels/inquiry-coverage";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols";
import { inquiryHistorySyncRequests, inquirySyncRequests } from "../lib/channels/sync-arguments";

const payload = {
  access_key: "access",
  secret_key: "secret",
  vendor_id: "A00012345",
};
const now = new Date("2026-09-08T03:00:00.000Z");

function providerResult(kind: "return_request" | "cancel_request" | "exchange_request", data: Record<string, unknown>[]) {
  return {
    ok: true as const,
    channel: "coupang" as const,
    operation: "inquiries.list" as const,
    steps: [{ name: "inquiries", ok: true, status: 200, data: { sellerpilotInquiryKind: kind, data } }],
    safeMessage: "ok",
  };
}

test("Coupang current and history schedules keep Q&A, call center, return, cancellation and exchange surfaces disjoint", () => {
  const current = inquirySyncRequests("coupang", now);
  assert.deepEqual(current.map((request) => request.periodicKey), [
    "inquiries:product:all",
    "inquiries:call-center:none",
    "inquiries:call-center:transfer",
    "inquiries:return_request:all",
    "inquiries:cancel_request:all",
    "inquiries:exchange_request:all",
  ]);
  assert.deepEqual(current[3]?.arguments, {
    kind: "return_request",
    query: {
      searchType: "timeFrame",
      createdAtFrom: "2026-09-02T12:00",
      createdAtTo: "2026-09-08T12:00",
      cancelType: "RETURN",
    },
  });
  assert.deepEqual(current[5]?.arguments, {
    kind: "exchange_request",
    query: {
      createdAtFrom: "2026-09-02T12:00:00",
      createdAtTo: "2026-09-08T12:00:00",
      maxPerPage: 10,
    },
  });

  const history = inquiryHistorySyncRequests("coupang", now, 30);
  assert.equal(history.length, 40);
  for (let index = 0; index < history.length; index += 8) {
    assert.deepEqual(history.slice(index, index + 8).map((request) => request.arguments.kind), [
      "product", "call-center", "call-center", "call-center", "call-center",
      "return_request", "cancel_request", "exchange_request",
    ]);
  }
});

test("Coupang return and cancellation reads use the documented timeFrame contract without unsupported pagination fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json({ code: 200, message: "OK", data: [] });
  };
  try {
    for (const [kind, cancelType] of [["return_request", "RETURN"], ["cancel_request", "CANCEL"]] as const) {
      const result = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
        channel: "coupang",
        operation: "inquiries.list",
        payload,
        arguments: {
          kind,
          query: {
            searchType: "timeFrame",
            createdAtFrom: "2026-09-01T00:00",
            createdAtTo: "2026-09-07T23:59",
            cancelType,
          },
        },
        environment: "production",
      }));
      assert.equal(result.ok, true);
      assert.equal(result.steps[0]?.data.sellerpilotInquiryKind, kind);
      assert.equal("continuation" in result, false);
    }
    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => url.pathname.endsWith("/returnRequests")));
    assert.deepEqual(calls.map((url) => url.searchParams.get("cancelType")), ["RETURN", "CANCEL"]);
    assert.ok(calls.every((url) => !url.searchParams.has("nextToken") && !url.searchParams.has("maxPerPage")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang exchange reads advance an exact nextToken continuation and reject an unsafe range", async () => {
  const originalFetch = globalThis.fetch;
  const tokens: Array<string | null> = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    tokens.push(url.searchParams.get("nextToken"));
    return Response.json({ code: 200, message: "OK", data: [], nextToken: tokens.length === 1 ? "NEXT-1" : "" });
  };
  const argumentsValue = {
    kind: "exchange_request",
    query: { createdAtFrom: "2026-09-01T00:00:00", createdAtTo: "2026-09-07T23:59:59", maxPerPage: 10 },
  };
  try {
    const first = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "coupang", operation: "inquiries.list", payload,
      arguments: argumentsValue, environment: "production",
    }));
    assert.equal(first.ok, true);
    assert.equal(first.continuation?.arguments.query.nextToken, "NEXT-1");
    assert.equal(first.continuation?.arguments.sellerpilotPaginationTrail instanceof Array, true);
    const second = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "coupang", operation: "inquiries.list", payload,
      arguments: first.continuation!.arguments, environment: "production",
    }));
    assert.equal(second.ok, true);
    assert.equal("continuation" in second, false);
    assert.deepEqual(tokens, [null, "NEXT-1"]);
    await assert.rejects(runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "coupang", operation: "inquiries.list", payload,
      arguments: {
        kind: "exchange_request",
        query: { createdAtFrom: "2026-09-01T00:00:00", createdAtTo: "2026-09-08T00:00:00" },
      },
      environment: "production",
    })), /COUPANG_AFTER_SALES_TIME_RANGE_INVALID/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang exchange stops a repeated nextToken instead of looping", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    code: 200,
    message: "OK",
    data: [],
    nextToken: "REPEATED",
  });
  try {
    const result = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "exchange_request",
        query: {
          createdAtFrom: "2026-09-01T00:00:00",
          createdAtTo: "2026-09-07T23:59:59",
          maxPerPage: 10,
          nextToken: "REPEATED",
        },
        sellerpilotPaginationTrail: ["REPEATED"],
      },
      environment: "production",
    }));
    assert.equal(result.ok, true);
    assert.equal("continuation" in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang after-sales normalization stores reasons and order lineage while dropping contact and address data", () => {
  const returnResult = providerResult("return_request", [{
    receiptId: 50229613,
    orderId: 28000008707838,
    receiptType: "RETURN",
    receiptStatus: "RETURNS_UNCHECKED",
    createdAt: "2026-09-08T10:00:00+09:00",
    modifiedAt: "2026-09-08T10:01:00+09:00",
    requesterName: "구*숙",
    requesterPhoneNumber: "010-0000-0000",
    requesterAddress: "do-not-store-return-address",
    cancelReasonCategory1: "고객변심",
    cancelReasonCategory2: "단순변심",
    cancelReason: "사이즈가 맞지 않습니다.",
    reasonCode: "CHANGEMIND",
    reasonCodeText: "필요 없어짐",
    returnItems: [{ vendorItemId: 3187044096, vendorItemName: "옵션", sellerProductId: 57623797, shipmentBoxId: 123456789, cancelCount: 1, purchaseCount: 1 }],
    returnDeliveryDtos: [{ deliveryCompanyCode: "CJGLS", deliveryInvoiceNo: "1234" }],
  }]);
  const [returned] = normalizeChannelInquiries("coupang", returnResult, now.toISOString());
  assert.equal(returned?.externalTicketId, "coupang:return:50229613");
  assert.equal(returned?.externalOrderReference, "28000008707838");
  assert.equal(returned?.ticketKind, "after_sales");
  assert.equal(returned?.providerContext.replySupported, false);
  assert.deepEqual(returned?.replyContext, {});
  assert.equal(returned?.message, "사이즈가 맞지 않습니다.");
  assert.doesNotMatch(JSON.stringify(returned), /010-0000|do-not-store-return-address|requesterPhoneNumber|requesterAddress/);

  const exchangeResult = providerResult("exchange_request", [{
    exchangeId: 101268974,
    orderId: 11000013144262,
    exchangeStatus: "PROGRESS",
    reasonCode: "DIFFERENTOPT",
    reasonCodeText: "색상/사이즈가 기대와 다름",
    reasonEtcDetail: "베이지색 대신 브라운이 왔습니다.",
    createdByType: "CUSTOMER",
    createdAt: "2026-09-08T10:00:00",
    modifiedAt: "2026-09-08T10:01:00",
    exchangeAddressDtoV1: { returnCustomerName: "이***", returnMobile: "010-1111-1111", returnAddress: "do-not-store-exchange-address" },
    exchangeItemDtoV1s: [{ exchangeItemId: 1765111, orderItemId: 3476137875, targetItemId: 3476137876, targetItemName: "교환 옵션", quantity: 1 }],
  }]);
  const [exchanged] = normalizeChannelInquiries("coupang", exchangeResult, now.toISOString());
  assert.equal(exchanged?.externalTicketId, "coupang:exchange:101268974");
  assert.equal(exchanged?.message, "베이지색 대신 브라운이 왔습니다.");
  assert.doesNotMatch(JSON.stringify(exchanged), /010-1111|do-not-store-exchange-address|exchangeAddressDtoV1/);
  assert.deepEqual(inquiryCoverageEvidence("coupang", exchangeResult, [exchanged!]), {
    contractVersion: "sellerpilot-inquiry-coverage/1",
    providerRowCount: 1,
    projectedEventCount: 1,
    excludedCount: 0,
    eventRowComparable: true,
    observationDigests: [createHash("sha256").update(exchanged!.inboundKey).digest("hex")],
    hasContinuation: false,
  });
});
