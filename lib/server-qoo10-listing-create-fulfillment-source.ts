import {
  bindQoo10ListingCreateApproval,
  qoo10ListingCreateApprovalBindingArgument,
} from "./channels/qoo10-listing-create-approval";
import { qoo10ListingCreateFulfillmentEvidenceArgument } from "./channels/qoo10-listing-create-fulfillment-evidence";
import {
  buildQoo10ListingCreateFulfillmentEvidenceFromServerQsm,
  qoo10QsmCreateFulfillmentCaptureContract,
  qoo10QsmCreateFulfillmentOrigin,
  type Qoo10QsmCreateFulfillmentCapture,
  type Qoo10QsmCreateFulfillmentReadRequest,
} from "./channels/qoo10-listing-create-fulfillment-qsm-source";
import {
  qoo10Request,
  runWithProviderReadOnlyTransport,
  type SecretPayload,
} from "./channels/protocols";

export const qoo10CreateFulfillmentSourceTakeRpc =
  "sellerpilot_service_take_qoo10_create_fulfillment_capture" as const;
export const qoo10DurableCreateFulfillmentSourceContract =
  "sellerpilot_qoo10_durable_create_fulfillment_source_v1" as const;
export const qoo10DurableCreateFulfillmentBindingContract =
  "sellerpilot_qoo10_durable_create_fulfillment_binding_v1" as const;
export const qoo10DurableCreateFulfillmentBindingArgument =
  "sellerpilotQoo10CreateFulfillmentDurableSource" as const;
export const qoo10CreateFulfillmentMutationFenceRpc =
  "sellerpilot_service_fence_qoo10_create_fulfillment_v2" as const;
export const qoo10CreateCurrentStateFenceRpc =
  "sellerpilot_service_fence_qoo10_create_now_v3" as const;
export const qoo10GatewayCreateBoundaryRpc =
  "sellerpilot_service_begin_qoo10_gateway_create_v1" as const;
export const qoo10CreateGetRecoveryRpc =
  "sellerpilot_service_qoo10_create_get_rec_v1" as const;
export const qoo10CreateGetRecoveryContract =
  "sellerpilot_qoo10_create_official_get_recovery_v1" as const;
export const qoo10RetiredExistingItemCode = "1217536689" as const;

type UnknownRecord = Record<string, unknown>;
type RpcResult = { data: unknown; error: unknown };
export type Qoo10CreateFulfillmentSourceRpc = (
  name: typeof qoo10CreateFulfillmentSourceTakeRpc,
  parameters: {
    p_owner_id: string;
    p_product_id: string;
    p_credential_id: string;
    p_credential_version: number;
    p_market: "JP";
    p_target_id: string;
  },
) => PromiseLike<RpcResult>;

export class Qoo10DurableCreateFulfillmentSourceError extends Error {
  constructor(
    readonly code:
      | "QOO10_CREATE_FULFILLMENT_DURABLE_INPUT_INVALID"
      | "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE"
      | "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID"
      | "QOO10_CREATE_GET_RECOVERY_EXISTING_ITEM_REJECTED"
      | "QOO10_CREATE_GET_RECOVERY_INVALID",
    readonly unavailable: boolean,
  ) {
    super(code);
    this.name = "Qoo10DurableCreateFulfillmentSourceError";
  }
}

const bindingKeys = [
  "contract", "sourceId", "ownerId", "productId", "credentialId",
  "credentialVersion", "sellerId", "market", "targetId", "sourceRevision",
  "captureDigest", "fulfillmentEvidenceDigest", "observedAt", "expiresAt",
] as const;

