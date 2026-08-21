import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { refreshKakaoToken, sendKakaoMemo } from "../../../../lib/kakao";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type Delivery = { id: string; owner_id: string; title: string; body: string; link_path: string; secret_payload: Record<string, unknown>; expires_at: string | null; kakao_user_id: string; nickname: string };

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ message: "카카오 알림 작업 인증이 필요합니다." }, { status: 401 });
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!serviceKey || !supabaseUrl) return NextResponse.json({ message: "Supabase 서버 설정이 없습니다." }, { status: 503 });
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await serviceClient.rpc("sellerpilot_service_enqueue_kakao_summaries");
  const { data, error } = await serviceClient.rpc("sellerpilot_service_claim_kakao_notifications", { p_limit: 40 });
  if (error) return NextResponse.json({ message: "카카오 알림 작업을 가져오지 못했습니다." }, { status: 500 });
  const rows = (Array.isArray(data) ? data : []).filter((item): item is Delivery => Boolean(item) && typeof item === "object" && typeof item.id === "string" && typeof item.owner_id === "string" && item.secret_payload && typeof item.secret_payload === "object");
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      let secret = row.secret_payload;
      if (!row.expires_at || Date.parse(row.expires_at) <= Date.now() + 60_000) {
        secret = await refreshKakaoToken(secret);
        await serviceClient.rpc("sellerpilot_service_store_kakao_integration", { p_owner_id: row.owner_id, p_secret_payload: secret, p_kakao_user_id: row.kakao_user_id, p_nickname: row.nickname, p_expires_at: new Date(Date.now() + Number(secret.expires_in ?? 21_600) * 1000).toISOString() });
      }
      await sendKakaoMemo(String(secret.access_token ?? ""), row.title, row.body, row.link_path, process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin);
      await serviceClient.rpc("sellerpilot_service_complete_kakao_notification", { p_id: row.id, p_success: true, p_error: null });
      sent += 1;
    } catch (sendError) {
      await serviceClient.rpc("sellerpilot_service_complete_kakao_notification", { p_id: row.id, p_success: false, p_error: sendError instanceof Error ? sendError.message : "send failed" });
      failed += 1;
    }
  }
  return NextResponse.json({ ok: failed === 0, claimed: rows.length, sent, failed }, { status: failed ? 207 : 200, headers: { "cache-control": "no-store, max-age=0" } });
}
