import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPreparedQoo10Images,
  qoo10RollbackRecoveryPreservesRepresentativeImage,
} from "../lib/channels/marketplace-images";
import {
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
} from "../lib/channels/listing-update";

const marker = {
  status: "allowed",
  contract: qoo10RollbackUpdateRecoveryContract,
  listingId: "11111111-1111-4111-8111-111111111111",
  remoteId: "1234567890",
  providerStatus: "S1",
  sourceJobId: "22222222-2222-4222-8222-222222222222",
  expectedState: {
    categoryCode: "320002604",
    retailPriceJpy: 1871,
    sellPriceJpy: 1871,
    quantity: 1,
    shippingNo: "0",
    biContentsNo: 8461402963,
  },
} as const;
const gallery = ["https://normalized.example.test/gallery.jpg"];
const details = Array.from(
  { length: 8 },
  (_, index) => `https://normalized.example.test/detail-${index + 1}.jpg`,
);

test("Qoo10 rollback image preparation preserves the existing remote representative image and renders eight details", () => {
  const argumentsValue = {
    [qoo10RollbackUpdateRecoveryArgument]: marker,
    params: {
      StandardImage: "https://client.example.test/must-not-be-sent.jpg",
      ItemDescription: '<section lang="ja-JP"><p>日本語の商品詳細です。</p></section>',
    },
  };

  assert.equal(qoo10RollbackRecoveryPreservesRepresentativeImage("qoo10", argumentsValue), true);
  const prepared = applyPreparedQoo10Images(argumentsValue, gallery, details);
  assert.equal(Object.hasOwn(prepared.params, "StandardImage"), false);
  assert.equal((String(prepared.params.ItemDescription).match(/<img\b/giu) ?? []).length, 8);
  for (const detail of details) assert.match(String(prepared.params.ItemDescription), new RegExp(detail));
});

test("ordinary Qoo10 updates keep their existing representative-image normalization behavior", () => {
  const argumentsValue = {
    params: {
      StandardImage: "https://source.example.test/original.jpg",
      ItemDescription: '<section lang="ja-JP"><p>日本語の商品詳細です。</p></section>',
    },
  };
  const prepared = applyPreparedQoo10Images(argumentsValue, gallery, details);
  assert.equal(prepared.params.StandardImage, gallery[0]);
  assert.equal((String(prepared.params.ItemDescription).match(/<img\b/giu) ?? []).length, 8);
});

test("a malformed recovery marker cannot suppress ordinary Qoo10 representative-image handling", () => {
  const argumentsValue = {
    [qoo10RollbackUpdateRecoveryArgument]: { ...marker, sourceJobId: "not-a-uuid" },
    params: {
      StandardImage: "https://source.example.test/original.jpg",
      ItemDescription: '<section lang="ja-JP"><p>日本語の商品詳細です。</p></section>',
    },
  };
  assert.equal(qoo10RollbackRecoveryPreservesRepresentativeImage("qoo10", argumentsValue), false);
  const prepared = applyPreparedQoo10Images(argumentsValue, gallery, details);
  assert.equal(prepared.params.StandardImage, gallery[0]);
});
