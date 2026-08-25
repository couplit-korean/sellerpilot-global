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
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const { data: registered, error: registrationError } = await admin.serviceClient.rpc(
    "sellerpilot_service_register_kakao_oauth_state",
    {
      p_owner_id: admin.user.id,
      p_state_nonce: nonce,
      p_redirect_uri: redirectUri,
      p_expires_at: expiresAt.toISOString(),
    },
  );
  if (registrationError || registered !== true) {
    return NextResponse.json({ message: "카카오 연결 상태를 안전하게 준비하지 못했습니다." }, { status: 503 });
  }
  let state: string;
  try {
    state = createKakaoState({ uid: admin.user.id, exp: expiresAt.getTime(), nonce, redirectUri });
  } catch {
    return NextResponse.json({ message: "카카오 연결 보안 설정이 완료되지 않았습니다." }, { status: 503 });
  }
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile_nickname,talk_message");
  url.searchParams.set("state", state);
  return NextResponse.json({ authorizationUrl: url.toString() }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
