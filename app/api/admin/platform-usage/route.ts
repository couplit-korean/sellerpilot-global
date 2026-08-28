import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import {
  parseSupabaseAddons,
  parseSupabaseApiUsage,
  parseSupabaseDiskUsage,
  parseSupabasePlan,
  parseVercelPlan,
  platformUsageCacheSeconds,
  platformUsageProviderTimeoutMs,
  summarizeVercelCharges,
  unsupportedSupabaseBillingMetrics,
  type PlatformProviderState,
  type PlatformUsagePayload,
  type SupabaseUsageSummary,
  type VercelUsageSummary,
} from "../../../../lib/platform-usage";

export const runtime = "nodejs";
export const maxDuration = 30;

const platformUsageCacheTtlMs = platformUsageCacheSeconds * 1_000;
const vercelResponseLimitBytes = 5 * 1024 * 1024;
const supabaseResponseLimitBytes = 512 * 1024;

type CacheableProvider = { state: PlatformProviderState };
type ServerCacheEntry<T> = { expiresAt: number; value: T };
type SettledValue<T> = { ok: true; value: T } | { ok: false };

const serverCache = new Map<string, ServerCacheEntry<CacheableProvider>>();
const inFlight = new Map<string, Promise<CacheableProvider>>();

async function withTenMinuteServerCache<T extends CacheableProvider>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = serverCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const pending = load().then((value) => {
    if (value.state === "connected" || value.state === "partial") {
      const nextCacheBoundary = Math.floor(Date.now() / platformUsageCacheTtlMs) * platformUsageCacheTtlMs + platformUsageCacheTtlMs;
      serverCache.set(key, { expiresAt: nextCacheBoundary, value });
    }
    return value;
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

async function settle<T>(load: () => Promise<T>): Promise<SettledValue<T>> {
  try {
    return { ok: true, value: await load() };
  } catch {
    return { ok: false };
  }
}

async function readBoundedText(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("provider response too large");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) throw new Error("provider response too large");
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function providerText(url: URL, token: string, maxBytes: number, requestSignal: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(platformUsageProviderTimeoutMs);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, application/jsonl, text/plain",
    },
    signal: AbortSignal.any([requestSignal, timeoutSignal]),
    next: { revalidate: platformUsageCacheSeconds },
  });
  if (!response.ok) throw new Error("provider request failed");
  return readBoundedText(response, maxBytes);
}

async function providerJson(url: URL, token: string, maxBytes: number, requestSignal: AbortSignal) {
  const text = await providerText(url, token, maxBytes, requestSignal);
  return JSON.parse(text) as unknown;
}

function vercelUnavailable(state: "not_configured" | "unavailable", message: string, targetId: string | null = null): VercelUsageSummary {
  return { state, message, targetId, fetchedAt: null, plan: null, period: null, totals: null, services: [] };
}

function supabaseUnavailable(state: "not_configured" | "unavailable", message: string, targetId: string | null = null): SupabaseUsageSummary {
  return {
    state,
    message,
    targetId,
    fetchedAt: null,
    plan: null,
    apiUsage: null,
    disk: null,
    selectedAddons: [],
    unsupportedBillingMetrics: unsupportedSupabaseBillingMetrics,
  };
}

