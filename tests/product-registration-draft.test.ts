import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_REGISTRATION_DRAFT_MAX_DATA_BYTES,
  PRODUCT_REGISTRATION_DRAFT_MAX_DEPTH,
  PRODUCT_REGISTRATION_DRAFT_MAX_NODES,
  parseProductRegistrationDraft,
  parseProductRegistrationDraftPut,
  productRegistrationDraftDataIssue,
  productRegistrationDraftRpcResult,
} from "../lib/product-registration-draft";

const DRAFT_ID = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";

test("incomplete intake and publish objects satisfy the shared draft contract", () => {
  const intake = {
    draftId: DRAFT_ID,
    kind: "intake",
    productId: null,
    expectedVersion: 0,
    data: {
      productName: "",
      images: [{ previewUrl: "blob:local-preview", position: 0 }],
      channels: {},
    },
  };
  assert.equal(parseProductRegistrationDraftPut(intake).success, true);
  assert.equal(parseProductRegistrationDraftPut({
    ...intake,
    kind: "publish",
    productId: PRODUCT_ID,
    data: { common: {}, channels: { smartstore: { categoryId: "" } } },
  }).success, true);

  const stored = productRegistrationDraftRpcResult({
    draftId: DRAFT_ID,
    kind: "intake",
    productId: null,
    version: 1,
    data: intake.data,
    updatedAt: "2026-09-07T02:30:00+00:00",
  });
  assert.equal(stored?.version, 1);
  assert.equal(stored?.productId, null);
});

test("draft data rejects prototype keys, non-JSON values, cycles, depth, and node bombs", () => {
  const polluted = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}') as unknown;
  assert.match(productRegistrationDraftDataIssue(polluted) ?? "", /unsafe object key/);
  assert.match(productRegistrationDraftDataIssue({ value: Number.NaN }) ?? "", /finite/);
  assert.match(productRegistrationDraftDataIssue({ value: new Date() }) ?? "", /non-plain/);

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.match(productRegistrationDraftDataIssue(circular) ?? "", /circular/);

  let deep: Record<string, unknown> = {};
  for (let index = 0; index <= PRODUCT_REGISTRATION_DRAFT_MAX_DEPTH; index += 1) {
    deep = { child: deep };
  }
  assert.match(productRegistrationDraftDataIssue(deep) ?? "", /nested/);

  const manyValues = Array.from(
    { length: PRODUCT_REGISTRATION_DRAFT_MAX_NODES },
    (_, index) => index,
  );
  assert.match(productRegistrationDraftDataIssue({ manyValues }) ?? "", /values/);
});

test("draft data limit is measured as UTF-8 and stored responses are strict", () => {
  const oversized = { value: "가".repeat(PRODUCT_REGISTRATION_DRAFT_MAX_DATA_BYTES / 3) };
  assert.match(productRegistrationDraftDataIssue(oversized) ?? "", /bytes/);

  assert.equal(parseProductRegistrationDraft({
    draftId: DRAFT_ID,
    kind: "publish",
    productId: PRODUCT_ID,
    version: 1,
    data: {},
    updatedAt: "not-a-date",
  }).success, false);
  assert.throws(
    () => productRegistrationDraftRpcResult({ draftId: DRAFT_ID }),
    /PRODUCT_REGISTRATION_DRAFT_RPC_SHAPE/,
  );
  assert.equal(productRegistrationDraftRpcResult(null), null);
});
