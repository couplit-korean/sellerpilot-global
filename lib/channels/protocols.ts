import { createHash, createHmac } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { hashSync as bcryptHashSync } from "bcryptjs";
import {
  assertProviderAccountIdentity,
  assertShopeeShopProfileTarget,
  normalizeLazadaProviderAccountIdentity,
  parseEbayTradingGetUserIdentity,
  readProviderAccountIdentity,
  shopeeProviderAccountIdentityFromPayload,
  withLazadaProviderAccountIdentity,
  withProviderAccountIdentity,
  withoutProviderAccountIdentity,
} from "./provider-account-identity";

export type SecretPayload = Record<string, unknown>;

export type CredentialRefreshSnapshot = {
  payload: SecretPayload;
  expiresAt: string | null;
  oauthComplete?: boolean;
  recoveryOnly?: boolean;
};

type CredentialRefreshHandler = (refresh: CredentialRefreshSnapshot) => void | Promise<void>;
type ExternalMutationStartHandler = () => void | Promise<void>;

export type RemoteResponse = {
  response: Response;
  data: Record<string, unknown>;
  text: string;
};

const channelRequestSignalStorage = new AsyncLocalStorage<AbortSignal>();

export function runWithChannelRequestSignal<T>(signal: AbortSignal, execute: () => Promise<T>) {
  return channelRequestSignalStorage.run(signal, execute);
}

function boundedChannelRequestSignal(timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const ownerSignal = channelRequestSignalStorage.getStore();
  return ownerSignal ? AbortSignal.any([ownerSignal, timeoutSignal]) : timeoutSignal;
}

export const lazadaApiEndpoints: Record<string, string> = {
  my: "https://api.lazada.com.my/rest",
  sg: "https://api.lazada.sg/rest",
  ph: "https://api.lazada.com.ph/rest",
  th: "https://api.lazada.co.th/rest",
  vn: "https://api.lazada.vn/rest",
  id: "https://api.lazada.co.id/rest",
};

export function textValue(payload: SecretPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function safeFutureIso(value: unknown, fallbackSeconds: number) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, 10 * 365 * 86_400)
    : fallbackSeconds;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function readRemoteResponse(response: Response): Promise<RemoteResponse> {
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) data = { items: parsed };
    else if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { response, data, text };
}