export function qoo10DurableCreateFulfillmentBinding(
  argumentsValue: Record<string, unknown>,
) {
  const row = record(argumentsValue[qoo10DurableCreateFulfillmentBindingArgument]);
  const evidence = record(argumentsValue[qoo10ListingCreateFulfillmentEvidenceArgument]);
  const approval = record(argumentsValue[qoo10ListingCreateApprovalBindingArgument]);
  const observedAt = iso(row?.observedAt);
  const expiresAt = iso(row?.expiresAt);
  if (!row || !exactKeys(row, bindingKeys)
      || row.contract !== qoo10DurableCreateFulfillmentBindingContract
      || !uuidPattern.test(text(row.sourceId))
      || !uuidPattern.test(text(row.ownerId))
      || !uuidPattern.test(text(row.productId))
      || !uuidPattern.test(text(row.credentialId))
      || !Number.isSafeInteger(Number(row.credentialVersion))
      || Number(row.credentialVersion) < 1
      || !text(row.sellerId) || text(row.sellerId).length > 160
      || row.market !== "JP" || !text(row.targetId) || text(row.targetId).length > 160
      || !/^sha256:[a-f0-9]{64}$/u.test(text(row.sourceRevision))
      || !/^[a-f0-9]{64}$/u.test(text(row.captureDigest))
      || !/^[a-f0-9]{64}$/u.test(text(row.fulfillmentEvidenceDigest))
      || text(evidence?.evidenceDigest) !== text(row.fulfillmentEvidenceDigest)
      || text(approval?.fulfillmentEvidenceDigest) !== text(row.fulfillmentEvidenceDigest)
      || observedAt === null || expiresAt !== observedAt + 5 * 60 * 1_000) return null;
  return {
    sourceId: text(row.sourceId).toLowerCase(),
    ownerId: text(row.ownerId).toLowerCase(),
    productId: text(row.productId).toLowerCase(),
    credentialId: text(row.credentialId).toLowerCase(),
    credentialVersion: Number(row.credentialVersion),
    sellerId: text(row.sellerId),
    market: "JP" as const,
    targetId: text(row.targetId),
    sourceRevision: text(row.sourceRevision),
    captureDigest: text(row.captureDigest),
    fulfillmentEvidenceDigest: text(row.fulfillmentEvidenceDigest),
    observedAt: text(row.observedAt),
    expiresAt: text(row.expiresAt),
  };
}

export async function assertQoo10CreateFulfillmentMutationFence(input: {
  rpc: (name: typeof qoo10CreateFulfillmentMutationFenceRpc,
    parameters: Record<string, unknown>) => PromiseLike<RpcResult>;
  argumentsValue: Record<string, unknown>;
  ownerId: string;
  productId: string;
  credentialId: string;
  market: "JP";
  targetId: string;
  attemptId?: string;
  requestFingerprint?: string;
  now?: Date;
}) {
  const binding = qoo10DurableCreateFulfillmentBinding(input.argumentsValue);
  const nowMs = (input.now ?? new Date()).getTime();
  if (!binding || binding.ownerId !== input.ownerId.toLowerCase()
      || binding.productId !== input.productId.toLowerCase()
      || binding.credentialId !== input.credentialId.toLowerCase()
      || binding.market !== input.market || binding.targetId !== input.targetId
      || Date.parse(binding.observedAt) > nowMs + 5_000
      || Date.parse(binding.expiresAt) <= nowMs
      || Boolean(input.attemptId) !== Boolean(input.requestFingerprint)
      || (input.attemptId !== undefined && !uuidPattern.test(input.attemptId))
      || (input.requestFingerprint !== undefined
        && !/^[a-f0-9]{64}$/u.test(input.requestFingerprint))) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID", false,
    );
  }
  let result: RpcResult;
  try {
    result = await input.rpc(qoo10CreateFulfillmentMutationFenceRpc, {
      p_source_id: binding.sourceId,
      p_owner_id: binding.ownerId,
      p_product_id: binding.productId,
      p_credential_id: binding.credentialId,
      p_credential_version: binding.credentialVersion,
      p_seller_id: binding.sellerId,
      p_market: binding.market,
      p_target_id: binding.targetId,
      p_source_revision: binding.sourceRevision,
      p_capture_digest: binding.captureDigest,
      p_fulfillment_evidence_digest: binding.fulfillmentEvidenceDigest,
      ...(input.attemptId && input.requestFingerprint
        ? {
            p_attempt_id: input.attemptId.toLowerCase(),
            p_request_fingerprint: input.requestFingerprint,
          }
        : {}),
    });
  } catch {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE", true,
    );
  }
  if (result.error || result.data !== true) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID", false,
    );
  }
  return binding;
}

const gatewayBoundaryReceiptKeys = [
  "contract", "status", "sourceId", "attemptId", "listingId", "requestFingerprint",
] as const;

