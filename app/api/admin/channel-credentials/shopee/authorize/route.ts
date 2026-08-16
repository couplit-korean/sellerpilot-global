import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabasePublishableKey, supabaseUrl } from "../../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid().optional(),
  environment: z.enum(["sandbox", "production"]),
  secretPayload: z.record(z.string(), z.string().max(4096)),
  expiresAt: z.string().datetime().nullable(),
  rotationDays: z.number().int().min(1).max(730),
  warningDays: z.number().int().min(1).max(365),
  graceDays: z.number().int().min(0).max(90),
});

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
  if (userError || !userData.user || adminError || credentialError || isAdmin !== true) return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let previousSecret: Record<string, unknown> = {};
  if (parsed.data.credentialId) {
    const metadata = Array.isArray(credentialRows) ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === parsed.data.credentialId) : null;
    if (!metadata || !("channel" in metadata) || metadata.channel !== "shopee" || !("status" in metadata) || metadata.status !== "active") {
      return NextResponse.json({ message: "활성 Shopee 키와 요청이 일치하지 않습니다." }, { status: 409 });
    }
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: parsed.data.credentialId });
    if (error || !data || typeof data !== "object") return NextResponse.json({ message: "기존 Shopee 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
    previousSecret = data as Record<string, unknown>;
  }

  const incoming = parsed.data.secretPayload;
  const partnerId = textValue(incoming, "partner_id") || textValue(previousSecret, "partner_id");
  const partnerKey = textValue(incoming, "partner_key") || textValue(previousSecret, "partner_key");
  const shopId = textValue(incoming, "shop_id") || textValue(previousSecret, "shop_id");
  const code = textValue(incoming, "authorization_code");
  if (!partnerId || !partnerKey || !shopId) return NextResponse.json({ message: "Partner ID·Partner Key·Shop ID가 필요합니다." }, { status: 400 });
  if (!parsed.data.credentialId && !code) return NextResponse.json({ message: "최초 연결에는 OAuth Authorization Code가 필요합니다." }, { status: 400 });

  const nextSecret: Record<string, unknown> = { ...previousSecret, ...incoming, partner_id: partnerId, partner_key: partnerKey, shop_id: shopId };
  delete nextSecret.authorization_code;
  if (code) {
    const path = "/api/v2/auth/token/get";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = createHmac("sha256", partnerKey).update(`${partnerId}${path}${timestamp}`).digest("hex");
    const url = new URL(`https://partner.shopeemobile.com${path}`);
    url.search = new URLSearchParams({ partner_id: partnerId, timestamp, sign }).toString();
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: Number(partnerId) }),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    const accessToken = textValue(data, "access_token");
    const refreshToken = textValue(data, "refresh_token");
    if (!response.ok || !accessToken || !refreshToken) {
      const errorCode = textValue(data, "error");
      return NextResponse.json({ message: `Shopee OAuth 토큰 교환에 실패했습니다${errorCode ? ` · ${errorCode}` : ""}.` }, { status: 422 });
    }
    nextSecret.access_token = accessToken;
    nextSecret.refresh_token = refreshToken;
    nextSecret.access_token_expires_at = new Date(Date.now() + Number(data.expire_in ?? 14_400) * 1000).toISOString();
  }

  if (!textValue(nextSecret, "access_token")) return NextResponse.json({ message: "Shopee Access Token이 없습니다. OAuth를 다시 진행해 주세요." }, { status: 400 });
  const { error: rotateError } = await userClient.rpc("sellerpilot_rotate_credential", {
    p_channel: "shopee",
    p_environment: parsed.data.environment,
    p_secret_payload: nextSecret,
    p_expires_at: parsed.data.expiresAt,
    p_rotation_interval_days: parsed.data.rotationDays,
    p_warning_days: parsed.data.warningDays,
    p_grace_days: parsed.data.graceDays,
  });
  if (rotateError) return NextResponse.json({ message: rotateError.message.includes("administrator") ? "관리자 권한이 필요합니다." : "Shopee 키를 Vault에 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ message: "Shopee OAuth 연결과 Vault 저장이 완료됐습니다." }, { headers: { "cache-control": "no-store, max-age=0" } });
}
