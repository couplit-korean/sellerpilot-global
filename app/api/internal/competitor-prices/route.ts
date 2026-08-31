import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { executeCompetitorSearchViaChannelGateway } from "../../../../lib/channels/gateway";
import {
  COMPETITOR_MATCHER_VERSION,
  competitorProviderApiStatuses,
  competitorProviderRegistry,
  searchCompetitorProviders,
  type CompetitorProductIdentity,
} from "../../../../lib/competitor-prices";
import {
  type ClaimedCompetitorProduct,
  type CompetitorRefreshResult,
  runBoundedCompetitorRefreshBatch,
  runClaimedCompetitorProductRefresh,
} from "../../../../lib/competitor-refresh-runtime";
import { supabaseUrl } from "../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorMessage } from "../../../../lib/worker-rpc";
import {
  internalScheduleAuthorization,
  internalScheduleCanaryPayload,
  internalScheduleRequestMode,
  runtimeStatusMatchesCurrentRelease,
} from "../../../../lib/internal-scheduler-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMPETITOR_RPC_TIMEOUT_MS = 5_000;
const COMPETITOR_CLAIM_BATCH_SIZE = 3;
const COMPETITOR_PRODUCT_CONCURRENCY = 3;
const COMPETITOR_CLAIM_LEASE_SECONDS = 90;
const COMPETITOR_ELEVENST_WAIT_MS = 18_000;
const COMPETITOR_PROVIDER_BUDGET_MS = 32_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DueProductRow = {
  product_id: string;
  query: string;
  aliases: string[];
  claim_token: string;
  identity: CompetitorProductIdentity;
};

function isCompetitorProductIdentity(value: unknown): value is CompetitorProductIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return typeof identity.productName === "string"
    && identity.productName.trim().length > 0
    && identity.productName.length <= 1_000
    && (identity.packageContents === undefined
      || (typeof identity.packageContents === "string" && identity.packageContents.length <= 500));
}

function serverClient() {
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch(COMPETITOR_RPC_TIMEOUT_MS) },
  });
}