export async function beginQoo10GatewayCreateMutationBoundary(input: {
  rpc: (name: typeof qoo10GatewayCreateBoundaryRpc,
    parameters: Record<string, unknown>) => PromiseLike<RpcResult>;
  argumentsValue: Record<string, unknown>;
  gatewayTokenHash: string;
  jobId: string;
  claimToken: string;
  now?: Date;
}) {
  const binding = qoo10DurableCreateFulfillmentBinding(input.argumentsValue);
  const nowMs = (input.now ?? new Date()).getTime();
  if (!binding
      || !/^[a-f0-9]{64}$/u.test(input.gatewayTokenHash)
      || !uuidPattern.test(input.jobId)
      || !uuidPattern.test(input.claimToken)
      || Date.parse(binding.observedAt) > nowMs + 5_000
      || Date.parse(binding.expiresAt) <= nowMs) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID", false,
    );
  }
  let result: RpcResult;
  try {
    result = await input.rpc(qoo10GatewayCreateBoundaryRpc, {
      p_token_hash: input.gatewayTokenHash,
      p_job_id: input.jobId.toLowerCase(),
      p_claim_token: input.claimToken.toLowerCase(),
      p_source_id: binding.sourceId,
      p_owner_id: binding.ownerId,
      p_product_id: binding.productId,
      p_credential_id: binding.credentialId,
      p_credential_version: binding.credentialVersion,
      p_seller_id: binding.sellerId,
      p_market: binding.market,
      p_target_id: binding.targetId,
      p_source_revision: binding.sourceRevision,
      p_capture_digest: binding.captureDigest,
      p_fulfillment_evidence_digest: binding.fulfillmentEvidenceDigest,
    });
  } catch {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE", true,
    );
  }
  const receipt = record(result.data);
  if (result.error || !receipt || !exactKeys(receipt, gatewayBoundaryReceiptKeys)
      || receipt.contract !== "sellerpilot_qoo10_gateway_create_boundary_v1"
      || receipt.status !== "started"
      || text(receipt.sourceId).toLowerCase() !== binding.sourceId
      || !uuidPattern.test(text(receipt.attemptId))
      || !uuidPattern.test(text(receipt.listingId))
      || !/^[a-f0-9]{64}$/u.test(text(receipt.requestFingerprint))) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE", true,
    );
  }
  return {
    binding,
    attemptId: text(receipt.attemptId).toLowerCase(),
    listingId: text(receipt.listingId).toLowerCase(),
    requestFingerprint: text(receipt.requestFingerprint),
  };
}

export type Qoo10LocalCreateReconciliationObservation = {
  contract: "sellerpilot_qoo10_local_create_seller_code_lookup_v1";
  lookupStatus: "observed" | "unavailable";
  matchStatus: "absent" | "unique" | "ambiguous" | "unavailable";
  sellerCode: string;
  httpStatus: number | null;
  resultCode: string | null;
  resultMessage: string | null;
  exactRemoteIds: string[];
  uniqueRemoteId: string | null;
  observedAt: string;
};

const getRecoveryReceiptKeys = [
  "contract", "status", "receiptKind", "receiptId", "sourceId",
  "attemptId", "listingId", "matchStatus", "remoteId",
  "listingPublished", "synthesizedPostReceipt",
] as const;

