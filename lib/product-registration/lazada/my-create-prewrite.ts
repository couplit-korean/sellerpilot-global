import {
  assertLazadaMyCreateReadiness,
  lazadaMyCreateReadinessContract,
  type LazadaMyCreateReadinessInput,
} from "./my-create-readiness";
import {
  assertLazadaMyCreateCurrentSource,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "./my-create-raw-readback";

type UnknownRecord = Record<string, unknown>;

export const lazadaMyCreatePrewriteContract =
  "lazada_my_create_prewrite_v1" as const;

type Readiness = ReturnType<typeof assertLazadaMyCreateReadiness>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("LAZADA_MY_CREATE_PREWRITE_ARGUMENTS_INVALID");
  }
  return value;
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type LazadaMyCreatePrewriteReceipt = Readonly<{
  contract: typeof lazadaMyCreatePrewriteContract;
  readinessContract: typeof lazadaMyCreateReadinessContract;
  requestSha256: string;
  credentialId: string;
  appKey: string;
  sellerId: string;
  shortCode: string;
  market: "MY";
  country: "my";
  categoryId: string;
  categoryLanguageCode: "en_US";
  sellerMode: Readiness["sellerMode"];
  sellerSkus: readonly string[];
  brand: string;
  productImageCount: 8;
  targetPriceMyr: number;
  quantity: number;
  shipmentProvider: string;
  deliveryOption: string;
  deliveryOptionSof: "Yes" | "No";
  targetVerifiedAt: string;
  englishContentApprovedAt: string;
  deliveryVerifiedAt: string;
  returnVerifiedAt: string;
}>;

async function buildReceipt(
  readiness: Readiness,
  argumentsValue: UnknownRecord,
): Promise<LazadaMyCreatePrewriteReceipt> {
  if (readiness.contract !== lazadaMyCreateReadinessContract
      || readiness.productImageCount !== 8
      || !readiness.sellerSkus.length) {
    throw new Error("LAZADA_MY_CREATE_READINESS_REQUIRED");
  }
  return Object.freeze({
    contract: lazadaMyCreatePrewriteContract,
    readinessContract: lazadaMyCreateReadinessContract,
    requestSha256: await sha256(argumentsValue),
    credentialId: readiness.credentialId,
    appKey: readiness.appKey,
    sellerId: readiness.sellerId,
    shortCode: readiness.shortCode,
    market: "MY",
    country: "my",
    categoryId: readiness.categoryId,
    categoryLanguageCode: "en_US",
    sellerMode: readiness.sellerMode,
    sellerSkus: Object.freeze([...readiness.sellerSkus]),
    brand: readiness.brand,
    productImageCount: 8,
    targetPriceMyr: readiness.targetPriceMyr,
    quantity: readiness.quantity,
    shipmentProvider: readiness.shipmentProvider,
    deliveryOption: readiness.deliveryOption,
    deliveryOptionSof: readiness.deliveryOptionSof,
    targetVerifiedAt: readiness.targetVerifiedAt,
    englishContentApprovedAt: readiness.englishContentApprovedAt,
    deliveryVerifiedAt: readiness.deliveryVerifiedAt,
    returnVerifiedAt: readiness.returnVerifiedAt,
  });
}

function sameReceipt(
  left: LazadaMyCreatePrewriteReceipt,
  right: LazadaMyCreatePrewriteReceipt,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function assertLazadaMyCreatePrewriteReceipt(input: {
  receipt: LazadaMyCreatePrewriteReceipt;
  readiness: Readiness;
  argumentsValue: UnknownRecord;
}) {
  const expected = await buildReceipt(input.readiness, input.argumentsValue);
  if (!sameReceipt(input.receipt, expected)) {
    throw new Error("LAZADA_MY_CREATE_PREWRITE_RECEIPT_MISMATCH");
  }
  return expected;
}

export type LazadaMyCreateProviderRequest = Readonly<{
  path: "/product/create";
  method: "POST";
  argumentsValue: UnknownRecord;
  receipt: LazadaMyCreatePrewriteReceipt;
}>;

/**
 * Last owned boundary before the shared executor may issue CreateProduct.
 * Read-only provider evidence has already been gathered in readinessInput.
 * Invalid or mutated evidence fails before beginProviderMutation and before the
 * caller-provided CreateProduct transport is invoked.
 */
export async function runLazadaMyCreatePrewrite<T>(input: {
  readinessInput: LazadaMyCreateReadinessInput;
  request: {
    path: string;
    method: string;
    argumentsValue: UnknownRecord;
  };
  claimedCurrentSource: LazadaMyCreateCurrentSourceSnapshot;
  hooks: {
    assertLeaseHealthy: () => Promise<void>;
    beginProviderMutation: () => Promise<void>;
    readCurrentSource: () => Promise<LazadaMyCreateCurrentSourceSnapshot>;
  };
  createProduct: (request: LazadaMyCreateProviderRequest) => Promise<T>;
}) {
  if (input.request.path !== "/product/create"
      || input.request.method !== "POST") {
    throw new Error("LAZADA_MY_CREATE_PROVIDER_REQUEST_INVALID");
  }
  const readiness = assertLazadaMyCreateReadiness(input.readinessInput);
  const receipt = await buildReceipt(readiness, input.request.argumentsValue);
  const readinessArgumentsSha256 = await sha256(
    input.readinessInput.argumentsValue,
  );
  if (receipt.requestSha256 !== readinessArgumentsSha256) {
    throw new Error("LAZADA_MY_CREATE_PREWRITE_ARGUMENTS_MISMATCH");
  }

  await input.hooks.assertLeaseHealthy();

  // Re-run every 010 rule after the final asynchronous lease boundary. This
  // detects evidence or payload changes made after the first validation.
  const currentReadiness = assertLazadaMyCreateReadiness(
    input.readinessInput,
  );
  const currentReceipt = await buildReceipt(
    currentReadiness,
    input.request.argumentsValue,
  );
  if (!sameReceipt(receipt, currentReceipt)) {
    throw new Error("LAZADA_MY_CREATE_PREWRITE_EVIDENCE_CHANGED");
  }
  await assertLazadaMyCreatePrewriteReceipt({
    receipt,
    readiness: currentReadiness,
    argumentsValue: input.request.argumentsValue,
  });
  assertLazadaMyCreateCurrentSource({
    claimed: input.claimedCurrentSource,
    current: await input.hooks.readCurrentSource(),
  });

  await input.hooks.beginProviderMutation();
  return {
    receipt,
    providerResult: await input.createProduct({
      path: "/product/create",
      method: "POST",
      argumentsValue: structuredClone(input.request.argumentsValue),
      receipt,
    }),
  };
}
