import { marginRateIsFresh, type MarginRateEvidence } from "./margin-rate-freshness";
import {
  calculateMargin,
  marginResultMatches,
  type MarginEngineInput,
  type MarginEngineResult,
} from "./margin-engine";
import type { ActiveChannelKey } from "../channels/catalog";
import { marginChannelProfiles, quoteKrwPrice, type MarginCurrency } from "./channel-margin";

export type MarginSaveVerification =
  | { ok: true; result: MarginEngineResult }
  | { ok: false; reason: "selling_price_required" | "calculation_not_ready" | "exchange_rate_required" | "channel_profile_mismatch" | "exchange_conversion_mismatch" | "result_mismatch" | "exchange_rate_expired" };

export function verifyMarginScenarioForSave(input: {
  channelKey: ActiveChannelKey;
  engineInput: MarginEngineInput;
  plannedSellingPriceKrw: number;
  localSellingPrice: number | null;
  localPriceIncrement: number;
  currency: MarginCurrency;
  rateToKrw: number | null;
  suppliedResult: Record<string, unknown>;
  rateEvidence?: MarginRateEvidence | null;
  now?: number;
}): MarginSaveVerification {
  if (input.plannedSellingPriceKrw <= 0 || input.engineInput.sellingPrice <= 0) return { ok: false, reason: "selling_price_required" };
  const baseProfile = marginChannelProfiles.find((profile) => profile.key === input.channelKey);
  if (!baseProfile || baseProfile.currency !== input.currency || baseProfile.localPriceIncrement !== input.localPriceIncrement) {
    return { ok: false, reason: "channel_profile_mismatch" };
  }
  if (input.currency === "KRW" && input.rateToKrw !== 1) return { ok: false, reason: "channel_profile_mismatch" };
  if (input.currency !== "KRW" && input.rateToKrw === null) return { ok: false, reason: "exchange_rate_required" };
  if (input.currency !== "KRW" && !marginRateIsFresh(input.rateEvidence, input.now)) {
    return { ok: false, reason: "exchange_rate_expired" };
  }
  const profile = { ...baseProfile, rateToKrw: input.currency === "KRW" ? 1 : input.rateToKrw };
  let quote;
  try {
    quote = quoteKrwPrice(input.plannedSellingPriceKrw, profile);
  } catch {
    return { ok: false, reason: "exchange_conversion_mismatch" };
  }
  if (!quote
      || input.localSellingPrice === null
      || Math.abs(input.localSellingPrice - quote.localAmount) > 0.000_001
      || Math.abs(input.engineInput.sellingPrice - quote.effectiveKrwAmount) > 0.01) {
    return { ok: false, reason: "exchange_conversion_mismatch" };
  }
  const result = calculateMargin(input.engineInput);
  if (result.calculationStatus !== "ready" || result.profit === null || result.margin === null) {
    return { ok: false, reason: "calculation_not_ready" };
  }
  if (!marginResultMatches(result, input.suppliedResult)) return { ok: false, reason: "result_mismatch" };
  return { ok: true, result };
}
