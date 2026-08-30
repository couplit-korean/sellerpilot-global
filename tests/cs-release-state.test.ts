import assert from "node:assert/strict";
import test from "node:test";
import {
  csChannelVerification,
  csReplyDraftValue,
  csReplySavePlan,
  isRemoteCsReplyChannel,
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
  assert.equal(selectedCsTicket(tickets, null)?.sourceId, "source-a");
  assert.equal(selectedCsTicket(tickets, "missing"), null);
  assert.equal(selectedCsTicket([], "source-a"), null);
});

test("server-gated marketplace reply channels use one gateway while unsupported channels keep internal drafts", () => {
  for (const channel of ["qoo10", "lazada", "coupang", "smartstore", "ebay"]) {
    assert.equal(isRemoteCsReplyChannel(channel), true);
    assert.deepEqual(csReplySavePlan(`ticket-${channel}`, channel, "reply", `inbound-${channel}`), {
      endpoint: "/api/admin/cs/reply",
      body: { ticketId: `ticket-${channel}`, expectedInboundKey: `inbound-${channel}`, reply: "reply" },
      completionMessage: "판매채널에 답변을 전송하고 처리 완료로 기록했습니다.",
      remote: true,
    });
  }
  for (const channel of ["shopee", "elevenst", "temu"]) {
    assert.equal(isRemoteCsReplyChannel(channel), false);
  }
  assert.deepEqual(csReplySavePlan("ticket-s", "shopee", "draft", null), {
    endpoint: "/api/operations/snapshot",
    body: { action: "ticket_update", id: "ticket-s", status: "in_progress", expectedInboundKey: null, replyDraft: "draft" },
    completionMessage: "외부 채널에는 전송하지 않았습니다. 내부 답변 초안을 처리 중 상태로 저장했습니다.",
    remote: false,
  });
  assert.throws(
    () => csReplySavePlan("ticket-l", "lazada", "reply", null),
    /문의 세대를 확인/,
  );
});

test("channel verification separates inquiry receiving from remote reply capability", () => {
  assert.deepEqual(csChannelVerification("qoo10", "passed", 0), {
    readLabel: "상품 문의 최근 조회 작업 통과 · 누적 원장 0건",
    replyLabel: "답변: 보안 게이트웨이 원격 전송",
    badge: "최근 조회 통과",
    tone: "passed",
  });
  assert.equal(csChannelVerification("qoo10", "queued").badge, "조회 대기");
  assert.equal(csChannelVerification("qoo10", "queued").tone, "unsupported");
  assert.match(csChannelVerification("shopee", null).readLabel, /API 미연동/);
  assert.match(csChannelVerification("lazada", "passed").replyLabel, /보안 게이트웨이/);
  assert.match(csChannelVerification("temu", "passed").readLabel, /반품·환불 작업/);
  assert.match(csChannelVerification("elevenst", "unsupported").readLabel, /상품 Q&A·긴급알리미 수신 연동 전/);
  assert.match(csChannelVerification("elevenst", "unsupported").replyLabel, /상세 계약·서비스 권한 검증 전/);
  assert.equal(csChannelVerification("elevenst", "passed", 3).badge, "수신 미연결");
  assert.deepEqual(csChannelVerification("lazada", "failed", 0, "App does not have permission to access this api"), {
    readLabel: "Lazada IM 조회 거절 · 운영 앱 Buyer IM 권한 필요",
    replyLabel: "답변: 보안 게이트웨이 원격 전송",
    badge: "권한 필요",
    tone: "failed",
  });
});
