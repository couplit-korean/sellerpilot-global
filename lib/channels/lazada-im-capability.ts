import { createHash } from "node:crypto";
import { assertProviderAccountIdentity, normalizeLazadaProviderAccountIdentity,
  readProviderAccountIdentity, withoutProviderAccountIdentity } from "./provider-account-identity";
import { exchangeLazadaOAuthToken, lazadaRequest, textValue,
  type CredentialRefreshSnapshot, type SecretPayload } from "./protocols";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const lazadaImCapabilityContract = "sellerpilot-lazada-im-capability/1" as const;

export function lazadaImCredentialBinding(payload: SecretPayload, requestedCountry: string) {
  const country = requestedCountry.trim().toLowerCase();
  if (!/^(my|sg|ph|th|vn|id)$/.test(country)
    || payload.im_identity_source !== "lazada.oauth_token"
    || !readProviderAccountIdentity(payload, "lazada")) {
    throw new Error("LAZADA_IM_IDENTITY_REQUIRED");
  }
  const commerce = normalizeLazadaProviderAccountIdentity(payload);
  assertProviderAccountIdentity(payload, commerce.identity);
  const im = normalizeLazadaProviderAccountIdentity({ account_platform: payload.im_account_platform,
    country_user_info: payload.im_country_user_info });
  for (const row of im.countryUserInfo) {
    if (!commerce.countryUserInfo.some((other) => other.country === row.country && other.seller_id === row.seller_id)) {
      throw new Error("LAZADA_IM_SELLER_MISMATCH");
    }
  }
  const target = im.countryUserInfo.find((row) => row.country === country);
  const app = textValue(payload, "im_app_key");
  const token = textValue(payload, "im_access_token");
  const refresh = textValue(payload, "im_refresh_token");
  if (!target || !app || !token || !refresh) throw new Error("LAZADA_IM_COUNTRY_GRANT_REQUIRED");
  return { contract: lazadaImCapabilityContract, country: country.toUpperCase(), sellerId: target.seller_id,
    appFingerprint: digest(app), tokenFingerprint: digest([token, refresh].join("\u001f")),
    targetFingerprint: digest(`${country}:${target.seller_id}`) };
}

// Explicit diagnostic only. A rotating IM token is staged in recovery storage
// before identity validation, without replacing the commerce seller identity.
export async function diagnoseLazadaImCapability(input: {
  payload: SecretPayload; country: string;
  begin: () => void | Promise<void>;
  stage: (snapshot: CredentialRefreshSnapshot) => void | Promise<void>;
  assertLease: () => void | Promise<void>;
}) {
  const source = input.payload;
  const country = input.country.trim().toLowerCase();
  if (!/^(my|sg|ph|th|vn|id)$/.test(country)) throw new Error("LAZADA_IM_COUNTRY_REQUIRED");
  const appKey = textValue(source, "im_app_key");
  const appSecret = textValue(source, "im_app_secret");
  const refreshToken = textValue(source, "im_refresh_token");
  if (!appKey || !appSecret || !refreshToken || !readProviderAccountIdentity(source, "lazada")) {
    throw new Error("LAZADA_IM_REFRESH_CREDENTIALS_REQUIRED");
  }
  await input.assertLease();
  await input.begin();
  const remote = await exchangeLazadaOAuthToken({ appKey, appSecret, refreshToken });
  if (!remote.response.ok || String(remote.data.code ?? "0") !== "0"
    || !textValue(remote.data, "access_token")) throw new Error("LAZADA_IM_TOKEN_REFRESH_FAILED");
  const expiry = (value: unknown) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 31_536_000) return null;
    return new Date(Date.now() + seconds * 1_000).toISOString();
  };
  const next: SecretPayload = { ...source,
    im_access_token: remote.data.access_token,
    im_refresh_token: textValue(remote.data, "refresh_token") || refreshToken,
    im_access_token_expires_at: expiry(remote.data.expires_in),
    im_refresh_token_expires_at: expiry(remote.data.refresh_expires_in),
    im_account_platform: remote.data.account_platform,
    im_country_user_info: remote.data.country_user_info,
    im_identity_source: "lazada.oauth_token",
  };
  const expiresAt = textValue(source, "refresh_token_expires_at") || null;
  await input.stage({ payload: withoutProviderAccountIdentity(next), expiresAt, recoveryOnly: true });
  if (!next.im_access_token_expires_at || !next.im_refresh_token_expires_at) {
    throw new Error("LAZADA_IM_TOKEN_EXPIRY_INVALID");
  }
  const binding = lazadaImCredentialBinding(next, country);
  await input.assertLease();
  await input.begin();
  await input.stage({ payload: next, expiresAt });
  const probe = await lazadaRequest({ payload: { ...next, country }, path: "/im/session/list",
    params: { start_time: String(Date.now()), page_size: "1" } });
  await input.assertLease();
  const data = probe.data.data as Record<string, unknown> | undefined;
  if (!probe.response.ok || String(probe.data.code ?? "") !== "0"
    || !data || !Array.isArray(data.session_list)) throw new Error("LAZADA_IM_PERMISSION_READ_FAILED");
  return { status: "passed" as const,
    message: `Lazada ${binding.country} 채팅 권한과 동일 판매자 확인 완료. 대화 수집 완료 여부는 별도 확인합니다.`,
    lazadaImCapability: { ...binding, responseSha256: digest(JSON.stringify(probe.data)),
      observedAt: new Date().toISOString() } };
}
