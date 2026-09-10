import {
  ebayEnvironment,
  ebayRequest,
  readRemoteResponse,
  runWithProviderReadOnlyTransport,
  textValue,
  type SecretPayload,
} from "../../protocols";

// eBay Money Back Guarantee cases and payment disputes are separate provider
// resources. This module intentionally exposes GET-only reads. Accepting or
// contesting a dispute, issuing a refund, closing a case, and appealing are
// business mutations and are not CS replies.
export const ebayCaseDisputeSupportPolicy = Object.freeze({
  resolutionCase: {
    listSupported: true,
    knownIdReadSupported: true,
    sandboxSupported: false,
    maximumSearchAgeMonths: 18,
    supportReplySupported: false,
    businessMutationOnly: true,
  },
  paymentDispute: {
    listSupported: true,
    knownIdReadSupported: true,
    activityReadSupported: true,
    supportReplySupported: false,
    businessMutationOnly: true,
  },
});

export type EbayCaseDisputeAvailability =
  | "readable"
  | "authorization_required"
  | "not_available_or_not_found"
  | "rate_limited"
  | "provider_unverified"
  | "sandbox_unsupported";

export type EbayPaymentDisputeSummary = {
  paymentDisputeId: string;
  orderId: string;
  status: string;
  reason: string;
  openDate: string;
  respondByDate: string | null;
  closedDate: string | null;
  amount: EbayCaseDisputeAmount;
};

export type EbayCaseDisputeAmount = {
  value: string;
  currency: string;
};

export type EbayPaymentDisputePage = {
  availability: EbayCaseDisputeAvailability;
  httpStatus: number | null;
  entries: EbayPaymentDisputeSummary[];
  total: number | null;
  offset: number;
  nextOffset: number | null;
};

export type EbayKnownCaseDisputeRead = {
  availability: EbayCaseDisputeAvailability;
  httpStatus: number | null;
  data: EbayPaymentDisputeDetail | EbayPaymentDisputeActivityHistory | EbayResolutionCaseDetail | null;
};

export type EbayPaymentDisputeDetail = EbayPaymentDisputeSummary & {
  revision: number | null;
  sellerResponse: string | null;
  resolutionOutcome: string | null;
  resolutionReason: string | null;
  evidenceRequestCount: number;
};

export type EbayPaymentDisputeActivity = {
  activityType: string;
  actor: string;
  activityDate: string;
};

export type EbayPaymentDisputeActivityHistory = {
  paymentDisputeId: string;
  activities: EbayPaymentDisputeActivity[];
};

export type EbayResolutionCaseSummary = {
  caseId: string;
  status: string;
  itemId: string;
  transactionId: string;
  creationDate: string;
  lastModifiedDate: string;
  respondByDate: string | null;
  claimAmount: EbayCaseDisputeAmount;
  sellerBinding: "matched" | "redacted" | "not_checked";
};

export type EbayResolutionCasePage = {
  availability: EbayCaseDisputeAvailability;
  httpStatus: number | null;
  entries: EbayResolutionCaseSummary[];
  total: number | null;
  offset: number;
  nextOffset: number | null;
  startTime: string;
  endTime: string;
};

export type EbayResolutionCaseDetail = {
  caseId: string;
  caseType: string;
  status: string;
  itemId: string;
  transactionId: string;
  returnId: string | null;
  creationDate: string;
  lastModifiedDate: string;
  expirationDate: string | null;
  claimAmount: EbayCaseDisputeAmount;
  initiator: string;
  escalatedBy: string;
  daysToExpireWithoutResponse: number | null;
};

const invalid = (field: string): never => {
  throw new Error(`EBAY_CASE_DISPUTE_CONTRACT_INVALID:${field}`);
};

function record(value: unknown, field: string): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : invalid(field);
}

function identifier(value: unknown, field: string, max = 240) {
  const text = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : value;
  if (typeof text !== "string" || !text || text.length > max || text !== text.trim()
      || [...text].some(character => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })) return invalid(field);
  return text;
}

