import assert from "node:assert/strict";
import test from "node:test";
import { publishRegistrationIdentity } from "../lib/publish-registration-draft";
import { shopeeSgStoredCreatePrices } from "../lib/product-registration/shopee/stored-prices";

const credentialId = "0dc9112c-340e-4fe5-870f-d33d61cd8914";
const targetId = "70000001";
const identity = publishRegistrationIdentity("shopee", "SG", targetId, credentialId);

function draft() {
  return {
    schemaVersion: 1,
    sourceFingerprint: "current-product-lineage",
    common: {
      fields: {},
      price: 5_000,
      globalBaseUsdPrice: 4,
      quantity: 1,
      packageFields: { weight: 0.4, length: 28, width: 20, height: 7 },
    },
    channels: {
      [identity]: {
        categoryId: "100787",
        patches: [{ path: ["publish", "item", "original_price"], value: 5 }],
      },
    },
  };
}

function transmittedArguments() {
  return {
    body: { original_price: 4 },
    publish: { item: { original_price: 5 } },
  };
}

test("Shopee SG binds separately saved local SGD and global USD prices to the exact target tuple", () => {
  assert.deepEqual(shopeeSgStoredCreatePrices({
    draftData: draft(),
    credentialId,
    market: "SG",
    targetId,
    categoryId: "100787",
    transmittedArguments: transmittedArguments(),
  }), { targetPriceSgd: 5, globalPriceUsd: 4, identity });
});

test("Shopee SG rejects derived, unsaved, stale-category, or request-only prices", () => {
  const withoutLocalPatch = draft();
  withoutLocalPatch.channels[identity].patches = [];
  assert.throws(() => shopeeSgStoredCreatePrices({
    draftData: withoutLocalPatch,
    credentialId,
    market: "SG",
    targetId,
    categoryId: "100787",
    transmittedArguments: transmittedArguments(),
  }), /SHOPEE_SG_STORED_PRICES_UNVERIFIED/u);

  const wrongCategory = draft();
  wrongCategory.channels[identity].categoryId = "100788";
  assert.throws(() => shopeeSgStoredCreatePrices({
    draftData: wrongCategory,
    credentialId,
    market: "SG",
    targetId,
    categoryId: "100787",
    transmittedArguments: transmittedArguments(),
  }), /SHOPEE_SG_STORED_PRICES_UNVERIFIED/u);

  assert.throws(() => shopeeSgStoredCreatePrices({
    draftData: draft(),
    credentialId,
    market: "SG",
    targetId,
    categoryId: "100787",
    transmittedArguments: { body: { original_price: 4 }, publish: { item: { original_price: 5.01 } } },
  }), /SHOPEE_SG_STORED_PRICES_UNVERIFIED/u);

  for (const invalidPrice of [true, null, "", [], [5], {}, Number.NaN]) {
    const transmitted = transmittedArguments();
    transmitted.publish.item.original_price = invalidPrice as never;
    assert.throws(() => shopeeSgStoredCreatePrices({
      draftData: draft(),
      credentialId,
      market: "SG",
      targetId,
      categoryId: "100787",
      transmittedArguments: transmitted,
    }), /SHOPEE_SG_STORED_PRICES_UNVERIFIED/u);
  }
});
