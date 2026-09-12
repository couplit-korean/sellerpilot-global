import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";
import { executeChannelOperation } from "../lib/channels/operations";
import { inquiryHistorySyncRequests, inquirySyncRequests } from "../lib/channels/sync-arguments";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});
const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");

const payload = {
  partner_id: "2031489",
  partner_key: "partner-secret",
  shop_id: "1719148844",
  access_token: "access-token",
};

function returnDetail(returnSn: string) {
  return {
    return_sn: returnSn,
    reason: "PHYSICAL_DMG",
    text_reason: "포장이 파손됐어요",
    image: ["https://example.test/return.jpg"],
    buyer_videos: [{ thumbnail_url: "https://example.test/thumb.jpg", video_url: "https://example.test/evidence.mp4" }],
    create_time: 1_788_000_000,
    update_time: 1_788_000_100,
    status: "REQUESTED",
    due_date: 1_788_050_000,
    return_seller_due_date: 1_788_050_000,
    return_ship_due_date: 1_788_040_000,
    order_sn: "ORDER-RETURN-1",
    user: { username: "buyer-1", email: "private@example.test" },
    negotiation: {
      negotiation_status: "PENDING_RESPOND",
      latest_solution: "RETURN_REFUND",
      offer_due_date: 1_788_050_000,
    },
    seller_proof: { seller_proof_status: "PENDING", seller_evidence_deadline: 1_788_050_000 },
    seller_compensation: { seller_compensation_status: "NOT_REQUIRED" },
    return_pickup_address: { address: "must not persist" },
  };
}

test("Shopee current and history schedules keep product reviews and return/refund as separate surfaces", () => {
  const now = new Date("2026-09-08T03:00:00.000Z");
  const current = inquirySyncRequests("shopee", now);
  assert.deepEqual(current.map((request) => request.periodicKey), [
    "inquiries:product_review",
    "inquiries:return_refund",
  ]);
  assert.equal(current[1]?.arguments.createTimeTo, Math.floor(now.getTime() / 1000));
  const history = inquiryHistorySyncRequests("shopee", now, 30);
  assert.equal(history.length, 2);
  assert.ok(history.every((request) => request.periodicKey.endsWith(":return_refund")));
  assert.ok(history.every((request) =>
    Number(request.arguments.createTimeTo) - Number(request.arguments.createTimeFrom) <= 15 * 86_400));
});

test("Shopee return/refund list uses bounded detail continuations without losing a return serial", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const serials = Array.from({ length: 11 }, (_, index) => `RETURN${index + 1}`);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname.endsWith("get_return_list")) {
      return Response.json({ error: "", response: {
        return: serials.map((returnSn) => ({ return_sn: returnSn })), more: true,
      } });
    }
    return Response.json({ error: "", response: returnDetail(url.searchParams.get("return_sn") ?? "") });
  };
  try {
    const first = await executeChannelOperation({
      channel: "shopee",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "return_refund",
        createTimeFrom: 1_787_000_000,
        createTimeTo: 1_788_000_000,
        pageNo: 1,
        pageSize: 100,
      },
      environment: "production",
    });
    assert.equal(first.ok, true);
    assert.equal(calls.filter((call) => call.includes("get_return_list")).length, 1);
    assert.equal(calls.filter((call) => call.includes("get_return_detail")).length, 10);
    assert.deepEqual(first.continuation?.arguments.returnQueue, ["RETURN11"]);
    assert.equal(first.continuation?.arguments.nextPageNo, 2);
    assert.equal(first.steps.filter((item) => /^inquiries(?::\d+)?$/.test(item.name)).length, 10);

    const second = await executeChannelOperation({
      channel: "shopee",
      operation: "inquiries.list",
      payload,
      arguments: first.continuation!.arguments,
      environment: "production",
    });
    assert.equal(second.ok, true);
    assert.equal(calls.filter((call) => call.includes("get_return_list")).length, 1);
    assert.equal(calls.filter((call) => call.includes("get_return_detail")).length, 11);
    assert.equal(second.continuation?.arguments.pageNo, 2);
    assert.equal(second.continuation?.arguments.returnQueue, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee return/refund normalization retains case evidence while excluding contact and address data", () => {
  const result: ChannelOperationResult = {
    ok: true,
    channel: "shopee",
    operation: "inquiries.list",
    safeMessage: "ok",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotProviderContext: { shopId: "1719148844", kind: "return_refund", returnSn: "RETURN1" },
        response: returnDetail("RETURN1"),
      },
    }],
  };
  const rows = normalizeChannelInquiries("shopee", result, "2026-09-08T03:00:00.000Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.externalTicketId, "shopee:return:1719148844:RETURN1");
  assert.equal(rows[0]?.ticketKind, "after_sales");
  assert.equal(rows[0]?.message, "포장이 파손됐어요");
  assert.equal(rows[0]?.externalOrderReference, "ORDER-RETURN-1");
  assert.equal(rows[0]?.providerContext.replySupported, false);
  assert.deepEqual(rows[0]?.replyContext, {});
  assert.deepEqual(rows[0]?.providerContext.nativeMedia, {
    images: ["https://example.test/return.jpg"],
    buyer_videos: [{ thumbnail_url: "https://example.test/thumb.jpg", video_url: "https://example.test/evidence.mp4" }],
  });
  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /private@example\.test|must not persist/);
});

