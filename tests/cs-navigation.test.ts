import assert from "node:assert/strict";
import test from "node:test";
import {
  csChannelFilterFromValue,
  csNavigationParams,
  csStatusFilterFromValue,
  csTicketMatchesFilter,
} from "../app/cs-navigation";

const waiting = { status: "답변 대기" as const, replyDeliveryStatus: null };
const urgent = { status: "긴급" as const, replyDeliveryStatus: null };
const progressing = { status: "처리 중" as const, replyDeliveryStatus: null };
const resolved = { status: "처리 완료" as const, replyDeliveryStatus: "succeeded" };
const uncertain = { status: "처리 중" as const, replyDeliveryStatus: "reconciliation_required" };

test("CS URL filters reject unknown channels and statuses", () => {
  assert.equal(csChannelFilterFromValue("lazada"), "lazada");
  assert.equal(csChannelFilterFromValue("unknown"), "all");
  assert.equal(csStatusFilterFromValue("resolved"), "resolved");
  assert.equal(csStatusFilterFromValue("unknown"), "open");
});

test("CS filters keep open, resolved, urgent and reconciliation queues distinct", () => {
  assert.equal(csTicketMatchesFilter(waiting, "open"), true);
  assert.equal(csTicketMatchesFilter(progressing, "open"), true);
  assert.equal(csTicketMatchesFilter(resolved, "open"), false);
  assert.equal(csTicketMatchesFilter(urgent, "urgent"), true);
  assert.equal(csTicketMatchesFilter(waiting, "urgent"), false);
  assert.equal(csTicketMatchesFilter(uncertain, "reconciliation"), true);
  assert.equal(csTicketMatchesFilter(progressing, "reconciliation"), false);
});

test("CS deep links preserve exact channel, queue and ticket without noisy defaults", () => {
  assert.equal(csNavigationParams({}).toString(), "view=cs");
  assert.equal(
    csNavigationParams({ channel: "qoo10", status: "resolved", ticketId: "ticket / 1" }).toString(),
    "view=cs&channel=qoo10&status=resolved&ticketId=ticket+%2F+1",
  );
});
