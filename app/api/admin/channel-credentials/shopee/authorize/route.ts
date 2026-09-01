import { randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildShopeeAuthorizationUrl,
  textValue,
} from "../../../../../../lib/channels/protocols";
import {
  ChannelGatewayInProgressError,
  ChannelGatewayReconciliationRequiredError,
  exchangeOAuthViaChannelGateway,
} from "../../../../../../lib/channels/gateway";
import {
  configuredServerlessStaticEgressChannels,
  databaseServerlessStaticEgressAllows,
  hasServerlessStaticEgressFor,
  SERVERLESS_STATIC_EGRESS_REQUIRED,
} from "../../../../../../lib/channels/serverless-static-egress";
import { supabasePublishableKey, supabaseUrl } from "../../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid().optional(),
  environment: z.enum(["sandbox", "production"]).default("production"),
  secretPayload: z.record(z.string(), z.string().trim().max(8_000)).default({}),
  expiresAt: z.string()
    .datetime({ offset: true })
    .transform((value) => new Date(value).toISOString())
    .nullable()
    .default(null),
  rotationDays: z.number().int().min(1).max(365).default(90),
  warningDays: z.number().int().min(1).max(180).default(30),
  graceDays: z.number().int().min(0).max(30).default(0),
  oauthState: z.string().min(24).max(180).optional(),
  startOAuth: z.boolean().default(false),
});

const oauthCookieName = "sellerpilot_shopee_oauth";

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function canonicalTimestamp(value: string | null, fallback: string) {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

async function shopeeStaticEgressReady(serviceClient: SupabaseClient) {
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_service_serverless_static_egress_status",
  );
  return !error
    && hasServerlessStaticEgressFor(configuredServerlessStaticEgressChannels(), ["shopee"])
    && databaseServerlessStaticEgressAllows(data, "shopee");
}

async function shopeeGatewayWorkerReady(serviceClient: SupabaseClient) {
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_service_serverless_cs_wakeup_status",
  );
  const runtimeState = data
    && typeof data === "object"
    && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  return !error
    && runtimeState.configured === true
    && runtimeState.active === true;
}

