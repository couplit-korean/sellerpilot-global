import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { createKakaoState } from "../../../../../lib/kakao";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const clientId = process.env.KAKAO_REST_API_KEY?.trim() ?? "";
  if (!clientId) return NextResponse.json({ message: "KAKAO_REST_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  const redirectUri = process.env.KAKAO_REDIRECT_URI?.trim() || new URL("/api/integrations/kakao/callback", request.url).toString();
  const state = createKakaoState({ uid: admin.user.id, exp: Date.now() + 10 * 60_000, nonce: randomUUID(), redirectUri });
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile_nickname,talk_message");
  url.searchParams.set("state", state);
  return NextResponse.json({ authorizationUrl: url.toString() });
}
