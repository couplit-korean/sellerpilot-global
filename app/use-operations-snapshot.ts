"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  mergeOperationProductImages,
  type OperationProductImageCacheEntry,
} from "../lib/operation-product-image-cache";
import {
  createBoundedRequestSignal,
  OperationsSnapshotRequestCoordinator,
  operationsSnapshotRangeKey,
  unavailableOperationsSnapshot,
  waitForAbortablePromise,
} from "./operations-snapshot-request-coordinator";

const DATA_REFRESH_INTERVAL_MS = 5 * 60_000;
const RETRY_INTERVAL_MS = 30_000;
const PRODUCT_IMAGE_REFRESH_INTERVAL_MS = 45 * 60_000;
const PRODUCT_IMAGE_CLIENT_CACHE_MS = 55 * 60_000;
const STALE_AI_RECOVERY_INTERVAL_MS = 5 * 60_000;
const STALE_AI_RECOVERY_RETRY_MS = 30_000;
export const operationsSnapshotRequestTimeoutMs = 30_000;

export type OperationProduct = {
  id: string;
  externalCode: string;
  sku: string;
  name: string;
  description: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  imageVersion: string | null;
  status: "draft" | "active" | "low_stock" | "out_of_stock" | "archived";
  onHand: number;
  reserved: number;
  available: number;
  costKrw: number;
  baseSellingPrice: number | null;
  baseCurrency: string | null;
  categoryHint: string | null;
  confirmedCategories: Array<{
    channelKey: string;
    market: string;
    categoryId: string;
    categoryPath: string[];
    confirmedAt: string | null;
  }>;
  marginState: "calculated" | "missing" | "invalid";
  marginPercent: number | null;
  marginChannelKey: string | null;
  latestError: string | null;
  latestErrorKind: "analysis" | "listing" | "external_action" | null;
  sold30d: number;
  revenue30dKrw: number;
  listingChannels: string[];
  demo: boolean;
  updatedAt: string;
};

export type SalesRange = { from: string; to: string; preset: "day" | "week" | "month" | "year" | "custom" };

export type SalesAnalytics = {
  from: string;
  to: string;
  summary: { revenueKrw: number; sold: number; orderCount: number };
  daily: Array<{
    date: string;
    revenueKrw: number;
    sold: number;
    orderCount: number;
    domesticRevenueKrw: number;
    overseasRevenueKrw: number;
    channels: Record<string, number>;
  }>;
  channels: Array<{
    channelKey: string;
    channelCode: string;
    name: string;
    market: string;
    color: string;
    revenueKrw: number;
    sold: number;
    orderCount: number;
  }>;
  products: Array<{
    productId: string;
    sold: number;
    revenueKrw: number;
    channels: Array<{ channelKey: string; channelCode: string; sold: number; revenueKrw: number }>;
  }>;
};

export type OperationOrder = {
  id: string;
  externalOrderId: string;
  channelKey: string;
  channelCode: string;
  customerName: string;
  productName: string;
  quantity: number;
  amount: number;
  currency: string;
  amountKrw: number;
  status: "paid" | "ready_to_ship" | "shipped" | "delivered" | "cancelled" | "refunded";
  orderedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  lastSeenAt: string;
  carrierCode: string | null;
  trackingNumber: string | null;
  settlementStatus: "pending" | "expected" | "settled" | "held" | "disputed";
  settlementAmount: number | null;
  settlementCurrency: string | null;
  settledAt: string | null;
  settlementRateKrw: number | null;
  referenceRateKrw: number | null;
  exchangeLossPercent: number | null;
  updatedAt: string;
  demo: boolean;
};

export type OperationTicket = {
  id: string;
  externalTicketId: string;
  channelKey: string;
  channelCode: string;
  customerName: string;
  subject: string;
  message: string;
  translatedMessage: string | null;
  replyDraft: string | null;
  replyDeliveryStatus: "never" | "preparing" | "sending" | "succeeded" | "failed" | "reconciliation_required";
  replyDeliveryError: string | null;
  replyOperationAttemptId: string | null;
  replyGatewayJobId: string | null;
  status: "urgent" | "waiting" | "in_progress" | "resolved";
  priority: number;
  receivedAt: string;
  updatedAt: string;
  demo: boolean;
};

