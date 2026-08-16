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

export type OperationsSnapshot = {
  generatedAt: string;
  products: OperationProduct[];
  orders: OperationOrder[];
  tickets: OperationTicket[];
  summary: {
    revenue30dKrw: number;
    sold30d: number;
    orderCount: number;
    openTicketCount: number;
    lowStockCount: number;
  };
};

type LoadState = "loading" | "database" | "fallback";

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
      let response = await authenticatedFetch("/api/operations/snapshot");
      let payload = await response.json().catch(() => ({ message: "운영 데이터 응답을 읽지 못했습니다." })) as OperationsSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "운영 데이터를 불러오지 못했습니다.");
      if (!Array.isArray(payload.products) || payload.products.length === 0) {
        const seedResponse = await authenticatedFetch("/api/operations/snapshot", {
          method: "POST",
          body: JSON.stringify({ action: "seed_demo" }),
        });
        if (!seedResponse.ok) throw new Error("화면 검증용 데이터를 준비하지 못했습니다.");
        response = await authenticatedFetch("/api/operations/snapshot");
        payload = await response.json() as OperationsSnapshot;
        if (!response.ok) throw new Error("준비된 운영 데이터를 다시 불러오지 못했습니다.");
      }
      setData(payload);
      setState("database");
      setMessage("Supabase 운영 DB · 관리자 전용");
    } catch (error) {
      setData(null);
      setState("fallback");
      setMessage(error instanceof Error ? error.message : "운영 DB 연결 전 샘플 데이터를 표시합니다.");
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