export async function recordQoo10CreateOfficialGetRecovery(input: {
  rpc: (name: typeof qoo10CreateGetRecoveryRpc,
    parameters: Record<string, unknown>) => PromiseLike<RpcResult>;
  gatewayTokenHash: string;
  jobId: string;
  claimToken: string;
  sourceId: string;
  observation: Qoo10LocalCreateReconciliationObservation;
  requestSha256: string;
  responseSha256: string;
}) {
  const observation = input.observation;
  const matchStatus = observation.matchStatus;
  if (!/^[a-f0-9]{64}$/u.test(input.gatewayTokenHash)
      || !uuidPattern.test(input.jobId)
      || !uuidPattern.test(input.claimToken)
      || !uuidPattern.test(input.sourceId)
      || !/^[a-f0-9]{64}$/u.test(input.requestSha256)
      || !/^[a-f0-9]{64}$/u.test(input.responseSha256)
      || !observation.sellerCode
      || observation.lookupStatus !== "observed"
      || (matchStatus !== "unique" && matchStatus !== "absent"
        && matchStatus !== "ambiguous")
      || observation.httpStatus == null) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_GET_RECOVERY_INVALID", false,
    );
  }
  if (observation.sellerCode === qoo10RetiredExistingItemCode
      || observation.uniqueRemoteId === qoo10RetiredExistingItemCode
      || observation.exactRemoteIds.includes(qoo10RetiredExistingItemCode)) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_GET_RECOVERY_EXISTING_ITEM_REJECTED", false,
    );
  }
  let result: RpcResult;
  try {
    result = await input.rpc(qoo10CreateGetRecoveryRpc, {
      p_token_hash: input.gatewayTokenHash,
      p_job_id: input.jobId.toLowerCase(),
      p_claim_token: input.claimToken.toLowerCase(),
      p_source_id: input.sourceId.toLowerCase(),
      p_seller_code: observation.sellerCode,
      p_match_status: matchStatus,
      p_remote_id: matchStatus === "unique" ? observation.uniqueRemoteId : null,
      p_request_sha256: input.requestSha256,
      p_response_sha256: input.responseSha256,
      p_http_status: observation.httpStatus,
      p_result_code: observation.resultCode,
      p_observed_at: observation.observedAt,
    });
  } catch {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE", true,
    );
  }
  const receipt = record(result.data);
  if (result.error || !receipt || !exactKeys(receipt, getRecoveryReceiptKeys)
      || receipt.contract !== qoo10CreateGetRecoveryContract
      || receipt.status !== "recorded"
      || receipt.receiptKind !== "official_get_recovery"
      || receipt.listingPublished !== false
      || receipt.synthesizedPostReceipt !== false) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE", true,
    );
  }
  return {
    contract: qoo10CreateGetRecoveryContract,
    status: "recorded" as const,
    receiptKind: "official_get_recovery" as const,
    receiptId: text(receipt.receiptId).toLowerCase(),
    sourceId: text(receipt.sourceId).toLowerCase(),
    attemptId: text(receipt.attemptId).toLowerCase(),
    listingId: text(receipt.listingId).toLowerCase(),
    matchStatus: text(receipt.matchStatus),
    remoteId: text(receipt.remoteId) || null,
    listingPublished: false as const,
    synthesizedPostReceipt: false as const,
  };
}

export async function readQoo10LocalCreateSellerCodeReconciliation(input: {
  payload: SecretPayload;
  argumentsValue: Record<string, unknown>;
  now?: Date;
}): Promise<Qoo10LocalCreateReconciliationObservation> {
  const params = record(input.argumentsValue.params);
  const sellerCode = text(params?.SellerCode);
  const observedAt = (input.now ?? new Date()).toISOString();
  if (!sellerCode || sellerCode.length > 200) {
    throw new Error("QOO10_LOCAL_CREATE_SELLER_CODE_INVALID");
  }
  try {
    const remote = await runWithProviderReadOnlyTransport(() => qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: "", SellerCode: sellerCode },
    }));
    const values = Array.isArray(remote.data.ResultObject)
      ? remote.data.ResultObject
      : [remote.data.ResultObject];
    const exactRemoteIds = [...new Set(values.flatMap((value) => {
      const row = record(value);
      if (!row || text(row.SellerCode) !== sellerCode) return [];
      const remoteId = text(row.ItemNo) || text(row.ItemCode) || text(row.GdNo);
      return /^\d{9,10}$/u.test(remoteId) ? [remoteId] : [];
    }))].sort();
    const matchStatus = exactRemoteIds.length === 0
      ? "absent" as const
      : exactRemoteIds.length === 1
        ? "unique" as const
        : "ambiguous" as const;
    return {
      contract: "sellerpilot_qoo10_local_create_seller_code_lookup_v1",
      lookupStatus: "observed",
      matchStatus,
      sellerCode,
      httpStatus: remote.response.status,
      resultCode: Object.hasOwn(remote.data, "ResultCode")
        ? text(remote.data.ResultCode) || null
        : null,
      resultMessage: text(remote.data.ResultMsg).slice(0, 500) || null,
      exactRemoteIds,
      uniqueRemoteId: matchStatus === "unique" ? exactRemoteIds[0] : null,
      observedAt,
    };
  } catch {
    return {
      contract: "sellerpilot_qoo10_local_create_seller_code_lookup_v1",
      lookupStatus: "unavailable",
      matchStatus: "unavailable",
      sellerCode,
      httpStatus: null,
      resultCode: null,
      resultMessage: null,
      exactRemoteIds: [],
      uniqueRemoteId: null,
      observedAt,
    };
  }
}

