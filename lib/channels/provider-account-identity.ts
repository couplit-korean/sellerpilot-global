export type ProviderAccountChannel = "lazada" | "shopee" | "ebay";

export type ProviderAccountIdentity = Readonly<{
  version: 1;
  channel: ProviderAccountChannel;
  source: "lazada.oauth_token" | "shopee.oauth_target" | "ebay.trading_get_user";
  subject: string;
}>;

export type LazadaCountryUserIdentity = Readonly<{
  country: string;
  seller_id: string;
  user_id: string;
  short_code?: string;
}>;

export const providerAccountIdentityVersionKey = "provider_account_identity_version";
export const providerAccountSubjectKey = "provider_account_subject";

const numericIdPattern = /^[1-9][0-9]{0,31}$/;
const lazadaCountries = new Set(["id", "my", "ph", "sg", "th", "vn"]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return "";
}

function containsAsciiControl(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validEiasToken(value: string) {
  return value.length >= 16
    && value.length <= 512
    && /^[A-Za-z0-9+/_=-]+$/.test(value);
}

function normalizedNumericId(value: unknown) {
  const id = normalizedText(value);
  if (!numericIdPattern.test(id)) throw new Error("PROVIDER_ACCOUNT_IDENTITY_INVALID");
  return id;
}

function providerIdentity(
  channel: ProviderAccountChannel,
  source: ProviderAccountIdentity["source"],
  subject: string,
): ProviderAccountIdentity {
  if (!subject || subject.length > 4_096) throw new Error("PROVIDER_ACCOUNT_IDENTITY_INVALID");
  return { version: 1, channel, source, subject };
}

export function readProviderAccountIdentity(
  payload: Record<string, unknown>,
  expectedChannel?: ProviderAccountChannel,
): ProviderAccountIdentity | null {
  const version = normalizedText(payload[providerAccountIdentityVersionKey]);
  const subject = normalizedText(payload[providerAccountSubjectKey]);
  if (!version && !subject) return null;
  const inferredChannel: ProviderAccountChannel | null = subject.startsWith("shopee:")
    ? "shopee"
    : subject.startsWith("lazada:")
      ? "lazada"
      : subject.startsWith("ebay:")
        ? "ebay"
        : null;
  if (version !== "v1"
      || !inferredChannel
      || subject.length > 2_048
      || (expectedChannel && inferredChannel !== expectedChannel)) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_INVALID");
  }
  const source: ProviderAccountIdentity["source"] = inferredChannel === "lazada"
    ? "lazada.oauth_token"
    : inferredChannel === "shopee"
      ? "shopee.oauth_target"
      : "ebay.trading_get_user";
  const identity = providerIdentity(inferredChannel, source, subject);
  const validSubject = inferredChannel === "shopee"
    ? /^shopee:(?:main|shop):[1-9][0-9]{0,31}$/.test(subject)
    : inferredChannel === "lazada"
      ? /^lazada:v1:[A-Za-z0-9_-]{40,512}$/.test(subject)
      : subject.startsWith("ebay:eias:")
        && validEiasToken(subject.slice("ebay:eias:".length));
  if (!validSubject) throw new Error("PROVIDER_ACCOUNT_IDENTITY_INVALID");
  return identity;
}

export function assertProviderAccountIdentity(
  payload: Record<string, unknown>,
  expected: ProviderAccountIdentity,
  required = true,
) {
  const current = readProviderAccountIdentity(payload, expected.channel);
  if (!current) {
    if (required) throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISSING");
    return;
  }
  if (current.version !== expected.version
      || current.channel !== expected.channel
      || current.subject !== expected.subject) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISMATCH");
  }
}

export function withProviderAccountIdentity(
  payload: Record<string, unknown>,
  identity: ProviderAccountIdentity,
) {
  return {
    ...payload,
    [providerAccountIdentityVersionKey]: "v1",
    [providerAccountSubjectKey]: identity.subject,
  };
}

export function withoutProviderAccountIdentity(payload: Record<string, unknown>) {
  const stripped = { ...payload };
  delete stripped[providerAccountIdentityVersionKey];
  delete stripped[providerAccountSubjectKey];
  return stripped;
}

const shopeeOAuthAccountStateKeys = [
  "main_account_id",
  "main_account_access_token",
  "main_account_refresh_token",
  "shop_id",
  "shop_ids",
  "merchant_id",
  "merchant_ids",
  "access_token",
  "refresh_token",
  "access_token_expires_at",
  "refresh_token_expires_at",
  "authorization_expires_at",
  "shopee_targets",
] as const;

export function withoutShopeeOAuthAccountState(payload: Record<string, unknown>) {
  const stripped = withoutProviderAccountIdentity(payload);
  for (const key of shopeeOAuthAccountStateKeys) delete stripped[key];
  return stripped;
}

