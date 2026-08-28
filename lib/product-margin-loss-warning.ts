export type ProductMarginScenarioLike = {
  id: string;
  productId: string | null;
  channelKey: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
};

export type ProductMarginChannelEdit = {
  channelKey: string;
  sellingPrice?: number | null;
  internationalShipping?: number | null;
  localShipping?: number | null;
  fulfillmentCost?: number | null;
  fixedCost?: number | null;
  platformFee?: number | null;
  paymentFee?: number | null;
  taxRate?: number | null;
  adRate?: number | null;
  reserveRate?: number | null;
};

type MarginCalculationInputs = {
  sellingPrice: number;
  purchaseCost: number;
  internationalShipping: number;
  localShipping: number;
  fulfillmentCost: number;
  fixedCost: number;
  platformFee: number;
  paymentFee: number;
  taxRate: number;
  adRate: number;
  reserveRate: number;
};

export type ProductMarginCalculation = MarginCalculationInputs & {
  fixedCosts: number;
  variableRate: number;
  variableCost: number;
  profit: number;
  margin: number;
};

export type ProductMarginLossWarning = {
  kind: "loss" | "negative-margin";
  productId: string;
  channelKey: string;
  scenarioId: string;
  profitDeltaKrw: number;
  marginDeltaPercentPoints: number;
  profitLossKrw: number;
  marginLossPercentPoints: number;
};

export type ProductMarginWarningUnavailableReason =
  | "missing-baseline"
  | "invalid-baseline"
  | "missing-or-invalid-fees"
  | "inconsistent-baseline"
  | "invalid-edit";

export type ProductMarginWarningEvaluation =
  | {
      status: "ready";
      productId: string;
      channelKey: string;
      scenarioId: string;
      baseline: ProductMarginCalculation;
      edited: ProductMarginCalculation;
      warning: ProductMarginLossWarning | null;
      reason: null;
    }
  | {
      status: "unavailable";
      productId: string;
      channelKey: string;
      scenarioId: string | null;
      baseline: null;
      edited: null;
      warning: null;
      reason: ProductMarginWarningUnavailableReason;
    };

const fixedCostFields = [
  "purchaseCost",
  "internationalShipping",
  "localShipping",
  "fulfillmentCost",
  "fixedCost",
] as const;

const variableRateFields = [
  "platformFee",
  "paymentFee",
  "taxRate",
  "adRate",
  "reserveRate",
] as const;

const editableFields = [
  "sellingPrice",
  "internationalShipping",
  "localShipping",
  "fulfillmentCost",
  "fixedCost",
  ...variableRateFields,
] as const;

function nonNegativeFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function calculateMargin(inputs: MarginCalculationInputs): ProductMarginCalculation {
  const fixedCosts = fixedCostFields.reduce((total, field) => total + inputs[field], 0);
  const variableRate = variableRateFields.reduce((total, field) => total + inputs[field], 0);
  const variableCost = inputs.sellingPrice * (variableRate / 100);
  const profit = inputs.sellingPrice - fixedCosts - variableCost;
  const margin = (profit / inputs.sellingPrice) * 100;
  return { ...inputs, fixedCosts, variableRate, variableCost, profit, margin };
}

function approximatelyEqual(left: number, right: number) {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-9;
}

