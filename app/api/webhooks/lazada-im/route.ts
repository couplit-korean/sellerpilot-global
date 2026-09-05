import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseLazadaImPush } from "../../../../lib/channels/lazada-im";
import { parseLazadaImWebhookBody, persistLazadaImInquiry } from "../../../../lib/channels/lazada-im-webhook";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";

function safeEqualHex(left: string, right: string) {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 256_000) return NextResponse.json({ message: "payload too large" }, { status: 413 });
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!serviceKey || !supabaseUrl) return NextResponse.json({ message: "server unavailable" }, { status: 503 });
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: credential, error: credentialError } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: "lazada",
    p_environment: "production",
  });
  const context = credential && typeof credential === "object" && !Array.isArray(credential)
    ? credential as Record<string, unknown>
    : null;
  const secret = context?.secret_payload && typeof context.secret_payload === "object" && !Array.isArray(context.secret_payload)
    ? context.secret_payload as Record<string, unknown>
    : null;
  const appKey = text(secret?.app_key, process.env.LAZADA_APP_KEY);
  const appSecret = text(secret?.app_secret, process.env.LAZADA_APP_SECRET);
  if (credentialError || !appKey || !appSecret) return NextResponse.json({ message: "server unavailable" }, { status: 503 });
  const signature = (request.headers.get("authorization") ?? "").replace(/^sha256[=\s]+/i, "").trim();
  const expected = createHmac("sha256", appSecret).update(`${appKey}${raw}`).digest("hex");
  if (!expected || !signature || !safeEqualHex(expected, signature)) return NextResponse.json({ message: "invalid signature" }, { status: 401 });
  const payload = parseLazadaImWebhookBody(raw);
  if (!payload) return NextResponse.json({ message: "invalid payload" }, { status: 400 });
  const inquiry = parseLazadaImPush(payload);
  if (!inquiry) return NextResponse.json({ ok: true, ignored: true });
  const credentialId = context && typeof context.credential_id === "string" ? context.credential_id : "";
  const ingestResult = await persistLazadaImInquiry(credentialId, inquiry, (arguments_) => (
    serviceClient.rpc("sellerpilot_service_ingest_lazada_inquiries_v2", { p_credential_id: arguments_.p_credential_id, p_inquiries: arguments_.p_inquiries })
  ), () => serviceClient.rpc("sellerpilot_service_lazada_quarantine_ready"));
  if (ingestResult.ok === false) {
    return NextResponse.json({ message: ingestResult.partial ? "Lazada partial ingestion: quarantine storage/review pending" : "server unavailable", partial: ingestResult.partial === true, retryAfterSeconds: 300 }, { status: ingestResult.status, headers: { "retry-after": "300" } });
  }
  return NextResponse.json({ ok: true });
}
