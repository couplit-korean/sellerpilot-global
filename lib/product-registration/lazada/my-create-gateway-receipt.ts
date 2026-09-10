import { lazadaCreateSellerSkus } from "../../channels/lazada-create-preflight";
import type { ChannelOperationStep } from "../../channels/operation-step";
import type { RemoteResponse } from "../../channels/protocols";
import {
  assertLazadaMyCreateCurrentSource,
  assertLazadaMyCreateGetRecoveryReceipt,
  assertLazadaMyCreateOfficialEvidence,
  lazadaMyCreateGetRecoveryReceiptContract,
  lazadaMyCreateOfficialEvidenceFromBytes,
  lazadaUtf8Sha256,
  type LazadaMyCreateCurrentSourceSnapshot,
  type LazadaMyCreateGetRecoveryReceipt,
  type LazadaMyCreateOfficialEvidence,
  type LazadaMyCreateReceiptKind,
} from "./my-create-raw-readback";

type UnknownRecord = Record<string, unknown>;

export const lazadaMyCreatePostReceiptRpc =
  "sellerpilot_lzd_store_post_rcpt_r7" as const;
export const lazadaMyCreateGetRecoveryReceiptRpc =
  "sellerpilot_lzd_store_get_rcpt_r7" as const;
export const lazadaMyCreateCurrentSourceCasRpc =
  "sellerpilot_lzd_cas_current_src_r7" as const;

export const lazadaGatewayCreateReceiptKindArgument =
  "sellerpilotLazadaCreateReceiptKind" as const;

export type LazadaGatewayCreateStoreCall = Readonly<{
  rpc:
    | typeof lazadaMyCreatePostReceiptRpc
    | typeof lazadaMyCreateGetRecoveryReceiptRpc;
  arguments: {
    p_job_id: string;
    p_http_method: "POST" | "GET";
    p_http_path: "/product/create" | "/product/item/get";
    p_request_bytes: string;
    p_response_bytes: string;
    p_request_sha256: string;
    p_response_sha256: string;
  };
}>;

export type LazadaGatewayCreateCasCall = Readonly<{
  rpc: typeof lazadaMyCreateCurrentSourceCasRpc;
  arguments: {
    p_product_id: string;
    p_listing_id: string;
    p_product_updated_at: string;
    p_product_status: string;
    p_product_demo: boolean;
    p_product_on_hand: number;
    p_listing_updated_at: string;
    p_listing_status: string;
    p_listing_remote_id: string | null;
  };
}>;

export type LazadaGatewayCreateReceiptBound = Readonly<{
  kind: LazadaMyCreateReceiptKind;
  store: LazadaGatewayCreateStoreCall;
  cas: LazadaGatewayCreateCasCall | null;
  officialEvidence?: LazadaMyCreateOfficialEvidence;
  getRecoveryReceipt?: LazadaMyCreateGetRecoveryReceipt;
}>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function stepRecords(result: unknown): ChannelOperationStep[] {
  const steps = record(result).steps;
  return Array.isArray(steps)
    ? steps.filter((step): step is ChannelOperationStep =>
      Boolean(step) && typeof step === "object" && !Array.isArray(step))
    : [];
}

function productFromArguments(argumentsValue: UnknownRecord) {
  return record(record(record(argumentsValue.request).Request).Product);
}

export function lazadaGatewayCreateArgumentsFromJobRequest(request: unknown) {
  const source = record(request);
  const nested = source.arguments;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as UnknownRecord
    : source;
}

export function lazadaGatewayCreateExpectedFields(argumentsValue: unknown) {
  const source = record(argumentsValue);
  const product = productFromArguments(source);
  const images = product.Images ?? product.images;
  const imageRows = Array.isArray(images)
    ? images
    : record(images).Image ?? record(images).image;
  const attributes = record(product.Attributes ?? product.attributes);
  let sellerSkus: string[] = [];
  try {
    sellerSkus = lazadaCreateSellerSkus(source);
  } catch {
    sellerSkus = [];
  }
  return {
    sellerSkus,
    imageUrls: Array.isArray(imageRows) ? imageRows.map(text).filter(Boolean) : [],
    name: text(attributes.name),
    description: text(attributes.description),
    locale: text(source.publicationExpectedLocale) || "ms-MY",
  };
}

