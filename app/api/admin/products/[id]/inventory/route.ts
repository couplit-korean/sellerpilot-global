import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import type { ActiveChannelKey } from "../../../../../../lib/channels/catalog";

export const runtime = "nodejs";

const productIdSchema = z.string().uuid();
const mutationSchema = z.object({
  onHand: z.number().int().min(0).max(99_999_999),
  confirmWrite: z.literal(true),
});

type InventoryTask = {
  id: string;
  channel: ActiveChannelKey;
  market: string;
  targetId: string;
  remoteId: string;
  quantity: number;
};

function taskArguments(task: InventoryTask, productSku: string) {
  switch (task.channel) {
    case "qoo10": return { remoteId: task.remoteId, quantity: task.quantity };
    case "shopee": return { itemId: task.remoteId, shopId: task.targetId, quantity: task.quantity };
    case "lazada": return { itemId: task.remoteId, quantity: task.quantity, queryParams: {} };
    case "coupang": return { sellerProductId: task.remoteId, quantity: task.quantity };
    case "smartstore": return { originProductNo: task.remoteId, quantity: task.quantity };
    case "ebay": return { sku: task.market ? `${productSku}-${task.market}`.slice(0, 100) : productSku, quantity: task.quantity };
    case "temu": return { goodsId: task.remoteId, quantity: task.quantity };
    default: return { remoteId: task.remoteId, quantity: task.quantity };
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsedId = productIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_inventory_sync", { p_product_id: parsedId.data });
  if (error) return NextResponse.json({ message: "통합 재고 이력을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ sync: data ?? null }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsedId = productIdSchema.safeParse((await context.params).id);
  const parsedBody = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json({ message: "적용할 실재고 수량과 실행 확인을 확인해 주세요." }, { status: 400 });
  }

  const idempotencyKey = `inventory-${parsedId.data}-${randomUUID()}`;
  const [{ data: started, error: startError }, { data: credentials }, { data: contextData }] = await Promise.all([
    admin.userClient.rpc("sellerpilot_start_inventory_sync", {
      p_product_id: parsedId.data,
      p_on_hand: parsedBody.data.onHand,
      p_idempotency_key: idempotencyKey,
    }),
    admin.userClient.rpc("sellerpilot_list_credentials"),
    admin.userClient.rpc("sellerpilot_get_product_publish_context", { p_product_id: parsedId.data }),
  ]);
  if (startError || !started || typeof started !== "object" || Array.isArray(started)) {
    return NextResponse.json({ message: "통합 재고 작업을 시작하지 못했습니다. 예약 수량보다 적게 입력했는지 확인해 주세요." }, { status: 409 });
  }

  const run = started as Record<string, unknown>;
  const runId = typeof run.runId === "string" ? run.runId : "";
  const tasks = Array.isArray(run.tasks)
    ? run.tasks.filter((item): item is InventoryTask => Boolean(item) && typeof item === "object" && !Array.isArray(item)
      && typeof (item as InventoryTask).id === "string" && typeof (item as InventoryTask).channel === "string")
    : [];
  const product = contextData && typeof contextData === "object" && !Array.isArray(contextData)
    && contextData.product && typeof contextData.product === "object" && !Array.isArray(contextData.product)
    ? contextData.product as Record<string, unknown>
    : {};
  const productSku = typeof product.sku === "string" ? product.sku : "";
  const credentialRows = Array.isArray(credentials) ? credentials.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  const authorization = request.headers.get("authorization") ?? "";
  const results = [] as Array<{ id: string; channel: string; ok: boolean; message: string }>;

  for (const task of tasks) {
    const credential = credentialRows.find((row) => row.channel === task.channel && row.environment === "production" && row.status === "active");
    if (!credential || typeof credential.id !== "string") {
      results.push({ id: task.id, channel: task.channel, ok: false, message: "활성 운영 키가 없습니다." });
      continue;
    }
    const response = await fetch(new URL("/api/admin/channel-operations", request.url), {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        credentialId: credential.id,
        channel: task.channel,
        operation: "inventory.update",
        idempotencyKey: `${idempotencyKey}-${task.id}`.slice(0, 160),
        confirmWrite: true,
        market: task.market,
        targetId: task.targetId,
        arguments: taskArguments(task, productSku),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) as Record<string, unknown> : {};
    const ok = Boolean(response?.ok && payload.ok === true);
    const attemptId = typeof payload.attemptId === "string" ? payload.attemptId : null;
    const safeMessage = typeof payload.safeMessage === "string"
      ? payload.safeMessage
      : typeof payload.message === "string" ? payload.message : "판매채널 재고 응답을 확인하지 못했습니다.";
    if (runId && attemptId) {
      await admin.serviceClient.rpc("sellerpilot_service_complete_inventory_sync_item", {
        p_run_id: runId,
        p_item_id: task.id,
        p_attempt_id: attemptId,
        p_success: ok,
        p_verified_quantity: ok ? task.quantity : null,
        p_safe_message: safeMessage,
      });
    }
    results.push({ id: task.id, channel: task.channel, ok, message: safeMessage });
  }

  const { data: latest } = await admin.userClient.rpc("sellerpilot_get_inventory_sync", { p_product_id: parsedId.data });
  return NextResponse.json({ ok: results.every((item) => item.ok), sync: latest ?? started, results }, {
    status: results.some((item) => !item.ok) ? 207 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