export type OperationMarginScenario = {
  id: string;
  productId: string | null;
  name: string;
  channelKey: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
};

export type OperationsSnapshot = {
  generatedAt: string;
  aiRecovery: {
    status: "checking" | "passed" | "failed";
    expiredCount: number;
    message: string | null;
    checkedAt: string | null;
  };
  productReadinessState: "checking" | "ready" | "unavailable";
  productReadinessMessage: string | null;
  analytics: SalesAnalytics;
  aiRuntime: {
    worker: {
      label: string;
      fingerprint: string;
      expires_at: string;
      last_seen_at: string | null;
      last_version: string | null;
    } | null;
    queued: number;
    running: number;
    succeeded_today: number;
    failed_today: number;
  } | null;
  syncStatus: Array<{
    channel_key: string;
    data_type: "orders" | "inquiries";
    status: "never" | "queued" | "running" | "passed" | "failed" | "unsupported";
    imported_count: number;
    last_started_at: string | null;
    last_succeeded_at: string | null;
    last_error: string | null;
    updated_at: string;
  }>;
  channelMetrics: Array<{
    channelKey: string;
    channelCode: string;
    name: string;
    market: string;
    color: string;
    channelStatus: string;
    credentialStatus: string;
    credentialLastCheckStatus: "passed" | "failed" | "manual" | null;
    credentialLastCheckedAt: string | null;
    credentialExpiresAt: string | null;
    productCount: number;
    publishedCount: number;
    sold30d: number;
    revenue30dKrw: number;
    orderCount: number;
    readyToShipCount: number;
    openTicketCount: number;
    failedAttemptCount: number;
    lastOperationAt: string | null;
  }>;
  products: OperationProduct[];
  orders: OperationOrder[];
  tickets: OperationTicket[];
  marginScenarios: OperationMarginScenario[];
  marginScenarioState: "checking" | "ready" | "unavailable";
  marginScenarioMessage: string | null;
  externalActions: Array<{
    listingId: string;
    productId: string;
    productCode: string;
    productName: string;
    sku: string;
    channel: string;
    channelCode: string;
    channelName: string;
    market: string;
    targetId: string;
    message: string;
    categoryId: string | null;
    categoryPath: string[] | null;
    updatedAt: string;
  }>;
  registrationActivities: Array<{
    id: string;
    productId: string | null;
    productName: string;
    productCode: string;
    sku: string;
    status: "analyzing" | "ready" | "publishing" | "completed" | "failed" | "blocked";
    startedAt: string;
    updatedAt: string;
    completedAt: string | null;
    elapsedSeconds: number;
    channelCount: number;
    publishedCount: number;
    failedCount: number;
    blockedCount: number;
    channels: Array<{
      channel: string;
      channelCode: string;
      channelName: string;
      market: string;
      status: string;
      message: string;
      updatedAt: string;
    }>;
    message: string;
  }>;
  registrationActivityState?: "ready" | "unavailable";
  pipeline: {
    aiRunning: number;
    listingQueued: number;
    listingPublished: number;
    listingFailed: number;
    listingBlocked: number;
  };
  summary: {
    revenue30dKrw: number;
    sold30d: number;
    orderCount: number;
    paidOrderCount: number;
    readyToShipCount: number;
    openTicketCount: number;
    lowStockCount: number;
    productCount: number;
    registrationErrorCount: number;
    registrationBlockedCount: number;
    activeCredentialCount: number;
    registeredCredentialCount: number;
    settlementRiskCount: number;
  };
};

type ProductReadinessFact = Pick<OperationProduct,
  | "baseSellingPrice"
  | "baseCurrency"
  | "categoryHint"
  | "confirmedCategories"
  | "marginState"
  | "marginPercent"
  | "marginChannelKey"
  | "latestError"
  | "latestErrorKind"
> & { productId: string };

