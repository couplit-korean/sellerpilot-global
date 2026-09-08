import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSmartstoreInquiries } from "../lib/channels/smartstore-inquiry-history.ts";
import { executeSmartstoreInquiry } from "../lib/channels/smartstore-inquiries.ts";
import { createTimestampNormalizer } from "../lib/channels/normalization-time.ts";

const iso = createTimestampNormalizer("2026-09-08T00:00:00.000Z");

function remote(data: Record<string, unknown>, status = 200) {
  return {
    response: new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    }),
    data,
  };
}

test("questionId and inquiryNo remain distinct even when their numeric values collide", () => {
  const product = normalizeSmartstoreInquiries({
    sellerpilotInquiryKind: "product",
    contents: [{
      questionId: 701,
      question: "상품 문의",
      createDate: "2026-09-08T09:00:00+09:00",
      orderId: "parent-must-not-bind",
      productOrderIdList: "9001",
    }],
  }, iso);
  const customer = normalizeSmartstoreInquiries({
    sellerpilotInquiryKind: "customer",
    content: [{
      inquiryNo: 701,
      inquiryContent: "고객 문의",
      inquiryRegistrationDateTime: "2026-09-08T09:00:00+09:00",
      orderId: "parent-order",
      productOrderIdList: "9001",
    }],
  }, iso);

  assert.equal(product[0]?.externalTicketId, "smartstore:product-qna:701");
  assert.equal(customer[0]?.externalTicketId, "customer:701");
  assert.notEqual(product[0]?.externalTicketId, customer[0]?.externalTicketId);
  assert.deepEqual(product[0]?.replyContext, { kind: "product", questionId: "701" });
  assert.deepEqual(customer[0]?.replyContext, { kind: "customer", inquiryNo: "701" });
  assert.equal(product[0]?.externalOrderReference, undefined);
  assert.equal(customer[0]?.externalOrderReference, "9001");
});

test("customer order binding uses exactly one productOrderId and never substitutes parent orderId", () => {
  const base = {
    sellerpilotInquiryKind: "customer",
    content: [{
      inquiryNo: 800,
      inquiryContent: "배송 문의",
      inquiryRegistrationDateTime: "2026-09-08T09:00:00+09:00",
      orderId: "parent-order-800",
    }],
  };
  const normalize = (fields: Record<string, unknown>) => normalizeSmartstoreInquiries({
    ...base,
    content: [{ ...(base.content[0] as Record<string, unknown>), ...fields }],
  }, iso)[0]!;

  const exact = normalize({ productOrderIdList: "10001" });
  assert.equal(exact.externalOrderReference, "10001");
  assert.equal(exact.providerContext.orderId, "parent-order-800");
  assert.deepEqual(exact.providerContext.productOrderIds, ["10001"]);
  assert.equal(exact.providerContext.orderReferenceState, "exact_product_order");

  const ambiguous = normalize({ productOrderIdList: "10001,10002" });
  assert.equal(ambiguous.externalOrderReference, undefined);
  assert.deepEqual(ambiguous.providerContext.productOrderIds, ["10001", "10002"]);
  assert.equal(ambiguous.providerContext.orderReferenceState, "ambiguous_product_orders");

  const duplicate = normalize({ productOrderIdList: "10001,10001" });
  assert.equal(duplicate.externalOrderReference, undefined);
  assert.equal(duplicate.providerContext.orderReferenceState, "ambiguous_product_orders");

  const parentOnly = normalize({});
  assert.equal(parentOnly.externalOrderReference, undefined);
  assert.equal(parentOnly.providerContext.orderReferenceState, "unavailable");

  const invalid = normalize({ productOrderIdList: "10001,not-an-order" });
  assert.equal(invalid.externalOrderReference, undefined);
  assert.equal(invalid.providerContext.orderReferenceState, "invalid_product_order_list");

  const conflictingLegacy = normalize({ productOrderIdList: "10001", productOrderId: "10002" });
  assert.equal(conflictingLegacy.externalOrderReference, undefined);
  assert.equal(conflictingLegacy.providerContext.orderReferenceState, "invalid_product_order_list");

  const exactArray = normalize({ productOrderIdList: ["10003"] });
  assert.equal(exactArray.externalOrderReference, "10003");
  assert.deepEqual(exactArray.providerContext.productOrderIds, ["10003"]);
  assert.equal(exactArray.providerContext.orderReferenceState, "exact_product_order");

  const ambiguousArray = normalize({ productOrderIdList: ["10003", "10004"] });
  assert.equal(ambiguousArray.externalOrderReference, undefined);
  assert.deepEqual(ambiguousArray.providerContext.productOrderIds, ["10003", "10004"]);
  assert.equal(ambiguousArray.providerContext.orderReferenceState, "ambiguous_product_orders");

  const emptyArray = normalize({ productOrderIdList: [] });
  assert.equal(emptyArray.externalOrderReference, undefined);
  assert.equal(emptyArray.providerContext.productOrderIds, undefined);
  assert.equal(emptyArray.providerContext.orderReferenceState, "unavailable");
});