export function normalizeLazadaProviderAccountIdentity(payload: Record<string, unknown>) {
  const accountPlatform = normalizedText(payload.account_platform).toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(accountPlatform)) {
    throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
  }
  if (!Array.isArray(payload.country_user_info) || payload.country_user_info.length === 0) {
    throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
  }

  const byCountry = new Map<string, LazadaCountryUserIdentity>();
  for (const item of payload.country_user_info) {
    const row = objectValue(item);
    if (!row) throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
    const country = normalizedText(row.country).toLowerCase();
    if (!lazadaCountries.has(country)) throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
    let sellerId: string;
    let userId: string;
    try {
      sellerId = normalizedNumericId(row.seller_id);
      userId = normalizedNumericId(row.user_id);
    } catch {
      throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
    }
    const shortCode = normalizedText(row.short_code).toUpperCase();
    if (shortCode && !/^[A-Z0-9_-]{1,64}$/.test(shortCode)) {
      throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
    }
    const normalized: LazadaCountryUserIdentity = {
      country,
      seller_id: sellerId,
      user_id: userId,
      ...(shortCode ? { short_code: shortCode } : {}),
    };
    const existing = byCountry.get(country);
    if (existing
        && (existing.seller_id !== normalized.seller_id || existing.user_id !== normalized.user_id)) {
      throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
    }
    if (!existing) byCountry.set(country, normalized);
  }

  const countryUserInfo = [...byCountry.values()].sort((left, right) =>
    left.country.localeCompare(right.country)
      || left.seller_id.localeCompare(right.seller_id)
      || left.user_id.localeCompare(right.user_id));
  const canonicalStores = countryUserInfo.map((row) => [row.country, row.seller_id, row.user_id]);
  const encodedSubject = Buffer.from(
    JSON.stringify([accountPlatform, canonicalStores]),
    "utf8",
  ).toString("base64url");
  if (encodedSubject.length < 40 || encodedSubject.length > 512) {
    throw new Error("LAZADA_ACCOUNT_IDENTITY_INVALID");
  }
  return {
    accountPlatform,
    countryUserInfo,
    identity: providerIdentity(
      "lazada",
      "lazada.oauth_token",
      `lazada:v1:${encodedSubject}`,
    ),
  };
}

export function withLazadaProviderAccountIdentity(
  payload: Record<string, unknown>,
  providerPayload: Record<string, unknown>,
) {
  const normalized = normalizeLazadaProviderAccountIdentity(providerPayload);
  return {
    payload: withProviderAccountIdentity({
      ...payload,
      account_platform: normalized.accountPlatform,
      country_user_info: normalized.countryUserInfo,
    }, normalized.identity),
    ...normalized,
  };
}

export function shopeeProviderAccountIdentity(input: {
  mainAccountId?: unknown;
  shopId?: unknown;
}) {
  const hasMainAccount = normalizedText(input.mainAccountId) !== "";
  const hasShop = normalizedText(input.shopId) !== "";
  if (hasMainAccount === hasShop) throw new Error("SHOPEE_ACCOUNT_IDENTITY_INVALID");
  let id: string;
  try {
    id = normalizedNumericId(hasMainAccount ? input.mainAccountId : input.shopId);
  } catch {
    throw new Error("SHOPEE_ACCOUNT_IDENTITY_INVALID");
  }
  return providerIdentity(
    "shopee",
    "shopee.oauth_target",
    `shopee:${hasMainAccount ? "main" : "shop"}:${id}`,
  );
}

export function shopeeProviderAccountIdentityFromPayload(payload: Record<string, unknown>) {
  const mainAccountId = normalizedText(payload.main_account_id);
  if (mainAccountId) return shopeeProviderAccountIdentity({ mainAccountId });
  return shopeeProviderAccountIdentity({ shopId: payload.shop_id });
}

function nestedRecord(payload: Record<string, unknown>, key: string) {
  return objectValue(payload[key]);
}

export function assertShopeeShopProfileTarget(
  payload: Record<string, unknown>,
  requestedShopId: unknown,
) {
  const requested = (() => {
    try {
      return normalizedNumericId(requestedShopId);
    } catch {
      throw new Error("SHOPEE_SHOP_IDENTITY_INVALID");
    }
  })();
  const response = nestedRecord(payload, "response");
  const data = nestedRecord(payload, "data");
  const nestedData = data ? nestedRecord(data, "response") : null;
  const candidates = [payload, response, data, nestedData]
    .filter((row): row is Record<string, unknown> => row !== null)
    .flatMap((row) => [row.shop_id, row.shopId])
    .map(normalizedText)
    .filter(Boolean);
  if (!candidates.length) throw new Error("SHOPEE_SHOP_IDENTITY_MISSING");
  for (const candidate of candidates) {
    let actual: string;
    try {
      actual = normalizedNumericId(candidate);
    } catch {
      throw new Error("SHOPEE_SHOP_IDENTITY_INVALID");
    }
    if (actual !== requested) throw new Error("SHOPEE_SHOP_IDENTITY_MISMATCH");
  }
  return requested;
}

function xmlElement(xml: string, name: string) {
  const expression = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}>`, "i");
  return expression.exec(xml)?.[1]?.trim() ?? "";
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function ebayProviderAccountIdentity(eiasToken: unknown) {
  const token = normalizedText(eiasToken);
  if (!validEiasToken(token)) {
    throw new Error("EBAY_ACCOUNT_IDENTITY_INVALID");
  }
  return providerIdentity(
    "ebay",
    "ebay.trading_get_user",
    `ebay:eias:${token}`,
  );
}

export function parseEbayTradingGetUserIdentity(xml: string) {
  if (typeof xml !== "string" || xml.length === 0 || xml.length > 1_000_000) {
    throw new Error("EBAY_ACCOUNT_IDENTITY_INVALID");
  }
  const ack = decodeXmlText(xmlElement(xml, "Ack"));
  if (ack !== "Success" && ack !== "Warning") {
    throw new Error("EBAY_ACCOUNT_IDENTITY_VERIFICATION_FAILED");
  }
  const eiasToken = decodeXmlText(xmlElement(xml, "EIASToken"));
  const identity = ebayProviderAccountIdentity(eiasToken);
  const rawUserId = decodeXmlText(xmlElement(xml, "UserID"));
  const userId = rawUserId && rawUserId.length <= 240 && !containsAsciiControl(rawUserId)
    ? rawUserId
    : "";
  return { identity, userId };
}
