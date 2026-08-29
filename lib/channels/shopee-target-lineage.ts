import { shopeeMarkets } from "./markets";
import {
  shopeeShopTargetIds,
  supportedShopeeTargets,
  type ChannelTargetRecord,
} from "./target-records";

type ShopeeCredentialEnvelope = {
  credentialId: string;
  secretPayload: Record<string, unknown>;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function activeProductionShopeeCredentialId(credentials: unknown) {
  if (!Array.isArray(credentials)) return "";
  const credential = credentials.find((value) => {
    const row = objectRecord(value);
    return row?.channel === "shopee"
      && row.environment === "production"
      && row.status === "active"
      && typeof row.id === "string"
      && Boolean(row.id.trim());
  });
  const row = objectRecord(credential);
  return typeof row?.id === "string" ? row.id.trim() : "";
}

export function activeProductionShopeeCredentialEnvelope(value: unknown): ShopeeCredentialEnvelope | null {
  const row = objectRecord(value);
  const secretPayload = objectRecord(row?.secret_payload);
  const credentialId = typeof row?.credential_id === "string" ? row.credential_id.trim() : "";
  if (!credentialId || !secretPayload) return null;
  return { credentialId, secretPayload };
}

export function lineageBoundShopeeTargets(
  cachedTargets: ChannelTargetRecord[],
  activeCredentialSecret: unknown,
) {
  const activeShopIds = new Set(shopeeShopTargetIds(activeCredentialSecret));
  if (!activeShopIds.size) return [];

  const lineageBoundTargets = supportedShopeeTargets(
    cachedTargets.filter((target) => activeShopIds.has(target.targetId.trim())),
  );
  return lineageBoundTargets.length === shopeeMarkets.length ? lineageBoundTargets : [];
}
