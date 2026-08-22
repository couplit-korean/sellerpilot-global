import assert from "node:assert/strict";
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
