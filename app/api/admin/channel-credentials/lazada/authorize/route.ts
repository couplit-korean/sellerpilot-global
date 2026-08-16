import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabasePublishableKey, supabaseUrl } from "../../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid().optional(),
  environment: z.enum(["sandbox", "production"]).default("production"),
  secretPayload: z.record(z.string(), z.string().max(4096)).default({}),
  expiresAt: z.string().datetime().nullable().default(null),
  rotationDays: z.number().int().min(1).max(365).default(30),
  warningDays: z.number().int().min(1).max(180).default(14),
  graceDays: z.number().int().min(0).max(30).default(0),
  oauthState: z.string().min(24).max(160).optional(),
  startOAuth: z.boolean().default(false),
});

const oauthCookieName = "sellerpilot_lazada_oauth";

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function oauthStartResponse(request: NextRequest, appKey: string, credentialId: string) {
  const state = `sellerpilot-lazada-${randomBytes(24).toString("base64url")}`;
  const redirectUri = new URL("/", request.nextUrl.origin).toString();
  const authorizationUrl = new URL("https://auth.lazada.com/oauth/authorize");
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: redirectUri,
    client_id: appKey,
    state,
  }).toString();
  const response = NextResponse.json({
    message: "Lazada 승인 화면으로 이동합니다.",
    authorizationUrl: authorizationUrl.toString(),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
  response.cookies.set(oauthCookieName, `${state}.${credentialId}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}

function textValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Lazada 인증 요청 형식이 올바르지 않습니다." }, { status: 400 });

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentialRows, error: credentialError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (userError || !userData.user || adminError || credentialError || isAdmin !== true) return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const oauthCode = textValue(parsed.data.secretPayload, "authorization_code");
  let credentialId = parsed.data.credentialId;
  if (oauthCode) {
    const cookieValue = request.cookies.get(oauthCookieName)?.value ?? "";
    const separator = cookieValue.lastIndexOf(".");
    const cookieState = separator > 0 ? cookieValue.slice(0, separator) : "";
    const cookieCredentialId = separator > 0 ? cookieValue.slice(separator + 1) : "";
    if (!parsed.data.oauthState || !cookieState || !sameValue(parsed.data.oauthState, cookieState) || !z.string().uuid().safeParse(cookieCredentialId).success) {
      return NextResponse.json({ message: "Lazada OAuth 상태가 만료됐거나 일치하지 않습니다. 연결을 다시 시작해 주세요." }, { status: 403 });
    }
    credentialId = cookieCredentialId;
  }

  let previousSecret: Record<string, unknown> = {};
  const metadata = credentialId && Array.isArray(credentialRows)
    ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === credentialId)
    : null;
  if (credentialId) {
    if (!metadata || !("channel" in metadata) || metadata.channel !== "lazada" || !("status" in metadata) || metadata.status !== "active") return NextResponse.json({ message: "활성 Lazada 키와 요청이 일치하지 않습니다." }, { status: 409 });
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
    if (error || !data || typeof data !== "object") return NextResponse.json({ message: "기존 Lazada 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
    previousSecret = data as Record<string, unknown>;
  }

  const incoming = parsed.data.secretPayload;
  const appKey = textValue(incoming, "app_key") || textValue(previousSecret, "app_key");
  const appSecret = textValue(incoming, "app_secret") || textValue(previousSecret, "app_secret");
  const code = oauthCode;
  const country = (textValue(incoming, "country") || textValue(previousSecret, "country") || "my").toLowerCase();
  if (!appKey || !appSecret) return NextResponse.json({ message: "App Key와 App Secret이 필요합니다." }, { status: 400 });

  const nextSecret: Record<string, unknown> = { ...previousSecret, ...incoming, app_key: appKey, app_secret: appSecret, country };
  delete nextSecret.authorization_code;
  let credentialExpiresAt = parsed.data.expiresAt;
  if (code) {
    const path = "/auth/token/create";
    const params: Record<string, string> = { app_key: appKey, code, sign_method: "sha256", timestamp: Date.now().toString() };
    const signingInput = path + Object.keys(params).sort().map((key) => `${key}${params[key]}`).join("");
    params.sign = createHmac("sha256", appSecret).update(signingInput).digest("hex").toUpperCase();
    const url = new URL(`https://auth.lazada.com/rest${path}`);
    url.search = new URLSearchParams(params).toString();
    const response = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    const accessToken = textValue(data, "access_token");
    const refreshToken = textValue(data, "refresh_token");
    const responseCode = String(data.code ?? "");
    if (!response.ok || !accessToken || !refreshToken || (responseCode && responseCode !== "0")) return NextResponse.json({ message: `Lazada OAuth 토큰 교환에 실패했습니다${responseCode ? ` · ${responseCode}` : ""}.` }, { status: 422 });
    nextSecret.access_token = accessToken;
    nextSecret.refresh_token = refreshToken;
    nextSecret.access_token_expires_at = new Date(Date.now() + Number(data.expires_in ?? 2_592_000) * 1000).toISOString();
    nextSecret.refresh_token_expires_at = new Date(Date.now() + Number(data.refresh_expires_in ?? 15_552_000) * 1000).toISOString();
    credentialExpiresAt ||= nextSecret.refresh_token_expires_at as string;
  }

  if (!code && parsed.data.startOAuth && credentialId) {
    return oauthStartResponse(request, appKey, credentialId);
  }
  if (!code && !parsed.data.startOAuth && !textValue(nextSecret, "access_token")) {
    return NextResponse.json({ message: "Lazada Access Token이 없습니다. OAuth 연결을 시작해 주세요." }, { status: 400 });
  }

  const { data: nextCredentialId, error: rotateError } = await userClient.rpc("sellerpilot_rotate_credential", {
    p_channel: "lazada",
    p_environment: parsed.data.environment,
    p_secret_payload: nextSecret,
    p_expires_at: credentialExpiresAt,
    p_rotation_interval_days: parsed.data.rotationDays,
    p_warning_days: parsed.data.warningDays,
    p_grace_days: parsed.data.graceDays,
  });
  if (rotateError) return NextResponse.json({ message: rotateError.message.includes("administrator") ? "관리자 권한이 필요합니다." : "Lazada 키를 Vault에 저장하지 못했습니다." }, { status: 500 });
  if (!code && parsed.data.startOAuth) {
    return oauthStartResponse(request, appKey, String(nextCredentialId));
  }
  const response = NextResponse.json({ message: code ? "Lazada OAuth 연결과 Vault 저장이 완료됐습니다." : "Lazada 키를 Vault에 저장했습니다." }, { headers: { "cache-control": "no-store, max-age=0" } });
  if (code) response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
  return response;
}