export function qoo10GatewayCreateReconciliationResult(
  observation: Qoo10LocalCreateReconciliationObservation,
  safeMessage: string,
) {
  return {
    ok: false as const,
    channel: "qoo10" as const,
    operation: "listing.create" as const,
    steps: [{
      name: "qoo10-create-seller-code-reconciliation",
      ok: false as const,
      status: observation.httpStatus ?? 0,
      data: observation,
    }],
    safeMessage: observation.matchStatus === "ambiguous"
      ? "QOO10_CREATE_SELLER_CODE_AMBIGUOUS"
      : safeMessage,
  };
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function exactKeys(value: UnknownRecord, keys: readonly string[]) {
  return Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function iso(value: unknown) {
  const normalized = text(value);
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === normalized
    ? milliseconds
    : null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sourceKeys = [
  "contract", "sourceId", "ownerId", "productId", "credentialId", "credentialVersion",
  "market", "targetId",
  "sellerId", "testItemCode", "testItemSellerCode", "dispatchPlaceId",
  "returnPolicyId", "sourceRevision", "captureDigest", "observedAt",
  "expiresAt", "consumedAt", "capture",
] as const;

function parseSource(value: unknown, expected: {
  ownerId: string;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  market: "JP";
  targetId: string;
  nowMs: number;
}) {
  const row = record(value);
  const capture = record(row?.capture);
  const observedAt = iso(row?.observedAt);
  const expiresAt = iso(row?.expiresAt);
  const consumedAt = iso(row?.consumedAt);
  if (!row || !capture || !exactKeys(row, sourceKeys)
      || row.contract !== qoo10DurableCreateFulfillmentSourceContract
      || !uuidPattern.test(text(row.sourceId))
      || text(row.ownerId).toLowerCase() !== expected.ownerId
      || text(row.productId).toLowerCase() !== expected.productId
      || text(row.credentialId).toLowerCase() !== expected.credentialId
      || Number(row.credentialVersion) !== expected.credentialVersion
      || row.market !== expected.market || text(row.targetId) !== expected.targetId
      || !text(row.sellerId) || text(row.sellerId).length > 160
      || !/^\d{9,10}$/u.test(text(row.testItemCode))
      || !text(row.testItemSellerCode)
      || !text(row.dispatchPlaceId) || !text(row.returnPolicyId)
      || !/^sha256:[a-f0-9]{64}$/u.test(text(row.sourceRevision))
      || !/^[a-f0-9]{64}$/u.test(text(row.captureDigest))
      || observedAt === null || expiresAt === null || consumedAt === null
      || expiresAt !== observedAt + 5 * 60 * 1_000
      || observedAt > expected.nowMs + 5_000
      || observedAt < expected.nowMs - 5 * 60 * 1_000
      || expiresAt <= expected.nowMs
      || consumedAt < observedAt || consumedAt > expected.nowMs + 5_000
      || capture.contract !== qoo10QsmCreateFulfillmentCaptureContract
      || capture.sourceOrigin !== qoo10QsmCreateFulfillmentOrigin
      || text(capture.authenticatedSellerId) !== text(row.sellerId)
      || text(capture.testItemCode) !== text(row.testItemCode)
      || text(capture.testItemSellerCode) !== text(row.testItemSellerCode)
      || text(capture.sourceRevision) !== text(row.sourceRevision)
      || text(capture.captureDigest) !== text(row.captureDigest)) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID",
      false,
    );
  }
  return {
    sourceId: text(row.sourceId).toLowerCase(),
    ownerId: expected.ownerId,
    productId: expected.productId,
    credentialId: expected.credentialId,
    credentialVersion: expected.credentialVersion,
    market: expected.market,
    targetId: expected.targetId,
    sellerId: text(row.sellerId),
    testItemCode: text(row.testItemCode),
    dispatchPlaceId: text(row.dispatchPlaceId),
    returnPolicyId: text(row.returnPolicyId),
    capture: structuredClone(capture) as Qoo10QsmCreateFulfillmentCapture,
  };
}

function normalizedInput(input: {
  ownerId: unknown;
  productId: unknown;
  credentialId: unknown;
  credentialVersion: unknown;
  market: unknown;
  targetId: unknown;
  rpc: unknown;
  now?: Date;
}) {
  const ownerId = text(input.ownerId).toLowerCase();
  const productId = text(input.productId).toLowerCase();
  const credentialId = text(input.credentialId).toLowerCase();
  const credentialVersion = Number(input.credentialVersion);
  const market = text(input.market).toUpperCase();
  const targetId = text(input.targetId);
  const nowMs = (input.now ?? new Date()).getTime();
  if (!uuidPattern.test(ownerId) || !uuidPattern.test(productId)
      || !uuidPattern.test(credentialId) || market !== "JP"
      || !targetId || targetId.length > 160
      || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1
      || typeof input.rpc !== "function" || !Number.isFinite(nowMs)) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_INPUT_INVALID",
      false,
    );
  }
  return { ownerId, productId, credentialId, credentialVersion, market: "JP" as const, targetId, nowMs };
}

