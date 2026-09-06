import { registrationValueAt, type RegistrationValue } from "../channel-registration-form";

export const coupangLeadTimeConfirmationPath = [
  "sellerpilotAssets", "shipping", "coupangLeadTimeConfirmation",
] as const;

export type CoupangLeadTimeDraftConfirmation = {
  shippingRule: string;
  outboundShippingTimeDay: number | string | null;
  source: "coupang-wing";
  orderDateAndCalendarConfirmed: boolean;
  approvedPromiseMatched: boolean;
  sameDayShipping: false | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parsedRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return record(value);
  try { return record(JSON.parse(value)); } catch { return {}; }
}

function leadTimeValue(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

export function coupangDraftShippingRule(draft: Record<string, unknown>): string {
  const value = registrationValueAt(draft, ["sellerpilotAssets", "shipping", "shippingRule"]);
  return typeof value === "string" ? value : "";
}

export function coupangDraftPackagingRule(draft: Record<string, unknown>): string {
  const value = registrationValueAt(draft, ["sellerpilotAssets", "shipping", "packagingRule"]);
  return typeof value === "string" ? value : "";
}

/**
 * Return a UI-safe partial receipt. False/null remain incomplete and therefore
 * cannot pass the server guard. A changed shipping rule deliberately drops all
 * prior confirmations instead of rebinding stale evidence to the new rule.
 */
export function readCoupangLeadTimeDraftConfirmation(
  draft: Record<string, unknown>,
): CoupangLeadTimeDraftConfirmation {
  const shippingRule = coupangDraftShippingRule(draft);
  const stored = parsedRecord(registrationValueAt(draft, [...coupangLeadTimeConfirmationPath]));
  const sameRule = typeof stored.shippingRule === "string"
    && stored.shippingRule.trim() === shippingRule.trim()
    && shippingRule.trim() !== "";
  return {
    shippingRule,
    outboundShippingTimeDay: sameRule ? leadTimeValue(stored.outboundShippingTimeDay) : null,
    source: "coupang-wing",
    orderDateAndCalendarConfirmed: sameRule && stored.orderDateAndCalendarConfirmed === true,
    approvedPromiseMatched: sameRule && stored.approvedPromiseMatched === true,
    sameDayShipping: sameRule && stored.sameDayShipping === false ? false : null,
  };
}

export function updateCoupangLeadTimeDraftConfirmation(
  draft: Record<string, unknown>,
  update: Partial<Omit<CoupangLeadTimeDraftConfirmation, "shippingRule" | "source">>,
): CoupangLeadTimeDraftConfirmation {
  const current = readCoupangLeadTimeDraftConfirmation(draft);
  return {
    shippingRule: current.shippingRule,
    outboundShippingTimeDay: Object.hasOwn(update, "outboundShippingTimeDay")
      ? leadTimeValue(update.outboundShippingTimeDay)
      : current.outboundShippingTimeDay,
    source: "coupang-wing",
    orderDateAndCalendarConfirmed: Object.hasOwn(update, "orderDateAndCalendarConfirmed")
      ? update.orderDateAndCalendarConfirmed === true
      : current.orderDateAndCalendarConfirmed,
    approvedPromiseMatched: Object.hasOwn(update, "approvedPromiseMatched")
      ? update.approvedPromiseMatched === true
      : current.approvedPromiseMatched,
    sameDayShipping: Object.hasOwn(update, "sameDayShipping")
      ? update.sameDayShipping === false ? false : null
      : current.sameDayShipping,
  };
}

export function coupangLeadTimeItemPaths(draft: Record<string, unknown>): string[][] {
  const items = registrationValueAt(draft, ["body", "items"]);
  if (!Array.isArray(items)) return [];
  return items.map((_, index) => ["body", "items", String(index), "outboundShippingTimeDay"]);
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[1-9]\d*$/.test(value.trim())) return null;
  const number = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function coupangCommonLeadTimeDay(draft: Record<string, unknown>): {
  day: number | null;
  inconsistent: boolean;
  itemValues: Array<number | string | null>;
} {
  const itemValues = coupangLeadTimeItemPaths(draft)
    .map((path) => leadTimeValue(registrationValueAt(draft, path)));
  const normalized = itemValues.map(positiveInteger);
  const complete = normalized.length > 0 && normalized.every((value) => value !== null);
  const distinct = new Set(normalized.filter((value): value is number => value !== null));
  return {
    day: complete && distinct.size === 1 ? normalized[0] : null,
    inconsistent: distinct.size > 1,
    itemValues,
  };
}

export function isCoupangStructuredShippingPath(path: string[]): boolean {
  const key = path.join(".");
  return key === "sellerpilotAssets.shipping.shippingRuleReview"
    || key === "sellerpilotAssets.shipping.packagingRuleReview"
    || key === "sellerpilotAssets.shipping.coupangLeadTimeConfirmation"
    || key.startsWith("sellerpilotAssets.shipping.coupangLeadTimeConfirmation.")
    || /^body\.items\.\d+\.outboundShippingTimeDay$/.test(key);
}

export function asRegistrationValue(
  confirmation: CoupangLeadTimeDraftConfirmation,
): RegistrationValue {
  return confirmation as unknown as RegistrationValue;
}
