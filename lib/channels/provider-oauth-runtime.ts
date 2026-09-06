import type { GatewayClaim } from "./gateway-contract";
import { ebayOAuthScopes } from "./ebay-oauth-scopes";
import {
  assertProviderAccountIdentity,
  shopeeProviderAccountIdentity,
  withLazadaProviderAccountIdentity,
  withProviderAccountIdentity,
  withoutProviderAccountIdentity,
  withoutShopeeOAuthAccountState,
} from "./provider-account-identity";
import { lazadaTargetCountry } from "./lazada-my-contract";
import {
  exchangeEbayOAuthToken,
  exchangeLazadaOAuthToken,
  exchangeShopeeOAuthToken,
  fetchEbayTradingUserIdentity,
  textValue,
  type CredentialRefreshSnapshot,
} from "./protocols";

export type ProviderOAuthChannel = "shopee" | "lazada" | "ebay";

export type ProviderOAuthClaim = GatewayClaim & {
  channel: ProviderOAuthChannel;
  operation: "oauth.exchange";
};

export type ProviderOAuthRuntimeHooks = {
  beginCredentialMutation: () => Promise<void>;
  beginOAuthProviderCall?: () => Promise<void>;
  stageCredentialRefresh: (refresh: CredentialRefreshSnapshot) => Promise<void>;
  assertLeaseHealthy: () => Promise<void>;
};

export type ProviderOAuthResult = {
  ok: true;
  channel: ProviderOAuthChannel;
  operation: "oauth.exchange";
  expiresAt: string | null;
  safeMessage: string;
};

export type LazadaOAuthProviderFailureCategory =
  | "SYSTEM"
  | "ISV"
  | "ISP"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "INVALID_RESPONSE";

// Lazada error payloads can include free-form messages, request ids and
// account data. Preserve only provider codes that are known protocol labels or
// documented generic Open Platform codes. Everything else stays typed but is
// deliberately collapsed to UNRECOGNIZED.
const lazadaOAuthProviderCodeAllowlist = new Map<string, string>([
  ["incompletesignature", "INCOMPLETE_SIGNATURE"],
  ["invalidsignature", "INVALID_SIGNATURE"],
  ["invalidtimestamp", "INVALID_TIMESTAMP"],
  ["invalidappkey", "INVALID_APP_KEY"],
  ["invalidcode", "INVALID_CODE"],
  ["invalidauthorizationcode", "INVALID_AUTHORIZATION_CODE"],
  ["illegalaccesstoken", "ILLEGAL_ACCESS_TOKEN"],
  ["missingparameter", "MISSING_PARAMETER"],
  ["invalidparameter", "INVALID_PARAMETER"],
  ["apicalllimit", "API_CALL_LIMIT"],
  ["5", "5"],
  ["6", "6"],
  ["30", "30"],
  ["500", "500"],
  ["501", "501"],
  ["901", "901"],
  ["1000", "1000"],
  ["missingtokenfields", "MISSING_TOKEN_FIELDS"],
  ["unrecognized", "UNRECOGNIZED"],
]);

const lazadaOAuthProviderFailureCategories = new Set<LazadaOAuthProviderFailureCategory>([
  "SYSTEM",
  "ISV",
  "ISP",
  "HTTP_4XX",
  "HTTP_5XX",
  "INVALID_RESPONSE",
]);

function recognizedLazadaOAuthProviderCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().replace(/[\s_.-]+/gu, "").toLowerCase();
  return lazadaOAuthProviderCodeAllowlist.get(normalized) ?? null;
}

function allowlistedLazadaOAuthProviderCode(value: unknown) {
  return recognizedLazadaOAuthProviderCode(value) ?? "UNRECOGNIZED";
}

function lazadaOAuthProviderFailureCategory(
  response: Response,
  data: Record<string, unknown>,
): LazadaOAuthProviderFailureCategory {
  const providerType = textValue(data, "type").toUpperCase();
  if (providerType === "SYSTEM" || providerType === "ISV" || providerType === "ISP") {
    return providerType;
  }
  if (response.status >= 500) return "HTTP_5XX";
  if (response.status >= 400) return "HTTP_4XX";
  return "INVALID_RESPONSE";
}

