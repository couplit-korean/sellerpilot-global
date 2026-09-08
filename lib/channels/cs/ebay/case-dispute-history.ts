import type {
  EbayPaymentDisputePage,
  EbayResolutionCasePage,
} from "./cases-disputes";

type RpcResult = { data: unknown; error: unknown };
export type EbayCaseDisputeHistoryRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

type HistoryPageInput =
  | { resourceKind: "payment_dispute"; page: EbayPaymentDisputePage }
  | { resourceKind: "resolution_case"; page: EbayResolutionCasePage };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EBAY_CASE_DISPUTE_HISTORY_RECEIPT_INVALID");
  }
  return value as Record<string, unknown>;
}

function sellerAccountKey(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("EBAY_CASE_DISPUTE_HISTORY_SELLER_KEY_INVALID");
  return value;
}

function credentialId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("EBAY_CASE_DISPUTE_HISTORY_CREDENTIAL_INVALID");
  }
  return value;
}

export async function recordEbayCaseDisputeHistoryPage(input: {
  serviceClient: EbayCaseDisputeHistoryRpcClient;
  credentialId: string;
  sellerAccountKey: string;
} & HistoryPageInput): Promise<{ observedCount: number; insertedCount: number }> {
  if (input.page.availability !== "readable") {
    throw new Error("EBAY_CASE_DISPUTE_HISTORY_SOURCE_UNAVAILABLE");
  }
  const credential = credentialId(input.credentialId);
  const sellerKey = sellerAccountKey(input.sellerAccountKey);
  let insertedCount = 0;
  const persist = async (entry: {
    providerNativeId: string;
    providerStatus: string;
    providerUpdatedAt: string;
    normalizedSafe: Record<string, unknown>;
  }) => {
    const result = await input.serviceClient.rpc(
      "sellerpilot_service_record_ebay_case_dispute_history_v1",
      {
        p_credential_id: credential,
        p_seller_account_key: sellerKey,
        p_resource_kind: input.resourceKind,
        p_provider_native_id: entry.providerNativeId,
        p_provider_status: entry.providerStatus,
        p_provider_updated_at: entry.providerUpdatedAt,
        p_normalized_safe: entry.normalizedSafe,
      },
    );
    if (result.error) throw new Error("EBAY_CASE_DISPUTE_HISTORY_RECORD_FAILED");
    const receipt = record(result.data);
    if (receipt.contract !== "sellerpilot-ebay-case-dispute-history-record/1"
        || receipt.resourceKind !== input.resourceKind
        || receipt.providerNativeId !== entry.providerNativeId
        || typeof receipt.eventId !== "string"
        || !/^(?:0|[1-9]\d*)$/.test(receipt.eventId)
        || typeof receipt.observedStateSha256 !== "string"
        || !/^[0-9a-f]{64}$/.test(receipt.observedStateSha256)
        || typeof receipt.inserted !== "boolean") {
      throw new Error("EBAY_CASE_DISPUTE_HISTORY_RECEIPT_INVALID");
    }
    if (receipt.inserted) insertedCount += 1;
  };
  if (input.resourceKind === "resolution_case") {
    for (const entry of input.page.entries) {
      if (entry.sellerBinding === "not_checked") {
        throw new Error("EBAY_CASE_DISPUTE_HISTORY_SELLER_UNVERIFIED");
      }
      await persist({
        providerNativeId: entry.caseId,
        providerStatus: entry.status,
        providerUpdatedAt: entry.lastModifiedDate,
        normalizedSafe: entry,
      });
    }
  } else {
    for (const entry of input.page.entries) {
      await persist({
        providerNativeId: entry.paymentDisputeId,
        providerStatus: entry.status,
        providerUpdatedAt: entry.closedDate ?? entry.respondByDate ?? entry.openDate,
        normalizedSafe: entry,
      });
    }
  }
  return { observedCount: input.page.entries.length, insertedCount };
}
