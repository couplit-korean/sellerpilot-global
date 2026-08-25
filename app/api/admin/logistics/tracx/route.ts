import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import {
  tracxOperationNames,
  tracxOperationArguments,
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

  let normalizedArguments: Record<string, unknown>;
  try {
    normalizedArguments = tracxOperationArguments(parsed.data.operation, parsed.data.arguments);
  } catch (error) {
    return NextResponse.json({ message: safeError(error) }, { status: 400 });
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
    .update(canonicalJson({ operation: parsed.data.operation, arguments: normalizedArguments }))
    .digest("hex");
  const isWrite = tracxWriteOperations.has(parsed.data.operation);
  const resourceIdentity = parsed.data.operation === "orders.cancel"
    ? String(normalizedArguments.shippingNo ?? "")
    : parsed.data.operation === "inquiries.reply"
      ? String(normalizedArguments.ticket_id ?? "")
      : "";
  const resourceKey = isWrite
    ? createHash("sha256").update(`tracx\u0000${parsed.data.operation}\u0000${resourceIdentity}`).digest("hex")
    : "";
  const { data: claimData, error: claimError } = isWrite
    ? await admin.serviceClient.rpc("sellerpilot_service_claim_tracx_mutation", {
        p_actor_id: admin.user.id,
        p_credential_id: parsed.data.credentialId,
        p_operation: parsed.data.operation,
        p_idempotency_key: parsed.data.idempotencyKey,
        p_request_fingerprint: requestFingerprint,
        p_resource_key: resourceKey,
      })
    : await admin.userClient.rpc("sellerpilot_claim_tracx_operation", {
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
    const inProgress = claim.status === "running";
    const reconciliationRequired = claim.status === "reconciliation_required";
    return NextResponse.json({
      ok: claim.status === "succeeded",
      duplicate: true,
      inProgress,
      reconciliationRequired,
      attemptId,
      status: claim.status,
      message: typeof claim.safe_message === "string" ? claim.safe_message : "같은 SmartShip 작업이 이미 접수됐습니다.",
      remoteCode: typeof claim.remote_code === "string" ? claim.remote_code : undefined,
    }, { status: claim.status === "succeeded" ? 200 : inProgress ? 202 : 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const { data: secretPayload, error: secretError } = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: parsed.data.credentialId,
  });
  if (secretError || !secretPayload || typeof secretPayload !== "object" || Array.isArray(secretPayload)) {
    if (isWrite) {
      await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_mutation", {
        p_attempt_id: attemptId,
        p_request_fingerprint: requestFingerprint,
        p_outcome: "failed",
        p_remote_code: "CREDENTIAL_MISSING",
        p_safe_message: "SmartShip TxAPI Key를 Vault에서 읽지 못했습니다.",
      });
    } else {
      await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_operation", {
        p_attempt_id: attemptId,
        p_success: false,
        p_remote_code: "CREDENTIAL_MISSING",
        p_safe_message: "SmartShip TxAPI Key를 Vault에서 읽지 못했습니다.",
      });
    }
    return NextResponse.json({ message: "SmartShip TxAPI Key를 Vault에서 읽지 못했습니다.", attemptId }, { status: 404 });
  }

  if (isWrite) {
    const { data: began, error: beginError } = await admin.serviceClient.rpc("sellerpilot_service_begin_tracx_mutation", {
      p_attempt_id: attemptId,
      p_request_fingerprint: requestFingerprint,
    });
    if (beginError || began !== true) {
      return NextResponse.json({ message: "SmartShip 원격 쓰기 직전 안전 원장을 확정하지 못했습니다.", attemptId }, { status: 409 });
    }
  }

  try {
    const remote = await tracxRequest({
      payload: secretPayload as Record<string, unknown>,
      operation: parsed.data.operation,
      arguments: normalizedArguments,
    });
    const ok = tracxOperationSucceeded(remote, parsed.data.operation);
    const code = tracxResultCode(remote.data);
    const providerMessage = tracxResultMessage(remote.data);
    const explicitRejection = !ok && (
      (remote.response.status >= 400 && remote.response.status < 500)
      || (remote.response.ok && code !== null)
    );
    const message = ok
      ? "SmartShip TxAPI 작업이 완료됐습니다."
      : `SmartShip TxAPI가 작업을 거절했습니다${code === null ? ` · HTTP ${remote.response.status}` : ` · 결과코드 ${code}`}${providerMessage ? ` · ${providerMessage}` : ""}`;
    if (isWrite && !ok && !explicitRejection) {
      await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_mutation", {
        p_attempt_id: attemptId,
        p_request_fingerprint: requestFingerprint,
        p_outcome: "reconciliation_required",
        p_remote_code: code === null ? `HTTP_${remote.response.status}` : String(code),
        p_safe_message: "SmartShip 요청 결과를 확정할 수 없어 수동 확인이 필요합니다.",
      });
      return NextResponse.json({ message, attemptId, reconciliationRequired: true }, { status: 409 });
    }
    let completion = isWrite
      ? await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_mutation", {
          p_attempt_id: attemptId,
          p_request_fingerprint: requestFingerprint,
          p_outcome: ok ? "succeeded" : "failed",
          p_remote_code: code === null ? `HTTP_${remote.response.status}` : String(code),
          p_safe_message: message,
        })
      : await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_operation", {
          p_attempt_id: attemptId,
          p_success: ok,
          p_remote_code: code === null ? `HTTP_${remote.response.status}` : String(code),
          p_safe_message: message,
        });
    if (isWrite && (completion.error || completion.data !== true)) {
      completion = await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_mutation", {
        p_attempt_id: attemptId,
        p_request_fingerprint: requestFingerprint,
        p_outcome: ok ? "succeeded" : "failed",
        p_remote_code: code === null ? `HTTP_${remote.response.status}` : String(code),
        p_safe_message: message,
      });
    }
    const { data: completed, error: completeError } = completion;
    if (completeError || completed !== true) {
      if (isWrite) {
        await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_mutation", {
          p_attempt_id: attemptId,
          p_request_fingerprint: requestFingerprint,
          p_outcome: "reconciliation_required",
          p_remote_code: "LEDGER_STORE_UNCERTAIN",
          p_safe_message: "SmartShip 응답 원장을 확정하지 못해 수동 확인이 필요합니다.",
        });
      }
      return NextResponse.json({
        message: "SmartShip 응답은 받았지만 작업 원장을 확정하지 못했습니다.",
        attemptId,
        reconciliationRequired: isWrite,
      }, { status: 500 });
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
    if (isWrite) {
      await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_mutation", {
        p_attempt_id: attemptId,
        p_request_fingerprint: requestFingerprint,
        p_outcome: "reconciliation_required",
        p_remote_code: "PROVIDER_OUTCOME_UNKNOWN",
        p_safe_message: `${message} 요청 접수 여부를 수동 확인해야 합니다.`,
      });
      return NextResponse.json({ message, attemptId, reconciliationRequired: true }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    await admin.serviceClient.rpc("sellerpilot_service_complete_tracx_operation", {
      p_attempt_id: attemptId,
      p_success: false,
      p_remote_code: "CONNECTOR_ERROR",
      p_safe_message: message,
    });
    return NextResponse.json({ message, attemptId }, { status: 422, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
