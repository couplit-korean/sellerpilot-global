import { z } from "zod";
import { gatewayClaimSchema, type GatewayClaim } from "./gateway-contract";
import { lazadaImCredentialBinding } from "./lazada-im-capability";
import {
  assertProviderAccountIdentity,
  normalizeLazadaProviderAccountIdentity,
  readProviderAccountIdentity,
} from "./provider-account-identity";
import {
  exchangeLazadaOAuthToken,
  lazadaRequest,
  providerFetch,
  textValue,
  type CredentialRefreshSnapshot,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

export const lazadaImExactContract = "sellerpilot-lazada-im-cross-border-oauth/1" as const;
export const lazadaImExactPurpose = "im_cross_border" as const;
export const lazadaImExactCountries = ["my", "ph", "sg", "th", "vn"] as const;
export type LazadaImExactCountry = typeof lazadaImExactCountries[number];

export const lazadaImExactSellerIds: Readonly<Record<LazadaImExactCountry, string>> = Object.freeze({
  my: "300872000183",
  ph: "501846640243",
  sg: "1754224042",
  th: "101407248667",
  vn: "201095728264",
});

export const lazadaImExactAdminInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), credentialId: z.string().uuid() }).strict(),
  z.object({
    action: z.enum(["start", "status"]),
    sessionId: z.string().uuid(),
    credentialId: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("bind"),
    sessionId: z.string().uuid(),
    credentialId: z.string().uuid(),
    state: z.string().min(24).max(180),
    code: z.string().min(1).max(8_000),
  }).strict(),
]);

