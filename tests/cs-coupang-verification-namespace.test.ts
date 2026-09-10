import assert from "node:assert/strict";
import test from "node:test";
import {
  coupangCsVerificationResultSchema,
  coupangCsVerificationTicketIdMatchesKind,
  type CoupangCsVerificationKind,
} from "../lib/cs/channels/coupang/verification.ts";

const credentialId = "00000000-0000-4000-8000-000000003011";

function result(kind: CoupangCsVerificationKind, externalTicketId: string) {
  return {
    contract: "sellerpilot-coupang-cs-verification/1",
    credentialId,
    kind,
    fromDate: "2026-09-01",
    toDate: "2026-09-09",
    totalTickets: 1,
    displayedTickets: 1,
    tickets: [{
      externalTicketId,
      externalOrderReference: null,
      ticketKind: kind === "product" || kind === "call-center" ? "conversation" : "after_sales",
      status: "waiting",
      providerStatus: "waiting",
      receivedAt: "2026-09-09T00:00:00.000Z",
      messages: [],
    }],
  };
}

test("verification accepts every currently stored Coupang ticket namespace", () => {
  const stored: Array<[CoupangCsVerificationKind, string]> = [
    ["product", "product:101"],
    ["call-center", "call-center:102"],
    ["return_request", "coupang:return:103"],
    ["cancel_request", "coupang:cancel:104"],
    ["exchange_request", "coupang:exchange:105"],
  ];

  for (const [kind, externalTicketId] of stored) {
    assert.equal(coupangCsVerificationTicketIdMatchesKind(kind, externalTicketId), true);
    assert.equal(coupangCsVerificationResultSchema.safeParse(result(kind, externalTicketId)).success, true);
  }
});

test("verification also accepts the public request namespace for a future storage migration", () => {
  for (const kind of ["return_request", "cancel_request", "exchange_request"] as const) {
    const externalTicketId = `${kind}:201`;
    assert.equal(coupangCsVerificationTicketIdMatchesKind(kind, externalTicketId), true);
    assert.equal(coupangCsVerificationResultSchema.safeParse(result(kind, externalTicketId)).success, true);
  }
});

test("verification remains fail-closed for another kind or a partial prefix", () => {
  for (const externalTicketId of [
    "coupang:cancel:301",
    "cancel_request:301",
    "coupang:returning:301",
    "coupang:return",
  ]) {
    const parsed = coupangCsVerificationResultSchema.safeParse(result("return_request", externalTicketId));
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.equal(parsed.error.issues.some((issue) =>
        issue.message === "COUPANG_CS_VERIFICATION_TICKET_KIND_MISMATCH"), true);
    }
  }
});
