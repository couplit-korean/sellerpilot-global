import type { SupabaseClient } from "@supabase/supabase-js";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import webpush from "web-push";
import {
  isPublicReferenceAddress,
  validatePublicReferenceUrl,
} from "./public-reference-fetch";

type PushDelivery = {
  delivery_id: string;
  claim_token: string;
  lease_expires_at: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  event_type: "purchase" | "shipping";
  title: string;
  body: string;
  target_url: string;
};

type PushDeliveryStatus = "sent" | "failed" | "gone" | "reconciliation_required";

type PushDeliveryResult = {
  status: PushDeliveryStatus;
  message?: string;
};

type PushRequest = {
  body: Buffer | null;
  endpoint: string;
  headers: Record<string, string>;
  method: "POST";
};

type PushRequestTransport = (
  request: PushRequest,
  options: {
    onRequestStart: () => void;
    signal: AbortSignal;
    timeoutMs: number;
  },
) => Promise<number>;

export type PushDispatchOptions = {
  deadlineMs?: number;
  finalizationReserveMs?: number;
  sendTimeoutMs?: number;
  concurrency?: number;
  claimLeaseSeconds?: number;
  transport?: PushRequestTransport;
};

const PUSH_SEND_TIMEOUT_MS = 15_000;
const PUSH_BATCH_BUDGET_MS = 45_000;
const PUSH_FINALIZATION_RESERVE_MS = 10_000;
const PUSH_DISPATCH_CONCURRENCY = 8;
const PUSH_CLAIM_LEASE_SECONDS = 90;
const PUSH_CLAIM_DEADLINE_GRACE_MS = 15_000;
const PUSH_MAX_BATCH_SIZE = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
  enabled: boolean;
  deviceLabel: string;
};

function vapidConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "https://sellerpilot-global.vercel.app";
  return { publicKey, privateKey, subject };
}

export function getPushPublicConfiguration() {
  const { publicKey, privateKey } = vapidConfiguration();
  return { configured: Boolean(publicKey && privateKey), publicKey };
}

function configuredVapidDetails() {
  const config = vapidConfiguration();
  if (!config.publicKey || !config.privateKey) throw new Error("push_not_configured");
  return config;
}

