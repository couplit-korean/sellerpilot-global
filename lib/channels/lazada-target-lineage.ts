import {
  normalizeLazadaProviderAccountIdentity,
  readProviderAccountIdentity,
} from "./provider-account-identity";
import { channelMarket, lazadaMarkets } from "./markets";
import { isCompleteChannelTarget, type ChannelTargetRecord } from "./target-records";

type LazadaCredentialEnvelope = {
  credentialId: string;
  secretPayload: Record<string, unknown>;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function attestedLazadaAccount(secretPayload: Record<string, unknown>) {
  try {
    const storedIdentity = readProviderAccountIdentity(secretPayload, "lazada");
    const normalized = normalizeLazadaProviderAccountIdentity(secretPayload);
    if (!storedIdentity || storedIdentity.subject !== normalized.identity.subject) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function activeProductionLazadaCredentialId(credentials: unknown) {
  if (!Array.isArray(credentials)) return "";
  const credential = credentials.find((value) => {
    const row = objectRecord(value);
    return row?.channel === "lazada"
      && row.environment === "production"
      && row.status === "active"
      && typeof row.id === "string"
      && Boolean(row.id.trim());
  });
  const row = objectRecord(credential);
  return typeof row?.id === "string" ? row.id.trim() : "";
}

export function activeProductionLazadaCredentialEnvelope(value: unknown): LazadaCredentialEnvelope | null {
  const row = objectRecord(value);
  const secretPayload = objectRecord(row?.secret_payload);
  const credentialId = typeof row?.credential_id === "string" ? row.credential_id.trim() : "";
  if (!credentialId || !secretPayload || !attestedLazadaAccount(secretPayload)) return null;
  return { credentialId, secretPayload };
}

export function activeLazadaSellerIdForMarket(activeCredentialSecret: unknown, marketCode: string) {
  const secretPayload = objectRecord(activeCredentialSecret);
  const activeAccount = secretPayload ? attestedLazadaAccount(secretPayload) : null;
  if (!activeAccount) return "";
  const normalizedMarketCode = marketCode.trim().toLowerCase();
  return activeAccount.countryUserInfo.find((store) => store.country === normalizedMarketCode)?.seller_id ?? "";
}

export function lineageBoundLazadaTargets(
  cachedTargets: ChannelTargetRecord[],
  activeCredentialSecret: unknown,
) {
  const secretPayload = objectRecord(activeCredentialSecret);
  const activeAccount = secretPayload ? attestedLazadaAccount(secretPayload) : null;
  if (!activeAccount) return [];

  const targetByMarketAndSeller = new Map<string, ChannelTargetRecord>();
  for (const target of cachedTargets) {
    if (!target.targetId.trim() || !isCompleteChannelTarget("lazada", target)) continue;
    const marketCode = target.marketCode.trim().toUpperCase();
    const key = `${marketCode}:${target.targetId.trim()}`;
    const current = targetByMarketAndSeller.get(key);
    if (!current || Date.parse(target.verifiedAt ?? "") >= Date.parse(current.verifiedAt ?? "")) {
      targetByMarketAndSeller.set(key, { ...target, marketCode });
    }
  }

  const expectedByMarket = new Map(
    activeAccount.countryUserInfo.map((store) => [store.country.toUpperCase(), store.seller_id]),
  );
  if (expectedByMarket.size !== activeAccount.countryUserInfo.length) return [];

  const lineageBoundTargets = lazadaMarkets.flatMap((market) => {
    const sellerId = expectedByMarket.get(market.code);
    if (!sellerId || !channelMarket("lazada", market.code)) return [];
    const target = targetByMarketAndSeller.get(`${market.code}:${sellerId}`);
    return target ? [target] : [];
  });
  return lineageBoundTargets.length === expectedByMarket.size ? lineageBoundTargets : [];
}