function code(value: unknown, field: string, max = 120) {
  const text = identifier(value, field, max);
  if (!/^[A-Z][A-Z0-9_]*$/.test(text)) return invalid(field);
  return text;
}

function amount(value: unknown, field: string): EbayCaseDisputeAmount {
  const source = record(value, field);
  const raw = typeof source.value === "number" && Number.isFinite(source.value)
    ? String(source.value)
    : source.value;
  if (typeof raw !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) || raw.length > 80) {
    return invalid(`${field}.value`);
  }
  const currency = identifier(source.currency, `${field}.currency`, 3);
  if (!/^[A-Z]{3}$/.test(currency)) return invalid(`${field}.currency`);
  return { value: raw, currency };
}

function optionalRecord(value: unknown, field: string) {
  return value === undefined || value === null ? null : record(value, field);
}

function dateTimeValue(value: unknown, field: string): string;
function dateTimeValue(value: unknown, field: string, optional: true): string | null;
function dateTimeValue(value: unknown, field: string, optional = false) {
  const source = optionalRecord(value, field);
  if (!source) return optional ? null : invalid(field);
  return optionalTimestamp(source.value, `${field}.value`) ?? (optional ? null : invalid(`${field}.value`));
}

function nullableNonNegativeInteger(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  const number = typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(number) || (number as number) < 0) return invalid(field);
  return number as number;
}

function optionalTimestamp(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value !== value.trim() || !value.includes("T")
      || !Number.isFinite(Date.parse(value))) return invalid(field);
  return value;
}

function requiredTimestamp(value: unknown, field: string) {
  return optionalTimestamp(value, field) ?? invalid(field);
}

function availability(status: number): EbayCaseDisputeAvailability {
  if (status === 401 || status === 403) return "authorization_required";
  // eBay can use 404 for an unavailable resource/account as well as a missing
  // known ID. It is never evidence of an empty collection.
  if (status === 404) return "not_available_or_not_found";
  if (status === 429) return "rate_limited";
  return "provider_unverified";
}

function offsetValue(value: number | undefined) {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000) return invalid("offset");
  return offset;
}

function limitValue(value: number | undefined) {
  const limit = value ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return invalid("limit");
  return limit;
}

function caseSearchLimitValue(value: number | undefined) {
  return limitValue(value ?? 25);
}

function searchTimestamp(value: unknown, field: string) {
  const timestamp = requiredTimestamp(value, field);
  if (!timestamp.endsWith("Z")) return invalid(field);
  return timestamp;
}

function sellerBinding(value: unknown, verifiedIdentifiers: readonly string[] | undefined) {
  const seller = identifier(value, "seller", 240);
  if (!verifiedIdentifiers?.length) return "not_checked" as const;
  if (verifiedIdentifiers.includes(seller)) return "matched" as const;
  if (seller.includes("*")) return "redacted" as const;
  return invalid("sellerAccountMismatch");
}

function nextOffset(
  value: unknown,
  environment: "sandbox" | "production",
  path: string,
  offset: number,
  limit: number,
) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value || value !== value.trim()) return invalid("next");
  let next: URL;
  try { next = new URL(value); } catch { return invalid("next"); }
  const keys = [...next.searchParams.keys()];
  if (next.origin !== ebayEnvironment(environment).api || next.pathname !== path
      || next.username || next.password || next.hash
      || keys.length !== 2 || new Set(keys).size !== 2
      || next.searchParams.get("limit") !== String(limit)
      || next.searchParams.get("offset") !== String(offset + limit)) return invalid("next");
  return offset + limit;
}

async function get(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  path: string;
  query?: URLSearchParams;
}) {
  return runWithProviderReadOnlyTransport(async () => {
    if (!input.path.startsWith("/post-order/")) return ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: input.path,
      ...(input.query ? { query: input.query } : {}),
    });
    const accessToken = textValue(input.payload, "access_token");
    if (!accessToken) throw new Error("EBAY_ACCESS_TOKEN_MISSING");
    const query = input.query?.toString() ?? "";
    const response = await fetch(
      `${ebayEnvironment(input.environment).api}${input.path}${query ? `?${query}` : ""}`,
      {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `IAF ${accessToken}`,
          "x-ebay-c-marketplace-id": textValue(input.payload, "marketplace_id") || "EBAY_US",
          "user-agent": "SellerPilot-eBay-Post-Order-CS/1.0",
        },
      },
    );
    return readRemoteResponse(response);
  });
}

