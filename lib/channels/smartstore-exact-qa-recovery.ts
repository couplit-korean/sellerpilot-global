export const smartstoreExactQaRecoveryContract =
  "smartstore_exact_qa_recovery_v1" as const;

export const smartstoreExactQaRecoveryArgument =
  "sellerpilotSmartstoreExactQaRecovery" as const;

export const smartstoreExactQaRecoveryIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listingId: "7babb554-48dc-4869-81b1-cd4d435d7b96",
  originProductNo: "13671684696",
  channelProductNo: "13732202182",
  centralSku: "QA-20260823-CC-001",
  priceKrw: 5_000,
});

export type SmartstoreExactQaRecoveryBinding = {
  contract: typeof smartstoreExactQaRecoveryContract;
  phase: "listing.update";
  productId: string;
  listingId: string;
  originProductNo: string;
  channelProductNo: string;
  centralSku: string;
  sellerManagementCodeSource: "provider_readback_required";
  sellerAccountLineage: "validated_by_service_rpc";
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function smartstoreExactQaRecoveryBindingValue(
  value: unknown,
): SmartstoreExactQaRecoveryBinding | null {
  const binding = recordValue(value);
  if (!binding
      || binding.contract !== smartstoreExactQaRecoveryContract
      || binding.phase !== "listing.update"
      || binding.productId !== smartstoreExactQaRecoveryIdentity.productId
      || binding.listingId !== smartstoreExactQaRecoveryIdentity.listingId
      || String(binding.originProductNo ?? "")
        !== smartstoreExactQaRecoveryIdentity.originProductNo
      || String(binding.channelProductNo ?? "")
        !== smartstoreExactQaRecoveryIdentity.channelProductNo
      || binding.centralSku !== smartstoreExactQaRecoveryIdentity.centralSku
      || binding.sellerManagementCodeSource !== "provider_readback_required"
      || binding.sellerAccountLineage !== "validated_by_service_rpc") {
    return null;
  }
  return binding as SmartstoreExactQaRecoveryBinding;
}

export function smartstoreExactQaRecoveryBinding(
  argumentsValue: Record<string, unknown>,
) {
  return smartstoreExactQaRecoveryBindingValue(
    argumentsValue[smartstoreExactQaRecoveryArgument],
  );
}

export function bindSmartstoreExactQaRecoveryArguments(
  argumentsValue: Record<string, unknown>,
) {
  const binding: SmartstoreExactQaRecoveryBinding = {
    contract: smartstoreExactQaRecoveryContract,
    phase: "listing.update",
    productId: smartstoreExactQaRecoveryIdentity.productId,
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
    channelProductNo: smartstoreExactQaRecoveryIdentity.channelProductNo,
    centralSku: smartstoreExactQaRecoveryIdentity.centralSku,
    sellerManagementCodeSource: "provider_readback_required",
    sellerAccountLineage: "validated_by_service_rpc",
  };
  return {
    ...argumentsValue,
    [smartstoreExactQaRecoveryArgument]: binding,
  };
}

export function smartstoreExactQaCreateForbidden(input: {
  productId?: string | null;
  argumentsValue?: Record<string, unknown> | null;
}) {
  if (input.productId === smartstoreExactQaRecoveryIdentity.productId) return true;
  const argumentsValue = input.argumentsValue ?? {};
  const body = recordValue(argumentsValue.body);
  const originProduct = recordValue(body?.originProduct);
  const detailAttribute = recordValue(originProduct?.detailAttribute);
  const sellerCodeInfo = recordValue(detailAttribute?.sellerCodeInfo);
  return String(argumentsValue.originProductNo ?? "")
      === smartstoreExactQaRecoveryIdentity.originProductNo
    || sellerCodeInfo?.sellerManagementCode
      === smartstoreExactQaRecoveryIdentity.centralSku;
}

export function smartstoreExactQaRecoveryCandidate(input: {
  channel: string;
  listingId?: string | null;
  remoteId?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  publishedAt?: string | null;
  failureClass?: string | null;
}) {
  return input.channel === "smartstore"
    && input.listingId === smartstoreExactQaRecoveryIdentity.listingId
    && input.remoteId === smartstoreExactQaRecoveryIdentity.originProductNo
    && input.status === "failed"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "unknown"
    && !input.providerStatus
    && !input.publishedAt
    && input.failureClass === "external_action";
}

export function smartstoreExactQaCentralSkuVerified(value: unknown) {
  const context = recordValue(value);
  const product = recordValue(context?.product);
  const manualFields = recordValue(context?.manualFields);
  const productSku = typeof product?.sku === "string" ? product.sku.trim() : "";
  const manualSku = typeof manualFields?.sellerSku === "string"
    ? manualFields.sellerSku.trim()
    : "";
  return (productSku === smartstoreExactQaRecoveryIdentity.centralSku
      || manualSku === smartstoreExactQaRecoveryIdentity.centralSku)
    && (!productSku || productSku === smartstoreExactQaRecoveryIdentity.centralSku)
    && (!manualSku || manualSku === smartstoreExactQaRecoveryIdentity.centralSku);
}
