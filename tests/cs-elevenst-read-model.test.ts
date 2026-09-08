import assert from "node:assert/strict";
import test from "node:test";
import { buildElevenstReadonlyWebProjection } from "../lib/cs/channels/elevenst/read-model";

const base = {
  sellerId: "couplit",
  sellerName: "커플릿",
  checkedAt: "2026-09-08T07:30:00.000Z",
  httpStatus: 200,
  providerRows: 0,
} as const;

test("11st Product Q&A business code 500 is projected as unknown remote count, never zero", () => {
  for (const accepted of [false, true]) {
    const projection = buildElevenstReadonlyWebProjection({
      provider: { ...base, surface: "product_qna", accepted, resultCode: "500" },
      stored: { rowCount: 4, latestReceivedAt: "2026-08-31T01:00:00.000Z" },
    });
    assert.equal(projection.providerState, "business_error");
    assert.equal(projection.remoteCount, null);
    assert.equal(projection.emptyConfirmed, false);
    assert.equal(projection.storedCount, 4);
    assert.equal(projection.storedHistoryState, "preserved_unverified");
    assert.equal(projection.replyEnabled, false);
    assert.match(projection.message, /0건으로 표시하지 않습니다/u);
  }
});

test("11st Alimi code 0 with parsed zero rows is a confirmed empty read", () => {
  const projection = buildElevenstReadonlyWebProjection({
    provider: { ...base, surface: "urgent_alimi", accepted: true, resultCode: "0" },
    stored: { rowCount: 0, latestReceivedAt: null },
  });
  assert.equal(projection.providerState, "empty");
  assert.equal(projection.remoteCount, 0);
  assert.equal(projection.emptyConfirmed, true);
  assert.equal(projection.storedHistoryState, "current");
});

test("11st Alimi unparsed or negative-code responses cannot become empty success", () => {
  for (const provider of [
    { ...base, surface: "urgent_alimi" as const, accepted: false, resultCode: "0" },
    { ...base, surface: "urgent_alimi" as const, accepted: false, resultCode: "-1" },
  ]) {
    const projection = buildElevenstReadonlyWebProjection({
      provider,
      stored: { rowCount: 0, latestReceivedAt: null },
    });
    assert.equal(projection.remoteCount, null);
    assert.equal(projection.emptyConfirmed, false);
  }
});

test("11st read projection rejects a seller mismatch and invalid counters", () => {
  assert.throws(() => buildElevenstReadonlyWebProjection({
    provider: {
      ...base, surface: "product_qna", sellerId: "other", accepted: true, resultCode: null,
    },
    stored: { rowCount: 0, latestReceivedAt: null },
  }), /ELEVENST_READ_MODEL_SELLER_SCOPE_MISMATCH/u);
  assert.throws(() => buildElevenstReadonlyWebProjection({
    provider: {
      ...base, surface: "product_qna", accepted: true, resultCode: null, providerRows: -1,
    },
    stored: { rowCount: 0, latestReceivedAt: null },
  }), /ELEVENST_READ_MODEL_INVALID/u);
});