export async function readEbayPaymentDisputesPage(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  offset?: number;
  limit?: number;
}): Promise<EbayPaymentDisputePage> {
  const offset = offsetValue(input.offset);
  const limit = limitValue(input.limit);
  const path = "/sell/fulfillment/v1/payment_dispute_summary";
  const remote = await get({ ...input, path, query: new URLSearchParams({
    limit: String(limit), offset: String(offset),
  }) });
  if (remote.response.status !== 200) return {
    availability: availability(remote.response.status),
    httpStatus: remote.response.status,
    entries: [], total: null, offset, nextOffset: null,
  };
  const source = remote.data.paymentDisputeSummaries;
  if (!Array.isArray(source) || source.length > limit
      || remote.data.limit !== limit || remote.data.offset !== offset) return invalid("page");
  const total = remote.data.total === undefined || remote.data.total === null
    ? null
    : Number.isSafeInteger(remote.data.total) && (remote.data.total as number) >= 0
      ? remote.data.total as number
      : invalid("total");
  const cursor = nextOffset(remote.data.next, input.environment, path, offset, limit);
  if (total !== null && (offset + source.length > total
      || cursor !== null && offset + source.length >= total
      || cursor === null && offset + source.length < total)) return invalid("paginationConsistency");
  const entries = source.map((value): EbayPaymentDisputeSummary => {
    const row = record(value, "summary");
    return {
      paymentDisputeId: identifier(row.paymentDisputeId, "paymentDisputeId"),
      orderId: identifier(row.orderId, "orderId"),
      status: code(row.paymentDisputeStatus, "status"),
      reason: code(row.reason, "reason"),
      openDate: requiredTimestamp(row.openDate, "openDate"),
      respondByDate: optionalTimestamp(row.respondByDate, "respondByDate"),
      closedDate: optionalTimestamp(row.closedDate, "closedDate"),
      amount: amount(row.amount, "amount"),
    };
  });
  if (new Set(entries.map(entry => entry.paymentDisputeId)).size !== entries.length) return invalid("duplicateIdentity");
  return { availability: "readable", httpStatus: 200, entries, total, offset, nextOffset: cursor };
}

async function readKnown<T extends EbayKnownCaseDisputeRead["data"]>(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  path: string;
  parse: (data: Record<string, unknown>) => T;
}): Promise<EbayKnownCaseDisputeRead & { data: T | null }> {
  const remote = await get(input);
  if (remote.response.status !== 200) return {
    availability: availability(remote.response.status),
    httpStatus: remote.response.status,
    data: null,
  };
  return { availability: "readable", httpStatus: 200, data: input.parse(record(remote.data, "knownResource")) };
}

function paymentDisputeSummary(value: Record<string, unknown>): EbayPaymentDisputeSummary {
  return {
    paymentDisputeId: identifier(value.paymentDisputeId, "paymentDisputeId"),
    orderId: identifier(value.orderId, "orderId"),
    status: code(value.paymentDisputeStatus, "status"),
    reason: code(value.reason, "reason"),
    openDate: requiredTimestamp(value.openDate, "openDate"),
    respondByDate: optionalTimestamp(value.respondByDate, "respondByDate"),
    closedDate: optionalTimestamp(value.closedDate, "closedDate"),
    amount: amount(value.amount, "amount"),
  };
}

