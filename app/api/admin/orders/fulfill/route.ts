import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { isActiveChannelKey } from "../../../../../lib/channels/catalog";
import {
  buildShipmentAcknowledgeArguments,
  buildShipmentArguments,
  buildShipmentPreflightArguments,
  buildShipmentReadbackArguments,
  type ShipmentDraft,
} from "../../../../../lib/channels/shipment-draft";
import { shipmentWriteAvailability } from "../../../../../lib/channels/shipment-release";
import {
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
    tracxReferenceKind: z.enum(["packing_no", "reference_order_no"]).optional().default("packing_no"),
    tracxReference: z.string().trim().max(240).optional().default(""),
  // A paid order can require acknowledge, readback, and confirm in sequence.
  // Keep each server request to one three-order concurrency wave so the
  // documented 300 second function limit cannot be exceeded. The browser
  // batches larger selections into multiple independently resumable calls.
  })).min(1).max(3),
});

type OrderContext = {
  id: string;
  external_order_id: string;
  channel_key: string;
  status: string;
  provider_context?: Record<string, unknown> | null;
};
type Credential = { id: string; channel: string; environment: string; status: string };
type ShipmentInput = z.infer<typeof schema>["shipments"][number];
type ShipmentOperation = "orders.get" | "shipment.acknowledge" | "shipment.confirm";
type ChannelOperationPayload = {
  ok?: boolean;
  message?: string;
  safeMessage?: string;
  inProgress?: boolean;
  reconciliationRequired?: boolean;
  manualRequired?: boolean;
  steps?: unknown[];
};
type ShipmentOperationOutcome =
  | { kind: "succeeded"; payload: ChannelOperationPayload }
  | { kind: "failed" | "in_progress" | "reconciliation_required"; message: string };

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

function deferredShipmentResult(input: { id: string; channel: string; reconciliationRequired: boolean; message: string }): ShipmentFulfillmentResult {
  return {
    id: input.id,
    channel: input.channel,
    ok: false,
    status: input.reconciliationRequired ? "reconciliation_required" : "in_progress",
    remoteSucceeded: false,
    ledgerRecorded: false,
    reconciliationRequired: input.reconciliationRequired,
    message: input.message,
  };
}

function safeMessage(channel: string, status: number, fallback?: string) {
  if (status === 409 && fallback) return fallback;
  if (status === 428) return "외부 발송 처리 확인이 필요합니다.";
  if (status === 422) return fallback || `${channel} 발송 요청을 판매자센터에서 확인해 주세요.`;
  return fallback || `${channel} 발송 처리를 완료하지 못했습니다.`;
}

