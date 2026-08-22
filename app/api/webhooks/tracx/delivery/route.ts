import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseTracxDeliveryPayload } from "../../../../../lib/logistics/tracx-webhook";
import { supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

function equalSecret(received: string, expected: string) {
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) return NextResponse.json({ ok: false }, { status: 503 });
  const receivedToken = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (receivedToken.length < 32 || receivedToken.length > 256) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: credential, error: credentialError } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: "tracx",
    p_environment: "production",
  });
  if (credentialError || !credential || typeof credential !== "object" || Array.isArray(credential)) {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const record = credential as Record<string, unknown>;
  const payload = record.secret_payload && typeof record.secret_payload === "object" && !Array.isArray(record.secret_payload)
    ? record.secret_payload as Record<string, unknown>
    : {};
  const expectedToken = typeof payload.webhook_secret === "string" ? payload.webhook_secret.trim() : "";
  const credentialId = typeof record.credential_id === "string" ? record.credential_id : "";
  if (!credentialId || expectedToken.length < 32 || !equalSecret(receivedToken, expectedToken)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const parsed = parseTracxDeliveryPayload(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ ok: false }, { status: 400, headers: { "cache-control": "no-store, max-age=0" } });
  if (parsed.kind === "probe") {
    return NextResponse.json({ ok: true, probe: true }, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  const { data: matched, error } = await serviceClient.rpc("sellerpilot_service_ingest_tracx_delivery", {
    p_credential_id: credentialId,
    p_event: parsed.event,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500, headers: { "cache-control": "no-store, max-age=0" } });
  return NextResponse.json({ ok: true, matched: matched === true }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
