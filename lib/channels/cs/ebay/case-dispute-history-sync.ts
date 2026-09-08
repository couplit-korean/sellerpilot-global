import {
  readEbayPaymentDisputesPage,
  readEbayResolutionCasesPage,
  type EbayCaseDisputeAvailability,
} from "./cases-disputes";
import {
  recordEbayCaseDisputeHistoryPage,
  type EbayCaseDisputeHistoryRpcClient,
} from "./case-dispute-history";
import type { SecretPayload } from "../../protocols";

type SyncResult = {
  availability: EbayCaseDisputeAvailability;
  httpStatus: number | null;
  pages: number;
  total: number | null;
  observedCount: number | null;
  insertedCount: number | null;
};

type CommonInput = {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  credentialId: string;
  sellerAccountKey: string;
  serviceClient: EbayCaseDisputeHistoryRpcClient;
};

const pageLimit = 100;

function rememberIds(seen: Set<string>, ids: readonly string[]) {
  for (const id of ids) {
    if (seen.has(id)) throw new Error("EBAY_CASE_DISPUTE_HISTORY_DUPLICATE_NATIVE_ID");
    seen.add(id);
  }
}

export async function syncEbayPaymentDisputeHistory(input: CommonInput): Promise<SyncResult> {
  let offset = 0;
  let pages = 0;
  let total: number | null = null;
  let observedCount = 0;
  let insertedCount = 0;
  const seen = new Set<string>();
  while (pages < pageLimit) {
    const page = await readEbayPaymentDisputesPage({
      payload: input.payload,
      environment: input.environment,
      offset,
      limit: 200,
    });
    pages += 1;
    if (page.availability !== "readable") {
      if (pages !== 1 || observedCount !== 0) throw new Error("EBAY_CASE_DISPUTE_HISTORY_SYNC_INTERRUPTED");
      return {
        availability: page.availability,
        httpStatus: page.httpStatus,
        pages,
        total: null,
        observedCount: null,
        insertedCount: null,
      };
    }
    rememberIds(seen, page.entries.map(entry => entry.paymentDisputeId));
    const receipt = await recordEbayCaseDisputeHistoryPage({
      serviceClient: input.serviceClient,
      credentialId: input.credentialId,
      sellerAccountKey: input.sellerAccountKey,
      resourceKind: "payment_dispute",
      page,
    });
    observedCount += receipt.observedCount;
    insertedCount += receipt.insertedCount;
    total = page.total;
    if (page.nextOffset === null) return {
      availability: "readable", httpStatus: 200, pages, total, observedCount, insertedCount,
    };
    offset = page.nextOffset;
  }
  throw new Error("EBAY_CASE_DISPUTE_HISTORY_PAGE_LIMIT");
}

export async function syncEbayResolutionCaseHistoryWindow(input: CommonInput & {
  startTime: string;
  endTime: string;
  verifiedSellerIdentifiers: readonly string[];
}): Promise<SyncResult> {
  let offset = 0;
  let pages = 0;
  let total: number | null = null;
  let observedCount = 0;
  let insertedCount = 0;
  const seen = new Set<string>();
  while (pages < pageLimit) {
    const page = await readEbayResolutionCasesPage({
      payload: input.payload,
      environment: input.environment,
      startTime: input.startTime,
      endTime: input.endTime,
      offset,
      limit: 200,
      verifiedSellerIdentifiers: input.verifiedSellerIdentifiers,
    });
    pages += 1;
    if (page.availability !== "readable") {
      if (pages !== 1 || observedCount !== 0) throw new Error("EBAY_CASE_DISPUTE_HISTORY_SYNC_INTERRUPTED");
      return {
        availability: page.availability,
        httpStatus: page.httpStatus,
        pages,
        total: null,
        observedCount: null,
        insertedCount: null,
      };
    }
    rememberIds(seen, page.entries.map(entry => entry.caseId));
    const receipt = await recordEbayCaseDisputeHistoryPage({
      serviceClient: input.serviceClient,
      credentialId: input.credentialId,
      sellerAccountKey: input.sellerAccountKey,
      resourceKind: "resolution_case",
      page,
    });
    observedCount += receipt.observedCount;
    insertedCount += receipt.insertedCount;
    total = page.total;
    if (page.nextOffset === null) return {
      availability: "readable", httpStatus: 200, pages, total, observedCount, insertedCount,
    };
    offset = page.nextOffset;
  }
  throw new Error("EBAY_CASE_DISPUTE_HISTORY_PAGE_LIMIT");
}