function pushResponseResult(statusCode: number): PushDeliveryResult {
  if (statusCode === 404 || statusCode === 410) return { status: "gone" as const, message: "push subscription expired" };
  if (statusCode === 413) return { status: "failed" as const, message: "push payload rejected" };
  if (statusCode === 429) return { status: "failed" as const, message: "push provider rate limited" };
  if (statusCode >= 200 && statusCode < 300) return { status: "sent" as const };
  return { status: "failed" as const, message: "push provider unavailable" };
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
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

const sendPinnedPushRequest: PushRequestTransport = async (request, options) => {
  const endpoint = validatePublicReferenceUrl(request.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("push_endpoint_invalid");
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const addressFamily = isIP(hostname);
  const resolved = addressFamily
    ? [{ address: hostname, family: addressFamily }]
    : await raceWithAbort(lookup(hostname, { all: true, verbatim: true }), options.signal);
  if (!resolved.length || resolved.some((record) => !isPublicReferenceAddress(record.address))) {
    throw new Error("push_endpoint_address_blocked");
  }
  const target = resolved[0];
  if (target.family !== 4 && target.family !== 6) throw new Error("push_endpoint_address_blocked");
  if (options.signal.aborted) throw options.signal.reason;

  return new Promise<number>((resolve, reject) => {
    options.onRequestStart();
    const outbound = httpsRequest({
      protocol: "https:",
      hostname: target.address,
      family: target.family,
      port: 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: request.method,
      headers: { ...request.headers, host: endpoint.host },
      servername: isIP(hostname) ? undefined : hostname,
      signal: options.signal,
      timeout: options.timeoutMs,
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      response.resume();
      resolve(statusCode);
    });
    outbound.on("timeout", () => outbound.destroy(new Error("push_socket_timeout")));
    outbound.on("error", reject);
    if (request.body) outbound.write(request.body);
    outbound.end();
  });
};

export async function sendPushNotification(
  subscription: Pick<PushSubscriptionRecord, "endpoint" | "p256dh" | "authSecret">,
  payload: { title: string; body: string; url: string; type: "purchase" | "shipping"; tag?: string },
  options: { timeoutMs?: number; signal?: AbortSignal; transport?: PushRequestTransport } = {},
) {
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? PUSH_SEND_TIMEOUT_MS, PUSH_SEND_TIMEOUT_MS));
  let requestStarted = false;
  try {
    const vapidDetails = configuredVapidDetails();
    const request = webpush.generateRequestDetails({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.authSecret },
    }, JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      type: payload.type,
      tag: payload.tag,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
    }), {
      vapidDetails,
      TTL: 60 * 60 * 24,
      urgency: "high",
      // Keep this option explicit for callers that replace the transport with
      // web-push's https client. The request signal below is the hard wall-clock
      // abort used by the serverless runtime.
      timeout: timeoutMs,
    });
    // AbortSignal.timeout() uses an unref'ed timer in Node. Keep an explicit
    // referenced timer so a stalled transport cannot let an otherwise-idle
    // serverless invocation finish before the hard send deadline fires.
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => {
      timeoutController.abort(new Error("push_send_timeout"));
    }, timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;
    try {
      const transport = (options.transport ?? sendPinnedPushRequest)({
        body: request.body,
        endpoint: request.endpoint,
        headers: request.headers,
        method: request.method,
      }, {
        onRequestStart: () => {
          requestStarted = true;
        },
        signal,
        timeoutMs,
      });
      const statusCode = await raceWithAbort(transport, signal);
      return pushResponseResult(statusCode);
    } finally {
      clearTimeout(timeoutTimer);
    }
  } catch {
    // Once the HTTP request has started, a timeout or transport failure cannot
    // prove whether the push service accepted it. Retrying could duplicate an
    // alert, so keep that outcome out of the automatic retry state.
    return requestStarted
      ? { status: "reconciliation_required" as const, message: "push delivery outcome unknown" }
      : { status: "failed" as const, message: "push delivery preparation failed" };
  }
}

function isPushDelivery(row: unknown): row is PushDelivery {
  return Boolean(row)
    && typeof row === "object"
    && typeof (row as PushDelivery).delivery_id === "string"
    && UUID_PATTERN.test((row as PushDelivery).claim_token)
    && typeof (row as PushDelivery).lease_expires_at === "string"
    && Number.isFinite(Date.parse((row as PushDelivery).lease_expires_at))
    && typeof (row as PushDelivery).endpoint === "string"
    && typeof (row as PushDelivery).p256dh === "string"
    && typeof (row as PushDelivery).auth_secret === "string";
}

