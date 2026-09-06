import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");
const { normalizeChannelOrders } = await import("../lib/channels/order-sync");

const NORMALIZATION_TIMESTAMP = "2026-08-26T03:04:05.000Z";

function result(
  channel: ChannelOperationResult["channel"],
  operation: ChannelOperationResult["operation"],
  name: string,
  data: Record<string, unknown>,
): ChannelOperationResult {
  return {
    ok: true,
    channel,
    operation,
    steps: [{ name, ok: true, status: 200, data }],
    safeMessage: "test fixture",
  };
}

test("missing provider order and inquiry timestamps use the immutable completion timestamp", () => {
  const orderResult = result("shopee", "orders.list", "orders", {
    response: {
      order_list: [{ order_sn: "ORDER-1", total_amount: 1200, currency: "KRW" }],
    },
  });
  const inquiryResult = result("qoo10", "inquiries.list", "inquiries", {
    ResultObject: [{
      INQ_TYPE: "ITEM",
      QUESTION_NO: "QUESTION-1",
      SEQ_NO: "1",
      CONTENTS: "배송 일정을 알려주세요.",
    }],
  });

  const firstOrders = normalizeChannelOrders("shopee", orderResult, NORMALIZATION_TIMESTAMP);
  const secondOrders = normalizeChannelOrders("shopee", orderResult, NORMALIZATION_TIMESTAMP);
  const firstInquiries = normalizeChannelInquiries("qoo10", inquiryResult, NORMALIZATION_TIMESTAMP);
  const secondInquiries = normalizeChannelInquiries("qoo10", inquiryResult, NORMALIZATION_TIMESTAMP);

  assert.deepEqual(firstOrders, secondOrders);
  assert.deepEqual(firstInquiries, secondInquiries);
  assert.equal(firstOrders[0]?.orderedAt, NORMALIZATION_TIMESTAMP);
  assert.equal(firstInquiries[0]?.receivedAt, NORMALIZATION_TIMESTAMP);
});

test("direct synchronization captures a sensible observation timestamp instead of persisting Unix epoch", () => {
  const orderResult = result("shopee", "orders.list", "orders", {
    response: { order_list: [{ order_sn: "ORDER-EPOCH" }] },
  });
  const inquiryResult = result("qoo10", "inquiries.list", "inquiries", {
    ResultObject: [{
      INQ_TYPE: "MSG",
      QUESTION_NO: "QUESTION-EPOCH",
      SEQ_NO: "1",
      CONTENTS: "문의 시간 없음",
    }],
  });

  const directSyncTimestamp = new Date().toISOString();
  assert.notEqual(directSyncTimestamp, "1970-01-01T00:00:00.000Z");
  assert.equal(normalizeChannelOrders("shopee", orderResult, directSyncTimestamp)[0]?.orderedAt, directSyncTimestamp);
  assert.equal(normalizeChannelInquiries("qoo10", inquiryResult, directSyncTimestamp)[0]?.receivedAt, directSyncTimestamp);
});

test("Shopee normalized orders preserve the credential-certified shop and merchant context", () => {
  const orderResult = result("shopee", "orders.list", "orders", {
    response: { order_list: [{ order_sn: "ORDER-LINEAGE" }] },
    sellerpilotProviderContext: { shopId: "123456789", merchantId: "987654321" },
  });

  assert.deepEqual(
    normalizeChannelOrders("shopee", orderResult, NORMALIZATION_TIMESTAMP)[0]?.providerContext,
    {
      orderSn: "ORDER-LINEAGE",
      shopId: "123456789",
      merchantId: "987654321",
    },
  );
});

