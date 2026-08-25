import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeLazadaImHistory } from "../lib/channels/lazada-im";
import { executeChannelOperation } from "../lib/channels/operations";

test("Lazada one-time IM bootstrap fetches sessions and normalizes buyer messages", async () => {
  const originalFetch = globalThis.fetch;
  const calledPaths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
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
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
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
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: {},
      environment: "production",
    }),
    /CHANNEL_ARGUMENT_REQUIRED:bootstrap/,
  );
});

test("Lazada IM follows string cursors and keeps the latest buyer message per session", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
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
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: { bootstrap: true, startTime: 3_000, pageSize: 20, sessionLimit: 20, messageLimit: 100 },
      environment: "production",
    });
    const normalized = normalizeLazadaImHistory(result.steps);
    assert.equal(result.ok, true);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/im/session/list")).length, 2);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/im/message/list")).length, 3);
    assert.equal(calls.some((url) => url.searchParams.get("last_session_id") === "session-1"), true);
    assert.equal(calls.some((url) => url.searchParams.get("last_message_id") === "message-new"), true);
    assert.equal(normalized.length, 2);
    assert.equal(normalized.find((item) => item.externalTicketId === "lazada-im:session-1")?.message, "최신 문의");
    assert.equal(normalized.find((item) => item.externalTicketId === "lazada-im:session-1")?.remoteMessageId, "message-new");
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