export function lazadaGatewayCreateReceiptKindFromArguments(
  argumentsValue: unknown,
): LazadaMyCreateReceiptKind {
  return text(record(argumentsValue)[lazadaGatewayCreateReceiptKindArgument])
    === "get_recovery"
    ? "get_recovery"
    : "post_create";
}

function readbackStepData(result: unknown): UnknownRecord {
  const steps = stepRecords(result);
  const readback = [...steps].reverse().find((step) =>
    step.name === "listing-readback" || step.name === "listing-readback-recovery");
  return record(readback?.data);
}

export function lazadaGatewayCreateReceiptKindFromResult(
  result: unknown,
): LazadaMyCreateReceiptKind | null {
  const data = readbackStepData(result);
  if (data.receiptKind === "post_create" || data.officialEvidence) {
    return "post_create";
  }
  if (data.receiptKind === "get_recovery" || data.getRecoveryReceipt) {
    return "get_recovery";
  }
  const steps = stepRecords(result);
  if (steps.some((step) => step.name === "/product/create")) return "post_create";
  const synthetic = steps.some((step) => {
    const body = record(step.data);
    return step.name.includes("/products/get")
      && ("sku_list" in body
        || "synthesizedCreateResponse" in body
        || "createResponse" in body);
  });
  if (synthetic) {
    throw new Error("LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE");
  }
  return null;
}

function currentSourceFrom(value: unknown): LazadaMyCreateCurrentSourceSnapshot | null {
  const source = record(value);
  if (source.contract !== "lazada_my_create_current_state_r7") return null;
  return source as unknown as LazadaMyCreateCurrentSourceSnapshot;
}

function casCall(input: {
  claimed: LazadaMyCreateCurrentSourceSnapshot;
  current: LazadaMyCreateCurrentSourceSnapshot;
  listingId: string;
}): LazadaGatewayCreateCasCall {
  assertLazadaMyCreateCurrentSource({
    claimed: input.claimed,
    current: input.current,
  });
  return {
    rpc: lazadaMyCreateCurrentSourceCasRpc,
    arguments: {
      p_product_id: input.current.productId,
      p_listing_id: input.listingId,
      p_product_updated_at: input.current.productUpdatedAt,
      p_product_status: input.current.productStatus,
      p_product_demo: input.current.productDemo,
      p_product_on_hand: input.current.productOnHand,
      p_listing_updated_at: input.current.listingUpdatedAt,
      p_listing_status: input.current.listingStatus,
      p_listing_remote_id: input.current.listingRemoteId,
    },
  };
}

function evidenceRaws(itemGetResponseBytes: string) {
  const itemBody = record(JSON.parse(itemGetResponseBytes));
  const data = record(itemBody.data);
  const images = Array.isArray(data.images) ? data.images.map(text) : [];
  const attributes = record(data.attributes);
  return {
    imageRaw: JSON.stringify(images),
    contentRaw: `${text(attributes.name)}\n${text(attributes.description)}`,
    localeRaw: text(data.locale),
  };
}

export function bindLazadaGatewayPostCreateReceipt(input: {
  argumentsValue: UnknownRecord;
  createResponse: RemoteResponse;
  itemReadback: RemoteResponse;
  itemId: string;
}): LazadaMyCreateOfficialEvidence {
  const expected = lazadaGatewayCreateExpectedFields(input.argumentsValue);
  const raws = evidenceRaws(input.itemReadback.text);
  const evidence = lazadaMyCreateOfficialEvidenceFromBytes({
    postRequest: {
      method: "POST",
      path: "/product/create",
      body: input.argumentsValue,
    },
    postResponseBytes: input.createResponse.text,
    itemGetRequest: {
      method: "GET",
      path: "/product/item/get",
      params: { item_id: input.itemId },
    },
    itemGetResponseBytes: input.itemReadback.text,
    imageRaw: raws.imageRaw,
    contentRaw: raws.contentRaw,
    localeRaw: raws.localeRaw,
  });
  return assertLazadaMyCreateOfficialEvidence({
    evidence,
    expectedSellerSkus: expected.sellerSkus,
    expectedLocale: expected.locale,
    expectedImageUrls: expected.imageUrls,
    expectedName: expected.name,
    expectedDescription: expected.description,
  }).evidence;
}