export function buildCoupangAuthorization(input: {
  method: string;
  path: string;
  query?: string;
  accessKey: string;
  secretKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const signedDate = now.toISOString()
    .replace(/^\d{2}(\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).*$/, "$1$2$3T$4$5$6Z");
  const method = input.method.toUpperCase();
  const query = (input.query ?? "").replace(/^\?/, "");
  const signature = createHmac("sha256", input.secretKey)
    .update(`${signedDate}${method}${input.path}${query}`)
    .digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${input.accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

export async function coupangRequest(input: {
  payload: SecretPayload;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}) {
  const accessKey = textValue(input.payload, "access_key");
  const secretKey = textValue(input.payload, "secret_key");
  const vendorId = textValue(input.payload, "vendor_id");
  if (!accessKey || !secretKey || !vendorId) throw new Error("COUPANG_CREDENTIALS_MISSING");
  // Coupang's order APIs document the timezone suffix as
  // `yyyy-MM-dd%2B09:00`. URLSearchParams also escapes the colon, but the
  // provider's strict date parser expects that colon to remain literal.
  const query = (input.query?.toString() ?? "").replace(/%3A/gi, ":");
  const url = new URL(`https://api-gateway.coupang.com${input.path}${query ? `?${query}` : ""}`);
  const response = await fetch(url, {
    method: input.method,
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json;charset=UTF-8",
      authorization: buildCoupangAuthorization({
        method: input.method,
        path: input.path,
        query,
        accessKey,
        secretKey,
      }),
      "x-requested-by": textValue(input.payload, "requested_by") || vendorId,
      "x-market": (textValue(input.payload, "market") || "KR").toUpperCase(),
      "user-agent": "SellerPilot-Coupang-Connector/1.0",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return readRemoteResponse(response);
}

export function createNaverClientSecretSign(clientId: string, clientSecret: string, timestamp: number) {
  const hashed = bcryptHashSync(`${clientId}_${timestamp}`, clientSecret);
  return Buffer.from(hashed, "utf8").toString("base64");
}

function naverTokenExchangeFailure(response: Response, remote: RemoteResponse) {
  const providerCode = textValue(remote.data, "code").toUpperCase();
  if (response.status === 403 && providerCode === "GW.IP_NOT_ALLOWED") {
    return "NAVER_IP_NOT_ALLOWED";
  }
  if (response.status === 401 || providerCode === "GW.AUTHN") {
    return "NAVER_AUTH_FAILED";
  }
  if (response.status >= 500) {
    return "NAVER_PROVIDER_UNAVAILABLE";
  }
  return "NAVER_TOKEN_EXCHANGE_FAILED";
}

export async function fetchNaverAccessToken(payload: SecretPayload) {
  const clientId = textValue(payload, "client_id");
  const clientSecret = textValue(payload, "client_secret");
  const type = (textValue(payload, "token_type") || "SELF").toUpperCase();
  const accountId = textValue(payload, "account_id");
  if (!clientId || !clientSecret || !["SELF", "SELLER"].includes(type) || (type === "SELLER" && !accountId)) {
    throw new Error("NAVER_CREDENTIALS_MISSING");
  }
  const timestamp = Date.now();
  let clientSecretSign: string;
  try {
    clientSecretSign = createNaverClientSecretSign(clientId, clientSecret, timestamp);
  } catch {
    throw new Error("NAVER_AUTH_FAILED");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: clientSecretSign,
    grant_type: "client_credentials",
    type,
  });
  if (type === "SELLER") body.set("account_id", accountId);
  const response = await fetch("https://api.commerce.naver.com/external/v1/oauth2/token", {
    method: "POST",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "SellerPilot-Naver-Commerce-Connector/1.0",
    },
    body,
  });
  const remote = await readRemoteResponse(response);
  const accessToken = textValue(remote.data, "access_token");
  if (!response.ok || !accessToken) {
    throw new Error(naverTokenExchangeFailure(response, remote));
  }
  return {
    accessToken,
    expiresIn: Number(remote.data.expires_in ?? 10_800),
    remote,
  };
}

export async function naverRequest(input: {
  accessToken: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}) {
  const query = input.query?.toString() ?? "";
  const response = await fetch(`https://api.commerce.naver.com/external${input.path}${query ? `?${query}` : ""}`, {
    method: input.method,
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "user-agent": "SellerPilot-Naver-Commerce-Connector/1.0",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return readRemoteResponse(response);
}

function temuSignedValue(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "";
  return typeof value === "string" ? serialized.slice(1, -1) : serialized;
}

export function buildTemuSignature(appSecret: string, request: Record<string, unknown>) {
  const concatenated = Object.entries(request)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}${temuSignedValue(value)}`)
    .join("");
  return createHash("md5").update(`${appSecret}${concatenated}${appSecret}`, "utf8").digest("hex").toUpperCase();
}

export async function temuRequest(input: {
  payload: SecretPayload;
  type: string;
  arguments?: Record<string, unknown>;
}) {
  const appKey = textValue(input.payload, "app_key");
  const appSecret = textValue(input.payload, "app_secret");
  const accessToken = textValue(input.payload, "access_token");
  if (!appKey || !appSecret || !accessToken) throw new Error("TEMU_CREDENTIALS_MISSING");
  const unsigned = {
    access_token: accessToken,
    app_key: appKey,
    data_type: "JSON",
    timestamp: Math.floor(Date.now() / 1000),
    type: input.type,
    version: "V1",
    ...(input.arguments ?? {}),
  };
  const response = await fetch("https://openapi-b-global.temu.com/openapi/router", {
    method: "POST",
    cache: "no-store",
    signal: boundedChannelRequestSignal(30_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SellerPilot-Temu-Connector/1.0",
    },
    body: JSON.stringify({ ...unsigned, sign: buildTemuSignature(appSecret, unsigned) }),
  });
  return readRemoteResponse(response);
}

export function shopeeEnvironment(environment: "sandbox" | "production") {
  return environment === "sandbox"
    ? "https://openplatform.sandbox.test-stable.shopee.sg"
    : "https://partner.shopeemobile.com";
}

export function shopeeAuthorizationEnvironment(environment: "sandbox" | "production") {
  return environment === "sandbox"
    ? "https://open.sandbox.test-stable.shopee.com"
    : "https://open.shopee.com";
}

function shopeeNumericId(value: string, name: string) {
  if (!/^\d+$/.test(value)) throw new Error(`SHOPEE_CREDENTIALS_MISSING:${name}`);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error(`SHOPEE_CREDENTIALS_MISSING:${name}`);
  return numeric;
}

export function buildShopeeSignature(input: {
  partnerId: string;
  partnerKey: string;
  path: string;
  timestamp: number;
  accessToken?: string;
  shopId?: string;
  merchantId?: string;
}) {
  const targetId = input.shopId ?? input.merchantId ?? "";
  const baseString = `${input.partnerId}${input.path}${input.timestamp}${input.accessToken ?? ""}${targetId}`;
  return createHmac("sha256", input.partnerKey).update(baseString).digest("hex");
}

export function buildShopeeAuthorizationUrl(input: {
  environment: "sandbox" | "production";
  partnerId: string;
  redirectUri: string;
  state: string;
}) {
  shopeeNumericId(input.partnerId, "partner_id");
  const url = new URL(`${shopeeAuthorizationEnvironment(input.environment)}/auth`);
  url.search = new URLSearchParams({
    partner_id: input.partnerId,
    auth_type: "seller",
    redirect_uri: new URL(input.redirectUri).toString(),
    response_type: "code",
    state: input.state,
  }).toString();
  return url;
}

export async function exchangeShopeeOAuthToken(input: {
  environment: "sandbox" | "production";
  partnerId: string;
  partnerKey: string;
  code?: string;
  refreshToken?: string;
  shopId?: string;
  merchantId?: string;
  mainAccountId?: string;
}) {
  const path = input.code ? "/api/v2/auth/token/get" : "/api/v2/auth/access_token/get";
  if (!input.code && !input.refreshToken) throw new Error("SHOPEE_OAUTH_GRANT_MISSING");
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = shopeeNumericId(input.partnerId, "partner_id");
  const targetEntries = [
    input.shopId ? ["shop_id", shopeeNumericId(input.shopId, "shop_id")] as const : null,
    input.merchantId ? ["merchant_id", shopeeNumericId(input.merchantId, "merchant_id")] as const : null,
    input.mainAccountId ? ["main_account_id", shopeeNumericId(input.mainAccountId, "main_account_id")] as const : null,
  ].filter((entry): entry is readonly ["shop_id" | "merchant_id" | "main_account_id", number] => entry !== null);
  if (targetEntries.length !== 1) throw new Error("SHOPEE_OAUTH_TARGET_INVALID");
  const [targetKey, targetId] = targetEntries[0];
  const url = new URL(`${shopeeEnvironment(input.environment)}${path}`);
  url.search = new URLSearchParams({
    partner_id: input.partnerId,
    timestamp: String(timestamp),
    sign: buildShopeeSignature({
      partnerId: input.partnerId,
      partnerKey: input.partnerKey,
      path,
      timestamp,
    }),
  }).toString();
  const body = input.code
    ? { code: input.code, [targetKey]: targetId, partner_id: partnerId }
    : { refresh_token: input.refreshToken, [targetKey]: targetId, partner_id: partnerId };
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SellerPilot-Shopee-OAuth/1.0",
    },
    body: JSON.stringify(body),
  });
  return readRemoteResponse(response);
}

type ShopeeStoredTarget = {
  type: "shop" | "merchant";
  id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
};

function shopeeStoredTargets(payload: SecretPayload) {
  const targets = payload.shopee_targets;
  if (!Array.isArray(targets)) return [];
  return targets.filter((item): item is ShopeeStoredTarget => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const target = item as Record<string, unknown>;
    return (target.type === "shop" || target.type === "merchant")
      && typeof target.id === "string"
      && typeof target.access_token === "string"
      && typeof target.refresh_token === "string"
      && typeof target.access_token_expires_at === "string"
      && typeof target.refresh_token_expires_at === "string";
  });
}

function projectShopeeTarget(payload: SecretPayload, target: ShopeeStoredTarget) {
  const projected = { ...payload };
  if (target.type === "shop") delete projected.merchant_id;
  else delete projected.shop_id;
  return {
    ...projected,
    ...(target.type === "shop" ? { shop_id: target.id } : { merchant_id: target.id }),
    access_token: target.access_token,
    refresh_token: target.refresh_token,
    access_token_expires_at: target.access_token_expires_at,
    refresh_token_expires_at: target.refresh_token_expires_at,
  };
}

async function ensureShopeeTargetAccessToken(
  payload: SecretPayload,
  environment: "sandbox" | "production",
  bufferMs: number,
  targetType: "shop" | "merchant",
  requestedTargetId = "",
  onExternalMutationStart?: ExternalMutationStartHandler,
  onCredentialRefresh?: CredentialRefreshHandler,
  requireProviderIdentity = false,
) {
  const storedAccountIdentity = readProviderAccountIdentity(payload, "shopee");
  const expectedAccountIdentity = shopeeProviderAccountIdentityFromPayload(payload);
  if (storedAccountIdentity) {
    assertProviderAccountIdentity(payload, expectedAccountIdentity);
  }
  const accountAttestationRequired = !storedAccountIdentity && requireProviderIdentity;
  if (accountAttestationRequired && expectedAccountIdentity.subject.startsWith("shopee:main:")) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISSING");
  }
  const targets = shopeeStoredTargets(payload);
  const targetKey = targetType === "shop" ? "shop_id" : "merchant_id";
  const selectedTarget = requestedTargetId
    ? targets.find((target) => target.type === targetType && target.id === requestedTargetId)
    : targets.find((target) => target.type === targetType && target.id === textValue(payload, targetKey))
      ?? targets.find((target) => target.type === targetType);
  if (requestedTargetId && !selectedTarget) throw new Error(targetType === "shop" ? "SHOPEE_SHOP_NOT_AUTHORIZED" : "SHOPEE_MERCHANT_NOT_AUTHORIZED");
  const selectedPayload = selectedTarget ? projectShopeeTarget(payload, selectedTarget) : payload;
  const selectedTargetId = textValue(selectedPayload, targetKey);
  if ((storedAccountIdentity || requireProviderIdentity)
      && expectedAccountIdentity.subject.startsWith("shopee:shop:")
      && (targetType !== "shop"
        || expectedAccountIdentity.subject !== `shopee:shop:${selectedTargetId}`)) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISMATCH");
  }
  const accessToken = textValue(selectedPayload, "access_token");
  const accessExpiresAt = Date.parse(textValue(selectedPayload, "access_token_expires_at"));
  if (accessToken && Number.isFinite(accessExpiresAt) && accessExpiresAt > Date.now() + bufferMs) {
    if (accountAttestationRequired) {
      const profile = await shopeeRequest({
        payload: selectedPayload,
        environment,
        method: "GET",
        path: "/api/v2/shop/get_shop_info",
      });
      if (!profile.response.ok || textValue(profile.data, "error")) {
        throw new Error("SHOPEE_ACCOUNT_IDENTITY_VERIFICATION_FAILED");
      }
      assertShopeeShopProfileTarget(profile.data, selectedTargetId);
      if (!onExternalMutationStart || !onCredentialRefresh) {
        throw new Error("PROVIDER_ACCOUNT_IDENTITY_STAGE_UNAVAILABLE");
      }
      const attestedPayload = withProviderAccountIdentity(selectedPayload, expectedAccountIdentity);
      await onExternalMutationStart?.();
      const credentialExpiresAt = textValue(payload, "authorization_expires_at") || null;
      await onCredentialRefresh({ payload: attestedPayload, expiresAt: credentialExpiresAt });
      return { payload: attestedPayload, refreshed: true as const, credentialExpiresAt };
    }
    return { payload: selectedPayload, refreshed: false as const, credentialExpiresAt: textValue(payload, "authorization_expires_at") || null };
  }
  const partnerId = textValue(selectedPayload, "partner_id");
  const partnerKey = textValue(selectedPayload, "partner_key");
  const targetId = selectedTargetId;
  const refreshToken = textValue(selectedPayload, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(selectedPayload, "refresh_token_expires_at"));
  const authorizationExpiresAt = Date.parse(textValue(payload, "authorization_expires_at"));
  if (!partnerId || !partnerKey || !targetId || !refreshToken) throw new Error("SHOPEE_REFRESH_CREDENTIALS_MISSING");
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) throw new Error("SHOPEE_REFRESH_TOKEN_EXPIRED");
  if (Number.isFinite(authorizationExpiresAt) && authorizationExpiresAt <= Date.now()) throw new Error("SHOPEE_AUTHORIZATION_EXPIRED");
  if (accountAttestationRequired && (!onExternalMutationStart || !onCredentialRefresh)) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_STAGE_UNAVAILABLE");
  }

  await onExternalMutationStart?.();
  const remote = await exchangeShopeeOAuthToken({
    environment,
    partnerId,
    partnerKey,
    refreshToken,
    ...(targetType === "shop" ? { shopId: targetId } : { merchantId: targetId }),
  });
  const nextAccessToken = textValue(remote.data, "access_token");
  const nextRefreshToken = textValue(remote.data, "refresh_token");
  const errorCode = textValue(remote.data, "error");
  if (!remote.response.ok || errorCode || !nextAccessToken || !nextRefreshToken) throw new Error("SHOPEE_TOKEN_REFRESH_FAILED");
  const nextAccessExpiry = safeFutureIso(remote.data.expire_in, 14_400);
  const nextRefreshExpiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const nextTarget: ShopeeStoredTarget | null = selectedTarget ? {
    ...selectedTarget,
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
    access_token_expires_at: nextAccessExpiry,
    refresh_token_expires_at: nextRefreshExpiry,
  } : null;
  const storedPayload = nextTarget ? {
    ...payload,
    shopee_targets: targets.map((target) => target.type === nextTarget.type && target.id === nextTarget.id ? nextTarget : target),
  } : payload;
  const refreshedTokenPayload = {
    ...storedPayload,
    [targetKey]: targetId,
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
    access_token_expires_at: nextAccessExpiry,
    refresh_token_expires_at: nextRefreshExpiry,
  };
  const credentialExpiresAt = Number.isFinite(authorizationExpiresAt)
    ? new Date(authorizationExpiresAt).toISOString()
    : null;
  if (onExternalMutationStart && onCredentialRefresh) {
    await onCredentialRefresh({
      payload: withoutProviderAccountIdentity(refreshedTokenPayload),
      expiresAt: credentialExpiresAt,
      recoveryOnly: true,
    });
  }
  if ((storedAccountIdentity || requireProviderIdentity) && targetType === "shop") {
    const profile = await shopeeRequest({
      payload: refreshedTokenPayload,
      environment,
      method: "GET",
      path: "/api/v2/shop/get_shop_info",
    });
    if (!profile.response.ok || textValue(profile.data, "error")) {
      throw new Error("SHOPEE_ACCOUNT_IDENTITY_VERIFICATION_FAILED");
    }
    assertShopeeShopProfileTarget(profile.data, targetId);
  }
  if (onExternalMutationStart && onCredentialRefresh) {
    await onExternalMutationStart();
  }
  const refreshPayload = withProviderAccountIdentity(refreshedTokenPayload, expectedAccountIdentity);
  const refresh = {
    payload: refreshPayload,
    refreshed: true as const,
    credentialExpiresAt,
  };
  await onCredentialRefresh?.({ payload: refresh.payload, expiresAt: refresh.credentialExpiresAt });
  return refresh;
}

export async function ensureShopeeAccessToken(
  payload: SecretPayload,
  environment: "sandbox" | "production",
  bufferMs = 10 * 60 * 1000,
  requestedShopId = "",
  onExternalMutationStart?: ExternalMutationStartHandler,
  onCredentialRefresh?: CredentialRefreshHandler,
  requireProviderIdentity = false,
) {
  return ensureShopeeTargetAccessToken(payload, environment, bufferMs, "shop", requestedShopId, onExternalMutationStart, onCredentialRefresh, requireProviderIdentity);
}

export async function ensureShopeeMerchantAccessToken(
  payload: SecretPayload,
  environment: "sandbox" | "production",
  bufferMs = 10 * 60 * 1000,
  requestedMerchantId = "",
  onExternalMutationStart?: ExternalMutationStartHandler,
  onCredentialRefresh?: CredentialRefreshHandler,
  requireProviderIdentity = false,
) {
  return ensureShopeeTargetAccessToken(payload, environment, bufferMs, "merchant", requestedMerchantId, onExternalMutationStart, onCredentialRefresh, requireProviderIdentity);
}

export async function shopeeRequest(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  method: "GET" | "POST";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}) {
  const partnerId = textValue(input.payload, "partner_id");
  const partnerKey = textValue(input.payload, "partner_key");
  const shopId = textValue(input.payload, "shop_id");
  const accessToken = textValue(input.payload, "access_token");
  if (!partnerId || !partnerKey || !shopId || !accessToken) throw new Error("SHOPEE_CREDENTIALS_MISSING");
  shopeeNumericId(partnerId, "partner_id");
  shopeeNumericId(shopId, "shop_id");
  const timestamp = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams(input.query);
  query.set("partner_id", partnerId);
  query.set("timestamp", String(timestamp));
  query.set("access_token", accessToken);
  query.set("shop_id", shopId);
  query.set("sign", buildShopeeSignature({ partnerId, partnerKey, path: input.path, timestamp, accessToken, shopId }));
  const response = await fetch(`${shopeeEnvironment(input.environment)}${input.path}?${query}`, {
    method: input.method,
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SellerPilot-Shopee-Connector/1.0",
    },
    body: input.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
  });
  return readRemoteResponse(response);
}

export async function shopeePartnerRequest(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  path: string;
  query?: URLSearchParams;
}) {
  const partnerId = textValue(input.payload, "partner_id");
  const partnerKey = textValue(input.payload, "partner_key");
  if (!partnerId || !partnerKey) throw new Error("SHOPEE_CREDENTIALS_MISSING");
  shopeeNumericId(partnerId, "partner_id");
  const timestamp = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams(input.query);
  query.set("partner_id", partnerId);
  query.set("timestamp", String(timestamp));
  query.set("sign", buildShopeeSignature({ partnerId, partnerKey, path: input.path, timestamp }));
  const response = await fetch(`${shopeeEnvironment(input.environment)}${input.path}?${query}`, {
    method: "GET",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: { accept: "application/json", "user-agent": "SellerPilot-Shopee-Partner/1.0" },
  });
  return readRemoteResponse(response);
}

export async function shopeeMerchantRequest(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  method: "GET" | "POST";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}) {
  const partnerId = textValue(input.payload, "partner_id");
  const partnerKey = textValue(input.payload, "partner_key");
  const merchantId = textValue(input.payload, "merchant_id");
  const accessToken = textValue(input.payload, "access_token");
  if (!partnerId || !partnerKey || !merchantId || !accessToken) throw new Error("SHOPEE_CREDENTIALS_MISSING");
  shopeeNumericId(partnerId, "partner_id");
  shopeeNumericId(merchantId, "merchant_id");
  const timestamp = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams(input.query);
  query.set("partner_id", partnerId);
  query.set("timestamp", String(timestamp));
  query.set("access_token", accessToken);
  query.set("merchant_id", merchantId);
  query.set("sign", buildShopeeSignature({ partnerId, partnerKey, path: input.path, timestamp, accessToken, merchantId }));
  const response = await fetch(`${shopeeEnvironment(input.environment)}${input.path}?${query}`, {
    method: input.method,
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SellerPilot-Shopee-GlobalProduct/1.0",
    },
    body: input.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
  });
  return readRemoteResponse(response);
}

export function signLazadaRequest(path: string, params: Record<string, string>, appSecret: string) {
  const signingInput = path + Object.keys(params).sort().map((key) => `${key}${params[key]}`).join("");
  return createHmac("sha256", appSecret).update(signingInput).digest("hex").toUpperCase();
}

export async function lazadaRequest(input: {
  payload: SecretPayload;
  path: string;
  method?: "GET" | "POST";
  params?: Record<string, string>;
}) {
  const appKey = textValue(input.payload, "app_key");
  const appSecret = textValue(input.payload, "app_secret");
  const accessToken = textValue(input.payload, "access_token");
  const country = (textValue(input.payload, "country") || "my").toLowerCase();
  const endpoint = lazadaApiEndpoints[country];
  if (!appKey || !appSecret || !accessToken || !endpoint) throw new Error("LAZADA_CREDENTIALS_MISSING");
  const method = input.method ?? "GET";
  const send = async () => {
    const params: Record<string, string> = {
      access_token: accessToken,
      app_key: appKey,
      sign_method: "sha256",
      timestamp: Date.now().toString(),
      ...(input.params ?? {}),
    };
    params.sign = signLazadaRequest(input.path, params, appSecret);
    const response = await fetch(`${endpoint}${input.path}${method === "GET" ? `?${new URLSearchParams(params)}` : ""}`, {
      method,
      cache: "no-store",
      signal: boundedChannelRequestSignal(15_000),
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "SellerPilot-Lazada-Connector/1.0",
      },
      body: method === "POST" ? new URLSearchParams(params) : undefined,
    });
    return readRemoteResponse(response);
  };

  const first = await send();
  const errorText = `${first.text} ${JSON.stringify(first.data)}`;
  if (!/api access frequency exceeds the limit/i.test(errorText)) return first;

  const banSeconds = Number(errorText.match(/ban will last\s+(\d+)\s+seconds?/i)?.[1] ?? 1);
  const retryDelayMs = Math.min(5_000, Math.max(100, banSeconds * 1_000 + 250));
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  return send();
}

export async function exchangeLazadaOAuthToken(input: {
  appKey: string;
  appSecret: string;
  code?: string;
  refreshToken?: string;
}) {
  const path = input.code ? "/auth/token/create" : "/auth/token/refresh";
  if (!input.code && !input.refreshToken) throw new Error("LAZADA_OAUTH_GRANT_MISSING");
  const params: Record<string, string> = {
    app_key: input.appKey,
    sign_method: "sha256",
    timestamp: Date.now().toString(),
    ...(input.code ? { code: input.code } : { refresh_token: input.refreshToken ?? "" }),
  };
  params.sign = signLazadaRequest(path, params, input.appSecret);
  const url = new URL(`https://auth.lazada.com/rest${path}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: { accept: "application/json", "user-agent": "SellerPilot-Lazada-OAuth/1.1" },
  });
  return readRemoteResponse(response);
}

export async function ensureLazadaAccessToken(
  payload: SecretPayload,
  bufferMs = 72 * 60 * 60 * 1000,
  onExternalMutationStart?: ExternalMutationStartHandler,
  onCredentialRefresh?: CredentialRefreshHandler,
  requireProviderIdentity = false,
) {
  const storedAccountIdentity = readProviderAccountIdentity(payload, "lazada");
  const accountAttestationRequired = !storedAccountIdentity && requireProviderIdentity;
  if (storedAccountIdentity) {
    const current = normalizeLazadaProviderAccountIdentity(payload);
    assertProviderAccountIdentity(payload, current.identity);
  }
  const accessToken = textValue(payload, "access_token");
  const accessExpiresAt = Date.parse(textValue(payload, "access_token_expires_at"));
  if (!accountAttestationRequired
      && accessToken
      && Number.isFinite(accessExpiresAt)
      && accessExpiresAt > Date.now() + bufferMs) {
    return { payload, refreshed: false as const, credentialExpiresAt: textValue(payload, "refresh_token_expires_at") || null };
  }

  const appKey = textValue(payload, "app_key");
  const appSecret = textValue(payload, "app_secret");
  const refreshToken = textValue(payload, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(payload, "refresh_token_expires_at"));
  if (!appKey || !appSecret || !refreshToken) throw new Error("LAZADA_REFRESH_CREDENTIALS_MISSING");
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) throw new Error("LAZADA_REFRESH_TOKEN_EXPIRED");
  if (accountAttestationRequired && (!onExternalMutationStart || !onCredentialRefresh)) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_STAGE_UNAVAILABLE");
  }

  await onExternalMutationStart?.();
  const remote = await exchangeLazadaOAuthToken({ appKey, appSecret, refreshToken });
  const nextAccessToken = textValue(remote.data, "access_token");
  const nextRefreshToken = textValue(remote.data, "refresh_token") || refreshToken;
  const responseCode = String(remote.data.code ?? "");
  if (!remote.response.ok || !nextAccessToken || (responseCode && responseCode !== "0")) throw new Error("LAZADA_TOKEN_REFRESH_FAILED");

  const nextAccessExpiry = safeFutureIso(remote.data.expires_in, 2_592_000);
  const nextRefreshExpiry = safeFutureIso(remote.data.refresh_expires_in, 15_552_000);
  const recoveryPayload: SecretPayload = {
    ...payload,
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
    access_token_expires_at: nextAccessExpiry,
    refresh_token_expires_at: nextRefreshExpiry,
    ...(remote.data.account_platform !== undefined
      ? { account_platform: remote.data.account_platform }
      : {}),
    ...(remote.data.country_user_info !== undefined
      ? { country_user_info: remote.data.country_user_info }
      : {}),
  };
  if (onExternalMutationStart && onCredentialRefresh) {
    await onCredentialRefresh({
      payload: withoutProviderAccountIdentity(recoveryPayload),
      expiresAt: nextRefreshExpiry,
      recoveryOnly: true,
    });
  }
  const providerAccount = normalizeLazadaProviderAccountIdentity(remote.data);
  if (storedAccountIdentity) {
    assertProviderAccountIdentity(payload, providerAccount.identity);
  }
  if (onExternalMutationStart && onCredentialRefresh) {
    await onExternalMutationStart();
  }
  const nextPayload = withLazadaProviderAccountIdentity({
    ...recoveryPayload,
  }, remote.data).payload;
  const refresh = {
    payload: nextPayload,
    refreshed: true as const,
    credentialExpiresAt: nextRefreshExpiry,
  };
  await onCredentialRefresh?.({ payload: refresh.payload, expiresAt: refresh.credentialExpiresAt });
  return refresh;
}

