import assert from "node:assert/strict";
import test from "node:test";
import {
  csChannelAttentionCount,
  csChannelHistoryCoverageLabel,
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
  for (const channel of ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay"]) {
    assert.equal(isRemoteCsReplyChannel(channel), true);
    assert.deepEqual(csReplySavePlan(`ticket-${channel}`, channel, "reply", `inbound-${channel}`), {
      endpoint: "/api/admin/cs/reply",
      body: { ticketId: `ticket-${channel}`, expectedInboundKey: `inbound-${channel}`, reply: "reply" },
      completionMessage: "판매채널에 답변을 전송하고 처리 완료로 기록했습니다.",
      remote: true,
    });
  }
  for (const channel of ["temu"]) {
    assert.equal(isRemoteCsReplyChannel(channel), false);
  }
  assert.throws(() => csReplySavePlan("ticket-s", "shopee", "draft", null), /문의 세대/);
  assert.throws(
    () => csReplySavePlan("ticket-l", "lazada", "reply", null),
    /문의 세대를 확인/,
  );
});

test("channel verification separates inquiry receiving from remote reply capability", () => {
  const now = new Date("2026-09-07T07:00:00.000Z");
  assert.deepEqual(csChannelVerification("qoo10", "passed", 0, null, "2026-09-07T06:50:00.000Z", now), {
    readLabel: "MSG·HELP·ITEM 문의·취소·반품·교환 클레임 최근 조회 작업 통과 · 누적 원장 0건",
    replyLabel: "답변: 일반 문의만 보안 게이트웨이 원격 전송 · 클레임은 읽기 전용 · 별도 리뷰 댓글은 공식 QAPI 미제공",
    badge: "최근 조회 통과",
    tone: "passed",
  });
  assert.equal(csChannelVerification("qoo10", "passed", 0, null, null, now).badge, "시각 확인 필요");
  assert.equal(csChannelVerification("qoo10", "passed", 0, null, "2026-09-07T06:44:59.999Z", now).badge, "수집 지연");
  assert.equal(csChannelVerification("qoo10", "passed", 0, null, "2026-09-07T07:06:00.000Z", now).badge, "수집 지연");
  assert.equal(csChannelVerification("lazada", "passed", 0, null, "2026-09-07T06:59:00.000Z", now).badge, "Push 확인 필요");
  assert.equal(csChannelVerification("qoo10", "queued").badge, "조회 대기");
  assert.equal(csChannelVerification("qoo10", "queued").tone, "unsupported");
  assert.match(csChannelVerification("shopee", null).readLabel, /검증 전/);
  assert.match(csChannelVerification("lazada", "passed").replyLabel, /보안 게이트웨이/);
  assert.equal(csChannelVerification("lazada", "unsupported").badge, "연결 확인 필요");
  assert.match(csChannelVerification("lazada", "unsupported").readLabel, /연결 조건 미충족/);
  assert.match(csChannelVerification("temu", "passed").readLabel, /반품·환불 작업/);
  assert.match(csChannelVerification("elevenst", "unsupported").readLabel, /상품 Q&A 수신 연결 조건 미충족/);
  assert.match(csChannelVerification("elevenst", "unsupported").replyLabel, /게시글 번호·상품 번호/);
  assert.equal(csChannelVerification("elevenst", "passed", 3, null, "2026-09-07T06:59:00.000Z", now).badge, "최근 조회 통과");
  assert.deepEqual(csChannelVerification("lazada", "failed", 0, "App does not have permission to access this api"), {
    readLabel: "Lazada IM 조회 거절 · 운영 앱 Buyer IM 권한 필요",
    replyLabel: "답변: 보안 게이트웨이 원격 전송",
    badge: "권한 필요",
    tone: "failed",
  });
  assert.match(csChannelHistoryCoverageLabel("coupang"), /6일 이하 5개 창/);
  assert.match(csChannelHistoryCoverageLabel("coupang"), /취소·반품·교환/);
  assert.match(csChannelHistoryCoverageLabel("shopee"), /8개 OAuth 숍/);
  assert.match(csChannelHistoryCoverageLabel("shopee"), /반품\/환불 15일 이하 분할 조회/);
  assert.match(csChannelHistoryCoverageLabel("shopee"), /Buyer Chat 공개 API 계약 미확보/);
  assert.doesNotMatch(csChannelHistoryCoverageLabel("shopee"), /Open API 없음/);
  assert.match(csChannelHistoryCoverageLabel("ebay"), /Trading Inbox 최근 6일 자동 조회/);
  assert.match(csChannelHistoryCoverageLabel("ebay"), /Commerce 회원 대화 최근 6일 자동 조회/);
  assert.match(csChannelHistoryCoverageLabel("ebay"), /commerce\.message 동의 필요/);
  assert.match(csChannelHistoryCoverageLabel("elevenst"), /최대 7일/);
  assert.match(csChannelHistoryCoverageLabel("elevenst"), /셀러톡·긴급알리미·리뷰는 별도/);
});

test("CS attention count deduplicates channels and includes blocked or unverified outcomes", () => {
  const now = new Date("2026-09-07T07:00:00.000Z");
  assert.equal(csChannelAttentionCount([
    { channelKey: "qoo10", status: "passed", lastSucceededAt: "2026-09-07T06:55:00.000Z" },
    { channelKey: "qoo10", status: "failed" },
    { channelKey: "lazada", status: "unsupported" },
    { channelKey: "coupang", status: "passed", lastSucceededAt: "2026-09-07T06:55:00.000Z", needsAttention: true },
    { channelKey: "temu", status: null },
  ], now), 4);
});
