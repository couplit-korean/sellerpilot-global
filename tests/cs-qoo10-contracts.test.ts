import assert from "node:assert/strict";
import test from "node:test";
import {
  assessQoo10WindowCompleteness,
  qoo10InquiryListParams,
  qoo10InquiryReplyParams,
} from "../lib/channels/cs/qoo10/contracts.ts";
import { planQoo10History, splitSaturatedQoo10Day } from "../lib/channels/cs/qoo10/history.ts";
import { prepareQoo10Reply } from "../lib/channels/cs/qoo10/reply-guard.ts";
import { qoo10ReviewCapability } from "../lib/channels/cs/qoo10/review.ts";

test("Qoo10 S1/S2/S3 list contract accepts only exact Japan-time fields", () => {
  assert.deepEqual(qoo10InquiryListParams({ params: {
    search_start_dt: "20260901000000",
    search_end_dt: "20260901235959",
    proc_status: "s1",
  } }), {
    search_start_dt: "20260901000000",
    search_end_dt: "20260901235959",
    proc_status: "S1",
  });
  for (const params of [
    { search_start_dt: "20260901000000", search_end_dt: "20260901235959", proc_status: "S4" },
    { search_start_dt: "20260902000000", search_end_dt: "20260901235959", proc_status: "S1" },
    { search_start_dt: "20260230000000", search_end_dt: "20260301235959", proc_status: "S1" },
    { search_start_dt: "20260901000000", search_end_dt: "20260901235959", proc_status: "S1", page: "1" },
  ]) assert.throws(() => qoo10InquiryListParams({ params }), /QOO10_INQUIRY_(?:QUERY|TIME_RANGE)_INVALID/u);
});

test("Qoo10 reply contract enforces documented lineage and 4000-character content limit", () => {
  assert.deepEqual(qoo10InquiryReplyParams({ params: {
    inq_type: "msg", question_no: "100", seq_no: "101", contents: "확인했습니다.",
  } }), { inq_type: "MSG", question_no: "100", seq_no: "101", contents: "확인했습니다." });
  assert.throws(() => qoo10InquiryReplyParams({ params: {
    inq_type: "MSG", question_no: "100", seq_no: "101", contents: "가".repeat(4_001),
  } }), /QOO10_INQUIRY_REPLY_INVALID/u);
  assert.throws(() => qoo10InquiryReplyParams({ params: {
    inq_type: "MSG", question_no: "100", seq_no: "101", contents: "bad\u0000text",
  } }), /QOO10_INQUIRY_REPLY_INVALID/u);
});

test("Qoo10 history splits every selected day and every state without declaring capped data complete", () => {
  const plan = planQoo10History("2026-09-01", "2026-09-02");
  assert.equal(plan.dayCount, 2);
  assert.equal(plan.inquiries.length, 6);
  assert.equal(plan.claims.length, 2);
  assert.equal(plan.reviews.length, 1);
  assert.deepEqual(plan.inquiries.map((entry) => entry.status), ["S1", "S2", "S3", "S1", "S2", "S3"]);
  assert.equal(splitSaturatedQoo10Day({ calendarDate: "2026-09-01", status: "S1" }).length, 24);
  assert.deepEqual(assessQoo10WindowCompleteness({ providerSucceeded: true, rowCount: 100, observedRowLimit: 100 }), {
    state: "incomplete", reason: "observed_row_limit_reached",
  });
  assert.deepEqual(assessQoo10WindowCompleteness({ providerSucceeded: true, rowCount: 0 }), {
    state: "complete", reason: "provider_success_empty",
  });
  assert.deepEqual(assessQoo10WindowCompleteness({ providerSucceeded: true, rowCount: 0, providerTotal: 5 }), {
    state: "incomplete", reason: "provider_total_mismatch",
  });
  assert.deepEqual(assessQoo10WindowCompleteness({ providerSucceeded: true, rowCount: 0, providerTotal: 0 }), {
    state: "complete", reason: "provider_total_reconciled",
  });
  for (const providerTotal of [-1, 1.5, "0", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(assessQoo10WindowCompleteness({ providerSucceeded: true, rowCount: 0, providerTotal }), {
      state: "incomplete", reason: "provider_total_invalid",
    });
  }
  assert.deepEqual(assessQoo10WindowCompleteness({ providerSucceeded: true, rowCount: 2 }), {
    state: "unverified", reason: "missing_total_and_row_limit",
  });
});

test("Qoo10 reply guard rejects stale, completed, mismatched and unapproved targets", () => {
  const base = {
    externalTicketId: "qoo10:ITEM:100:101",
    replyText: "지원 답변",
    replyContext: { inquiryType: "ITEM", questionNo: "100", sequenceNo: "101" },
    providerContext: { inquiryType: "ITEM", questionNo: "100", sequenceNo: "101", processingStatus: "S1" },
    selectedInboundKey: "inbound-2",
    latestInboundKey: "inbound-2",
    approved: true,
  };
  const prepared = prepareQoo10Reply(base);
  assert.equal(prepared.params.seq_no, "101");
  assert.equal(prepared.verification.acceptanceIsDeliveryProof, false);
  assert.throws(() => prepareQoo10Reply({ ...base, approved: false }), /QOO10_REPLY_APPROVAL_REQUIRED/u);
  assert.throws(() => prepareQoo10Reply({ ...base, latestInboundKey: "inbound-3" }), /QOO10_REPLY_STALE_TARGET/u);
  assert.throws(() => prepareQoo10Reply({
    ...base, providerContext: { ...base.providerContext, processingStatus: "S3" },
  }), /QOO10_REPLY_TARGET_INVALID/u);
  assert.throws(() => prepareQoo10Reply({
    ...base, replyContext: { ...base.replyContext, sequenceNo: "102" },
  }), /QOO10_REPLY_TARGET_INVALID/u);
});

test("Qoo10 review capability stays explicit about the seller UI export gap", () => {
  assert.equal(qoo10ReviewCapability.officialQapiMethod, null);
  assert.equal(qoo10ReviewCapability.qsmMaximumWindowDays, 30);
  assert.equal(qoo10ReviewCapability.importFormatVerified, false);
  assert.equal(qoo10ReviewCapability.automaticHistoricalRecovery, false);
});
