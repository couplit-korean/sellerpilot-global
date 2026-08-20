import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { isActiveChannelKey } from "../../../../../lib/channels/catalog";
import { buildShipmentArguments } from "../../../../../lib/channels/shipment-draft";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  confirmWrite: z.literal(true),
  shipments: z.array(z.object({
    id: z.string().uuid(),
    carrierCode: z.string().trim().min(1).max(40),
    trackingNumber: z.string().trim().min(1).max(100),
  })).min(1).max(20),
});

type OrderContext = { id: string; external_order_id: string; channel_key: string; status: string };
type Credential = { id: string; channel: string; environment: string; status: string };

function safeMessage(channel: string, status: number, fallback?: string) {
  if (status === 409 && fallback) return fallback;
  if (status === 428) return "외부 발송 처리 확인이 필요합니다.";
  if (status === 422) return fallback || `${channel} 발송 요청을 판매자센터에서 확인해 주세요.`;
  return fallback || `${channel} 발송 처리를 완료하지 못했습니다.`;
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "출고 주문·택배사·운송장 정보를 확인해 주세요." }, { status: 400 });

  const ids = parsed.data.shipments.map((shipment) => shipment.id);
  const [{ data: orderRows, error: orderError }, { data: credentialRows, error: credentialError }] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_order_fulfillment_context", { p_ids: ids }),
    admin.userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (orderError || credentialError) return NextResponse.json({ message: "출고 대상 주문과 채널 연결을 확인하지 못했습니다." }, { status: 500 });

  const orders = new Map((Array.isArray(orderRows) ? orderRows : [])
    .filter((row): row is OrderContext => Boolean(row) && typeof row === "object" && typeof row.id === "string")
    .map((row) => [row.id, row]));
  const credentials = new Map((Array.isArray(credentialRows) ? credentialRows : [])
    .filter((row): row is Credential => Boolean(row) && typeof row === "object" && typeof row.id === "string" && row.environment === "production" && row.status === "active")
    .map((row) => [row.channel, row]));
  const authorization = request.headers.get("authorization") ?? "";
  const operationUrl = new URL("/api/admin/channel-operations", request.url);
  const results: Array<{ id: string; channel: string; ok: boolean; message: string }> = [];

  for (const shipment of parsed.data.shipments) {
    const order = orders.get(shipment.id);
    if (!order || !isActiveChannelKey(order.channel_key)) {
      results.push({ id: shipment.id, channel: "unknown", ok: false, message: "실주문 원장에서 주문을 찾지 못했습니다." });
      continue;
    }
    const credential = credentials.get(order.channel_key);
    if (!credential) {
      results.push({ id: shipment.id, channel: order.channel_key, ok: false, message: "활성 운영 채널 키가 없습니다." });
      continue;
    }
    if (!["paid", "ready_to_ship"].includes(order.status)) {
      results.push({ id: shipment.id, channel: order.channel_key, ok: false, message: "결제완료 또는 출고대기 주문만 발송할 수 있습니다." });
      continue;
    }

    try {
      const operationArguments = buildShipmentArguments({
        channel: order.channel_key,
        externalOrderId: order.external_order_id,
        carrierCode: shipment.carrierCode,
        trackingNumber: shipment.trackingNumber,
      });
      const idempotencyKey = `shipment-${shipment.id}-${createHash("sha256").update(`${shipment.carrierCode}:${shipment.trackingNumber}`).digest("hex").slice(0, 24)}`;
      const remoteResponse = await fetch(operationUrl, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          credentialId: credential.id,
          channel: order.channel_key,
          operation: "shipment.confirm",
          idempotencyKey,
          confirmWrite: true,
          arguments: operationArguments,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const remotePayload = await remoteResponse.json().catch(() => ({})) as { message?: string; safeMessage?: string };
      const ok = remoteResponse.ok;
      const message = ok ? "판매채널 발송 처리와 원장 갱신이 완료됐습니다." : safeMessage(order.channel_key, remoteResponse.status, remotePayload.message ?? remotePayload.safeMessage);
      await admin.userClient.rpc("sellerpilot_record_order_shipment", {
        p_id: shipment.id,
        p_carrier: shipment.carrierCode,
        p_tracking: shipment.trackingNumber,
        p_success: ok,
        p_error: ok ? null : message,
      });
      results.push({ id: shipment.id, channel: order.channel_key, ok, message });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const message = raw.startsWith("SHIPMENT_PACKAGE_DETAILS_REQUIRED")
        ? "Lazada는 주문 품목·패키지 정보를 먼저 조회해야 하므로 현재 일괄 운송장 처리에서 제외됩니다."
        : raw.startsWith("SHIPMENT_CHANNEL_UNAVAILABLE")
          ? "이 채널은 판매자 발송 API 권한이 아직 연결되지 않았습니다."
          : "판매채널 발송 요청 중 안전하게 처리된 오류가 발생했습니다.";
      await admin.userClient.rpc("sellerpilot_record_order_shipment", {
        p_id: shipment.id,
        p_carrier: shipment.carrierCode,
        p_tracking: shipment.trackingNumber,
        p_success: false,
        p_error: message,
      });
      results.push({ id: shipment.id, channel: order.channel_key, ok: false, message });
    }
  }

  const succeeded = results.filter((result) => result.ok).length;
  return NextResponse.json({
    ok: succeeded === results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
    message: `${results.length}건 중 ${succeeded}건의 판매채널 발송 처리를 완료했습니다.`,
  }, { status: succeeded === results.length ? 200 : 207, headers: { "cache-control": "no-store, max-age=0" } });
}
