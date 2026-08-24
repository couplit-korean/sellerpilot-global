import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { isActiveChannelKey } from "../../../../../lib/channels/catalog";
import { buildShipmentArguments } from "../../../../../lib/channels/shipment-draft";
import {
  remoteShipmentSuccessResult,
  shipmentLedgerWriteSucceeded,
  shipmentResultSummary,
  type ShipmentFulfillmentResult,
} from "../../../../../lib/order-shipment-integrity";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  confirmWrite: z.literal(true),
  shipments: z.array(z.object({
    id: z.string().uuid(),
    carrierCode: z.string().trim().min(1).max(40),
    trackingNumber: z.string().trim().max(100),
  })).min(1).max(20),
});

type OrderContext = {
  id: string;
  external_order_id: string;
  channel_key: string;
  status: string;
  provider_context?: Record<string, unknown> | null;
};
type Credential = { id: string; channel: string; environment: string; status: string };

function failedShipmentResult(input: {
  id: string;
  channel: string;
  message: string;
  ledgerRecorded?: boolean;
}): ShipmentFulfillmentResult {
  const ledgerRecorded = input.ledgerRecorded === true;
  return {
    id: input.id,
    channel: input.channel,
    ok: false,
    status: "failed",
    remoteSucceeded: false,
    ledgerRecorded,
    reconciliationRequired: false,
    message: ledgerRecorded
      ? input.message
      : `${input.message} 내부 실패 이력 저장도 확인되지 않아 운영 원장을 점검해 주세요.`,
  };
}

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
    admin.userClient.rpc("sellerpilot_get_order_fulfillment_context_v2", { p_ids: ids }),
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
  const results: ShipmentFulfillmentResult[] = [];

  const recordFailure = async (input: { id: string; carrier: string; message: string }) => {
    try {
      const { data, error } = await admin.serviceClient.rpc("sellerpilot_service_record_order_shipment_failure", {
        p_actor_id: admin.user.id,
        p_id: input.id,
        p_carrier: input.carrier,
        p_error: input.message,
      });
      return shipmentLedgerWriteSucceeded(data, error);
    } catch {
      return false;
    }
  };

  for (const shipment of parsed.data.shipments) {
    const order = orders.get(shipment.id);
    if (!order || !isActiveChannelKey(order.channel_key)) {
      results.push(failedShipmentResult({ id: shipment.id, channel: "unknown", message: "실주문 원장에서 주문을 찾지 못했습니다." }));
      continue;
    }
    const credential = credentials.get(order.channel_key);
    if (!credential) {
      const message = "활성 운영 채널 키가 없습니다.";
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
      continue;
    }
    if (!["paid", "ready_to_ship"].includes(order.status)) {
      const message = "결제완료 또는 출고대기 주문만 발송할 수 있습니다.";
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
      continue;
    }
    if (order.channel_key !== "lazada" && !shipment.trackingNumber) {
      const message = "이 채널의 실제 운송장번호를 입력해 주세요.";
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
      continue;
    }

    try {
      const operationArguments = buildShipmentArguments({
        channel: order.channel_key,
        externalOrderId: order.external_order_id,
        carrierCode: shipment.carrierCode,
        trackingNumber: shipment.trackingNumber,
        providerContext: order.provider_context && typeof order.provider_context === "object" && !Array.isArray(order.provider_context)
          ? order.provider_context
          : undefined,
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
      const remotePayload = await remoteResponse.json().catch(() => ({})) as { message?: string; safeMessage?: string; remoteId?: string };
      if (!remoteResponse.ok) {
        const message = safeMessage(order.channel_key, remoteResponse.status, remotePayload.message ?? remotePayload.safeMessage);
        results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
        continue;
      }
      const recordedTrackingNumber = order.channel_key === "lazada" && remotePayload.remoteId
        ? remotePayload.remoteId
        : shipment.trackingNumber;
      let ledgerData: unknown = null;
      let ledgerError: unknown = null;
      try {
        const ledgerWrite = await admin.userClient.rpc("sellerpilot_record_order_shipment", {
          p_id: shipment.id,
          p_carrier: shipment.carrierCode,
          p_tracking: recordedTrackingNumber,
          p_success: true,
          p_error: null,
        });
        ledgerData = ledgerWrite.data;
        ledgerError = ledgerWrite.error;
      } catch (error) {
        ledgerError = error;
      }
      results.push(remoteShipmentSuccessResult({
        id: shipment.id,
        channel: order.channel_key,
        ledgerData,
        ledgerError,
      }));
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const message = raw.startsWith("SHIPMENT_PACKAGE_DETAILS_REQUIRED")
        ? "Lazada는 주문 품목·패키지 정보를 먼저 조회해야 하므로 현재 일괄 운송장 처리에서 제외됩니다."
        : raw.startsWith("SHIPMENT_CHANNEL_UNAVAILABLE")
          ? "이 채널은 판매자 발송 API 권한이 아직 연결되지 않았습니다."
          : "판매채널 발송 요청 중 안전하게 처리된 오류가 발생했습니다.";
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
    }
  }

  const { succeeded, failed, reconciliationRequired } = shipmentResultSummary(results);
  return NextResponse.json({
    ok: succeeded === results.length && reconciliationRequired === 0,
    succeeded,
    failed,
    reconciliationRequired,
    results,
    message: `${results.length}건 중 ${succeeded}건 완료 · ${failed}건 실패 · ${reconciliationRequired}건 원장 조정 필요`,
  }, { status: succeeded === results.length && reconciliationRequired === 0 ? 200 : 207, headers: { "cache-control": "no-store, max-age=0" } });
}
