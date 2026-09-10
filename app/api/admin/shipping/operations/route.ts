import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../lib/admin-api";
import { isActiveChannelKey } from "../../../../../lib/channels/catalog";
import { shippingOperationNames } from "../../../../../lib/shipping/contracts";
import { shippingOperationRelease } from "../../../../../lib/shipping/availability";
import { shippingWriteResource } from "../../../../../lib/shipping/write-resource";
import { executeViaShippingGateway } from "../../../../../lib/shipping/gateway";
import {
  ChannelGatewayInProgressError,
  ChannelGatewayReconciliationRequiredError,
  ChannelGatewayRemoteFailedError,
  ChannelGatewayCredentialUnattestedError,
} from "../../../../../lib/channels/gateway-job-runtime";
export const runtime = "nodejs";
export const maxDuration = 300;
const schema = z
  .object({
    credentialId: z.string().uuid(),
    channel: z.string().refine(isActiveChannelKey),
    operation: z.enum(shippingOperationNames),
    idempotencyKey: z.string().min(1).max(240),
    confirmWrite: z.boolean().default(false),
    orderId: z.string().uuid().optional(),
    shipmentCarrier: z.string().trim().max(40).optional(),
    shipmentTracking: z.string().trim().max(100).optional(),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { message: "배송 전용 요청 형식을 확인해 주세요." },
      { status: 400 },
    );
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const input = parsed.data;
  const channel = input.channel;
  if (!isActiveChannelKey(channel))
    return NextResponse.json(
      { message: "배송 채널이 올바르지 않습니다." },
      { status: 400 },
    );
  const write = input.operation.startsWith("shipment.");
  if (write && !input.confirmWrite)
    return NextResponse.json(
      { message: "발송 실행 확인이 필요합니다." },
      { status: 428 },
    );
  if (write && (!input.orderId || !input.shipmentCarrier))
    return NextResponse.json(
      { message: "출고 원장 ID와 택배사가 필요합니다." },
      { status: 409 },
    );
  const release = shippingOperationRelease(channel, input.operation);
  if (!release.available)
    return NextResponse.json(
      { message: release.reason, mode: release.mode },
      { status: 409 },
    );
  const { data: credentials, error: credentialError } =
    await admin.userClient.rpc("sellerpilot_list_credentials");
  const credential = Array.isArray(credentials)
    ? credentials.find(
        (row) =>
          row?.id === input.credentialId &&
          row.channel === channel &&
          row.environment === "production" &&
          row.status === "active",
      )
    : null;
  if (credentialError || !credential)
    return NextResponse.json(
      { message: "배송 채널의 활성 인증 연결을 확인하지 못했습니다." },
      { status: 409 },
    );
  const fingerprint = createHash("sha256")
    .update(
      canonical({
        channel,
        operation: input.operation,
        arguments: input.arguments,
        orderId: input.orderId ?? null,
        shipmentCarrier: input.shipmentCarrier ?? null,
        shipmentTracking: input.shipmentTracking ?? null,
      }),
    )
    .digest("hex");
  const { data: claim, error } = await admin.userClient.rpc(
    "sellerpilot_claim_channel_operation",
    {
      p_credential_id: input.credentialId,
      p_channel: channel,
      p_operation: input.operation,
      p_idempotency_key: input.idempotencyKey,
      p_request_fingerprint: fingerprint,
    },
  );
  if (error || !claim || typeof claim.attempt_id !== "string")
    return NextResponse.json(
      { message: "배송 작업의 중복 방지 원장을 확인하지 못했습니다." },
      { status: 409 },
    );
  if (claim.duplicate === true) {
    const { data: receipt, error: receiptError } = await admin.userClient.rpc(
      "sellerpilot_get_shipping_attempt_result",
      {
        p_attempt_id: claim.attempt_id,
        p_credential_id: input.credentialId,
        p_channel: channel,
        p_operation: input.operation,
      },
    );
    const response = receipt?.response;
    if (
      !receiptError &&
      receipt?.status === "succeeded" &&
      response?.channel === channel &&
      response.operation === input.operation &&
      typeof response.ok === "boolean"
    )
      return NextResponse.json(
        { ...response, duplicate: true, attemptId: claim.attempt_id },
        { status: response.ok ? 200 : 422 },
      );
    const reconcile =
      receipt?.status === "reconciliation_required" ||
      ["reconciliation_required", "manual_required"].includes(claim.status);
    const failed =
      receipt?.status === "failed" ||
      receipt?.status === "cancelled" ||
      claim.status === "failed";
    return NextResponse.json(
      {
        ok: false,
        inProgress: !reconcile && !failed,
        reconciliationRequired: reconcile,
        attemptId: claim.attempt_id,
        message: failed
          ? "이 배송 작업은 실패했습니다. 원장 확인 후 다시 처리해 주세요."
          : "기존 배송 작업의 결과를 확인 중입니다.",
      },
      { status: reconcile || failed ? 409 : 202 },
    );
  }
  try {
    const { result } = await executeViaShippingGateway({
      serviceClient: admin.serviceClient,
      credentialId: input.credentialId,
      attemptId: claim.attempt_id,
      channel,
      operation: input.operation,
      arguments: input.arguments,
      timeoutMs: 60_000,
      ...(write
        ? {
            writeResource: {
              ...shippingWriteResource(channel, input.orderId!),
              requestFingerprint: fingerprint,
              carrierCode: input.shipmentCarrier,
              trackingNumber: input.shipmentTracking,
            },
          }
        : {}),
    });
    return NextResponse.json(
      { ...result, attemptId: claim.attempt_id },
      { status: result.ok ? 200 : 422 },
    );
  } catch (error) {
    if (error instanceof ChannelGatewayInProgressError)
      return NextResponse.json(
        {
          ok: false,
          inProgress: true,
          jobId: error.jobId,
          attemptId: error.attemptId,
          message: "배송 작업을 접수했고 결과를 확인 중입니다.",
        },
        { status: 202 },
      );
    if (error instanceof ChannelGatewayReconciliationRequiredError)
      return NextResponse.json(
        {
          ok: false,
          reconciliationRequired: true,
          jobId: error.jobId,
          message: "외부 발송 결과 확인이 필요합니다.",
        },
        { status: 409 },
      );
    if (error instanceof ChannelGatewayRemoteFailedError)
      return NextResponse.json(
        { ok: false, message: "배송 채널 작업이 실패했습니다." },
        { status: 422 },
      );
    if (error instanceof ChannelGatewayCredentialUnattestedError)
      return NextResponse.json(
        { ok: false, message: "배송 채널의 판매자 계정 인증이 필요합니다." },
        { status: 409 },
      );
    return NextResponse.json(
      {
        ok: false,
        inProgress: true,
        attemptId: claim.attempt_id,
        message: "배송 작업의 접수·저장 상태를 확인해야 합니다.",
      },
      { status: 202 },
    );
  }
}
