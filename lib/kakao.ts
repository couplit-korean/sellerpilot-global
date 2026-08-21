import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

type KakaoState = { uid: string; exp: number; nonce: string; redirectUri: string };

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
  if (!parsed.uid || !parsed.redirectUri || parsed.exp < Date.now()) return null;
  return parsed;
}

export async function refreshKakaoToken(secret: Record<string, unknown>) {
  const refreshToken = typeof secret.refresh_token === "string" ? secret.refresh_token : "";
  const clientId = process.env.KAKAO_REST_API_KEY?.trim() ?? "";
  if (!refreshToken || !clientId) throw new Error("KAKAO_REFRESH_UNAVAILABLE");
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
  const clientSecret = process.env.KAKAO_CLIENT_SECRET?.trim();
  if (clientSecret) body.set("client_secret", clientSecret);
  const response = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body, cache: "no-store" });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") throw new Error("KAKAO_REFRESH_FAILED");
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
  const response = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`KAKAO_MEMO_FAILED:${response.status}`);
}
