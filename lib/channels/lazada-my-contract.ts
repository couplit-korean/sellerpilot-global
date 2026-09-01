export const lazadaTargetCountry = "my" as const;
export const lazadaTargetMarketCode = "MY" as const;

export const lazadaTargetSyncRequiredCode = "LAZADA_TARGET_SYNC_REQUIRED" as const;
export const lazadaMyTargetMismatchCode = "LAZADA_MY_TARGET_MISMATCH" as const;
export const lazadaTargetCredentialChangedCode = "LAZADA_TARGET_CREDENTIAL_CHANGED" as const;

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

export function resolveLazadaCredentialCountry(input: {
  startOAuth: boolean;
  hasOAuthCode: boolean;
  incomingCountry: string;
  previousCountry: string;
}) {
  if (input.startOAuth && !input.hasOAuthCode) return lazadaTargetCountry;
  return (input.incomingCountry || input.previousCountry || lazadaTargetCountry).trim().toLowerCase();
}

export function lazadaTargetSyncRequiredPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const credentialId = typeof payload.credentialId === "string"
    ? payload.credentialId.trim()
    : "";
  if (payload.code !== lazadaTargetSyncRequiredCode
      || payload.channel !== "lazada"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(credentialId)
      || !Array.isArray(payload.targets)
      || payload.targets.length !== 0) return null;
  return { credentialId };
}

export function isLazadaTargetSyncRequiredPayload(value: unknown) {
  return lazadaTargetSyncRequiredPayload(value) !== null;
}
