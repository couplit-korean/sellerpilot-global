import assert from "node:assert/strict";
import test from "node:test";
import { buildInquiryReplyArguments } from "../lib/channels/inquiry-reply";

test("Lazada replies preserve the stored inquiry country for provider routing", () => {
  for (const country of ["MY", "PH", "SG", "TH", "VN", "ID"]) {
    assert.deepEqual(buildInquiryReplyArguments("lazada", "lazada-im:session-1", "reply", { country }), {
      sessionId: "session-1", reply: "reply", country: country.toLowerCase(),
    });
  }
});

test("Lazada reply routing rejects a malformed stored country", () => {
  for (const country of ["", "US", "MY,PH", null, 1, { country: "MY" }]) {
    assert.throws(() => buildInquiryReplyArguments("lazada", "lazada-im:session-1", "reply", { country }),
      /INQUIRY_REPLY_INVALID:lazadaCountry/);
  }
});

test("legacy single-country reply arguments retain their previous contract", () => {
  assert.deepEqual(buildInquiryReplyArguments("lazada", "lazada-im:session-1", "reply"), {
    sessionId: "session-1", reply: "reply",
  });
});
