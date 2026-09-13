import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { lazadaImExactAdminInput, lazadaImExactFetch } from "../../../../../../lib/channels/lazada-oauth-im-exact";
import { supabaseUrl, supabasePublishableKey } from "../../../../../../lib/supabase/config";
export const runtime = "nodejs";
const cookieName = "sellerpilot_lazada_im_exact_oauth";
export async function POST(request: NextRequest) {
  const parsed = lazadaImExactAdminInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ status: "invalid_request" }, { status: 400 });
  const bearer = request.headers.get("authorization") ?? "";
  if (!bearer.startsWith("Bearer ")) return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabasePublishableKey || !secret) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  const user = createClient(supabaseUrl, supabasePublishableKey, { global: { fetch: lazadaImExactFetch, headers: { Authorization: bearer } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await user.auth.getUser(bearer.slice(7));
  const { data: admin, error: adminError } = await user.rpc("sellerpilot_is_admin");
  if (authError || !auth.user || adminError || admin !== true) return NextResponse.json({ status: "forbidden" }, { status: 403 });
  const input = parsed.data;
  const state = input.action === "prepare" ? `sellerpilot-lazada-im-cb-${randomBytes(24).toString("base64url")}` : request.cookies.get(cookieName)?.value.split(".")[0] ?? "";
  const sessionId = input.action === "prepare" ? randomUUID() : input.sessionId;
  if (input.action !== "prepare" && request.cookies.get(cookieName)?.value !== `${state}.${sessionId}.${input.credentialId}`) return NextResponse.json({ status: "state_mismatch" }, { status: 403 });
  if (input.action === "bind" && (Buffer.byteLength(input.state) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(input.state), Buffer.from(state)))) return NextResponse.json({ status: "state_mismatch" }, { status: 403 });
  const service = createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: lazadaImExactFetch } });
  const { data, error } = await service.rpc("sellerpilot_lazada_im_exact_oauth_admin", {
    p_action: input.action, p_actor: auth.user.id, p_session: sessionId, p_credential: input.credentialId,
    p_state_hash: createHash("sha256").update(state).digest("hex"),
    p_request: input.action === "bind" ? { code: input.code, country: "cb" } : {},
  });
  if (error || !data || typeof data !== "object") return NextResponse.json({ status: "exact_executor_blocked" }, { status: 409 });
  const response = NextResponse.json(input.action === "start" && data.status === "ready" ? {
    status: "ready", sessionId,
    authorizationUrl: new URL("https://auth.lazada.com/oauth/authorize?" + new URLSearchParams({ response_type: "code", force_auth: "true", client_id: "137571", country: "cb", redirect_uri: new URL("/", request.nextUrl.origin).toString(), state })).toString(),
  } : data, { headers: { "cache-control": "no-store" } });
  if (input.action === "prepare") response.cookies.set(cookieName, `${state}.${sessionId}.${input.credentialId}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
