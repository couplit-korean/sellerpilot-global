import { createHash, createHmac } from "node:crypto";
import { hashSync as bcryptHashSync } from "bcryptjs";

export type SecretPayload = Record<string, unknown>;

export type RemoteResponse = {
  response: Response;
  data: Record<string, unknown>;
  text: string;
};

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
  const query = input.query?.toString() ?? "";
  const url = new URL(`https://api-gateway.coupang.com${input.path}${query ? `?${query}` : ""}`);
  const response = await fetch(url, {
    method: input.method,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
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

export async function fetchNaverAccessToken(payload: SecretPayload) {
  const clientId = textValue(payload, "client_id");
  const clientSecret = textValue(payload, "client_secret");
  const type = (textValue(payload, "token_type") || "SELF").toUpperCase();
  const accountId = textValue(payload, "account_id");
  if (!clientId || !clientSecret || !["SELF", "SELLER"].includes(type) || (type === "SELLER" && !accountId)) {
    throw new Error("NAVER_CREDENTIALS_MISSING");
  }
  const timestamp = Date.now();
  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: createNaverClientSecretSign(clientId, clientSecret, timestamp),
    grant_type: "client_credentials",
    type,
  });
  if (type === "SELLER") body.set("account_id", accountId);
  const response = await fetch("https://api.commerce.naver.com/external/v1/oauth2/token", {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "SellerPilot-Naver-Commerce-Connector/1.0",
    },
    body,
  });
  const remote = await readRemoteResponse(response);
  const accessToken = textValue(remote.data, "access_token");
  if (!response.ok || !accessToken) throw new Error("NAVER_TOKEN_EXCHANGE_FAILED");
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
    signal: AbortSignal.timeout(15_000),
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
    signal: AbortSignal.timeout(30_000),
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
    signal: AbortSignal.timeout(15_000),
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
  return {
    ...payload,
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
) {
  const targets = shopeeStoredTargets(payload);
  const targetKey = targetType === "shop" ? "shop_id" : "merchant_id";
  const selectedTarget = requestedTargetId
    ? targets.find((target) => target.type === targetType && target.id === requestedTargetId)
    : targets.find((target) => target.type === targetType && target.id === textValue(payload, targetKey))
      ?? targets.find((target) => target.type === targetType);
  if (requestedTargetId && !selectedTarget) throw new Error(targetType === "shop" ? "SHOPEE_SHOP_NOT_AUTHORIZED" : "SHOPEE_MERCHANT_NOT_AUTHORIZED");
  const selectedPayload = selectedTarget ? projectShopeeTarget(payload, selectedTarget) : payload;
  const accessToken = textValue(selectedPayload, "access_token");
  const accessExpiresAt = Date.parse(textValue(selectedPayload, "access_token_expires_at"));
  if (accessToken && Number.isFinite(accessExpiresAt) && accessExpiresAt > Date.now() + bufferMs) {
    return { payload: selectedPayload, refreshed: false as const, credentialExpiresAt: textValue(payload, "authorization_expires_at") || null };
  }
  const partnerId = textValue(selectedPayload, "partner_id");
  const partnerKey = textValue(selectedPayload, "partner_key");
  const targetId = textValue(selectedPayload, targetKey);
  const refreshToken = textValue(selectedPayload, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(selectedPayload, "refresh_token_expires_at"));
  const authorizationExpiresAt = Date.parse(textValue(payload, "authorization_expires_at"));
  if (!partnerId || !partnerKey || !targetId || !refreshToken) throw new Error("SHOPEE_REFRESH_CREDENTIALS_MISSING");
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) throw new Error("SHOPEE_REFRESH_TOKEN_EXPIRED");
  if (Number.isFinite(authorizationExpiresAt) && authorizationExpiresAt <= Date.now()) throw new Error("SHOPEE_AUTHORIZATION_EXPIRED");

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
  const nextAccessExpiry = new Date(Date.now() + Number(remote.data.expire_in ?? 14_400) * 1000).toISOString();
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
  return {
    payload: {
      ...storedPayload,
      [targetKey]: targetId,
      access_token: nextAccessToken,
      refresh_token: nextRefreshToken,
      access_token_expires_at: nextAccessExpiry,
      refresh_token_expires_at: nextRefreshExpiry,
    },
    refreshed: true as const,
    credentialExpiresAt: Number.isFinite(authorizationExpiresAt) ? new Date(authorizationExpiresAt).toISOString() : null,
  };
}

export async function ensureShopeeAccessToken(
  payload: SecretPayload,
  environment: "sandbox" | "production",
  bufferMs = 10 * 60 * 1000,
  requestedShopId = "",
) {
  return ensureShopeeTargetAccessToken(payload, environment, bufferMs, "shop", requestedShopId);
}

