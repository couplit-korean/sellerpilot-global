import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ebayDefaultScopes, ensureShopeeAccessToken, exchangeEbayOAuthToken } from "../../../../lib/channels/protocols";
import { supabaseUrl } from "../../../../lib/supabase/config";
import { dispatchPendingPushNotifications } from "../../../../lib/push-notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

type PrunedJob = {
  job_id: string;
  input_paths: string[] | null;
  result_paths: string[] | null;
};

type ActiveCredential = {
  credential_id?: unknown;
  secret_payload?: unknown;
};

function textValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

async function refreshLazadaIfNeeded(projectUrl: string, secretKey: string) {
  const serviceClient = createClient(projectUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: "lazada",
    p_environment: "production",
  });
  if (error) throw new Error("credential_read_failed");
  const active = data as ActiveCredential | null;
  if (!active?.credential_id || typeof active.credential_id !== "string" || !active.secret_payload || typeof active.secret_payload !== "object" || Array.isArray(active.secret_payload)) {
    return { status: "not_connected" as const };
  }

  const secret = active.secret_payload as Record<string, unknown>;
  const accessExpiresAt = Date.parse(textValue(secret, "access_token_expires_at"));
  if (Number.isFinite(accessExpiresAt) && accessExpiresAt > Date.now() + 72 * 60 * 60 * 1000) {
    return { status: "current" as const };
  }

  const appKey = textValue(secret, "app_key");
  const appSecret = textValue(secret, "app_secret");
  const refreshToken = textValue(secret, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(secret, "refresh_token_expires_at"));
  if (!appKey || !appSecret || !refreshToken) return { status: "awaiting_oauth" as const };
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) return { status: "refresh_expired" as const };

  const path = "/auth/token/refresh";
  const params: Record<string, string> = {
    app_key: appKey,
    refresh_token: refreshToken,
    sign_method: "sha256",
    timestamp: Date.now().toString(),
  };
  const signingInput = path + Object.keys(params).sort().map((key) => `${key}${params[key]}`).join("");
  params.sign = createHmac("sha256", appSecret).update(signingInput).digest("hex").toUpperCase();
  const url = new URL(`https://auth.lazada.com/rest${path}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json", "user-agent": "SellerPilot-Lazada-Token-Refresh/1.0" },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = textValue(payload, "access_token");
  const nextRefreshToken = textValue(payload, "refresh_token") || refreshToken;
  const responseCode = String(payload.code ?? "");
  if (!response.ok || !accessToken || (responseCode && responseCode !== "0")) throw new Error("token_refresh_failed");

  const nextAccessExpiry = new Date(Date.now() + Number(payload.expires_in ?? 2_592_000) * 1000).toISOString();
  const nextRefreshExpiry = new Date(Date.now() + Number(payload.refresh_expires_in ?? 15_552_000) * 1000).toISOString();
  const nextSecret = {
    ...secret,
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    access_token_expires_at: nextAccessExpiry,
    refresh_token_expires_at: nextRefreshExpiry,
  };
  const { error: rotateError } = await serviceClient.rpc("sellerpilot_service_refresh_lazada", {
    p_credential_id: active.credential_id,
    p_secret_payload: nextSecret,
    p_expires_at: nextRefreshExpiry,
  });
  if (rotateError) throw new Error("credential_rotate_failed");
  return { status: "refreshed" as const };
}

async function refreshEbayIfNeeded(projectUrl: string, secretKey: string) {
  const serviceClient = createClient(projectUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: "ebay",
    p_environment: "production",
  });
  if (error) throw new Error("credential_read_failed");
  const active = data as ActiveCredential | null;
  if (!active?.credential_id || typeof active.credential_id !== "string" || !active.secret_payload || typeof active.secret_payload !== "object" || Array.isArray(active.secret_payload)) {
    return { status: "not_connected" as const };
  }

  const secret = active.secret_payload as Record<string, unknown>;
  const accessExpiresAt = Date.parse(textValue(secret, "access_token_expires_at"));
  if (Number.isFinite(accessExpiresAt) && accessExpiresAt > Date.now() + 30 * 60 * 1000) {
    return { status: "current" as const };
  }
  const clientId = textValue(secret, "client_id");
  const clientSecret = textValue(secret, "client_secret");
  const ruName = textValue(secret, "ru_name");
  const refreshToken = textValue(secret, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(secret, "refresh_token_expires_at"));
  if (!clientId || !clientSecret || !ruName || !refreshToken) return { status: "awaiting_oauth" as const };
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) return { status: "refresh_expired" as const };

  const remote = await exchangeEbayOAuthToken({
    environment: "production",
    clientId,
    clientSecret,
    ruName,
    refreshToken,
    scopes: ebayDefaultScopes,
  });
  const accessToken = textValue(remote.data, "access_token");
  if (!remote.response.ok || !accessToken) throw new Error("token_refresh_failed");
  const nextAccessExpiry = new Date(Date.now() + Number(remote.data.expires_in ?? 7_200) * 1000).toISOString();
  const nextRefreshExpiry = Number.isFinite(refreshExpiresAt)
    ? new Date(refreshExpiresAt).toISOString()
    : new Date(Date.now() + 47_304_000 * 1000).toISOString();
  const nextSecret = {
    ...secret,
    access_token: accessToken,
    access_token_expires_at: nextAccessExpiry,
  };
  const { error: rotateError } = await serviceClient.rpc("sellerpilot_service_refresh_ebay", {
    p_credential_id: active.credential_id,
    p_secret_payload: nextSecret,
    p_expires_at: nextRefreshExpiry,
  });
  if (rotateError) throw new Error("credential_rotate_failed");
  return { status: "refreshed" as const };
}

async function refreshShopeeIfNeeded(projectUrl: string, secretKey: string) {
  const serviceClient = createClient(projectUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: "shopee",
    p_environment: "production",
  });
  if (error) throw new Error("credential_read_failed");
  const active = data as ActiveCredential | null;
  if (!active?.credential_id || typeof active.credential_id !== "string" || !active.secret_payload || typeof active.secret_payload !== "object" || Array.isArray(active.secret_payload)) {
    return { status: "not_connected" as const };
  }
  try {
    const ensured = await ensureShopeeAccessToken(active.secret_payload as Record<string, unknown>, "production", 60 * 60 * 1000);
    if (!ensured.refreshed) return { status: "current" as const };
    const { error: rotateError } = await serviceClient.rpc("sellerpilot_service_refresh_shopee", {
      p_credential_id: active.credential_id,
      p_secret_payload: ensured.payload,
      p_expires_at: ensured.credentialExpiresAt,
    });
    if (rotateError) throw new Error("credential_rotate_failed");
    return { status: "refreshed" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("REFRESH_TOKEN_EXPIRED")) return { status: "refresh_expired" as const };
    if (message.includes("AUTHORIZATION_EXPIRED")) return { status: "authorization_expired" as const };
    if (message.includes("REFRESH_CREDENTIALS_MISSING")) return { status: "awaiting_oauth" as const };
    throw error;
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!cronSecret) {
    return NextResponse.json({ message: "정리 작업 인증값이 설정되지 않았습니다." }, { status: 503 });
  }
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: "정리 작업 인증이 필요합니다." }, { status: 401 });
  }

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "Supabase 서버 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let lazadaToken: Awaited<ReturnType<typeof refreshLazadaIfNeeded>>;
  let ebayToken: Awaited<ReturnType<typeof refreshEbayIfNeeded>>;
  let shopeeToken: Awaited<ReturnType<typeof refreshShopeeIfNeeded>>;
  try {
    [shopeeToken, lazadaToken, ebayToken] = await Promise.all([
      refreshShopeeIfNeeded(supabaseUrl, secretKey),
      refreshLazadaIfNeeded(supabaseUrl, secretKey),
      refreshEbayIfNeeded(supabaseUrl, secretKey),
    ]);
  } catch {
    return NextResponse.json({ message: "채널 OAuth 토큰 자동 갱신을 완료하지 못했습니다." }, { status: 502 });
  }
  const retentionDays = 30;
  const completedBefore = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const runtimeCompletedBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [{ data, error }, { data: personalData, error: personalDataError }, { data: runtimeData, error: runtimeDataError }] = await Promise.all([
    serviceClient.rpc("sellerpilot_prune_ai_jobs", {
      p_completed_before: completedBefore,
      p_limit: 200,
    }),
    serviceClient.rpc("sellerpilot_prune_personal_data", {
      p_completed_before: completedBefore,
    }),
    serviceClient.rpc("sellerpilot_service_prune_runtime_noise", {
      p_completed_before: runtimeCompletedBefore,
    }),
  ]);
  if (error || personalDataError || runtimeDataError) {
    return NextResponse.json({ message: "30일 보관기간 정리를 완료하지 못했습니다." }, { status: 500 });
  }

  const rows = (data ?? []) as PrunedJob[];
  const storagePaths = rows.flatMap((row) => [
    ...(Array.isArray(row.input_paths) ? row.input_paths : []),
    ...(Array.isArray(row.result_paths) ? row.result_paths : []),
  ]);
  let storageRemoved = 0;
  if (storagePaths.length) {
    const { data: removed, error: removeError } = await serviceClient.storage
      .from("sellerpilot-ai")
      .remove(storagePaths);
    if (!removeError) storageRemoved = removed?.length ?? 0;
  }
  const push = await dispatchPendingPushNotifications(serviceClient, 100).catch(() => ({ configured: true, claimed: 0, sent: 0, failed: 1 }));

  return NextResponse.json({
    ok: true,
    retentionDays,
    jobsPruned: rows.length,
    storageRemoved,
    personalData,
    runtimeData,
    shopeeToken: shopeeToken.status,
    lazadaToken: lazadaToken.status,
    ebayToken: ebayToken.status,
    push: { configured: push.configured, sent: push.sent, failed: push.failed },
    completedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
