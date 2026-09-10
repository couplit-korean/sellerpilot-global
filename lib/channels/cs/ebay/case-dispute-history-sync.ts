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
  state: "complete" | "unavailable" | "interrupted" | "page_limit_reached";
  availability: EbayCaseDisputeAvailability;
  httpStatus: number | null;
  pages: number;
  completedPages: number;
  total: number | null;
  observedCount: number | null;
  insertedCount: number | null;
  resumeOffset: number | null;
  partialPageMayExist: boolean;
  interruptionReason:
    | "provider_read_failed"
    | "provider_unavailable"
    | "page_identity_conflict"
    | "history_record_failed"
    | "page_limit_reached"
    | null;
};

type CommonInput = {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  credentialId: string;
  sellerAccountKey: string;
  serviceClient: EbayCaseDisputeHistoryRpcClient;
  resumeOffset?: number;
};

export const ebayCaseDisputeHistorySyncPageSize = 200;
export const ebayCaseDisputeHistorySyncPageLimit = 100;

function resumeOffset(value: number | undefined) {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000
      || offset % ebayCaseDisputeHistorySyncPageSize !== 0) {
    throw new Error("EBAY_CASE_DISPUTE_HISTORY_RESUME_OFFSET_INVALID");
  }
  return offset;
}

function unavailableResult(
  availability: Exclude<EbayCaseDisputeAvailability, "readable">,
  httpStatus: number | null,
  pages: number,
): SyncResult {
  return {
    state: "unavailable",
    availability,
    httpStatus,
    pages,
    completedPages: 0,
    total: null,
    observedCount: null,
    insertedCount: null,
    resumeOffset: null,
    partialPageMayExist: false,
    interruptionReason: null,
  };
}

function interruptedResult(input: {
  availability: EbayCaseDisputeAvailability;
  httpStatus: number | null;
  pages: number;
  completedPages: number;
  total: number | null;
  observedCount: number;
  insertedCount: number;
  resumeOffset: number;
  partialPageMayExist: boolean;
  interruptionReason: Exclude<SyncResult["interruptionReason"], "page_limit_reached" | null>;
}): SyncResult {
  return { state: "interrupted", ...input };
}

function completedResult(input: {
  pages: number;
  completedPages: number;
  total: number | null;
  observedCount: number;
  insertedCount: number;
}): SyncResult {
  return {
    state: "complete",
    availability: "readable",
    httpStatus: 200,
    ...input,
    resumeOffset: null,
    partialPageMayExist: false,
    interruptionReason: null,
  };
}

function pageLimitResult(input: {
  pages: number;
  completedPages: number;
  total: number | null;
  observedCount: number;
  insertedCount: number;
  resumeOffset: number;
}): SyncResult {
  return {
    state: "page_limit_reached",
    availability: "readable",
    httpStatus: 200,
    ...input,
    partialPageMayExist: false,
    interruptionReason: "page_limit_reached",
  };
}

function rememberIds(seen: Set<string>, ids: readonly string[]) {
  for (const id of ids) {
    if (seen.has(id)) throw new Error("EBAY_CASE_DISPUTE_HISTORY_DUPLICATE_NATIVE_ID");
    seen.add(id);
  }
}

