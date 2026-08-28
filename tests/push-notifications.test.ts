import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  dispatchPendingPushNotifications,
  sendPushNotification,
} from "../lib/push-notifications";

const deliveryId = "10000000-0000-4000-8000-000000000001";
const claimToken = "20000000-0000-4000-8000-000000000001";

function pushCredentials() {
  const vapid = webpush.generateVAPIDKeys();
  const recipient = createECDH("prime256v1");
  recipient.generateKeys();
  return {
    vapid,
    subscription: {
      endpoint: "https://push.example.test/delivery",
      p256dh: recipient.getPublicKey().toString("base64url"),
      authSecret: randomBytes(16).toString("base64url"),
    },
  };
}

async function withPushRuntime<T>(callback: (subscription: ReturnType<typeof pushCredentials>["subscription"]) => Promise<T>) {
  const previousPublicKey = process.env.VAPID_PUBLIC_KEY;
  const previousPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const previousSubject = process.env.VAPID_SUBJECT;
  const { vapid, subscription } = pushCredentials();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = "https://sellerpilot-global.vercel.app";
  try {
    return await callback(subscription);
  } finally {
    if (previousPublicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = previousPublicKey;
    if (previousPrivateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = previousPrivateKey;
    if (previousSubject === undefined) delete process.env.VAPID_SUBJECT;
    else process.env.VAPID_SUBJECT = previousSubject;
  }
}

function payload() {
  return {
    title: "SellerPilot test",
    body: "Push lifecycle test",
    url: "/?view=orders",
    type: "purchase" as const,
    tag: "sellerpilot-test",
  };
}

function claimedDelivery(subscription: ReturnType<typeof pushCredentials>["subscription"]) {
  return {
    delivery_id: deliveryId,
    claim_token: claimToken,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    subscription_id: "30000000-0000-4000-8000-000000000001",
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth_secret: subscription.authSecret,
    event_type: "purchase",
    title: "SellerPilot test",
    body: "Push lifecycle test",
    target_url: "/?view=orders",
  };
}

test("push delivery uses a hard abort and classifies an unknown transport outcome without retrying", async () => {
  await withPushRuntime(async (subscription) => {
    let observedSignal: AbortSignal | undefined;
    const transport = async (_request: unknown, options: { onRequestStart: () => void; signal: AbortSignal }) => {
      options.onRequestStart();
      observedSignal = options.signal;
      return await new Promise<number>((_resolve, reject) => {
        const rejectOnAbort = () => reject(observedSignal?.reason ?? new Error("aborted"));
        if (observedSignal?.aborted) rejectOnAbort();
        else observedSignal?.addEventListener("abort", rejectOnAbort, { once: true });
      });
    };

    const startedAt = Date.now();
    const result = await sendPushNotification(subscription, payload(), { timeoutMs: 25, transport });
    assert.equal(result.status, "reconciliation_required");
    assert.ok(observedSignal);
    assert.ok(observedSignal.aborted);
    assert.ok(Date.now() - startedAt < 1_000);
  });
});

test("definitive push-service responses remain safely classifiable", async () => {
  await withPushRuntime(async (subscription) => {
    const transport = (statusCode: number) => async (
      _request: unknown,
      options: { onRequestStart: () => void },
    ) => {
      options.onRequestStart();
      return statusCode;
    };
    assert.equal((await sendPushNotification(subscription, payload(), { transport: transport(201) })).status, "sent");
    assert.equal((await sendPushNotification(subscription, payload(), { transport: transport(410) })).status, "gone");
    assert.equal((await sendPushNotification(subscription, payload(), { transport: transport(503) })).status, "failed");
  });
});

test("push endpoints cannot route the server-side POST to a private address", async () => {
  await withPushRuntime(async (subscription) => {
    const result = await sendPushNotification({
      ...subscription,
      endpoint: "https://127.0.0.1/internal/push",
    }, payload(), { timeoutMs: 250 });
    assert.deepEqual(result, {
      status: "failed",
      message: "push delivery preparation failed",
    });
  });
});

test("dispatch fences an ambiguous send with claim, begin, and exact reconciliation completion", async () => {
  await withPushRuntime(async (subscription) => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const transport = async (_request: unknown, options: { onRequestStart: () => void }) => {
      options.onRequestStart();
      throw new TypeError("response lost");
    };
    const serviceClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "sellerpilot_service_claim_push_deliveries") {
          return { data: [claimedDelivery(subscription)], error: null };
        }
        return { data: true, error: null };
      },
    } as unknown as SupabaseClient;

    const result = await dispatchPendingPushNotifications(serviceClient, 100, {
      deadlineMs: Date.now() + 3_000,
      finalizationReserveMs: 1_000,
      sendTimeoutMs: 250,
      concurrency: 1,
      transport,
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.reconciliationRequired, 1);
    assert.equal(result.finalizationFailed, 0);
    assert.deepEqual(calls.map((call) => call.name), [
      "sellerpilot_service_claim_push_deliveries",
      "sellerpilot_service_begin_push_delivery",
      "sellerpilot_service_finish_push_delivery",
    ]);
    assert.equal(calls[0].args.p_limit, 25);
    assert.equal(calls[0].args.p_lease_seconds, 90);
    assert.equal(calls[2].args.p_claim_token, claimToken);
    assert.equal(calls[2].args.p_status, "reconciliation_required");
  });
});

test("route-sized push batches extend the claim lease through their caller deadline", async () => {
  await withPushRuntime(async (subscription) => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const serviceClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "sellerpilot_service_claim_push_deliveries") {
          return { data: [claimedDelivery(subscription)], error: null };
        }
        return { data: true, error: null };
      },
    } as unknown as SupabaseClient;

    await dispatchPendingPushNotifications(serviceClient, 1, {
      deadlineMs: Date.now() + 240_000,
      finalizationReserveMs: 15_000,
      sendTimeoutMs: 250,
      concurrency: 1,
      transport: async (_request, options) => {
        options.onRequestStart();
        return 201;
      },
    });

    const leaseSeconds = Number(calls[0].args.p_lease_seconds);
    assert.ok(leaseSeconds >= 254 && leaseSeconds <= 255, `unexpected lease: ${leaseSeconds}`);
  });
});

test("dispatch safely defers a claimed delivery before begin when the send window is too short", async () => {
  await withPushRuntime(async (subscription) => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let fetchCalls = 0;
    const transport = async (_request: unknown, options: { onRequestStart: () => void }) => {
      options.onRequestStart();
      fetchCalls += 1;
      return 201;
    };
    const serviceClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "sellerpilot_service_claim_push_deliveries") {
          return { data: [claimedDelivery(subscription)], error: null };
        }
        return { data: true, error: null };
      },
    } as unknown as SupabaseClient;

    const result = await dispatchPendingPushNotifications(serviceClient, 1, {
      deadlineMs: Date.now() + 1_100,
      finalizationReserveMs: 1_000,
      sendTimeoutMs: 1_000,
      concurrency: 1,
      transport,
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result.deferred, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(calls.map((call) => call.name), [
      "sellerpilot_service_claim_push_deliveries",
      "sellerpilot_service_finish_push_delivery",
    ]);
    assert.equal(calls[1].args.p_status, "failed");
  });
});