export class LazadaOAuthProviderFailureError extends Error {
  readonly category: LazadaOAuthProviderFailureCategory;
  readonly providerCode: string;

  constructor(category: LazadaOAuthProviderFailureCategory, providerCode: string) {
    const safeCategory = lazadaOAuthProviderFailureCategories.has(category)
      ? category
      : "INVALID_RESPONSE";
    const safeProviderCode = allowlistedLazadaOAuthProviderCode(providerCode);
    super(`LAZADA_OAUTH_PROVIDER_FAILURE:${safeCategory}:${safeProviderCode}`);
    this.name = "LazadaOAuthProviderFailureError";
    this.category = safeCategory;
    this.providerCode = safeProviderCode;
  }
}

function lazadaOAuthProviderFailure(
  remote: Awaited<ReturnType<typeof exchangeLazadaOAuthToken>>,
  missingTokenFields: boolean,
) {
  const rawError = remote.data.error;
  const responseCode = String(remote.data.code ?? "").trim();
  const responseError = String(rawError ?? "").trim();
  const recognizedCode = responseCode && responseCode !== "0"
    ? recognizedLazadaOAuthProviderCode(remote.data.code)
    : null;
  const recognizedError = responseError
    ? recognizedLazadaOAuthProviderCode(rawError)
    : null;
  const providerCode = recognizedCode
    ?? recognizedError
    ?? (missingTokenFields && (!responseCode || responseCode === "0")
      ? "MISSING_TOKEN_FIELDS"
      : "UNRECOGNIZED");
  return new LazadaOAuthProviderFailureError(
    lazadaOAuthProviderFailureCategory(remote.response, remote.data),
    providerCode,
  );
}

function numericIdList(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  return [...new Set(source.map((item) => String(item)).filter((item) => /^\d+$/.test(item)))];
}

function collectNumericIds(value: unknown, keys: readonly string[], depth = 0): string[] {
  if (depth > 8 || value == null) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => collectNumericIds(item, keys, depth + 1)))];
  }
  if (typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const direct = Object.entries(row)
    .filter(([key]) => keys.includes(key))
    .flatMap(([, item]) => numericIdList(Array.isArray(item) ? item : [item]));
  return [...new Set([
    ...direct,
    ...Object.values(row).flatMap((item) => collectNumericIds(item, keys, depth + 1)),
  ])];
}

function futureExpiry(value: unknown, fallbackSeconds: number) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, 10 * 365 * 86_400)
    : fallbackSeconds;
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function tokenExpiry(data: Record<string, unknown>, fallbackSeconds: number) {
  return futureExpiry(data.expire_in ?? data.expires_in, fallbackSeconds);
}

async function beginCredentialMutation(hooks: ProviderOAuthRuntimeHooks) {
  await hooks.assertLeaseHealthy();
  await hooks.beginCredentialMutation();
  await hooks.assertLeaseHealthy();
}

async function beginLazadaOAuthProviderCall(hooks: ProviderOAuthRuntimeHooks) {
  await hooks.assertLeaseHealthy();
  if (!hooks.beginOAuthProviderCall) {
    throw new Error("LAZADA_OAUTH_PROVIDER_CALL_FENCE_UNAVAILABLE");
  }
  await hooks.beginOAuthProviderCall();
  await hooks.assertLeaseHealthy();
}

async function stageCredentialRefresh(
  hooks: ProviderOAuthRuntimeHooks,
  refresh: CredentialRefreshSnapshot,
) {
  await hooks.assertLeaseHealthy();
  await hooks.stageCredentialRefresh(refresh);
  await hooks.assertLeaseHealthy();
}