function paymentDisputeDetail(value: Record<string, unknown>, expectedId: string): EbayPaymentDisputeDetail {
  const summary = paymentDisputeSummary(value);
  if (summary.paymentDisputeId !== expectedId) return invalid("paymentDisputeIdMismatch");
  const resolution = optionalRecord(value.resolution, "resolution");
  const evidenceRequests = value.evidenceRequests === undefined ? [] : value.evidenceRequests;
  if (!Array.isArray(evidenceRequests) || evidenceRequests.length > 500) return invalid("evidenceRequests");
  return {
    ...summary,
    revision: nullableNonNegativeInteger(value.revision, "revision"),
    sellerResponse: value.sellerResponse === undefined || value.sellerResponse === null
      ? null : code(value.sellerResponse, "sellerResponse"),
    resolutionOutcome: resolution?.outcome === undefined || resolution?.outcome === null
      ? null : code(resolution.outcome, "resolution.outcome"),
    resolutionReason: resolution?.reasonForClosure === undefined || resolution?.reasonForClosure === null
      ? null : code(resolution.reasonForClosure, "resolution.reasonForClosure"),
    evidenceRequestCount: evidenceRequests.length,
  };
}

function paymentDisputeActivityHistory(value: Record<string, unknown>, expectedId: string): EbayPaymentDisputeActivityHistory {
  const source = value.activity;
  if (!Array.isArray(source) || source.length > 2_000) return invalid("activity");
  return {
    paymentDisputeId: expectedId,
    activities: source.map((item): EbayPaymentDisputeActivity => {
      const row = record(item, "activityEntry");
      return {
        activityType: code(row.activityType, "activityType"),
        actor: code(row.actor, "actor"),
        activityDate: requiredTimestamp(row.activityDate, "activityDate"),
      };
    }),
  };
}

function resolutionCaseDetail(value: Record<string, unknown>, expectedId: string): EbayResolutionCaseDetail {
  const caseId = identifier(value.caseId, "caseId");
  if (caseId !== expectedId) return invalid("caseIdMismatch");
  const details = record(value.caseDetails, "caseDetails");
  const deadlines = optionalRecord(value.actionDeadlines, "actionDeadlines");
  return {
    caseId,
    caseType: code(value.caseType, "caseType"),
    status: code(value.status, "status"),
    itemId: identifier(value.itemId, "itemId"),
    transactionId: identifier(value.transactionId, "transactionId"),
    returnId: value.returnId === undefined || value.returnId === null
      ? null : identifier(value.returnId, "returnId"),
    creationDate: dateTimeValue(value.creationDate, "creationDate"),
    lastModifiedDate: dateTimeValue(value.lastModifiedDate, "lastModifiedDate"),
    expirationDate: dateTimeValue(details.expirationDate, "caseDetails.expirationDate", true),
    claimAmount: amount(value.claimAmount, "claimAmount"),
    initiator: code(value.initiator, "initiator"),
    escalatedBy: code(value.escalatedBy, "escalatedBy"),
    daysToExpireWithoutResponse: nullableNonNegativeInteger(
      deadlines?.daysToExpireWithoutResponse,
      "actionDeadlines.daysToExpireWithoutResponse",
    ),
  };
}

export function readEbayPaymentDispute(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  paymentDisputeId: string;
}) {
  const paymentDisputeId = identifier(input.paymentDisputeId, "paymentDisputeId");
  return readKnown({ ...input, path: `/sell/fulfillment/v1/payment_dispute/${encodeURIComponent(paymentDisputeId)}`,
    parse: data => paymentDisputeDetail(data, paymentDisputeId) });
}

export function readEbayPaymentDisputeActivity(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  paymentDisputeId: string;
}) {
  const paymentDisputeId = identifier(input.paymentDisputeId, "paymentDisputeId");
  return readKnown({ ...input, path: `/sell/fulfillment/v1/payment_dispute/${encodeURIComponent(paymentDisputeId)}/activity`,
    parse: data => paymentDisputeActivityHistory(data, paymentDisputeId) });
}