export async function syncEbayPaymentDisputeHistory(input: CommonInput): Promise<SyncResult> {
  const initialOffset = resumeOffset(input.resumeOffset);
  let offset = initialOffset;
  let pages = 0;
  let completedPages = 0;
  let total: number | null = null;
  let observedCount = 0;
  let insertedCount = 0;
  const seen = new Set<string>();
  while (pages < ebayCaseDisputeHistorySyncPageLimit) {
    let page: Awaited<ReturnType<typeof readEbayPaymentDisputesPage>>;
    try {
      page = await readEbayPaymentDisputesPage({
        payload: input.payload,
        environment: input.environment,
        offset,
        limit: ebayCaseDisputeHistorySyncPageSize,
      });
    } catch {
      pages += 1;
      return interruptedResult({
        availability: "provider_unverified", httpStatus: null, pages, completedPages,
        total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: false, interruptionReason: "provider_read_failed",
      });
    }
    pages += 1;
    if (page.availability !== "readable") {
      if (completedPages === 0 && initialOffset === 0) {
        return unavailableResult(page.availability, page.httpStatus, pages);
      }
      return interruptedResult({
        availability: page.availability, httpStatus: page.httpStatus, pages, completedPages,
        total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: false, interruptionReason: "provider_unavailable",
      });
    }
    try {
      rememberIds(seen, page.entries.map(entry => entry.paymentDisputeId));
    } catch {
      return interruptedResult({
        availability: "readable", httpStatus: 200, pages, completedPages,
        total: page.total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: false, interruptionReason: "page_identity_conflict",
      });
    }
    let receipt: Awaited<ReturnType<typeof recordEbayCaseDisputeHistoryPage>>;
    try {
      receipt = await recordEbayCaseDisputeHistoryPage({
        serviceClient: input.serviceClient,
        credentialId: input.credentialId,
        sellerAccountKey: input.sellerAccountKey,
        resourceKind: "payment_dispute",
        page,
      });
    } catch {
      return interruptedResult({
        availability: "readable", httpStatus: 200, pages, completedPages,
        total: page.total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: page.entries.length > 0, interruptionReason: "history_record_failed",
      });
    }
    observedCount += receipt.observedCount;
    insertedCount += receipt.insertedCount;
    completedPages += 1;
    total = page.total;
    if (page.nextOffset === null) return completedResult({
      pages, completedPages, total, observedCount, insertedCount,
    });
    offset = page.nextOffset;
  }
  return pageLimitResult({ pages, completedPages, total, observedCount, insertedCount, resumeOffset: offset });
}

export async function syncEbayResolutionCaseHistoryWindow(input: CommonInput & {
  startTime: string;
  endTime: string;
  verifiedSellerIdentifiers: readonly string[];
}): Promise<SyncResult> {
  const initialOffset = resumeOffset(input.resumeOffset);
  let offset = initialOffset;
  let pages = 0;
  let completedPages = 0;
  let total: number | null = null;
  let observedCount = 0;
  let insertedCount = 0;
  const seen = new Set<string>();
  while (pages < ebayCaseDisputeHistorySyncPageLimit) {
    let page: Awaited<ReturnType<typeof readEbayResolutionCasesPage>>;
    try {
      page = await readEbayResolutionCasesPage({
        payload: input.payload,
        environment: input.environment,
        startTime: input.startTime,
        endTime: input.endTime,
        offset,
        limit: ebayCaseDisputeHistorySyncPageSize,
        verifiedSellerIdentifiers: input.verifiedSellerIdentifiers,
      });
    } catch {
      pages += 1;
      return interruptedResult({
        availability: "provider_unverified", httpStatus: null, pages, completedPages,
        total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: false, interruptionReason: "provider_read_failed",
      });
    }
    pages += 1;
    if (page.availability !== "readable") {
      if (completedPages === 0 && initialOffset === 0) {
        return unavailableResult(page.availability, page.httpStatus, pages);
      }
      return interruptedResult({
        availability: page.availability, httpStatus: page.httpStatus, pages, completedPages,
        total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: false, interruptionReason: "provider_unavailable",
      });
    }
    try {
      rememberIds(seen, page.entries.map(entry => entry.caseId));
    } catch {
      return interruptedResult({
        availability: "readable", httpStatus: 200, pages, completedPages,
        total: page.total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: false, interruptionReason: "page_identity_conflict",
      });
    }
    let receipt: Awaited<ReturnType<typeof recordEbayCaseDisputeHistoryPage>>;
    try {
      receipt = await recordEbayCaseDisputeHistoryPage({
        serviceClient: input.serviceClient,
        credentialId: input.credentialId,
        sellerAccountKey: input.sellerAccountKey,
        resourceKind: "resolution_case",
        page,
      });
    } catch {
      return interruptedResult({
        availability: "readable", httpStatus: 200, pages, completedPages,
        total: page.total, observedCount, insertedCount, resumeOffset: offset,
        partialPageMayExist: page.entries.length > 0, interruptionReason: "history_record_failed",
      });
    }
    observedCount += receipt.observedCount;
    insertedCount += receipt.insertedCount;
    completedPages += 1;
    total = page.total;
    if (page.nextOffset === null) return completedResult({
      pages, completedPages, total, observedCount, insertedCount,
    });
    offset = page.nextOffset;
  }
  return pageLimitResult({ pages, completedPages, total, observedCount, insertedCount, resumeOffset: offset });
}
