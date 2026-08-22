import assert from "node:assert/strict";
import test from "node:test";
import { parseLazadaImPush } from "../lib/channels/lazada-im";

test("normalizes Lazada buyer IM push payloads", () => {
  assert.deepEqual(parseLazadaImPush({
    message_type: 2,
    timestamp: 1_787_340_000_000,
    data: {
      session_id: "session-1",
      message_id: "message-1",
      content: JSON.stringify({ txt: "배송일을 알려주세요" }),
      from_account_type: 1,
      send_time: 1_787_340_000_000,
      status: 0,
      site_id: "MY",
    },
  }), {
    externalTicketId: "lazada-im:session-1",
    customerName: "Lazada 고객",
    subject: "Lazada MY IM 문의",
    message: "배송일을 알려주세요",
    status: "waiting",
    priority: 3,
    receivedAt: new Date(1_787_340_000_000).toISOString(),
    remoteMessageId: "message-1",
  });
});

test("ignores seller messages and recalled Lazada messages", () => {
  const base = { session_id: "session-1", content: JSON.stringify({ txt: "hello" }), send_time: 1_787_340_000_000 };
  assert.equal(parseLazadaImPush({ data: { ...base, from_account_type: 2 } }), null);
  assert.equal(parseLazadaImPush({ data: { ...base, from_account_type: 1, status: 1 } }), null);
});
