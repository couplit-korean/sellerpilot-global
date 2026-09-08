import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
type GatewayJobSnapshot = {
  status?: unknown;
  response?: unknown;
  error?: unknown;
};
export class ChannelGatewayInProgressError extends Error {
  readonly jobId: string;
  readonly attemptId: string | null;
  readonly listingId: string | null;

  constructor(
    jobId: string,
    attemptId: string | null,
    message = "CHANNEL_GATEWAY_IN_PROGRESS",
    listingId: string | null = null,
  ) {
    super(message);
    this.name = "ChannelGatewayInProgressError";
    this.jobId = jobId;
    this.attemptId = attemptId;
    this.listingId = listingId;
  }
}

export class ChannelGatewayReconciliationRequiredError extends Error {
  readonly jobId: string;
  readonly attemptId: string | null;
  readonly listingId: string | null;

  constructor(
    jobId: string,
    attemptId: string | null,
    listingId: string | null = null,
  ) {
    super("CHANNEL_GATEWAY_RECONCILIATION_REQUIRED");
    this.name = "ChannelGatewayReconciliationRequiredError";
    this.jobId = jobId;
    this.attemptId = attemptId;
    this.listingId = listingId;
  }
}

export class ChannelGatewayRemoteFailedError extends Error {
  readonly jobId: string;
  readonly attemptId: string | null;
  readonly listingId: string | null;

  constructor(
    jobId: string,
    attemptId: string | null,
    listingId: string | null,
    safeError: string,
  ) {
    super(`CHANNEL_GATEWAY_REMOTE_FAILED:${safeError}`);
    this.name = "ChannelGatewayRemoteFailedError";
    this.jobId = jobId;
    this.attemptId = attemptId;
    this.listingId = listingId;
  }
}

export class ChannelGatewayCredentialUnattestedError extends Error {
  constructor() {
    super("CHANNEL_GATEWAY_CREDENTIAL_UNATTESTED");
    this.name = "ChannelGatewayCredentialUnattestedError";
  }
}

export function throwGatewayEnqueueError(error: { message?: string } | null) {
  if (error?.message?.includes("provider-certified seller identity required")) {
    throw new ChannelGatewayCredentialUnattestedError();
  }
  throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
}

export async function waitForGatewayJob(
  serviceClient: SupabaseClient,
  jobId: string,
  timeoutMs: number,
  attemptId: string | null = null,
  listingId: string | null = null,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    const query = serviceClient.rpc("sellerpilot_get_channel_gateway_job", {
      p_job_id: jobId,
    });
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    // Enqueue already committed. Losing the subsequent status read is never
    // proof of provider failure; preserve the active job/upper ledger and let
    // exact worker completion settle it.
    if (error)
      throw new ChannelGatewayInProgressError(
        jobId,
        attemptId,
        "CHANNEL_GATEWAY_STATUS_UNAVAILABLE",
        listingId,
      );
    const job =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as GatewayJobSnapshot)
        : null;
    if (
      job?.status === "succeeded" &&
      job.response &&
      typeof job.response === "object" &&
      !Array.isArray(job.response)
    )
      return job.response;
    if (job?.status === "reconciliation_required") {
      throw new ChannelGatewayReconciliationRequiredError(
        jobId,
        attemptId,
        listingId,
      );
    }
    if (job?.status === "failed" || job?.status === "cancelled") {
      throw new ChannelGatewayRemoteFailedError(
        jobId,
        attemptId,
        listingId,
        typeof job.error === "string" ? job.error : "worker_failed",
      );
    }
    await delay(500, signal);
  }
  throw new ChannelGatewayInProgressError(
    jobId,
    attemptId,
    "CHANNEL_GATEWAY_TIMEOUT",
    listingId,
  );
}

function delay(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
