import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import { inquiryHistorySyncRequests, inquirySyncRequests } from "../lib/channels/sync-arguments";
import { inquiryCoverageEvidence } from "../lib/channels/inquiry-coverage";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols";
import { executeTemuInquiry, temuInquiryRetryContinuation } from "../lib/channels/temu-inquiries";

const now = new Date("2026-09-08T03:00:00.000Z");
const payload = { app_key: "app", app_secret: "secret", access_token: "token" };
const expectSha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test("Temu current and history after-sales schedules use documented second timestamps and detail reads", () => {
  const current = inquirySyncRequests("temu", now);
  assert.equal(current.length, 1);
  assert.equal(current[0]?.periodicKey, "inquiries:after_sales");
  assert.equal(current[0]?.arguments.includeDetails, true);
  assert.equal(current[0]?.arguments.updateAtEnd, Math.floor(now.getTime() / 1000));
  assert.ok(Number(current[0]?.arguments.updateAtStart) < 10_000_000_000);

  const history = inquiryHistorySyncRequests("temu", now, 30);
  assert.equal(history.length, 1);
  assert.match(history[0]?.periodicKey ?? "", /:after_sales$/);
  assert.equal(history[0]?.arguments.includeDetails, true);
  assert.ok(Number(history[0]?.arguments.updateAtStart) < Number(history[0]?.arguments.updateAtEnd));
});

