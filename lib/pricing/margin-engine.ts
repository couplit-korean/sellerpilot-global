export const MARGIN_ENGINE_VERSION = "margin-2026-09-07-v2" as const;

export type MarginEngineInput = {
  sellingPrice: number;
  marketReferencePrice: number | null;
  purchaseCost: number;
  internationalShipping: number;
  localShipping: number;
  fulfillmentCost: number;
  fixedCost: number;
  platformFee: number | null;
  paymentFee: number;
  taxRate: number;
  adRate: number;
  reserveRate: number;
  targetMargin: number;
};

export type MarginCalculationStatus =
  | "ready"
  | "fee_unconfirmed"
  | "invalid_input"
  | "break_even_unreachable"
  | "target_unreachable";

export type MarginProfitabilityStatus =
  | "selling_price_missing"
  | "target_met"
  | "target_not_met"
  | "unavailable";

export type MarginMarketStatus =
  | "reference_missing"
  | "within_range"
  | "recommended_above_market"
  | "recommended_below_market"
  | "unavailable";

export type MarginEngineResult = {
  engineVersion: typeof MARGIN_ENGINE_VERSION;
  calculationStatus: MarginCalculationStatus;
  profitabilityStatus: MarginProfitabilityStatus;
  marketStatus: MarginMarketStatus;
  reasons: string[];
  fixedCosts: number;
  variableRate: number | null;
  variableCost: number | null;
  profit: number | null;
  margin: number | null;
  breakEvenPrice: number | null;
  recommendedPrice: number | null;
  marketGapRate: number | null;
};

const amountKeys = [
  "sellingPrice",
  "purchaseCost",
  "internationalShipping",
  "localShipping",
  "fulfillmentCost",
  "fixedCost",
] as const;

const rateKeys = ["paymentFee", "taxRate", "adRate", "reserveRate", "targetMargin"] as const;

function roundKrwSellingPrice(value: number) {
  return Math.ceil(value / 100) * 100;
}

function invalidInputReasons(input: MarginEngineInput) {
  const reasons: string[] = [];
  for (const key of amountKeys) {
    if (!Number.isFinite(input[key]) || input[key] < 0) reasons.push(`${key}_invalid`);
  }
  if (input.marketReferencePrice !== null
      && (!Number.isFinite(input.marketReferencePrice) || input.marketReferencePrice <= 0)) {
    reasons.push("market_reference_invalid");
  }
  if (input.platformFee !== null
      && (!Number.isFinite(input.platformFee) || input.platformFee < 0 || input.platformFee >= 100)) {
    reasons.push("platform_fee_invalid");
  }
  for (const key of rateKeys) {
    if (!Number.isFinite(input[key]) || input[key] < 0 || input[key] >= 100) reasons.push(`${key}_invalid`);
  }
  return reasons;
}

export function calculateMargin(input: MarginEngineInput): MarginEngineResult {
  const fixedCosts = input.purchaseCost
    + input.internationalShipping
    + input.localShipping
    + input.fulfillmentCost
    + input.fixedCost;
  const invalidReasons = invalidInputReasons(input);

  if (invalidReasons.length > 0) {
    return {
      engineVersion: MARGIN_ENGINE_VERSION,
      calculationStatus: "invalid_input",
      profitabilityStatus: "unavailable",
      marketStatus: "unavailable",
      reasons: invalidReasons,
      fixedCosts,
      variableRate: null,
      variableCost: null,
      profit: null,
      margin: null,
      breakEvenPrice: null,
      recommendedPrice: null,
      marketGapRate: null,
    };
  }

  if (input.platformFee === null) {
    return {
      engineVersion: MARGIN_ENGINE_VERSION,
      calculationStatus: "fee_unconfirmed",
      profitabilityStatus: "unavailable",
      marketStatus: "unavailable",
      reasons: ["platform_fee_unconfirmed"],
      fixedCosts,
      variableRate: null,
      variableCost: null,
      profit: null,
      margin: null,
      breakEvenPrice: null,
      recommendedPrice: null,
      marketGapRate: null,
    };
  }

  const variableRate = input.platformFee
    + input.paymentFee
    + input.taxRate
    + input.adRate
    + input.reserveRate;
  if (!Number.isFinite(variableRate) || variableRate >= 100) {
    return {
      engineVersion: MARGIN_ENGINE_VERSION,
      calculationStatus: "break_even_unreachable",
      profitabilityStatus: "unavailable",
      marketStatus: "unavailable",
      reasons: ["variable_rate_at_or_above_100"],
      fixedCosts,
      variableRate,
      variableCost: null,
      profit: null,
      margin: null,
      breakEvenPrice: null,
      recommendedPrice: null,
      marketGapRate: null,
    };
  }

  const variableCost = input.sellingPrice * (variableRate / 100);
  const profit = input.sellingPrice > 0
    ? input.sellingPrice - fixedCosts - variableCost
    : null;
  const margin = profit !== null ? (profit / input.sellingPrice) * 100 : null;
  const breakEvenPrice = roundKrwSellingPrice(fixedCosts / (1 - variableRate / 100));
  const targetDenominator = 1 - variableRate / 100 - input.targetMargin / 100;

  if (targetDenominator <= 0) {
    return {
      engineVersion: MARGIN_ENGINE_VERSION,
      calculationStatus: "target_unreachable",
      profitabilityStatus: margin === null
        ? "selling_price_missing"
        : margin >= input.targetMargin ? "target_met" : "target_not_met",
      marketStatus: "unavailable",
      reasons: ["target_and_variable_rate_at_or_above_100"],
      fixedCosts,
      variableRate,
      variableCost,
      profit,
      margin,
      breakEvenPrice,
      recommendedPrice: null,
      marketGapRate: null,
    };
  }

  const recommendedPrice = roundKrwSellingPrice(fixedCosts / targetDenominator);
  const marketGapRate = input.marketReferencePrice === null
    ? null
    : ((recommendedPrice - input.marketReferencePrice) / input.marketReferencePrice) * 100;
  const marketStatus: MarginMarketStatus = marketGapRate === null
    ? "reference_missing"
    : Math.abs(marketGapRate) <= 8
      ? "within_range"
      : marketGapRate > 0 ? "recommended_above_market" : "recommended_below_market";

  return {
    engineVersion: MARGIN_ENGINE_VERSION,
    calculationStatus: "ready",
    profitabilityStatus: margin === null
      ? "selling_price_missing"
      : margin >= input.targetMargin ? "target_met" : "target_not_met",
    marketStatus,
    reasons: [],
    fixedCosts,
    variableRate,
    variableCost,
    profit,
    margin,
    breakEvenPrice,
    recommendedPrice,
    marketGapRate,
  };
}

export function marginResultMatches(
  result: MarginEngineResult,
  supplied: Record<string, unknown>,
  tolerance = 0.01,
) {
  const comparableKeys = [
    "fixedCosts",
    "variableRate",
    "variableCost",
    "profit",
    "margin",
    "breakEvenPrice",
    "recommendedPrice",
    "marketGapRate",
  ] as const;
  if (supplied.engineVersion !== result.engineVersion
      || supplied.calculationStatus !== result.calculationStatus
      || supplied.profitabilityStatus !== result.profitabilityStatus
      || supplied.marketStatus !== result.marketStatus) return false;
  return comparableKeys.every((key) => {
    const expected = result[key];
    const actual = supplied[key];
    if (expected === null) return actual === null;
    return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  });
}