export function buildQoo10Url(input: {
  apiKey: string;
  service: string;
  method: string;
  version?: string;
  params?: Record<string, string>;
}) {
  const qualifiedMethod = `${input.service}.${input.method}`;
  return new URL(`https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi/${encodeURIComponent(qualifiedMethod)}`);
}

export async function qoo10Request(input: {
  payload: SecretPayload;
  service: string;
  method: string;
  version?: string;
  params?: Record<string, string>;
}) {
  const apiKey = textValue(input.payload, "api_key");
  if (!apiKey) throw new Error("QOO10_CREDENTIALS_MISSING");
  // The current QAPI developer console sends every method to the qualified
  // method path and authenticates with headers. Query-string authentication is
  // the retired OpenApiService shape and returns -90001 for current QAPI
  // methods. A JSON body also keeps long product-detail HTML out of URLs.
  const url = buildQoo10Url({
    ...input,
    apiKey,
  });
  // Runtime calls keep a minimal compatibility trace for legacy QAPI proxies;
  // buildQoo10Url itself remains the query-free canonical endpoint helper.
  url.searchParams.set("method", `${input.service}.${input.method}`);
  if (input.params?.Qty !== undefined) {
    url.searchParams.set("Qty", input.params.Qty);
  }
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ returnType: "json", ...(input.params ?? {}) }),
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      GiosisCertificationKey: apiKey,
      QAPIVersion: input.version ?? "1.0",
      "user-agent": "SellerPilot-Qoo10-QAPI-Connector/1.0",
    },
  });
  return readRemoteResponse(response);
}

function elevenstXmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]
    ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim() ?? "";
}

function elevenstXmlNodes(xml: string, tag: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapedTag}>`,
    "gi",
  );
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? "");
}

function elevenstNamespacedXmlValue(xml: string, tag: string) {
  const node = elevenstXmlNodes(xml, tag)[0] ?? "";
  return node
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

export async function elevenstCategoryRequest() {
  const response = await fetch("https://api.11st.co.kr/rest/cateservice/category", {
    method: "GET",
    cache: "no-store",
    signal: boundedChannelRequestSignal(20_000),
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "SellerPilot-11st-Category-Connector/1.0",
    },
  });
  const bytes = await response.arrayBuffer();
  let xml = "";
  try {
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    xml = new TextDecoder(contentType.includes("utf-8") ? "utf-8" : "euc-kr").decode(bytes);
  } catch {
    xml = new TextDecoder().decode(bytes);
  }
  const flatItems = elevenstXmlNodes(xml, "category").slice(0, 30_000).flatMap((node) => {
    const categoryId = elevenstNamespacedXmlValue(node, "dispNo");
    const categoryName = elevenstNamespacedXmlValue(node, "dispNm");
    if (!categoryId || !categoryName) return [];
    const parentCategoryId = elevenstNamespacedXmlValue(node, "parentDispNo") || "0";
    const depth = Number(elevenstNamespacedXmlValue(node, "depth") || "0");
    return [{
      categoryId: categoryId.slice(0, 80),
      categoryName: categoryName.slice(0, 300),
      parentCategoryId: parentCategoryId.slice(0, 80),
      depth: Number.isFinite(depth) ? depth : 0,
      leaf: elevenstNamespacedXmlValue(node, "leafYn").toUpperCase() === "Y",
    }];
  });
  const byId = new Map(flatItems.map((item) => [item.categoryId, item]));
  const items = flatItems.map((item) => {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: (typeof flatItems)[number] | undefined = item;
    while (current && !visited.has(current.categoryId) && path.length < 12) {
      visited.add(current.categoryId);
      path.unshift(current.categoryName);
      current = current.parentCategoryId === "0" ? undefined : byId.get(current.parentCategoryId);
    }
    return { ...item, categoryPath: path.join(" > ") };
  });
  const accepted = response.ok && items.length > 0;
  return {
    response,
    text: "",
    data: {
      accepted,
      items,
      totalCount: items.length,
      ...(!accepted ? { errorMessage: "11번가 공식 카테고리 목록을 확인하지 못했습니다." } : {}),
    },
  } satisfies RemoteResponse;
}

export async function elevenstRequest(input: {
  payload: SecretPayload;
  apiCode: string;
  params?: Record<string, string>;
}) {
  const apiKey = textValue(input.payload, "api_key");
  if (!apiKey) throw new Error("ELEVENST_CREDENTIALS_MISSING");
  const url = new URL("https://openapi.11st.co.kr/openapi/OpenApiService.tmall");
  url.search = new URLSearchParams({
    key: apiKey,
    apiCode: input.apiCode,
    ...(input.params ?? {}),
  }).toString();
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "SellerPilot-11st-OpenAPI-Connector/1.0",
    },
  });
  const bytes = await response.arrayBuffer();
  let xml = "";
  try {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    xml = new TextDecoder(/charset\s*=\s*["']?utf-?8/.test(contentType) ? "utf-8" : "euc-kr").decode(bytes);
  } catch {
    xml = new TextDecoder().decode(bytes);
  }
  const errorCode = elevenstXmlValue(xml, "ErrorCode") || elevenstXmlValue(xml, "ResultCode");
  const errorMessage = elevenstXmlValue(xml, "ErrorMessage") || elevenstXmlValue(xml, "ResultMessage");
  const totalCount = Number(elevenstXmlValue(xml, "TotalCount") || "0");
  const hasProduct = /<Product(?:\s[^>]*)?>/i.test(xml);
  const accepted = response.ok && !errorCode && !/<Errors?(?:\s[^>]*)?>/i.test(xml);
  return {
    response,
    text: "",
    data: {
      accepted,
      hasProduct,
      totalCount: Number.isFinite(totalCount) ? totalCount : 0,
      ...(errorCode ? { errorCode: errorCode.slice(0, 80) } : {}),
      ...(errorMessage ? { errorMessage: errorMessage.slice(0, 240) } : {}),
    },
  } satisfies RemoteResponse;
}

export async function elevenstOrderRequest(input: {
  payload: SecretPayload;
  startTime: string;
  endTime: string;
}) {
  const apiKey = textValue(input.payload, "api_key");
  if (!apiKey) throw new Error("ELEVENST_CREDENTIALS_MISSING");
  if (!/^\d{12}$/.test(input.startTime) || !/^\d{12}$/.test(input.endTime)) {
    throw new Error("ELEVENST_ORDER_RANGE_INVALID");
  }
  const url = new URL(
    `https://api.11st.co.kr/rest/ordservices/complete/${input.startTime}/${input.endTime}`,
  );
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      openapikey: apiKey,
      "user-agent": "SellerPilot-11st-Order-Connector/1.0",
    },
  });
  const bytes = await response.arrayBuffer();
  let xml = "";
  try {
    xml = new TextDecoder("euc-kr").decode(bytes);
  } catch {
    xml = new TextDecoder().decode(bytes);
  }
  const resultCode = elevenstNamespacedXmlValue(xml, "result_code")
    || elevenstNamespacedXmlValue(xml, "ResultCode")
    || elevenstXmlValue(xml, "ErrorCode");
  const resultMessage = elevenstNamespacedXmlValue(xml, "result_text")
    || elevenstNamespacedXmlValue(xml, "ResultMessage")
    || elevenstXmlValue(xml, "ErrorMessage");
  const orders = elevenstXmlNodes(xml, "order").map((order) => ({
    orderNo: elevenstNamespacedXmlValue(order, "ordNo"),
    orderSequence: elevenstNamespacedXmlValue(order, "ordPrdSeq"),
    customerName: elevenstNamespacedXmlValue(order, "ordNm")
      || elevenstNamespacedXmlValue(order, "rcvrNm"),
    productName: elevenstNamespacedXmlValue(order, "prdNm"),
    quantity: elevenstNamespacedXmlValue(order, "ordQty"),
    amountPerSequence: elevenstNamespacedXmlValue(order, "ordPayAmtPerSeq"),
    orderPaymentAmount: elevenstNamespacedXmlValue(order, "ordPayAmt"),
    unitPrice: elevenstNamespacedXmlValue(order, "selPrc"),
    orderedAt: elevenstNamespacedXmlValue(order, "ordStlEndDt")
      || elevenstNamespacedXmlValue(order, "ordDt"),
    status: "PAID",
  })).filter((order) => order.orderNo);
  return {
    response,
    text: "",
    data: {
      ...(resultCode ? { ResultCode: resultCode } : {}),
      ...(resultMessage ? { ResultMessage: resultMessage.slice(0, 240) } : {}),
      orders,
    },
  } satisfies RemoteResponse;
}

