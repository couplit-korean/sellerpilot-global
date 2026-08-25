import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseTracxDeliveryPayload } from "../../../../../lib/logistics/tracx-webhook";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorStatus } from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function equalSecret(received: string, expected: string) {
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function rpcErrorResponse(context: string, error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
  const status = workerRpcErrorStatus(code ? { code } : null);
  console.error(`TracX delivery ${context} RPC failed`, { code: code ?? "unknown", status });
  return NextResponse.json({ ok: false }, { status, headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) return NextResponse.json({ ok: false }, { status: 503, headers: noStoreHeaders });
  const receivedToken = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (receivedToken.length < 32 || receivedToken.length > 256) {
    return NextResponse.json({ ok: false }, { status: 401, headers: noStoreHeaders });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch(5_000) },
  });
  let credential: unknown = null;
  let credentialError: unknown = null;
  try {
    const result = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
      p_channel: "tracx",
      p_environment: "production",
    });
    credential = result.data;
    credentialError = result.error;
  } catch (error) {
    return rpcErrorResponse("credential lookup", error);
  }
  if (credentialError) return rpcErrorResponse("credential lookup", credentialError);
  if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
    return NextResponse.json({ ok: false }, { status: 503, headers: noStoreHeaders });
  }
  const record = credential as Record<string, unknown>;
  const payload = record.secret_payload && typeof record.secret_payload === "object" && !Array.isArray(record.secret_payload)
    ? record.secret_payload as Record<string, unknown>
    : {};
  const expectedToken = typeof payload.webhook_secret === "string" ? payload.webhook_secret.trim() : "";
  const credentialId = typeof record.credential_id === "string" ? record.credential_id : "";
  if (!credentialId || expectedToken.length < 32 || !equalSecret(receivedToken, expectedToken)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: noStoreHeaders });
  }

  const parsed = parseTracxDeliveryPayload(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ ok: false }, { status: 400, headers: noStoreHeaders });
  if (parsed.kind === "probe") {
    return NextResponse.json({ ok: true, probe: true }, {
      headers: noStoreHeaders,
    });
  }
  let matched: unknown = null;
  let ingestError: unknown = null;
  try {
    const result = await serviceClient.rpc("sellerpilot_service_ingest_tracx_delivery", {
      p_credential_id: credentialId,
      p_event: parsed.event,
    });
    matched = result.data;
    ingestError = result.error;
  } catch (error) {
    return rpcErrorResponse("ingest", error);
  }
  if (ingestError) return rpcErrorResponse("ingest", ingestError);
  return NextResponse.json({ ok: true, matched: matched === true }, {
    headers: noStoreHeaders,
  });
}
