import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";

function safeEqualHex(left: string, right: string) {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  const appKey = process.env.LAZADA_APP_KEY?.trim() ?? "";
  const appSecret = process.env.LAZADA_APP_SECRET?.trim() ?? "";
  const signature = (request.headers.get("authorization") ?? "").replace(/^sha256[=\s]+/i, "").trim();
  const expected = appKey && appSecret ? createHmac("sha256", appSecret).update(`${appKey}${raw}`).digest("hex") : "";
  if (!expected || !signature || !safeEqualHex(expected, signature)) return NextResponse.json({ message: "invalid signature" }, { status: 401 });
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!serviceKey || !supabaseUrl) return NextResponse.json({ message: "server unavailable" }, { status: 503 });
  let payload = JSON.parse(raw) as Record<string, unknown>;
  if (typeof payload.data === "string") {
    try { payload = { ...payload, data: JSON.parse(payload.data) as unknown }; } catch { /* keep raw data */ }
  }
  const data = record(payload.data);
  const message = record(data.message);
  const content = record(message.content);
  const sessionId = text(data.session_id, data.sessionId, message.session_id, payload.session_id);
  const messageId = text(message.message_id, data.message_id, payload.message_id, payload.uuid);
  const messageText = text(content.txt, content.text, message.txt, message.text, data.txt, data.content);
  if (!sessionId || !messageText) return NextResponse.json({ ok: true, ignored: true });
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: credential } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", { p_channel: "lazada", p_environment: "production" });
  const credentialId = credential && typeof credential === "object" && !Array.isArray(credential) && typeof credential.credential_id === "string" ? credential.credential_id : "";
  if (credentialId) await serviceClient.rpc("sellerpilot_service_ingest_inquiries", {
    p_credential_id: credentialId,
    p_channel: "lazada",
    p_inquiries: [{ externalTicketId: `lazada-im:${sessionId}`, customerName: text(data.buyer_name, data.from_account_name, message.from_name, "Lazada 고객"), subject: text(data.product_name, data.title, "Lazada IM 문의"), message: messageText, status: "waiting", priority: 3, receivedAt: text(message.send_time, data.send_time, payload.timestamp, new Date().toISOString()), remoteMessageId: messageId }],
  });
  return NextResponse.json({ ok: true });
}
