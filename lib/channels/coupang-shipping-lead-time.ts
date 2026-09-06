/**
 * Official sources inspected 2026-09-06:
 * https://developers.coupangcorp.com/hc/en-us/articles/360033877853-Product-Creation
 *   outboundShippingTimeDay: expected shipping days after order date (D-Day).
 *   The API guide uses 1 for both same-day and next-day; sameDayShipping is separate.
 * https://marketplace.coupang.com/information-center/shipement-overview-ur3yd
 *   Shipment lead time excludes Saturdays, Sundays, public holidays and seller
 *   holidays. Arrival time additionally includes transit time. WING describes
 *   same-day as 0, so its display value is not blindly copied to this API field.
 *
 * Neither source proves that a free-text promise measured from PAYMENT has the
 * same anchor/calendar as a particular seller's order-based WING setting.
 * Therefore no text parser, range upper-bound, default 3, or inferred 2 is used.
 * A generic shippingRuleReview="확인" is NOT field-specific confirmation.
 *
 * This pure helper resolves one normal-shipping field only, not permission to
 * publish, provider category limits, same-day settings or a delivery deadline.
 */
export type CoupangShippingLeadTimeConfirmation = {
  /** Exact current approved promise. Changed wording invalidates this receipt. */
  shippingRule: string;
  /** Explicit API-field value verified against the seller's Coupang settings. */
  outboundShippingTimeDay: number | string;
  source: "coupang-wing";
  /** Includes order-vs-payment anchor, cutoff and the actual seller calendar. */
  orderDateAndCalendarConfirmed: true;
  /** Must explicitly fit the approved promise, not merely an existing default. */
  approvedPromiseMatched: true;
  /** Same-day needs a separate contract and is deliberately out of scope. */
  sameDayShipping: false;
};

export type CoupangShippingLeadTimeResult =
  | {
      status: "resolved";
      outboundShippingTimeDay: number;
      reason: "explicit_coupang_confirmation";
    }
  | {
      status: "manual_required";
      outboundShippingTimeDay: null;
      reason:
        | "shipping_rule_required"
        | "explicit_coupang_confirmation_required"
        | "shipping_rule_changed"
        | "shipping_basis_confirmation_required"
        | "same_day_contract_required"
        | "invalid_explicit_days";
    };

type MissingReason = Extract<CoupangShippingLeadTimeResult, { status: "manual_required" }>["reason"];

function missing(reason: MissingReason): CoupangShippingLeadTimeResult {
  return { status: "manual_required", outboundShippingTimeDay: null, reason };
}

function positiveInteger(value: unknown): number | null {
  // Do not coerce blank/null/boolean, decimal text, units, ranges or exponents.
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[1-9]\d*$/.test(value.trim())) return null;
  const days = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(days) && days > 0 ? days : null;
}

/**
 * With only an approved shippingRule, always returns null/manual_required.
 * Callers must not manufacture confirmation from text, an old payload default,
 * or a generic review checkbox. Populate it only after the explicit Coupang
 * setting and its agreement with the current approved promise are confirmed.
 * Treat null as missing and block submission; never replace it with 2 or 3.
 * Unknown input is intentional so persisted/UI data is checked at runtime.
 */
export function resolveCoupangShippingLeadTime(
  shippingRule: unknown,
  confirmation?: unknown,
): CoupangShippingLeadTimeResult {
  if (typeof shippingRule !== "string" || !shippingRule.trim()) {
    return missing("shipping_rule_required");
  }
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) {
    return missing("explicit_coupang_confirmation_required");
  }
  const confirmed = confirmation as Record<string, unknown>;
  if (confirmed.source !== "coupang-wing") {
    return missing("explicit_coupang_confirmation_required");
  }
  if (typeof confirmed.shippingRule !== "string"
      || confirmed.shippingRule.trim() !== shippingRule.trim()) {
    return missing("shipping_rule_changed");
  }
  if (confirmed.orderDateAndCalendarConfirmed !== true || confirmed.approvedPromiseMatched !== true) {
    return missing("shipping_basis_confirmation_required");
  }
  if (confirmed.sameDayShipping !== false) {
    return missing("same_day_contract_required");
  }
  const days = positiveInteger(confirmed.outboundShippingTimeDay);
  return days === null
    ? missing("invalid_explicit_days")
    : { status: "resolved", outboundShippingTimeDay: days, reason: "explicit_coupang_confirmation" };
}
