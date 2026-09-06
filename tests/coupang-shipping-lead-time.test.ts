import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCoupangShippingLeadTime,
  type CoupangShippingLeadTimeConfirmation,
} from "../lib/channels/coupang-shipping-lead-time";

const approvedRule = "결제 후 1~2영업일 내 출고";
// Synthetic contract fixture only. This is NOT a production seller confirmation.
function confirmed(overrides: Record<string, unknown> = {}) {
  const fixture: CoupangShippingLeadTimeConfirmation = {
    shippingRule: approvedRule,
    outboundShippingTimeDay: 2,
    source: "coupang-wing",
    orderDateAndCalendarConfirmed: true,
    approvedPromiseMatched: true,
    sameDayShipping: false,
  };
  return { ...fixture, ...overrides };
}
function required(rule: unknown, confirmation?: unknown) {
  const result = resolveCoupangShippingLeadTime(rule, confirmation);
  assert.equal(result.status, "manual_required");
  assert.equal(result.outboundShippingTimeDay, null);
  return result.reason;
}

test("approved payment-based 1~2 business days never becomes 2 or default 3", () => {
  assert.equal(required(approvedRule), "explicit_coupang_confirmation_required");
  for (const rule of ["결제후1~2영업일", "결제 후 1-2 영업일 내 출고", "주문 후 2영업일 출고", "2일", "D+2", "3", "당일출고", "익일출고"]) {
    required(rule);
  }
});

test("missing or non-string promises fail closed even with explicit days", () => {
  for (const rule of [undefined, null, "", " \n ", 2, true, {}, []]) {
    assert.equal(required(rule, confirmed()), "shipping_rule_required");
  }
});

test("no generic confirmation, prior default, or arbitrary receipt is accepted", () => {
  for (const receipt of [undefined, null, true, false, 2, 3, "確認", "확인", [], {}, { outboundShippingTimeDay: 3 }, { shippingRuleReview: "확인", outboundShippingTimeDay: 2 }]) {
    assert.equal(required(approvedRule, receipt), "explicit_coupang_confirmation_required");
  }
});

test("only explicit Coupang source can attest the API field", () => {
  for (const source of [undefined, null, "smartstore", "text-parser", "coupang", "WING", ""]) {
    assert.equal(required(approvedRule, confirmed({ source })), "explicit_coupang_confirmation_required");
  }
});

test("confirmation is invalidated when approved rule changes", () => {
  for (const shippingRule of [undefined, null, "", "결제 후 3영업일 내 출고", "주문 후 1~2영업일 내 출고"]) {
    assert.equal(required(approvedRule, confirmed({ shippingRule })), "shipping_rule_changed");
  }
  assert.equal(required("결제 후 1영업일 내 출고", confirmed()), "shipping_rule_changed");
});

test("only harmless outer whitespace is ignored in the bound promise", () => {
  assert.equal(resolveCoupangShippingLeadTime(` ${approvedRule}\n`, confirmed()).status, "resolved");
  assert.equal(required("결제후1~2영업일내출고", confirmed()), "shipping_rule_changed");
});

test("order/payment anchor and actual holiday/calendar agreement are mandatory", () => {
  for (const value of [undefined, null, false, "true", "확인", 1]) {
    assert.equal(required(approvedRule, confirmed({ orderDateAndCalendarConfirmed: value })), "shipping_basis_confirmation_required");
    assert.equal(required(approvedRule, confirmed({ approvedPromiseMatched: value })), "shipping_basis_confirmation_required");
  }
});

test("same-day remains separately blocked rather than mapping 0 to API 1", () => {
  for (const sameDayShipping of [undefined, null, true, 0, "false"]) {
    assert.equal(required(approvedRule, confirmed({ sameDayShipping })), "same_day_contract_required");
  }
  assert.equal(required(approvedRule, confirmed({ outboundShippingTimeDay: 0 })), "invalid_explicit_days");
});

test("valid explicitly verified API days are preserved, never incremented or inferred", () => {
  for (const days of [1, 2, 7]) {
    const rule = `판매자가 별도 확인한 주문 기준 ${days}영업일 출고`;
    assert.deepEqual(resolveCoupangShippingLeadTime(rule, confirmed({ shippingRule: rule, outboundShippingTimeDay: days })), {
      status: "resolved", outboundShippingTimeDay: days, reason: "explicit_coupang_confirmation",
    });
  }
});

test("strict integer form inputs are accepted after full confirmation", () => {
  for (const days of ["1", "2", " 2 "]) {
    const result = resolveCoupangShippingLeadTime(approvedRule, confirmed({ outboundShippingTimeDay: days }));
    assert.equal(result.status, "resolved");
    assert.equal(result.outboundShippingTimeDay, Number(days));
  }
});

test("blank and coercible values cannot become a valid shipping day", () => {
  for (const value of [undefined, null, "", " ", true, false, [], [2], {}, { valueOf: () => 2 }]) {
    assert.equal(required(approvedRule, confirmed({ outboundShippingTimeDay: value })), "invalid_explicit_days");
  }
});

test("ranges, units, fractions, exponent notation, unsafe and zero values fail closed", () => {
  for (const value of [0, -0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "0", "-1", "+2", "02", "2.0", "1e1", "0x2", "2일", "1~2", "2\n3", "９", "9007199254740992"]) {
    assert.equal(required(approvedRule, confirmed({ outboundShippingTimeDay: value })), "invalid_explicit_days");
  }
});

test("generic review flags cannot confirm mismatched shipping basis", () => {
  assert.equal(required(approvedRule, confirmed({
    outboundShippingTimeDay: 3,
    approvedPromiseMatched: false,
    shippingRuleReview: "확인",
    packagingRuleReview: "확인",
  })), "shipping_basis_confirmation_required");
});

test("helper is pure and does not mutate or complete missing input", () => {
  const receipt = Object.freeze(confirmed());
  const before = JSON.stringify(receipt);
  const first = resolveCoupangShippingLeadTime(approvedRule, receipt);
  assert.deepEqual(resolveCoupangShippingLeadTime(approvedRule, receipt), first);
  assert.equal(JSON.stringify(receipt), before);
  required(approvedRule);
});
