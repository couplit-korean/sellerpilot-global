"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { authenticatedFetch } from "../../lib/authenticated-fetch";
import { createClient } from "../../lib/supabase/client";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import {
  shippingSnapshotSchema,
  type ShippingSnapshot,
  type ShippingRange,
} from "../../lib/shipping/snapshot";
import type { ShipmentInput, ShipmentResult } from "./workspace";
const fulfillmentRequestBatchSize = 3;
export function useShippingWorkspace({
  notify,
  active,
  range,
}: {
  notify: (message: string) => void;
  active: boolean;
  range?: ShippingRange;
}) {
  const [snapshot, setSnapshot] = useState<ShippingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fulfillmentController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const from = range?.from,
    to = range?.to;
  const reload = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const id = ++generation.current;
    if (!isSupabaseConfigured) {
      setError("배송 데이터 연결 설정이 필요합니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await authenticatedFetch(
        `/api/admin/shipping/snapshot?${params}`,
        {
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "배송 조회를 위해 로그인해 주세요."
            : "배송 데이터를 불러오지 못했습니다.",
        );
      const parsed = shippingSnapshotSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new Error("배송 데이터 형식을 확인하지 못했습니다.");
      if (id === generation.current && !request.signal.aborted) {
        setSnapshot(parsed.data);
        setError(null);
      }
    } catch (error) {
      if (id === generation.current && !request.signal.aborted)
        setError(error instanceof Error ? error.message : "배송 조회 실패");
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [from, to]);
  const invalidate = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
    fulfillmentController.current?.abort();
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void reload(), 0);
    const timer = active
      ? window.setInterval(() => void reload(), 60_000)
      : null;
    return () => {
      window.clearTimeout(initial);
      if (timer) window.clearInterval(timer);
      invalidate();
    };
  }, [reload, active, invalidate]);
  const owner = useRef<string | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      const nextOwner = session?.user.id ?? null;
      const changed = owner.current !== nextOwner;
      owner.current = nextOwner;
      if (event === "SIGNED_OUT" || changed) {
        invalidate();
        setSnapshot(null);
        setError(null);
        setLoading(false);
        if (nextOwner) queueMicrotask(() => void reload());
      }
    });
    return () => data.subscription.unsubscribe();
  }, [reload, invalidate]);
  const fulfillOrders = useCallback(
    async (shipments: ShipmentInput[]): Promise<ShipmentResult> => {
      if (fulfillmentController.current)
        throw new Error("배송 작업이 이미 진행 중입니다.");
      const fulfillment = new AbortController();
      fulfillmentController.current = fulfillment;
      const aggregate: ShipmentResult = {
        succeeded: 0,
        failed: 0,
        reconciliationRequired: 0,
        results: [],
      };
      for (
        let offset = 0;
        offset < shipments.length;
        offset += fulfillmentRequestBatchSize
      ) {
        const batch = shipments.slice(
          offset,
          offset + fulfillmentRequestBatchSize,
        );
        try {
          if (fulfillment.signal.aborted)
            throw new Error("배송 작업 세션이 종료되었습니다.");
          const response = await authenticatedFetch(
            "/api/admin/orders/fulfill",
            {
              method: "POST",
              signal: AbortSignal.any([
                fulfillment.signal,
                AbortSignal.timeout(250_000),
              ]),
              body: JSON.stringify({ confirmWrite: true, shipments: batch }),
            },
          );
          const payload = (await response
            .json()
            .catch(() => ({
              message: "판매채널 발송 처리 응답을 읽지 못했습니다.",
            }))) as ShipmentResult & { message?: string };
          if (!response.ok && response.status !== 207)
            throw new Error(
              payload.message ?? "판매채널 발송 처리를 완료하지 못했습니다.",
            );
          aggregate.succeeded += Number(payload.succeeded ?? 0);
          aggregate.failed += Number(payload.failed ?? batch.length);
          aggregate.reconciliationRequired += Number(
            payload.reconciliationRequired ?? 0,
          );
          aggregate.results.push(
            ...(Array.isArray(payload.results) ? payload.results : []),
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "판매채널 발송 처리 응답을 확인하지 못했습니다.";
          aggregate.failed += batch.length;
          aggregate.reconciliationRequired += batch.length;
          aggregate.results.push(
            ...batch.map((shipment) => ({
              id: shipment.id,
              channel: "unknown",
              ok: false,
              reconciliationRequired: true,
              message: `${message} 서버 접수 여부를 확인하기 전에는 같은 출고를 다시 보내지 마세요.`,
            })),
          );
        }
      }
      fulfillmentController.current = null;
      if (fulfillment.signal.aborted) return aggregate;
      await reload();
      if (fulfillment.signal.aborted) return aggregate;
      notify(
        `${shipments.length}건 중 ${aggregate.succeeded}건 발송 완료 · ${aggregate.failed}건 확인 필요 · ${aggregate.reconciliationRequired}건 원장 조정 필요`,
      );
      return aggregate;
    },
    [notify, reload],
  );
  return { snapshot, loading, error, reload, fulfillOrders };
}
