"use client";

import { useEffect, useState } from "react";
import type { AiGatewayRuntimeVerificationFailureCode } from "../lib/ai-gateway-runtime-verification";
import type {
  StudioWorkerReadiness,
  StudioWorkerReadinessReason,
} from "../lib/studio-worker-readiness";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export const studioWorkerReadinessRequestTimeoutMs = 10_000;

type StudioWorkerReadinessPollerOptions = {
  authenticatedFetch: AuthenticatedFetch;
  onReadiness: (readiness: StudioWorkerReadiness) => void;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  autoStart?: boolean;
};

type ActiveReadinessRequest = {
  controller: AbortController;
  generation: number;
  promise: Promise<StudioWorkerReadiness | null>;
};

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

const aiGatewayVerificationFailureCodes = new Set<AiGatewayRuntimeVerificationFailureCode>([
  "authentication_error",
  "billing_required",
  "customer_verification_required",
  "failed_dependency",
  "forbidden",
  "internal_server_error",
  "invalid_request_error",
  "model_not_found",
  "no_output",
  "rate_limit_exceeded",
  "response_error",
  "timeout_error",
  "unknown",
]);

function unavailableStudioWorkerReadiness(message: string): StudioWorkerReadiness {
  return {
    available: false,
    reason: "status_unavailable",
    message,
    checkedAt: new Date().toISOString(),
  };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isAiGatewayVerificationPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const verification = value as Record<string, unknown>;
  if (verification.status === "unverified") {
    return verification.code === null
      && verification.checkedAt === null
      && verification.expiresAt === null;
  }
  if (verification.status !== "verified" && verification.status !== "failed") return false;
  if (!isIsoTimestamp(verification.checkedAt) || !isIsoTimestamp(verification.expiresAt)) return false;
  if (Date.parse(verification.expiresAt) <= Date.parse(verification.checkedAt)) return false;
  return verification.status === "verified"
    ? verification.code === null
    : typeof verification.code === "string"
      && aiGatewayVerificationFailureCodes.has(
        verification.code as AiGatewayRuntimeVerificationFailureCode,
      );
}

function isStudioWorkerReadinessPayload(value: unknown): value is StudioWorkerReadiness {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<StudioWorkerReadiness>;
  const commonValid = typeof payload.available === "boolean"
    && typeof payload.reason === "string"
    && studioWorkerReadinessReasons.has(payload.reason as StudioWorkerReadinessReason)
    && typeof payload.message === "string"
    && isIsoTimestamp(payload.checkedAt)
    && (payload.configurationReady === undefined || typeof payload.configurationReady === "boolean")
    && (payload.gatewayVerification === undefined
      || isAiGatewayVerificationPayload(payload.gatewayVerification));
  if (!commonValid) return false;
  if (!payload.available) return payload.reason !== "ready";
  return payload.reason === "ready"
    && payload.configurationReady === true
    && payload.gatewayVerification?.status === "verified";
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException(
    "AI 제작 작업자 연결 상태 확인이 취소되었습니다.",
    "AbortError",
  );
}

function waitForReadinessRequest<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function createStudioWorkerReadinessPoller({
  authenticatedFetch,
  onReadiness,
  pollIntervalMs = 15_000,
  requestTimeoutMs = studioWorkerReadinessRequestTimeoutMs,
  autoStart = true,
}: StudioWorkerReadinessPollerOptions) {
  const boundedPollIntervalMs = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
    ? Math.trunc(pollIntervalMs)
    : 15_000;
  const boundedRequestTimeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
    ? Math.trunc(requestTimeoutMs)
    : studioWorkerReadinessRequestTimeoutMs;
  let disposed = false;
  let generation = 0;
  let activeRequest: ActiveReadinessRequest | null = null;
  let interval: ReturnType<typeof globalThis.setInterval> | null = null;

  const ownsRequest = (request: ActiveReadinessRequest) => !disposed
    && activeRequest === request
    && generation === request.generation;
  const isCurrent = (request: ActiveReadinessRequest) => ownsRequest(request)
    && !request.controller.signal.aborted;

  const pollNow = () => {
    if (disposed) return Promise.resolve(null);
    if (activeRequest) return activeRequest.promise;

    const controller = new AbortController();
    const request: ActiveReadinessRequest = {
      controller,
      generation: generation + 1,
      promise: Promise.resolve(null),
    };
    generation = request.generation;
    activeRequest = request;
    const timeout = globalThis.setTimeout(() => {
      controller.abort(new DOMException(
        "AI 제작 작업자 연결 상태 확인 제한시간을 초과했습니다.",
        "TimeoutError",
      ));
    }, boundedRequestTimeoutMs);

    // Defer the fetch by one microtask so request.promise is finalized before
    // authenticatedFetch can synchronously re-enter pollNow(). Every caller
    // then observes the same in-flight Promise instead of the placeholder.
    request.promise = Promise.resolve().then(async () => {
      try {
        if (!isCurrent(request)) return null;
        const response = await waitForReadinessRequest(
          authenticatedFetch("/api/ai/product-studio", {
            cache: "no-store",
            signal: controller.signal,
          }),
          controller.signal,
        );
        const payload = await waitForReadinessRequest(
          response.json().catch(() => null),
          controller.signal,
        ) as unknown;
        if (!isCurrent(request)) return null;

        const readiness = response.ok && isStudioWorkerReadinessPayload(payload)
          ? payload
          : unavailableStudioWorkerReadiness(
            !response.ok && payload && typeof payload === "object" && !Array.isArray(payload)
              && typeof (payload as { message?: unknown }).message === "string"
              ? (payload as { message: string }).message
              : "AI 제작 작업자 연결 상태 응답이 올바르지 않아 상품 분석을 시작할 수 없습니다.",
          );
        onReadiness(readiness);
        return readiness;
      } catch (error) {
        if (!ownsRequest(request)) return null;
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        const readiness = unavailableStudioWorkerReadiness(timedOut
          ? "AI 제작 작업자 연결 상태 확인이 지연되고 있습니다. 모바일 네트워크를 확인해 주세요."
          : "AI 제작 작업자 연결 상태를 확인할 수 없어 상품 분석을 시작할 수 없습니다.");
        onReadiness(readiness);
        return readiness;
      } finally {
        globalThis.clearTimeout(timeout);
        if (activeRequest === request) activeRequest = null;
      }
    });

    return request.promise;
  };

  if (autoStart) {
    void pollNow();
    interval = globalThis.setInterval(() => void pollNow(), boundedPollIntervalMs);
  }

  return {
    pollNow,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      if (interval !== null) globalThis.clearInterval(interval);
      interval = null;
      activeRequest?.controller.abort(new DOMException(
        "AI 제작 작업자 연결 상태 화면을 닫았습니다.",
        "AbortError",
      ));
      activeRequest = null;
    },
    get requestActive() {
      return activeRequest !== null;
    },
  };
}

export function useStudioWorkerReadiness(
  authenticatedFetch: AuthenticatedFetch,
  pollIntervalMs = 15_000,
) {
  const [readiness, setReadiness] = useState<StudioWorkerReadiness | null>(null);

  useEffect(() => {
    const poller = createStudioWorkerReadinessPoller({
      authenticatedFetch,
      onReadiness: setReadiness,
      pollIntervalMs,
    });
    return () => poller.dispose();
  }, [authenticatedFetch, pollIntervalMs]);

  return readiness;
}
