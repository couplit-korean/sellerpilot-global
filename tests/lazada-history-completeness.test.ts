import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { lazadaImHistoryRawPages, normalizeLazadaImHistory, parseLazadaImPush } from "../lib/channels/lazada-im";

const nativeContentFingerprint = (nativeText: string, nativeMedia: unknown = null) => createHash("sha256")
  .update(JSON.stringify({ nativeText, nativeMedia }), "utf8").digest("hex");

const textMessage = { message_id: "message", from_account_type: 1, type: 1, status: 0, template_id: 1, content: { txt: "original" }, send_time: 1788600000000 };
const steps = (messages: unknown) => [{ name: "inquiries-message:session:1", ok: true,
  data: { sellerpilotSession: { session_id: "session" }, data: { message_list: messages } },
}];
test("Lazada historical reads fail visibly when any native event cannot be persisted", () => {
  for (const row of [
    { ...textMessage, template_id: 3, content: { imgUrl: "https://sg-live.slatic.net/fixture.png" } },
    { ...textMessage, status: 1 }, { ...textMessage, type: 2 },
    { ...textMessage, from_account_type: undefined }, { ...textMessage, message_id: undefined },
  ]) assert.throws(() => normalizeLazadaImHistory(steps([textMessage, row])), /LAZADA_HISTORY_MESSAGE_STORAGE_REQUIRED/);
});

test("a persisted Lazada history page normalizes rich events with safe media metadata", () => {
  const imageMessage = {
    ...textMessage,
    message_id: "image-message",
    template_id: 3,
    content: { imgUrl: "https://sg-live.slatic.net/fixture.png" },
  };
  const input = steps([textMessage, imageMessage]);
  const rawPages = lazadaImHistoryRawPages(input);
  assert.equal(rawPages.length, 1);
  assert.equal(rawPages[0].processingStatus, "normalized");
  assert.deepEqual(JSON.parse(rawPages[0].rawBody), input[0].data);

  const normalized = normalizeLazadaImHistory(input, undefined, { rawStorageReady: true });
  assert.deepEqual(normalized.map((message) => message.remoteMessageId), ["image-message", "message"]);
  const image = normalized.find((message) => message.remoteMessageId === "image-message");
  assert.equal(image?.message, "Lazada 이미지 메시지");
  assert.equal(image?.senderRole, "customer");
  assert.deepEqual(image?.providerContext, {
    nativeContentFingerprint: nativeContentFingerprint("", { imageUrl: "https://sg-live.slatic.net/fixture.png" }),
    eventKind: "image",
    messageStatus: 0,
    messageType: 1,
    templateId: 3,
    templateKind: "image",
    nativeMedia: { imageUrl: "https://sg-live.slatic.net/fixture.png" },
  });
});

test("persisted Lazada recall and unknown events remain explicit and never become buyer text", () => {
  const normalized = normalizeLazadaImHistory(steps([
    { ...textMessage, message_id: "recalled", status: 1 },
    { message_id: "unknown", status: 0, type: 1, template_id: 9999, send_time: 1788600000000, content: { translateTxt: "translated only" } },
  ]), undefined, { rawStorageReady: true });
  const recalled = normalized.find((message) => message.remoteMessageId === "recalled");
  const unknown = normalized.find((message) => message.remoteMessageId === "unknown");
  assert.match(recalled?.message ?? "", /^Lazada 발신자 회수/);
  assert.equal(recalled?.senderRole, "customer");
  assert.equal(unknown?.message, "Lazada 형식 확인이 필요한 메시지");
  assert.equal(unknown?.senderRole, "system");
  assert.equal(unknown?.status, "resolved");
});

test("official session history and undocumented templates never become replyable buyers", () => {
  const normalized = normalizeLazadaImHistory([{
    name: "inquiries-message:official:1",
    ok: true,
    data: {
      sellerpilotSession: { session_id: "official", tags: ["official"], site_id: "MY" },
      data: { message_list: [{
        ...textMessage,
        message_id: "official-message",
        template_id: 200016,
        content: { txt: "official notice" },
      }] },
    },
  }], undefined, { rawStorageReady: true });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].senderRole, "system");
  assert.equal(normalized[0].customerName, "Lazada 시스템");
  assert.equal(normalized[0].status, "resolved");
  assert.equal(normalized[0].providerContext?.roleBasis, "official_session_tag");
});

