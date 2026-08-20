import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { dispatchPendingPushNotifications } from "../../../../lib/push-notifications";

export const runtime = "nodejs";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("order_status"),
    id: z.string().uuid(),
    status: z.enum(["paid", "ready_to_ship", "shipped", "delivered", "cancelled", "refunded"]),
  }),
  z.object({
    action: z.literal("ticket_update"),
    id: z.string().uuid(),
    status: z.enum(["urgent", "waiting", "in_progress", "resolved"]),
    replyDraft: z.string().max(8000).optional(),
  }),
  z.object({
    action: z.literal("margin_save"),
    name: z.string().trim().min(1).max(120),
    channelKey: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]),
    inputs: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()),
  }),
  z.object({
    action: z.literal("margin_delete"),
    id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("product_create"),
    jobId: z.string().uuid(),
  }),
]);

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const [{ data, error }, { data: marginScenarios }, { data: syncStatus }, { data: credentialRows, error: credentialError }, { data: aiRuntime }] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_operations_snapshot"),
    admin.userClient.rpc("sellerpilot_list_margin_scenarios", { p_limit: 5 }),
    admin.userClient.rpc("sellerpilot_get_channel_sync_status"),
    admin.userClient.rpc("sellerpilot_list_credentials"),
    admin.userClient.rpc("sellerpilot_ai_runtime_status"),
  ]);
  if (error || credentialError) {
    return NextResponse.json({ message: "운영 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>) }
    : {};

  const credentials = Array.isArray(credentialRows)
    ? credentialRows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
  const activeProductionByChannel = new Map<string, Record<string, unknown>>();
  for (const credential of credentials) {
    const channel = typeof credential.channel === "string" ? credential.channel : "";
    if (!channel || credential.environment !== "production" || credential.status !== "active" || activeProductionByChannel.has(channel)) continue;
    activeProductionByChannel.set(channel, credential);
  }
  const verifiedChannels = new Set([...activeProductionByChannel.entries()]
    .filter(([, credential]) => {
      const expiresAt = typeof credential.expires_at === "string" ? Date.parse(credential.expires_at) : Number.POSITIVE_INFINITY;
      return credential.last_check_status === "passed" && expiresAt > Date.now();
    })
    .map(([channel]) => channel));

  if (Array.isArray(payload.channelMetrics)) {
    payload.channelMetrics = payload.channelMetrics.map((metric) => {
      if (!metric || typeof metric !== "object" || Array.isArray(metric)) return metric;
      const channelMetric = metric as Record<string, unknown>;
      const channelKey = typeof channelMetric.channelKey === "string" ? channelMetric.channelKey : "";
      const credential = activeProductionByChannel.get(channelKey);
      return {
        ...channelMetric,
        credentialStatus: verifiedChannels.has(channelKey) ? "active" : credential ? "unverified" : "missing",
        credentialLastCheckStatus: credential?.last_check_status ?? null,
        credentialLastCheckedAt: credential?.last_checked_at ?? null,
      };
    });
  }
  if (payload.summary && typeof payload.summary === "object" && !Array.isArray(payload.summary)) {
    payload.summary = {
      ...(payload.summary as Record<string, unknown>),
      activeCredentialCount: verifiedChannels.size,
      registeredCredentialCount: activeProductionByChannel.size,
    };
  }
  payload.marginScenarios = Array.isArray(marginScenarios) ? marginScenarios : [];
  payload.syncStatus = Array.isArray(syncStatus) ? syncStatus : [];
  payload.aiRuntime = aiRuntime && typeof aiRuntime === "object" && !Array.isArray(aiRuntime) ? aiRuntime : null;
  if (Array.isArray(payload.products)) {
    const products = payload.products.filter((product): product is Record<string, unknown> => Boolean(product) && typeof product === "object" && !Array.isArray(product));
    const paths = products.map((product) => typeof product.aiHeroPath === "string" ? product.aiHeroPath : "").filter(Boolean);
    const { data: signed } = paths.length
      ? await admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(paths, 60 * 60)
      : { data: [] };
    let signedIndex = 0;
    payload.products = products.map((product) => {
      const next = { ...product };
      if (typeof next.aiHeroPath === "string" && next.aiHeroPath) {
        next.imageUrl = signed?.[signedIndex]?.signedUrl ?? next.imageUrl ?? null;
        signedIndex += 1;
      }
      delete next.aiHeroPath;
      return next;
    });
  }
  return NextResponse.json(payload, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "운영 데이터 변경 요청을 확인해 주세요." }, { status: 400 });
  }

  let mutationError: { message: string } | null = null;
  let id: string | null = null;
  if (parsed.data.action === "order_status") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_update_order_status", {
      p_id: parsed.data.id,
      p_status: parsed.data.status,
    });
    mutationError = error ?? (data === true ? null : { message: "order not found" });
  } else if (parsed.data.action === "ticket_update") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_update_ticket", {
      p_id: parsed.data.id,
      p_status: parsed.data.status,
      p_reply_draft: parsed.data.replyDraft ?? null,
    });
    mutationError = error ?? (data === true ? null : { message: "ticket not found" });
  } else if (parsed.data.action === "margin_save") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_save_margin_scenario", {
      p_name: parsed.data.name,
      p_channel_key: parsed.data.channelKey,
      p_inputs: parsed.data.inputs,
      p_result: parsed.data.result,
    });
    id = typeof data === "string" ? data : null;
    mutationError = error;
  } else if (parsed.data.action === "margin_delete") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_delete_margin_scenario", {
      p_id: parsed.data.id,
    });
    mutationError = error ?? (data === true ? null : { message: "scenario not found" });
  } else {
    const { data, error } = await admin.userClient.rpc("sellerpilot_create_product_from_ai_v2", {
      p_job_id: parsed.data.jobId,
    });
    id = typeof data === "string" ? data : null;
    mutationError = error;
  }

  if (mutationError) {
    return NextResponse.json({ message: "운영 데이터를 저장하지 못했습니다." }, { status: 500 });
  }
  if (parsed.data.action === "order_status") {
    await dispatchPendingPushNotifications(admin.serviceClient).catch(() => null);
  }
  return NextResponse.json({ ok: true, id }, { headers: { "cache-control": "no-store, max-age=0" } });
}