function localShipmentErrorMessage(raw: string) {
  if (raw.startsWith("SHIPMENT_REMOTE_ID_REQUIRED") || raw.startsWith("SHIPMENT_REMOTE_ID_MISMATCH")) {
    return "동기화된 원격 주문 식별값의 종류가 발송 API와 일치하지 않아 요청을 차단했습니다. 주문을 다시 동기화해 주세요.";
  }
  if (raw.startsWith("SHIPMENT_FIELD_INVALID:shopee.shopId")) {
    return "Shopee 주문의 정확한 Shop ID가 동기화되지 않아 기본 상점으로의 오발송을 차단했습니다. 해당 Shop으로 주문을 다시 동기화해 주세요.";
  }
  if (raw.startsWith("SHOPEE_SHIPPING_MODE_SELECTION_REQUIRED")) {
    return "Shopee가 이 주문에 픽업 또는 드롭오프 선택을 요구합니다. 확인되지 않은 장소·시간값을 만들지 않고 자동 발송을 차단했습니다.";
  }
  if (raw.startsWith("SHOPEE_SHIPPING_PARAMETER_")) {
    return "Shopee 배송 파라미터 응답에서 안전하게 사용할 수 있는 발송 방식을 확정하지 못했습니다.";
  }
  if (raw.startsWith("SHIPMENT_PACKAGE_DETAILS_REQUIRED")) {
    return "Lazada는 주문 품목·패키지 정보를 먼저 조회해야 하므로 현재 일괄 운송장 처리에서 제외됩니다.";
  }
  if (raw.startsWith("SHIPMENT_CHANNEL_UNAVAILABLE")) {
    return "이 채널은 판매자 발송 API 권한이 아직 연결되지 않았습니다.";
  }
  return "판매채널에 보내기 전 발송 정보 검증을 통과하지 못했습니다.";
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "출고 주문·택배사·운송장 정보를 확인해 주세요." }, { status: 400 });

  const ids = parsed.data.shipments.map((shipment) => shipment.id);
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ message: "같은 주문을 한 요청에서 중복 출고할 수 없습니다." }, { status: 400 });
  }
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

  const executeShipmentOperation = async (input: {
    credential: Credential;
    order: OrderContext;
    shipment: z.infer<typeof schema>["shipments"][number];
    operation: ShipmentOperation;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    providerMutation: boolean;
  }): Promise<ShipmentOperationOutcome> => {
    let remoteResponse: Response;
    try {
      remoteResponse = await fetch(operationUrl, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          credentialId: input.credential.id,
          channel: input.order.channel_key,
          operation: input.operation,
          idempotencyKey: input.idempotencyKey,
          confirmWrite: input.operation !== "orders.get",
          ...(input.operation !== "orders.get" ? {
            orderId: input.shipment.id,
            shipmentCarrier: input.shipment.carrierCode,
            shipmentTracking: input.shipment.trackingNumber,
          } : {}),
          arguments: input.arguments,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return input.providerMutation
        ? {
            kind: "reconciliation_required",
            message: "원격 발송 변경 요청의 접수 여부를 확정할 수 없어 재전송을 차단하고 원장 확인이 필요합니다.",
          }
        : {
            kind: "in_progress",
            message: "판매채널 사전 확인 작업의 서버 접수 여부를 확인 중입니다. 최종 운송장 전송은 아직 실행하지 않았습니다.",
          };
    }

    const remotePayload = await remoteResponse.json().catch(() => ({})) as ChannelOperationPayload;
    const message = safeMessage(
      input.order.channel_key,
      remoteResponse.status,
      remotePayload.message ?? remotePayload.safeMessage,
    );
    if (remoteResponse.status === 202 || remotePayload.inProgress === true) {
      return { kind: "in_progress", message };
    }
    if (remotePayload.reconciliationRequired === true || remotePayload.manualRequired === true) {
      return { kind: "reconciliation_required", message };
    }
    if (!remoteResponse.ok || remotePayload.ok === false) {
      return { kind: "failed", message };
    }
    return { kind: "succeeded", payload: remotePayload };
  };

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

  const processShipment = async (shipment: ShipmentInput) => {
    const order = orders.get(shipment.id);
    if (!order || !isActiveChannelKey(order.channel_key)) {
      results.push(failedShipmentResult({ id: shipment.id, channel: "unknown", message: "실주문 원장에서 주문을 찾지 못했습니다." }));
      return;
    }
    const shipmentAvailability = shipmentWriteAvailability(order.channel_key);
    if (!shipmentAvailability.available) {
      const message = `${shipmentAvailability.label} · ${shipmentAvailability.reason}`;
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
      return;
    }
    const credential = credentials.get(order.channel_key);
    if (!credential) {
      const message = "활성 운영 채널 키가 없습니다.";
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
      return;
    }
    if (!["paid", "ready_to_ship"].includes(order.status)) {
      const message = "결제완료 또는 출고대기 주문만 발송할 수 있습니다.";
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
      return;
    }
    if (order.channel_key !== "lazada" && !shipment.trackingNumber) {
      const message = "이 채널의 실제 운송장번호를 입력해 주세요.";
      results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
      return;
    }
    if (shipment.tracxReference) {
      const maxReferenceLength = shipment.tracxReferenceKind === "packing_no" ? 100 : 240;
      if (shipment.tracxReference.length > maxReferenceLength) {
        const message = "TracX 참조번호 형식을 확인해 주세요.";
        results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
        return;
      }
      if (!credentials.has("tracx")) {
        const message = "활성 운영 TracX 키가 없어 배송 참조번호를 연결하지 않았습니다.";
        results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
        return;
      }
      let bindingData: unknown = null;
      let bindingError: unknown = null;
      try {
        const bindingResult = await admin.userClient.rpc("sellerpilot_bind_tracx_order", {
          p_order_id: shipment.id,
          p_reference_kind: shipment.tracxReferenceKind,
          p_reference_value: shipment.tracxReference,
        });
        bindingData = bindingResult.data;
        bindingError = bindingResult.error;
      } catch {
        bindingError = true;
      }
      const binding = bindingData && typeof bindingData === "object" && !Array.isArray(bindingData)
        ? bindingData as Record<string, unknown>
        : null;
      if (bindingError || binding?.orderId !== shipment.id || binding.referenceValue !== shipment.tracxReference) {
        const message = "TracX 참조번호가 다른 주문과 충돌하거나 저장되지 않아 판매채널 발송을 시작하지 않았습니다.";
        results.push(failedShipmentResult({ id: shipment.id, channel: order.channel_key, message, ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }) }));
        return;
      }
    }

    const shipmentDraft: ShipmentDraft = {
      channel: order.channel_key,
      externalOrderId: order.external_order_id,
      carrierCode: shipment.carrierCode,
      trackingNumber: shipment.trackingNumber,
      providerContext: order.provider_context && typeof order.provider_context === "object" && !Array.isArray(order.provider_context)
        ? order.provider_context
        : undefined,
    };
    let acknowledgeArguments: Record<string, unknown> | null = null;
    let readbackArguments: Record<string, unknown> | null = null;
    let preflightArguments: Record<string, unknown> | null = null;
    let confirmArguments: Record<string, unknown> | null = null;
    try {
      acknowledgeArguments = buildShipmentAcknowledgeArguments(shipmentDraft);
      readbackArguments = buildShipmentReadbackArguments(shipmentDraft);
      preflightArguments = buildShipmentPreflightArguments(shipmentDraft);
      if (!preflightArguments) confirmArguments = buildShipmentArguments(shipmentDraft);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const message = localShipmentErrorMessage(raw);
      results.push(failedShipmentResult({
        id: shipment.id,
        channel: order.channel_key,
        message,
        ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }),
      }));
      return;
    }

    const idempotencyRoot = `shipment-${shipment.id}-${createHash("sha256").update(`${shipment.carrierCode}:${shipment.trackingNumber}`).digest("hex").slice(0, 24)}`;
    const stopForOutcome = async (outcome: ShipmentOperationOutcome) => {
      if (outcome.kind === "succeeded") return false;
      if (outcome.kind === "in_progress" || outcome.kind === "reconciliation_required") {
        results.push(deferredShipmentResult({
          id: shipment.id,
          channel: order.channel_key,
          reconciliationRequired: outcome.kind === "reconciliation_required",
          message: outcome.message,
        }));
        return true;
      }
      results.push(failedShipmentResult({
        id: shipment.id,
        channel: order.channel_key,
        message: outcome.message,
        ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message: outcome.message }),
      }));
      return true;
    };

    if (preflightArguments) {
      const preflightOutcome = await executeShipmentOperation({
        credential,
        order,
        shipment,
        operation: "shipment.acknowledge",
        arguments: preflightArguments,
        // Shopee's acknowledgement implementation is a read-only
        // get_shipping_parameter request. A per-request key avoids reusing a
        // duplicate-success response that intentionally omits provider steps;
        // the order resource fence still blocks concurrent or unresolved jobs.
        idempotencyKey: `${idempotencyRoot}-preflight-${randomUUID().slice(0, 8)}`,
        providerMutation: false,
      });
      if (preflightOutcome.kind !== "succeeded") {
        await stopForOutcome(preflightOutcome);
        return;
      }
      try {
        confirmArguments = buildShipmentArguments({
          ...shipmentDraft,
          shippingParameter: preflightOutcome.payload,
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : "";
        const message = localShipmentErrorMessage(raw);
        results.push(failedShipmentResult({
          id: shipment.id,
          channel: order.channel_key,
          message,
          ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }),
        }));
        return;
      }
    }

    if (order.status === "paid" && acknowledgeArguments) {
      const acknowledgeOutcome = await executeShipmentOperation({
        credential,
        order,
        shipment,
        operation: "shipment.acknowledge",
        arguments: acknowledgeArguments,
        idempotencyKey: `${idempotencyRoot}-ack`,
        providerMutation: true,
      });
      if (await stopForOutcome(acknowledgeOutcome)) return;
    }

    if (readbackArguments) {
      const readbackOutcome = await executeShipmentOperation({
        credential,
        order,
        shipment,
        operation: "orders.get",
        arguments: readbackArguments,
        idempotencyKey: `${idempotencyRoot}-receiver-readback`,
        providerMutation: false,
      });
      if (await stopForOutcome(readbackOutcome)) return;
    }

    if (!confirmArguments) {
      const message = "판매채널에 보내기 전 발송 요청을 확정하지 못했습니다.";
      results.push(failedShipmentResult({
        id: shipment.id,
        channel: order.channel_key,
        message,
        ledgerRecorded: await recordFailure({ id: shipment.id, carrier: shipment.carrierCode, message }),
      }));
      return;
    }

    const confirmOutcome = await executeShipmentOperation({
      credential,
      order,
      shipment,
      operation: "shipment.confirm",
      arguments: confirmArguments,
      idempotencyKey: `${idempotencyRoot}-confirm`,
      providerMutation: true,
    });
    if (await stopForOutcome(confirmOutcome)) return;
    results.push({
      id: shipment.id,
      channel: order.channel_key,
      ok: true,
      status: "succeeded",
      remoteSucceeded: true,
      ledgerRecorded: true,
      reconciliationRequired: false,
      message: "판매채널 발송 처리와 원장 갱신이 완료됐습니다.",
    });
  };

  // Each order retains its own sequential preflight/ack/readback/confirm fence.
  // The request schema limits this to a single three-order concurrency wave.
  const processShipmentSafely = async (shipment: ShipmentInput) => {
    try {
      await processShipment(shipment);
    } catch {
      const order = orders.get(shipment.id);
      results.push(deferredShipmentResult({
        id: shipment.id,
        channel: order?.channel_key ?? "unknown",
        reconciliationRequired: true,
        message: "출고 처리 중 예상하지 못한 응답이 발생했습니다. 외부 반영 여부를 확인하기 전에는 같은 요청을 다시 보내지 마세요.",
      }));
    }
  };
  const shipmentConcurrency = 3;
  for (let offset = 0; offset < parsed.data.shipments.length; offset += shipmentConcurrency) {
    await Promise.all(parsed.data.shipments.slice(offset, offset + shipmentConcurrency).map(processShipmentSafely));
  }
  const inputOrder = new Map(ids.map((id, index) => [id, index]));
  results.sort((left, right) => (inputOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (inputOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));

  const { succeeded, failed, inProgress, reconciliationRequired } = shipmentResultSummary(results);
  return NextResponse.json({
    ok: succeeded === results.length && reconciliationRequired === 0,
    succeeded,
    failed,
    inProgress,
    reconciliationRequired,
    results,
    message: `${results.length}건 중 ${succeeded}건 완료 · ${inProgress}건 진행 중 · ${failed}건 실패 · ${reconciliationRequired}건 원장 조정 필요`,
  }, { status: succeeded === results.length && reconciliationRequired === 0 ? 200 : 207, headers: { "cache-control": "no-store, max-age=0" } });
}