test("Temu after-sales detail reads persist a bounded queue before advancing the list page", async () => {
  const originalFetch = globalThis.fetch;
  const detailSerials: string[] = [];
  let listCalls = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.type === "bg.aftersales.parentaftersales.list.get") {
      listCalls += 1;
      assert.equal(body.kind, undefined);
      assert.equal(body.includeDetails, undefined);
      assert.equal(body.sellerpilotPaginationDepth, undefined);
      assert.equal(body.sellerpilotPaginationEpoch, undefined);
      assert.equal(body.sellerpilotPaginationTrail, undefined);
      assert.equal(body.sellerpilotTemuDetailRetryCount, undefined);
      const pageNo = Number(body.pageNo);
      return Response.json({
        success: true,
        result: {
          data: pageNo === 1
            ? Array.from({ length: 12 }, (_, index) => ({
                parentAfterSalesSn: `AFTER-${index + 1}`,
                parentOrderSn: `ORDER-${index + 1}`,
                afterSalesStatusGroup: 1,
                updateAt: 1_788_000_000 + index,
              }))
            : [],
          total: 12,
          pageNumber: pageNo,
        },
      });
    }
    assert.equal(body.type, "temu.aftersales.parentaftersales.detail.get");
    const serial = String(body.parentAfterSalesSn);
    detailSerials.push(serial);
    return Response.json({
      success: true,
      result: {
        parentAfterSalesSn: serial,
        parentOrderSn: body.parentOrderSn,
        parentAfterSalesStatus: 1,
        afterSalesType: 2,
        afterSalesList: [{ afterSalesSn: `${serial}-CHILD`, orderSn: body.parentOrderSn, buyerComment: "박스가 손상됐습니다." }],
      },
    });
  };
  try {
    const first = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "temu",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        pageNo: 1,
        pageSize: 200,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
      },
      environment: "production",
    }));
    assert.equal(first.ok, true);
    assert.equal(listCalls, 1);
    assert.equal(detailSerials.length, 10);
    assert.equal((first.continuation?.arguments.detailQueue as unknown[]).length, 2);
    assert.equal(Object.hasOwn(first.continuation?.arguments ?? {}, "nextPageNo"), false);

    const second = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "temu",
      operation: "inquiries.list",
      payload,
      arguments: first.continuation!.arguments,
      environment: "production",
    }));
    assert.equal(second.ok, true);
    assert.equal(listCalls, 1);
    assert.equal(detailSerials.length, 12);
    assert.equal("continuation" in second, false);
    assert.equal(second.steps.every((step) => step.name === "inquiries" || /^inquiries:\d+$/.test(step.name)), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu detail job boundary is exact at 10 records and the 11th is continued", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const count of [10, 11]) {
      let detailCalls = 0;
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (body.type === "bg.aftersales.parentaftersales.list.get") {
          return Response.json({
            success: true,
            result: {
              data: Array.from({ length: count }, (_, index) => ({
                parentAfterSalesSn: `BOUNDARY-AFTER-${index + 1}`,
                parentOrderSn: `BOUNDARY-ORDER-${index + 1}`,
                updateAt: 1_788_000_000 + index,
              })),
              total: count,
              pageNumber: 1,
            },
          });
        }
        detailCalls += 1;
        return Response.json({
          success: true,
          result: {
            parentAfterSalesSn: body.parentAfterSalesSn,
            parentOrderSn: body.parentOrderSn,
            afterSalesList: [{ afterSalesSn: `${body.parentAfterSalesSn}-CHILD`, orderSn: body.parentOrderSn }],
          },
        });
      };
      const result = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
        channel: "temu",
        operation: "inquiries.list",
        payload,
        arguments: {
          kind: "after_sales",
          includeDetails: true,
          pageNo: 1,
          pageSize: 200,
          updateAtStart: 1_787_000_000,
          updateAtEnd: 1_788_000_100,
        },
        environment: "production",
      }));
      assert.equal(result.ok, true);
      assert.equal(detailCalls, 10);
      if (count === 10) {
        assert.equal(result.continuation, undefined);
      } else {
        assert.equal((result.continuation?.arguments.detailQueue as unknown[]).length, 1);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu detail requires every child orderSn to match the parent order", async () => {
  const originalFetch = globalThis.fetch;
  const arguments_ = {
    kind: "after_sales",
    includeDetails: true,
    updateAtStart: 1_787_000_000,
    updateAtEnd: 1_788_000_000,
    detailQueue: [{ parentAfterSalesSn: "AFTER-1", parentOrderSn: "ORDER-1" }],
  };
  try {
    globalThis.fetch = async () => Response.json({
      success: true,
      result: {
        parentAfterSalesSn: "AFTER-1",
        parentOrderSn: "ORDER-1",
        afterSalesList: [{ afterSalesSn: "AFTER-1-CHILD", orderSn: "ORDER-1" }],
      },
    });
    const matching = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload,
      arguments: arguments_,
    }));
    assert.equal(matching.steps.length, 1);
    assert.equal(matching.steps[0]?.ok, true);

    for (const child of [
      { afterSalesSn: "AFTER-1-CHILD", orderSn: "ORDER-OTHER" },
      { afterSalesSn: "AFTER-1-CHILD" },
    ]) {
      globalThis.fetch = async () => Response.json({
        success: true,
        result: {
          parentAfterSalesSn: "AFTER-1",
          parentOrderSn: "ORDER-1",
          afterSalesList: [child],
        },
      });
      await assert.rejects(
        runWithProviderReadOnlyTransport(() => executeTemuInquiry({
          operation: "inquiries.list",
          payload,
          arguments: arguments_,
        })),
        /TEMU_AFTER_SALES_DETAIL_MISMATCH/,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu detail normalization keeps buyer reason and refund evidence without arbitrary contact fields", () => {
  const normalized = normalizeChannelInquiries("temu", {
    ok: true,
    channel: "temu",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotListSummary: {
          parentAfterSalesSn: "AFTER-1",
          parentOrderSn: "ORDER-1",
          afterSalesStatusGroup: 1,
          operateExpireTimeMs: now.getTime() + 60_000,
          updateAt: Math.floor(now.getTime() / 1000),
          afterSalesType: 2,
        },
        result: {
          parentAfterSalesSn: "AFTER-1",
          parentOrderSn: "ORDER-1",
          parentAfterSalesStatus: 1,
          afterSalesType: 2,
          phone: "010-0000-0000",
          address: "do-not-store",
          refundSummary: { buyerTotalRefund: { currency: "KRW", amount: "3190", phone: "drop" } },
          afterSalesList: [{
            afterSalesSn: "AFTER-1-CHILD",
            orderSn: "ORDER-1",
            afterSalesReasonCode: 7,
            afterSalesReasonDesc: "파손",
            buyerComment: "박스가 손상됐습니다.",
            afterSalesStatus: 1,
            applyRefundAmount: { currency: "KRW", amount: "3190", address: "drop" },
          }],
        },
      },
    }],
    safeMessage: "ok",
  }, now.toISOString());
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.message, "박스가 손상됐습니다.");
  assert.equal(normalized[0]?.ticketKind, "after_sales");
  assert.equal(normalized[0]?.providerContext.replySupported, false);
  assert.deepEqual(normalized[0]?.replyContext, {});
  assert.deepEqual(normalized[0]?.providerContext.refundSummary, {
    buyerTotalRefund: { currency: "KRW", amount: "3190" },
  });
  const stored = JSON.stringify(normalized[0]);
  assert.doesNotMatch(stored, /010-0000|do-not-store|address|phone/);
  assert.deepEqual(inquiryCoverageEvidence("temu", {
    ok: true,
    channel: "temu",
    operation: "inquiries.list",
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      result: { afterSalesList: [{}] },
    } }],
    safeMessage: "ok",
  }, normalized), {
    contractVersion: "sellerpilot-inquiry-coverage/1",
    providerRowCount: 1,
    projectedEventCount: 1,
    excludedCount: 0,
    eventRowComparable: true,
    observationDigests: [expectSha256(normalized[0]!.inboundKey)],
    hasContinuation: false,
  });
});

