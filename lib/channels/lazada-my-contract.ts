export const lazadaTargetCountry = "my" as const;
export const lazadaTargetMarketCode = "MY" as const;

export const lazadaTargetSyncRequiredCode = "LAZADA_TARGET_SYNC_REQUIRED" as const;
export const lazadaMyTargetMismatchCode = "LAZADA_MY_TARGET_MISMATCH" as const;

const lazadaOAuthStatePrefix = `sellerpilot-lazada-${lazadaTargetCountry}-`;
const oauthNoncePattern = /^[A-Za-z0-9_-]{32}$/u;

export function lazadaOAuthState(nonce: string) {
  if (!oauthNoncePattern.test(nonce)) throw new Error("LAZADA_OAUTH_STATE_NONCE_INVALID");
  return `${lazadaOAuthStatePrefix}${nonce}`;
}

export function lazadaCountryFromOAuthState(state: string) {
  if (!state.startsWith(lazadaOAuthStatePrefix)) return "";
  return oauthNoncePattern.test(state.slice(lazadaOAuthStatePrefix.length))
    ? lazadaTargetCountry
    : "";
}

export function lazadaAuthorizationUrl(input: {
  appKey: string;
  redirectUri: string;
  state: string;
}) {
  if (lazadaCountryFromOAuthState(input.state) !== lazadaTargetCountry) {
    throw new Error("LAZADA_OAUTH_STATE_TARGET_INVALID");
  }
  const authorizationUrl = new URL("https://auth.lazada.com/oauth/authorize");
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: input.redirectUri,
    client_id: input.appKey,
    state: input.state,
    country: lazadaTargetCountry,
  }).toString();
  return authorizationUrl;
}

export function isLazadaTargetSyncRequiredPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).code === lazadaTargetSyncRequiredCode;
}
