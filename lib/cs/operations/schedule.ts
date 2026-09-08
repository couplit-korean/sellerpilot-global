import { inquiryHistorySyncRequests, inquirySyncRequests } from "../../channels/inquiry-sync";
import { SERVERLESS_STATIC_EGRESS_CHANNELS, type ServerlessStaticEgressChannel } from "../../channels/serverless-static-egress";
import { callRpc, recordValue } from "../../channels/gateway-completion-runtime";
type CsScheduleDependencies = {
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string | null } | null }>;
  now?: () => Date;
  staticEgressChannels?: readonly ServerlessStaticEgressChannel[];
  enableHistoryRepair?: boolean;
};
export const SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES = 5;
export const SERVERLESS_CS_REPAIR_MIN_INTERVAL_MINUTES = 24 * 60;
export const SERVERLESS_CS_ENQUEUE_CONCURRENCY = 3;
export const SERVERLESS_CS_CURRENT_INQUIRY_CHANNELS = [
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
  "temu",
] as const;

export type ServerlessCsEnqueueSummary = {
  attempted: number;
  queued: number;
  pending: number;
  notConnected: number;
  reconnectRequired: number;
  reconciliationRequired: number;
  fixedEgressRequired: number;
  failed: number;
};

export function serverlessCsCurrentInquiryEnqueues(
  now = new Date(),
  staticEgressChannels: readonly ServerlessStaticEgressChannel[] = [],
) {
  const enabledStaticEgress = new Set(staticEgressChannels);
  return SERVERLESS_CS_CURRENT_INQUIRY_CHANNELS
    .filter((channel) => channel === "shopee"
      || !(SERVERLESS_STATIC_EGRESS_CHANNELS as readonly string[]).includes(channel)
      || enabledStaticEgress.has(channel as ServerlessStaticEgressChannel))
    .flatMap((channel) =>
    inquirySyncRequests(channel, now).map((payload) => ({
      channel,
      operation: "inquiries.list" as const,
      payload,
    })));
}

/**
 * During the first five minutes of every KST hour, offer a bounded read-only
 * repair pass to the durable periodic-enqueue ledger. Its daily cooldown makes
 * the first successful offer authoritative, while a missed 03:00 run catches
 * up on the next available hour instead of waiting a full day. Smartstore,
 * Qoo10 and eBay recheck the last 30 days. Coupang rotates one of five
 * seven-day slices each day, so a scheduler outage inside that 30-day window
 * is revisited without creating all 40 Coupang jobs at once. eBay is divided
 * into disjoint provider-safe windows covering its full one-year retention.
 * 11st rechecks five disjoint windows because its official Product Q&A list
 * contract permits at most seven calendar days per request.
 */
export function serverlessCsRepairInquiryEnqueues(
  now = new Date(),
  staticEgressChannels: readonly ServerlessStaticEgressChannel[] = [],
) {
  const korea = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  if (korea.getUTCMinutes() >= 5) return [];
  const enabled = new Set(staticEgressChannels);
  const enqueues: Array<{
    channel: "coupang" | "elevenst" | "smartstore" | "qoo10" | "shopee" | "ebay" | "temu";
    operation: "inquiries.list";
    payload: ReturnType<typeof inquiryHistorySyncRequests>[number];
  }> = [];
  if (enabled.has("coupang")) {
    const coupang = inquiryHistorySyncRequests("coupang", now, 30);
    const requestsPerWindow = 8;
    const windowCount = Math.ceil(coupang.length / requestsPerWindow);
    const dayNumber = Math.floor(Date.UTC(korea.getUTCFullYear(), korea.getUTCMonth(), korea.getUTCDate()) / 86_400_000);
    const selectedWindow = dayNumber % windowCount;
    for (const payload of coupang.slice(selectedWindow * requestsPerWindow, selectedWindow * requestsPerWindow + requestsPerWindow)) {
      enqueues.push({ channel: "coupang", operation: "inquiries.list", payload });
    }
  }
  if (enabled.has("smartstore")) {
    for (const payload of inquiryHistorySyncRequests("smartstore", now, 30)) {
      enqueues.push({ channel: "smartstore", operation: "inquiries.list", payload });
    }
  }
  if (enabled.has("elevenst")) {
    for (const payload of inquiryHistorySyncRequests("elevenst", now, 30)) {
      enqueues.push({ channel: "elevenst", operation: "inquiries.list", payload });
    }
  }
  if (enabled.has("temu")) {
    for (const payload of inquiryHistorySyncRequests("temu", now, 30)) {
      enqueues.push({ channel: "temu", operation: "inquiries.list", payload });
    }
  }
  for (const payload of inquiryHistorySyncRequests("shopee", now, 30)) {
    enqueues.push({ channel: "shopee", operation: "inquiries.list", payload });
  }
  for (const channel of ["qoo10", "ebay"] as const) {
    const historyDays = channel === "ebay" ? 365 : 30;
    for (const payload of inquiryHistorySyncRequests(channel, now, historyDays)) {
      enqueues.push({ channel, operation: "inquiries.list", payload });
    }
  }
  return enqueues;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type PeriodicEnqueueStatus =
  | "queued"
  | "already_pending"
  | "not_connected"
  | "reconnect_required"
  | "reconciliation_required"
  | "fixed_egress_required"
  | "failed";

const PERIODIC_ENQUEUE_STATUSES = new Set<PeriodicEnqueueStatus>([
  "queued",
  "already_pending",
  "not_connected",
  "reconnect_required",
  "reconciliation_required",
  "fixed_egress_required",
  "failed",
]);

export async function enqueueCurrentInquirySyncs(
  dependencies: CsScheduleDependencies,
): Promise<ServerlessCsEnqueueSummary> {
  const now = dependencies.now?.() ?? new Date();
  const requests = serverlessCsCurrentInquiryEnqueues(
    now,
    dependencies.staticEgressChannels,
  ).concat(dependencies.enableHistoryRepair
    ? serverlessCsRepairInquiryEnqueues(now, dependencies.staticEgressChannels)
    : []);
  const statuses = await mapWithConcurrency(
    requests,
    SERVERLESS_CS_ENQUEUE_CONCURRENCY,
    async ({ channel, operation, payload }): Promise<PeriodicEnqueueStatus> => {
      const result = await callRpc(
        dependencies,
        "sellerpilot_service_enqueue_periodic_sync",
        {
          p_channel: channel,
          p_operation: operation,
          p_request_payload: payload,
          p_min_interval_minutes: payload.periodicKey.startsWith("inquiries:history:")
            ? SERVERLESS_CS_REPAIR_MIN_INTERVAL_MINUTES
            : SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES,
        },
      );
      if (result.error) return "failed";
      const status = recordValue(result.data)?.status;
      return typeof status === "string"
        && PERIODIC_ENQUEUE_STATUSES.has(status as PeriodicEnqueueStatus)
        ? status as PeriodicEnqueueStatus
        : "failed";
    },
  );
  return {
    attempted: requests.length,
    queued: statuses.filter((status) => status === "queued").length,
    pending: statuses.filter((status) => status === "already_pending").length,
    notConnected: statuses.filter((status) => status === "not_connected").length,
    reconnectRequired: statuses.filter((status) => status === "reconnect_required").length,
    reconciliationRequired: statuses.filter((status) => status === "reconciliation_required").length,
    fixedEgressRequired: statuses.filter((status) => status === "fixed_egress_required").length,
    failed: statuses.filter((status) => status === "failed").length,
  };
}

