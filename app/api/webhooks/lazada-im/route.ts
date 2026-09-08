import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  markLazadaImRawEvent,
  persistLazadaImInquiry,
  persistLazadaImRawEvent,
  selectLazadaImWebhookRoute,
} from "../../../../lib/channels/lazada-im-webhook";
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
  if (!selection.ok) return NextResponse.json({ message: selection.status === 401 ? "invalid signature" : selection.status === 400 ? "invalid payload"
    : "seller binding unavailable" }, {
    status: selection.status, ...(selection.status === 503 ? { headers: { "retry-after": "300" } } : {}),
  });
  if (selection.kind === "ignored") return NextResponse.json({ ok: true, ignored: true });
  const { credentialId } = selection;
  const stored = await persistLazadaImRawEvent(credentialId, raw, (arguments_) => (
    serviceClient.rpc("sellerpilot_service_store_lazada_im_raw_event_v1", arguments_)
  ));
  if (!stored.ok) return NextResponse.json({ message: "message storage unavailable" }, {
    status: 503, headers: { "retry-after": "300" },
  });
  if (selection.kind === "raw") {
    return NextResponse.json({ ok: true, stored: true, pending: true });
  }
  const { inquiry } = selection;
  const ingestResult = await persistLazadaImInquiry(credentialId, inquiry, (arguments_) => (
    serviceClient.rpc("sellerpilot_service_ingest_lazada_inquiries_v3", { p_credential_id: arguments_.p_credential_id, p_inquiries: arguments_.p_inquiries })
  ), () => serviceClient.rpc("sellerpilot_service_lazada_quarantine_ready_v3"), () => (
    serviceClient.rpc("sellerpilot_service_lazada_im_ingest_ready_v3", { p_credential_id: credentialId })
  ));
  if (ingestResult.ok === false) {
    return NextResponse.json({ message: ingestResult.partial ? "Lazada partial ingestion: quarantine storage/review pending" : "server unavailable", partial: ingestResult.partial === true, retryAfterSeconds: 300 }, { status: ingestResult.status, headers: { "retry-after": "300" } });
  }
  const marked = await markLazadaImRawEvent(credentialId, stored.receipt.id, "normalized", (arguments_) => (
    serviceClient.rpc("sellerpilot_service_mark_lazada_im_raw_event_v1", arguments_)
  ));
  if (!marked) return NextResponse.json({ message: "message storage unavailable" }, {
    status: 503, headers: { "retry-after": "300" },
  });
  return NextResponse.json({ ok: true });
}