test("Smartstore product Q&A and customer inquiries keep disjoint provider identities", () => {
  const productResult = result("smartstore", "inquiries.list", "inquiries", {
    sellerpilotInquiryKind: "product",
    contents: [{
      questionId: 987654,
      question: "상품 재입고 일정이 궁금합니다.",
      productName: "테스트 상품",
      maskedWriterId: "buy***",
      answered: false,
      createDate: "2026-08-25T12:34:56.000+09:00",
    }],
  });
  const customerResult = result("smartstore", "inquiries.list", "inquiries", {
    sellerpilotInquiryKind: "customer",
    content: [{
      inquiryNo: 987654,
      category: "배송",
      title: "배송 일정 문의",
      inquiryContent: "언제 출고되나요?",
      inquiryRegistrationDateTime: "2026-08-26T09:00:00.000+09:00",
      answered: false,
      orderId: "ORDER-1",
      productName: "테스트 상품",
      customerId: "buyer-1",
      customerName: "구매자",
    }],
  });

  const [productInquiry] = normalizeChannelInquiries("smartstore", productResult, NORMALIZATION_TIMESTAMP);
  assert.deepEqual({
    externalTicketId: productInquiry?.externalTicketId,
    customerName: productInquiry?.customerName,
    subject: productInquiry?.subject,
    message: productInquiry?.message,
    status: productInquiry?.status,
    priority: productInquiry?.priority,
    receivedAt: productInquiry?.receivedAt,
    providerContext: productInquiry?.providerContext,
    replyContext: productInquiry?.replyContext,
    remoteMessageId: productInquiry?.remoteMessageId,
    providerStatus: productInquiry?.providerStatus,
    ticketKind: productInquiry?.ticketKind,
  }, {
    externalTicketId: "smartstore:product-qna:987654",
    customerName: "buy***",
    subject: "테스트 상품",
    message: "상품 재입고 일정이 궁금합니다.",
    status: "waiting",
    priority: 3,
    receivedAt: "2026-08-25T03:34:56.000Z",
    providerContext: { kind: "product", namespace: "product-qna", questionId: "987654", unsequencedAnswers: [] },
    replyContext: { kind: "product", questionId: "987654" },
    remoteMessageId: "987654",
    providerStatus: "waiting",
    ticketKind: "conversation",
  });
  assert.match(productInquiry?.inboundKey ?? "", /^smartstore:[0-9a-f]{64}$/);

  const [customerInquiry] = normalizeChannelInquiries("smartstore", customerResult, NORMALIZATION_TIMESTAMP);
  assert.deepEqual({
    externalTicketId: customerInquiry?.externalTicketId,
    customerName: customerInquiry?.customerName,
    subject: customerInquiry?.subject,
    message: customerInquiry?.message,
    status: customerInquiry?.status,
    priority: customerInquiry?.priority,
    receivedAt: customerInquiry?.receivedAt,
    externalOrderReference: customerInquiry?.externalOrderReference,
    providerContext: customerInquiry?.providerContext,
    replyContext: customerInquiry?.replyContext,
    remoteMessageId: customerInquiry?.remoteMessageId,
    providerStatus: customerInquiry?.providerStatus,
    ticketKind: customerInquiry?.ticketKind,
  }, {
    externalTicketId: "customer:987654",
    customerName: "구매자",
    subject: "배송 일정 문의",
    message: "언제 출고되나요?",
    status: "waiting",
    priority: 3,
    receivedAt: "2026-08-26T00:00:00.000Z",
    externalOrderReference: "ORDER-1",
    providerContext: { kind: "customer", inquiryNo: "987654", unsequencedAnswers: [] },
    replyContext: { kind: "customer", inquiryNo: "987654" },
    remoteMessageId: "987654",
    providerStatus: "waiting",
    ticketKind: "conversation",
  });
  assert.match(customerInquiry?.inboundKey ?? "", /^smartstore:[0-9a-f]{64}$/);
});

test("Temu deadline priority is identical across exact completion replays", () => {
  const referenceTime = new Date(NORMALIZATION_TIMESTAMP).getTime();
  const inquiryResult = result("temu", "inquiries.list", "inquiries", {
    result: {
      data: [{
        parentAfterSalesSn: "AFTER-SALES-1",
        parentOrderSn: "TEMU-ORDER-1",
        afterSalesType: 2,
        afterSalesStatusGroup: "1",
        operateExpireTimeMs: referenceTime + 23 * 60 * 60 * 1000,
      }],
    },
  });
  const originalDateNow = Date.now;
  try {
    Date.now = () => referenceTime - 10 * 24 * 60 * 60 * 1000;
    const first = normalizeChannelInquiries("temu", inquiryResult, NORMALIZATION_TIMESTAMP);
    Date.now = () => referenceTime + 10 * 24 * 60 * 60 * 1000;
    const replay = normalizeChannelInquiries("temu", inquiryResult, NORMALIZATION_TIMESTAMP);

    assert.deepEqual(first, replay);
    assert.equal(first[0]?.priority, 1);
    assert.equal(first[0]?.receivedAt, NORMALIZATION_TIMESTAMP);
  } finally {
    Date.now = originalDateNow;
  }
});

