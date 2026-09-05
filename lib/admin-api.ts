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

export async function authenticateAdminRequest(request: Request, options: AdminApiOptions = {}): Promise<AdminApiContext | NextResponse> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";

  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    let user: User | null = null;
    let isAdmin: unknown = false;
    let userError: unknown = null;
    let adminError: unknown = null;
    if (options.verifyAsymmetricClaimsLocally) {
      const authWork = Promise.all([
        userClient.auth.getClaims(token),
        userClient.rpc("sellerpilot_is_admin"),
      ]);
      const [claimsResult, adminResult] = options.timeoutMs
        ? await withTimeout(authWork, options.timeoutMs)
        : await authWork;
      userError = claimsResult.error;
      adminError = adminResult.error;
      isAdmin = adminResult.data;
      user = claimsResult.error ? null : verifiedClaimsUser(claimsResult.data);
    } else {
      const authWork = Promise.all([
        userClient.auth.getUser(token),
        userClient.rpc("sellerpilot_is_admin"),
      ]);
      const [userResult, adminResult] = options.timeoutMs
        ? await withTimeout(authWork, options.timeoutMs)
        : await authWork;
      userError = userResult.error;
      adminError = adminResult.error;
      isAdmin = adminResult.data;
      user = userResult.data.user;
    }
    if (isAbortOrTimeoutError(userError) || isAbortOrTimeoutError(adminError)) {
      return NextResponse.json({ message: "관리자 권한 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요." }, { status: 503 });
    }
    if (userError || !user || adminError || isAdmin !== true) {
      return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const serviceClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { user, userClient, serviceClient };
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      return NextResponse.json({ message: "관리자 권한 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요." }, { status: 503 });
    }
    throw error;
  }
}

export function isAdminApiError(value: AdminApiContext | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
