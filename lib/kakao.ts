import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

type KakaoState = { uid: string; exp: number; nonce: string; redirectUri: string };

const KAKAO_HTTP_TIMEOUT_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type KakaoProviderFailureKind = "rejected" | "uncertain";

export class KakaoProviderError extends Error {
  readonly kind: KakaoProviderFailureKind;

  constructor(code: string, kind: KakaoProviderFailureKind) {
    super(code);
    this.name = "KakaoProviderError";
    this.kind = kind;
  }
}

function providerFailure(operation: string, status: number) {
  const kind: KakaoProviderFailureKind = status >= 400 && status < 500
    ? "rejected"
    : "uncertain";
  return new KakaoProviderError(`${operation}_${kind === "rejected" ? "REJECTED" : "OUTCOME_UNKNOWN"}_${status}`, kind);
}

async function providerJson(response: Response, operation: string) {
  if (!response.ok) throw providerFailure(operation, response.status);
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new KakaoProviderError(`${operation}_RESPONSE_INVALID`, "uncertain");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof KakaoProviderError) throw error;
    throw new KakaoProviderError(`${operation}_RESPONSE_INVALID`, "uncertain");
  }
}

async function kakaoFetch(input: string, init: RequestInit, operation: string) {
  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(KAKAO_HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new KakaoProviderError(`${operation}_TRANSPORT_UNCERTAIN`, "uncertain");
  }
}

function stateSecret() {
  const value = process.env.KAKAO_STATE_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
  if (!value) throw new Error("KAKAO_STATE_SECRET_MISSING");
  return value;
}

export function createKakaoState(value: KakaoState) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyKakaoState(value: string): KakaoState | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as KakaoState;
  if (!parsed.uid || !parsed.redirectUri || !UUID_PATTERN.test(parsed.nonce) || parsed.exp < Date.now()) return null;
  return parsed;
}

export async function exchangeKakaoAuthorizationCode(code: string, redirectUri: string) {
  const clientId = process.env.KAKAO_REST_API_KEY?.trim() ?? "";
  if (!clientId || code.length < 8 || !redirectUri) {
    throw new KakaoProviderError("KAKAO_CODE_EXCHANGE_CONFIG_INVALID", "rejected");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
  });
  const clientSecret = process.env.KAKAO_CLIENT_SECRET?.trim();
  if (clientSecret) body.set("client_secret", clientSecret);
  const response = await kakaoFetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  }, "KAKAO_CODE_EXCHANGE");
  const payload = await providerJson(response, "KAKAO_CODE_EXCHANGE");
  if (typeof payload.access_token !== "string" || payload.access_token.length < 8) {
    throw new KakaoProviderError("KAKAO_CODE_EXCHANGE_TOKEN_MISSING", "uncertain");
  }
  return payload;
}

export async function fetchKakaoProfile(accessToken: string) {
  if (accessToken.length < 8) {
    throw new KakaoProviderError("KAKAO_PROFILE_TOKEN_INVALID", "rejected");
  }
  const response = await kakaoFetch("https://kapi.kakao.com/v2/user/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  }, "KAKAO_PROFILE");
  const payload = await providerJson(response, "KAKAO_PROFILE");
  if ((typeof payload.id !== "string" && typeof payload.id !== "number") || String(payload.id).length === 0) {
    throw new KakaoProviderError("KAKAO_PROFILE_ID_MISSING", "uncertain");
  }
  return payload;
}

export async function refreshKakaoToken(secret: Record<string, unknown>) {
  const refreshToken = typeof secret.refresh_token === "string" ? secret.refresh_token : "";
  const clientId = process.env.KAKAO_REST_API_KEY?.trim() ?? "";
  if (!refreshToken || !clientId) throw new KakaoProviderError("KAKAO_REFRESH_UNAVAILABLE", "rejected");
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
  const clientSecret = process.env.KAKAO_CLIENT_SECRET?.trim();
  if (clientSecret) body.set("client_secret", clientSecret);
  const response = await kakaoFetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  }, "KAKAO_REFRESH");
  const payload = await providerJson(response, "KAKAO_REFRESH");
  if (typeof payload.access_token !== "string" || payload.access_token.length < 8) {
    throw new KakaoProviderError("KAKAO_REFRESH_TOKEN_MISSING", "uncertain");
  }
  return { ...secret, ...payload, refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken };
}

export async function sendKakaoMemo(accessToken: string, title: string, body: string, linkPath: string, origin: string) {
  const link = new URL(linkPath || "/", origin).toString();
  const templateObject = {
    object_type: "text",
    text: `${title}\n${body}`.slice(0, 200),
    link: { web_url: link, mobile_web_url: link },
    button_title: "SellerPilot에서 확인",
  };
  const response = await kakaoFetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
  }, "KAKAO_MEMO");
  const payload = await providerJson(response, "KAKAO_MEMO");
  if (payload.result_code !== 0) {
    throw new KakaoProviderError("KAKAO_MEMO_RESPONSE_INVALID", "uncertain");
  }
}
