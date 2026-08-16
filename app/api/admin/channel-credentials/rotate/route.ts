import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabasePublishableKey, supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid().optional(),
  channel: z.literal("qoo10"),
  environment: z.enum(["sandbox", "production"]),
  secretPayload: z.record(z.string(), z.string().trim().max(8_000)),
  expiresAt: z.string().datetime().nullable(),
  rotationDays: z.number().int().min(1).max(365),
  warningDays: z.number().int().min(1).max(180),
  graceDays: z.number().int().min(0).max(30),
});

type SecretPayload = Record<string, unknown>;

function hasText(payload: SecretPayload, key: string) {
  return typeof payload[key] === "string" && payload[key].trim().length > 0;
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
  if (!parsed.success) return NextResponse.json({ message: "키 교체 요청 형식이 올바르지 않습니다." }, { status: 400 });

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

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let nextSecret: SecretPayload = {};
  if (parsed.data.credentialId) {
    const metadata = Array.isArray(credentialRows)
      ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === parsed.data.credentialId)
      : null;
    if (!metadata || !("channel" in metadata) || metadata.channel !== parsed.data.channel || !("status" in metadata) || metadata.status !== "active") {
      return NextResponse.json({ message: "활성 키와 교체 요청이 일치하지 않습니다." }, { status: 409 });
    }
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: parsed.data.credentialId });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ message: "기존 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
    }
    nextSecret = data as SecretPayload;
  }
  nextSecret = { ...nextSecret, ...parsed.data.secretPayload };

  const valid = hasText(nextSecret, "seller_id") && hasText(nextSecret, "api_key");
  if (!valid) return NextResponse.json({ message: "필수 키 값이 누락됐습니다." }, { status: 400 });

  const { error: rotateError } = await userClient.rpc("sellerpilot_rotate_credential", {
    p_channel: parsed.data.channel,
    p_environment: parsed.data.environment,
    p_secret_payload: nextSecret,
    p_expires_at: parsed.data.expiresAt,
    p_rotation_interval_days: parsed.data.rotationDays,
    p_warning_days: parsed.data.warningDays,
    p_grace_days: parsed.data.credentialId ? parsed.data.graceDays : 0,
  });
  if (rotateError) return NextResponse.json({ message: "키를 Vault에 저장하지 못했습니다." }, { status: 500 });

  return NextResponse.json({ message: "키 교체와 Vault 저장이 완료됐습니다." }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
