type UnknownRecord = Record<string, unknown>;

export const smartstoreListingCreateCompletionRpc =
  "sellerpilot_complete_smartstore_listing_create" as const;
export const smartstoreListingCreateCompletionContract =
  "smartstore_create_completion_v1" as const;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function digits(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  return text(value);
}

function stepData(result: UnknownRecord, name: string): UnknownRecord | null {
  const steps = Array.isArray(result.steps) ? result.steps : [];
  for (const item of steps) {
    const step = record(item);
    if (step?.name !== name) continue;
    if (step.ok !== true) return null;
    return record(step.data);
  }
  return null;
}

export type SmartstoreListingCreateWorkerReceipt = {
  originProductNo: string;
  channelProductNo: string;
  responsePayload: UnknownRecord;
};

export function smartstoreListingCreateCompletionReceiptFromWorkerResult(
  value: unknown,
): SmartstoreListingCreateWorkerReceipt {
  const row = record(value);
  if (row?.channel !== "smartstore" || row.operation !== "listing.create") {
    throw new Error("SMARTSTORE_CREATE_COMPLETION_INVALID");
  }
  const resources = record(record(row.remoteState)?.resources) ?? {};
  const identity = stepData(row, "product-create-identity-readback");
  const originReadback = stepData(row, "origin-product-publication-readback")
    ?? stepData(row, "product-readback");
  const originProduct = record(originReadback?.originProduct);
  const originProductNo = digits(resources.originProductNo)
    || digits(row.remoteId)
    || digits(identity?.officialOriginProductNo);
  const channelProductNo = digits(resources.smartstoreChannelProductNo)
    || digits(identity?.officialChannelProductNo);
  if (!/^[0-9]+$/u.test(originProductNo)
      || !/^[0-9]+$/u.test(channelProductNo)
      || originProductNo === channelProductNo
      || !originReadback
      || !originProduct
      || !text(originProduct.name)
      || originProduct.salePrice == null
      || originProduct.stockQuantity == null) {
    throw new Error("SMARTSTORE_CREATE_COMPLETION_INVALID");
  }
  return {
    originProductNo,
    channelProductNo,
    responsePayload: originReadback,
  };
}

export type SmartstoreListingCreateCompletion = {
  contract: typeof smartstoreListingCreateCompletionContract;
  jobId: string;
  status: "completed";
  originProductNo: string;
  channelProductNo: string;
  bodySha256: string;
  reused: boolean;
};

export function parseSmartstoreListingCreateCompletion(
  value: unknown,
): SmartstoreListingCreateCompletion {
  const row = record(value);
  const jobId = text(row?.jobId).toLowerCase();
  const originProductNo = text(row?.originProductNo);
  const channelProductNo = text(row?.channelProductNo);
  const bodySha256 = text(row?.bodySha256).toLowerCase();
  if (row?.contract !== smartstoreListingCreateCompletionContract
      || row.status !== "completed"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(jobId)
      || !/^[0-9]+$/u.test(originProductNo)
      || !/^[0-9]+$/u.test(channelProductNo)
      || !/^[a-f0-9]{64}$/u.test(bodySha256)
      || typeof row.reused !== "boolean") {
    throw new Error("SMARTSTORE_CREATE_COMPLETION_INVALID");
  }
  return {
    contract: smartstoreListingCreateCompletionContract,
    jobId,
    status: "completed",
    originProductNo,
    channelProductNo,
    bodySha256,
    reused: row.reused,
  };
}

export async function completeSmartstoreListingCreate(input: {
  rpc: (
    name: string,
    argumentsValue: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  tokenHash: string;
  jobId: string;
  claimToken: string;
  originProductNo: string;
  channelProductNo: string;
  responsePayload: Record<string, unknown>;
}) {
  const { data, error } = await input.rpc(smartstoreListingCreateCompletionRpc, {
    p_token_hash: input.tokenHash,
    p_job_id: input.jobId,
    p_claim_token: input.claimToken,
    p_origin_product_no: input.originProductNo,
    p_channel_product_no: input.channelProductNo,
    p_response_payload: input.responsePayload,
  });
  if (error) {
    throw new Error("SMARTSTORE_CREATE_COMPLETION_UNAVAILABLE");
  }
  const completion = parseSmartstoreListingCreateCompletion(data);
  if (completion.jobId !== input.jobId.toLowerCase()
      || completion.originProductNo !== input.originProductNo
      || completion.channelProductNo !== input.channelProductNo) {
    throw new Error("SMARTSTORE_CREATE_COMPLETION_MISMATCH");
  }
  return completion;
}
