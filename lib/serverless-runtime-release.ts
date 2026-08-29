import "server-only";

import {
  SERVERLESS_CS_CANARY_MODE,
  SERVERLESS_CS_DRAIN_MODE_HEADER,
} from "./channels/serverless-cs-gateway";
import {
  deriveSupabaseInternalScheduleBearer,
  INTERNAL_SCHEDULE_CANARY_HEADER,
  INTERNAL_SCHEDULE_CANARY_MODE,
} from "./internal-scheduler-auth";

const releasePattern = /^[0-9a-f]{40}$/;
const receiptPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const internalSchedulePaths = [
  "/api/internal/product-research",
  "/api/internal/channel-sync",
  "/api/internal/competitor-prices",
  "/api/internal/kakao-notifications",
  "/api/internal/maintenance",
] as const;

type RpcResult = { data: unknown; error: unknown };
type RuntimeRpc = (name: string, arguments_?: Record<string, unknown>) => Promise<RpcResult>;

export class ServerlessRuntimeReleaseError extends Error {
  constructor(
    readonly safeCode: string,
    readonly status: number,
  ) {
    super(safeCode);
  }
}

export type ServerlessRuntimeReleaseResult = {
  ok: true;
  release: string;
  deactivatedPreviousRelease: boolean;
  canaries: {
    gateway: number;
    schedules: Array<{ path: string; status: number }>;
  };
  status: {
    active: true;
    activeRelease: string;
    scheduleCount: number;
    unsafePendingMutations: number;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function requiredRpc(
  rpc: RuntimeRpc,
  name: string,
  arguments_: Record<string, unknown> = {},
) {
  const result = await rpc(name, arguments_);
  if (result.error) throw new ServerlessRuntimeReleaseError("runtime_rpc_failed", 503);
  return result.data;
}

export async function readServerlessRuntimeReleaseStatus(rpc: RuntimeRpc) {
  const value = record(await requiredRpc(rpc, "sellerpilot_service_serverless_cs_wakeup_status"));
  if (!value || value.configured !== true || value.scheduleCount !== 6) {
    throw new ServerlessRuntimeReleaseError("runtime_schedule_configuration_invalid", 503);
  }
  const unsafePendingMutations = Number(value.unsafePendingMutations);
  if (!Number.isInteger(unsafePendingMutations) || unsafePendingMutations < 0) {
    throw new ServerlessRuntimeReleaseError("runtime_schedule_status_invalid", 503);
  }
  return {
    active: value.active === true,
    activeRelease: typeof value.activeRelease === "string" ? value.activeRelease.toLowerCase() : null,
    scheduleCount: 6,
    unsafePendingMutations,
  };
}

async function canaryJson(response: Response) {
  return record(await response.json().catch(() => null));
}

async function runNoWorkCanaries(input: {
  origin: string;
  release: string;
  bearer: string;
  fetchImpl: typeof fetch;
}) {
  const request = (path: string, init: RequestInit) => input.fetchImpl(`${input.origin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  const [gatewayResponse, ...scheduleResponses] = await Promise.all([
    request("/api/internal/channel-gateway-drain", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.bearer}`,
        "content-type": "application/json",
        [SERVERLESS_CS_DRAIN_MODE_HEADER]: SERVERLESS_CS_CANARY_MODE,
      },
      body: "{}",
    }),
    ...internalSchedulePaths.map((path) => request(path, {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.bearer}`,
        [INTERNAL_SCHEDULE_CANARY_HEADER]: INTERNAL_SCHEDULE_CANARY_MODE,
      },
    })),
  ]);
  const [gatewayPayload, ...schedulePayloads] = await Promise.all([
    canaryJson(gatewayResponse),
    ...scheduleResponses.map(canaryJson),
  ]);
  if (!gatewayResponse.ok
      || gatewayPayload?.status !== "canary"
      || gatewayPayload.claimed !== 0
      || gatewayPayload.processed !== 0
      || gatewayPayload.release !== input.release) {
    throw new ServerlessRuntimeReleaseError("runtime_gateway_canary_failed", 503);
  }
  for (const [index, response] of scheduleResponses.entries()) {
    const payload = schedulePayloads[index];
    if (!response.ok
        || payload?.status !== "canary"
        || payload.executed !== false
        || payload.release !== input.release) {
      throw new ServerlessRuntimeReleaseError("runtime_schedule_canary_failed", 503);
    }
  }
  return {
    gateway: gatewayResponse.status,
    schedules: scheduleResponses.map((response, index) => ({
      path: internalSchedulePaths[index],
      status: response.status,
    })),
  };
}

export async function activateServerlessRuntimeRelease(input: {
  origin: string;
  release: string;
  cronSecret: string;
  rpc: RuntimeRpc;
  fetchImpl?: typeof fetch;
}): Promise<ServerlessRuntimeReleaseResult> {
  const release = input.release.trim().toLowerCase();
  if (!releasePattern.test(release)) {
    throw new ServerlessRuntimeReleaseError("runtime_release_invalid", 503);
  }
  const cronSecret = input.cronSecret.trim();
  if (cronSecret.length < 16) {
    throw new ServerlessRuntimeReleaseError("runtime_secret_unavailable", 503);
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(input.origin);
  } catch {
    throw new ServerlessRuntimeReleaseError("runtime_origin_invalid", 503);
  }
  if (parsedOrigin.origin !== "https://sellerpilot-global.vercel.app") {
    throw new ServerlessRuntimeReleaseError("runtime_production_origin_required", 409);
  }

  const before = await readServerlessRuntimeReleaseStatus(input.rpc);
  if (before.unsafePendingMutations !== 0) {
    throw new ServerlessRuntimeReleaseError("runtime_unsafe_mutations_pending", 409);
  }
  const deactivation = record(await requiredRpc(
    input.rpc,
    "sellerpilot_service_set_serverless_cs_wakeup_active",
    { p_active: false },
  ));
  if (!deactivation
      || deactivation.configured !== true
      || deactivation.active !== false
      || deactivation.scheduleCount !== 6) {
    throw new ServerlessRuntimeReleaseError("runtime_deactivation_failed", 503);
  }
  const deactivatedPreviousRelease = before.active;

  const receipt = await requiredRpc(
    input.rpc,
    "sellerpilot_service_begin_serverless_runtime_canary",
    { p_release_id: release },
  );
  if (typeof receipt !== "string" || !receiptPattern.test(receipt)) {
    throw new ServerlessRuntimeReleaseError("runtime_canary_receipt_unavailable", 503);
  }

  const canaries = await runNoWorkCanaries({
    origin: parsedOrigin.origin,
    release,
    bearer: deriveSupabaseInternalScheduleBearer(cronSecret),
    fetchImpl: input.fetchImpl ?? fetch,
  });
  const completed = await requiredRpc(
    input.rpc,
    "sellerpilot_service_complete_serverless_runtime_canary",
    { p_receipt_id: receipt, p_release_id: release },
  );
  if (completed !== true) {
    throw new ServerlessRuntimeReleaseError("runtime_canary_receipt_completion_failed", 503);
  }
  const activation = record(await requiredRpc(
    input.rpc,
    "sellerpilot_service_activate_serverless_runtime",
    { p_canary_receipt_id: receipt, p_release_id: release },
  ));
  if (!activation || activation.active !== true || activation.canaryReceiptConsumed !== true) {
    throw new ServerlessRuntimeReleaseError("runtime_activation_failed", 503);
  }
  const after = await readServerlessRuntimeReleaseStatus(input.rpc);
  if (!after.active || after.activeRelease !== release) {
    throw new ServerlessRuntimeReleaseError("runtime_activation_not_confirmed", 503);
  }
  return {
    ok: true,
    release,
    deactivatedPreviousRelease,
    canaries,
    status: {
      active: true,
      activeRelease: release,
      scheduleCount: after.scheduleCount,
      unsafePendingMutations: after.unsafePendingMutations,
    },
  };
}
