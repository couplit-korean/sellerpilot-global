import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { shopeeExactWorkerInput, parseShopeeExactClaim, shopeeExactAuthenticatedFetch } from "../../../../../lib/channels/shopee-oauth-exact";
import { supabaseUrl } from "../../../../../lib/supabase/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!token.startsWith("spw_") || token.length < 24) return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  const input = shopeeExactWorkerInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ status: "invalid_request" }, { status: 400 });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secret) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  const client = createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: shopeeExactAuthenticatedFetch } });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = input.data.action === "heartbeat"
    ? await client.rpc("sellerpilot_shopee_exact_oauth_heartbeat", { p_session: input.data.sessionId, p_token_hash: tokenHash, p_job: input.data.jobId, p_claim: input.data.claimToken })
    : await client.rpc("sellerpilot_shopee_exact_oauth_worker", { p_action: input.data.action, p_session: input.data.sessionId, p_token_hash: tokenHash });
  if (error || !data) return NextResponse.json({ status: "exact_executor_blocked" }, { status: 409 });
  if (data.status === "claimed") {
    try { parseShopeeExactClaim(data.job, input.data.sessionId); }
    catch { return NextResponse.json({ status: "invalid_claim" }, { status: 409 }); }
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