test("latest customer text and historical seller answers keep separate immutable observations", () => {
  const normalize = (inquiryContent: string, answerContent: string) => normalizeSmartstoreInquiries({
    sellerpilotInquiryKind: "customer",
    content: [{
      inquiryNo: 900,
      inquiryContent,
      inquiryRegistrationDateTime: "2026-09-08T09:00:00+09:00",
      answerContent,
      answerContentId: 901,
      answerRegistrationDateTime: "2026-09-08T09:05:00+09:00",
      answered: true,
    }],
  }, iso);

  const first = normalize("수정 전 고객 문의", "과거 판매자 답변");
  const changed = normalize("수정된 최신 고객 문의", "수정된 판매자 답변");
  assert.equal(first[0]?.message, "수정 전 고객 문의");
  assert.equal(first[1]?.message, "과거 판매자 답변");
  assert.equal(changed[0]?.message, "수정된 최신 고객 문의");
  assert.equal(changed[1]?.message, "수정된 판매자 답변");
  assert.equal(changed[1]?.senderRole, "seller");
  assert.notEqual(first[1]?.remoteMessageId, changed[1]?.remoteMessageId);
  assert.equal(changed[1]?.providerContext.answerScope, "latest_answer");
});

test("product and customer history requests enforce fixed 30-day windows and exact continuations", async () => {
  const requests: Array<{ path: string; query: URLSearchParams }> = [];
  const request = async (input: { path: string; query?: URLSearchParams }) => {
    requests.push({ path: input.path, query: new URLSearchParams(input.query) });
    return remote(input.path.includes("pay-user")
      ? { content: [{ inquiryNo: 1 }], totalPages: 2 }
      : { contents: [{ questionId: 1 }], totalPages: 2 });
  };

  const product = await executeSmartstoreInquiry({
    operation: "inquiries.list",
    payload: {},
    arguments: { kind: "product", query: {
      fromDate: "2024-01-31T00:00:00.000+09:00",
      toDate: "2024-02-29T23:59:59.999+09:00",
      page: 1,
      size: 100,
      answered: false,
    } },
  }, request);
  assert.deepEqual(product.continuationArguments?.query, {
    fromDate: "2024-01-31T00:00:00.000+09:00",
    toDate: "2024-02-29T23:59:59.999+09:00",
    page: 2,
    size: 100,
    answered: "false",
  });
  assert.equal(requests[0]?.path, "/v1/contents/qnas");
  assert.equal(requests[0]?.query.get("answered"), "false");

  const customer = await executeSmartstoreInquiry({
    operation: "inquiries.list",
    payload: {},
    arguments: { kind: "customer", query: {
      startSearchDate: "2024-01-31",
      endSearchDate: "2024-02-29",
      page: 1,
      size: 200,
    } },
  }, request);
  assert.deepEqual(customer.continuationArguments?.query, {
    startSearchDate: "2024-01-31",
    endSearchDate: "2024-02-29",
    page: 2,
    size: 200,
  });
  assert.equal(requests[1]?.path, "/v1/pay-user/inquiries");

  const invalid = [
    { kind: "product", query: { fromDate: "2024-01-30T00:00:00.000+09:00", toDate: "2024-02-29T23:59:59.999+09:00", page: 1, size: 100 } },
    { kind: "product", query: { fromDate: "2024-01-31T00:00:00.000+09:00", toDate: "2024-02-29T23:59:59.999+09:00", page: 1.5, size: 100 } },
    { kind: "product", query: { fromDate: "2024-01-31T00:00:00.000+09:00", toDate: "2024-02-29T23:59:59.999+09:00", page: 1, size: 101 } },
    { kind: "customer", query: { startSearchDate: "2024-01-30", endSearchDate: "2024-02-29", page: 1, size: 200 } },
  ];
  for (const argumentsValue of invalid) {
    await assert.rejects(executeSmartstoreInquiry({
      operation: "inquiries.list",
      payload: {},
      arguments: argumentsValue,
    }, request), /CHANNEL_ARGUMENT_INVALID/);
  }
  assert.equal(requests.length, 2);
});

test("reply execution rejects cross-kind identifiers before provider access", async () => {
  const paths: string[] = [];
  const request = async (input: { path: string }) => {
    paths.push(input.path);
    return remote({});
  };

  await assert.rejects(executeSmartstoreInquiry({
    operation: "inquiries.reply",
    payload: {},
    arguments: { kind: "product", questionId: "customer:701", reply: "답변" },
  }, request), /CHANNEL_ARGUMENT_INVALID:questionId/);
  await assert.rejects(executeSmartstoreInquiry({
    operation: "inquiries.reply",
    payload: {},
    arguments: { kind: "customer", inquiryNo: "smartstore:product-qna:701", reply: "답변" },
  }, request), /CHANNEL_ARGUMENT_INVALID:inquiryNo/);
  await assert.rejects(executeSmartstoreInquiry({
    operation: "inquiries.list",
    payload: {},
    arguments: { kind: "talktalk", query: {} },
  }, request), /CHANNEL_ARGUMENT_INVALID:kind/);
  await assert.rejects(executeSmartstoreInquiry({
    operation: "inquiries.list",
    payload: {},
    arguments: { kind: "review", query: {} },
  }, request), /CHANNEL_ARGUMENT_INVALID:kind/);
  assert.deepEqual(paths, []);

  await executeSmartstoreInquiry({
    operation: "inquiries.reply",
    payload: {},
    arguments: { kind: "product", questionId: "701", reply: "상품 답변" },
  }, request);
  await executeSmartstoreInquiry({
    operation: "inquiries.reply",
    payload: {},
    arguments: { kind: "customer", inquiryNo: "701", reply: "고객 답변" },
  }, request);
  assert.deepEqual(paths, [
    "/v1/contents/qnas/701",
    "/v1/pay-merchant/inquiries/701/answer",
  ]);
});
