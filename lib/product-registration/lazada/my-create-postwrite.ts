import type { RemoteResponse } from "../../channels/protocols";
import {
  assertLazadaMyCreateCompletion,
  type LazadaMyCreateReadinessInput,
} from "./my-create-readiness";
import {
  assertLazadaMyCreatePrewriteReceipt,
  type LazadaMyCreatePrewriteReceipt,
} from "./my-create-prewrite";
import {
  assertLazadaExactSellerSkuSet,
  assertLazadaMyCreateCurrentSource,
  lazadaMyCreateOfficialEvidenceFromBytes,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "./my-create-raw-readback";

type UnknownRecord = Record<string, unknown>;
type Readiness = ReturnType<
  typeof import("./my-create-readiness").assertLazadaMyCreateReadiness
>;
type Completion = ReturnType<typeof assertLazadaMyCreateCompletion>;

export const lazadaMyCreatePostwriteContract =
  "lazada_my_create_postwrite_v1" as const;
export const lazadaMyCreatePostwriteBlockerContract =
  "lazada_my_create_postwrite_blocker_v1" as const;

export type LazadaMyCreatePostwriteBlocker = Readonly<{
  contract: typeof lazadaMyCreatePostwriteBlockerContract;
  stage:
    | "prewrite_receipt"
    | "create_response"
    | "item_readback"
    | "lease"
    | "internal_completion";
  code: string;
  itemId?: string;
  providerMutationObserved: true;
  sellerpilotReconciliationRequired: true;
  internalCompletionAttempted: boolean;
}>;

export type LazadaMyCreateItemReadRequest = Readonly<{
  path: "/product/item/get";
  method: "GET";
  params: Readonly<{ item_id: string }>;
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

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:-]{2,159}$/u.test(message) ? message : fallback;
}

function accepted(remote: RemoteResponse) {
  return remote.response.ok
    && text(remote.data.code) === "0"
    && !text(remote.data.error);
}

function createIdentity(input: {
  remote: RemoteResponse;
  receipt: LazadaMyCreatePrewriteReceipt;
}) {
  if (!accepted(input.remote) || !text(input.remote.text)) {
    throw new Error("LAZADA_MY_CREATE_PROVIDER_RESPONSE_REJECTED");
  }
  const data = record(input.remote.data.data);
  const itemId = text(data.item_id ?? data.ItemId ?? data.itemId);
  const skuList = Array.isArray(data.sku_list)
    ? data.sku_list.map(record)
    : [];
  assertLazadaExactSellerSkuSet({
    expected: input.receipt.sellerSkus,
    observed: skuList.map((sku) => ({
      sellerSku: text(sku.seller_sku ?? sku.SellerSku),
      skuId: text(sku.sku_id ?? sku.SkuId),
    })),
  });
  if (!/^\d+$/u.test(itemId)) {
    throw new Error("LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  }
  return { itemId };
}

function rawEvidence(input: {
  argumentsValue: UnknownRecord;
  createResponse: RemoteResponse;
  itemReadback: RemoteResponse;
  itemId: string;
}) {
  const item = record(input.itemReadback.data.data);
  const images = Array.isArray(item.images) ? item.images.map(text) : [];
  const attributes = record(item.attributes);
  return lazadaMyCreateOfficialEvidenceFromBytes({
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
    imageRaw: JSON.stringify(images),
    contentRaw: `${text(attributes.name)}\n${text(attributes.description)}`,
    localeRaw: text(item.locale),
  });
}

function blocker(input: {
  stage: LazadaMyCreatePostwriteBlocker["stage"];
  error: unknown;
  itemId?: string;
  internalCompletionAttempted?: boolean;
}): LazadaMyCreatePostwriteBlocker {
  return Object.freeze({
    contract: lazadaMyCreatePostwriteBlockerContract,
    stage: input.stage,
    code: safeCode(input.error, "LAZADA_MY_CREATE_POSTWRITE_RECONCILIATION_REQUIRED"),
    ...(input.itemId ? { itemId: input.itemId } : {}),
    providerMutationObserved: true,
    sellerpilotReconciliationRequired: true,
    internalCompletionAttempted: input.internalCompletionAttempted === true,
  });
}

/**
 * First Lazada-owned boundary after CreateProduct. A provider mutation has
 * already been attempted, so every failure is reconciliation-required rather
 * than a no-write result. Raw provider responses are never returned.
 */
export async function runLazadaMyCreatePostwrite<T>(input: {
  receipt: LazadaMyCreatePrewriteReceipt;
  readiness: Readiness;
  argumentsValue: LazadaMyCreateReadinessInput["argumentsValue"];
  createResponse: RemoteResponse;
  verifiedAt: string;
  claimedCurrentSource: LazadaMyCreateCurrentSourceSnapshot;
  hooks: {
    assertLeaseHealthy: () => Promise<void>;
    readCurrentSource: () => Promise<LazadaMyCreateCurrentSourceSnapshot>;
  };
  readItem: (
    request: LazadaMyCreateItemReadRequest,
  ) => Promise<RemoteResponse>;
  completeInternal: (completion: Completion) => Promise<T>;
}) {
  try {
    await assertLazadaMyCreatePrewriteReceipt({
      receipt: input.receipt,
      readiness: input.readiness,
      argumentsValue: input.argumentsValue,
    });
  } catch (error) {
    return { ok: false as const, blocker: blocker({
      stage: "prewrite_receipt",
      error,
    }) };
  }

  let itemId: string;
  try {
    itemId = createIdentity({
      remote: input.createResponse,
      receipt: input.receipt,
    }).itemId;
  } catch (error) {
    return { ok: false as const, blocker: blocker({
      stage: "create_response",
      error,
    }) };
  }

  let itemReadback: RemoteResponse;
  try {
    itemReadback = await input.readItem({
      path: "/product/item/get",
      method: "GET",
      params: { item_id: itemId },
    });
    if (!accepted(itemReadback)) {
      throw new Error("LAZADA_MY_CREATE_ITEM_READBACK_REJECTED");
    }
  } catch (error) {
    return { ok: false as const, blocker: blocker({
      stage: "item_readback",
      error,
      itemId,
    }) };
  }

  let completion: Completion;
  try {
    const currentSource = await input.hooks.readCurrentSource();
    assertLazadaMyCreateCurrentSource({
      claimed: input.claimedCurrentSource,
      current: currentSource,
    });
    completion = assertLazadaMyCreateCompletion({
      readiness: input.readiness,
      argumentsValue: input.argumentsValue,
      createResponse: input.createResponse.data,
      itemReadback: itemReadback.data,
      verifiedAt: input.verifiedAt,
      officialEvidence: rawEvidence({
        argumentsValue: input.argumentsValue,
        createResponse: input.createResponse,
        itemReadback,
        itemId,
      }),
      claimedCurrentSource: input.claimedCurrentSource,
      currentSource,
    });
  } catch (error) {
    return { ok: false as const, blocker: blocker({
      stage: "item_readback",
      error,
      itemId,
    }) };
  }

  try {
    await input.hooks.assertLeaseHealthy();
  } catch (error) {
    return { ok: false as const, blocker: blocker({
      stage: "lease",
      error,
      itemId,
    }) };
  }

  try {
    const internalResult = await input.completeInternal(completion);
    return Object.freeze({
      ok: true as const,
      contract: lazadaMyCreatePostwriteContract,
      completion,
      internalResult,
    });
  } catch (error) {
    return { ok: false as const, blocker: blocker({
      stage: "internal_completion",
      error,
      itemId,
      internalCompletionAttempted: true,
    }) };
  }
}
