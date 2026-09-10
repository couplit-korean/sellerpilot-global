import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseLazadaImPush } from "../lib/channels/lazada-im";

const nativeContentFingerprint = (nativeText: string, nativeMedia: unknown = null) => createHash("sha256")
  .update(JSON.stringify({ nativeText, nativeMedia }), "utf8").digest("hex");

test("normalizes Lazada buyer IM push payloads", () => {
  assert.deepEqual(parseLazadaImPush({
    message_type: 2,
    timestamp: 1_787_340_000_000,
    data: {
      session_id: "session-1",
      message_id: "message-1",
      content: JSON.stringify({ txt: "배송일을 알려주세요" }),
      from_account_type: 1,
      type: 1,
      template_id: 1,
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
    providerContext: { nativeContentFingerprint: nativeContentFingerprint("배송일을 알려주세요") },
  });
});

test("records identified seller messages and refuses messages without native identity", () => {
  const base = { session_id: "session-1", content: JSON.stringify({ txt: "hello" }), send_time: 1_787_340_000_000, status: 0, type: 1, template_id: 1 };
  assert.equal(parseLazadaImPush({ data: { ...base, from_account_type: 2 } }), null);
  assert.deepEqual(parseLazadaImPush({ data: { ...base, message_id: "seller-1", from_account_type: 2 } }), {
    externalTicketId: "lazada-im:session-1",
    customerName: "Lazada 판매자",
    subject: "Lazada IM 문의",
    message: "hello",
    status: "resolved",
    priority: 3,
    receivedAt: new Date(1_787_340_000_000).toISOString(),
    remoteMessageId: "seller-1",
    senderRole: "seller",
    providerContext: { nativeContentFingerprint: nativeContentFingerprint("hello") },
  });
  assert.equal(parseLazadaImPush({ data: { ...base, from_account_type: 1, status: 1 } }), null);
});


test("Lazada seller push cannot use collection or envelope time as message send time", () => {
  const payload = {
    timestamp: 1788600000000,
    data: { session_id: "session-1", message_id: "seller-unknown-time", from_account_type: 2, status: 0, type: 1, template_id: 1, content: { txt: "original seller body" } },
  };
  const original = structuredClone(payload);
  const inquiry = parseLazadaImPush(payload)!;
  assert.equal(inquiry.orderingStatus, "unverified");
  assert.equal(inquiry.receivedAt, "");
  assert.equal(inquiry.status, "waiting");
  assert.equal(inquiry.message, "original seller body");
  assert.deepEqual(payload, original);
});

test("Lazada blocked delivery is retained unordered and never resolves the conversation", () => {
  const inquiry = parseLazadaImPush({ data: {
    session_id: "session-1", message_id: "blocked-seller", from_account_type: 2,
    type: 1, status: 0, send_time: 1788600000000,
    process_msg: "message not sent", content: { txt: "  original blocked reply\n" },
  } })!;
  assert.equal(inquiry.message, "Lazada 전달 차단 ·   original blocked reply\n");
  assert.equal(inquiry.senderRole, "seller");
  assert.equal(inquiry.status, "waiting");
  assert.equal(inquiry.receivedAt, "");
  assert.equal(inquiry.orderingStatus, "unverified");
});

test("Lazada represents untrusted sender and system events without inferring a buyer", () => {
  const base = { session_id: "session-1", message_id: "unknown", from_account_type: 1, status: 0, type: 1, template_id: 1, content: { txt: "original" } };
  const missingSender = parseLazadaImPush({ data: { ...base, from_account_type: undefined } });
  assert.equal(missingSender?.senderRole, "system");
  assert.equal(missingSender?.customerName, "Lazada 시스템");
  const system = parseLazadaImPush({ data: { ...base, type: 2 } });
  assert.equal(system?.senderRole, "system");
  assert.equal(system?.providerContext?.eventKind, "system");
  const translatedOnly = parseLazadaImPush({ data: { ...base, content: { translateTxt: "translated only" } } });
  assert.equal(translatedOnly?.senderRole, "system");
  assert.equal(translatedOnly?.message, "Lazada 알 수 없는 메시지 이벤트");
  const unknownStatus = parseLazadaImPush({ data: { ...base, status: 7 } });
  assert.equal(unknownStatus?.senderRole, "customer");
  assert.equal(unknownStatus?.status, "waiting");
  assert.match(unknownStatus?.message ?? "", /^Lazada 상태 의미 확인 필요/);
  const recalled = parseLazadaImPush({ data: { ...base, message_id: "recalled", status: 1 } });
  assert.equal(recalled?.status, "waiting");
  assert.equal(recalled?.providerContext?.eventKind, "recalled");
  assert.equal(recalled?.providerContext?.recallTargetMessageId, "recalled");
  const unknownTemplate = parseLazadaImPush({ data: {
    ...base, message_id: "future", template_id: 200016, send_time: 1_788_200_000_000,
  } });
  assert.equal(unknownTemplate?.senderRole, "system");
  assert.equal(unknownTemplate?.status, "resolved");
  assert.equal(unknownTemplate?.providerContext?.roleBasis, "unknown_template");
});

test("Lazada official sessions remain system events even when account type says buyer", () => {
  const inquiry = parseLazadaImPush({ tags: ["official"], data: {
    session_id: "official-session", message_id: "official-message", from_account_type: 1,
    status: 0, type: 1, template_id: 1, send_time: 1_788_200_000_000,
    content: { txt: "official notice" },
  } })!;
  assert.equal(inquiry.senderRole, "system");
  assert.equal(inquiry.customerName, "Lazada 시스템");
  assert.equal(inquiry.status, "resolved");
  assert.equal(inquiry.providerContext?.roleBasis, "official_session_tag");

  const seller = parseLazadaImPush({ tags: ["official"], data: {
    session_id: "official-session", message_id: "seller-message", from_account_type: 2,
    status: 0, type: 1, template_id: 1, send_time: 1_788_200_000_000,
    content: { txt: "seller reply" },
  } })!;
  assert.equal(seller.senderRole, "seller");
  assert.equal(seller.customerName, "Lazada 판매자");
  assert.equal(seller.status, "resolved");
});

test("delivery envelope UUID cannot stand in for the native IM message identity", () => {
  assert.equal(parseLazadaImPush({ uuid: "delivery-envelope-id", data: {
    session_id: "session", from_account_type: 1, content: { txt: "original" }, send_time: 1788600000000,
  } }), null);
});

test("media, cards and automatic messages retain caption, type and safe media", () => {
  const templateKinds = new Map<number, string>([
    [2, "system_text"], [3, "image"], [4, "emoji"], [6, "video"],
    [10006, "item_card"], [10007, "order_card"], [10008, "voucher_card"],
    [10010, "follow_invitation"], [10011, "refund_order_card"], [10015, "auto_reply"],
  ]);
  for (const [template_id, templateKind] of templateKinds) {
    const inquiry = parseLazadaImPush({ data: { session_id: "session", message_id: "message", from_account_type: 1,
      content: { txt: "caption", imgUrl: "https://sg-live.slatic.net/fixture.png" }, template_id, send_time: 1788600000000,
      status: 0, type: 1,
    } });
    assert.equal(inquiry?.message, "caption");
    assert.equal(inquiry?.senderRole, [2, 10015].includes(template_id) ? "system" : "customer");
    if (template_id === 10015) assert.equal(inquiry?.status, "resolved");
    assert.equal(inquiry?.providerContext?.eventKind, "image");
    assert.equal(inquiry?.providerContext?.templateKind, templateKind);
    assert.deepEqual(inquiry?.providerContext?.nativeMedia, { imageUrl: "https://sg-live.slatic.net/fixture.png" });
  }
  const unsafe = parseLazadaImPush({ data: {
    session_id: "session",
    message_id: "unsafe-media",
    from_account_type: 1,
    content: { imgUrl: "http://user:secret@example.test/fixture.png" },
    template_id: 3,
    status: 0,
    type: 1,
    send_time: 1788600000000,
  } });
  assert.equal(unsafe?.providerContext?.nativeMedia, undefined);
});
