import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { gatewayCredentialRefreshLifecycleSchema } from "../../../../../lib/channels/gateway-contract";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fingerprintPattern = /^[A-Fa-f0-9]{12,64}$/u;

function ebayCreateCredentialIncarnation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const version = Number(record.version);
  const fingerprint = typeof record.fingerprint === "string" ? record.fingerprint : "";
  if (!uuidPattern.test(id)
      || !Number.isSafeInteger(version)
      || version < 1
      || !fingerprintPattern.test(fingerprint)) {
    return null;
  }
  return { id, version, fingerprint };
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("channel gateway credential staging server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }

  const parsed = gatewayCredentialRefreshLifecycleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "채널 인증 갱신 보존 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  if (parsed.data.action === "begin") {
    const { data, error } = await serviceClient.rpc(
      "sellerpilot_service_begin_gateway_credential_refresh",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
      },
    );
    if (error) {
      const status = workerRpcErrorStatus(error);
      console.error("channel gateway credential mutation fence RPC failed", {
        code: error.code ?? "unknown",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    if (data !== true) {
      return NextResponse.json({ message: "실행 중인 채널 작업과 인증 갱신 요청이 일치하지 않습니다." }, { status: 409 });
    }
    return NextResponse.json({ status: "in_flight" });
  }
  const refresh = parsed.data.credentialRefresh;
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_service_prepare_gateway_credential_refresh",
    {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
      p_secret_payload: refresh.payload,
      p_expires_at: refresh.expiresAt,
      p_recovery_only: refresh.recoveryOnly === true,
      p_oauth_complete: refresh.oauthComplete === true,
    },
  );
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway credential staging RPC failed", {
      code: error.code ?? "unknown",
      status,
    });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }

  const staged = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  if (!staged || staged.status === "conflict" || staged.status === "invalid" || staged.status === "identity_mismatch") {
    return NextResponse.json({ message: "실행 중인 채널 작업과 인증 갱신 요청이 일치하지 않습니다." }, { status: 409 });
  }
  const prepared = staged.status === "prepared"
    && typeof staged.credential_id === "string"
    && uuidPattern.test(staged.credential_id)
    && (refresh.oauthComplete !== true || staged.oauth_complete === true);
  const recoveryPreserved = staged.status === "recovery_preserved"
    && refresh.recoveryOnly === true;
  if (!prepared && !recoveryPreserved) {
    console.error("channel gateway credential staging returned an invalid contract");
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }

  const { data: incarnationData, error: incarnationError } = await serviceClient.rpc(
    "sellerpilot_service_ebay_create_credential_incarnation_v1",
    {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
    },
  );
  const credentialIncarnation = ebayCreateCredentialIncarnation(incarnationData);
  if (incarnationError && !credentialIncarnation) {
    const code = typeof incarnationError.message === "string" ? incarnationError.message : "";
    if (code.includes("EBAY_CREATE_")) {
      const status = workerRpcErrorStatus(incarnationError);
      console.error("eBay create credential incarnation RPC failed", {
        code: incarnationError.code ?? "unknown",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
  }

  return NextResponse.json({
    status: staged.status,
    ...(credentialIncarnation ? { credentialIncarnation } : {}),
  });
}
