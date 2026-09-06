import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./supabase/config";

export type AdminApiContext = {
  user: User;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
};

type AdminApiOptions = {
  timeoutMs?: number;
  verifyAsymmetricClaimsLocally?: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function verifiedClaimsUser(
  data: Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>["data"],
): User | null {
  if (!data) return null;
  const claims = record(data.claims);
  const header = record(data.header);
  const audience = claims.aud;
  const authenticatedAudience = audience === "authenticated"
    || (Array.isArray(audience) && audience.includes("authenticated"));
  const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  const now = Math.floor(Date.now() / 1000);
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : "";
  const issuedAt = typeof claims.iat === "number" ? claims.iat : 0;
  const expiresAt = typeof claims.exp === "number" ? claims.exp : 0;
  const algorithm = typeof header.alg === "string" ? header.alg : "";
  const keyId = typeof header.kid === "string" ? header.kid : "";
  if (!["ES256", "RS256"].includes(algorithm)
      || !keyId
      || claims.iss !== issuer
      || !authenticatedAudience
      || claims.role !== "authenticated"
      || !uuidPattern.test(subject)
      || !uuidPattern.test(sessionId)
      || issuedAt <= 0
      || issuedAt > now + 60
      || expiresAt <= now) {
    return null;
  }
  return {
    id: subject,
    aud: "authenticated",
    role: "authenticated",
    email: typeof claims.email === "string" ? claims.email : undefined,
    app_metadata: record(claims.app_metadata),
    user_metadata: record(claims.user_metadata),
    created_at: new Date(issuedAt * 1000).toISOString(),
  };
}

function isAbortOrTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = typeof (error as { name?: unknown }).name === "string" ? (error as { name: string }).name : "";
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
  return name === "TimeoutError"
    || name === "AbortError"
    || code === "UND_ERR_ABORTED"
    || /timeout|timed out|abort|aborted|exceeded/i.test(message);
}

function timeoutError() {
  const error = new Error("admin auth timed out");
  error.name = "TimeoutError";
  return error;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Only explicit Auth rejection proves an invalid session. Network/server/JWKS
// failures leave verification unknown; never promote unknown into permission.
function isConfirmedInvalidSession(error: unknown): boolean {
  const value = record(error);
  const status = typeof value.status === "number" ? value.status : 0;
  if (status >= 500 || status === 429 || isAbortOrTimeoutError(error)
      || value.name === "AuthRetryableFetchError") return false;
  if (status === 401 || status === 403) return true;
  return value.name === "AuthSessionMissingError" || value.name === "AuthInvalidJwtError"
    || ["bad_jwt", "invalid_jwt", "no_authorization", "session_not_found", "session_expired", "user_not_found", "user_banned"].includes(String(value.code ?? ""));
}

function authFailure(status: 401 | 403 | 503) {
  const code = status === 401 ? "ADMIN_SESSION_INVALID"
    : status === 403 ? "ADMIN_ACCESS_DENIED" : "ADMIN_VERIFICATION_UNAVAILABLE";
  const message = status === 401 ? "로그인이 필요하거나 로그인 정보가 유효하지 않습니다."
    : status === 403 ? "관리자 권한이 필요합니다."
      : "관리자 권한 확인이 지연되고 있습니다. 권한은 아직 검증되지 않았습니다. 잠시 후 다시 확인해 주세요.";
  return NextResponse.json({ message, code }, {
    status, headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function authenticateAdminRequest(request: Request, options: AdminApiOptions = {}): Promise<AdminApiContext | NextResponse> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";

  if (!token) return authFailure(401);
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  try {
    const userClient = createClient(supabaseUrl, supabasePublishableKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let user: User | null = null;
    let isAdmin: unknown = null;
    let adminHttpStatus = 0;
    let invalidVerifiedClaims = false;
    let userError: unknown = null;
    let adminError: unknown = null;
    if (options.verifyAsymmetricClaimsLocally) {
      const authWork = Promise.all([
        Promise.resolve().then(() => userClient.auth.getClaims(token)).catch(error => ({ data: null, error })),
        Promise.resolve().then(() => userClient.rpc("sellerpilot_is_admin")).catch(error => ({ data: null, error, status: 0 })),
      ]);
      const [claimsResult, adminResult] = options.timeoutMs
        ? await withTimeout(authWork, options.timeoutMs)
        : await authWork;
      userError = claimsResult.error;
      adminError = adminResult.error;
      isAdmin = adminResult.data;
      adminHttpStatus = adminResult.status;
      user = claimsResult.error ? null : verifiedClaimsUser(claimsResult.data);
      invalidVerifiedClaims = !claimsResult.error && claimsResult.data !== null && !user;
    } else {
      const authWork = Promise.all([
        Promise.resolve().then(() => userClient.auth.getUser(token)).catch(error => ({ data: null, error })),
        Promise.resolve().then(() => userClient.rpc("sellerpilot_is_admin")).catch(error => ({ data: null, error, status: 0 })),
      ]);
      const [userResult, adminResult] = options.timeoutMs
        ? await withTimeout(authWork, options.timeoutMs)
        : await authWork;
      userError = userResult.error;
      adminError = adminResult.error;
      isAdmin = adminResult.data;
      adminHttpStatus = adminResult.status;
      user = userResult.data?.user ?? null;
    }
    // Identity failure takes precedence over permission evaluation. The RPC may
    // fail concurrently, but it must not turn a known-invalid token into a grant.
    if (userError) return authFailure(isConfirmedInvalidSession(userError) ? 401 : 503);
    if (invalidVerifiedClaims) return authFailure(401);
    if (!user || !uuidPattern.test(user.id)) return authFailure(503);
    // PGRST002/schema-cache errors, HTTP failures and malformed boolean data
    // are unverified, even if a stale/contradictory data field says true/false.
    if (adminError || !Number.isInteger(adminHttpStatus) || adminHttpStatus < 200 || adminHttpStatus >= 300) return authFailure(503);
    if (isAdmin === false) return authFailure(403);
    if (isAdmin !== true) return authFailure(503);

    const serviceClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { user, userClient, serviceClient };
  } catch {
    // Fixed response only: no SDK messages, token aliases or raw exceptions.
    return authFailure(503);
  }
}

export function isAdminApiError(value: AdminApiContext | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
