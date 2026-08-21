import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyKakaoState } from "../../../../../lib/kakao";
import { supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

function finish(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("view", "notifications");
  url.searchParams.set("kakao", result);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verifyKakaoState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) return finish(request, "invalid_state");
  const clientId = process.env.KAKAO_REST_API_KEY?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!clientId || !serviceKey || !supabaseUrl) return finish(request, "server_config");
  const tokenBody = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: state.redirectUri, code });
  const clientSecret = process.env.KAKAO_CLIENT_SECRET?.trim();
  if (clientSecret) tokenBody.set("client_secret", clientSecret);
  const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: tokenBody, cache: "no-store" });
  const token = await tokenResponse.json() as Record<string, unknown>;
  if (!tokenResponse.ok || typeof token.access_token !== "string") return finish(request, "token_failed");
  const profileResponse = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
  const profile = await profileResponse.json() as Record<string, unknown>;
  if (!profileResponse.ok || !profile.id) return finish(request, "profile_failed");
  const properties = profile.properties && typeof profile.properties === "object" && !Array.isArray(profile.properties) ? profile.properties as Record<string, unknown> : {};
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const expiresIn = Number(token.expires_in ?? 21_600);
  const { error } = await serviceClient.rpc("sellerpilot_service_store_kakao_integration", {
    p_owner_id: state.uid,
    p_secret_payload: token,
    p_kakao_user_id: String(profile.id),
    p_nickname: typeof properties.nickname === "string" ? properties.nickname : "카카오 사용자",
    p_expires_at: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
  });
  return finish(request, error ? "save_failed" : "connected");
}