export async function readEbayResolutionCasesPage(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  startTime: string;
  endTime: string;
  offset?: number;
  limit?: number;
  verifiedSellerIdentifiers?: readonly string[];
}): Promise<EbayResolutionCasePage> {
  const startTime = searchTimestamp(input.startTime, "startTime");
  const endTime = searchTimestamp(input.endTime, "endTime");
  if (Date.parse(startTime) >= Date.parse(endTime)
      || Date.parse(endTime) - Date.parse(startTime) > 31 * 86_400_000) return invalid("timeRange");
  const offset = offsetValue(input.offset);
  const limit = caseSearchLimitValue(input.limit);
  if (input.environment === "sandbox") return {
    availability: "sandbox_unsupported", httpStatus: null, entries: [], total: null,
    offset, nextOffset: null, startTime, endTime,
  };
  const path = "/post-order/v2/casemanagement/search";
  const remote = await get({ ...input, path, query: new URLSearchParams({
    case_creation_date_range_from: startTime,
    case_creation_date_range_to: endTime,
    limit: String(limit),
    offset: String(offset),
    sort: "Descending",
  }) });
  if (remote.response.status !== 200) return {
    availability: availability(remote.response.status), httpStatus: remote.response.status,
    entries: [], total: null, offset, nextOffset: null, startTime, endTime,
  };
  const source = remote.data.members;
  if (!Array.isArray(source) || source.length > limit) return invalid("casePage");
  const pagination = optionalRecord(remote.data.paginationOutput, "paginationOutput");
  const observedLimit = nullableNonNegativeInteger(pagination?.limit, "paginationOutput.limit");
  const observedOffset = nullableNonNegativeInteger(pagination?.offset, "paginationOutput.offset");
  const paginationTotal = nullableNonNegativeInteger(pagination?.totalEntries, "paginationOutput.totalEntries");
  const responseTotal = nullableNonNegativeInteger(remote.data.totalNumberOfCases, "totalNumberOfCases");
  const emptyZeroSentinel = source.length === 0
    && observedLimit === 0
    && observedOffset === 0
    && (paginationTotal === 0 || responseTotal === 0);
  if (!emptyZeroSentinel && (observedLimit !== null && observedLimit !== limit
      || observedOffset !== null && observedOffset !== offset
      || source.length > 0 && (!pagination || observedLimit === null || observedOffset === null))) {
    return invalid("casePagination");
  }
  if (paginationTotal !== null && responseTotal !== null && paginationTotal !== responseTotal) return invalid("caseTotalMismatch");
  const total = paginationTotal ?? responseTotal;
  if (total !== null && offset + source.length > total) return invalid("casePaginationConsistency");
  const entries = source.map((item): EbayResolutionCaseSummary => {
    const row = record(item, "caseSummary");
    return {
      caseId: identifier(row.caseId, "caseId"),
      status: code(row.caseStatusEnum, "caseStatusEnum"),
      itemId: identifier(row.itemId, "itemId"),
      transactionId: identifier(row.transactionId, "transactionId"),
      creationDate: dateTimeValue(row.creationDate, "creationDate"),
      lastModifiedDate: dateTimeValue(row.lastModifiedDate, "lastModifiedDate"),
      respondByDate: dateTimeValue(row.respondByDate, "respondByDate", true),
      claimAmount: amount(row.claimAmount, "claimAmount"),
      sellerBinding: sellerBinding(row.seller, input.verifiedSellerIdentifiers),
    };
  });
  if (new Set(entries.map(entry => entry.caseId)).size !== entries.length) return invalid("duplicateCaseIdentity");
  const hasMore = total !== null ? offset + limit < total : source.length === limit;
  return {
    availability: "readable", httpStatus: 200, entries, total, offset,
    nextOffset: hasMore ? offset + limit : null, startTime, endTime,
  };
}

export function readEbayResolutionCaseByKnownId(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  caseId: string;
}): Promise<EbayKnownCaseDisputeRead> {
  if (input.environment === "sandbox") return Promise.resolve({
    availability: "sandbox_unsupported", httpStatus: null, data: null,
  });
  const caseId = identifier(input.caseId, "caseId");
  return readKnown({ ...input, path: `/post-order/v2/casemanagement/${encodeURIComponent(caseId)}`,
    parse: data => resolutionCaseDetail(data, caseId) });
}