test("same Lazada identity converges on recall but body and attachment edits conflict", () => {
  const recalled = normalizeLazadaImHistory(steps([
    { ...textMessage, message_id: "same", content: { txt: "original" } },
    { ...textMessage, message_id: "same", status: 1, content: { txt: "original" } },
  ]), undefined, { rawStorageReady: true });
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].providerContext?.eventKind, "recalled");
  assert.equal(recalled[0].providerContext?.recallTargetMessageId, "same");
  assert.equal(recalled[0].orderingStatus, undefined);

  const reversed = normalizeLazadaImHistory(steps([
    { ...textMessage, message_id: "same", status: 1, content: { txt: "original" } },
    { ...textMessage, message_id: "same", content: { txt: "original" } },
  ]), undefined, { rawStorageReady: true });
  assert.equal(reversed.length, 1);
  assert.equal(reversed[0].providerContext?.eventKind, "recalled");

  const bodyEdit = normalizeLazadaImHistory(steps([
    { ...textMessage, message_id: "edited", content: { txt: "before" } },
    { ...textMessage, message_id: "edited", content: { txt: "after" } },
  ]), undefined, { rawStorageReady: true });
  assert.equal(bodyEdit.length, 2);
  assert.equal(bodyEdit.every((message) => message.orderingStatus === "conflict"), true);

  const changedRecall = normalizeLazadaImHistory(steps([
    { ...textMessage, message_id: "changed-recall", content: { txt: "before" } },
    { ...textMessage, message_id: "changed-recall", status: 1, content: { txt: "after" } },
  ]), undefined, { rawStorageReady: true });
  assert.equal(changedRecall.length, 2);
  assert.equal(changedRecall.every((message) => message.orderingStatus === "conflict"), true);

  const attachmentRecall = normalizeLazadaImHistory(steps([
    { ...textMessage, message_id: "attachment-recall", template_id: 3,
      content: { imgUrl: "https://sg-live.slatic.net/before.png" } },
    { ...textMessage, message_id: "attachment-recall", template_id: 3, status: 1,
      content: { imgUrl: "https://sg-live.slatic.net/after.png" } },
  ]), undefined, { rawStorageReady: true });
  assert.equal(attachmentRecall.length, 2);
  assert.equal(attachmentRecall.every((message) => message.orderingStatus === "conflict"), true);
});

test("same Lazada message identity with different rich media stays as separate conflict evidence", () => {
  const base = {
    message_id: "same-rich-id",
    from_account_type: 1,
    type: 1,
    status: 0,
    template_id: 3,
    send_time: 1788600000000,
  };
  const normalized = normalizeLazadaImHistory(steps([
    { ...base, content: { imgUrl: "https://sg-live.slatic.net/one.png" } },
    { ...base, content: { imgUrl: "https://sg-live.slatic.net/two.png" } },
  ]), undefined, { rawStorageReady: true });
  assert.equal(normalized.length, 2);
  assert.equal(normalized.every((message) => message.orderingStatus === "conflict"), true);
  assert.equal(new Set(normalized.map((message) =>
    JSON.stringify(message.providerContext?.nativeMedia))).size, 2);
});
test("a malformed page is not a successful empty history page", () => {
  for (const rows of [undefined, null, "", {}, [null], ["not-a-message"]]) {
    assert.throws(() => normalizeLazadaImHistory(steps(rows)), /LAZADA_HISTORY_MESSAGE_PAGE_INVALID/);
  }
  assert.deepEqual(normalizeLazadaImHistory(steps([])), []);
  assert.equal(normalizeLazadaImHistory(steps([textMessage]))[0].message, "original");
});

test("undated buyer history never becomes a new inquiry at collection time", () => {
  for (const send_time of [undefined, null, "", 0, false, {}, "invalid", "2026-02-30T01:00:00Z", "2026-09-07T01:00:00"]) {
    const input = steps([{ ...textMessage, send_time }]);
    const original = structuredClone(input);
    for (const collectionTime of ["2026-09-07T01:00:00Z", "2026-09-08T01:00:00Z"]) {
      const [buyer] = normalizeLazadaImHistory(input, collectionTime);
      assert.equal(buyer.receivedAt, "");
      assert.equal(buyer.orderingStatus, "unverified");
      assert.equal(buyer.senderRole, "customer");
      assert.equal(buyer.customerName, "Lazada 고객");
      assert.equal(buyer.message, "original");
    }
    assert.deepEqual(input, original);
  }
});

test("push delivery and session timestamps cannot substitute for native buyer send time", () => {
  const data = { ...textMessage, session_id: "session", send_time: undefined, last_message_time: 1788600000000 };
  for (const timestamp of [undefined, 1788600000000, 1788686400000]) {
    const undated = parseLazadaImPush({ timestamp, data });
    assert.equal(undated?.receivedAt, "");
    assert.equal(undated?.orderingStatus, "unverified");
    assert.notEqual(undated?.senderRole, "seller");
    const dated = parseLazadaImPush({ timestamp, data: { ...data, send_time: 1788600000000 } });
    assert.equal(dated?.receivedAt, new Date(1788600000000).toISOString());
    assert.equal(dated?.message, "original");
  }
});
