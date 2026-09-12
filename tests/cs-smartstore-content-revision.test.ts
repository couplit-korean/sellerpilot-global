import assert from "node:assert/strict";
import test from "node:test";
import { smartstoreBuyerContentRevision } from "../lib/channels/cs/smartstore/content-revision.ts";

test("identical SmartStore buyer-message replays retain one content revision", () => {
  const body = "  배송은 언제 시작되나요?\n";
  const first = smartstoreBuyerContentRevision(body);
  const replay = smartstoreBuyerContentRevision(body);

  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(replay, first);
});

test("a material buyer-text edit changes the SmartStore content revision", () => {
  const before = smartstoreBuyerContentRevision("배송은 언제 시작되나요?");
  const after = smartstoreBuyerContentRevision("배송지를 변경한 뒤 언제 시작되나요?");

  assert.notEqual(after, before);
});

test("content revision keeps exact provider text bytes and rejects unusable bodies", () => {
  assert.notEqual(
    smartstoreBuyerContentRevision("문의 내용"),
    smartstoreBuyerContentRevision("문의 내용\n"),
  );
  for (const invalid of [undefined, null, 1, "", "   ", "x".repeat(20001)]) {
    assert.throws(
      () => smartstoreBuyerContentRevision(invalid),
      /SMARTSTORE_BUYER_CONTENT_REVISION_INVALID/,
    );
  }
});
