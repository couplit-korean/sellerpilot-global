import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeLazadaImHistory } from "../lib/channels/lazada-im";
import { executeChannelOperation } from "../lib/channels/operations";

const lazadaCommerceCredentials = {
  app_key: "commerce-app-key",
  app_secret: "commerce-app-secret",
  access_token: "commerce-access-token",
  country: "my",
} as const;

const lazadaImOverlay = {
  im_app_key: "im-app-key",
  im_app_secret: "im-app-secret",
  im_access_token: "im-access-token",
} as const;

const lazadaDualAppPayload = {
  ...lazadaCommerceCredentials,
  ...lazadaImOverlay,
};

function assertLazadaImRequestParams(params: URLSearchParams) {
  assert.equal(params.get("app_key"), lazadaImOverlay.im_app_key);
  assert.equal(params.get("access_token"), lazadaImOverlay.im_access_token);
  assert.notEqual(params.get("app_key"), lazadaCommerceCredentials.app_key);
  assert.notEqual(params.get("access_token"), lazadaCommerceCredentials.access_token);
}

test("Lazada one-time IM bootstrap fetches sessions and normalizes buyer messages", async () => {
  const originalFetch = globalThis.fetch;
  const calledPaths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assertLazadaImRequestParams(url.searchParams);
    calledPaths.push(url.pathname);
    if (url.pathname.endsWith("/im/session/list")) {
      return Response.json({
        code: "0",
        data: {
          has_more: false,
          session_list: [{
            session_id: "session-1",
            summary: "배송일을 알려주세요",
            title: "buyer-one",
            site_id: "MY",
            unread_count: 1,
            last_message_time: 1_787_340_000_000,
          }],
        },
      });
    }
    return Response.json({
      code: "0",
      data: {
        message_list: [{
          session_id: "session-1",
          message_id: "message-1",
          content: JSON.stringify({ txt: "배송일을 알려주세요" }),
          from_account_type: 1,
          send_time: 1_787_340_000_000,
          status: 0,
        }],
      },
    });
  };

  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "inquiries.list",
      payload: lazadaDualAppPayload,
      arguments: { bootstrap: true, startTime: 1_787_340_100_000, pageSize: 20, sessionLimit: 20 },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calledPaths, ["/rest/im/session/list", "/rest/im/message/list"]);
    assert.deepEqual(normalizeLazadaImHistory(result.steps), [{
      externalTicketId: "lazada-im:session-1",
      customerName: "buyer-one",
      subject: "Lazada MY IM 문의",
      message: "배송일을 알려주세요",
      status: "waiting",
      priority: 2,
      receivedAt: new Date(1_787_340_000_000).toISOString(),
      remoteMessageId: "message-1",
      senderRole: "customer",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada IM history cannot be turned into a periodic poll", async () => {
  await assert.rejects(
    executeChannelOperation({
      channel: "lazada",
      operation: "inquiries.list",
      payload: lazadaDualAppPayload,
      arguments: {},
      environment: "production",
    }),
    /CHANNEL_ARGUMENT_REQUIRED:bootstrap/,
  );
});

test("Lazada unread state does not masquerade as an answer", () => {
  const session = { session_id: "session-read", title: "buyer", site_id: "MY", unread_count: 0 };
  const buyer = { message_id: "buyer-1", content: JSON.stringify({ txt: "읽은 고객 문의" }), from_account_type: 1, send_time: 1000, status: 0 };
  const waiting = normalizeLazadaImHistory([{
    name: "inquiries-message:session-read:1", data: { sellerpilotSession: session, data: { message_list: [buyer] } },
  }]);
  assert.equal(waiting[0]?.status, "waiting");
  const answered = normalizeLazadaImHistory([{
    name: "inquiries-message:session-read:1", data: { sellerpilotSession: session, data: { message_list: [
      buyer,
      { message_id: "seller-1", content: JSON.stringify({ txt: "판매자 답변" }), from_account_type: 2, send_time: 1001, status: 0 },
    ] } },
  }]);
  assert.equal(answered.length, 2);
  assert.equal(answered[0]?.status, "waiting");
  assert.equal(answered[1]?.status, "resolved");
  assert.equal(answered[1]?.senderRole, "seller");
  assert.equal(answered[1]?.remoteMessageId, "seller-1");
  assert.equal(answered[0]?.message, "읽은 고객 문의");
  assert.equal(answered[0]?.remoteMessageId, "buyer-1");
});

test("Lazada IM follows string cursors and keeps every buyer message per session", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assertLazadaImRequestParams(url.searchParams);
    calls.push(url);
    if (url.pathname.endsWith("/im/session/list")) {
      if (!url.searchParams.has("last_session_id")) {
        return Response.json({ code: "0", data: {
          has_more: "true",
          next_start_time: "2000",
          last_session_id: "session-1",
          session_list: [{ session_id: "session-1", title: "buyer-one", site_id: "MY", unread_count: "2", last_message_time: "3000" }],
        } });
      }
      return Response.json({ code: "0", data: {
        has_more: "false",
        session_list: [{ session_id: "session-2", title: "buyer-two", site_id: "SG", unread_count: "1", last_message_time: "2500" }],
      } });
    }
    const sessionId = url.searchParams.get("session_id");
    if (sessionId === "session-1" && !url.searchParams.has("last_message_id")) {
      return Response.json({ code: "0", data: {
        has_more: "true",
        next_start_time: "1900",
        last_message_id: "message-new",
        message_list: [{ message_id: "message-new", content: JSON.stringify({ txt: "최신 문의" }), from_account_type: "1", send_time: "3000", status: "0" }],
      } });
    }
    if (sessionId === "session-1") {
      return Response.json({ code: "0", data: {
        has_more: "false",
        message_list: [{ message_id: "message-old", content: JSON.stringify({ txt: "이전 문의" }), from_account_type: "1", send_time: "1000", status: "0" }],
      } });
    }
    return Response.json({ code: "0", data: {
      has_more: "false",
      message_list: [{ message_id: "message-two", content: JSON.stringify({ txt: "두 번째 세션" }), from_account_type: "1", send_time: "2500", status: "0" }],
    } });
  };

  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "inquiries.list",
      payload: lazadaDualAppPayload,
      arguments: { bootstrap: true, startTime: 3_000, pageSize: 20, sessionLimit: 20, messageLimit: 100 },
      environment: "production",
    });
    const normalized = normalizeLazadaImHistory(result.steps);
    assert.equal(result.ok, true);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/im/session/list")).length, 2);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/im/message/list")).length, 3);
    assert.equal(calls.some((url) => url.searchParams.get("last_session_id") === "session-1"), true);
    assert.equal(calls.some((url) => url.searchParams.get("last_message_id") === "message-new"), true);
    assert.equal(normalized.length, 3);
    const sessionHistory = normalized.filter((item) => item.externalTicketId === "lazada-im:session-1");
    assert.deepEqual(sessionHistory.map((item) => item.remoteMessageId), ["message-old", "message-new"]);
    assert.deepEqual(sessionHistory.map((item) => item.message), ["이전 문의", "최신 문의"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada IM and Temu after-sales sync use the fixed-egress channel gateway", async () => {
  const route = await readFile(new URL("../app/api/operations/sync/route.ts", import.meta.url), "utf8");
  assert.match(route, /gatewayChannels = new Set<ActiveChannelKey>\(\[.*"lazada".*"temu"/);
  assert.equal((route.match(/gatewayChannels\.has\(channel\)/g) ?? []).length, 2);
  assert.match(route, /p_operation: "inquiries\.list"/);
});


test("Lazada history marks unsequenced seller events for quarantine without losing confirmed buyers", () => {
  for (const sendTime of [undefined, null, "", " ", 0, "0", -1, "-1", false, true, {}, "invalid", "2026-09-05T09:01:00", "2026-02-30T09:01:00Z"]) {
    const steps = [{ name: "inquiries-message:s:1", data: {
      sellerpilotSession: { session_id: "s", last_message_time: 1788600000000 },
      data: { message_list: [
        { message_id: "buyer-new", from_account_type: 1, send_time: "2026-09-05T09:02:00Z", content: { txt: "new buyer" } },
        { message_id: "seller-old", from_account_type: 2, send_time: sendTime, content: { txt: "original seller body" } },
      ] },
    } }];
    const original = structuredClone(steps);
    const normalized = normalizeLazadaImHistory(steps, "2026-09-05T10:00:00.000Z");
    assert.equal(normalized.length, 2);
    const seller = normalized.find(row => row.senderRole === "seller")!;
    assert.equal(seller.receivedAt, "");
    assert.equal(seller.orderingStatus, "unverified");
    assert.equal(seller.status, "waiting");
    assert.equal(seller.message, "original seller body");
    assert.deepEqual(steps, original);
  }
});

test("Lazada seller-only history is quarantinable without inventing a buyer", () => {
  const steps = [{ name: "inquiries-message:s:1", data: {
    sellerpilotSession: { session_id: "s" },
    data: { message_list: [{ message_id: "seller-only", from_account_type: 2, content: { txt: "original" } }] },
  } }];
  const [seller] = normalizeLazadaImHistory(steps);
  assert.equal(seller.orderingStatus, "unverified");
  assert.equal(seller.receivedAt, "");
  assert.equal(seller.message, "original");
});
