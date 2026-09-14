import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { refreshKakaoToken, sendKakaoMemo } from "../../../../../lib/kakao";

export const runtime = "nodejs";

const preferences = z.object({
  kakao_enabled: z.boolean(), order_paid: z.boolean(), shipping_ready: z.boolean(), shipping_completed: z.boolean(),
  listing_published: z.boolean(), listing_failed: z.boolean(), low_stock: z.boolean(), cs_waiting: z.boolean(), settlement_rate_risk: z.boolean(),
});

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_notification_settings");
  if (error) return NextResponse.json({ message: "알림 설정을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const body = await request.json().catch(() => null) as { action?: unknown; preferences?: unknown } | null;
  if (body?.action === "test") {
    const { data, error } = await admin.serviceClient.rpc("sellerpilot_service_get_kakao_secret", { p_owner_id: admin.user.id });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return NextResponse.json({ message: "연결된 사용자 카카오톡이 없습니다." }, { status: 409 });
    const context = data as Record<string, unknown>;
    let secret = context.secret && typeof context.secret === "object" && !Array.isArray(context.secret) ? context.secret as Record<string, unknown> : {};
    if (typeof secret.access_token !== "string") secret = await refreshKakaoToken(secret);
    try {
      await sendKakaoMemo(String(secret.access_token), "SellerPilot 카카오 알림 테스트", "가입한 사용자 본인의 ‘나와의 채팅’ 연결이 정상입니다.", "/?view=notifications", new URL(request.url).origin);
      return NextResponse.json({ ok: true });
    } catch {
      secret = await refreshKakaoToken(secret);
      await admin.serviceClient.rpc("sellerpilot_service_store_kakao_integration", { p_owner_id: admin.user.id, p_secret_payload: secret, p_kakao_user_id: String(context.kakaoUserId ?? "unknown"), p_nickname: String(context.nickname ?? "카카오 사용자"), p_expires_at: new Date(Date.now() + Number(secret.expires_in ?? 21_600) * 1000).toISOString() });
      await sendKakaoMemo(String(secret.access_token), "SellerPilot 카카오 알림 테스트", "가입한 사용자 본인의 ‘나와의 채팅’ 연결이 정상입니다.", "/?view=notifications", new URL(request.url).origin);
      return NextResponse.json({ ok: true });
    }
  }
  const parsed = preferences.safeParse(body?.preferences);
  if (!parsed.success) return NextResponse.json({ message: "알림 세부 설정을 확인해 주세요." }, { status: 400 });
  const { data, error } = await admin.userClient.rpc("sellerpilot_save_notification_preferences", { p_values: parsed.data });
  if (error || data !== true) return NextResponse.json({ message: "알림 설정을 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