async function exchangeShopeeOAuth(
  job: ProviderOAuthClaim & { channel: "shopee" },
  hooks: ProviderOAuthRuntimeHooks,
): Promise<ProviderOAuthResult> {
  const partnerId = textValue(job.credential, "partner_id");
  const partnerKey = textValue(job.credential, "partner_key");
  const code = String(job.request.code ?? "").trim();
  const mainAccountId = String(job.request.mainAccountId ?? "").trim();
  const shopId = String(job.request.shopId ?? "").trim();
  if (!partnerId || !partnerKey || !code || (!mainAccountId && !shopId)) {
    throw new Error("SHOPEE_OAUTH_INPUT_MISSING");
  }

  // The claimant injects the decrypted Vault credential, not callback fields.
  const previousMainAccountId = textValue(job.credential, "main_account_id");
  const previousPrimaryShopId = textValue(job.credential, "shop_id");
  const previousTargets = Array.isArray(job.credential.shopee_targets) ? job.credential.shopee_targets : [];
  const previousShopIds = [...new Set([
    ...numericIdList(job.credential.shop_ids),
    ...collectNumericIds(previousTargets.filter((target) => target && typeof target === "object" && target.type === "shop"), ["id"]),
    ...(previousPrimaryShopId ? [previousPrimaryShopId] : []),
  ])];
  const previousMerchantIds = [...new Set([
    ...numericIdList(job.credential.merchant_ids),
    ...collectNumericIds(previousTargets.filter((target) => target && typeof target === "object" && target.type === "merchant"), ["id"]),
  ])];
  if (previousMainAccountId && previousMainAccountId !== mainAccountId) {
    throw new Error("SHOPEE_OAUTH_MAIN_ACCOUNT_MISMATCH");
  }
  if ((previousShopIds.length && !previousPrimaryShopId)
      || (previousPrimaryShopId && !/^\d+$/.test(previousPrimaryShopId))) {
    throw new Error("SHOPEE_OAUTH_EXISTING_PRIMARY_REQUIRED");
  }
  if (!mainAccountId && previousShopIds.some((id) => id !== shopId)) {
    throw new Error("SHOPEE_OAUTH_EXISTING_SHOP_MISMATCH");
  }
  const accountIdentity = shopeeProviderAccountIdentity(mainAccountId
    ? { mainAccountId }
    : { shopId });
  assertProviderAccountIdentity(job.credential, accountIdentity,
    Boolean(job.credential.provider_account_subject || job.credential.provider_account_identity_version));

  await beginCredentialMutation(hooks);
  const remote = await exchangeShopeeOAuthToken({
    environment: job.environment,
    partnerId,
    partnerKey,
    code,
    ...(mainAccountId ? { mainAccountId } : { shopId }),
  });
  const accessToken = textValue(remote.data, "access_token");
  const refreshToken = textValue(remote.data, "refresh_token");
  const errorCode = textValue(remote.data, "error");
  if (!remote.response.ok || errorCode || !accessToken || !refreshToken) {
    throw new Error("SHOPEE_OAUTH_EXCHANGE_FAILED");
  }

  const refreshTokenExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const authorizationExpiresAt = String(job.request.authorizationExpiresAt ?? "").trim()
    || new Date(Date.now() + 365 * 86_400_000).toISOString();
  const returnedMainAccountIds = collectNumericIds(remote.data, ["main_account_id", "mainAccountId"]);
  if (returnedMainAccountIds.some((id) => id !== mainAccountId)) {
    throw new Error("SHOPEE_OAUTH_MAIN_ACCOUNT_MISMATCH");
  }
  const nextSecret: Record<string, unknown> = withProviderAccountIdentity(
    withoutShopeeOAuthAccountState(job.credential),
    accountIdentity,
  );

  if (mainAccountId) {
    Object.assign(nextSecret, {
      main_account_id: mainAccountId,
      main_account_access_token: accessToken,
      main_account_refresh_token: refreshToken,
      authorization_expires_at: authorizationExpiresAt,
      ...(previousPrimaryShopId ? {
        shop_id: previousPrimaryShopId,
        shop_ids: previousShopIds,
        merchant_ids: previousMerchantIds,
      } : {}),
    });
    await stageCredentialRefresh(hooks, {
      payload: withoutProviderAccountIdentity(nextSecret),
      expiresAt: authorizationExpiresAt,
      recoveryOnly: true,
    });

    const shopIds = collectNumericIds(remote.data, ["shop_id", "shopId", "shop_id_list"]);
    const merchantIds = collectNumericIds(remote.data, ["merchant_id", "merchantId", "merchant_id_list"]);
    if (!shopIds.length) throw new Error("SHOPEE_OAUTH_SHOP_IDS_MISSING");
    if (previousShopIds.some((id) => !shopIds.includes(id))
        || previousMerchantIds.some((id) => !merchantIds.includes(id))) {
      throw new Error("SHOPEE_OAUTH_EXISTING_TARGET_MISSING");
    }
    const primaryShopId = previousPrimaryShopId || shopIds[0];
    // Exchange the preserved primary first, so every partial has its own new
    // token rather than silently selecting the first provider response entry.
    const orderedShopIds = [primaryShopId, ...shopIds.filter((id) => id !== primaryShopId)];
    const targets: Array<Record<string, unknown>> = [];

    for (const targetShopId of orderedShopIds) {
      await beginCredentialMutation(hooks);
      const targetRemote = await exchangeShopeeOAuthToken({
        environment: job.environment,
        partnerId,
        partnerKey,
        refreshToken,
        shopId: targetShopId,
      });
      const targetAccess = textValue(targetRemote.data, "access_token");
      const targetRefresh = textValue(targetRemote.data, "refresh_token");
      if (!targetRemote.response.ok
          || textValue(targetRemote.data, "error")
          || !targetAccess
          || !targetRefresh) {
        throw new Error("SHOPEE_OAUTH_TARGET_EXCHANGE_FAILED");
      }
      targets.push({
        type: "shop",
        id: targetShopId,
        access_token: targetAccess,
        refresh_token: targetRefresh,
        access_token_expires_at: tokenExpiry(targetRemote.data, 14_400),
        refresh_token_expires_at: refreshTokenExpiresAt,
      });
      const primaryShop = targets.find((target) => target.type === "shop" && target.id === primaryShopId);
      const partialSecret = {
        ...nextSecret,
        main_account_id: mainAccountId,
        main_account_access_token: accessToken,
        main_account_refresh_token: refreshToken,
        authorization_expires_at: authorizationExpiresAt,
        shop_ids: shopIds,
        merchant_ids: merchantIds,
        shopee_targets: [...targets],
        ...(primaryShop ? {
          shop_id: primaryShop.id,
          access_token: primaryShop.access_token,
          refresh_token: primaryShop.refresh_token,
          access_token_expires_at: primaryShop.access_token_expires_at,
          refresh_token_expires_at: primaryShop.refresh_token_expires_at,
        } : {}),
      };
      Object.assign(nextSecret, partialSecret);
      await stageCredentialRefresh(hooks, {
        payload: partialSecret,
        expiresAt: authorizationExpiresAt,
      });
    }

    for (const merchantId of merchantIds) {
      await beginCredentialMutation(hooks);
      const targetRemote = await exchangeShopeeOAuthToken({
        environment: job.environment,
        partnerId,
        partnerKey,
        refreshToken,
        merchantId,
      });
      const targetAccess = textValue(targetRemote.data, "access_token");
      const targetRefresh = textValue(targetRemote.data, "refresh_token");
      if (!targetRemote.response.ok
          || textValue(targetRemote.data, "error")
          || !targetAccess
          || !targetRefresh) {
        throw new Error("SHOPEE_OAUTH_TARGET_EXCHANGE_FAILED");
      }
      targets.push({
        type: "merchant",
        id: merchantId,
        access_token: targetAccess,
        refresh_token: targetRefresh,
        access_token_expires_at: tokenExpiry(targetRemote.data, 14_400),
        refresh_token_expires_at: refreshTokenExpiresAt,
      });
      const partialSecret = {
        ...nextSecret,
        main_account_id: mainAccountId,
        main_account_access_token: accessToken,
        main_account_refresh_token: refreshToken,
        authorization_expires_at: authorizationExpiresAt,
        shop_ids: shopIds,
        merchant_ids: merchantIds,
        shopee_targets: [...targets],
      };
      Object.assign(nextSecret, partialSecret);
      await stageCredentialRefresh(hooks, {
        payload: partialSecret,
        expiresAt: authorizationExpiresAt,
      });
    }

    const primaryShop = targets.find((target) => target.type === "shop" && target.id === primaryShopId);
    if (!primaryShop) throw new Error("SHOPEE_OAUTH_PRIMARY_SHOP_MISSING");
    Object.assign(nextSecret, {
      main_account_id: mainAccountId,
      main_account_access_token: accessToken,
      main_account_refresh_token: refreshToken,
      shop_ids: shopIds,
      merchant_ids: merchantIds,
      shopee_targets: targets,
      shop_id: primaryShop.id,
      access_token: primaryShop.access_token,
      refresh_token: primaryShop.refresh_token,
      access_token_expires_at: primaryShop.access_token_expires_at,
      refresh_token_expires_at: primaryShop.refresh_token_expires_at,
    });
  } else {
    Object.assign(nextSecret, {
      shop_id: shopId,
      shop_ids: [shopId],
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: tokenExpiry(remote.data, 14_400),
      refresh_token_expires_at: refreshTokenExpiresAt,
      shopee_targets: [{
        type: "shop",
        id: shopId,
        access_token: accessToken,
        refresh_token: refreshToken,
        access_token_expires_at: tokenExpiry(remote.data, 14_400),
        refresh_token_expires_at: refreshTokenExpiresAt,
      }],
    });
  }

  nextSecret.authorization_expires_at = authorizationExpiresAt;
  await stageCredentialRefresh(hooks, {
    payload: { ...nextSecret },
    expiresAt: authorizationExpiresAt,
    oauthComplete: true,
  });
  return {
    ok: true,
    channel: "shopee",
    operation: "oauth.exchange",
    expiresAt: authorizationExpiresAt,
    safeMessage: `Shopee ${numericIdList(nextSecret.shop_ids).length}개 숍 OAuth 토큰 교환을 완료했습니다.`,
  };
}

