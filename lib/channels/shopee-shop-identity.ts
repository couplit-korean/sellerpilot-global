import { channelMarket } from "./markets";
import type { ChannelTargetRecord } from "./target-records";

/**
 * The OAuth exchange persists `shopee_targets[]` entries that only carry the rotating
 * token material, and the exact-target refresh CAS
 * (`sellerpilot_private.shopee_target_refresh_merge_v1`) refuses any other key on a
 * target entry, so provider-attested shop identity cannot live there.
 *
 * A verified shop discovery therefore records the identity under this payload key,
 * keyed by shop id. Root-level keys are carried through the target refresh CAS
 * (the candidate payload is derived from the current base payload), so the identity
 * stays bound to the active credential version and survives later token rotations.
 */
export const shopeeShopIdentityPayloadKey = "shopee_shop_identities" as const;

export type ShopeeShopIdentity = {
  shopId: string;
  marketCode: string;
  locale: string;
  language: string;
  currency: string;
  displayName: string;
  verifiedAt: string;
};

export type ShopeeIdentityChannelTarget = ChannelTargetRecord & {
  credentialId?: string;
  credentialVersion?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function numericId(value: unknown) {
  const id = text(value);
  return /^[1-9][0-9]{0,31}$/u.test(id) ? id : "";
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(text(value));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function profileValue(profile: Record<string, unknown>, ...keys: string[]) {
  const rows = [
    profile,
    record(profile.response),
    record(profile.data),
    record(record(profile.data)?.response),
  ].filter((row): row is Record<string, unknown> => row !== null);
  for (const row of rows) {
    for (const key of keys) {
      const value = text(row[key]);
      if (value) return value;
    }
  }
  return "";
}

/**
 * Derive the durable shop identity from a verified provider read of
 * `shop/get_shop_info`. Only the market/region and the display name come from the
 * provider response; locale, language and currency are the fixed properties of that
 * supported Shopee market, exactly as the verified discovery ledger resolves them.
 * Returns null when the provider did not return a supported market or a display name,
 * so callers stay blocked instead of inventing an identity.
 */
export function shopeeShopIdentityFromVerifiedProfile(input: {
  profile: unknown;
  shopId: unknown;
  verifiedAt: string;
}): ShopeeShopIdentity | null {
  const shopId = numericId(input.shopId);
  const profile = record(input.profile);
  const observedAt = Date.parse(input.verifiedAt);
  if (!shopId || !profile || !Number.isFinite(observedAt)) return null;
  const marketCode = profileValue(profile, "region", "country", "market").toUpperCase();
  const market = channelMarket("shopee", marketCode);
  const displayName = profileValue(profile, "shop_name", "shopName", "name");
  if (!market || !displayName) return null;
  return {
    shopId,
    marketCode: market.code,
    locale: market.locale,
    language: market.language,
    currency: market.currency,
    displayName,
    verifiedAt: new Date(observedAt).toISOString(),
  };
}

/**
 * Read one shop identity from the credential payload. Fail-closed: a record whose
 * market is unsupported, whose locale/language/currency disagree with that market,
 * or that is missing a field, is not an identity.
 */
export function shopeeShopIdentityForShop(payload: unknown, requestedShopId: unknown): ShopeeShopIdentity | null {
  const shopId = numericId(requestedShopId);
  const rows = record(record(payload)?.[shopeeShopIdentityPayloadKey]);
  if (!shopId || !rows) return null;
  const row = record(rows[shopId]);
  if (!row) return null;
  const market = channelMarket("shopee", text(row.market_code ?? row.marketCode));
  const displayName = text(row.display_name ?? row.displayName);
  const verifiedAt = Date.parse(text(row.verified_at ?? row.verifiedAt));
  if (!market || !displayName || !Number.isFinite(verifiedAt)) return null;
  const locale = text(row.locale);
  const language = text(row.language);
  const currency = text(row.currency);
  if (locale !== market.locale || language !== market.language || currency !== market.currency) return null;
  return {
    shopId,
    marketCode: market.code,
    locale,
    language,
    currency,
    displayName,
    verifiedAt: new Date(verifiedAt).toISOString(),
  };
}

export function shopeeShopIdentities(payload: unknown): ShopeeShopIdentity[] {
  const rows = record(record(payload)?.[shopeeShopIdentityPayloadKey]);
  if (!rows) return [];
  const identities: ShopeeShopIdentity[] = [];
  for (const key of Object.keys(rows).sort()) {
    const identity = shopeeShopIdentityForShop(payload, key);
    if (identity) identities.push(identity);
  }
  return identities;
}

/** Next credential payload that carries this verified identity, preserving every other key. */
export function withShopeeShopIdentity(payload: unknown, identity: ShopeeShopIdentity) {
  const base = record(payload) ?? {};
  const existing = record(base[shopeeShopIdentityPayloadKey]) ?? {};
  return {
    ...base,
    [shopeeShopIdentityPayloadKey]: {
      ...existing,
      [identity.shopId]: {
        market_code: identity.marketCode,
        locale: identity.locale,
        language: identity.language,
        currency: identity.currency,
        display_name: identity.displayName,
        verified_at: identity.verifiedAt,
      },
    },
  };
}

export function sameShopeeShopIdentity(left: ShopeeShopIdentity | null, right: ShopeeShopIdentity | null) {
  if (!left || !right) return false;
  return left.shopId === right.shopId
    && left.marketCode === right.marketCode
    && left.locale === right.locale
    && left.language === right.language
    && left.currency === right.currency
    && left.displayName === right.displayName;
}

/**
 * Credential payload identities as channel target records. They are bound to the
 * active credential the payload was read from, which is what keeps a shop that has
 * been synchronized once usable after the credential version rotates.
 */
export function shopeeIdentityChannelTargets(input: {
  secret: unknown;
  credentialId?: string;
  credentialVersion?: number;
}): ShopeeIdentityChannelTarget[] {
  const credentialId = text(input.credentialId);
  const credentialVersion = positiveInteger(input.credentialVersion);
  return shopeeShopIdentities(input.secret).map((identity) => ({
    targetId: identity.shopId,
    displayName: identity.displayName,
    marketCode: identity.marketCode,
    locale: identity.locale,
    language: identity.language,
    currency: identity.currency,
    verifiedAt: identity.verifiedAt,
    ...(credentialId ? { credentialId } : {}),
    ...(credentialVersion ? { credentialVersion } : {}),
  }));
}

/**
 * Merge the persisted discovery ledger with the credential payload identities.
 * The identity record comes from the same verified provider read and stays bound to
 * the active credential version, so it wins for its own shop/market pair. Preferring
 * a single row per pair also keeps the exact-target resolution unambiguous.
 */
export function mergeShopeeChannelTargets(
  ledgerTargets: ShopeeIdentityChannelTarget[],
  identityTargets: ShopeeIdentityChannelTarget[],
) {
  const merged = new Map<string, ShopeeIdentityChannelTarget>();
  const key = (target: ShopeeIdentityChannelTarget) => (
    `${target.targetId.trim()}\u0000${target.marketCode.trim().toUpperCase()}`
  );
  for (const target of ledgerTargets) merged.set(key(target), target);
  for (const target of identityTargets) merged.set(key(target), target);
  return [...merged.values()];
}