async function takeSource(input: {
  rpc: Qoo10CreateFulfillmentSourceRpc;
  ownerId: string;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  market: "JP";
  targetId: string;
  now?: Date;
}) {
  const expected = normalizedInput(input);
  let result: RpcResult;
  try {
    result = await input.rpc(qoo10CreateFulfillmentSourceTakeRpc, {
      p_owner_id: expected.ownerId,
      p_product_id: expected.productId,
      p_credential_id: expected.credentialId,
      p_credential_version: expected.credentialVersion,
      p_market: expected.market,
      p_target_id: expected.targetId,
    });
  } catch {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE",
      true,
    );
  }
  if (result.error || result.data === null || result.data === undefined) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_UNAVAILABLE",
      true,
    );
  }
  return parseSource(result.data, expected);
}

function exactCaptureRequest(
  request: Qoo10QsmCreateFulfillmentReadRequest,
  source: Awaited<ReturnType<typeof takeSource>>,
) {
  return request.method === "BROWSER_READ" && request.readOnly === true
    && request.browser.name === "Chrome" && request.browser.family === "chrome"
    && request.browser.type === "extension"
    && request.browser.profileName === "CHANGHEE"
    && request.sourceOrigin === qoo10QsmCreateFulfillmentOrigin
    && request.sellerId === source.sellerId
    && request.testItemCode === source.testItemCode
    && request.dispatchPlaceId === source.dispatchPlaceId
    && request.returnPolicyId === source.returnPolicyId;
}

export async function bindQoo10ListingCreateApprovalFromDurableSource(input: {
  rpc: Qoo10CreateFulfillmentSourceRpc;
  ownerId: string;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  market: "JP";
  targetId: string;
  argumentsValue: Record<string, unknown>;
  now?: Date;
}) {
  const { source, fulfillment } = await buildWithSource(input);
  return {
    ...bindQoo10ListingCreateApproval(input.argumentsValue, fulfillment),
    [qoo10DurableCreateFulfillmentBindingArgument]: {
      contract: qoo10DurableCreateFulfillmentBindingContract,
      sourceId: source.sourceId,
      ownerId: source.ownerId,
      productId: source.productId,
      credentialId: source.credentialId,
      credentialVersion: source.credentialVersion,
      sellerId: source.sellerId,
      market: source.market,
      targetId: source.targetId,
      sourceRevision: source.capture.sourceRevision,
      captureDigest: source.capture.captureDigest,
      fulfillmentEvidenceDigest: fulfillment.evidenceDigest,
      observedAt: source.capture.observedAt,
      expiresAt: new Date(Date.parse(source.capture.observedAt) + 5 * 60 * 1_000).toISOString(),
    },
  };
}

export async function buildQoo10ListingCreateFulfillmentEvidenceFromDurableSource(input: {
  rpc: Qoo10CreateFulfillmentSourceRpc;
  ownerId: string;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  market: "JP";
  targetId: string;
  now?: Date;
}) {
  return (await buildWithSource(input)).fulfillment;
}

async function buildWithSource(input: {
  rpc: Qoo10CreateFulfillmentSourceRpc;
  ownerId: string;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  market: "JP";
  targetId: string;
  now?: Date;
}) {
  const source = await takeSource(input);
  let captureReads = 0;
  const fulfillment = await buildQoo10ListingCreateFulfillmentEvidenceFromServerQsm({
    sellerId: source.sellerId,
    testItemCode: source.testItemCode,
    dispatchPlaceId: source.dispatchPlaceId,
    returnPolicyId: source.returnPolicyId,
    now: input.now,
    readCapture: async (request) => {
      captureReads += 1;
      if (captureReads !== 1 || !exactCaptureRequest(request, source)) {
        throw new Qoo10DurableCreateFulfillmentSourceError(
          "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID",
          false,
        );
      }
      return source.capture;
    },
  });
  if (captureReads !== 1) {
    throw new Qoo10DurableCreateFulfillmentSourceError(
      "QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID",
      false,
    );
  }
  return { source, fulfillment };
}
