import test from "node:test";
import assert from "node:assert/strict";
import {
  assertListingShippingReady,
  listingShippingRequirements,
  shippingRequirementDependsOnSource,
} from "../lib/channels/listing-shipping";

const rule = "결제 후 1~2영업일 내 출고";
// Synthetic confirmation only; no real seller setting is asserted by fixtures.
const receipt = (overrides: Record<string, unknown> = {}) => ({
  shippingRule: rule, outboundShippingTimeDay: 2, source: "coupang-wing",
  orderDateAndCalendarConfirmed: true, approvedPromiseMatched: true, sameDayShipping: false,
  ...overrides,
});
function draft() {
  return {
    sellerpilotAssets: { shipping: {
      shippingFeeKrw: 3000, shippingRule: rule, shippingRuleReview: "확인",
      packagingRule: "완충재 포장", packagingRuleReview: "확인",
      coupangLeadTimeConfirmation: JSON.stringify(receipt()) as unknown,
    } },
    body: {
      deliveryChargeType: "NOT_FREE", deliveryCharge: 3000, freeShipOverAmount: 0,
      items: [{ outboundShippingTimeDay: 2 }] as Record<string, unknown>[],
    },
  };
}
function blocked(value: Record<string, unknown>) {
  assert.throws(() => assertListingShippingReady("coupang", value, "listing.create"), /shipping-lead-time/);
}

test("server assertion accepts fully explicit matching JSON and actual payload days", () => {
  const value = draft();
  assert.doesNotThrow(() => assertListingShippingReady("coupang", value, "listing.create"));
  assert.ok(listingShippingRequirements("coupang", value, "listing.create").every((r) => r.status === "ready"));
  value.body.items[0].outboundShippingTimeDay = "2";
  assert.doesNotThrow(() => assertListingShippingReady("coupang", value, "listing.create"));
});

test("null or default 3 cannot pass even when ordinary shipping review is confirmed", () => {
  for (const days of [null, undefined, 3, "3", "", " ", false, 0, -1, 1.5, "2일", "1e1", [], {}]) {
    const value = draft();
    value.body.items[0].outboundShippingTimeDay = days;
    blocked(value);
  }
});

test("actual day alone cannot replace the separately entered confirmation", () => {
  for (const confirmation of [undefined, null, "", "확인", true, {}, "{}", "[]", "null", "2", "{invalid", JSON.stringify({ outboundShippingTimeDay: 2 })]) {
    const value = draft();
    value.sellerpilotAssets.shipping.coupangLeadTimeConfirmation = confirmation;
    blocked(value);
  }
});

test("confirmation requires exact shape and all strict contract fields", () => {
  for (const changed of [
    { source: "smartstore" }, { source: "wing" }, { orderDateAndCalendarConfirmed: false },
    { orderDateAndCalendarConfirmed: "true" }, { approvedPromiseMatched: false },
    { sameDayShipping: true }, { sameDayShipping: "false" }, { unknown: true },
    { outboundShippingTimeDay: null }, { outboundShippingTimeDay: "2.0" },
  ]) {
    const value = draft();
    value.sellerpilotAssets.shipping.coupangLeadTimeConfirmation = JSON.stringify(receipt(changed));
    blocked(value);
  }
  for (const key of Object.keys(receipt())) {
    const value = draft();
    const confirmation: Record<string, unknown> = receipt();
    delete confirmation[key];
    value.sellerpilotAssets.shipping.coupangLeadTimeConfirmation = confirmation;
    blocked(value);
  }
});

test("current rule changes invalidate old confirmation even if generic review remains", () => {
  const value = draft();
  value.sellerpilotAssets.shipping.shippingRule = "결제 후 3영업일 내 출고";
  blocked(value);
  value.sellerpilotAssets.shipping.shippingRule = "";
  blocked(value);
});

test("all items are checked, including malformed or absent items", () => {
  const value = draft();
  value.body.items.push({ outboundShippingTimeDay: 2 });
  assert.doesNotThrow(() => assertListingShippingReady("coupang", value, "listing.create"));
  value.body.items[1].outboundShippingTimeDay = 3;
  blocked(value);
  for (const items of [undefined, null, [], {}, { "0": { outboundShippingTimeDay: 2 } }, [null], [2], [{ outboundShippingTimeDay: 2 }, null]]) {
    blocked({ ...draft(), body: { ...draft().body, items } });
  }
});

test("removing shipping metadata is not a Coupang create bypass", () => {
  blocked({ body: draft().body });
  blocked({ sellerpilotAssets: { shipping: {} }, body: draft().body });
  blocked({});
});

test("same-day payload activation cannot contradict a normal-shipping receipt", () => {
  for (const sameDayShipping of [{ active: true }, true, null, { active: "false" }, {}]) {
    const value = draft();
    value.body.items[0].sameDayShipping = sameDayShipping;
    blocked(value);
  }
  const value = draft();
  value.body.items[0].sameDayShipping = { active: false };
  assert.doesNotThrow(() => assertListingShippingReady("coupang", value, "listing.create"));
});

test("manual paths expose confirmation and every actual item day; all reset on source change", () => {
  const value = draft();
  value.body.items.push({ outboundShippingTimeDay: null });
  const requirements = listingShippingRequirements("coupang", value, "listing.create");
  const confirmation = requirements.find((r) => r.key === "shipping-lead-time-confirmation")!;
  assert.deepEqual(confirmation.manualPath, ["sellerpilotAssets", "shipping", "coupangLeadTimeConfirmation"]);
  assert.equal(shippingRequirementDependsOnSource(confirmation), true);
  for (let i = 0; i < 2; i += 1) {
    const field = requirements.find((r) => r.key === `shipping-lead-time-${i}`)!;
    assert.deepEqual(field.manualPath, ["body", "items", String(i), "outboundShippingTimeDay"]);
    assert.equal(shippingRequirementDependsOnSource(field), true);
  }
});

test("existing Coupang updates and all other metadata-free create contracts stay unchanged", () => {
  const value = draft();
  value.body.items[0].outboundShippingTimeDay = null;
  assert.deepEqual(listingShippingRequirements("coupang", value, "listing.update"), []);
  assert.doesNotThrow(() => assertListingShippingReady("coupang", value, "listing.update"));
  for (const channel of ["qoo10", "shopee", "lazada", "elevenst", "smartstore", "ebay", "temu"] as const) {
    assert.deepEqual(listingShippingRequirements(channel, {}, "listing.create"), []);
  }
});

test("guard never fills days, rewrites the receipt, or mutates a valid/invalid payload", () => {
  for (const days of [2, null]) {
    const value = draft();
    value.body.items[0].outboundShippingTimeDay = days;
    const before = JSON.stringify(value);
    try { assertListingShippingReady("coupang", value, "listing.create"); } catch { /* expected null rejection */ }
    assert.equal(JSON.stringify(value), before);
  }
});