export const ebayDefaultScopes = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
] as const;

export function ebayEnvironment(environment: "sandbox" | "production") {
  return environment === "sandbox"
    ? { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" }
    : { auth: "https://auth.ebay.com", api: "https://api.ebay.com" };
}

const ebayTradingSiteIds: Readonly<Record<string, string>> = {
  EBAY_US: "0",
  EBAY_CA: "2",
  EBAY_CA_FR: "210",
  EBAY_GB: "3",
  EBAY_AU: "15",
  EBAY_AT: "16",
  EBAY_BE_FR: "23",
  EBAY_BE_NL: "123",
  EBAY_FR: "71",
  EBAY_DE: "77",
  EBAY_IT: "101",
  EBAY_NL: "146",
  EBAY_ES: "186",
  EBAY_CH: "193",
  EBAY_HK: "201",
  EBAY_IE: "205",
  EBAY_IN: "203",
  EBAY_MY: "207",
  EBAY_PH: "211",
  EBAY_PL: "212",
  EBAY_SG: "216",
};

const ebayTradingCalls = new Set(["GetMemberMessages", "GetItem", "AddMemberMessageRTQ"]);
// 1475 is the latest published Trading API release with a resolvable official
// XSD. Do not advance this header from search-index text alone.
const ebayTradingCompatibilityLevel = "1475";
const EBAY_TRADING_RESPONSE_LIMIT_BYTES = 2_000_000;

export function ebayTradingSiteId(marketplaceId: string) {
  const normalized = marketplaceId.trim().toUpperCase();
  const siteId = ebayTradingSiteIds[normalized];
  if (!siteId) throw new Error("EBAY_TRADING_SITE_UNSUPPORTED");
  return siteId;
}

export function ebayTradingXmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character);
}

type EbayXmlNode = {
  qualifiedName: string;
  localName: string;
  children: EbayXmlNode[];
  textParts: string[];
};

const EBAY_XML_MAX_DEPTH = 64;
const EBAY_XML_MAX_NODES = 50_000;

function invalidEbayTradingResponse(): never {
  throw new Error("EBAY_TRADING_RESPONSE_INVALID");
}

