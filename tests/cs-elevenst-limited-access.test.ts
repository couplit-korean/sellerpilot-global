import assert from "node:assert/strict";
import test from "node:test";
import { buildElevenstLimitedAccessProjection } from "../lib/cs/channels/elevenst/limited-access";

test("11st SellerTalk remains session-only with a finite retention boundary", () => {
  const value = buildElevenstLimitedAccessProjection("seller_talk");
  assert.equal(value.accessMode, "seller_office_session_only");
  assert.deepEqual(value.retention, { maximum: 3, unit: "month", exactDays: null });
  assert.equal("retentionDays" in value, false);
  assert.equal(value.remoteCount, null);
  assert.equal(value.storedCount, null);
  assert.equal(value.automaticReadAvailable, false);
  assert.equal(value.automaticReplyAvailable, false);
  assert.match(value.message, /0건을 과거 전체 0건으로 해석하지 않습니다/u);
});

test("11st reviews remain export-preview only without fabricated read or reply support", () => {
  const value = buildElevenstLimitedAccessProjection("review");
  assert.equal(value.accessMode, "seller_office_export_only");
  assert.equal(value.retention, null);
  assert.equal(value.reviewedImportCandidate, "seller_office_xls_preview");
  assert.equal(value.remoteCount, null);
  assert.equal(value.storedCount, null);
  assert.equal(value.automaticReadAvailable, false);
  assert.equal(value.automaticReplyAvailable, false);
  assert.match(value.message, /자동연동이나 댓글 완료 증거가 아닙니다/u);
});
