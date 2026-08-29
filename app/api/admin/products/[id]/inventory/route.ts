import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import type { ActiveChannelKey } from "../../../../../../lib/channels/catalog";

export const runtime = "nodejs";
export const maxDuration = 300;

const productIdSchema = z.string().uuid();
const mutationSchema = z.object({
  onHand: z.number().int().min(0).max(99_999_999),
  confirmWrite: z.literal(true),
});

const inventoryTaskBatchSize = 6;

type InventoryTask = {
  id: string;
  listingId: string;
  channel: ActiveChannelKey;
  market: string;
  targetId: string;
  remoteId: string;
  quantity: number;
  status?: string;
};

const inventoryRequestKey = /^[A-Za-z0-9._:-]{12,160}$/;

function stableInventoryIdempotencyKey(input: {
  request: Request;
  actorId: string;
  productId: string;
  onHand: number;
  now?: number;
}) {
  const supplied = input.request.headers.get("idempotency-key")?.trim()
    || input.request.headers.get("x-idempotency-key")?.trim()
    || "";
  // A five-minute fallback window collapses browser/network retries without
  // preventing a deliberate later re-application of the same stock quantity.
  const retryIdentity = inventoryRequestKey.test(supplied)
    ? supplied
    : `window:${Math.floor((input.now ?? Date.now()) / 300_000)}`;
  const digest = createHash("sha256")
    .update(`${input.actorId}:${input.productId}:${input.onHand}:${retryIdentity}`)
    .digest("hex");
  return `inventory-${digest}`;
}

async function expireStaleInventorySync(
  serviceClient: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> },
  productId: string,
) {
  try {
    const { error } = await serviceClient.rpc("sellerpilot_service_expire_inventory_sync", {
      p_product_id: productId,
      p_stale_before: new Date(Date.now() - 15 * 60_000).toISOString(),
    });
    return error == null;
  } catch {
    return false;
  }
}