export async function dispatchPendingPushNotifications(
  serviceClient: SupabaseClient,
  limit = 25,
  options: PushDispatchOptions = {},
) {
  const config = getPushPublicConfiguration();
  if (!config.configured) {
    return {
      configured: false,
      claimed: 0,
      sent: 0,
      failed: 0,
      reconciliationRequired: 0,
      deferred: 0,
      finalizationFailed: 0,
    };
  }

  const deadlineMs = options.deadlineMs ?? Date.now() + PUSH_BATCH_BUDGET_MS;
  const finalizationReserveMs = Math.max(
    1_000,
    Math.min(options.finalizationReserveMs ?? PUSH_FINALIZATION_RESERVE_MS, 30_000),
  );
  const sendDeadlineMs = deadlineMs - finalizationReserveMs;
  if (sendDeadlineMs <= Date.now()) {
    return {
      configured: true,
      claimed: 0,
      sent: 0,
      failed: 0,
      reconciliationRequired: 0,
      deferred: 0,
      finalizationFailed: 0,
    };
  }

  const sendTimeoutMs = Math.max(1_000, Math.min(options.sendTimeoutMs ?? PUSH_SEND_TIMEOUT_MS, PUSH_SEND_TIMEOUT_MS));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? PUSH_DISPATCH_CONCURRENCY, PUSH_DISPATCH_CONCURRENCY));
  // A route can intentionally give this batch substantially more than the
  // standalone 45-second budget. Keep the database lease alive through that
  // caller-owned deadline plus a bounded finalization grace; otherwise the
  // fourth 8-worker wave can reach begin/finish after a fixed 90-second lease.
  const deadlineLeaseSeconds = Math.ceil(
    Math.max(
      PUSH_CLAIM_LEASE_SECONDS * 1_000,
      deadlineMs - Date.now() + PUSH_CLAIM_DEADLINE_GRACE_MS,
    ) / 1_000,
  );
  const claimLeaseSeconds = Math.max(
    30,
    Math.min(options.claimLeaseSeconds ?? deadlineLeaseSeconds, 300),
  );
  const claimLimit = Math.max(1, Math.min(limit, PUSH_MAX_BATCH_SIZE));

  const { data, error } = await serviceClient.rpc("sellerpilot_service_claim_push_deliveries", {
    p_limit: claimLimit,
    p_lease_seconds: claimLeaseSeconds,
  });
  if (error) throw new Error("push_delivery_claim_failed");
  if (!Array.isArray(data)) throw new Error("push_delivery_claim_invalid");
  const deliveries = data.filter(isPushDelivery);
  if (deliveries.length !== data.length) throw new Error("push_delivery_claim_invalid");

  let sent = 0;
  let failed = 0;
  let reconciliationRequired = 0;
  let deferred = 0;
  let finalizationFailed = 0;
  let nextIndex = 0;
  const deferredDeliveries: PushDelivery[] = [];
  const batchAbort = new AbortController();
  const abortTimer = setTimeout(() => batchAbort.abort("push_batch_deadline"), Math.max(1, sendDeadlineMs - Date.now()));

  async function finish(delivery: PushDelivery, result: PushDeliveryResult) {
    const finish = await serviceClient.rpc("sellerpilot_service_finish_push_delivery", {
      p_delivery_id: delivery.delivery_id,
      p_claim_token: delivery.claim_token,
      p_status: result.status,
      p_error: "message" in result ? result.message : null,
    });
    if (finish.error || finish.data !== true) {
      finalizationFailed += 1;
      return;
    }
    if (result.status === "sent") sent += 1;
    else if (result.status === "reconciliation_required") reconciliationRequired += 1;
    else failed += 1;
  }

  const workers = Array.from({ length: Math.min(concurrency, deliveries.length) }, async () => {
    while (nextIndex < deliveries.length) {
      if (batchAbort.signal.aborted || sendDeadlineMs - Date.now() < sendTimeoutMs) break;
      const delivery = deliveries[nextIndex];
      nextIndex += 1;

      const begin = await serviceClient.rpc("sellerpilot_service_begin_push_delivery", {
        p_delivery_id: delivery.delivery_id,
        p_claim_token: delivery.claim_token,
      });
      if (begin.error || begin.data !== true) {
        finalizationFailed += 1;
        continue;
      }

      if (batchAbort.signal.aborted || sendDeadlineMs <= Date.now()) {
        deferred += 1;
        await finish(delivery, { status: "failed", message: "push delivery deferred before external send" });
        continue;
      }

      const result = await sendPushNotification({
        endpoint: delivery.endpoint,
        p256dh: delivery.p256dh,
        authSecret: delivery.auth_secret,
      }, {
        title: delivery.title,
        body: delivery.body,
        url: delivery.target_url,
        type: delivery.event_type,
        tag: `sellerpilot-${delivery.delivery_id}`,
      }, {
        timeoutMs: Math.min(sendTimeoutMs, Math.max(1, sendDeadlineMs - Date.now())),
        signal: batchAbort.signal,
        transport: options.transport,
      });
      await finish(delivery, result);
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    clearTimeout(abortTimer);
  }

  while (nextIndex < deliveries.length) {
    deferredDeliveries.push(deliveries[nextIndex]);
    nextIndex += 1;
  }
  deferred += deferredDeliveries.length;
  await Promise.all(deferredDeliveries.map((delivery) => finish(delivery, {
    status: "failed",
    message: "push delivery deferred before external send",
  })));

  return {
    configured: true,
    claimed: deliveries.length,
    sent,
    failed,
    reconciliationRequired,
    deferred,
    finalizationFailed,
  };
}