type ProductReadinessResponse = {
  facts: ProductReadinessFact[];
  factsState: OperationsSnapshot["productReadinessState"];
  factsMessage: string | null;
  aiRecovery: OperationsSnapshot["aiRecovery"];
  marginScenarios: OperationMarginScenario[];
  marginScenarioState: OperationsSnapshot["marginScenarioState"];
  marginScenarioMessage: string | null;
};

const pendingProductReadiness: ProductReadinessResponse = {
  facts: [],
  factsState: "checking",
  factsMessage: null,
  aiRecovery: {
    status: "checking",
    expiredCount: 0,
    message: "상품 가격·마진·카테고리·오류 상태를 확인하고 있습니다.",
    checkedAt: null,
  },
  marginScenarios: [],
  marginScenarioState: "checking",
  marginScenarioMessage: null,
};

function parseProductReadinessResponse(value: unknown): ProductReadinessResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const recovery = payload.aiRecovery;
  if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) return null;
  const recoveryRecord = recovery as Record<string, unknown>;
  if ((recoveryRecord.status !== "checking" && recoveryRecord.status !== "passed" && recoveryRecord.status !== "failed")
    || typeof recoveryRecord.expiredCount !== "number"
    || !Number.isFinite(recoveryRecord.expiredCount)
    || (recoveryRecord.message !== null && typeof recoveryRecord.message !== "string")
    || (recoveryRecord.checkedAt !== null && typeof recoveryRecord.checkedAt !== "string")
    || !Array.isArray(payload.facts)
    || (payload.factsState !== "ready" && payload.factsState !== "unavailable")
    || (payload.factsMessage !== null && typeof payload.factsMessage !== "string")
    || !Array.isArray(payload.marginScenarios)
    || (payload.marginScenarioState !== "ready" && payload.marginScenarioState !== "unavailable")
    || (payload.marginScenarioMessage !== null && typeof payload.marginScenarioMessage !== "string")) return null;
  return {
    facts: payload.facts as ProductReadinessFact[],
    factsState: payload.factsState,
    factsMessage: payload.factsMessage,
    aiRecovery: {
      status: recoveryRecord.status,
      expiredCount: Math.max(0, Math.trunc(recoveryRecord.expiredCount)),
      message: recoveryRecord.message,
      checkedAt: recoveryRecord.checkedAt,
    },
    marginScenarios: payload.marginScenarios as OperationMarginScenario[],
    marginScenarioState: payload.marginScenarioState,
    marginScenarioMessage: payload.marginScenarioMessage,
  };
}

function mergeProductReadiness(
  snapshot: OperationsSnapshot,
  readiness: ProductReadinessResponse,
): OperationsSnapshot {
  const factsByProductId = new Map(readiness.facts
    .filter((fact) => fact && typeof fact.productId === "string")
    .map((fact) => [fact.productId, fact]));
  return {
    ...snapshot,
    aiRecovery: readiness.aiRecovery.status === "checking" && snapshot.aiRecovery
      ? snapshot.aiRecovery
      : readiness.aiRecovery,
    productReadinessState: readiness.factsState,
    productReadinessMessage: readiness.factsMessage,
    marginScenarios: readiness.marginScenarioState === "ready"
      ? readiness.marginScenarios
      : snapshot.marginScenarios,
    marginScenarioState: readiness.marginScenarioState,
    marginScenarioMessage: readiness.marginScenarioMessage,
    products: snapshot.products.map((product) => {
      const facts = readiness.factsState === "ready"
        ? factsByProductId.get(product.id) ?? product
        : product;
      const confirmedCategories = Array.isArray(facts?.confirmedCategories)
        ? facts.confirmedCategories.flatMap((category) => {
            if (!category || typeof category !== "object") return [];
            if (typeof category.channelKey !== "string"
              || typeof category.market !== "string"
              || typeof category.categoryId !== "string"
              || !Array.isArray(category.categoryPath)
              || !category.categoryPath.every((part) => typeof part === "string")
              || (category.confirmedAt !== null && typeof category.confirmedAt !== "string")) return [];
            return [category];
          })
        : [];
      return {
        ...product,
        baseSellingPrice: typeof facts?.baseSellingPrice === "number" && Number.isFinite(facts.baseSellingPrice)
          ? facts.baseSellingPrice
          : null,
        baseCurrency: typeof facts?.baseCurrency === "string" && /^[A-Z]{3}$/.test(facts.baseCurrency)
          ? facts.baseCurrency
          : null,
        categoryHint: typeof facts?.categoryHint === "string" ? facts.categoryHint : null,
        confirmedCategories,
        marginState: facts?.marginState === "calculated" || facts?.marginState === "invalid"
          ? facts.marginState
          : "missing",
        marginPercent: typeof facts?.marginPercent === "number" && Number.isFinite(facts.marginPercent)
          ? facts.marginPercent
          : null,
        marginChannelKey: typeof facts?.marginChannelKey === "string" ? facts.marginChannelKey : null,
        latestError: typeof facts?.latestError === "string" ? facts.latestError : null,
        latestErrorKind: facts?.latestErrorKind === "analysis"
          || facts?.latestErrorKind === "listing"
          || facts?.latestErrorKind === "external_action"
          ? facts.latestErrorKind
          : null,
      };
    }),
  };
}

