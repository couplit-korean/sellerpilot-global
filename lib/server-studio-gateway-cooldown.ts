import { setTimeout as delay } from "node:timers/promises";
import type { AiGatewayFailureDiagnostic } from "./ai-gateway-failure";

export const SERVER_STUDIO_MAX_GATEWAY_COOLDOWN_MS = 15_000;

/**
 * One explicit pre-provider 429 recovery per claim. An unknown provider outcome,
 * credit/account limit or long Retry-After still requires operator recovery.
 */
export function createServerStudioGatewayCooldown(now = () => performance.now()) {
  let reserved = false;
  let readyAt = 0;
  return {
    reserve(diagnostic: AiGatewayFailureDiagnostic | undefined) {
      const waitMs = diagnostic?.retryAfterMs;
      if (reserved || diagnostic?.reason !== "gateway_rate_limited"
          || diagnostic.httpStatus !== 429 || diagnostic.upstreamProviderAttempted !== false
          || (diagnostic.limitKind !== "concurrency_limit" && diagnostic.limitKind !== "unknown_rate_limit")
          || waitMs == null || !Number.isFinite(waitMs) || waitMs < 0
          || waitMs > SERVER_STUDIO_MAX_GATEWAY_COOLDOWN_MS) return false;
      reserved = true;
      readyAt = now() + Math.max(1, Math.ceil(waitMs));
      return true;
    },
    async wait(signal: AbortSignal) {
      signal.throwIfAborted();
      let remaining = Math.ceil(readyAt - now());
      while (remaining > 0) {
        try {
          await delay(remaining, undefined, { signal });
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          throw error;
        }
        signal.throwIfAborted();
        remaining = Math.ceil(readyAt - now());
      }
    },
  };
}
