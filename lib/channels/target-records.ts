import { channelMarket, shopeeMarkets } from "./markets";

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

function targetText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function shopeeShopTargetIds(secret: unknown) {
  if (!secret || typeof secret !== "object" || Array.isArray(secret)) return [];
  const payload = secret as Record<string, unknown>;
  const storedTargets = Array.isArray(payload.shopee_targets) ? payload.shopee_targets : [];
  const storedShopIds = storedTargets.flatMap((target) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) return [];
    const row = target as Record<string, unknown>;
    return row.type === "shop" ? [targetText(row.id)] : [];
  });
  const listedShopIds = Array.isArray(payload.shop_ids) ? payload.shop_ids.map(targetText) : [];
  return [...new Set([targetText(payload.shop_id), ...storedShopIds, ...listedShopIds].filter(Boolean))];
}

export function supportedShopeeTargets(targets: ChannelTargetRecord[]) {
  const newestByMarket = new Map<string, ChannelTargetRecord>();
  for (const target of targets) {
    if (!isCompleteChannelTarget("shopee", target)) continue;
    const marketCode = target.marketCode.trim().toUpperCase();
    const current = newestByMarket.get(marketCode);
    if (!current || Date.parse(target.verifiedAt ?? "") >= Date.parse(current.verifiedAt ?? "")) {
      newestByMarket.set(marketCode, { ...target, marketCode });
    }
  }
  return shopeeMarkets.flatMap((market) => {
    const target = newestByMarket.get(market.code);
    return target ? [target] : [];
  });
}

export function isCompleteChannelTarget(channel: "shopee" | "lazada", target: ChannelTargetRecord) {
  const marketCode = target.marketCode.trim().toUpperCase();
  if (!channelMarket(channel, marketCode)) return false;
  if (channel === "shopee" && !target.targetId.trim()) return false;
  return Boolean(target.locale.trim() && target.language.trim() && target.currency.trim());
}