export const lazadaImExactWorkerInput = z.object({
  action: z.enum(["pulse", "claim", "heartbeat", "begin", "provider", "stage", "complete", "review"]),
  sessionId: z.string().uuid(),
  jobId: z.string().uuid().optional(),
  claimToken: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();

export function lazadaImExactFetch(input: RequestInfo | URL, init?: RequestInit) {
  const timeout = AbortSignal.timeout(20_000);
  return providerFetch(input, {
    ...init,
    redirect: "error",
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}

export type LazadaImExactClaim = GatewayClaim & {
  channel: "lazada";
  operation: "oauth.exchange";
  environment: "production";
  attempt_count: 1;
  request: {
    code: string;
    country: "cb";
    lazadaImExactSession: string;
    oauthPurpose: typeof lazadaImExactPurpose;
    codeDelivery: "single";
  };
};

export type LazadaImExactCall = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type LazadaImExactDependencies = {
  exchangeToken?: typeof exchangeLazadaOAuthToken;
  readIm?: (input: Parameters<typeof lazadaRequest>[0]) => Promise<RemoteResponse>;
  now?: () => Date;
};

export type LazadaImExactProof = {
  readbacks: Array<{
    country: LazadaImExactCountry;
    sellerId: string;
    httpStatus: 200;
    providerCode: "0";
    remoteRequestId: string;
  }>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function fail(code: string): never {
  throw new Error(code);
}

function nonImPayload(payload: SecretPayload) {
  return Object.fromEntries(Object.entries(payload)
    .filter(([key]) => !key.startsWith("im_"))
    .sort(([left], [right]) => left.localeCompare(right)));
}

function exactCommerceSellers(payload: SecretPayload) {
  const identity = readProviderAccountIdentity(payload, "lazada");
  if (!identity) fail("LAZADA_IM_EXACT_COMMERCE_IDENTITY_REQUIRED");
  const commerce = normalizeLazadaProviderAccountIdentity(payload);
  assertProviderAccountIdentity(payload, commerce.identity);
  if (commerce.accountPlatform !== "seller_center" || commerce.countryUserInfo.length !== lazadaImExactCountries.length) {
    fail("LAZADA_IM_EXACT_COMMERCE_SELLERS_INVALID");
  }
  for (const country of lazadaImExactCountries) {
    if (commerce.countryUserInfo.find((row) => row.country === country)?.seller_id !== lazadaImExactSellerIds[country]) {
      fail("LAZADA_IM_EXACT_COMMERCE_SELLERS_INVALID");
    }
  }
  return commerce;
}

export function parseLazadaImExactClaim(value: unknown, sessionId: string): LazadaImExactClaim {
  try {
    const job = gatewayClaimSchema.parse(value);
    const request = job.request;
    const code = typeof request.code === "string" ? request.code.trim() : "";
    const embeddedAppKey = code.match(/^0_([0-9]+)_/u)?.[1] ?? "";
    if (!uuidPattern.test(sessionId)
      || job.channel !== "lazada"
      || job.operation !== "oauth.exchange"
      || job.environment !== "production"
      || job.attempt_count !== 1
      || request.lazadaImExactSession !== sessionId
      || request.oauthPurpose !== lazadaImExactPurpose
      || request.codeDelivery !== "single"
      || request.country !== "cb"
      || code.length < 1
      || code.length > 8_000
      || (embeddedAppKey && embeddedAppKey !== "137571")
      || textValue(job.credential, "app_key") !== "137451"
      || textValue(job.credential, "im_app_key") !== "137571"
      || !textValue(job.credential, "im_app_secret")) {
      fail("LAZADA_IM_EXACT_CLAIM_INVALID");
    }
    exactCommerceSellers(job.credential);
    return { ...job, request: { ...request, code } } as LazadaImExactClaim;
  } catch {
    fail("LAZADA_IM_EXACT_CLAIM_INVALID");
  }
}

function futureExpiry(value: unknown, now: Date) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 31_536_000) return null;
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function responseCountryRows(data: Record<string, unknown>) {
  const canonicalValue = data.country_user_info;
  const alternateValue = data.country_user_info_list;
  if (canonicalValue !== undefined && alternateValue !== undefined) {
    const canonical = normalizeLazadaProviderAccountIdentity({
      account_platform: data.account_platform,
      country_user_info: canonicalValue,
    });
    const alternate = normalizeLazadaProviderAccountIdentity({
      account_platform: data.account_platform,
      country_user_info: alternateValue,
    });
    if (JSON.stringify(canonical.countryUserInfo) !== JSON.stringify(alternate.countryUserInfo)) {
      fail("LAZADA_IM_EXACT_IDENTITY_CONFLICT");
    }
  }
  return canonicalValue ?? alternateValue;
}

function buildImResponseOverlay(source: SecretPayload, data: Record<string, unknown>, now: Date) {
  const next: SecretPayload = { ...source };
  delete next.im_country_user_info;
  delete next.im_country_user_info_list;
  next.im_access_token = data.access_token;
  next.im_refresh_token = data.refresh_token;
  next.im_access_token_expires_at = futureExpiry(data.expires_in, now);
  next.im_refresh_token_expires_at = futureExpiry(data.refresh_expires_in, now);
  next.im_account_platform = data.account_platform;
  next.im_country_user_info = data.country_user_info ?? data.country_user_info_list;
  if (data.country_user_info_list !== undefined) next.im_country_user_info_list = data.country_user_info_list;
  next.im_identity_source = "lazada.oauth_token";
  return next;
}

function verifiedImPayload(source: SecretPayload, recoveryPayload: SecretPayload, data: Record<string, unknown>) {
  const rows = responseCountryRows(data);
  const im = normalizeLazadaProviderAccountIdentity({
    account_platform: data.account_platform,
    country_user_info: rows,
  });
  if (im.accountPlatform !== "seller_center" || im.countryUserInfo.length !== lazadaImExactCountries.length) {
    fail("LAZADA_IM_EXACT_FIVE_COUNTRY_GRANT_REQUIRED");
  }
  for (const country of lazadaImExactCountries) {
    if (im.countryUserInfo.find((row) => row.country === country)?.seller_id !== lazadaImExactSellerIds[country]) {
      fail("LAZADA_IM_EXACT_SELLER_MISMATCH");
    }
  }
  const active: SecretPayload = {
    ...source,
    im_access_token: recoveryPayload.im_access_token,
    im_refresh_token: recoveryPayload.im_refresh_token,
    im_access_token_expires_at: recoveryPayload.im_access_token_expires_at,
    im_refresh_token_expires_at: recoveryPayload.im_refresh_token_expires_at,
    im_account_platform: im.accountPlatform,
    im_country_user_info: im.countryUserInfo,
    im_identity_source: "lazada.oauth_token",
  };
  if (data.country_user_info_list !== undefined) active.im_country_user_info_list = im.countryUserInfo;
  else delete active.im_country_user_info_list;
  if (JSON.stringify(nonImPayload(active)) !== JSON.stringify(nonImPayload(source))) {
    fail("LAZADA_IM_EXACT_COMMERCE_CHANGED");
  }
  for (const country of lazadaImExactCountries) lazadaImCredentialBinding(active, country);
  return active;
}

async function checkedLease(hook: () => Promise<void>) {
  await hook();
}

export async function executeLazadaImExactOAuth(
  job: LazadaImExactClaim,
  hooks: {
    assertLeaseHealthy: () => Promise<void>;
    beginCredentialMutation: () => Promise<void>;
    beginOAuthProviderCall: () => Promise<void>;
    stageCredentialRefresh: (refresh: CredentialRefreshSnapshot) => Promise<void>;
  },
  dependencies: LazadaImExactDependencies = {},
) {
  const exchangeToken = dependencies.exchangeToken ?? exchangeLazadaOAuthToken;
  const readIm = dependencies.readIm ?? lazadaRequest;
  const now = dependencies.now ?? (() => new Date());
  const source = job.credential;
  const appKey = textValue(source, "im_app_key");
  const appSecret = textValue(source, "im_app_secret");
  const code = job.request.code;

  await checkedLease(hooks.assertLeaseHealthy);
  await hooks.beginCredentialMutation();
  await checkedLease(hooks.assertLeaseHealthy);
  await hooks.beginOAuthProviderCall();
  await checkedLease(hooks.assertLeaseHealthy);
  const remote = await exchangeToken({ appKey, appSecret, code });
  const accessToken = textValue(remote.data, "access_token");
  const refreshToken = textValue(remote.data, "refresh_token");
  const responseCode = String(remote.data.code ?? "").trim();
  if (!remote.response.ok || !accessToken || !refreshToken || (responseCode && responseCode !== "0")) {
    fail("LAZADA_IM_EXACT_PROVIDER_EXCHANGE_FAILED");
  }

  const responseAt = now();
  const recoveryPayload = buildImResponseOverlay(source, {
    ...remote.data,
    access_token: accessToken,
    refresh_token: refreshToken,
  }, responseAt);
  const credentialExpiresAt = textValue(source, "refresh_token_expires_at") || null;
  await checkedLease(hooks.assertLeaseHealthy);
  await hooks.stageCredentialRefresh({
    payload: recoveryPayload,
    expiresAt: credentialExpiresAt,
    recoveryOnly: true,
  });
  await checkedLease(hooks.assertLeaseHealthy);

  if (!recoveryPayload.im_access_token_expires_at || !recoveryPayload.im_refresh_token_expires_at) {
    fail("LAZADA_IM_EXACT_TOKEN_EXPIRY_INVALID");
  }
  const activePayload = verifiedImPayload(source, recoveryPayload, remote.data);
  await hooks.beginCredentialMutation();
  await checkedLease(hooks.assertLeaseHealthy);
  await hooks.stageCredentialRefresh({
    payload: activePayload,
    expiresAt: credentialExpiresAt,
    recoveryOnly: false,
  });
  await checkedLease(hooks.assertLeaseHealthy);

  const readbacks: LazadaImExactProof["readbacks"] = [];
  for (const country of lazadaImExactCountries) {
    const binding = lazadaImCredentialBinding(activePayload, country);
    const observedAt = now();
    const remoteRead = await readIm({
      payload: { ...activePayload, country },
      path: "/im/session/list",
      params: { start_time: String(observedAt.getTime()), page_size: "1" },
    });
    await checkedLease(hooks.assertLeaseHealthy);
    const data = remoteRead.data.data as Record<string, unknown> | undefined;
    const remoteRequestId = textValue(remoteRead.data, "request_id")
      || textValue(remoteRead.data, "requestId");
    if (!remoteRead.response.ok
      || remoteRead.response.status !== 200
      || String(remoteRead.data.code ?? "") !== "0"
      || !data
      || !Array.isArray(data.session_list)
      || !remoteRequestId
      || remoteRequestId.length > 240
      || [...remoteRequestId].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
      })) {
      fail("LAZADA_IM_EXACT_FIVE_COUNTRY_READBACK_FAILED");
    }
    readbacks.push({
      country,
      sellerId: binding.sellerId,
      httpStatus: 200,
      providerCode: "0",
      remoteRequestId,
    });
  }
  return {
    ok: true as const,
    channel: "lazada" as const,
    operation: "oauth.exchange" as const,
    readbacks,
  };
}

export async function runLazadaImExactJob(
  value: unknown,
  sessionId: string,
  call: LazadaImExactCall,
  dependencies: LazadaImExactDependencies = {},
) {
  const job = parseLazadaImExactClaim(value, sessionId);
  const binding = { sessionId, jobId: job.id, claimToken: job.claim_token };
  const action = async (name: string, payload: Record<string, unknown> = {}) => {
    const result = await call({ action: name, ...binding, payload });
    const expected: Record<string, string[]> = {
      heartbeat: ["running"],
      begin: ["in_flight"],
      provider: ["provider_started"],
      stage: ["recovery_preserved", "prepared"],
      complete: ["completed"],
      review: ["review"],
    };
    if (!expected[name]?.includes(String(result.status))) fail("LAZADA_IM_EXACT_ACTION_REJECTED");
    return result;
  };
  try {
    await action("heartbeat");
    const result = await executeLazadaImExactOAuth(job, {
      assertLeaseHealthy: async () => { await action("heartbeat"); },
      beginCredentialMutation: async () => { await action("begin"); },
      beginOAuthProviderCall: async () => { await action("provider"); },
      stageCredentialRefresh: async (refresh) => {
        const staged = await action("stage", { refresh });
        if (refresh.recoveryOnly && staged.status !== "recovery_preserved") {
          fail("LAZADA_IM_EXACT_RECOVERY_STAGE_REJECTED");
        }
        if (!refresh.recoveryOnly && staged.status !== "prepared") {
          fail("LAZADA_IM_EXACT_ACTIVE_STAGE_REJECTED");
        }
      },
    }, dependencies);
    return await action("complete", { result });
  } catch {
    await action("review").catch(() => {});
    fail("LAZADA_IM_EXACT_REVIEW_REQUIRED_NO_REPLAY");
  }
}
