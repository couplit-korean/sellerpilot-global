import type { ActiveChannelKey } from "../channels/catalog";
import {
  calculateMargin,
  type MarginEngineInput,
  type MarginEngineResult,
} from "./margin-engine";

export type MarginCurrency = "JPY" | "SGD" | "MYR" | "KRW" | "USD";

export type MarginFormBase = {
  sellingPrice: number;
  marketReferencePrice: number;
  purchaseCost: number;
  taxRate: number;
  adRate: number;
  reserveRate: number;
  targetMargin: number;
};

export type ChannelMarginCosts = {
  internationalShipping: number;
  localShipping: number;
  fulfillmentCost: number;
  fixedCost: number;
};

export type ChannelMarginProfile = {
  key: ActiveChannelKey;
  currency: MarginCurrency;
  symbol: string;
  rateToKrw: number | null;
  platformFee: number | null;
  paymentFee: number;
  localPriceIncrement: number;
  requiresManualFee?: boolean;
};

export type LocalPriceQuote = {
  currency: MarginCurrency;
  rateToKrw: number;
  roundingIncrement: number;
  localAmount: number;
  effectiveKrwAmount: number;
};

export type ChannelMarginResult = ChannelMarginProfile & MarginEngineResult & {
  engineInput: MarginEngineInput;
  costs: ChannelMarginCosts;
  feeReady: boolean;
  exchangeRateReady: boolean;
  calculationReady: boolean;
  plannedSellingPriceKrw: number;
  localSellingPrice: number | null;
  effectiveSellingPriceKrw: number | null;
  localBreakEvenPrice: number | null;
  effectiveBreakEvenPriceKrw: number | null;
  localRecommendedPrice: number | null;
  effectiveRecommendedPriceKrw: number | null;
  status: "목표 마진 충족" | "가격 조정 검토" | "계산 기준 확인" | "시장 자료 없음";
};

/**
 * Fee values are editable planning defaults, not a claim that every category
 * and seller contract uses the same rate. Unknown defaults stay null.
 */
export const marginChannelProfiles: readonly ChannelMarginProfile[] = [
  { key: "qoo10", currency: "JPY", symbol: "¥", rateToKrw: null, platformFee: 10, paymentFee: 2, localPriceIncrement: 10 },
  { key: "shopee", currency: "SGD", symbol: "S$", rateToKrw: null, platformFee: 10, paymentFee: 2.18, localPriceIncrement: 0.01 },
  { key: "lazada", currency: "MYR", symbol: "RM", rateToKrw: null, platformFee: 10, paymentFee: 3, localPriceIncrement: 0.01 },
  { key: "coupang", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: 10.8, paymentFee: 0, localPriceIncrement: 10 },
  { key: "elevenst", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: null, paymentFee: 0, localPriceIncrement: 10, requiresManualFee: true },
  { key: "smartstore", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: 5.63, paymentFee: 0, localPriceIncrement: 10 },
  { key: "ebay", currency: "USD", symbol: "$", rateToKrw: null, platformFee: 12.35, paymentFee: 2.9, localPriceIncrement: 0.01 },
  { key: "temu", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: null, paymentFee: 0, localPriceIncrement: 10, requiresManualFee: true },
] as const;

export const emptyChannelMarginCosts: ChannelMarginCosts = {
  internationalShipping: 0,
  localShipping: 0,
  fulfillmentCost: 0,
  fixedCost: 0,
};

export function createChannelCostOverrides(): Record<ActiveChannelKey, ChannelMarginCosts> {
  return Object.fromEntries(marginChannelProfiles.map((profile) => [
    profile.key,
    { ...emptyChannelMarginCosts },
  ])) as Record<ActiveChannelKey, ChannelMarginCosts>;
}

export function createPlatformFeeOverrides(): Record<ActiveChannelKey, number | null> {
  return Object.fromEntries(marginChannelProfiles.map((profile) => [
    profile.key,
    profile.platformFee,
  ])) as Record<ActiveChannelKey, number | null>;
}

export function createPaymentFeeOverrides(): Record<ActiveChannelKey, number> {
  return Object.fromEntries(marginChannelProfiles.map((profile) => [
    profile.key,
    profile.paymentFee,
  ])) as Record<ActiveChannelKey, number>;
}

function decimalsForIncrement(increment: number) {
  const normalized = increment.toString().toLocaleLowerCase();
  if (normalized.includes("e-")) return Number(normalized.split("e-")[1] ?? 0);
  return normalized.split(".")[1]?.length ?? 0;
}

