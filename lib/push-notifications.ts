import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

type PushDelivery = {
  delivery_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  event_type: "purchase" | "shipping";
  title: string;
  body: string;
  target_url: string;
};

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

function configureWebPush() {
  const config = vapidConfiguration();
  if (!config.publicKey || !config.privateKey) throw new Error("push_not_configured");
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
}

function safePushError(error: unknown) {
  const statusCode = typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 0;
  if (statusCode === 404 || statusCode === 410) return { status: "gone" as const, message: "push subscription expired" };
  if (statusCode === 413) return { status: "failed" as const, message: "push payload rejected" };
  if (statusCode === 429) return { status: "failed" as const, message: "push provider rate limited" };
  return { status: "failed" as const, message: "push provider unavailable" };
}

export async function sendPushNotification(
  subscription: Pick<PushSubscriptionRecord, "endpoint" | "p256dh" | "authSecret">,
  payload: { title: string; body: string; url: string; type: "purchase" | "shipping"; tag?: string },
) {
  configureWebPush();
  try {
    await webpush.sendNotification({
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
      TTL: 60 * 60 * 24,
      urgency: "high",
    });
    return { status: "sent" as const };
  } catch (error) {
    return safePushError(error);
  }
}

export async function dispatchPendingPushNotifications(serviceClient: SupabaseClient, limit = 25) {
  const config = getPushPublicConfiguration();
  if (!config.configured) return { configured: false, claimed: 0, sent: 0, failed: 0 };

  const { data, error } = await serviceClient.rpc("sellerpilot_service_claim_push_deliveries", {
    p_limit: Math.max(1, Math.min(limit, 100)),
  });
  if (error) throw new Error("push_delivery_claim_failed");
  const deliveries = (Array.isArray(data) ? data : []).filter((row): row is PushDelivery => (
    Boolean(row)
    && typeof row === "object"
    && typeof row.delivery_id === "string"
    && typeof row.endpoint === "string"
    && typeof row.p256dh === "string"
    && typeof row.auth_secret === "string"
  ));

  let sent = 0;
  let failed = 0;
  await Promise.all(deliveries.map(async (delivery) => {
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
    });
    const finish = await serviceClient.rpc("sellerpilot_service_finish_push_delivery", {
      p_delivery_id: delivery.delivery_id,
      p_status: result.status,
      p_error: "message" in result ? result.message : null,
    });
    if (finish.error) throw new Error("push_delivery_finish_failed");
    if (result.status === "sent") sent += 1;
    else failed += 1;
  }));

  return { configured: true, claimed: deliveries.length, sent, failed };
}
