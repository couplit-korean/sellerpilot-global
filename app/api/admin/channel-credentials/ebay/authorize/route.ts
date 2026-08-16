import { randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildEbayConsentUrl,
  ebayDefaultScopes,
  exchangeEbayOAuthToken,
  textValue,
} from "../../../../../../lib/channels/protocols";
import { supabasePublishableKey, supabaseUrl } from "../../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid().optional(),
  environment: z.enum(["sandbox", "production"]).default("production"),
  secretPayload: z.record(z.string(), z.string().max(8_000)).default({}),
  expiresAt: z.string().datetime().nullable().default(null),
  rotationDays: z.number().int().min(1).max(365).default(180),
  warningDays: z.number().int().min(1).max(180).default(30),
  graceDays: z.number().int().min(0).max(30).default(0),
  oauthState: z.string().min(24).max(180).optional(),
  startOAuth: z.boolean().default(false),
});

const oauthCookieName = "sellerpilot_ebay_oauth";

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function oauthStartResponse(
  request: NextRequest,
  input: { clientId: string; ruName: string; credentialId: string; environment: "sandbox" | "production" },
) {
  const state = `sellerpilot-ebay-${randomBytes(24).toString("base64url")}`;
  const authorizationUrl = buildEbayConsentUrl({
    environment: input.environment,
    clientId: input.clientId,
    ruName: input.ruName,
    state,
    scopes: ebayDefaultScopes,
  });
  const response = NextResponse.json({
    message: "eBay 판매자 승인 화면으로 이동합니다.",
    authorizationUrl: authorizationUrl.toString(),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
  response.cookies.set(oauthCookieName, `${state}.${input.credentialId}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "eBay 인증 요청 형식이 올바르지 않습니다." }, { status: 400 });

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentialRows, error: credentialError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (userError || !userData.user || adminError || credentialError || isAdmin !== true) {
    return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const incoming = parsed.data.secretPayload;
  const oauthCode = textValue(incoming, "authorization_code");
  let credentialId = parsed.data.credentialId;
  if (oauthCode) {
    const cookieValue = request.cookies.get(oauthCookieName)?.value ?? "";
    const separator = cookieValue.lastIndexOf(".");
    const cookieState = separator > 0 ? cookieValue.slice(0, separator) : "";
    const cookieCredentialId = separator > 0 ? cookieValue.slice(separator + 1) : "";
    if (!parsed.data.oauthState || !cookieState || !sameValue(parsed.data.oauthState, cookieState) || !z.string().uuid().safeParse(cookieCredentialId).success) {
      return NextResponse.json({ message: "eBay OAuth 상태가 만료됐거나 일치하지 않습니다. 연결을 다시 시작해 주세요." }, { status: 403 });
    }
    credentialId = cookieCredentialId;
  }

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const metadata = credentialId && Array.isArray(credentialRows)
    ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === credentialId)
    : null;
  let previousSecret: Record<string, unknown> = {};
  let credentialEnvironment = parsed.data.environment;
  if (credentialId) {
    if (!metadata || !("channel" in metadata) || metadata.channel !== "ebay" || !("status" in metadata) || metadata.status !== "active") {
      return NextResponse.json({ message: "활성 eBay 키와 요청이 일치하지 않습니다." }, { status: 409 });
    }
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ message: "기존 eBay 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
    }
    previousSecret = data as Record<string, unknown>;
    if ("environment" in metadata && metadata.environment === "sandbox") credentialEnvironment = "sandbox";
  }

  const clientId = textValue(incoming, "client_id") || textValue(previousSecret, "client_id");
  const clientSecret = textValue(incoming, "client_secret") || textValue(previousSecret, "client_secret");
  const ruName = textValue(incoming, "ru_name") || textValue(previousSecret, "ru_name");
  if (!clientId || !clientSecret || !ruName) {
    return NextResponse.json({ message: "Client ID·Client Secret·OAuth RuName이 모두 필요합니다." }, { status: 400 });
  }
  const nextSecret: Record<string, unknown> = {
    ...previousSecret,
    ...incoming,
    client_id: clientId,
    client_secret: clientSecret,
    ru_name: ruName,
    scopes: ebayDefaultScopes.join(" "),
  };
  delete nextSecret.authorization_code;
  let expiresAt = parsed.data.expiresAt;

  if (oauthCode) {
    const remote = await exchangeEbayOAuthToken({
      environment: credentialEnvironment,
      clientId,
      clientSecret,
      ruName,
      code: oauthCode,
      scopes: ebayDefaultScopes,
    });
    const accessToken = textValue(remote.data, "access_token");
    const refreshToken = textValue(remote.data, "refresh_token");
    if (!remote.response.ok || !accessToken || !refreshToken) {
      return NextResponse.json({ message: "eBay OAuth 토큰 교환에 실패했습니다. RuName·환경·승인 유효시간을 확인해 주세요." }, { status: 422 });
    }
    nextSecret.access_token = accessToken;
    nextSecret.refresh_token = refreshToken;
    nextSecret.access_token_expires_at = new Date(Date.now() + Number(remote.data.expires_in ?? 7_200) * 1000).toISOString();
    nextSecret.refresh_token_expires_at = new Date(Date.now() + Number(remote.data.refresh_token_expires_in ?? 47_304_000) * 1000).toISOString();
    expiresAt = nextSecret.refresh_token_expires_at as string;
  }

  if (!oauthCode && parsed.data.startOAuth && credentialId) {
    return oauthStartResponse(request, { clientId, ruName, credentialId, environment: credentialEnvironment });
  }
  if (!oauthCode && !parsed.data.startOAuth && !textValue(nextSecret, "access_token")) {
    return NextResponse.json({ message: "eBay User Access Token이 없습니다. OAuth 연결을 시작해 주세요." }, { status: 400 });
  }

  const { data: nextCredentialId, error: rotateError } = await userClient.rpc("sellerpilot_rotate_credential", {
    p_channel: "ebay",
    p_environment: credentialEnvironment,
    p_secret_payload: nextSecret,
    p_expires_at: expiresAt,
    p_rotation_interval_days: parsed.data.rotationDays,
    p_warning_days: parsed.data.warningDays,
    p_grace_days: parsed.data.graceDays,
  });
  if (rotateError) return NextResponse.json({ message: "eBay 키를 Vault에 저장하지 못했습니다." }, { status: 500 });
  if (!oauthCode && parsed.data.startOAuth) {
    return oauthStartResponse(request, { clientId, ruName, credentialId: String(nextCredentialId), environment: credentialEnvironment });
  }
  const response = NextResponse.json({ message: "eBay OAuth 연결과 Vault 저장이 완료됐습니다." }, { headers: { "cache-control": "no-store, max-age=0" } });
  if (oauthCode) response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
  return response;
}
