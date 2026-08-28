import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_SCHEDULE_CANARY_HEADER = "x-sellerpilot-schedule-mode";
export const INTERNAL_SCHEDULE_CANARY_MODE = "canary-v1";

const SUPABASE_WAKE_HMAC_LABEL = "sellerpilot:channel-gateway-drain:wake:v1";
const VERCEL_RELEASE_PATTERN = /^[0-9a-f]{40}$/i;

export type RuntimeReleaseIdentityInput = {
  sellerpilotReleaseSha?: string | null;
  vercelGitCommitSha?: string | null;
};

export type RuntimeReleaseIdentity =
  | { status: "valid"; release: string }
  | { status: "missing" | "invalid" | "conflict" };

function configuredRuntimeReleaseIdentity(): RuntimeReleaseIdentityInput {
  return {
    sellerpilotReleaseSha: process.env.SELLERPILOT_RELEASE_SHA,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
  };
}

/**
 * A manually supplied release SHA may identify a CLI deployment that has no
 * Vercel Git metadata. When both identities exist they must describe the same
 * artifact; the manual value must never hide a conflicting Vercel identity.
 */
export function resolveRuntimeReleaseIdentity(
  input: RuntimeReleaseIdentityInput = configuredRuntimeReleaseIdentity(),
): RuntimeReleaseIdentity {
  const sellerpilotRelease = input.sellerpilotReleaseSha?.trim() ?? "";
  const vercelRelease = input.vercelGitCommitSha?.trim() ?? "";
  if (!sellerpilotRelease && !vercelRelease) return { status: "missing" };
  if ((sellerpilotRelease && !VERCEL_RELEASE_PATTERN.test(sellerpilotRelease))
      || (vercelRelease && !VERCEL_RELEASE_PATTERN.test(vercelRelease))) {
    return { status: "invalid" };
  }
  const normalizedSellerpilotRelease = sellerpilotRelease.toLowerCase();
  const normalizedVercelRelease = vercelRelease.toLowerCase();
  if (normalizedSellerpilotRelease
      && normalizedVercelRelease
      && normalizedSellerpilotRelease !== normalizedVercelRelease) {
    return { status: "conflict" };
  }
  return {
    status: "valid",
    release: normalizedSellerpilotRelease || normalizedVercelRelease,
  };
}

export function runtimeStatusMatchesCurrentRelease(
  runtimeStatus: unknown,
  input: RuntimeReleaseIdentityInput = configuredRuntimeReleaseIdentity(),
) {
  if (!runtimeStatus || typeof runtimeStatus !== "object" || Array.isArray(runtimeStatus)) {
    return false;
  }
  const identity = resolveRuntimeReleaseIdentity(input);
  if (identity.status !== "valid") return false;
  const status = runtimeStatus as Record<string, unknown>;
  const activeRelease = typeof status.activeRelease === "string"
    ? status.activeRelease.trim().toLowerCase()
    : "";
  return status.active === true
    && VERCEL_RELEASE_PATTERN.test(activeRelease)
    && activeRelease === identity.release;
}

function exactBearerMatch(authorization: string | null, bearer: string) {
  const actual = Buffer.from(authorization ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${bearer}`, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * The raw secret remains Vercel-only. Supabase Vault stores only this HMAC
 * derivative, shared with the already-fenced channel-gateway wake schedule.
 */
export function deriveSupabaseInternalScheduleBearer(cronSecret: string) {
  const normalized = cronSecret.trim();
  if (!normalized) throw new Error("internal_schedule_cron_secret_missing");
  return createHmac("sha256", normalized)
    .update(SUPABASE_WAKE_HMAC_LABEL, "utf8")
    .digest("base64url");
}

export function internalScheduleAuthorization(
  authorization: string | null,
  cronSecret: string | undefined,
) {
  const normalized = cronSecret?.trim() ?? "";
  if (!normalized) return "missing" as const;

  const derivedBearer = deriveSupabaseInternalScheduleBearer(normalized);
  const derivedMatch = exactBearerMatch(authorization, derivedBearer);
  return derivedMatch ? "authorized" as const : "unauthorized" as const;
}

export function internalScheduleRequestMode(request: Request) {
  const requested = request.headers.get(INTERNAL_SCHEDULE_CANARY_HEADER);
  if (requested === null) return "live" as const;
  if (requested === INTERNAL_SCHEDULE_CANARY_MODE) return "canary" as const;
  return "invalid" as const;
}

export function internalScheduleCanaryPayload(
  input: RuntimeReleaseIdentityInput = configuredRuntimeReleaseIdentity(),
) {
  const identity = resolveRuntimeReleaseIdentity(input);
  return {
    status: "canary" as const,
    executed: false as const,
    ...(identity.status === "valid" ? { release: identity.release } : {}),
    ...(identity.status === "conflict"
      ? { releaseError: "runtime_release_conflict" as const }
      : {}),
  };
}
