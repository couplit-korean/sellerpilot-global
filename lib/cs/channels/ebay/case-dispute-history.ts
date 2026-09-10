import { z } from "zod";
import type { EbayCaseDisputeAuthenticatedFetch } from "./cases-disputes";

export const ebayCaseDisputeHistoryPageSize = 50;
export const ebayCaseDisputeHistoryResourceKindSchema = z.enum(["resolution_case", "payment_dispute"]);

const identifierSchema = z.string().min(1).max(240);
const providerCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(120);
const timestampSchema = z.string().datetime({ offset: true });
const amountSchema = z.object({
  value: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();

const resolutionCaseSchema = z.object({
  caseId: identifierSchema,
  status: providerCodeSchema,
  itemId: identifierSchema,
  transactionId: identifierSchema,
  creationDate: timestampSchema,
  lastModifiedDate: timestampSchema,
  respondByDate: timestampSchema.nullable(),
  claimAmount: amountSchema,
  sellerBinding: z.enum(["matched", "redacted"]),
}).strict();

const paymentDisputeSchema = z.object({
  paymentDisputeId: identifierSchema,
  orderId: identifierSchema,
  status: providerCodeSchema,
  reason: providerCodeSchema,
  openDate: timestampSchema,
  respondByDate: timestampSchema.nullable(),
  closedDate: timestampSchema.nullable(),
  amount: amountSchema,
  revision: z.number().int().nonnegative().nullable().optional(),
  sellerResponse: providerCodeSchema.nullable().optional(),
  resolutionOutcome: providerCodeSchema.nullable().optional(),
  resolutionReason: providerCodeSchema.nullable().optional(),
  evidenceRequestCount: z.number().int().nonnegative().optional(),
}).strict();

const historyEventSchema = z.object({
  eventId: z.string().regex(/^(?:0|[1-9]\d*)$/),
  resourceKind: ebayCaseDisputeHistoryResourceKindSchema,
  providerNativeId: identifierSchema,
  providerStatus: providerCodeSchema,
  providerUpdatedAt: timestampSchema.nullable(),
  normalized: z.union([resolutionCaseSchema, paymentDisputeSchema]),
  observedStateSha256: z.string().regex(/^[0-9a-f]{64}$/),
  observedAt: timestampSchema,
}).superRefine((value, context) => {
  if ("caseId" in value.normalized) {
    if (value.resourceKind !== "resolution_case") {
      context.addIssue({ code: "custom", message: "resource kind mismatch" });
      return;
    }
    if (value.normalized.caseId !== value.providerNativeId || value.normalized.status !== value.providerStatus) {
      context.addIssue({ code: "custom", message: "provider identity mismatch" });
    }
  } else if (value.resourceKind !== "payment_dispute") {
    context.addIssue({ code: "custom", message: "resource kind mismatch" });
  } else if (value.normalized.paymentDisputeId !== value.providerNativeId
      || value.normalized.status !== value.providerStatus) {
    context.addIssue({ code: "custom", message: "provider identity mismatch" });
  }
});

export const ebayCaseDisputeHistoryPageSchema = z.object({
  contract: z.literal("sellerpilot-ebay-case-dispute-history/2"),
  credentialId: z.string().uuid(),
  resourceKind: ebayCaseDisputeHistoryResourceKindSchema.nullable(),
  events: z.array(historyEventSchema).max(ebayCaseDisputeHistoryPageSize),
  nextBeforeObservedAt: timestampSchema.nullable(),
  nextBeforeId: z.string().regex(/^(?:0|[1-9]\d*)$/).nullable(),
}).superRefine((value, context) => {
  if ((value.nextBeforeObservedAt === null) !== (value.nextBeforeId === null)) {
    context.addIssue({ code: "custom", message: "incomplete history cursor" });
  }
  if (value.resourceKind && value.events.some(event => event.resourceKind !== value.resourceKind)) {
    context.addIssue({ code: "custom", message: "mixed resource kind" });
  }
});

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/);
export const ebayCaseDisputeHistoryQuerySchema = z.object({
  credentialId: z.string().uuid(),
  resourceKind: ebayCaseDisputeHistoryResourceKindSchema.optional(),
  beforeObservedAt: timestampSchema.optional(),
  beforeId: positiveIntegerString.optional(),
  limit: positiveIntegerString.transform(Number).pipe(z.number().int().min(1).max(ebayCaseDisputeHistoryPageSize)).default(ebayCaseDisputeHistoryPageSize),
}).strict().superRefine((value, context) => {
  if (Boolean(value.beforeObservedAt) !== Boolean(value.beforeId)) {
    context.addIssue({ code: "custom", message: "incomplete history cursor" });
  }
});

export type EbayCaseDisputeHistoryResourceKind = z.infer<typeof ebayCaseDisputeHistoryResourceKindSchema>;
export type EbayCaseDisputeHistoryPage = z.infer<typeof ebayCaseDisputeHistoryPageSchema>;

export const ebayCaseDisputeHistorySyncRequestSchema = z.object({
  credentialId: z.string().uuid(),
  resourceKind: ebayCaseDisputeHistoryResourceKindSchema,
  startTime: timestampSchema.optional(),
  endTime: timestampSchema.optional(),
  resumeOffset: z.number().int().min(0).max(10_000_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.resumeOffset !== undefined && value.resumeOffset % 200 !== 0) {
    context.addIssue({ code: "custom", message: "invalid history resume offset" });
  }
  if (value.resourceKind === "resolution_case") {
    if (!value.startTime || !value.endTime
        || Date.parse(value.startTime) >= Date.parse(value.endTime)
        || Date.parse(value.endTime) - Date.parse(value.startTime) > 31 * 86_400_000) {
      context.addIssue({ code: "custom", message: "invalid case history range" });
    }
  } else if (value.startTime || value.endTime) {
    context.addIssue({ code: "custom", message: "payment dispute sync does not accept a range" });
  }
});

export const ebayCaseDisputeHistorySyncResponseSchema = z.object({
  contract: z.literal("sellerpilot-ebay-case-dispute-history-sync/1"),
  credentialId: z.string().uuid(),
  resourceKind: ebayCaseDisputeHistoryResourceKindSchema,
  state: z.enum(["complete", "unavailable", "interrupted", "page_limit_reached"]),
  availability: z.enum([
    "readable", "authorization_required", "not_available_or_not_found",
    "rate_limited", "provider_unverified", "sandbox_unsupported",
  ]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  pages: z.number().int().min(1).max(100),
  completedPages: z.number().int().min(0).max(100),
  total: z.number().int().nonnegative().nullable(),
  observedCount: z.number().int().nonnegative().nullable(),
  insertedCount: z.number().int().nonnegative().nullable(),
  resumeOffset: z.number().int().min(0).max(10_000_000).nullable(),
  partialPageMayExist: z.boolean(),
  interruptionReason: z.enum([
    "provider_read_failed", "provider_unavailable", "page_identity_conflict",
    "history_record_failed", "page_limit_reached",
  ]).nullable(),
}).superRefine((value, context) => {
  const countsValid = value.observedCount !== null && value.insertedCount !== null
    && value.insertedCount <= value.observedCount;
  if (value.completedPages > value.pages) {
    context.addIssue({ code: "custom", message: "completed pages exceed attempted pages" });
  }
  if (value.state === "complete") {
    if (value.availability !== "readable" || value.httpStatus !== 200 || !countsValid
        || value.completedPages !== value.pages || value.resumeOffset !== null
        || value.partialPageMayExist || value.interruptionReason !== null) {
      context.addIssue({ code: "custom", message: "invalid complete sync receipt" });
    }
  } else if (value.state === "unavailable") {
    if (value.availability === "readable" || value.completedPages !== 0 || value.total !== null
        || value.observedCount !== null || value.insertedCount !== null || value.resumeOffset !== null
        || value.partialPageMayExist || value.interruptionReason !== null) {
      context.addIssue({ code: "custom", message: "invalid unavailable sync receipt" });
    }
  } else if (value.state === "interrupted") {
    if (!countsValid || value.resumeOffset === null || value.interruptionReason === null
        || value.interruptionReason === "page_limit_reached"
        || (value.partialPageMayExist && value.interruptionReason !== "history_record_failed")) {
      context.addIssue({ code: "custom", message: "invalid interrupted sync receipt" });
    }
  } else if (value.availability !== "readable" || value.httpStatus !== 200 || !countsValid
      || value.completedPages !== value.pages || value.resumeOffset === null
      || value.partialPageMayExist || value.interruptionReason !== "page_limit_reached") {
    context.addIssue({ code: "custom", message: "invalid page-limit sync receipt" });
  }
});

export type EbayCaseDisputeHistorySyncResponse = z.infer<typeof ebayCaseDisputeHistorySyncResponseSchema>;

export async function readEbayCaseDisputeHistoryUiResponse(input: {
  authenticatedFetch: EbayCaseDisputeAuthenticatedFetch;
  credentialId: string;
  resourceKind?: EbayCaseDisputeHistoryResourceKind;
  beforeObservedAt?: string;
  beforeId?: string;
  signal?: AbortSignal;
}): Promise<EbayCaseDisputeHistoryPage> {
  const params = new URLSearchParams({
    credentialId: input.credentialId,
    limit: String(ebayCaseDisputeHistoryPageSize),
  });
  if (input.resourceKind) params.set("resourceKind", input.resourceKind);
  if (input.beforeObservedAt) params.set("beforeObservedAt", input.beforeObservedAt);
  if (input.beforeId) params.set("beforeId", input.beforeId);
  ebayCaseDisputeHistoryQuerySchema.parse(Object.fromEntries(params));
  const response = await input.authenticatedFetch(
    `/api/admin/cs/channels/ebay/cases-disputes/history?${params}`,
    { cache: "no-store", ...(input.signal ? { signal: input.signal } : {}) },
  );
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
      ? data.message
      : "eBay 케이스·분쟁 이력을 불러오지 못했습니다.";
    throw new Error(message);
  }
  const page = ebayCaseDisputeHistoryPageSchema.parse(data);
  if (page.credentialId !== input.credentialId || page.resourceKind !== (input.resourceKind ?? null)) {
    throw new Error("eBay 이력 계정·종류가 일치하지 않습니다.");
  }
  return page;
}

export async function syncEbayCaseDisputeHistoryUiResponse(input: {
  authenticatedFetch: EbayCaseDisputeAuthenticatedFetch;
  credentialId: string;
  resourceKind: EbayCaseDisputeHistoryResourceKind;
  startTime?: string;
  endTime?: string;
  resumeOffset?: number;
  signal?: AbortSignal;
}): Promise<EbayCaseDisputeHistorySyncResponse> {
  const body = ebayCaseDisputeHistorySyncRequestSchema.parse({
    credentialId: input.credentialId,
    resourceKind: input.resourceKind,
    ...(input.startTime ? { startTime: input.startTime } : {}),
    ...(input.endTime ? { endTime: input.endTime } : {}),
    ...(input.resumeOffset !== undefined ? { resumeOffset: input.resumeOffset } : {}),
  });
  const response = await input.authenticatedFetch(
    "/api/admin/cs/channels/ebay/cases-disputes/history/sync",
    {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
      ? data.message
      : "eBay 케이스·분쟁 이력 수집에 실패했습니다.";
    throw new Error(message);
  }
  const receipt = ebayCaseDisputeHistorySyncResponseSchema.parse(data);
  if (receipt.credentialId !== input.credentialId || receipt.resourceKind !== input.resourceKind) {
    throw new Error("eBay 수집 결과의 계정·종류가 일치하지 않습니다.");
  }
  return receipt;
}
