import { channelMarket } from "./markets";

export type ChannelTargetRecord = {
  targetId: string;
  displayName: string;
  marketCode: string;
  locale: string;
  language: string;
  currency: string;
  status?: string;
  verifiedAt?: string;
};

export function isCompleteChannelTarget(channel: "shopee" | "lazada", target: ChannelTargetRecord) {
  const marketCode = target.marketCode.trim().toUpperCase();
  if (!channelMarket(channel, marketCode)) return false;
  if (channel === "shopee" && !target.targetId.trim()) return false;
  return Boolean(target.locale.trim() && target.language.trim() && target.currency.trim());
}