test("Temu same after-sales identity creates a new revision when list status and content change", () => {
  const normalizeRevision = (updateAt: number, statusGroup: number, comment: string) => normalizeChannelInquiries("temu", {
    ok: true,
    channel: "temu",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotListSummary: {
          parentAfterSalesSn: "AFTER-REVISION",
          parentOrderSn: "ORDER-REVISION",
          afterSalesStatusGroup: statusGroup,
          updateAt,
        },
        result: {
          parentAfterSalesSn: "AFTER-REVISION",
          parentOrderSn: "ORDER-REVISION",
          parentAfterSalesStatus: statusGroup,
          afterSalesList: [{
            afterSalesSn: "AFTER-REVISION-CHILD",
            orderSn: "ORDER-REVISION",
            buyerComment: comment,
            afterSalesStatus: statusGroup,
          }],
        },
      },
    }],
    safeMessage: "ok",
  }, now.toISOString())[0]!;

  const original = normalizeRevision(1_788_000_000, 1, "first state");
  const changed = normalizeRevision(1_788_000_001, 5, "changed state");
  assert.equal(original.externalTicketId, changed.externalTicketId);
  assert.notEqual(original.remoteMessageId, changed.remoteMessageId);
  assert.equal(original.status, "waiting");
  assert.equal(changed.status, "resolved");
  assert.notEqual(original.message, changed.message);
});