test("Temu after-sales identity advances only for a trusted provider revision", () => {
  const baseRow = {
    parentAfterSalesSn: "AFTER-SALES-REVISION",
    parentOrderSn: "TEMU-ORDER-REVISION",
    afterSalesType: 2,
    afterSalesStatusGroup: "1",
    availableOperateList: ["refund", "return"],
    updateAt: "2026-08-25T09:00:00.000Z",
  };
  const first = normalizeChannelInquiries("temu", result("temu", "inquiries.list", "temu-revision-1", {
    result: { data: [baseRow] },
  }), NORMALIZATION_TIMESTAMP)[0];
  const transitioned = normalizeChannelInquiries("temu", result("temu", "inquiries.list", "temu-revision-2", {
    result: { data: [{
      ...baseRow,
      afterSalesStatusGroup: "2",
      availableOperateList: ["approve"],
      updateAt: "2026-08-25T10:00:00.000Z",
    }] },
  }), "2026-08-30T11:00:00.000Z")[0];
  const transitionedReplay = normalizeChannelInquiries("temu", result("temu", "inquiries.list", "temu-revision-3", {
    result: { data: [{
      ...baseRow,
      afterSalesStatusGroup: "2",
      availableOperateList: ["approve"],
      updateAt: "2026-08-25T10:00:00+00:00",
    }] },
  }), "2026-08-31T12:00:00.000Z")[0];
  assert.notEqual(first?.remoteMessageId, transitioned?.remoteMessageId);
  assert.notEqual(first?.inboundKey, transitioned?.inboundKey);
  assert.equal(transitioned?.remoteMessageId, transitionedReplay?.remoteMessageId);
  assert.equal(transitioned?.inboundKey, transitionedReplay?.inboundKey);
  assert.equal(transitioned?.providerContext.afterSalesSn, "AFTER-SALES-REVISION");

  const fallbackA = normalizeChannelInquiries("temu", result("temu", "inquiries.list", "temu-state-a", {
    result: { data: [{ ...baseRow, updateAt: undefined, availableOperateList: ["return", "refund"] }] },
  }), "2026-08-30T11:00:00.000Z")[0];
  const fallbackB = normalizeChannelInquiries("temu", result("temu", "inquiries.list", "temu-state-b", {
    result: { data: [{ ...baseRow, updateAt: undefined, availableOperateList: ["refund", "return"] }] },
  }), "2026-08-31T12:00:00.000Z")[0];
  assert.equal(fallbackA?.remoteMessageId, fallbackB?.remoteMessageId);
  assert.equal(fallbackA?.inboundKey, fallbackB?.inboundKey);
});

test("Lazada history with no provider time uses the same immutable completion timestamp", () => {
  const inquiryResult = result("lazada", "inquiries.list", "inquiries-message:session-1:1", {
    sellerpilotSession: {
      session_id: "session-1",
      title: "buyer-one",
      unread_count: 1,
    },
    data: {
      message_list: [{
        message_id: "message-1",
        from_account_type: 1,
        status: 0,
        content: JSON.stringify({ txt: "상품 문의입니다." }),
      }],
    },
  });

  const first = normalizeChannelInquiries("lazada", inquiryResult, NORMALIZATION_TIMESTAMP);
  const replay = normalizeChannelInquiries("lazada", inquiryResult, NORMALIZATION_TIMESTAMP);
  assert.deepEqual(first, replay);
  assert.equal(first[0]?.receivedAt, NORMALIZATION_TIMESTAMP);
});
