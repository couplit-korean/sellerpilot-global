import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runChannelDiagnostic } from "../../../../../lib/channel-diagnostics";
import { ensureEbayAccessToken, ensureShopeeAccessToken } from "../../../../../lib/channels/protocols";
import { supabasePublishableKey, supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid(),
  channel: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay"]),
});

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "검사 요청 형식이 올바르지 않습니다." }, { status: 400 });

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
  const credentialMetadata = Array.isArray(credentialRows)
    ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === parsed.data.credentialId)
    : null;
  if (!credentialMetadata || !("channel" in credentialMetadata) || credentialMetadata.channel !== parsed.data.channel || !("status" in credentialMetadata) || credentialMetadata.status !== "active") {
    return NextResponse.json({ message: "활성 키와 채널 정보가 일치하지 않습니다." }, { status: 409 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: secretPayload, error: secretError } = await serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: parsed.data.credentialId,
  });
  if (secretError || !secretPayload || typeof secretPayload !== "object") {
    return NextResponse.json({ message: "활성 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
  }

  const environment = "environment" in credentialMetadata && credentialMetadata.environment === "sandbox" ? "sandbox" : "production";
  let diagnosticPayload = secretPayload as Record<string, unknown>;
  let diagnosticCredentialId = parsed.data.credentialId;
  if (parsed.data.channel === "shopee") {
    try {
      const ensured = await ensureShopeeAccessToken(diagnosticPayload, environment);
      diagnosticPayload = ensured.payload;
      if (ensured.refreshed) {
        const { data: nextCredentialId, error: refreshError } = await serviceClient.rpc("sellerpilot_service_refresh_shopee", {
          p_credential_id: parsed.data.credentialId,
          p_secret_payload: ensured.payload,
          p_expires_at: ensured.credentialExpiresAt,
        });
        if (refreshError || typeof nextCredentialId !== "string") throw new Error("refresh_store_failed");
        diagnosticCredentialId = nextCredentialId;
      }
    } catch {
      return NextResponse.json({ status: "failed", message: "Shopee OAuth 토큰을 갱신하지 못했습니다. 판매자 승인을 다시 확인해 주세요." }, { status: 422 });
    }
  }
  if (parsed.data.channel === "ebay") {
    try {
      const ensured = await ensureEbayAccessToken(diagnosticPayload, environment);
      diagnosticPayload = ensured.payload;
      if (ensured.refreshed) {
        const { data: nextCredentialId, error: refreshError } = await serviceClient.rpc("sellerpilot_service_refresh_ebay", {
          p_credential_id: parsed.data.credentialId,
          p_secret_payload: ensured.payload,
          p_expires_at: ensured.credentialExpiresAt,
        });
        if (refreshError || typeof nextCredentialId !== "string") throw new Error("refresh_store_failed");
        diagnosticCredentialId = nextCredentialId;
      }
    } catch {
      return NextResponse.json({ status: "failed", message: "eBay OAuth 토큰을 갱신하지 못했습니다. 판매자 동의를 다시 확인해 주세요." }, { status: 422 });
    }
  }
  const result = await runChannelDiagnostic(parsed.data.channel, diagnosticPayload, environment);
  await serviceClient.rpc("sellerpilot_record_credential_test", {
    p_credential_id: diagnosticCredentialId,
    p_status: result.status,
    p_safe_message: result.message,
  });
  return NextResponse.json(result, {
    status: result.status === "failed" ? 422 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