async function loadVercelUsage(requestSignal: AbortSignal): Promise<VercelUsageSummary> {
  const accessToken = process.env.VERCEL_ACCESS_TOKEN?.trim() ?? "";
  const teamId = process.env.VERCEL_TEAM_ID?.trim() ?? "";
  if (!accessToken || !teamId) {
    return vercelUnavailable("not_configured", "Vercel Management API 연결정보가 없습니다.", teamId || null);
  }
  if (!/^team_[A-Za-z0-9]+$/.test(teamId)) {
    return vercelUnavailable("not_configured", "Vercel 팀 연결정보 형식이 올바르지 않습니다.");
  }

  return withTenMinuteServerCache(`vercel:${teamId}`, async () => {
    const now = new Date(Math.floor(Date.now() / platformUsageCacheTtlMs) * platformUsageCacheTtlMs);
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const teamUrl = new URL(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`);
    const chargesUrl = new URL("https://api.vercel.com/v1/billing/charges");
    chargesUrl.searchParams.set("teamId", teamId);
    chargesUrl.searchParams.set("from", from.toISOString());
    chargesUrl.searchParams.set("to", now.toISOString());

    const [teamResult, chargesResult] = await Promise.all([
      settle(async () => parseVercelPlan(await providerJson(teamUrl, accessToken, supabaseResponseLimitBytes, requestSignal))),
      settle(async () => summarizeVercelCharges(await providerText(chargesUrl, accessToken, vercelResponseLimitBytes, requestSignal))),
    ]);
    const successCount = Number(teamResult.ok) + Number(chargesResult.ok);
    if (successCount === 0) {
      return vercelUnavailable("unavailable", "Vercel 공식 API 응답을 확인하지 못했습니다.", teamId);
    }
    return {
      state: successCount === 2 ? "connected" : "partial",
      message: successCount === 2
        ? "최근 30일 Vercel 공식 사용량과 비용입니다."
        : "일부 Vercel 지표만 조회됐습니다. 팀 권한과 요금제를 확인해 주세요.",
      fetchedAt: now.toISOString(),
      targetId: teamId,
      plan: teamResult.ok ? teamResult.value : null,
      period: chargesResult.ok ? { from: from.toISOString(), to: now.toISOString() } : null,
      totals: chargesResult.ok ? chargesResult.value.totals : null,
      services: chargesResult.ok ? chargesResult.value.services : [],
    } satisfies VercelUsageSummary;
  });
}

async function loadSupabaseUsage(requestSignal: AbortSignal): Promise<SupabaseUsageSummary> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() ?? "";
  const organizationSlug = process.env.SUPABASE_ORGANIZATION_SLUG?.trim() ?? "";
  if (!accessToken || !projectRef || !organizationSlug) {
    return supabaseUnavailable(
      "not_configured",
      "Supabase Management API 연결정보가 없습니다.",
      organizationSlug && projectRef ? `${organizationSlug}/${projectRef}` : projectRef || organizationSlug || null,
    );
  }
  if (!/^[a-z]{20}$/.test(projectRef) || !/^[\w-]+$/.test(organizationSlug)) {
    return supabaseUnavailable("not_configured", "Supabase 프로젝트 연결정보 형식이 올바르지 않습니다.");
  }

  return withTenMinuteServerCache(`supabase:${organizationSlug}:${projectRef}`, async () => {
    const fetchedAt = new Date().toISOString();
    const baseUrl = "https://api.supabase.com";
    const organizationUrl = new URL(`/v1/organizations/${encodeURIComponent(organizationSlug)}`, baseUrl);
    const apiCountsUrl = new URL(`/v1/projects/${encodeURIComponent(projectRef)}/analytics/endpoints/usage.api-counts`, baseUrl);
    apiCountsUrl.searchParams.set("interval", "1day");
    const diskUrl = new URL(`/v1/projects/${encodeURIComponent(projectRef)}/config/disk/util`, baseUrl);
    const addonsUrl = new URL(`/v1/projects/${encodeURIComponent(projectRef)}/billing/addons`, baseUrl);

    const [planResult, apiResult, diskResult, addonsResult] = await Promise.all([
      settle(async () => parseSupabasePlan(await providerJson(organizationUrl, accessToken, supabaseResponseLimitBytes, requestSignal))),
      settle(async () => parseSupabaseApiUsage(await providerJson(apiCountsUrl, accessToken, supabaseResponseLimitBytes, requestSignal))),
      settle(async () => parseSupabaseDiskUsage(await providerJson(diskUrl, accessToken, supabaseResponseLimitBytes, requestSignal))),
      settle(async () => parseSupabaseAddons(await providerJson(addonsUrl, accessToken, supabaseResponseLimitBytes, requestSignal))),
    ]);
    const successCount = [planResult, apiResult, diskResult, addonsResult].filter((result) => result.ok).length;
    if (successCount === 0) {
      return supabaseUnavailable("unavailable", "Supabase 공식 API 응답을 확인하지 못했습니다.", `${organizationSlug}/${projectRef}`);
    }
    return {
      state: successCount === 4 ? "connected" : "partial",
      message: successCount === 4
        ? "Supabase 공식 프로젝트 운영 지표입니다."
        : "일부 Supabase 지표만 조회됐습니다. Management API 권한을 확인해 주세요.",
      fetchedAt,
      targetId: `${organizationSlug}/${projectRef}`,
      plan: planResult.ok ? planResult.value : null,
      apiUsage: apiResult.ok ? apiResult.value : null,
      disk: diskResult.ok ? diskResult.value : null,
      selectedAddons: addonsResult.ok ? addonsResult.value : [],
      unsupportedBillingMetrics: unsupportedSupabaseBillingMetrics,
    } satisfies SupabaseUsageSummary;
  });
}

export async function GET(request: Request) {
  const auth = await authenticateAdminRequest(request, { timeoutMs: platformUsageProviderTimeoutMs });
  if (isAdminApiError(auth)) return auth;

  const [vercel, supabase] = await Promise.all([
    loadVercelUsage(request.signal),
    loadSupabaseUsage(request.signal),
  ]);
  const payload: PlatformUsagePayload = {
    generatedAt: new Date().toISOString(),
    cacheSeconds: platformUsageCacheSeconds,
    vercel,
    supabase,
  };
  return NextResponse.json(payload, {
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