async function exchangeLazadaOAuth(
  job: ProviderOAuthClaim & { channel: "lazada" },
  hooks: ProviderOAuthRuntimeHooks,
): Promise<ProviderOAuthResult> {
  const appKey = textValue(job.credential, "app_key");
  const appSecret = textValue(job.credential, "app_secret");
  const code = String(job.request.code ?? "").trim();
  if (!appKey || !appSecret || !code) throw new Error("LAZADA_OAUTH_INPUT_MISSING");
  const embeddedAppKey = code.match(/^0_([0-9]+)_/u)?.[1] ?? "";
  if (embeddedAppKey && embeddedAppKey !== appKey) {
    throw new Error("LAZADA_OAUTH_CODE_APP_KEY_MISMATCH");
  }
  const requestedCountry = String(job.request.country ?? "").trim().toLowerCase();
  const credentialCountry = textValue(job.credential, "country").toLowerCase();
  if (requestedCountry !== lazadaTargetCountry || credentialCountry !== lazadaTargetCountry) {
    throw new Error("LAZADA_OAUTH_TARGET_COUNTRY_INVALID");
  }

  await beginCredentialMutation(hooks);
  await beginLazadaOAuthProviderCall(hooks);
  const remote = await exchangeLazadaOAuthToken({ appKey, appSecret, code });
  const accessToken = textValue(remote.data, "access_token");
  const refreshToken = textValue(remote.data, "refresh_token");
  const responseCode = String(remote.data.code ?? "");
  if (!remote.response.ok
      || !accessToken
      || !refreshToken
      || (responseCode && responseCode !== "0")) {
    throw lazadaOAuthProviderFailure(remote, !accessToken || !refreshToken);
  }

  const accessExpiresAt = tokenExpiry(remote.data, 2_592_000);
  const refreshExpiresAt = futureExpiry(remote.data.refresh_expires_in, 15_552_000);
  const providerCountry = textValue(remote.data, "country").toLowerCase();
  if (providerCountry !== lazadaTargetCountry) {
    throw new Error("LAZADA_OAUTH_PROVIDER_COUNTRY_MISMATCH");
  }
  const providerAccount = withLazadaProviderAccountIdentity({}, remote.data);
  const mySeller = providerAccount.countryUserInfo.find((item) => item.country === lazadaTargetCountry);
  if (!mySeller?.seller_id) throw new Error("LAZADA_MY_SELLER_IDENTITY_MISSING");

  const credentialPayload = withProviderAccountIdentity({
    ...job.credential,
    country: lazadaTargetCountry,
    account_platform: providerAccount.accountPlatform,
    country_user_info: providerAccount.countryUserInfo,
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
  }, providerAccount.identity);
  await stageCredentialRefresh(hooks, {
    payload: credentialPayload,
    expiresAt: refreshExpiresAt,
    oauthComplete: true,
  });
  return {
    ok: true,
    channel: "lazada",
    operation: "oauth.exchange",
    expiresAt: refreshExpiresAt,
    safeMessage: "Lazada OAuth 토큰 교환을 완료했습니다.",
  };
}