function scenarioTimestamp(scenario: ProductMarginScenarioLike) {
  const timestamp = Date.parse(scenario.createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function latestProductMarginScenario(
  productId: string,
  channelKey: string,
  scenarios: readonly ProductMarginScenarioLike[],
) {
  return scenarios
    .filter((scenario) => scenario.productId === productId && scenario.channelKey === channelKey)
    .reduce<ProductMarginScenarioLike | null>((latest, scenario) => {
      if (!latest) return scenario;
      const timestampDifference = scenarioTimestamp(scenario) - scenarioTimestamp(latest);
      if (timestampDifference > 0) return scenario;
      if (timestampDifference < 0) return latest;
      return scenario.id.localeCompare(latest.id) > 0 ? scenario : latest;
    }, null);
}

export function editedProductSellingPriceKrw({
  scenario,
  sellingPrice,
  currency,
}: {
  scenario: ProductMarginScenarioLike | null;
  sellingPrice: number;
  currency: string;
}) {
  const normalizedPrice = positiveFiniteNumber(sellingPrice);
  if (normalizedPrice === null) return null;
  const normalizedCurrency = currency.trim().toUpperCase();
  if (normalizedCurrency === "KRW") return normalizedPrice;
  if (!scenario) return null;
  const savedCurrency = typeof scenario.inputs.currency === "string"
    ? scenario.inputs.currency.trim().toUpperCase()
    : "";
  const rateToKrw = positiveFiniteNumber(scenario.inputs.rateToKrw);
  if (!savedCurrency || savedCurrency !== normalizedCurrency || rateToKrw === null) return null;
  const converted = normalizedPrice * rateToKrw;
  return Number.isFinite(converted) && converted > 0 ? converted : null;
}

function baselineFromScenario(scenario: ProductMarginScenarioLike) {
  const sellingPrice = positiveFiniteNumber(scenario.inputs.sellingPrice);
  if (sellingPrice === null) return { calculation: null, reason: "invalid-baseline" as const };

  const fixedCosts = Object.fromEntries(
    fixedCostFields.map((field) => [field, nonNegativeFiniteNumber(scenario.inputs[field])]),
  ) as Record<(typeof fixedCostFields)[number], number | null>;
  if (fixedCostFields.some((field) => fixedCosts[field] === null)) {
    return { calculation: null, reason: "invalid-baseline" as const };
  }

  const variableRates = Object.fromEntries(
    variableRateFields.map((field) => [field, nonNegativeFiniteNumber(scenario.inputs[field])]),
  ) as Record<(typeof variableRateFields)[number], number | null>;
  if (variableRateFields.some((field) => variableRates[field] === null)) {
    return { calculation: null, reason: "missing-or-invalid-fees" as const };
  }

  const calculation = calculateMargin({
    sellingPrice,
    purchaseCost: fixedCosts.purchaseCost!,
    internationalShipping: fixedCosts.internationalShipping!,
    localShipping: fixedCosts.localShipping!,
    fulfillmentCost: fixedCosts.fulfillmentCost!,
    fixedCost: fixedCosts.fixedCost!,
    platformFee: variableRates.platformFee!,
    paymentFee: variableRates.paymentFee!,
    taxRate: variableRates.taxRate!,
    adRate: variableRates.adRate!,
    reserveRate: variableRates.reserveRate!,
  });
  const savedProfit = finiteNumber(scenario.result.profit);
  const savedMargin = finiteNumber(scenario.result.margin);
  if (savedProfit === null || savedMargin === null) {
    return { calculation: null, reason: "invalid-baseline" as const };
  }
  if (!approximatelyEqual(calculation.profit, savedProfit) || !approximatelyEqual(calculation.margin, savedMargin)) {
    return { calculation: null, reason: "inconsistent-baseline" as const };
  }
  return { calculation, reason: null };
}

function calculationWithEdits(
  baseline: ProductMarginCalculation,
  edit: ProductMarginChannelEdit,
) {
  const next = { ...baseline } as ProductMarginCalculation;
  for (const field of editableFields) {
    const value = edit[field];
    if (value === undefined) continue;
    const normalized = field === "sellingPrice"
      ? positiveFiniteNumber(value)
      : nonNegativeFiniteNumber(value);
    if (normalized === null) return null;
    next[field] = normalized;
  }
  return calculateMargin(next);
}

export function evaluateProductMarginLossWarning({
  productId,
  scenarios,
  edit,
}: {
  productId: string;
  scenarios: readonly ProductMarginScenarioLike[];
  edit: ProductMarginChannelEdit;
}): ProductMarginWarningEvaluation {
  const scenario = latestProductMarginScenario(productId, edit.channelKey, scenarios);
  if (!scenario) {
    return {
      status: "unavailable",
      productId,
      channelKey: edit.channelKey,
      scenarioId: null,
      baseline: null,
      edited: null,
      warning: null,
      reason: "missing-baseline",
    };
  }

  const baselineResult = baselineFromScenario(scenario);
  if (!baselineResult.calculation) {
    return {
      status: "unavailable",
      productId,
      channelKey: edit.channelKey,
      scenarioId: scenario.id,
      baseline: null,
      edited: null,
      warning: null,
      reason: baselineResult.reason,
    };
  }

  const edited = calculationWithEdits(baselineResult.calculation, edit);
  if (!edited) {
    return {
      status: "unavailable",
      productId,
      channelKey: edit.channelKey,
      scenarioId: scenario.id,
      baseline: null,
      edited: null,
      warning: null,
      reason: "invalid-edit",
    };
  }

  const profitDeltaKrw = edited.profit - baselineResult.calculation.profit;
  const marginDeltaPercentPoints = edited.margin - baselineResult.calculation.margin;
  const kind = edited.profit < 0 || edited.margin < 0
    ? "negative-margin"
    : profitDeltaKrw < 0 || marginDeltaPercentPoints < 0
      ? "loss"
      : null;
  const warning = kind === null ? null : {
    kind,
    productId,
    channelKey: edit.channelKey,
    scenarioId: scenario.id,
    profitDeltaKrw,
    marginDeltaPercentPoints,
    profitLossKrw: Math.max(0, -profitDeltaKrw),
    marginLossPercentPoints: Math.max(0, -marginDeltaPercentPoints),
  } satisfies ProductMarginLossWarning;

  return {
    status: "ready",
    productId,
    channelKey: edit.channelKey,
    scenarioId: scenario.id,
    baseline: baselineResult.calculation,
    edited,
    warning,
    reason: null,
  };
}

export function evaluateProductMarginLossWarnings({
  productId,
  scenarios,
  edits,
}: {
  productId: string;
  scenarios: readonly ProductMarginScenarioLike[];
  edits: readonly ProductMarginChannelEdit[];
}) {
  return edits.map((edit) => evaluateProductMarginLossWarning({ productId, scenarios, edit }));
}