function taskArguments(task: InventoryTask, marketplaceSku?: string) {
  switch (task.channel) {
    case "qoo10": return { remoteId: task.remoteId, quantity: task.quantity };
    case "shopee": return { itemId: task.remoteId, shopId: task.targetId, quantity: task.quantity };
    case "lazada": return { itemId: task.remoteId, country: task.market.toLowerCase(), quantity: task.quantity, queryParams: {} };
    case "coupang": return { sellerProductId: task.remoteId, quantity: task.quantity };
    case "smartstore": return { originProductNo: task.remoteId, quantity: task.quantity };
    case "ebay": {
      const sku = marketplaceSku?.trim() ?? "";
      if (!sku) throw new Error("EBAY_MARKETPLACE_SKU_UNBOUND");
      return { sku, quantity: task.quantity };
    }
    case "temu": return { goodsId: task.remoteId, quantity: task.quantity };
    default: return { remoteId: task.remoteId, quantity: task.quantity };
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsedId = productIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });
  await expireStaleInventorySync(admin.serviceClient, parsedId.data);
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

  await expireStaleInventorySync(admin.serviceClient, parsedId.data);
  const idempotencyKey = stableInventoryIdempotencyKey({
    request,
    actorId: admin.user.id,
    productId: parsedId.data,
    onHand: parsedBody.data.onHand,
  });
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
      && typeof (item as InventoryTask).id === "string"
      && typeof (item as InventoryTask).listingId === "string"
      && typeof (item as InventoryTask).channel === "string")
    : [];
  const pendingTasks = tasks.filter((task) => !task.status || task.status === "pending");
  const currentTasks = pendingTasks.slice(0, inventoryTaskBatchSize);
  const contextListings = contextData && typeof contextData === "object" && !Array.isArray(contextData)
    && Array.isArray(contextData.listings)
    ? contextData.listings.filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const credentialRows = Array.isArray(credentials) ? credentials.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  const authorization = request.headers.get("authorization") ?? "";
  const results = [] as Array<{ id: string; channel: string; ok: boolean; message: string; inProgress?: boolean; reconciliationRequired?: boolean }>;

  const recordPrewriteFailure = async (task: InventoryTask, attemptId: string | null, safeMessage: string) => {
    if (!runId) return false;
    try {
      const { data, error } = await admin.serviceClient.rpc("sellerpilot_service_fail_inventory_sync_item_prewrite", {
        p_run_id: runId,
        p_item_id: task.id,
        p_attempt_id: attemptId,
        p_safe_message: safeMessage,
      });
      return !error && data === true;
    } catch {
      return false;
    }
  };

  const processTask = async (task: InventoryTask) => {
    if (task.status && task.status !== "pending") return;
    const credential = credentialRows.find((row) => row.channel === task.channel && row.environment === "production" && row.status === "active");
    if (!credential || typeof credential.id !== "string") {
      const message = "활성 운영 키가 없습니다.";
      const recorded = await recordPrewriteFailure(task, null, message);
      results.push({
        id: task.id,
        channel: task.channel,
        ok: false,
        message: recorded ? message : `${message} 내부 작업 종료를 확인하지 못해 자동 만료 대상으로 전환했습니다.`,
        ...(!recorded ? { reconciliationRequired: true } : {}),
      });
      return;
    }
    const listingContext = contextListings.find((listing: Record<string, unknown>) => listing.id === task.listingId);
    let argumentsValue: Record<string, unknown>;
    try {
      argumentsValue = taskArguments(
        task,
        typeof listingContext?.marketplaceSku === "string" ? listingContext.marketplaceSku : undefined,
      );
    } catch {
      const message = "eBay 게시 원장에 실제 등록 SKU가 없어 추정값으로 재고를 변경하지 않았습니다. 해당 상품의 판매자센터 SKU를 먼저 원장과 조정해 주세요.";
      const recorded = await recordPrewriteFailure(task, null, message);
      results.push({
        id: task.id,
        channel: task.channel,
        ok: false,
        message: recorded ? message : `${message} 내부 작업 종료를 확인하지 못해 자동 만료 대상으로 전환했습니다.`,
        ...(!recorded ? { reconciliationRequired: true } : {}),
      });
      return;
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
        productId: parsedId.data,
        resourceListingId: task.listingId,
        inventoryItemId: task.id,
        market: task.market,
        targetId: task.targetId,
        arguments: argumentsValue,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) as Record<string, unknown> : {};
    const ok = Boolean(response?.ok && payload.ok === true);
    const attemptId = typeof payload.attemptId === "string" ? payload.attemptId : null;
    const inProgress = response?.status === 202 && payload.inProgress === true;
    const reconciliationRequired = payload.reconciliationRequired === true || payload.manualRequired === true;
    const safeMessage = typeof payload.safeMessage === "string"
      ? payload.safeMessage
      : typeof payload.message === "string" ? payload.message : "판매채널 재고 응답을 확인하지 못했습니다.";
    if (!ok && !inProgress && !reconciliationRequired) {
      const recorded = await recordPrewriteFailure(task, attemptId, safeMessage);
      if (!recorded) {
        results.push({
          id: task.id,
          channel: task.channel,
          ok: false,
          message: `${safeMessage} 내부 작업 종료를 확인하지 못해 자동 만료 대상으로 전환했습니다.`,
          reconciliationRequired: true,
        });
        return;
      }
    }
    results.push({
      id: task.id,
      channel: task.channel,
      ok,
      message: safeMessage,
      ...(inProgress ? { inProgress: true } : {}),
      ...(reconciliationRequired ? { reconciliationRequired: true } : {}),
    });
  };

  const processTaskSafely = async (task: InventoryTask) => {
    try {
      await processTask(task);
    } catch {
      const safeMessage = "재고 요청 처리 중 예상하지 못한 응답이 발생했습니다. 외부 반영 여부를 확인하기 전에는 다시 적용하지 마세요.";
      // The RPC fails closed when a gateway job already exists. That lets us
      // close a genuinely pre-write exception without overwriting an external
      // mutation whose outcome still has to be reconciled by the gateway.
      const recorded = await recordPrewriteFailure(task, null, safeMessage);
      results.push({
        id: task.id,
        channel: task.channel,
        ok: false,
        message: recorded
          ? "재고 요청을 외부 전송 전에 안전하게 종료했습니다. 원인을 확인한 뒤 다시 적용해 주세요."
          : safeMessage,
        ...(!recorded ? { reconciliationRequired: true } : {}),
      });
    }
  };
  const inventoryConcurrency = 3;
  for (let offset = 0; offset < currentTasks.length; offset += inventoryConcurrency) {
    await Promise.all(currentTasks.slice(offset, offset + inventoryConcurrency).map(processTaskSafely));
  }
  const taskOrder = new Map(tasks.map((task, index) => [task.id, index]));
  results.sort((left, right) => (taskOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (taskOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));

  const { data: refreshedRun } = runId
    ? await admin.userClient.rpc("sellerpilot_get_inventory_sync_run", {
      p_product_id: parsedId.data,
      p_run_id: runId,
    })
    : { data: null };
  const refreshedRunRecord = refreshedRun && typeof refreshedRun === "object" && !Array.isArray(refreshedRun)
    ? refreshedRun as Record<string, unknown>
    : null;
  const remainingPendingCount = Array.isArray(refreshedRunRecord?.tasks)
    ? refreshedRunRecord.tasks.filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item)
      && ((item as Record<string, unknown>).status === "pending" || !(item as Record<string, unknown>).status)).length
    : Math.max(0, pendingTasks.length - currentTasks.length);
  return NextResponse.json({
    ok: results.every((item) => item.ok) && remainingPendingCount === 0,
    sync: refreshedRun ?? started,
    results,
    continuationRequired: remainingPendingCount > 0,
    remainingPendingCount,
    message: remainingPendingCount > 0
      ? `${currentTasks.length}개 채널 요청을 처리했고 ${remainingPendingCount}개 채널을 다음 안전 배치에서 계속 적용합니다.`
      : undefined,
  }, {
    status: results.some((item) => !item.ok) ? 207 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
