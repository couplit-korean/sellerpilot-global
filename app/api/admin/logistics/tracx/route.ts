import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import {
  tracxOperationNames,
  tracxOperationSucceeded,
  tracxRequest,
  tracxResultCode,
  tracxResultMessage,
  tracxWriteOperations,
} from "../../../../../lib/logistics/tracx";

export const runtime = "nodejs";

const schema = z.object({
  credentialId: z.string().uuid(),
  operation: z.enum(tracxOperationNames),
  idempotencyKey: z.string().trim().min(16).max(160),
  confirmWrite: z.boolean().default(false),
  arguments: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 32_000, "payload too large"),
});

type CredentialMetadata = {
  id: string;
  channel: string;
  environment: string;
  status: string;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("TRACX_ARGUMENT_INVALID:")) {
    return `SmartShip 작업값을 확인해 주세요 · ${message.split(":")[1]}`;
  }
  if (message === "TRACX_CREDENTIALS_MISSING") return "SmartShip TxAPI Key가 Vault에 없습니다.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "SmartShip 응답 제한시간(15초)을 초과했습니다.";
  }
  return "SmartShip TxAPI 작업 중 안전하게 처리된 오류가 발생했습니다.";
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "SmartShip 작업 요청 형식이 올바르지 않습니다." }, { status: 400 });
  if (tracxWriteOperations.has(parsed.data.operation) && !parsed.data.confirmWrite) {
    return NextResponse.json({ message: "SmartShip 외부 데이터를 변경하는 작업은 실행 확인이 필요합니다." }, { status: 428 });
  }

  const { data: credentialRows, error: credentialError } = await admin.userClient.rpc("sellerpilot_list_credentials");
  const credential = (Array.isArray(credentialRows) ? credentialRows : [])
    .find((row): row is CredentialMetadata => Boolean(row)
      && typeof row === "object"
      && "id" in row
      && row.id === parsed.data.credentialId
      && "channel" in row
      && row.channel === "tracx"
      && "environment" in row
      && row.environment === "production"
      && "status" in row
      && row.status === "active");
  if (credentialError || !credential) {
    return NextResponse.json({ message: "활성 SmartShip 운영 키를 확인하지 못했습니다." }, { status: 409 });
  }

  const requestFingerprint = createHash("sha256")
    .update(canonicalJson({ operation: parsed.data.operation, arguments: parsed.data.arguments }))
    .digest("hex");
  const { data: claimData, error: claimError } = await admin.userClient.rpc("sellerpilot_claim_tracx_operation", {
    p_credential_id: parsed.data.credentialId,
    p_operation: parsed.data.operation,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_request_fingerprint: requestFingerprint,
  });
  if (claimError || !claimData || typeof claimData !== "object" || Array.isArray(claimData)) {
    return NextResponse.json({ message: "SmartShip 중복 방지 작업을 생성하지 못했습니다." }, { status: 409 });
  }
  const claim = claimData as Record<string, unknown>;
  const attemptId = typeof claim.attempt_id === "string" ? claim.attempt_id : "";
  if (!attemptId) return NextResponse.json({ message: "SmartShip 작업 추적 ID를 만들지 못했습니다." }, { status: 500 });
  if (claim.duplicate === true) {
    return NextResponse.json({
      ok: claim.status === "succeeded",
      duplicate: true,
      attemptId,
      status: claim.status,
      message: typeof claim.safe_message === "string" ? claim.safe_message : "같은 SmartShip 작업이 이미 접수됐습니다.",
      remoteCode: typeof claim.remote_code === "string" ? claim.remote_code : undefined,
    }, { status: claim.status === "succeeded" ? 200 : 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const { data: secretPayload, error: secretError } = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: parsed.data.credentialId,
  });
  if (secretError || !secretPayload || typeof secretPayload !== "object" || Array.isArray(secretPayload)) {
    await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_operation", {
      p_attempt_id: attemptId,
      p_success: false,
      p_remote_code: "CREDENTIAL_MISSING",
      p_safe_message: "SmartShip TxAPI Key를 Vault에서 읽지 못했습니다.",
    });
    return NextResponse.json({ message: "SmartShip TxAPI Key를 Vault에서 읽지 못했습니다.", attemptId }, { status: 404 });
  }

  try {
    const remote = await tracxRequest({
      payload: secretPayload as Record<string, unknown>,
      operation: parsed.data.operation,
      arguments: parsed.data.arguments,
    });
    const ok = tracxOperationSucceeded(remote, parsed.data.operation);
    const code = tracxResultCode(remote.data);
    const providerMessage = tracxResultMessage(remote.data);
    const message = ok
      ? "SmartShip TxAPI 작업이 완료됐습니다."
      : `SmartShip TxAPI가 작업을 거절했습니다${code === null ? ` · HTTP ${remote.response.status}` : ` · 결과코드 ${code}`}${providerMessage ? ` · ${providerMessage}` : ""}`;
    const { data: completed, error: completeError } = await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_operation", {
      p_attempt_id: attemptId,
      p_success: ok,
      p_remote_code: code === null ? `HTTP_${remote.response.status}` : String(code),
      p_safe_message: message,
    });
    if (completeError || completed !== true) {
      return NextResponse.json({ message: "SmartShip 응답은 받았지만 작업 원장을 확정하지 못했습니다.", attemptId }, { status: 500 });
    }
    return NextResponse.json({
      ok,
      attemptId,
      message,
      resultCode: code,
      result: remote.data.ResultObject ?? null,
    }, { status: ok ? 200 : 422, headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    const message = safeError(error);
    await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_operation", {
      p_attempt_id: attemptId,
      p_success: false,
      p_remote_code: "CONNECTOR_ERROR",
      p_safe_message: message,
    });
    return NextResponse.json({ message, attemptId }, { status: 422, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