test("Temu detail mode rejects missing time pairs, repeated queue identities and mismatched detail identity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      success: true,
      result: {
        parentAfterSalesSn: "WRONG",
        parentOrderSn: body.parentOrderSn,
        afterSalesList: [{ afterSalesSn: "CHILD", orderSn: body.parentOrderSn }],
      },
    });
  };
  const base = {
    channel: "temu" as const,
    operation: "inquiries.list" as const,
    payload,
    environment: "production" as const,
  };
  try {
    await assert.rejects(executeChannelOperation({
      ...base,
      arguments: { includeDetails: true, updateAtStart: 1_787_000_000 },
    }), /TEMU_AFTER_SALES_TIME_RANGE_INVALID/);
    await assert.rejects(executeChannelOperation({
      ...base,
      arguments: {
        kind: "buyer_chat",
        includeDetails: true,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
      },
    }), /TEMU_AFTER_SALES_KIND_INVALID/);
    await assert.rejects(executeChannelOperation({
      ...base,
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        updateAtStart: 1_787_000_000_000,
        updateAtEnd: 1_788_000_000_000,
      },
    }), /CHANNEL_ARGUMENT_INVALID:updateAtStart/);
    const duplicate = { parentAfterSalesSn: "AFTER-1", parentOrderSn: "ORDER-1" };
    await assert.rejects(executeChannelOperation({
      ...base,
      arguments: {
        includeDetails: true,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
        detailQueue: [duplicate, duplicate],
      },
    }), /TEMU_AFTER_SALES_DETAIL_QUEUE_INVALID/);
    await assert.rejects(executeChannelOperation({
      ...base,
      arguments: {
        includeDetails: true,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
        detailQueue: [{
          ...duplicate,
          availableOperateList: [{ phone: "do-not-store" }],
        }],
      },
    }), /TEMU_AFTER_SALES_OPERATIONS_INVALID/);
    await assert.rejects(executeChannelOperation({
      ...base,
      arguments: {
        includeDetails: true,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
        detailQueue: [duplicate],
      },
    }), /TEMU_AFTER_SALES_DETAIL_MISMATCH/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu failed detail preserves the failed identity and unattempted remainder for exact resume", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let listCalls = 0;
  let failOnce = true;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.type === "bg.aftersales.parentaftersales.list.get") {
      listCalls += 1;
      assert.equal(body.kind, undefined);
      assert.equal(body.includeDetails, undefined);
      assert.equal(body.sellerpilotPaginationDepth, undefined);
      assert.equal(body.sellerpilotPaginationEpoch, undefined);
      assert.equal(body.sellerpilotPaginationTrail, undefined);
      assert.equal(body.sellerpilotTemuDetailRetryCount, undefined);
      return Response.json({
        success: true,
        result: {
          data: Array.from({ length: 11 }, (_, index) => ({
            parentAfterSalesSn: `AFTER-${index + 1}`,
            parentOrderSn: `ORDER-${index + 1}`,
            afterSalesStatusGroup: 1,
            updateAt: 1_788_000_000 + index,
          })),
          total: 11,
          pageNumber: 1,
        },
      });
    }
    const afterSalesSn = String(body.parentAfterSalesSn);
    calls.push(afterSalesSn);
    if (afterSalesSn === "AFTER-3" && failOnce) {
      failOnce = false;
      return Response.json({ success: false, error_msg: "temporary failure" }, { status: 503 });
    }
    return Response.json({
      success: true,
      result: {
        parentAfterSalesSn: afterSalesSn,
        parentOrderSn: body.parentOrderSn,
        afterSalesList: [{ afterSalesSn: `${afterSalesSn}-CHILD`, orderSn: body.parentOrderSn }],
      },
    });
  };
  try {
    const first = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        pageNo: 1,
        pageSize: 200,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
        sellerpilotPaginationDepth: 1,
        sellerpilotPaginationEpoch: 2,
        sellerpilotPaginationTrail: ["a".repeat(64)],
      },
    }));
    assert.equal(first.steps.at(-1)?.ok, false);
    assert.equal((first.continuationArguments?.detailQueue as unknown[]).length, 9);
    assert.equal((first.continuationArguments?.detailQueue as Array<Record<string, unknown>>)[0]?.parentAfterSalesSn, "AFTER-3");
    assert.deepEqual(
      (first.continuationArguments?.retryReplayQueue as Array<Record<string, unknown>>)
        .map((item) => item.parentAfterSalesSn),
      ["AFTER-1", "AFTER-2"],
    );
    assert.equal(Object.hasOwn(first.continuationArguments ?? {}, "sellerpilotPaginationDepth"), false);
    assert.equal(Object.hasOwn(first.continuationArguments ?? {}, "sellerpilotPaginationEpoch"), false);
    assert.equal(Object.hasOwn(first.continuationArguments ?? {}, "sellerpilotPaginationTrail"), false);

    assert.equal(first.continuationArguments?.sellerpilotTemuDetailRetryCount, 1);
    const retry = temuInquiryRetryContinuation(first);
    assert.deepEqual(retry, {
      reason: "retryable_read_failure",
      arguments: first.continuationArguments,
      retryCount: 1,
      retryAfterSeconds: 5,
      deferredCount: 9,
      replayCount: 2,
      providerStatus: 503,
    });
    assert.equal(first.steps.at(-1)?.ok, false);

    const resumed = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload,
      arguments: retry!.arguments,
    }));
    assert.equal(resumed.steps.every((item) => item.ok), true);
    assert.equal((resumed.continuationArguments?.detailQueue as unknown[]).length, 1);
    assert.equal(Object.hasOwn(resumed.continuationArguments ?? {}, "retryReplayQueue"), false);
    const completed = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload,
      arguments: resumed.continuationArguments!,
    }));
    assert.equal(completed.steps.every((item) => item.ok), true);
    assert.equal(completed.continuationArguments, undefined);
    assert.equal(listCalls, 1);
    assert.deepEqual(calls, [
      "AFTER-1", "AFTER-2", "AFTER-3",
      "AFTER-1", "AFTER-2", "AFTER-3", "AFTER-4", "AFTER-5", "AFTER-6", "AFTER-7", "AFTER-8", "AFTER-9", "AFTER-10",
      "AFTER-11",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu retry descriptor stays fail-closed for auth errors and applies bounded backoff", () => {
  const summary = {
    parentAfterSalesSn: "AFTER-SCOPE",
    parentOrderSn: "ORDER-SCOPE",
  };
  const execution = {
    steps: [{
      name: "after-sales-list-discovery",
      ok: true,
      status: 200,
      data: { result: { data: [summary] } },
    }, {
      name: "inquiries",
      ok: false,
      status: 403,
      data: { sellerpilotListSummary: summary },
    }],
    continuationArguments: {
      kind: "after_sales",
      includeDetails: true,
      pageNo: 1,
      pageSize: 200,
      updateAtStart: 1_787_000_000,
      updateAtEnd: 1_788_000_000,
      detailQueue: [summary],
      sellerpilotTemuDetailRetryCount: 1,
    },
  };
  assert.equal(temuInquiryRetryContinuation(execution), null);
  assert.equal(temuInquiryRetryContinuation({
    ...execution,
    steps: [execution.steps[0]!, { ...execution.steps[1]!, status: 401 }],
  }), null);

  const retryable = temuInquiryRetryContinuation({
    ...execution,
    steps: [execution.steps[0]!, { ...execution.steps[1]!, status: 503 }],
  });
  assert.equal(retryable?.retryCount, 1);
  assert.equal(retryable?.retryAfterSeconds, 5);
  assert.equal(execution.steps.at(-1)?.ok, false);
  assert.equal(temuInquiryRetryContinuation({
    ...execution,
    steps: [execution.steps[0]!, { ...execution.steps[1]!, status: 503 }],
    continuationArguments: {
      ...execution.continuationArguments,
      sellerpilotTemuDetailRetryCount: 2,
    },
  })?.retryAfterSeconds, 10);
  assert.equal(temuInquiryRetryContinuation({
    ...execution,
    steps: [execution.steps[0]!, { ...execution.steps[1]!, status: 503 }],
    continuationArguments: {
      ...execution.continuationArguments,
      sellerpilotTemuDetailRetryCount: 3,
    },
  })?.retryAfterSeconds, 20);
});

test("Temu detail retry stops after three retries without another continuation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false, error_msg: "still unavailable" }, { status: 503 });
  try {
    const exhausted = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        pageNo: 1,
        pageSize: 200,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
        sellerpilotTemuDetailRetryCount: 3,
        detailQueue: [{ parentAfterSalesSn: "AFTER-EXHAUSTED", parentOrderSn: "ORDER-EXHAUSTED" }],
      },
    }));
    assert.equal(exhausted.steps.at(-1)?.ok, false);
    assert.equal(exhausted.continuationArguments, undefined);
    assert.equal(temuInquiryRetryContinuation(exhausted), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu after-sales reply stays blocked instead of being treated as a Buyer Chat or refund action", async () => {
  await assert.rejects(executeChannelOperation({
    channel: "temu",
    operation: "inquiries.reply",
    payload,
    arguments: { ticketId: "aftersales:AFTER-1", message: "not sent" },
    environment: "production",
  }), /CHANNEL_OPERATION_UNSUPPORTED:inquiries\.reply|CHANNEL_WRITE/);
});