function validXmlCodePoint(value: number) {
  return value === 0x09
    || value === 0x0a
    || value === 0x0d
    || (value >= 0x20 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff);
}

function assertEbayXmlCharacters(value: string) {
  for (const character of value) {
    if (!validXmlCodePoint(character.codePointAt(0) ?? 0)) invalidEbayTradingResponse();
  }
}

function decodeEbayXmlEntities(value: string) {
  assertEbayXmlCharacters(value);
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const entityStart = value.indexOf("&", cursor);
    if (entityStart < 0) {
      parts.push(value.slice(cursor));
      break;
    }
    parts.push(value.slice(cursor, entityStart));
    const entityEnd = value.indexOf(";", entityStart + 1);
    if (entityEnd < 0 || entityEnd - entityStart > 16) invalidEbayTradingResponse();
    const entity = value.slice(entityStart + 1, entityEnd);
    const predefined: Readonly<Record<string, string>> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: "\"",
      apos: "'",
    };
    if (Object.hasOwn(predefined, entity)) {
      parts.push(predefined[entity]);
    } else {
      const numeric = entity.startsWith("#x")
        ? Number.parseInt(entity.slice(2), 16)
        : entity.startsWith("#")
          ? Number.parseInt(entity.slice(1), 10)
          : Number.NaN;
      const canonicalNumeric = entity.startsWith("#x")
        ? /^#x[0-9A-Fa-f]+$/.test(entity)
        : /^#[0-9]+$/.test(entity);
      if (!canonicalNumeric || !Number.isInteger(numeric) || !validXmlCodePoint(numeric)) {
        invalidEbayTradingResponse();
      }
      parts.push(String.fromCodePoint(numeric));
    }
    cursor = entityEnd + 1;
  }
  return parts.join("");
}

function ebayXmlTagEnd(xml: string, start: number) {
  let quote = "";
  for (let cursor = start; cursor < xml.length; cursor += 1) {
    const character = xml[cursor];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return cursor;
  }
  return invalidEbayTradingResponse();
}

function ebayXmlLocalName(qualifiedName: string) {
  return qualifiedName.slice(qualifiedName.lastIndexOf(":") + 1);
}

function validateEbayXmlStartTag(source: string) {
  const nameMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)/.exec(source);
  if (!nameMatch) invalidEbayTradingResponse();
  const qualifiedName = nameMatch[1];
  let cursor = qualifiedName.length;
  let selfClosing = false;
  const attributes = new Set<string>();
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    if (source[cursor] === "/") {
      if (source.slice(cursor + 1).trim()) invalidEbayTradingResponse();
      selfClosing = true;
      cursor = source.length;
      break;
    }
    const attributeMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)/.exec(source.slice(cursor));
    if (!attributeMatch || attributes.has(attributeMatch[1])) invalidEbayTradingResponse();
    attributes.add(attributeMatch[1]);
    cursor += attributeMatch[1].length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") invalidEbayTradingResponse();
    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor];
    if (quote !== "\"" && quote !== "'") invalidEbayTradingResponse();
    const valueEnd = source.indexOf(quote, cursor + 1);
    if (valueEnd < 0 || source.slice(cursor + 1, valueEnd).includes("<")) invalidEbayTradingResponse();
    decodeEbayXmlEntities(source.slice(cursor + 1, valueEnd));
    cursor = valueEnd + 1;
  }
  return { qualifiedName, selfClosing };
}

function parseEbayXml(xml: string, expectedRoot: string) {
  const stack: EbayXmlNode[] = [];
  let root: EbayXmlNode | null = null;
  let cursor = 0;
  let nodeCount = 0;

  const appendText = (value: string, cdata = false) => {
    if (!value) return;
    if (!stack.length) {
      if (value.trim()) invalidEbayTradingResponse();
      return;
    }
    if (cdata) assertEbayXmlCharacters(value);
    stack.at(-1)?.textParts.push(cdata ? value : decodeEbayXmlEntities(value));
  };

  while (cursor < xml.length) {
    const markupStart = xml.indexOf("<", cursor);
    if (markupStart < 0) {
      appendText(xml.slice(cursor));
      cursor = xml.length;
      break;
    }
    appendText(xml.slice(cursor, markupStart));

    if (xml.startsWith("<![CDATA[", markupStart)) {
      const cdataEnd = xml.indexOf("]]>", markupStart + 9);
      if (cdataEnd < 0) invalidEbayTradingResponse();
      appendText(xml.slice(markupStart + 9, cdataEnd), true);
      cursor = cdataEnd + 3;
      continue;
    }
    if (xml.startsWith("<!--", markupStart)) {
      const commentEnd = xml.indexOf("-->", markupStart + 4);
      if (commentEnd < 0 || xml.slice(markupStart + 4, commentEnd).includes("--")) {
        invalidEbayTradingResponse();
      }
      cursor = commentEnd + 3;
      continue;
    }
    if (xml.startsWith("<?", markupStart)) {
      const instructionEnd = xml.indexOf("?>", markupStart + 2);
      const instruction = instructionEnd < 0 ? "" : xml.slice(markupStart + 2, instructionEnd).trim();
      if (instructionEnd < 0
          || !/^xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"utf-8"|'utf-8'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*$/i.test(instruction)
          || root
          || stack.length) {
        invalidEbayTradingResponse();
      }
      cursor = instructionEnd + 2;
      continue;
    }
    if (xml.startsWith("<!", markupStart)) invalidEbayTradingResponse();

    const tagEnd = ebayXmlTagEnd(xml, markupStart + 1);
    const tagSource = xml.slice(markupStart + 1, tagEnd).trim();
    if (tagSource.startsWith("/")) {
      const qualifiedName = tagSource.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(qualifiedName)
          || stack.at(-1)?.qualifiedName !== qualifiedName) {
        invalidEbayTradingResponse();
      }
      stack.pop();
    } else {
      const { qualifiedName, selfClosing } = validateEbayXmlStartTag(tagSource);
      const node: EbayXmlNode = {
        qualifiedName,
        localName: ebayXmlLocalName(qualifiedName),
        children: [],
        textParts: [],
      };
      nodeCount += 1;
      if (nodeCount > EBAY_XML_MAX_NODES || stack.length + 1 > EBAY_XML_MAX_DEPTH) {
        invalidEbayTradingResponse();
      }
      const parent = stack.at(-1);
      if (parent) parent.children.push(node);
      else if (root) invalidEbayTradingResponse();
      else root = node;
      if (!selfClosing) stack.push(node);
    }
    cursor = tagEnd + 1;
  }

  if (stack.length || !root || root.localName !== expectedRoot) invalidEbayTradingResponse();
  return root;
}

function ebayXmlChildren(node: EbayXmlNode, name: string) {
  return node.children.filter((child) => child.localName === name);
}

function ebayXmlChild(node: EbayXmlNode, name: string) {
  const children = ebayXmlChildren(node, name);
  if (children.length > 1) invalidEbayTradingResponse();
  return children[0] ?? null;
}

function ebayXmlNodeText(node: EbayXmlNode | null) {
  if (!node) return "";
  if (node.children.length) invalidEbayTradingResponse();
  return node.textParts.join("").trim();
}

function ebayXmlText(node: EbayXmlNode, name: string) {
  return ebayXmlNodeText(ebayXmlChild(node, name));
}

