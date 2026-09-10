export const TEMU_FINAL_CREATE_PAYLOAD_RECORD_RPC =
  "sellerpilot_service_record_temu_final_create_payload_v1";
export const temuFinalCreatePayloadContract =
  "temu_final_create_payload_binding_v1" as const;

export type TemuFinalCreatePayloadBinding = {
  contract: typeof temuFinalCreatePayloadContract;
  finalPayloadId: string;
  sourceId: string;
  attemptId: string;
  finalArgumentsSha256: string;
  assetBytesSha256: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export async function bindTemuFinalCreatePayloadBeforeEnqueue(input: {
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
  ownerId: string;
  productId: string;
  credentialId: string;
  attemptId: string;
  sourceId: string;
  requestFingerprint: string;
  finalArguments: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const unbound = structuredClone(input.finalArguments);
  delete unbound.sellerpilotTemuFinalPayload;
  const result = await input.rpc(TEMU_FINAL_CREATE_PAYLOAD_RECORD_RPC, {
    p_owner_id: input.ownerId,
    p_product_id: input.productId,
    p_credential_id: input.credentialId,
    p_attempt_id: input.attemptId,
    p_source_id: input.sourceId,
    p_request_fingerprint: input.requestFingerprint,
    p_final_arguments: unbound,
  });
  const value = record(result.data);
  if (result.error
    || value?.contract !== temuFinalCreatePayloadContract
    || !uuid(value.finalPayloadId)
    || value.sourceId !== input.sourceId
    || value.attemptId !== input.attemptId
    || !digest(value.finalArgumentsSha256)
    || !digest(value.assetBytesSha256)) {
    throw new Error("TEMU_FINAL_CREATE_PAYLOAD_UNAVAILABLE");
  }
  return {
    ...unbound,
    sellerpilotTemuFinalPayload: Object.freeze({
      contract: temuFinalCreatePayloadContract,
      finalPayloadId: value.finalPayloadId,
      sourceId: value.sourceId,
      attemptId: value.attemptId,
      finalArgumentsSha256: value.finalArgumentsSha256,
      assetBytesSha256: value.assetBytesSha256,
    } satisfies TemuFinalCreatePayloadBinding),
  };
}