async function exchangeEbayOAuth(
  job: ProviderOAuthClaim & { channel: "ebay" },
  hooks: ProviderOAuthRuntimeHooks,
): Promise<ProviderOAuthResult> {
  const clientId = textValue(job.credential, "client_id");
  const clientSecret = textValue(job.credential, "client_secret");
  const ruName = textValue(job.credential, "ru_name");
  const code = String(job.request.code ?? "").trim();
  if (!clientId || !clientSecret || !ruName || !code) throw new Error("EBAY_OAUTH_INPUT_MISSING");

  await beginCredentialMutation(hooks);
  const remote = await exchangeEbayOAuthToken({
    environment: job.environment,
    clientId,
    clientSecret,
    ruName,
    code,
  });
  const accessToken = textValue(remote.data, "access_token");
  const refreshToken = textValue(remote.data, "refresh_token");
  if (!remote.response.ok || !accessToken || !refreshToken) {
    throw new Error("EBAY_OAUTH_EXCHANGE_FAILED");
  }

  const accessExpiresAt = futureExpiry(remote.data.expires_in, 7_200);
  const refreshExpiresAt = futureExpiry(remote.data.refresh_token_expires_in, 47_304_000);
  const recoveryPayload = {
    ...job.credential,
    scopes: ebayOAuthScopes(job.credential, job.request.includeMessages === true).join(" "),
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
  };
  await stageCredentialRefresh(hooks, {
    payload: withoutProviderAccountIdentity(recoveryPayload),
    expiresAt: refreshExpiresAt,
    recoveryOnly: true,
  });
  await hooks.assertLeaseHealthy();
  const providerAccount = await fetchEbayTradingUserIdentity({
    environment: job.environment,
    accessToken,
  });
  await beginCredentialMutation(hooks);
  const credentialPayload = withProviderAccountIdentity({
    ...recoveryPayload,
    ...(providerAccount.userId ? { ebay_user_id: providerAccount.userId } : {}),
  }, providerAccount.identity);
  await stageCredentialRefresh(hooks, {
    payload: credentialPayload,
    expiresAt: refreshExpiresAt,
    oauthComplete: true,
  });
  return {
    ok: true,
    channel: "ebay",
    operation: "oauth.exchange",
    expiresAt: refreshExpiresAt,
    safeMessage: "eBay OAuth 토큰 교환을 완료했습니다.",
  };
}

export async function executeProviderOAuthExchange(
  job: ProviderOAuthClaim,
  hooks: ProviderOAuthRuntimeHooks,
): Promise<ProviderOAuthResult> {
  if (job.channel === "shopee") {
    return exchangeShopeeOAuth(job as ProviderOAuthClaim & { channel: "shopee" }, hooks);
  }
  if (job.channel === "lazada") {
    return exchangeLazadaOAuth(job as ProviderOAuthClaim & { channel: "lazada" }, hooks);
  }
  if (job.channel === "ebay") {
    return exchangeEbayOAuth(job as ProviderOAuthClaim & { channel: "ebay" }, hooks);
  }
  throw new Error("PROVIDER_OAUTH_CHANNEL_UNSUPPORTED");
}