function carryForwardProductReadiness(
  snapshot: OperationsSnapshot,
  previous: OperationsSnapshot | null,
): OperationsSnapshot {
  if (!previous) return snapshot;
  const previousByProductId = new Map(previous.products.map((product) => [product.id, product]));
  return {
    ...snapshot,
    aiRecovery: previous.aiRecovery,
    productReadinessState: previous.productReadinessState,
    productReadinessMessage: previous.productReadinessMessage,
    marginScenarioState: previous.marginScenarioState,
    marginScenarioMessage: previous.marginScenarioMessage,
    marginScenarios: previous.marginScenarios,
    products: snapshot.products.map((product) => {
      const previousProduct = previousByProductId.get(product.id);
      if (!previousProduct) return product;
      return {
        ...product,
        baseSellingPrice: previousProduct.baseSellingPrice,
        baseCurrency: previousProduct.baseCurrency,
        categoryHint: previousProduct.categoryHint,
        confirmedCategories: previousProduct.confirmedCategories,
        marginState: previousProduct.marginState,
        marginPercent: previousProduct.marginPercent,
        marginChannelKey: previousProduct.marginChannelKey,
        latestError: previousProduct.latestError,
        latestErrorKind: previousProduct.latestErrorKind,
      };
    }),
  };
}

type LoadState = "loading" | "database" | "unavailable";
type LoadOptions = { force?: boolean; refreshProductImages?: boolean };

class OperationsSnapshotLoadError extends Error {
  constructor(message: string, readonly retainLastGood: boolean) {
    super(message);
  }
}

