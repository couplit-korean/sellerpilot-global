"use client";

import { useEffect, useState } from "react";
import type {
  StudioWorkerReadiness,
  StudioWorkerReadinessReason,
} from "../lib/studio-worker-readiness";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const studioWorkerReadinessReasons = new Set<StudioWorkerReadinessReason>([
  "ready",
  "worker_missing",
  "heartbeat_missing",
  "heartbeat_stale",
  "status_unavailable",
  "configuration_missing",
  "token_missing_or_expired",
  "token_mismatch",
  "gateway_unverified",
  "gateway_verification_failed",
]);

function unavailableStudioWorkerReadiness(message: string): StudioWorkerReadiness {
  return {
    available: false,
    reason: "status_unavailable",
    message,
    checkedAt: new Date().toISOString(),
  };
}

function isStudioWorkerReadinessPayload(value: unknown): value is StudioWorkerReadiness {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<StudioWorkerReadiness>;
  return typeof payload.available === "boolean"
    && typeof payload.reason === "string"
    && studioWorkerReadinessReasons.has(payload.reason as StudioWorkerReadinessReason)
    && typeof payload.message === "string"
    && typeof payload.checkedAt === "string";
}

export function useStudioWorkerReadiness(
  authenticatedFetch: AuthenticatedFetch,
  pollIntervalMs = 15_000,
) {
  const [readiness, setReadiness] = useState<StudioWorkerReadiness | null>(null);

  useEffect(() => {
    let disposed = false;

    const loadReadiness = async () => {
      try {
        const response = await authenticatedFetch("/api/ai/product-studio", { cache: "no-store" });
        const payload = await response.json().catch(() => null) as unknown;
        if (disposed) return;
        if (response.ok && isStudioWorkerReadinessPayload(payload)) {
          setReadiness(payload);
          return;
        }
        const message = payload && typeof payload === "object" && !Array.isArray(payload)
          && typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "AI 제작 작업자 연결 상태를 확인할 수 없어 상품 분석을 시작할 수 없습니다.";
        setReadiness(unavailableStudioWorkerReadiness(message));
      } catch {
        if (disposed) return;
        setReadiness(unavailableStudioWorkerReadiness(
          "AI 제작 작업자 연결 상태를 확인할 수 없어 상품 분석을 시작할 수 없습니다.",
        ));
      }
    };

    void loadReadiness();
    const interval = window.setInterval(() => void loadReadiness(), pollIntervalMs);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [authenticatedFetch, pollIntervalMs]);

  return readiness;
}