export async function ensureShopeeMerchantAccessToken(
  payload: SecretPayload,
  environment: "sandbox" | "production",
  bufferMs = 10 * 60 * 1000,
  requestedMerchantId = "",
) {
  return ensureShopeeTargetAccessToken(payload, environment, bufferMs, "merchant", requestedMerchantId);
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
    signal: AbortSignal.timeout(15_000),
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
    signal: AbortSignal.timeout(15_000),
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
    signal: AbortSignal.timeout(15_000),
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
  const params: Record<string, string> = {
    access_token: accessToken,
    app_key: appKey,
    sign_method: "sha256",
    timestamp: Date.now().toString(),
    ...(input.params ?? {}),
  };
  params.sign = signLazadaRequest(input.path, params, appSecret);
  const method = input.method ?? "GET";
  const response = await fetch(`${endpoint}${input.path}${method === "GET" ? `?${new URLSearchParams(params)}` : ""}`, {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent": "SellerPilot-Lazada-Connector/1.0",
    },
    body: method === "POST" ? new URLSearchParams(params) : undefined,
  });
  return readRemoteResponse(response);
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
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", "user-agent": "SellerPilot-Lazada-OAuth/1.1" },
  });
  return readRemoteResponse(response);
}

export async function ensureLazadaAccessToken(
  payload: SecretPayload,
  bufferMs = 72 * 60 * 60 * 1000,
) {
  const accessToken = textValue(payload, "access_token");
  const accessExpiresAt = Date.parse(textValue(payload, "access_token_expires_at"));
  if (accessToken && Number.isFinite(accessExpiresAt) && accessExpiresAt > Date.now() + bufferMs) {
    return { payload, refreshed: false as const, credentialExpiresAt: textValue(payload, "refresh_token_expires_at") || null };
  }

  const appKey = textValue(payload, "app_key");
  const appSecret = textValue(payload, "app_secret");
  const refreshToken = textValue(payload, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(payload, "refresh_token_expires_at"));
  if (!appKey || !appSecret || !refreshToken) throw new Error("LAZADA_REFRESH_CREDENTIALS_MISSING");
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) throw new Error("LAZADA_REFRESH_TOKEN_EXPIRED");

  const remote = await exchangeLazadaOAuthToken({ appKey, appSecret, refreshToken });
  const nextAccessToken = textValue(remote.data, "access_token");
  const nextRefreshToken = textValue(remote.data, "refresh_token") || refreshToken;
  const responseCode = String(remote.data.code ?? "");
  if (!remote.response.ok || !nextAccessToken || (responseCode && responseCode !== "0")) throw new Error("LAZADA_TOKEN_REFRESH_FAILED");

  const nextAccessExpiry = new Date(Date.now() + Number(remote.data.expires_in ?? 2_592_000) * 1000).toISOString();
  const nextRefreshExpiry = new Date(Date.now() + Number(remote.data.refresh_expires_in ?? 15_552_000) * 1000).toISOString();
  return {
    payload: {
      ...payload,
      access_token: nextAccessToken,
      refresh_token: nextRefreshToken,
      access_token_expires_at: nextAccessExpiry,
      refresh_token_expires_at: nextRefreshExpiry,
    },
    refreshed: true as const,
    credentialExpiresAt: nextRefreshExpiry,
  };
}

export function buildQoo10Url(input: {
  apiKey: string;
  service: string;
  method: string;
  version?: string;
  params?: Record<string, string>;
}) {
  const url = new URL("https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi");
  url.search = new URLSearchParams({
    key: input.apiKey,
    v: input.version ?? "1.0",
    returnType: "json",
    method: `${input.service}.${input.method}`,
    ...(input.params ?? {}),
  }).toString();
  return url;
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
  const response = await fetch(buildQoo10Url({ ...input, apiKey }), {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", "user-agent": "SellerPilot-Qoo10-QAPI-Connector/1.0" },
  });
  return readRemoteResponse(response);
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
    signal: AbortSignal.timeout(15_000),
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

export async function ensureEbayAccessToken(
  payload: SecretPayload,
  environment: "sandbox" | "production",
  bufferMs = 5 * 60 * 1000,
) {
  const accessToken = textValue(payload, "access_token");
  const accessExpiresAt = Date.parse(textValue(payload, "access_token_expires_at"));
  if (accessToken && (!Number.isFinite(accessExpiresAt) || accessExpiresAt > Date.now() + bufferMs)) {
    return { payload, refreshed: false as const, credentialExpiresAt: textValue(payload, "refresh_token_expires_at") || null };
  }

  const clientId = textValue(payload, "client_id");
  const clientSecret = textValue(payload, "client_secret");
  const ruName = textValue(payload, "ru_name");
  const refreshToken = textValue(payload, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(payload, "refresh_token_expires_at"));
  if (!clientId || !clientSecret || !ruName || !refreshToken) throw new Error("EBAY_REFRESH_CREDENTIALS_MISSING");
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) throw new Error("EBAY_REFRESH_TOKEN_EXPIRED");

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
  const nextAccessExpiry = new Date(Date.now() + Number(remote.data.expires_in ?? 7_200) * 1000).toISOString();
  const credentialExpiresAt = Number.isFinite(refreshExpiresAt)
    ? new Date(refreshExpiresAt).toISOString()
    : new Date(Date.now() + 47_304_000 * 1000).toISOString();
  return {
    payload: { ...payload, access_token: nextAccessToken, access_token_expires_at: nextAccessExpiry },
    refreshed: true as const,
    credentialExpiresAt,
  };
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
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
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
