import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./supabase/config";

export type AdminApiContext = {
  user: User;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
};

type AdminApiOptions = { timeoutMs?: number };

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

function boundedAdminFetch(timeoutMs: number) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
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
      ...(options.timeoutMs ? { fetch: boundedAdminFetch(options.timeoutMs) } : {}),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
  ]);
  if (isAbortOrTimeoutError(userError) || isAbortOrTimeoutError(adminError)) {
    return NextResponse.json({ message: "관리자 권한 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요." }, { status: 503 });
  }
  if (userError || !userData.user || adminError || isAdmin !== true) {
    return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options.timeoutMs ? { global: { fetch: boundedAdminFetch(options.timeoutMs) } } : {}),
  });
  return { user: userData.user, userClient, serviceClient };
}

export function isAdminApiError(value: AdminApiContext | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