function ebayXmlNonNegativeInteger(node: EbayXmlNode, name: string) {
  const value = Number(ebayXmlText(node, name));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseEbayTradingResponse(callName: "GetMemberMessages" | "GetItem" | "AddMemberMessageRTQ", xml: string) {
  if (!ebayTradingCalls.has(callName)
      || !xml
      || Buffer.byteLength(xml, "utf8") > EBAY_TRADING_RESPONSE_LIMIT_BYTES
      || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("EBAY_TRADING_RESPONSE_INVALID");
  }
  const expectedRoot = `${callName}Response`;
  const root = parseEbayXml(xml, expectedRoot);

  const ack = ebayXmlText(root, "Ack");
  const accepted = ack === "Success" || ack === "Warning";
  const errors = ebayXmlChildren(root, "Errors").slice(0, 20).map((entry) => ({
    errorCode: ebayXmlText(entry, "ErrorCode").slice(0, 80),
    classification: ebayXmlText(entry, "ErrorClassification").slice(0, 80),
    severity: ebayXmlText(entry, "SeverityCode").slice(0, 80),
    message: ebayXmlText(entry, "ShortMessage").slice(0, 500),
  }));
  const correlationId = ebayXmlText(root, "CorrelationID");
  const base: Record<string, unknown> = {
    Ack: ack,
    code: accepted ? "SUCCESS" : "FAILURE",
    ...(errors.length ? { errors } : {}),
    ...(correlationId ? { requestId: correlationId.slice(0, 160) } : {}),
  };
  if (callName === "AddMemberMessageRTQ") return base;

  if (callName === "GetItem") {
    const item = ebayXmlChild(root, "Item");
    return {
      ...base,
      item: {
        itemId: item ? ebayXmlText(item, "ItemID").slice(0, 19) : "",
        site: item ? ebayXmlText(item, "Site").slice(0, 80) : "",
      },
    };
  }

  const memberMessage = ebayXmlChild(root, "MemberMessage");
  const exchanges = memberMessage ? ebayXmlChildren(memberMessage, "MemberMessageExchange") : [];
  if (exchanges.length > 500) invalidEbayTradingResponse();
  const memberMessages = exchanges.map((exchange) => {
    const item = ebayXmlChild(exchange, "Item");
    const question = ebayXmlChild(exchange, "Question");
    return {
      itemId: item ? ebayXmlText(item, "ItemID").slice(0, 240) : "",
      itemTitle: item ? ebayXmlText(item, "Title").slice(0, 500) : "",
      messageId: question ? ebayXmlText(question, "MessageID").slice(0, 230) : "",
      senderId: question ? ebayXmlText(question, "SenderID").slice(0, 240) : "",
      subject: question ? ebayXmlText(question, "Subject").slice(0, 500) : "",
      // eBay documents Question.Body as at most 4,000 characters for schema
      // versions >=653. Keeping that bound also keeps each durable page below
      // the gateway transaction payload ceiling.
      body: question ? ebayXmlText(question, "Body").slice(0, 4_000) : "",
      messageStatus: ebayXmlText(exchange, "MessageStatus").slice(0, 80),
      creationDate: ebayXmlText(exchange, "CreationDate").slice(0, 80),
      lastModifiedDate: ebayXmlText(exchange, "LastModifiedDate").slice(0, 80),
    };
  });
  const paginationResult = ebayXmlChild(root, "PaginationResult");
  return {
    ...base,
    memberMessages,
    hasMoreItems: /^true$/i.test(ebayXmlText(root, "HasMoreItems")),
    paginationResult: {
      totalNumberOfPages: paginationResult ? ebayXmlNonNegativeInteger(paginationResult, "TotalNumberOfPages") : null,
      totalNumberOfEntries: paginationResult ? ebayXmlNonNegativeInteger(paginationResult, "TotalNumberOfEntries") : null,
    },
  };
}

async function readBoundedEbayTradingText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > EBAY_TRADING_RESPONSE_LIMIT_BYTES) {
    throw new Error("EBAY_TRADING_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > EBAY_TRADING_RESPONSE_LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("EBAY_TRADING_RESPONSE_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function ebayTradingRequest(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  callName: "GetMemberMessages" | "GetItem" | "AddMemberMessageRTQ";
  marketplaceId: string;
  body: string;
}) {
  const accessToken = textValue(input.payload, "access_token");
  if (!accessToken) throw new Error("EBAY_ACCESS_TOKEN_MISSING");
  if (!ebayTradingCalls.has(input.callName)
      || !new RegExp(`^<\\?xml[^>]*>\\s*<${input.callName}Request\\b`, "i").test(input.body)
      || Buffer.byteLength(input.body, "utf8") > 64_000
      || /<!DOCTYPE|<!ENTITY/i.test(input.body)) {
    throw new Error("EBAY_TRADING_REQUEST_INVALID");
  }
  const response = await fetch(`${ebayEnvironment(input.environment).api}/ws/api.dll`, {
    method: "POST",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "text/xml",
      "content-type": "text/xml;charset=UTF-8",
      "x-ebay-api-call-name": input.callName,
      "x-ebay-api-compatibility-level": ebayTradingCompatibilityLevel,
      "x-ebay-api-siteid": ebayTradingSiteId(input.marketplaceId),
      "x-ebay-api-iaf-token": accessToken,
      "user-agent": "SellerPilot-eBay-Trading-CS/1.0",
    },
    body: input.body,
  });
  if (response.status === 429) {
    // Trading application errors are normally XML, but an edge/proxy rate
    // response is allowed to be empty or HTML. Preserve a bounded, provider-
    // independent 429 result so the durable ASQ cooldown cannot be lost to an
    // XML parse failure after the reply mutation boundary has been recorded.
    await response.body?.cancel().catch(() => undefined);
    return {
      response,
      data: {
        Ack: "Failure",
        code: "FAILURE",
        errors: [{
          errorCode: "HTTP_429",
          classification: "SystemError",
          severity: "Error",
          message: "eBay Trading API rate limit exceeded.",
        }],
      },
      text: "",
    } satisfies RemoteResponse;
  }
  const text = await readBoundedEbayTradingText(response);
  const data = parseEbayTradingResponse(input.callName, text);
  return { response, data, text } satisfies RemoteResponse;
}

export function buildEbayConsentUrl(input: {
  environment: "sandbox" | "production";
  clientId: string;
  ruName: string;
  state: string;
  scopes?: readonly string[];
}) {
  const url = new URL(`${ebayEnvironment(input.environment).auth}/oauth2/authorize`);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.ruName,
    scope: (input.scopes ?? ebayDefaultScopes).join(" "),
    state: input.state,
  }).toString();
  return url;
}

export async function exchangeEbayOAuthToken(input: {
  environment: "sandbox" | "production";
  clientId: string;
  clientSecret: string;
  ruName: string;
  code?: string;
  refreshToken?: string;
  scopes?: readonly string[];
}) {
  const body = new URLSearchParams();
  if (input.code) {
    body.set("grant_type", "authorization_code");
    body.set("code", input.code);
    body.set("redirect_uri", input.ruName);
  } else if (input.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", input.refreshToken);
    body.set("scope", (input.scopes ?? ebayDefaultScopes).join(" "));
  } else {
    throw new Error("EBAY_OAUTH_GRANT_MISSING");
  }
  const response = await fetch(`${ebayEnvironment(input.environment).api}/identity/v1/oauth2/token`, {
    method: "POST",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64")}`,
      "user-agent": "SellerPilot-eBay-OAuth/1.0",
    },
    body,
  });
  return readRemoteResponse(response);
}

export async function fetchEbayTradingUserIdentity(input: {
  environment: "sandbox" | "production";
  accessToken: string;
}) {
  if (!input.accessToken.trim()) throw new Error("EBAY_ACCOUNT_IDENTITY_VERIFICATION_FAILED");
  const response = await fetch(`${ebayEnvironment(input.environment).api}/ws/api.dll`, {
    method: "POST",
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "text/xml",
      "content-type": "text/xml;charset=UTF-8",
      "x-ebay-api-call-name": "GetUser",
      "x-ebay-api-compatibility-level": ebayTradingCompatibilityLevel,
      "x-ebay-api-siteid": "0",
      "x-ebay-api-iaf-token": input.accessToken,
      "user-agent": "SellerPilot-eBay-Account-Identity/1.0",
    },
    body: "<?xml version=\"1.0\" encoding=\"utf-8\"?><GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\"><DetailLevel>ReturnSummary</DetailLevel></GetUserRequest>",
  });
  const xml = await response.text();
  if (!response.ok) throw new Error("EBAY_ACCOUNT_IDENTITY_VERIFICATION_FAILED");
  return parseEbayTradingGetUserIdentity(xml);
}