export function useOperationsSnapshot() {
  const [data, setData] = useState<OperationsSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const productImageCacheRef = useRef(new Map<string, OperationProductImageCacheEntry>());
  const nextProductImageRefreshAtRef = useRef(0);
  const nextDataRefreshAtRef = useRef(new Map<string, number>());
  const nextStaleAiRecoveryAtRef = useRef(0);
  const requestCoordinatorRef = useRef(new OperationsSnapshotRequestCoordinator());
  const lastSuccessfulRangeKeyRef = useRef("");
  const lastGoodDataRef = useRef<OperationsSnapshot | null>(null);
  const [range, setRange] = useState<SalesRange>(() => {
    const now = new Date();
    const to = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = new Date(monthStart.getTime() - monthStart.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    return { from, to, preset: "month" };
  });
  const rangeKey = operationsSnapshotRangeKey(range);
  const selectedRangeKeyRef = useRef(rangeKey);

  useLayoutEffect(() => {
    selectedRangeKeyRef.current = rangeKey;
    requestCoordinatorRef.current.abortCurrent();
  }, [rangeKey]);

  const authenticatedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const sessionPromise = createClient().auth.getSession();
    const { data: sessionData } = init?.signal
      ? await waitForAbortablePromise(sessionPromise, init.signal)
      : await sessionPromise;
    if (init?.signal?.aborted) {
      throw init.signal.reason ?? new DOMException("운영 데이터 요청이 취소되었습니다.", "AbortError");
    }
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new OperationsSnapshotLoadError("운영 데이터를 보려면 다시 로그인해 주세요.", false);
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    headers.set("authorization", `Bearer ${accessToken}`);
    const request = fetch(input, {
      ...init,
      cache: "no-store",
      headers,
    });
    return init?.signal ? waitForAbortablePromise(request, init.signal) : request;
  }, []);

  const load = useCallback((options: LoadOptions = {}) => {
    const startedAt = Date.now();
    const nextRefreshAt = nextDataRefreshAtRef.current.get(rangeKey) ?? 0;
    if (!options.force && startedAt < nextRefreshAt) return Promise.resolve();

    return requestCoordinatorRef.current.run(rangeKey, async (request) => {
      const coordinator = requestCoordinatorRef.current;
      const isSelectedRequest = () => coordinator.isCurrent(request, selectedRangeKeyRef.current);
      const bounded = createBoundedRequestSignal(
        request.signal,
        operationsSnapshotRequestTimeoutMs,
        "운영 데이터 조회가 30초를 초과했습니다. 다시 시도해 주세요.",
      );
      if (lastSuccessfulRangeKeyRef.current !== request.key) {
        coordinator.commitIfCurrent(request, selectedRangeKeyRef.current, () => {
          setState("loading");
          setMessage(lastSuccessfulRangeKeyRef.current
            ? "선택한 기간의 실데이터를 불러오는 중입니다. 이전 정상 데이터를 잠시 유지합니다."
            : "Supabase 운영 DB 연결을 확인하고 있습니다.");
        });
      }
      try {
        const refreshProductImages = options.refreshProductImages === true
          || startedAt >= nextProductImageRefreshAtRef.current;
        const params = new URLSearchParams({
          from: range.from,
          to: range.to,
          includeProductImages: refreshProductImages ? "1" : "0",
        });
        const shouldRecoverStaleAi = startedAt >= nextStaleAiRecoveryAtRef.current;
        const readinessBounded = createBoundedRequestSignal(
          request.signal,
          12_000,
          "상품 가격·마진·카테고리 상태 확인이 12초를 초과했습니다.",
        );
        const readinessPromise = (async (): Promise<ProductReadinessResponse> => {
          const readinessResponse = await authenticatedFetch(`/api/operations/product-readiness?recoverStale=${shouldRecoverStaleAi ? "1" : "0"}`, {
            signal: readinessBounded.signal,
          });
          const readinessPayload = parseProductReadinessResponse(await waitForAbortablePromise(
            readinessResponse.json().catch(() => null),
            readinessBounded.signal,
          ));
          if (!readinessResponse.ok || !readinessPayload) {
            throw new Error("상품 가격·마진·카테고리·오류 상태를 불러오지 못했습니다.");
          }
          return readinessPayload;
        })().catch((error): ProductReadinessResponse => ({
          facts: [],
          factsState: "unavailable",
          factsMessage: "상품 가격·마진·카테고리·오류 상태를 불러오지 못했습니다. 마지막 정상 상태가 있으면 유지합니다.",
          aiRecovery: {
            status: shouldRecoverStaleAi ? "failed" : "checking",
            expiredCount: 0,
            message: shouldRecoverStaleAi && error instanceof Error
              ? `${error.message} 장기 AI 분석 자동 복구 상태도 확인하지 못했습니다.`
              : shouldRecoverStaleAi ? "장기 AI 분석 자동 복구 상태를 확인하지 못했습니다." : null,
            checkedAt: shouldRecoverStaleAi ? new Date(startedAt).toISOString() : null,
          },
          marginScenarios: [],
          marginScenarioState: "unavailable",
          marginScenarioMessage: "저장된 마진 계산 이력을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.",
        })).finally(() => readinessBounded.dispose());
        const response = await authenticatedFetch(`/api/operations/snapshot?${params}`, {
          signal: bounded.signal,
        });
        const payload = await waitForAbortablePromise(
          response.json().catch(() => ({ message: "운영 데이터 응답을 읽지 못했습니다." })),
          bounded.signal,
        ) as OperationsSnapshot & { message?: string };
        if (bounded.signal.aborted) {
          throw bounded.signal.reason ?? new DOMException("운영 데이터 요청이 취소되었습니다.", "AbortError");
        }
        if (!isSelectedRequest()) return;
        if (!response.ok) {
          const isTransient = response.status === 408
            || response.status === 425
            || response.status === 429
            || response.status >= 500;
          throw new OperationsSnapshotLoadError(payload.message ?? "운영 데이터를 불러오지 못했습니다.", isTransient);
        }

        const basePayload = mergeProductReadiness(
          carryForwardProductReadiness(payload, lastGoodDataRef.current),
          pendingProductReadiness,
        );
        const merged = mergeOperationProductImages(
          basePayload.products,
          productImageCacheRef.current,
          startedAt,
          PRODUCT_IMAGE_CLIENT_CACHE_MS,
        );
        const baseData = { ...basePayload, products: merged.products };
        coordinator.commitIfCurrent(request, selectedRangeKeyRef.current, () => {
          if (refreshProductImages) {
            nextProductImageRefreshAtRef.current = startedAt + PRODUCT_IMAGE_REFRESH_INTERVAL_MS;
          } else if (merged.missingVersionedImage) {
            nextProductImageRefreshAtRef.current = 0;
          }

          nextDataRefreshAtRef.current.set(request.key, startedAt + DATA_REFRESH_INTERVAL_MS);
          lastSuccessfulRangeKeyRef.current = request.key;
          lastGoodDataRef.current = baseData;
          setData(baseData);
          setState("database");
          setMessage("Supabase 운영 DB · 실데이터만 표시 · 5분 자동 갱신");
        });

        const readiness = await readinessPromise;
        if (shouldRecoverStaleAi) {
          nextStaleAiRecoveryAtRef.current = Date.now() + (readiness.aiRecovery.status === "passed"
            ? STALE_AI_RECOVERY_INTERVAL_MS
            : STALE_AI_RECOVERY_RETRY_MS);
        }
        if (!isSelectedRequest()) return;
        const readyData = mergeProductReadiness(baseData, readiness);
        coordinator.commitIfCurrent(request, selectedRangeKeyRef.current, () => {
          lastGoodDataRef.current = readyData;
          setData(readyData);
        });
      } catch (error) {
        if (!isSelectedRequest()) return;
        const failureMessage = error instanceof Error ? error.message : "운영 DB에 연결하지 못했습니다.";
        const retainLastGood = !(error instanceof OperationsSnapshotLoadError) || error.retainLastGood;
        coordinator.commitIfCurrent(request, selectedRangeKeyRef.current, () => {
          nextDataRefreshAtRef.current.set(request.key, startedAt + RETRY_INTERVAL_MS);
          const unavailable = unavailableOperationsSnapshot(lastGoodDataRef.current, failureMessage, retainLastGood);
          if (!retainLastGood) {
            lastGoodDataRef.current = null;
            lastSuccessfulRangeKeyRef.current = "";
          }
          setData(unavailable.data);
          setState(unavailable.state);
          setMessage(unavailable.message);
        });
      } finally {
        bounded.dispose();
      }
    });
  }, [authenticatedFetch, range.from, range.to, rangeKey]);

  const reload = useCallback(() => load({ force: true, refreshProductImages: true }), [load]);
  const refresh = useCallback(() => load({ force: true }), [load]);
  const reloadAfterMutation = useCallback(() => {
    requestCoordinatorRef.current.abortCurrent();
    return load({ force: true, refreshProductImages: true });
  }, [load]);

  useEffect(() => {
    const requestCoordinator = requestCoordinatorRef.current;
    const initialLoad = window.setTimeout(() => void load({ force: true, refreshProductImages: true }), 0);
    const refresh = window.setInterval(() => void load({ force: true }), DATA_REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      requestCoordinator.abortCurrent();
      window.clearTimeout(initialLoad);
      window.clearInterval(refresh);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  return { data, state, message, range, setRange, reload, refresh, reloadAfterMutation, authenticatedFetch };
}
