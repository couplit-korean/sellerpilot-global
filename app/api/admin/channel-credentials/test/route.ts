import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runChannelDiagnostic } from "../../../../../lib/channel-diagnostics";
import { executeDiagnosticViaChannelGateway } from "../../../../../lib/channels/gateway";
import { runTracxDiagnostic } from "../../../../../lib/logistics/tracx";
import { supabasePublishableKey, supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid(),
  channel: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu", "tracx"]),
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
  if (
    parsed.data.channel === "shopee"
    || parsed.data.channel === "lazada"
    || parsed.data.channel === "coupang"
    || parsed.data.channel === "elevenst"
    || parsed.data.channel === "smartstore"
    || parsed.data.channel === "ebay"
    || parsed.data.channel === "temu"
  ) {
    try {
      const result = await executeDiagnosticViaChannelGateway({
        serviceClient,
        credentialId: parsed.data.credentialId,
        channel: parsed.data.channel,
      });
      await serviceClient.rpc("sellerpilot_record_credential_test", {
        p_credential_id: parsed.data.credentialId,
        p_status: result.status,
        p_safe_message: result.message,
      });
      return NextResponse.json(result, {
        status: result.status === "failed" ? 422 : 200,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    } catch {
      const channelName = {
        shopee: "Shopee",
        lazada: "Lazada",
        coupang: "쿠팡",
        elevenst: "11번가",
        smartstore: "네이버",
        ebay: "eBay",
        temu: "Temu",
      }[parsed.data.channel];
      const message = `${channelName} 고정 IP 채널 워커에서 연결 검사를 완료하지 못했습니다. 워커 상태와 채널 인증값을 확인해 주세요.`;
      await serviceClient.rpc("sellerpilot_record_credential_test", {
        p_credential_id: parsed.data.credentialId,
        p_status: "failed",
        p_safe_message: message,
      });
      return NextResponse.json({ status: "failed", message }, { status: 422 });
    }
  }
  const { data: secretPayload, error: secretError } = await serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: parsed.data.credentialId,
  });
  if (secretError || !secretPayload || typeof secretPayload !== "object") {
    return NextResponse.json({ message: "활성 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
  }

  const environment = "environment" in credentialMetadata && credentialMetadata.environment === "sandbox" ? "sandbox" : "production";
  const diagnosticPayload = secretPayload as Record<string, unknown>;
  const diagnosticCredentialId = parsed.data.credentialId;
  if (parsed.data.channel === "tracx") {
    try {
      const result = await runTracxDiagnostic(diagnosticPayload);
      await serviceClient.rpc("sellerpilot_record_credential_test", {
        p_credential_id: diagnosticCredentialId,
        p_status: result.status,
        p_safe_message: result.message,
      });
      return NextResponse.json(result, {
        status: result.status === "failed" ? 422 : 200,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const message = timeout
        ? "SmartShip 응답 제한시간(15초)을 초과했습니다."
        : "SmartShip TxAPI 연결 중 안전하게 처리된 오류가 발생했습니다.";
      await serviceClient.rpc("sellerpilot_record_credential_test", {
        p_credential_id: diagnosticCredentialId,
        p_status: "failed",
        p_safe_message: message,
      });
      return NextResponse.json({ status: "failed", message }, { status: 422 });
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
