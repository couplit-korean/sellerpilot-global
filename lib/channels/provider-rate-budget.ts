import type { ChannelOperationResult } from "./operations.ts";

export const providerRateBudgetContract = "sellerpilot-provider-rate-budget/1" as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedRetryAfter(value: unknown, nowMs: number): number | null {
  if (typeof value === "number" || (typeof value === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(value))) {
    const seconds = Math.ceil(Number(value));
    return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1, Math.min(seconds, 3_600)) : null;
  }
  if (typeof value === "string") {
    const target = Date.parse(value);
    if (Number.isFinite(target)) return Math.max(1, Math.min(Math.ceil((target - nowMs) / 1_000), 3_600));
  }
  return null;
}

function retryAfterFromRecord(value: Record<string, unknown>, nowMs: number): number | null {
  for (const key of ["retryAfterSeconds", "retry_after_seconds", "retryAfter", "retry_after"]) {
    const parsed = boundedRetryAfter(value[key], nowMs);
    if (parsed !== null) return parsed;
  }
  for (const key of ["responseHeaders", "headers"]) {
    const headers = record(value[key]);
    if (!headers) continue;
    const parsed = boundedRetryAfter(headers["retry-after"] ?? headers["Retry-After"], nowMs);
    if (parsed !== null) return parsed;
  }
  for (const key of ["sellerpilotRateLimit", "error", "errors", "result", "data"]) {
    const nested = record(value[key]);
    if (!nested) continue;
    const parsed = retryAfterFromRecord(nested, nowMs);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function providerRateLimitEvidence(
  result: ChannelOperationResult,
  now: Date = new Date(),
) {
  const limitedSteps = result.steps.filter((step) => step.status === 429
    || String(step.data.code ?? step.data.errorCode ?? step.data.error_code ?? "").toUpperCase()
      .includes("RATE_LIMIT"));
  if (!limitedSteps.length) return null;
  const explicit = limitedSteps.map((step) => retryAfterFromRecord(step.data, now.getTime()))
    .find((value): value is number => value !== null);
  return {
    contract: providerRateBudgetContract,
    retryAfterSeconds: explicit ?? 60,
    providerSpecified: explicit !== undefined,
  };
}