export function bindLazadaGatewayGetRecoveryReceipt(input: {
  argumentsValue: UnknownRecord;
  itemReadback: RemoteResponse;
  itemId: string;
}): ReturnType<typeof assertLazadaMyCreateGetRecoveryReceipt> {
  const expected = lazadaGatewayCreateExpectedFields(input.argumentsValue);
  const requestBytes = JSON.stringify({
    method: "GET",
    path: "/product/item/get",
    params: { item_id: input.itemId },
  });
  const raws = evidenceRaws(input.itemReadback.text);
  return assertLazadaMyCreateGetRecoveryReceipt({
    receipt: {
      contract: lazadaMyCreateGetRecoveryReceiptContract,
      receiptKind: "get_recovery",
      method: "GET",
      path: "/product/item/get",
      requestBytes,
      responseBytes: input.itemReadback.text,
      requestSha256: lazadaUtf8Sha256(requestBytes),
      responseSha256: lazadaUtf8Sha256(input.itemReadback.text),
      imageRaw: raws.imageRaw,
      contentRaw: raws.contentRaw,
      localeRaw: raws.localeRaw,
    },
    expectedSellerSkus: expected.sellerSkus,
    expectedLocale: expected.locale,
    expectedImageUrls: expected.imageUrls,
    expectedName: expected.name,
    expectedDescription: expected.description,
  });
}

export function attachLazadaGatewayReceiptToStep(
  step: ChannelOperationStep,
  bound:
    | { kind: "post_create"; officialEvidence: LazadaMyCreateOfficialEvidence }
    | {
      kind: "get_recovery";
      getRecoveryReceipt: ReturnType<typeof assertLazadaMyCreateGetRecoveryReceipt>;
    },
): ChannelOperationStep {
  return {
    ...step,
    data: bound.kind === "post_create"
      ? {
        ...step.data,
        receiptKind: "post_create",
        officialEvidence: bound.officialEvidence,
      }
      : {
        ...step.data,
        receiptKind: "get_recovery",
        getRecoveryReceipt: bound.getRecoveryReceipt,
      },
  };
}

export function assertLazadaGatewayCreateReceipt(input: {
  jobId: string;
  result: unknown;
  argumentsValue: unknown;
  listingId?: string;
}): LazadaGatewayCreateReceiptBound {
  const kind = lazadaGatewayCreateReceiptKindFromResult(input.result);
  if (!kind) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED");
  }
  const expected = lazadaGatewayCreateExpectedFields(input.argumentsValue);
  const data = readbackStepData(input.result);
  const claimed = currentSourceFrom(
    data.claimedCurrentSource ?? record(input.argumentsValue).sellerpilotLazadaClaimedCurrentSource,
  );
  const current = currentSourceFrom(
    data.currentSource ?? record(input.argumentsValue).sellerpilotLazadaCurrentSource,
  );
  if (Boolean(claimed) !== Boolean(current)) {
    throw new Error("LAZADA_MY_CREATE_CURRENT_SOURCE_INVALID");
  }
  const listingId = text(input.listingId)
    || text(record(input.argumentsValue).sellerpilotLazadaListingId);
  const cas = claimed && current && listingId
    ? casCall({ claimed, current, listingId })
    : claimed && current
      ? (assertLazadaMyCreateCurrentSource({ claimed, current }), null)
      : null;

  if (kind === "post_create") {
    const bound = assertLazadaMyCreateOfficialEvidence({
      evidence: data.officialEvidence,
      expectedSellerSkus: expected.sellerSkus,
      expectedLocale: expected.locale,
      expectedImageUrls: expected.imageUrls,
      expectedName: expected.name,
      expectedDescription: expected.description,
    });
    return {
      kind,
      officialEvidence: bound.evidence,
      store: {
        rpc: lazadaMyCreatePostReceiptRpc,
        arguments: {
          p_job_id: input.jobId,
          p_http_method: "POST",
          p_http_path: "/product/create",
          p_request_bytes: bound.evidence.postRequestBytes,
          p_response_bytes: bound.evidence.postResponseBytes,
          p_request_sha256: bound.evidence.postRequestSha256,
          p_response_sha256: bound.evidence.postResponseSha256,
        },
      },
      cas,
    };
  }

  const recovered = assertLazadaMyCreateGetRecoveryReceipt({
    receipt: data.getRecoveryReceipt,
    expectedSellerSkus: expected.sellerSkus,
    expectedLocale: expected.locale,
    expectedImageUrls: expected.imageUrls,
    expectedName: expected.name,
    expectedDescription: expected.description,
  });
  return {
    kind,
    getRecoveryReceipt: recovered,
    store: {
      rpc: lazadaMyCreateGetRecoveryReceiptRpc,
      arguments: {
        p_job_id: input.jobId,
        p_http_method: "GET",
        p_http_path: "/product/item/get",
        p_request_bytes: recovered.requestBytes,
        p_response_bytes: recovered.responseBytes,
        p_request_sha256: recovered.requestSha256,
        p_response_sha256: recovered.responseSha256,
      },
    },
    cas,
  };
}

