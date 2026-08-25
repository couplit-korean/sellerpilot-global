import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  exchangeKakaoAuthorizationCode,
  fetchKakaoProfile,
  KakaoProviderError,
  verifyKakaoState,
} from "../../../../../lib/kakao";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch } from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;

const CALLBACK_LEASE_SECONDS = 180;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CallbackClaim = {
  status: string;
  phase?: "prepared" | "token_staged";
  attemptId?: string;
  claimToken?: string;
};

type RpcResult = { ok: true; data: unknown } | { ok: false };

function finish(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("view", "notifications");
  url.searchParams.set("kakao", result);
  const response = NextResponse.redirect(url);
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}

async function runRpc(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
  attempts = 1,
): Promise<RpcResult> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data, error } = await client.rpc(functionName, args);
      if (!error) return { ok: true, data };
    } catch {
      // Explicit retries are safe because every mutable RPC proves the exact claim nonce.
    }
  }
  return { ok: false };
}

function callbackClaim(value: unknown): CallbackClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== "string") return null;
  return {
    status: record.status,
    phase: record.phase === "prepared" || record.phase === "token_staged" ? record.phase : undefined,
    attemptId: typeof record.attemptId === "string" ? record.attemptId : undefined,
    claimToken: typeof record.claimToken === "string" ? record.claimToken : undefined,
  };
}

function tokenExpiry(payload: Record<string, unknown>) {
  const seconds = Number(payload.expires_in ?? 21_600);
  const boundedSeconds = Number.isFinite(seconds)
    ? Math.max(60, Math.min(seconds, 31 * 24 * 60 * 60))
    : 21_600;
  return new Date(Date.now() + boundedSeconds * 1000).toISOString();
}

async function finishAttempt(
  client: SupabaseClient,
  attemptId: string,
  claimToken: string,
  outcome: "failed" | "reconciliation_required",
  errorCode: string,
) {
  return runRpc(client, "sellerpilot_service_finish_kakao_oauth_attempt", {
    p_attempt_id: attemptId,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_error: errorCode,
  }, 2);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let state: ReturnType<typeof verifyKakaoState> = null;
  try {
    state = verifyKakaoState(url.searchParams.get("state") ?? "");
  } catch {
    return finish(request, "invalid_state");
  }
  const authorizationCode = url.searchParams.get("code") ?? "";
  if (!state || authorizationCode.length < 8 || authorizationCode.length > 2048) {
    return finish(request, "invalid_state");
  }

  const clientId = process.env.KAKAO_REST_API_KEY?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!clientId || !serviceKey || !supabaseUrl) return finish(request, "server_config");
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch(5_000) },
  });

  const claimed = await runRpc(serviceClient, "sellerpilot_service_claim_kakao_oauth_callback", {
    p_owner_id: state.uid,
    p_state_nonce: state.nonce,
    p_redirect_uri: state.redirectUri,
    p_authorization_code: authorizationCode,
    p_lease_seconds: CALLBACK_LEASE_SECONDS,
  });
  if (!claimed.ok) return finish(request, "lifecycle_unavailable");
  const claim = callbackClaim(claimed.data);
  if (!claim) return finish(request, "lifecycle_unavailable");
  if (claim.status === "connected") return finish(request, "connected");
  if (claim.status === "failed") return finish(request, "connection_failed");
  if (claim.status === "reconciliation_required") return finish(request, "reconciliation_required");
  if (claim.status === "in_progress") return finish(request, "processing");
  if (claim.status === "invalid_state" || claim.status === "invalid_replay") {
    return finish(request, "invalid_state");
  }
  if (
    claim.status !== "claimed"
    || !claim.phase
    || !claim.attemptId
    || !claim.claimToken
    || !UUID_PATTERN.test(claim.attemptId)
    || !UUID_PATTERN.test(claim.claimToken)
  ) {
    return finish(request, "lifecycle_unavailable");
  }

  const attemptId = claim.attemptId;
  const claimToken = claim.claimToken;
  if (claim.phase === "prepared") {
    const begun = await runRpc(serviceClient, "sellerpilot_service_begin_kakao_oauth_exchange", {
      p_attempt_id: attemptId,
      p_claim_token: claimToken,
    });
    if (!begun.ok || begun.data !== true) return finish(request, "processing");

    let tokenPayload: Record<string, unknown>;
    try {
      tokenPayload = await exchangeKakaoAuthorizationCode(authorizationCode, state.redirectUri);
    } catch (error) {
      const rejected = error instanceof KakaoProviderError && error.kind === "rejected";
      await finishAttempt(
        serviceClient,
        attemptId,
        claimToken,
        rejected ? "failed" : "reconciliation_required",
        error instanceof KakaoProviderError ? error.message : "KAKAO_CODE_EXCHANGE_OUTCOME_UNKNOWN",
      );
      return finish(request, rejected ? "token_failed" : "reconciliation_required");
    }

    const staged = await runRpc(serviceClient, "sellerpilot_service_stage_kakao_oauth_token", {
      p_attempt_id: attemptId,
      p_claim_token: claimToken,
      p_secret_payload: tokenPayload,
      p_expires_at: tokenExpiry(tokenPayload),
    }, 2);
    if (!staged.ok || staged.data !== true) return finish(request, "save_pending");
  }

  const stagedToken = await runRpc(
    serviceClient,
    "sellerpilot_service_get_claimed_kakao_oauth_token",
    { p_attempt_id: attemptId, p_claim_token: claimToken },
    2,
  );
  if (!stagedToken.ok || !stagedToken.data || typeof stagedToken.data !== "object" || Array.isArray(stagedToken.data)) {
    return finish(request, "save_pending");
  }
  const stagedContext = stagedToken.data as Record<string, unknown>;
  const secret = stagedContext.secret && typeof stagedContext.secret === "object" && !Array.isArray(stagedContext.secret)
    ? stagedContext.secret as Record<string, unknown>
    : null;
  if (!secret || typeof secret.access_token !== "string") return finish(request, "save_pending");

  let profile: Record<string, unknown> | null = null;
  let profileFailure: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      profile = await fetchKakaoProfile(secret.access_token);
      profileFailure = null;
      break;
    } catch (error) {
      profileFailure = error;
      if (error instanceof KakaoProviderError && error.kind === "rejected") break;
    }
  }
  if (!profile) {
    if (profileFailure instanceof KakaoProviderError && profileFailure.kind === "rejected") {
      await finishAttempt(serviceClient, attemptId, claimToken, "failed", profileFailure.message);
      return finish(request, "profile_failed");
    }
    await runRpc(serviceClient, "sellerpilot_service_release_kakao_oauth_claim", {
      p_attempt_id: attemptId,
      p_claim_token: claimToken,
      p_error: profileFailure instanceof KakaoProviderError
        ? profileFailure.message
        : "KAKAO_PROFILE_RETRY_REQUIRED",
    }, 2);
    return finish(request, "profile_retry");
  }

  const properties = profile.properties && typeof profile.properties === "object" && !Array.isArray(profile.properties)
    ? profile.properties as Record<string, unknown>
    : {};
  const completed = await runRpc(serviceClient, "sellerpilot_service_complete_kakao_oauth_connection", {
    p_attempt_id: attemptId,
    p_claim_token: claimToken,
    p_kakao_user_id: String(profile.id),
    p_nickname: typeof properties.nickname === "string" ? properties.nickname : "카카오 사용자",
  }, 2);
  return finish(
    request,
    completed.ok && typeof completed.data === "string" && UUID_PATTERN.test(completed.data)
      ? "connected"
      : "save_pending",
  );
}