export async function ensureEbayAccessToken(
  payload: SecretPayload,
  environment: "sandbox" | "production",
  bufferMs = 5 * 60 * 1000,
  onExternalMutationStart?: ExternalMutationStartHandler,
  onCredentialRefresh?: CredentialRefreshHandler,
  requireProviderIdentity = false,
) {
  const storedAccountIdentity = readProviderAccountIdentity(payload, "ebay");
  const accountAttestationRequired = !storedAccountIdentity && requireProviderIdentity;
  const accessToken = textValue(payload, "access_token");
  const accessExpiresAt = Date.parse(textValue(payload, "access_token_expires_at"));
  if (accessToken && (!Number.isFinite(accessExpiresAt) || accessExpiresAt > Date.now() + bufferMs)) {
    if (accountAttestationRequired) {
      const providerAccount = await fetchEbayTradingUserIdentity({ environment, accessToken });
      if (!onExternalMutationStart || !onCredentialRefresh) {
        throw new Error("PROVIDER_ACCOUNT_IDENTITY_STAGE_UNAVAILABLE");
      }
      const credentialExpiresAtValue = Date.parse(textValue(payload, "refresh_token_expires_at"));
      const credentialExpiresAt = Number.isFinite(credentialExpiresAtValue)
        ? new Date(credentialExpiresAtValue).toISOString()
        : new Date(Date.now() + 47_304_000 * 1000).toISOString();
      const attestedPayload = withProviderAccountIdentity({
        ...payload,
        ...(providerAccount.userId ? { ebay_user_id: providerAccount.userId } : {}),
      }, providerAccount.identity);
      await onExternalMutationStart?.();
      await onCredentialRefresh({ payload: attestedPayload, expiresAt: credentialExpiresAt });
      return { payload: attestedPayload, refreshed: true as const, credentialExpiresAt };
    }
    return { payload, refreshed: false as const, credentialExpiresAt: textValue(payload, "refresh_token_expires_at") || null };
  }

  const clientId = textValue(payload, "client_id");
  const clientSecret = textValue(payload, "client_secret");
  const ruName = textValue(payload, "ru_name");
  const refreshToken = textValue(payload, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(payload, "refresh_token_expires_at"));
  if (!clientId || !clientSecret || !ruName || !refreshToken) throw new Error("EBAY_REFRESH_CREDENTIALS_MISSING");
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) throw new Error("EBAY_REFRESH_TOKEN_EXPIRED");
  if (accountAttestationRequired && (!onExternalMutationStart || !onCredentialRefresh)) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_STAGE_UNAVAILABLE");
  }

  await onExternalMutationStart?.();
  const remote = await exchangeEbayOAuthToken({
    environment,
    clientId,
    clientSecret,
    ruName,
    refreshToken,
    scopes: ebayDefaultScopes,
  });
  const nextAccessToken = textValue(remote.data, "access_token");
  if (!remote.response.ok || !nextAccessToken) throw new Error("EBAY_TOKEN_REFRESH_FAILED");
  const nextAccessExpiry = safeFutureIso(remote.data.expires_in, 7_200);
  const credentialExpiresAt = Number.isFinite(refreshExpiresAt)
    ? new Date(refreshExpiresAt).toISOString()
    : new Date(Date.now() + 47_304_000 * 1000).toISOString();
  let refreshedPayload: SecretPayload = {
    ...payload,
    access_token: nextAccessToken,
    access_token_expires_at: nextAccessExpiry,
  };
  if (storedAccountIdentity || requireProviderIdentity) {
    const providerAccount = await fetchEbayTradingUserIdentity({
      environment,
      accessToken: nextAccessToken,
    });
    if (storedAccountIdentity) assertProviderAccountIdentity(payload, providerAccount.identity);
    refreshedPayload = withProviderAccountIdentity({
      ...refreshedPayload,
      ...(providerAccount.userId ? { ebay_user_id: providerAccount.userId } : {}),
    }, providerAccount.identity);
  }
  const refresh = {
    payload: refreshedPayload,
    refreshed: true as const,
    credentialExpiresAt,
  };
  await onCredentialRefresh?.({ payload: refresh.payload, expiresAt: refresh.credentialExpiresAt });
  return refresh;
}

export async function elevenstSellerXmlRequest(input: {
  payload: SecretPayload;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: string;
}) {
  const apiKey = textValue(input.payload, "api_key");
  if (!apiKey) throw new Error("ELEVENST_CREDENTIALS_MISSING");
  if (!input.path.startsWith("/rest/")) throw new Error("ELEVENST_PATH_INVALID");
  const response = await fetch(`https://api.11st.co.kr${input.path}`, {
    method: input.method,
    cache: "no-store",
    signal: boundedChannelRequestSignal(20_000),
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "content-type": "text/xml;charset=UTF-8",
      openapikey: apiKey,
      "user-agent": "SellerPilot-11st-SellerAPI-Connector/1.0",
    },
    body: input.body,
  });
  const bytes = await response.arrayBuffer();
  let xml = "";
  try {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    xml = new TextDecoder(/charset\s*=\s*["']?utf-?8/.test(contentType) ? "utf-8" : "euc-kr").decode(bytes);
  } catch {
    xml = new TextDecoder().decode(bytes);
  }
  const resultCode = elevenstNamespacedXmlValue(xml, "resultCode")
    || elevenstNamespacedXmlValue(xml, "ResultCode")
    || elevenstNamespacedXmlValue(xml, "ErrorCode");
  const resultMessage = elevenstNamespacedXmlValue(xml, "resultMessage")
    || elevenstNamespacedXmlValue(xml, "ResultMessage")
    || elevenstNamespacedXmlValue(xml, "ErrorMessage")
    || elevenstNamespacedXmlValue(xml, "message")
    || elevenstNamespacedXmlValue(xml, "AuthMessage");
  const productNo = elevenstNamespacedXmlValue(xml, "productNo")
    || elevenstNamespacedXmlValue(xml, "prdNo");
  const productNode = elevenstXmlNodes(xml, "Product")[0] ?? "";
  const productScalarFields = [
    "prdNo", "sellerPrdCd", "prdNm", "brand", "orgnNmVal", "prdStatCd", "selStatCd", "selStatNm",
    "prdImage01", "prdImage02", "prdImage03", "prdImage04", "htmlDetail",
    "asDetail", "rtngExchDetail",
  ] as const;
  const product = Object.fromEntries(productScalarFields.flatMap((field) => {
    const value = productNode ? elevenstNamespacedXmlValue(productNode, field) : "";
    return value ? [[field, value]] : [];
  })) as Record<string, unknown>;
  const notificationNode = productNode ? elevenstXmlNodes(productNode, "ProductNotification")[0] ?? "" : "";
  if (notificationNode) {
    const type = elevenstNamespacedXmlValue(notificationNode, "type");
    const items = elevenstXmlNodes(notificationNode, "item").flatMap((itemNode) => {
      const code = elevenstNamespacedXmlValue(itemNode, "code");
      const name = elevenstNamespacedXmlValue(itemNode, "name");
      return code && name ? [{ code, name }] : [];
    });
    if (type && items.length) product.ProductNotification = { type, item: items };
  }
  const products = elevenstXmlNodes(xml, "product").slice(0, 500).map((node) => ({
    productNo: elevenstNamespacedXmlValue(node, "prdNo"),
    sellerProductCode: elevenstNamespacedXmlValue(node, "sellerPrdCd"),
    statusCode: elevenstNamespacedXmlValue(node, "selStatCd"),
  }));
  const acceptedCode = !resultCode || ["0", "200", "210"].includes(resultCode);
  return {
    response,
    text: "",
    data: {
      accepted: response.ok && acceptedCode,
      ...(resultCode ? { resultCode: resultCode.slice(0, 80) } : {}),
      ...(resultMessage ? { resultMessage: resultMessage.slice(0, 300) } : {}),
      ...(productNo ? { productNo: productNo.slice(0, 80) } : {}),
      ...(Object.keys(product).length ? { product } : {}),
      products,
    },
  } satisfies RemoteResponse;
}

export async function ebayRequest(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}) {
  const accessToken = textValue(input.payload, "access_token");
  if (!accessToken) throw new Error("EBAY_ACCESS_TOKEN_MISSING");
  const query = input.query?.toString() ?? "";
  const response = await fetch(`${ebayEnvironment(input.environment).api}${input.path}${query ? `?${query}` : ""}`, {
    method: input.method,
    cache: "no-store",
    signal: boundedChannelRequestSignal(15_000),
    headers: {
      accept: "application/json",
      "accept-language": "en-US",
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      "content-language": "en-US",
      "x-ebay-c-marketplace-id": textValue(input.payload, "marketplace_id") || "EBAY_US",
      "user-agent": "SellerPilot-eBay-Sell-Connector/1.0",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return readRemoteResponse(response);
}