export function applyLazadaGatewayCreateProviderResult<T extends {
  ok: boolean;
  channel: string;
  operation: string;
  steps: ChannelOperationStep[];
}>(result: T, argumentsValue: unknown): T {
  if (result.channel !== "lazada" || result.operation !== "listing.create") {
    return result;
  }
  const requestedKind = lazadaGatewayCreateReceiptKindFromArguments(argumentsValue);
  let observedKind: LazadaMyCreateReceiptKind | null;
  try {
    observedKind = lazadaGatewayCreateReceiptKindFromResult(result);
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE";
    return {
      ...result,
      ok: false,
      steps: [
        ...result.steps,
        {
          name: "lazada-r7-receipt",
          ok: false,
          status: 409,
          data: {
            error: code,
            sellerpilotReconciliationRequired: true,
          },
        },
      ],
    };
  }
  if (requestedKind === "get_recovery" && observedKind === "post_create") {
    return {
      ...result,
      ok: false,
      steps: [
        ...result.steps,
        {
          name: "lazada-r7-receipt",
          ok: false,
          status: 409,
          data: {
            error: "LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE",
            sellerpilotReconciliationRequired: true,
          },
        },
      ],
    };
  }
  if (!result.ok) return result;
  try {
    assertLazadaGatewayCreateReceipt({
      jobId: "00000000-0000-4000-8000-000000000001",
      result,
      argumentsValue,
    });
    return result;
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED";
    return {
      ...result,
      ok: false,
      steps: [
        ...result.steps,
        {
          name: "lazada-r7-receipt",
          ok: false,
          status: 409,
          data: {
            error: code,
            sellerpilotReconciliationRequired: true,
          },
        },
      ],
    };
  }
}

export function gateLazadaGatewayCreateCompletion(input: {
  status: "succeeded" | "failed" | "reconciliation_required";
  result: unknown;
  argumentsValue: unknown;
  jobId: string;
  listingId?: string;
}): {
  ok: boolean;
  store?: LazadaGatewayCreateStoreCall;
  cas?: LazadaGatewayCreateCasCall | null;
  kind?: LazadaMyCreateReceiptKind;
  error?: string;
} {
  if (input.status !== "succeeded") {
    try {
      if (lazadaGatewayCreateReceiptKindFromResult(input.result) === "get_recovery") {
        const bound = assertLazadaGatewayCreateReceipt({
          jobId: input.jobId,
          result: input.result,
          argumentsValue: input.argumentsValue,
          listingId: input.listingId,
        });
        return { ok: true, store: bound.store, cas: bound.cas, kind: bound.kind };
      }
    } catch {
      return { ok: true };
    }
    return { ok: true };
  }
  try {
    const bound = assertLazadaGatewayCreateReceipt({
      jobId: input.jobId,
      result: input.result,
      argumentsValue: input.argumentsValue,
      listingId: input.listingId,
    });
    return { ok: true, store: bound.store, cas: bound.cas, kind: bound.kind };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? error.message
        : "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
    };
  }
}
