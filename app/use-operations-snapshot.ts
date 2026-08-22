"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  mergeOperationProductImages,
  type OperationProductImageCacheEntry,
} from "../lib/operation-product-image-cache";

const DATA_REFRESH_INTERVAL_MS = 5 * 60_000;
const RETRY_INTERVAL_MS = 30_000;
const PRODUCT_IMAGE_REFRESH_INTERVAL_MS = 45 * 60_000;
const PRODUCT_IMAGE_CLIENT_CACHE_MS = 55 * 60_000;

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
  status: "urgent" | "waiting" | "in_progress" | "resolved";
  priority: number;
  receivedAt: string;
  updatedAt: string;
  demo: boolean;
};

export type OperationMarginScenario = {
  id: string;
  name: string;
  channelKey: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
};

export type OperationsSnapshot = {
  generatedAt: string;
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

type LoadState = "loading" | "database" | "unavailable";
type LoadOptions = { force?: boolean; refreshProductImages?: boolean };

export function useOperationsSnapshot() {
  const [data, setData] = useState<OperationsSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const productImageCacheRef = useRef(new Map<string, OperationProductImageCacheEntry>());
  const nextProductImageRefreshAtRef = useRef(0);
  const nextDataRefreshAtRef = useRef(0);
  const inFlightLoadRef = useRef<Promise<void> | null>(null);
  const [range, setRange] = useState<SalesRange>(() => {
    const now = new Date();
    const to = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = new Date(monthStart.getTime() - monthStart.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    return { from, to, preset: "month" };
  });

  const authenticatedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const { data: sessionData } = await createClient().auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("운영 데이터를 보려면 다시 로그인해 주세요.");
    return fetch(input, {
      ...init,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
  }, []);

  const load = useCallback((options: LoadOptions = {}) => {
    if (inFlightLoadRef.current) return inFlightLoadRef.current;
    const startedAt = Date.now();
    if (!options.force && startedAt < nextDataRefreshAtRef.current) return Promise.resolve();

    const request = (async () => {
      try {
        const refreshProductImages = options.refreshProductImages === true
          || startedAt >= nextProductImageRefreshAtRef.current;
        const params = new URLSearchParams({
          from: range.from,
          to: range.to,
          includeProductImages: refreshProductImages ? "1" : "0",
        });
        const response = await authenticatedFetch(`/api/operations/snapshot?${params}`);
        const payload = await response.json().catch(() => ({ message: "운영 데이터 응답을 읽지 못했습니다." })) as OperationsSnapshot & { message?: string };
        if (!response.ok) throw new Error(payload.message ?? "운영 데이터를 불러오지 못했습니다.");

        const merged = mergeOperationProductImages(
          payload.products,
          productImageCacheRef.current,
          startedAt,
          PRODUCT_IMAGE_CLIENT_CACHE_MS,
        );
        if (refreshProductImages) {
          nextProductImageRefreshAtRef.current = startedAt + PRODUCT_IMAGE_REFRESH_INTERVAL_MS;
        } else if (merged.missingVersionedImage) {
          nextProductImageRefreshAtRef.current = 0;
        }

        nextDataRefreshAtRef.current = startedAt + DATA_REFRESH_INTERVAL_MS;
        setData({ ...payload, products: merged.products });
        setState("database");
        setMessage("Supabase 운영 DB · 실데이터만 표시 · 5분 자동 갱신");
      } catch (error) {
        nextDataRefreshAtRef.current = startedAt + RETRY_INTERVAL_MS;
        setData(null);
        setState("unavailable");
        setMessage(error instanceof Error ? error.message : "운영 DB에 연결하지 못했습니다.");
      }
    })();

    inFlightLoadRef.current = request;
    void request.finally(() => {
      if (inFlightLoadRef.current === request) inFlightLoadRef.current = null;
    });
    return request;
  }, [authenticatedFetch, range.from, range.to]);

  const reload = useCallback(() => load({ force: true, refreshProductImages: true }), [load]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load({ force: true, refreshProductImages: true }), 0);
    const refresh = window.setInterval(() => void load({ force: true }), DATA_REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refresh);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  return { data, state, message, range, setRange, reload, authenticatedFetch };
}
