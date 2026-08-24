import assert from "node:assert/strict";
import test from "node:test";
import {
  csChannelVerification,
  csReplyDraftValue,
  csReplySavePlan,
  selectedCsTicket,
  withCsReplyDraft,
  type CsReplyDrafts,
} from "../app/cs-release-state";

test("reply drafts remain scoped to their source ticket across filter and tab selection changes", () => {
  const ticketA = { sourceId: "ticket-a", replyDraft: "A 서버 초안" };
  const ticketB = { sourceId: "ticket-b", replyDraft: "B 서버 초안" };
  let drafts: CsReplyDrafts = {};

  assert.equal(csReplyDraftValue(drafts, ticketA), "A 서버 초안");
  drafts = withCsReplyDraft(drafts, ticketA, "A 미저장 초안");
  assert.equal(csReplyDraftValue(drafts, ticketB), "B 서버 초안");

  drafts = withCsReplyDraft(drafts, ticketB, "B 미저장 초안");
  assert.equal(csReplyDraftValue(drafts, ticketA), "A 미저장 초안");
  assert.equal(csReplyDraftValue(drafts, ticketB), "B 미저장 초안");
  assert.equal(csReplyDraftValue(drafts, null), "");
});

test("ticket selection uses the internal source id even when external ticket ids collide", () => {
  const tickets = [
    { sourceId: "source-a", id: "same-external-id" },
    { sourceId: "source-b", id: "same-external-id" },
  ];
  assert.equal(selectedCsTicket(tickets, "source-b")?.sourceId, "source-b");
  assert.equal(selectedCsTicket(tickets, "missing")?.sourceId, "source-a");
  assert.equal(selectedCsTicket([], "source-a"), null);
});

test("only Lazada uses remote reply while every other channel saves an in-progress internal draft", () => {
  assert.deepEqual(csReplySavePlan("ticket-l", "lazada", "reply"), {
    endpoint: "/api/admin/cs/lazada-reply",
    body: { ticketId: "ticket-l", reply: "reply" },
    completionMessage: "Lazada IM에 답변을 전송하고 처리 완료로 기록했습니다.",
    remote: true,
  });
  assert.deepEqual(csReplySavePlan("ticket-q", "qoo10", "draft"), {
    endpoint: "/api/operations/snapshot",
    body: { action: "ticket_update", id: "ticket-q", status: "in_progress", replyDraft: "draft" },
    completionMessage: "외부 채널에는 전송하지 않았습니다. 내부 답변 초안을 처리 중 상태로 저장했습니다.",
    remote: false,
  });
});

test("channel verification separates inquiry receiving from remote reply capability", () => {
  assert.deepEqual(csChannelVerification("qoo10", "passed"), {
    readLabel: "상품 문의 수신 확인",
    replyLabel: "답변: 내부 초안만 · 판매자센터 전송 필요",
    badge: "수신 확인",
    tone: "passed",
  });
  assert.equal(csChannelVerification("qoo10", "queued").badge, "수신 대기");
  assert.equal(csChannelVerification("qoo10", "queued").tone, "unsupported");
  assert.match(csChannelVerification("shopee", null).readLabel, /API 미연동/);
  assert.match(csChannelVerification("lazada", "passed").replyLabel, /앱 권한 필요/);
  assert.match(csChannelVerification("temu", "passed").readLabel, /반품·환불 작업/);
  assert.match(csChannelVerification("elevenst", "unsupported").replyLabel, /API 미지원/);
});
