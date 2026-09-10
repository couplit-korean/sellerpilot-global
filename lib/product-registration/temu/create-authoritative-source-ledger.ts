export const TEMU_CREATE_APP_GATE_READ_RPC =
  "sellerpilot_service_read_temu_verified_create_app_gate_v1";
export const TEMU_CREATE_SOURCE_READ_RPC =
  "sellerpilot_service_read_temu_create_authoritative_source_v1";
export const TEMU_CREATE_SOURCE_RECORD_RPC =
  "sellerpilot_service_record_temu_create_authoritative_source_v1";
export const TEMU_CREATE_APP_GATE_RECORD_RPC =
  "sellerpilot_service_record_temu_create_app_gate_v1";

export type TemuCreateSourceBinding = {
  contract: "temu_create_authoritative_source_binding_v1";
  sourceId: string;
  sourceRevision: number;
  evidenceSha256: string;
  requestFingerprint: string;
  productRevisionFingerprint: string;
};

export type TemuCreateSourceLedgerRpc = (
  name: string,
  parameters: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

export type TemuCreateSourceLedgerErrorCode =
  | "TEMU_CREATE_APP_GATE_UNAVAILABLE"
  | "TEMU_CREATE_APP_INACTIVE"
  | "TEMU_CREATE_COMPLIANCE_NOT_APPROVED"
  | "TEMU_CREATE_SOURCE_UNAVAILABLE"
  | "TEMU_CREATE_SOURCE_CONTRACT_INVALID";

export class TemuCreateSourceLedgerError extends Error {
  readonly code: TemuCreateSourceLedgerErrorCode;

  constructor(code: TemuCreateSourceLedgerErrorCode) {
    super(code);
    this.name = "TemuCreateSourceLedgerError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

/**
 * This is the only request-path consumer.  The app gate is deliberately read
 * first and a blocked result returns before the complete-source RPC.  Since
 * this function runs before claim, callers can prove zero claim/enqueue/CREATE
 * when the latest Partner Platform row is Inactive or Compliance Reviewing.
 */
export async function bindTemuCreateAuthoritativeSourceBeforeClaim(input: {
  rpc: TemuCreateSourceLedgerRpc;
  ownerId: string;
  productId: string;
  credentialId: string;
  requestFingerprint: string;
}): Promise<TemuCreateSourceBinding> {
  const scope = {
    p_owner_id: input.ownerId,
    p_product_id: input.productId,
    p_credential_id: input.credentialId,
  };
  const app = await input.rpc(TEMU_CREATE_APP_GATE_READ_RPC, scope)
    .catch(() => ({ data: null, error: { message: "unavailable" } }));
  const appGate = record(app.data);
  if (app.error || appGate?.contract !== "temu_verified_create_app_gate_v1") {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_GATE_UNAVAILABLE");
  }
  if (appGate.status !== "allowed") {
    if (appGate.appState === "inactive") {
      throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_INACTIVE");
    }
    if (appGate.complianceState !== "approved") {
      throw new TemuCreateSourceLedgerError(
        "TEMU_CREATE_COMPLIANCE_NOT_APPROVED",
      );
    }
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_GATE_UNAVAILABLE");
  }

  const source = await input.rpc(TEMU_CREATE_SOURCE_READ_RPC, {
    ...scope,
    p_request_fingerprint: input.requestFingerprint,
  }).catch(() => ({ data: null, error: { message: "unavailable" } }));
  const value = record(source.data);
  if (source.error || value?.status !== "ready") {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_SOURCE_UNAVAILABLE");
  }
  if (value.contract !== "temu_create_authoritative_source_read_v1"
    || !uuid(value.sourceId)
    || typeof value.sourceRevision !== "number"
    || !Number.isSafeInteger(value.sourceRevision)
    || value.sourceRevision < 1
    || !digest(value.evidenceSha256)
    || value.requestFingerprint !== input.requestFingerprint
    || !digest(value.requestFingerprint)
    || !digest(value.productRevisionFingerprint)
    || typeof value.expiresAt !== "string"
    || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new TemuCreateSourceLedgerError(
      "TEMU_CREATE_SOURCE_CONTRACT_INVALID",
    );
  }
  return Object.freeze({
    contract: "temu_create_authoritative_source_binding_v1",
    sourceId: value.sourceId,
    sourceRevision: value.sourceRevision,
    evidenceSha256: value.evidenceSha256,
    requestFingerprint: value.requestFingerprint,
    productRevisionFingerprint: value.productRevisionFingerprint,
  });
}

/** Service-only producer endpoint used after the r16 collector succeeds. */
export async function recordTemuCreateAuthoritativeSource(input: {
  rpc: TemuCreateSourceLedgerRpc;
  parameters: Record<string, unknown>;
}) {
  const result = await input.rpc(TEMU_CREATE_SOURCE_RECORD_RPC, input.parameters);
  const value = record(result.data);
  if (result.error
    || value?.contract !== "temu_create_authoritative_source_record_v1"
    || !uuid(value.sourceId)
    || typeof value.sourceRevision !== "number"
    || !Number.isSafeInteger(value.sourceRevision)
    || value.sourceRevision < 1
    || !digest(value.evidenceSha256)) {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_SOURCE_UNAVAILABLE");
  }
  return value;
}

/** Records the latest authenticated Partner Platform row, including blockers. */
export async function recordTemuCreateAppGateObservation(input: {
  rpc: TemuCreateSourceLedgerRpc;
  parameters: Record<string, unknown>;
}) {
  const result = await input.rpc(
    TEMU_CREATE_APP_GATE_RECORD_RPC,
    input.parameters,
  );
  if (result.error || !uuid(result.data)) {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_GATE_UNAVAILABLE");
  }
  return result.data;
}