function shopeeStaticEgressBlocked(message: string) {
  return NextResponse.json({
    ok: false,
    manualRequired: true,
    externalActionRequired: true,
    staticEgressReady: false,
    blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
    mode: "static_egress_required",
    message,
  }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
}

function shopeeGatewayWorkerBlocked(message: string) {
  return NextResponse.json({
    ok: false,
    operatorActionRequired: true,
    workerReady: false,
    blockedReason: "SERVERLESS_WORKER_REQUIRED",
    mode: "serverless_worker_required",
    message,
  }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
}

async function shopeeOAuthGatewayBlocked(
  serviceClient: SupabaseClient,
  input: { staticEgressMessage: string; workerMessage: string },
) {
  const [staticEgressReady, workerReady] = await Promise.all([
    shopeeStaticEgressReady(serviceClient),
    shopeeGatewayWorkerReady(serviceClient),
  ]);
  if (!staticEgressReady) return shopeeStaticEgressBlocked(input.staticEgressMessage);
  if (!workerReady) return shopeeGatewayWorkerBlocked(input.workerMessage);
  return null;
}

function oauthStartResponse(
  request: NextRequest,
  input: {
    partnerId: string;
    credentialId: string;
    environment: "sandbox" | "production";
  },
) {
  const state = `sellerpilot-shopee-${randomBytes(24).toString("base64url")}`;
  const authorizationUrl = buildShopeeAuthorizationUrl({
    environment: input.environment,
    partnerId: input.partnerId,
    redirectUri: new URL("/", request.nextUrl.origin).toString(),
    state,
  });
  const response = NextResponse.json({
    message: "Shopee 판매자 승인 화면으로 이동합니다.",
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
  if (!parsed.success) return NextResponse.json({ message: "Shopee 인증 요청 형식이 올바르지 않습니다." }, { status: 400 });

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
      return NextResponse.json({ message: "Shopee OAuth 상태가 만료됐거나 일치하지 않습니다. 연결을 다시 시작해 주세요." }, { status: 403 });
    }
    credentialId = cookieCredentialId;
  }

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (oauthCode) {
    const blocked = await shopeeOAuthGatewayBlocked(serviceClient, {
      staticEgressMessage: "Shopee에 승인된 고정 egress IP와 서버 정책을 먼저 활성화한 뒤 OAuth 승인을 다시 시작해 주세요.",
      workerMessage: "Shopee OAuth 작업자가 활성 상태가 아니어서 승인 코드를 대기열에 넣지 않았습니다. 작업자 상태를 확인한 뒤 OAuth 승인을 다시 시작해 주세요.",
    });
    if (blocked) return blocked;
  }
  const metadata = credentialId && Array.isArray(credentialRows)
    ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === credentialId)
    : null;
  const callbackShopId = textValue(incoming, "shop_id");
  const mainAccountId = textValue(incoming, "main_account_id");
  let credentialExpiresAt = parsed.data.expiresAt;
  if (!credentialExpiresAt && metadata && "expires_at" in metadata && typeof metadata.expires_at === "string") {
    credentialExpiresAt = metadata.expires_at;
  }
  if (oauthCode) {
    if (!callbackShopId && !mainAccountId) return NextResponse.json({ message: "Shopee 승인 응답에 Shop ID 또는 Main Account ID가 없습니다. 판매자 승인을 다시 시작해 주세요." }, { status: 400 });
    const authorizationExpiresAt = canonicalTimestamp(
      credentialExpiresAt,
      new Date(Date.now() + 365 * 86_400_000).toISOString(),
    );
    try {
      await exchangeOAuthViaChannelGateway({
        serviceClient,
        credentialId: credentialId ?? "",
        channel: "shopee",
        request: {
          code: oauthCode,
          ...(mainAccountId ? { mainAccountId } : { shopId: callbackShopId }),
          authorizationExpiresAt,
        },
      });
    } catch (error) {
      if (error instanceof ChannelGatewayInProgressError) {
        return NextResponse.json({ message: "Shopee OAuth 토큰 교환이 안전하게 진행 중입니다." }, { status: 202 });
      }
      if (error instanceof ChannelGatewayReconciliationRequiredError) {
        const response = NextResponse.json({ message: "Shopee OAuth 결과를 수동으로 확인해야 합니다. 같은 승인 코드를 다시 제출하지 마세요." }, { status: 409 });
        response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
        return response;
      }
      return NextResponse.json({ message: "Shopee OAuth 토큰 교환을 허용 IP 작업자에서 완료하지 못했습니다. 작업 상태를 확인해 주세요." }, { status: 422 });
    }
    const response = NextResponse.json({ message: "Shopee 8개 숍 OAuth 연결과 Vault 저장이 완료됐습니다." }, { headers: { "cache-control": "no-store, max-age=0" } });
    response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
    return response;
  }

  let previousSecret: Record<string, unknown> = {};
  let credentialEnvironment = parsed.data.environment;
  if (credentialId) {
    if (!metadata || !("channel" in metadata) || metadata.channel !== "shopee" || !("status" in metadata) || metadata.status !== "active") {
      return NextResponse.json({ message: "활성 Shopee 키와 요청이 일치하지 않습니다." }, { status: 409 });
    }
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ message: "기존 Shopee 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
    }
    previousSecret = data as Record<string, unknown>;
    if ("environment" in metadata && metadata.environment === "sandbox") credentialEnvironment = "sandbox";
    if (!credentialExpiresAt && "expires_at" in metadata && typeof metadata.expires_at === "string") credentialExpiresAt = metadata.expires_at;
  }

  const partnerId = textValue(incoming, "partner_id") || textValue(previousSecret, "partner_id");
  const partnerKey = textValue(incoming, "partner_key") || textValue(previousSecret, "partner_key");
  if (!partnerId || !partnerKey) {
    return NextResponse.json({ message: "Live Partner ID와 Live Partner Key가 필요합니다." }, { status: 400 });
  }
  if (parsed.data.startOAuth) {
    const blocked = await shopeeOAuthGatewayBlocked(serviceClient, {
      staticEgressMessage: "Shopee에 승인된 고정 egress IP와 서버 정책을 먼저 활성화한 뒤 OAuth 승인을 시작해 주세요.",
      workerMessage: "Shopee OAuth 작업자가 활성 상태가 아니어서 판매자 승인을 시작하지 않았습니다. 작업자 상태를 확인해 주세요.",
    });
    if (blocked) return blocked;
  }
  const nextSecret: Record<string, unknown> = {
    ...previousSecret,
    ...incoming,
    partner_id: partnerId,
    partner_key: partnerKey,
  };
  delete nextSecret.authorization_code;

  if (!oauthCode && parsed.data.startOAuth && credentialId) {
    return oauthStartResponse(request, { partnerId, credentialId, environment: credentialEnvironment });
  }
  if (!oauthCode && !parsed.data.startOAuth && !textValue(nextSecret, "access_token")) {
    return NextResponse.json({ message: "Shopee Access Token이 없습니다. OAuth 판매자 승인을 시작해 주세요." }, { status: 400 });
  }

  const { data: nextCredentialId, error: rotateError } = await userClient.rpc("sellerpilot_rotate_credential", {
    p_channel: "shopee",
    p_environment: credentialEnvironment,
    p_secret_payload: nextSecret,
    p_expires_at: credentialExpiresAt,
    p_rotation_interval_days: parsed.data.rotationDays,
    p_warning_days: parsed.data.warningDays,
    p_grace_days: parsed.data.graceDays,
  });
  if (rotateError) return NextResponse.json({ message: "Shopee 키를 Vault에 저장하지 못했습니다." }, { status: 500 });
  if (!oauthCode && parsed.data.startOAuth) {
    return oauthStartResponse(request, { partnerId, credentialId: String(nextCredentialId), environment: credentialEnvironment });
  }
  const response = NextResponse.json({ message: "Shopee OAuth 연결과 Vault 저장이 완료됐습니다." }, { headers: { "cache-control": "no-store, max-age=0" } });
  if (oauthCode) response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
  return response;
}