test("Shopee return/refund rejects over-wide windows, repeated serials and mismatched details", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      return Response.json({ error: "", response: { return: [], more: false } });
    };
    await assert.rejects(executeChannelOperation({
      channel: "shopee", operation: "inquiries.list", payload, environment: "production",
      arguments: { kind: "return_refund", createTimeFrom: 1, createTimeTo: 15 * 86_400 + 2 },
    }), /SHOPEE_RETURN_WINDOW_INVALID/);
    assert.equal(providerCalls, 0);

    await assert.rejects(executeChannelOperation({
      channel: "shopee", operation: "inquiries.list", payload, environment: "production",
      arguments: {
        kind: "return_refund", createTimeFrom: 1, createTimeTo: 100,
        pageNo: 1, returnQueue: ["RETURN1", "RETURN1"], nextPageNo: 2,
      },
    }), /SHOPEE_RETURN_QUEUE_INVALID/);

    globalThis.fetch = async () => Response.json({ error: "", response: returnDetail("OTHER") });
    await assert.rejects(executeChannelOperation({
      channel: "shopee", operation: "inquiries.list", payload, environment: "production",
      arguments: {
        kind: "return_refund", createTimeFrom: 1, createTimeTo: 100,
        pageNo: 1, returnQueue: ["RETURN1"], nextPageNo: 2,
      },
    }), /SHOPEE_RETURN_DETAIL_MISMATCH/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee accepts the exact 15-day return boundary and rejects one second more", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ error: "", response: { return: [], more: false } });
  };
  try {
    const exact = await executeChannelOperation({
      channel: "shopee", operation: "inquiries.list", payload, environment: "production",
      arguments: { kind: "return_refund", createTimeFrom: 1, createTimeTo: 15 * 86_400 + 1 },
    });
    assert.equal(exact.ok, true);
    assert.equal(providerCalls, 1);
    await assert.rejects(executeChannelOperation({
      channel: "shopee", operation: "inquiries.list", payload, environment: "production",
      arguments: { kind: "return_refund", createTimeFrom: 1, createTimeTo: 15 * 86_400 + 2 },
    }), /SHOPEE_RETURN_WINDOW_INVALID/);
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee keeps the same comment ID isolated by shop and blocks a misbound reply before POST", async () => {
  const page = (shopId: string): ChannelOperationResult => ({
    ok: true,
    channel: "shopee",
    operation: "inquiries.list",
    safeMessage: "ok",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotProviderContext: { shopId },
        response: { item_comment_list: [{
          comment_id: 901,
          item_id: 902,
          buyer_username: "masked-buyer",
          comment: "fixture review",
          create_time: 1_788_000_000,
        }], more: false, next_cursor: "" },
      },
    }],
  });
  const first = normalizeChannelInquiries("shopee", page("1719148844"), "2026-09-08T03:00:00.000Z");
  const second = normalizeChannelInquiries("shopee", page("1758392145"), "2026-09-08T03:00:00.000Z");
  assert.equal(first[0]?.externalTicketId, "shopee:1719148844:901");
  assert.equal(second[0]?.externalTicketId, "shopee:1758392145:901");
  assert.notEqual(first[0]?.inboundKey, second[0]?.inboundKey);

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ error: "", response: { result_list: [] } });
  };
  try {
    await assert.rejects(executeChannelOperation({
      channel: "shopee",
      operation: "inquiries.reply",
      payload,
      arguments: {
        shopId: "1758392145",
        commentId: "901",
        itemId: "902",
        reply: "fixture reply",
      },
      environment: "production",
    }), /SHOPEE_COMMENT_REPLY_INVALID/);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("successful empty Shopee return discovery completes normalization without inventing a case", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.ok(url.pathname.endsWith("get_return_list"));
    return Response.json({ error: "", response: { return: [], more: false } });
  };
  try {
    const result = await executeChannelOperation({ channel: "shopee", operation: "inquiries.list", payload,
      arguments: { kind: "return_refund", createTimeFrom: 1_787_000_000, createTimeTo: 1_788_000_000 }, environment: "production" });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(result.continuation, undefined);
    assert.deepEqual(normalizeChannelInquiries("shopee", result, "2026-09-08T03:00:00.000Z"), []);
    const emptyData = result.steps[0].data;
    for (const data of [
      { ...emptyData, response: { more: false } },
      { ...emptyData, response: { return: [], more: true } },
      { ...emptyData, response: { return: [], more: null } },
      { ...emptyData, response: { return: [{}], more: false } },
      { ...emptyData, response: { return: [], more: false, return_sn: "RETURN1" } },
      { ...emptyData, sellerpilotProviderContext: { shopId: payload.shop_id, kind: "return_refund", returnSn: "RETURN1" } },
      { ...emptyData, sellerpilotProviderContext: { shopId: "", kind: "return_refund" } },
    ]) {
      assert.throws(() => normalizeChannelInquiries("shopee", { ...result, steps: [{ ...result.steps[0], data }] }, "2026-09-08T03:00:00.000Z"), /INQUIRY_RECORD_INVALID:shopee/);
    }
  } finally { globalThis.fetch = originalFetch; }
});
