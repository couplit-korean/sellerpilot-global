import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { inquiryCoverageEvidence } from "../lib/channels/inquiry-coverage";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols";
import { inquiryHistorySyncRequests, inquirySyncRequests } from "../lib/channels/sync-arguments";

const now = new Date("2026-09-08T03:00:00.000Z");
const payload = { api_key: "test-qoo10-api-key" };

function result(rows: Record<string, unknown>[]) {
  return {
    ok: true as const,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "GetClaimInfo_V3",
      ok: true,
      status: 200,
      data: { ResultCode: 0, ResultObject: rows, sellerpilotInquiryKind: "claim" },
    }],
    safeMessage: "local fixture",
  };
}

function wrappedResult(rows: Record<string, unknown>[]) {
  const operation = result([]);
  operation.steps[0]!.data.ResultObject = { ClaimInfo: rows };
  return operation;
}

function inquiryResult(pages: Record<string, unknown>[][]) {
  return {
    ok: true as const,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    steps: pages.map((rows, index) => ({
      name: `inquiries:${index + 1}`,
      ok: true,
      status: 200,
      data: { ResultCode: 0, ResultObject: rows },
    })),
    safeMessage: "local fixture",
  };
}

test("Qoo10 current and history schedules keep three inquiry states and claims disjoint", () => {
  const current = inquirySyncRequests("qoo10", now);
  assert.deepEqual(current.map((request) => request.periodicKey), [
    "inquiries:0",
    "inquiries:1",
    "inquiries:2",
    "inquiries:claim:all",
  ]);
  assert.deepEqual(current[3]?.arguments, {
    kind: "claim",
    params: {
      search_Sdate: "20260902120000",
      search_Edate: "20260908120000",
      search_condition: "2",
    },
  });
  const history = inquiryHistorySyncRequests("qoo10", now, 30);
  assert.equal(history.length, 4);
  assert.match(history[3]?.periodicKey ?? "", /:claim:all$/u);
  assert.equal(history[3]?.arguments.kind, "claim");
  assert.equal((history[3]?.arguments.params as Record<string, unknown>).search_condition, "2");
});

test("Qoo10 claims call only the documented ShippingBasic read contract", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ ResultCode: 0, ResultObject: [] });
  };
  try {
    const operation = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "qoo10",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "claim",
        params: {
          search_Sdate: "20260611000000",
          search_Edate: "20260908120000",
          search_condition: "2",
        },
      },
      environment: "production",
    }));
    assert.equal(operation.ok, true);
    assert.match(calledUrl, /ShippingBasic\.GetClaimInfo_V3/u);
    assert.deepEqual(calledBody, {
      returnType: "json",
      search_Sdate: "20260611000000",
      search_Edate: "20260908120000",
      search_condition: "2",
    });
    assert.equal(operation.steps[0]?.data.sellerpilotInquiryKind, "claim");

    for (const invalid of [
      { search_Sdate: "20260609000000", search_Edate: "20260908120000", search_condition: "2" },
      { search_Sdate: "20260901000000", search_Edate: "20260908120000", search_condition: "9" },
      { search_Sdate: "20260901000000", search_Edate: "20260908120000", ClaimStat: { nested: "1" } },
      { search_Sdate: "20260901000000", search_Edate: "20260908120000", unsupported: "1" },
    ]) {
      await assert.rejects(runWithProviderReadOnlyTransport(() => executeChannelOperation({
        channel: "qoo10",
        operation: "inquiries.list",
        payload,
        arguments: { kind: "claim", params: invalid },
        environment: "production",
      })), /QOO10_CLAIM_(?:TIME_RANGE|QUERY)_INVALID/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 claim coverage accepts the provider ClaimInfo envelope", () => {
  const operation = wrappedResult([{
    claimStatus: "4",
    requestDate: "2026-09-08 10:00:00",
    orderNo: "901234567893",
    reason: "return requested",
  }]);
  const inquiries = normalizeChannelInquiries("qoo10", operation, now.toISOString());
  assert.equal(inquiries.length, 1);
  const coverage = inquiryCoverageEvidence("qoo10", operation, inquiries);
  assert.equal(coverage.providerRowCount, 1);
  assert.equal(coverage.projectedEventCount, 1);
  assert.equal(coverage.excludedCount, 0);
});

