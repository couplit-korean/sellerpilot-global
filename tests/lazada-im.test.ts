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

test("records identified seller messages and ignores unidentified or recalled Lazada messages", () => {
  const base = { session_id: "session-1", content: JSON.stringify({ txt: "hello" }), send_time: 1_787_340_000_000 };
  assert.equal(parseLazadaImPush({ data: { ...base, from_account_type: 2 } }), null);
  assert.deepEqual(parseLazadaImPush({ data: { ...base, message_id: "seller-1", from_account_type: 2 } }), {
    externalTicketId: "lazada-im:session-1",
    customerName: "Lazada 고객",
    subject: "Lazada IM 문의",
    message: "hello",
    status: "resolved",
    priority: 3,
    receivedAt: new Date(1_787_340_000_000).toISOString(),
    remoteMessageId: "seller-1",
    senderRole: "seller",
  });
  assert.equal(parseLazadaImPush({ data: { ...base, from_account_type: 1, status: 1 } }), null);
});


test("Lazada seller push cannot use collection or envelope time as message send time", () => {
  const payload = {
    timestamp: 1788600000000,
    data: { session_id: "session-1", message_id: "seller-unknown-time", from_account_type: 2, content: { txt: "original seller body" } },
  };
  const original = structuredClone(payload);
  const inquiry = parseLazadaImPush(payload)!;
  assert.equal(inquiry.orderingStatus, "unverified");
  assert.equal(inquiry.receivedAt, "");
  assert.equal(inquiry.status, "waiting");
  assert.equal(inquiry.message, "original seller body");
  assert.deepEqual(payload, original);
});
