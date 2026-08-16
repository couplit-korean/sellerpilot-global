"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

export type OperationProduct = {
  id: string;
  externalCode: string;
  sku: string;
  name: string;
  description: string;
  sourceUrl: string | null;
  imageUrl: string | null;
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
  channelMetrics: Array<{
    channelKey: string;
    channelCode: string;
    name: string;
    market: string;
    color: string;
    channelStatus: string;
    credentialStatus: string;
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
  pipeline: {
    aiRunning: number;
    listingQueued: number;
    listingPublished: number;
    listingFailed: number;
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
    activeCredentialCount: number;
  };
};

type LoadState = "loading" | "database" | "unavailable";

export function useOperationsSnapshot() {
  const [data, setData] = useState<OperationsSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");

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

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch("/api/operations/snapshot");
      const payload = await response.json().catch(() => ({ message: "운영 데이터 응답을 읽지 못했습니다." })) as OperationsSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "운영 데이터를 불러오지 못했습니다.");
      setData(payload);
      setState("database");
      setMessage("Supabase 운영 DB · 실데이터만 표시");
    } catch (error) {
      setData(null);
      setState("unavailable");
      setMessage(error instanceof Error ? error.message : "운영 DB에 연결하지 못했습니다.");
    }
  }, [authenticatedFetch]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refresh);
    };
  }, [load]);

  return { data, state, message, reload: load, authenticatedFetch };
}
