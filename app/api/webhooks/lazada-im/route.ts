import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { selectLazadaImWebhookRoute, persistLazadaImInquiry } from "../../../../lib/channels/lazada-im-webhook";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 256_000) return NextResponse.json({ message: "payload too large" }, { status: 413 });
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!serviceKey || !supabaseUrl) return NextResponse.json({ message: "server unavailable" }, { status: 503 });
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const requestedAppKey = new URL(request.url).searchParams.get("app_key");
  if (requestedAppKey !== null && (!requestedAppKey || requestedAppKey.length > 256 || requestedAppKey.trim() !== requestedAppKey)) return NextResponse.json({ message: "invalid signature" }, { status: 401 });
  let candidates: unknown;
  try {
    const result = await serviceClient.rpc("sellerpilot_service_lazada_im_webhook_candidates_v1", { p_app_key: requestedAppKey });
    if (result.error) return NextResponse.json({ message: "server unavailable" }, { status: 503 });
    candidates = result.data;
  } catch {
    return NextResponse.json({ message: "server unavailable" }, { status: 503 });
  }
  const selection = selectLazadaImWebhookRoute(raw, request.headers.get("authorization"), candidates, requestedAppKey);
  if (!selection.ok) return NextResponse.json({ message: selection.status === 401 ? "invalid signature" : selection.status === 400 ? "invalid payload" : "seller binding unavailable" }, { status: selection.status });
  if (selection.kind === "ignored") return NextResponse.json({ ok: true, ignored: true });
  const { credentialId, inquiry } = selection;
  const ingestResult = await persistLazadaImInquiry(credentialId, inquiry, (arguments_) => (
    serviceClient.rpc("sellerpilot_service_ingest_lazada_inquiries_v2", { p_credential_id: arguments_.p_credential_id, p_inquiries: arguments_.p_inquiries })
  ), () => serviceClient.rpc("sellerpilot_service_lazada_quarantine_ready"));
  if (ingestResult.ok === false) {
    return NextResponse.json({ message: ingestResult.partial ? "Lazada partial ingestion: quarantine storage/review pending" : "server unavailable", partial: ingestResult.partial === true, retryAfterSeconds: 300 }, { status: ingestResult.status, headers: { "retry-after": "300" } });
  }
  return NextResponse.json({ ok: true });
}
