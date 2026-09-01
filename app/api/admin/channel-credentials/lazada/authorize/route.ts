import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ChannelGatewayInProgressError,
  ChannelGatewayReconciliationRequiredError,
  exchangeOAuthViaChannelGateway,
} from "../../../../../../lib/channels/gateway";
import {
  lazadaAuthorizationUrl,
  lazadaCountryFromOAuthState,
  lazadaOAuthState,
  resolveLazadaCredentialCountry,
  lazadaTargetCountry,
} from "../../../../../../lib/channels/lazada-my-contract";
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

function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

async function oauthStartResponse(
  request: NextRequest,
  appKey: string,
  credentialId: string,
  persistState: (state: string) => Promise<boolean>,
) {
  const state = lazadaOAuthState(randomBytes(24).toString("base64url"));
  if (!await persistState(state)) {
    return NextResponse.json({ message: "Lazada OAuth 상태를 안전하게 저장하지 못했습니다." }, { status: 500 });
  }
  const redirectUri = new URL("/", request.nextUrl.origin).toString();
  const authorizationUrl = lazadaAuthorizationUrl({ appKey, redirectUri, state });
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
  const oauthStateCountry = parsed.data.oauthState
    ? lazadaCountryFromOAuthState(parsed.data.oauthState)
    : "";
  let credentialId = parsed.data.credentialId;
  if (oauthCode) {
    const cookieValue = request.cookies.get(oauthCookieName)?.value ?? "";
    const separator = cookieValue.lastIndexOf(".");
    const cookieState = separator > 0 ? cookieValue.slice(0, separator) : "";
    const cookieCredentialId = separator > 0 ? cookieValue.slice(separator + 1) : "";
    if (!parsed.data.oauthState || oauthStateCountry !== lazadaTargetCountry) {
      return NextResponse.json({ message: "Lazada OAuth 상태가 만료됐거나 일치하지 않습니다. 연결을 다시 시작해 주세요." }, { status: 403 });
    }
    const submittedCountry = textValue(parsed.data.secretPayload, "country").toLowerCase();
    if (submittedCountry && submittedCountry !== oauthStateCountry) {
      return NextResponse.json({ message: "Lazada OAuth 대상 국가가 승인 상태와 일치하지 않습니다." }, { status: 409 });
    }
    const cookieValid = Boolean(cookieState)
      && sameValue(parsed.data.oauthState, cookieState)
      && z.string().uuid().safeParse(cookieCredentialId).success;
    const { data: storedCredentialId, error: stateError } = await serviceClient.rpc("sellerpilot_service_claim_channel_oauth_state", {
      p_owner_id: userData.user.id,
      p_channel: "lazada",
      p_state_hash: stateHash(parsed.data.oauthState),
    });
    const persistedCredentialId = !stateError && z.string().uuid().safeParse(storedCredentialId).success
      ? String(storedCredentialId)
      : "";
    if (!persistedCredentialId && !cookieValid) {
      return NextResponse.json({ message: "Lazada OAuth 상태가 만료됐거나 일치하지 않습니다. 연결을 다시 시작해 주세요." }, { status: 403 });
    }
    credentialId = persistedCredentialId || cookieCredentialId;
  }

  if (oauthCode) {
    try {
      await exchangeOAuthViaChannelGateway({
        serviceClient,
        credentialId: credentialId ?? "",
        channel: "lazada",
        request: { code: oauthCode, country: oauthStateCountry },
      });
    } catch (error) {
      if (error instanceof ChannelGatewayInProgressError) {
        return NextResponse.json({ message: "Lazada OAuth 토큰 교환이 안전하게 진행 중입니다." }, { status: 202 });
      }
      if (error instanceof ChannelGatewayReconciliationRequiredError) {
        const response = NextResponse.json({ message: "Lazada OAuth 결과를 수동으로 확인해야 합니다. 같은 승인 코드를 다시 제출하지 마세요." }, { status: 409 });
        response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
        return response;
      }
      return NextResponse.json({ message: "Lazada OAuth 토큰 교환을 허용 IP 작업자에서 완료하지 못했습니다. 작업 상태를 확인해 주세요." }, { status: 422 });
    }
    const response = NextResponse.json({ message: "Lazada OAuth 연결과 Vault 저장이 완료됐습니다." }, { headers: { "cache-control": "no-store, max-age=0" } });
    response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
    return response;
  }

  let previousSecret: Record<string, unknown> = {};
  let credentialEnvironment = parsed.data.environment;
  const metadata = credentialId && Array.isArray(credentialRows)
    ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === credentialId)
    : null;
  if (credentialId) {
    if (!metadata || !("channel" in metadata) || metadata.channel !== "lazada" || !("status" in metadata) || metadata.status !== "active") return NextResponse.json({ message: "활성 Lazada 키와 요청이 일치하지 않습니다." }, { status: 409 });
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
    if (error || !data || typeof data !== "object") return NextResponse.json({ message: "기존 Lazada 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
    previousSecret = data as Record<string, unknown>;
    if ("environment" in metadata && metadata.environment === "sandbox") credentialEnvironment = "sandbox";
  }

  const incoming = parsed.data.secretPayload;
  const appKey = textValue(incoming, "app_key") || textValue(previousSecret, "app_key");
  const appSecret = textValue(incoming, "app_secret") || textValue(previousSecret, "app_secret");
  const code = oauthCode;
  const country = resolveLazadaCredentialCountry({
    startOAuth: parsed.data.startOAuth,
    hasOAuthCode: Boolean(code),
    incomingCountry: textValue(incoming, "country"),
    previousCountry: textValue(previousSecret, "country"),
  });
  if (!appKey || !appSecret) return NextResponse.json({ message: "App Key와 App Secret이 필요합니다." }, { status: 400 });
  if (country !== lazadaTargetCountry) {
    return NextResponse.json({ message: "현재 Lazada 운영 대상은 Malaysia(MY)만 허용합니다." }, { status: 409 });
  }

  const nextSecret: Record<string, unknown> = { ...previousSecret, ...incoming, app_key: appKey, app_secret: appSecret, country };
  delete nextSecret.authorization_code;
  const credentialExpiresAt = parsed.data.expiresAt;
  if (!code && parsed.data.startOAuth && credentialId) {
    return oauthStartResponse(request, appKey, credentialId, async (state) => {
      const { data, error } = await serviceClient.rpc("sellerpilot_service_store_channel_oauth_state", {
        p_owner_id: userData.user.id,
        p_credential_id: credentialId,
        p_channel: "lazada",
        p_state_hash: stateHash(state),
      });
      return !error && data === true;
    });
  }
  if (!code && !parsed.data.startOAuth && !textValue(nextSecret, "access_token")) {
    return NextResponse.json({ message: "Lazada Access Token이 없습니다. OAuth 연결을 시작해 주세요." }, { status: 400 });
  }

  const { data: nextCredentialId, error: rotateError } = await userClient.rpc("sellerpilot_rotate_credential", {
    p_channel: "lazada",
    p_environment: credentialEnvironment,
    p_secret_payload: nextSecret,
    p_expires_at: credentialExpiresAt,
    p_rotation_interval_days: parsed.data.rotationDays,
    p_warning_days: parsed.data.warningDays,
    p_grace_days: parsed.data.graceDays,
  });
  if (rotateError) return NextResponse.json({ message: rotateError.message.includes("administrator") ? "관리자 권한이 필요합니다." : "Lazada 키를 Vault에 저장하지 못했습니다." }, { status: 500 });
  if (!code && parsed.data.startOAuth) {
    return oauthStartResponse(request, appKey, String(nextCredentialId), async (state) => {
      const { data, error } = await serviceClient.rpc("sellerpilot_service_store_channel_oauth_state", {
        p_owner_id: userData.user.id,
        p_credential_id: String(nextCredentialId),
        p_channel: "lazada",
        p_state_hash: stateHash(state),
      });
      return !error && data === true;
    });
  }
  const response = NextResponse.json({ message: code ? "Lazada OAuth 연결과 Vault 저장이 완료됐습니다." : "Lazada 키를 Vault에 저장했습니다." }, { headers: { "cache-control": "no-store, max-age=0" } });
  if (code) response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
  return response;
}