test("Qoo10 claim normalization preserves operational lineage and drops buyer contact and address fields", () => {
  const operation = result([{
    claimStatus: "4",
    requestDate: "2026-09-08 10:00:00",
    orderNo: "901234567890",
    reason: "상품이 손상되어 도착했습니다.",
    itemCode: "1234567890",
    sellerItemCode: "SELLER-SKU-1",
    itemTitle: "테스트 상품",
    orderQty: "1",
    paymentNation: "JP",
    currency: "JPY",
    paymentAmount: "1871",
    deliveryCompany: "Sagawa",
    trackingNo: "TRACK-OUT",
    deliveryCompanyReturn: "Yamato",
    trackingNoReturn: "TRACK-RETURN",
    pickupAddress: "do-not-store-pickup-address",
    zipCode: "000-0000",
    receiver: "민감 고객명",
    receiverTel: "03-0000-0000",
    receiverMobile: "090-0000-0000",
    buyer: "buyer-private-id",
    buyerTel: "03-1111-1111",
    buyerMobile: "090-1111-1111",
  }]);
  const [normalized] = normalizeChannelInquiries("qoo10", operation, now.toISOString());
  assert.equal(normalized?.externalTicketId, "qoo10:claim:901234567890:20260908010000");
  assert.equal(normalized?.externalOrderReference, "901234567890");
  assert.equal(normalized?.ticketKind, "after_sales");
  assert.equal(normalized?.providerStatus, "waiting");
  assert.equal(normalized?.providerContext.replySupported, false);
  assert.deepEqual(normalized?.replyContext, {});
  assert.equal(normalized?.message, "상품이 손상되어 도착했습니다.");
  assert.doesNotMatch(JSON.stringify(normalized), /do-not-store|000-0000|민감 고객명|private-id|receiver|buyerMobile|pickupAddress/u);
  assert.deepEqual(inquiryCoverageEvidence("qoo10", operation, [normalized!]), {
    contractVersion: "sellerpilot-inquiry-coverage/1",
    providerRowCount: 1,
    projectedEventCount: 1,
    excludedCount: 0,
    eventRowComparable: true,
    observationDigests: [createHash("sha256").update(normalized!.inboundKey).digest("hex")],
    hasContinuation: false,
  });
});

test("Qoo10 terminal claim states resolve the ticket while an invalid provider row fails closed", () => {
  const completed = normalizeChannelInquiries("qoo10", result([{
    claimStatus: "6",
    requestDate: "20260908100000",
    cancelRefundDate: "20260908110000",
    orderNo: "901234567891",
    reason: "반품 완료",
  }]), now.toISOString());
  assert.equal(completed[0]?.providerStatus, "answered");
  assert.throws(() => normalizeChannelInquiries("qoo10", result([{
    claimStatus: "99",
    requestDate: "20260908100000",
    orderNo: "901234567892",
  }]), now.toISOString()), /INQUIRY_RECORD_INVALID:qoo10/u);
  assert.throws(() => normalizeChannelInquiries("qoo10", result([{
    claimStatus: "4",
    requestDate: "20260230100000",
    orderNo: "901234567894",
  }]), now.toISOString()), /INQUIRY_RECORD_INVALID:qoo10/u);
});

test("Qoo10 S1/S2/S3 union retains MSG HELP ITEM and collapses only an identical sequence observation", () => {
  const base = { INQ_DT: "20260908100000", CONTENTS: "fixture inquiry" };
  const msg = { ...base, INQ_TYPE: "MSG", QUESTION_NO: "100", SEQ_NO: "101", STATUS: "S1" };
  const help = { ...base, INQ_TYPE: "HELP", QUESTION_NO: "200", SEQ_NO: "201", STATUS: "S2" };
  const item = { ...base, INQ_TYPE: "ITEM", QUESTION_NO: "300", SEQ_NO: "301", STATUS: "S3" };
  const normalized = normalizeChannelInquiries("qoo10", inquiryResult([
    [msg],
    [help],
    [item, { ...msg, STATUS: "S3" }],
  ]), now.toISOString());
  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized.map((entry) => entry.providerContext.inquiryType).sort(), ["HELP", "ITEM", "MSG"]);
  assert.equal(normalized.find((entry) => entry.externalTicketId === "qoo10:MSG:100:101")?.providerStatus, "answered");
});

test("Qoo10 keeps multiple requests and state revisions for one order without merging request-date boundaries", () => {
  const first = {
    claimStatus: "4",
    requestDate: "20260901090000",
    orderNo: "901234567899",
    reason: "first request",
  };
  const normalized = normalizeChannelInquiries("qoo10", result([
    first,
    { ...first, claimStatus: "6", cancelRefundDate: "20260902100000" },
    { ...first, requestDate: "20260903110000", claimStatus: "11", reason: "second request" },
  ]), now.toISOString());
  assert.equal(normalized.length, 3);
  assert.equal(new Set(normalized.map((entry) => entry.externalTicketId)).size, 2);
  assert.equal(new Set(normalized.map((entry) => entry.inboundKey)).size, 3);
  assert.deepEqual(normalized.map((entry) => entry.externalOrderReference), [
    "901234567899", "901234567899", "901234567899",
  ]);
  assert.deepEqual(normalized.map((entry) => entry.providerStatus), ["waiting", "answered", "waiting"]);
});