function rounded(value: number, decimals = 6) {
  return Number(value.toFixed(decimals));
}

export function roundLocalPriceUp(value: number, increment: number) {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(increment) || increment <= 0) {
    throw new RangeError("INVALID_LOCAL_PRICE_ROUNDING_INPUT");
  }
  if (value === 0) return 0;
  const units = Math.ceil((value - Number.EPSILON) / increment);
  return rounded(units * increment, Math.max(0, decimalsForIncrement(increment)));
}

export function quoteKrwPrice(
  amountKrw: number,
  profile: Pick<ChannelMarginProfile, "currency" | "rateToKrw" | "localPriceIncrement">,
): LocalPriceQuote | null {
  if (!Number.isFinite(amountKrw) || amountKrw < 0) throw new RangeError("INVALID_KRW_PRICE");
  const rateToKrw = profile.currency === "KRW" ? 1 : profile.rateToKrw;
  if (rateToKrw === null || !Number.isFinite(rateToKrw) || rateToKrw <= 0) return null;
  const localAmount = roundLocalPriceUp(amountKrw / rateToKrw, profile.localPriceIncrement);
  return {
    currency: profile.currency,
    rateToKrw,
    roundingIncrement: profile.localPriceIncrement,
    localAmount,
    effectiveKrwAmount: rounded(localAmount * rateToKrw),
  };
}

export function calculateChannelMargins(
  form: MarginFormBase,
  feeOverrides: Record<ActiveChannelKey, number | null>,
  paymentFeeOverrides: Record<ActiveChannelKey, number>,
  costOverrides: Record<ActiveChannelKey, ChannelMarginCosts>,
  profiles: readonly ChannelMarginProfile[],
): ChannelMarginResult[] {
  return profiles.map((channel) => {
    const costs = costOverrides[channel.key] ?? emptyChannelMarginCosts;
    const sellingQuote = Number.isFinite(form.sellingPrice) && form.sellingPrice >= 0
      ? quoteKrwPrice(form.sellingPrice, channel)
      : null;
    const engineInput: MarginEngineInput = {
      ...form,
      sellingPrice: sellingQuote?.effectiveKrwAmount ?? form.sellingPrice,
      marketReferencePrice: form.marketReferencePrice > 0 ? form.marketReferencePrice : null,
      ...costs,
      platformFee: feeOverrides[channel.key],
      paymentFee: paymentFeeOverrides[channel.key],
    };
    const engineResult = calculateMargin(engineInput);
    const feeReady = engineResult.calculationStatus !== "fee_unconfirmed";
    const exchangeRateReady = channel.currency === "KRW" || sellingQuote !== null;
    const calculationReady = engineResult.calculationStatus === "ready" && exchangeRateReady;
    const recommendedQuote = engineResult.recommendedPrice === null
      ? null
      : quoteKrwPrice(engineResult.recommendedPrice, channel);
    const breakEvenQuote = engineResult.breakEvenPrice === null
      ? null
      : quoteKrwPrice(engineResult.breakEvenPrice, channel);
    const status: ChannelMarginResult["status"] = !calculationReady
      ? "계산 기준 확인"
      : engineResult.profitabilityStatus === "target_met"
        ? "목표 마진 충족"
        : engineResult.marketStatus === "reference_missing"
          ? "시장 자료 없음"
          : "가격 조정 검토";

    return {
      ...channel,
      ...engineResult,
      ...(!exchangeRateReady ? {
        profitabilityStatus: "unavailable" as const,
        marketStatus: "unavailable" as const,
        profit: null, margin: null, variableCost: null,
        recommendedPrice: null, breakEvenPrice: null, marketGapRate: null,
      } : {}),
      engineInput,
      costs,
      platformFee: feeOverrides[channel.key],
      paymentFee: paymentFeeOverrides[channel.key],
      feeReady,
      exchangeRateReady,
      calculationReady,
      plannedSellingPriceKrw: form.sellingPrice,
      localSellingPrice: sellingQuote?.localAmount ?? null,
      effectiveSellingPriceKrw: sellingQuote?.effectiveKrwAmount ?? null,
      localBreakEvenPrice: breakEvenQuote?.localAmount ?? null,
      effectiveBreakEvenPriceKrw: breakEvenQuote?.effectiveKrwAmount ?? null,
      localRecommendedPrice: recommendedQuote?.localAmount ?? null,
      effectiveRecommendedPriceKrw: recommendedQuote?.effectiveKrwAmount ?? null,
      status,
    };
  });
}