async function releaseCompetitorClaim(
  serviceClient: NonNullable<ReturnType<typeof serverClient>>,
  product: ClaimedCompetitorProduct,
) {
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_release_competitor_price_refresh", {
      p_product_id: product.productId,
      p_claim_token: product.claimToken,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

function logCompetitorRefreshFailure(
  stage: string,
  details: Record<string, string | number | boolean>,
) {
  console.error("competitor price refresh failed", { stage, ...details });
}

async function runCompetitorPrices(serviceClient: NonNullable<ReturnType<typeof serverClient>>) {
  let registry: Awaited<ReturnType<typeof competitorProviderRegistry>>;
  try {
    registry = await competitorProviderRegistry(serviceClient, {
      elevenstTimeoutMs: COMPETITOR_ELEVENST_WAIT_MS,
      searchElevenstViaGateway: executeCompetitorSearchViaChannelGateway,
      enableMarketplaceWeb: true,
    });
  } catch {
    logCompetitorRefreshFailure("provider_registry", { status: 503 });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const providerConfigurationMissing = registry.configured.length === 0;
  if (providerConfigurationMissing) {
    logCompetitorRefreshFailure("provider_configuration", {
      status: 503,
      failedProviders: registry.unavailable.filter((provider) => provider.status === "failed").length,
      unavailableProviders: registry.unavailable.filter((provider) => provider.status === "unavailable").length,
    });
  }
  let dueData: unknown;
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_claim_due_competitor_products", {
      p_limit: COMPETITOR_CLAIM_BATCH_SIZE,
      p_lease_seconds: COMPETITOR_CLAIM_LEASE_SECONDS,
    });
    if (error) {
      console.error("competitor due-products RPC failed", { code: error.code ?? "unknown", status: 503 });
      return NextResponse.json({ message: "경쟁가 조회 대상 상품을 읽지 못했습니다." }, { status: 503 });
    }
    dueData = data;
  } catch {
    console.error("competitor due-products RPC threw", { status: 503 });
    return NextResponse.json({ message: "경쟁가 조회 대상 상품을 읽지 못했습니다." }, { status: 503 });
  }
  if (!Array.isArray(dueData)) {
    console.error("competitor due-products RPC returned an invalid shape", { status: 503 });
    return NextResponse.json({ message: "경쟁가 조회 대상 상품을 확인하지 못했습니다." }, { status: 503 });
  }
  let invalidDueRows = 0;
  const seenProductIds = new Set<string>();
  const seenClaimTokens = new Set<string>();
  const due = dueData.flatMap((item) => {
    if (!item || typeof item !== "object"
        || typeof item.product_id !== "string"
        || typeof item.query !== "string"
        || typeof item.claim_token !== "string"
        || !isCompetitorProductIdentity(item.identity)
        || !UUID_PATTERN.test(item.product_id)
        || !UUID_PATTERN.test(item.claim_token)) {
      invalidDueRows += 1;
      return [];
    }
    // The database claim RPC already fences rows with SKIP LOCKED and a token.
    // Treat a duplicate product or token in the returned batch as invalid
    // infrastructure data instead of searching/completing the same claim twice.
    if (seenProductIds.has(item.product_id) || seenClaimTokens.has(item.claim_token)) {
      invalidDueRows += 1;
      return [];
    }
    seenProductIds.add(item.product_id);
    seenClaimTokens.add(item.claim_token);
    const aliases = Array.isArray(item.aliases) ? item.aliases.filter((alias: unknown): alias is string => typeof alias === "string") : [];
    return [{
      product_id: item.product_id,
      query: item.query,
      aliases,
      claim_token: item.claim_token,
      identity: item.identity,
    } satisfies DueProductRow];
  });
  let infrastructureFailures = invalidDueRows;
  const outcomes = await runBoundedCompetitorRefreshBatch(
    due,
    COMPETITOR_PRODUCT_CONCURRENCY,
    async (dueProduct) => {
      const product: ClaimedCompetitorProduct = {
        productId: dueProduct.product_id,
        query: dueProduct.query,
        aliases: dueProduct.aliases,
        claimToken: dueProduct.claim_token,
        identity: dueProduct.identity,
      };
      const outcome = await runClaimedCompetitorProductRefresh({
        product,
        unavailableProviders: registry.unavailable,
        matcherVersion: COMPETITOR_MATCHER_VERSION,
        terminalizePendingProviders: ["elevenst_product_search"],
        search: (claimed) => searchCompetitorProviders(
          registry,
          claimed.query,
          claimed.aliases,
          30,
          COMPETITOR_PROVIDER_BUDGET_MS,
          {
            productId: claimed.productId,
            claimToken: claimed.claimToken,
            identity: claimed.identity,
          },
        ),
        release: (claimed) => releaseCompetitorClaim(serviceClient, claimed),
        complete: async ({ product: claimed, items, providers }) => {
          const { data: saved, error: saveError } = await serviceClient.rpc("sellerpilot_service_complete_competitor_price_refresh", {
            p_product_id: claimed.productId,
            p_claim_token: claimed.claimToken,
            p_items: items,
            p_providers: providers,
          });
          if (saveError) throw saveError;
          return typeof saved === "number" || typeof saved === "string" ? Number(saved) : Number.NaN;
        },
      });
      if (outcome.failureStage) {
        logCompetitorRefreshFailure(outcome.failureStage, {
          status: outcome.infrastructureFailure ? 503 : 207,
          pending: outcome.result.pending,
        });
      }
      return outcome;
    },
  );
  infrastructureFailures += outcomes.filter((outcome) => outcome.infrastructureFailure).length;
  const results: CompetitorRefreshResult[] = outcomes.map((outcome) => outcome.result);
  if (infrastructureFailures > 0) {
    console.error("competitor price database operations failed", {
      failed: infrastructureFailures,
      attempted: dueData.length,
    });
  }
  const pending = results.some((item) => item.pending);
  const providerBlockers = competitorProviderApiStatuses(registry, registry.unavailable)
    .filter((provider) => provider.blockedReason);
  const apiResults = results.map((result) => ({
    ...result,
    providers: competitorProviderApiStatuses(registry, result.providers),
  }));
  return NextResponse.json({
    ok: !providerConfigurationMissing && infrastructureFailures === 0 && !pending && results.every((item) => item.ok),
    pending,
    providerConfigurationMissing,
    checked: results.length,
    infrastructureFailures,
    providerBlockers,
    results: apiResults,
  }, {
    status: providerConfigurationMissing || infrastructureFailures > 0 ? 503 : pending ? 202 : results.some((item) => !item.ok) ? 207 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = internalScheduleAuthorization(
    request.headers.get("authorization"),
    cronSecret,
  );
  if (authorization === "missing") {
    return NextResponse.json({ message: "경쟁가 조회 인증값이 설정되지 않았습니다." }, { status: 503 });
  }
  if (authorization !== "authorized") {
    return NextResponse.json({ message: "경쟁가 조회 인증이 필요합니다." }, { status: 401 });
  }
  const requestedMode = internalScheduleRequestMode(request);
  if (requestedMode === "invalid") {
    return NextResponse.json({ message: "경쟁가 조회 실행 모드를 확인하지 못했습니다." }, { status: 400 });
  }
  if (requestedMode === "canary") {
    return NextResponse.json(internalScheduleCanaryPayload());
  }
  const serviceClient = serverClient();
  if (!serviceClient) return NextResponse.json({ message: "Supabase 서버 설정이 없습니다." }, { status: 503 });
  const { data: runtimeStatus, error: runtimeStatusError } = await serviceClient.rpc(
    "sellerpilot_service_serverless_cs_wakeup_status",
  );
  if (runtimeStatusError || !runtimeStatusMatchesCurrentRelease(runtimeStatus)) {
    return NextResponse.json({ message: "서버 일정이 활성화되지 않았습니다." }, { status: 503 });
  }
  return runCompetitorPrices(serviceClient);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "경쟁가 작업자 인증이 필요합니다." }, { status: 401 });
  }
  const serviceClient = serverClient();
  if (!serviceClient) return NextResponse.json({ message: "Supabase 서버 설정이 없습니다." }, { status: 503 });
  let validationData: unknown;
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_validate_worker_token", {
      p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
      p_worker_version: "competitor-price-scheduler",
    });
    if (error) {
      console.error("competitor worker validation RPC failed", { code: error.code ?? "unknown", status: 503 });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
    validationData = data;
  } catch {
    console.error("competitor worker validation RPC threw", { status: 503 });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  if (validationData !== true) return NextResponse.json({ message: "경쟁가 작업자 인증이 유효하지 않습니다." }, { status: 401 });
  return runCompetitorPrices(serviceClient);
}
