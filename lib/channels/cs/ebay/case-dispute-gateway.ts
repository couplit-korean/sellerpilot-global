import { createHash } from "node:crypto";
import { z } from "zod";
import {
  readEbayPaymentDisputesPage,
  readEbayResolutionCasesPage,
} from "./cases-disputes";
import { ebayVerifiedMessageAccountIdentifiers } from "../../ebay-message-pages";
import type { ChannelOperationStep } from "../../operation-step";
import type { SecretPayload } from "../../protocols";

export const ebayCaseDisputeGatewayPageSize = 25;
export const ebayCaseDisputeRecentOverlapHours = 48;

const dayMs = 86_400_000;
const hourMs = 3_600_000;
const resourceKindSchema = z.enum(["resolution_case", "payment_dispute"]);
const collectionKindSchema = z.enum(["initial_backfill", "recent_overlap", "periodic_summary"]);
const timestampSchema = z.string().datetime({ offset: true });
const paginationDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const windowSchema = z.object({
  startTime: timestampSchema,
  endTime: timestampSchema,
}).strict().superRefine((value, context) => {
  const duration = Date.parse(value.endTime) - Date.parse(value.startTime);
  if (duration <= 0 || duration > 31 * dayMs) {
    context.addIssue({ code: "custom", message: "invalid collection window" });
  }
});

const collectionArgumentsSchema = z.object({
  kind: z.literal("case_dispute_history"),
  resourceKind: resourceKindSchema,
  collectionKind: collectionKindSchema,
  collectionAnchor: timestampSchema,
  collectionRangeStart: timestampSchema.optional(),
  collectionRangeEnd: timestampSchema.optional(),
  startTime: timestampSchema.optional(),
  endTime: timestampSchema.optional(),
  windowQueue: z.array(windowSchema).max(24).default([]),
  pageNumber: z.number().int().min(1).max(1_000_000),
  pageSize: z.literal(ebayCaseDisputeGatewayPageSize),
  marketplaceId: z.literal("EBAY_US").optional(),
  collectionRootJobId: z.string().uuid().optional(),
  collectionPlanKey: z.string().regex(/^ebay-cdh:[irp]:[0-9]{17}(?::[0-9]{17})?$/u).optional(),
  sellerpilotPaginationDepth: z.number().int().min(1).max(50).optional(),
  sellerpilotPaginationEpoch: z.number().int().min(0).max(99).optional(),
  sellerpilotPaginationTrail: z.array(paginationDigestSchema).max(50).optional(),
}).strict().superRefine((value, context) => {
  const paginationMetadataCount = [
    value.sellerpilotPaginationDepth,
    value.sellerpilotPaginationEpoch,
    value.sellerpilotPaginationTrail,
  ].filter(item => item !== undefined).length;
  if (paginationMetadataCount !== 0 && paginationMetadataCount !== 3) {
    context.addIssue({ code: "custom", message: "incomplete gateway pagination metadata" });
  }
  const anchor = Date.parse(value.collectionAnchor);
  if (anchor % hourMs !== 0) {
    context.addIssue({ code: "custom", message: "collection anchor must be an exact UTC hour" });
  }
  if (value.resourceKind === "payment_dispute") {
    if (value.collectionKind !== "periodic_summary" || value.startTime || value.endTime
        || value.collectionRangeStart || value.collectionRangeEnd || value.windowQueue.length) {
      context.addIssue({ code: "custom", message: "payment dispute collection cannot carry a range" });
    }
    return;
  }
  if (!value.startTime || !value.endTime || !value.collectionRangeStart || !value.collectionRangeEnd) {
    context.addIssue({ code: "custom", message: "resolution case collection range required" });
    return;
  }
  const current = windowSchema.safeParse({ startTime: value.startTime, endTime: value.endTime });
  if (!current.success) {
    context.addIssue({ code: "custom", message: "invalid current collection window" });
    return;
  }
  if (Date.parse(value.collectionRangeStart) > Date.parse(value.startTime)
      || Date.parse(value.collectionRangeEnd) < Date.parse(value.endTime)
      || Date.parse(value.collectionRangeEnd) !== anchor) {
    context.addIssue({ code: "custom", message: "collection window is outside its range" });
  }
  let previousEnd = Date.parse(value.endTime);
  for (const window of value.windowQueue) {
    if (Date.parse(window.startTime) !== previousEnd + 1) {
      context.addIssue({ code: "custom", message: "collection windows are not contiguous" });
      break;
    }
    previousEnd = Date.parse(window.endTime);
  }
  if (previousEnd !== Date.parse(value.collectionRangeEnd)) {
    context.addIssue({ code: "custom", message: "collection windows do not reach the range end" });
  }
  if (value.collectionKind === "recent_overlap") {
    if (value.windowQueue.length
        || Date.parse(value.startTime) !== anchor - ebayCaseDisputeRecentOverlapHours * hourMs
        || Date.parse(value.collectionRangeStart) !== Date.parse(value.startTime)) {
      context.addIssue({ code: "custom", message: "invalid recent overlap window" });
    }
  } else if (value.collectionKind === "initial_backfill"
      && Date.parse(value.collectionRangeStart) !== Date.parse(subtractUtcMonths(new Date(anchor), 18).toISOString())) {
    context.addIssue({ code: "custom", message: "invalid 18-month backfill range" });
  }
});

const amountSchema = z.object({
  value: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
const identifierSchema = z.string().min(1).max(240);
const providerCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(120);
const nullableTimestampSchema = timestampSchema.nullable();
const paymentEntrySchema = z.object({
  paymentDisputeId: identifierSchema,
  orderId: identifierSchema,
  status: providerCodeSchema,
  reason: providerCodeSchema,
  openDate: timestampSchema,
  respondByDate: nullableTimestampSchema,
  closedDate: nullableTimestampSchema,
  amount: amountSchema,
}).strict();
const resolutionEntrySchema = z.object({
  caseId: identifierSchema,
  status: providerCodeSchema,
  itemId: identifierSchema,
  transactionId: identifierSchema,
  creationDate: timestampSchema,
  lastModifiedDate: timestampSchema,
  respondByDate: nullableTimestampSchema,
  claimAmount: amountSchema,
  sellerBinding: z.enum(["matched", "redacted"]),
}).strict();
const availabilitySchema = z.enum([
  "readable", "authorization_required", "not_available_or_not_found",
  "rate_limited", "provider_unverified", "sandbox_unsupported",
]);
const commonPage = {
  availability: availabilitySchema,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  total: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
};
const gatewayPageEnvelopeSchema = z.discriminatedUnion("resourceKind", [
  z.object({
    contract: z.literal("sellerpilot-ebay-case-dispute-gateway-page/1"),
    resourceKind: z.literal("payment_dispute"),
    collectionKind: collectionKindSchema,
    page: z.object({ ...commonPage, entries: z.array(paymentEntrySchema).max(ebayCaseDisputeGatewayPageSize) }).strict(),
  }).strict(),
  z.object({
    contract: z.literal("sellerpilot-ebay-case-dispute-gateway-page/1"),
    resourceKind: z.literal("resolution_case"),
    collectionKind: collectionKindSchema,
    page: z.object({
      ...commonPage,
      entries: z.array(resolutionEntrySchema).max(ebayCaseDisputeGatewayPageSize),
      startTime: timestampSchema,
      endTime: timestampSchema,
    }).strict(),
  }).strict(),
]).superRefine((value, context) => {
  const page = value.page;
  if (page.offset % ebayCaseDisputeGatewayPageSize !== 0
      || page.nextOffset !== null && page.nextOffset !== page.offset + ebayCaseDisputeGatewayPageSize) {
    context.addIssue({ code: "custom", message: "invalid provider page offset" });
  }
  if (page.availability === "readable") {
    if (page.httpStatus !== 200) context.addIssue({ code: "custom", message: "readable page requires HTTP 200" });
  } else if (page.entries.length || page.total !== null || page.nextOffset !== null) {
    context.addIssue({ code: "custom", message: "unavailable page cannot claim rows, total, or continuation" });
  }
});

export type EbayCaseDisputeGatewayPlan = ReturnType<typeof ebayCaseDisputeGatewayPlan>;
export type EbayCaseDisputeGatewayExecution = {
  steps: ChannelOperationStep[];
  continuationArguments?: Record<string, unknown>;
};
export type EbayCaseDisputeGatewayRpc = (
  name: string,
  arguments_: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
export type EbayCaseDisputeCollectionEnqueueReceipt = {
  contract: "sellerpilot-ebay-case-dispute-collection-enqueue/1";
  anchorAt: string;
  attempted: number;
  queued: number;
  pending: number;
  scopeBlocked: number;
  deferred: number;
  status: "accepted" | "not_connected";
};

function exactUtcHour(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("EBAY_CASE_DISPUTE_SCHEDULE_TIME_INVALID");
  return new Date(Math.floor(value.getTime() / hourMs) * hourMs);
}

function subtractUtcMonths(value: Date, months: number) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() - months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(value.getUTCDate(), lastDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ));
}

function splitWindows(start: Date, end: Date) {
  const windows: Array<{ startTime: string; endTime: string }> = [];
  for (let cursor = start.getTime(); cursor < end.getTime();) {
    const windowEnd = Math.min(cursor + 30 * dayMs - 1, end.getTime());
    windows.push({
      startTime: new Date(cursor).toISOString(),
      endTime: new Date(windowEnd).toISOString(),
    });
    cursor = windowEnd + 1;
  }
  return windows;
}

function compactTime(value: string) {
  return value.replaceAll(/[-:.TZ]/gu, "");
}

export function ebayCaseDisputeGatewayPlan(now = new Date()) {
  const anchor = exactUtcHour(now);
  const initialStart = subtractUtcMonths(anchor, 18);
  const initialWindows = splitWindows(initialStart, anchor);
  const first = initialWindows[0];
  if (!first || initialWindows.length > 24) throw new Error("EBAY_CASE_DISPUTE_INITIAL_WINDOWS_INVALID");
  const recentStart = new Date(anchor.getTime() - ebayCaseDisputeRecentOverlapHours * hourMs);
  const collectionAnchor = anchor.toISOString();
  return {
    contract: "sellerpilot-ebay-case-dispute-collection-plan/1" as const,
    anchorAt: collectionAnchor,
    jobs: [{
      periodicKey: `ebay-cdh:i:${compactTime(first.startTime)}:${compactTime(collectionAnchor)}`,
      arguments: {
        kind: "case_dispute_history" as const,
        resourceKind: "resolution_case" as const,
        collectionKind: "initial_backfill" as const,
        collectionAnchor,
        collectionRangeStart: initialStart.toISOString(),
        collectionRangeEnd: collectionAnchor,
        startTime: first.startTime,
        endTime: first.endTime,
        windowQueue: initialWindows.slice(1),
        pageNumber: 1,
        pageSize: ebayCaseDisputeGatewayPageSize,
      },
    }, {
      periodicKey: `ebay-cdh:r:${compactTime(collectionAnchor)}`,
      arguments: {
        kind: "case_dispute_history" as const,
        resourceKind: "resolution_case" as const,
        collectionKind: "recent_overlap" as const,
        collectionAnchor,
        collectionRangeStart: recentStart.toISOString(),
        collectionRangeEnd: collectionAnchor,
        startTime: recentStart.toISOString(),
        endTime: collectionAnchor,
        windowQueue: [],
        pageNumber: 1,
        pageSize: ebayCaseDisputeGatewayPageSize,
      },
    }, {
      periodicKey: `ebay-cdh:p:${compactTime(collectionAnchor)}`,
      arguments: {
        kind: "case_dispute_history" as const,
        resourceKind: "payment_dispute" as const,
        collectionKind: "periodic_summary" as const,
        collectionAnchor,
        windowQueue: [],
        pageNumber: 1,
        pageSize: ebayCaseDisputeGatewayPageSize,
      },
    }],
  };
}

function safeCollectionArguments(value: Record<string, unknown>) {
  const parsed = collectionArgumentsSchema.safeParse(value);
  if (!parsed.success) throw new Error("CHANNEL_ARGUMENT_INVALID:caseDisputeHistory");
  return parsed.data;
}

export function isEbayCaseDisputeHistoryArguments(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === "case_dispute_history");
}

function collectionArgumentsWithoutPagination(
  value: z.infer<typeof collectionArgumentsSchema>,
) {
  const arguments_ = { ...value };
  delete arguments_.sellerpilotPaginationDepth;
  delete arguments_.sellerpilotPaginationEpoch;
  delete arguments_.sellerpilotPaginationTrail;
  return arguments_;
}

function nextCollectionArguments(
  arguments_: z.infer<typeof collectionArgumentsSchema>,
  observation: z.infer<typeof gatewayPageEnvelopeSchema>,
) {
  const base = collectionArgumentsWithoutPagination(arguments_);
  if (observation.page.availability !== "readable") return null;
  if (observation.page.nextOffset !== null) {
    return { ...base, pageNumber: arguments_.pageNumber + 1 };
  }
  if (arguments_.resourceKind === "resolution_case" && arguments_.windowQueue.length) {
    const [nextWindow, ...windowQueue] = arguments_.windowQueue;
    return {
      ...base,
      startTime: nextWindow.startTime,
      endTime: nextWindow.endTime,
      windowQueue,
      pageNumber: 1,
    };
  }
  return null;
}

function expectedPaginationArguments(
  current: z.infer<typeof collectionArgumentsSchema>,
  next: ReturnType<typeof nextCollectionArguments>,
) {
  if (!next) return null;
  const currentDepth = current.sellerpilotPaginationDepth ?? 0;
  let nextDepth = currentDepth + 1;
  let nextEpoch = current.sellerpilotPaginationEpoch ?? 0;
  if (currentDepth >= 49) {
    if (nextEpoch >= 99) return null;
    nextDepth = 1;
    nextEpoch += 1;
  }
  const currentTrail = current.sellerpilotPaginationTrail ?? [];
  const cursorDigest = createHash("sha256").update(JSON.stringify(next), "utf8").digest("hex");
  if (currentTrail.includes(cursorDigest)) return null;
  return {
    ...next,
    sellerpilotPaginationDepth: nextDepth,
    sellerpilotPaginationEpoch: nextEpoch,
    sellerpilotPaginationTrail: [...currentTrail, cursorDigest].slice(-50),
  };
}

type EbayCaseDisputeGatewayResult = {
  ok: boolean;
  channel: string;
  operation: string;
  steps: Array<{ name: string; ok: boolean; status: number; data: unknown }>;
  continuation?: { reason: string; arguments: Record<string, unknown> };
};

export function validateEbayCaseDisputeGatewayResult(input: {
  arguments: Record<string, unknown>;
  result: EbayCaseDisputeGatewayResult;
}) {
  const arguments_ = safeCollectionArguments(input.arguments);
  const result = input.result;
  if (result.channel !== "ebay" || result.operation !== "inquiries.list" || result.steps.length !== 1) {
    throw new Error("EBAY_CASE_DISPUTE_GATEWAY_RESULT_INVALID");
  }
  const step = result.steps[0];
  if (step.name !== "ebay-case-dispute-history-page") {
    throw new Error("EBAY_CASE_DISPUTE_GATEWAY_STEP_INVALID");
  }
  const observation = gatewayPageEnvelopeSchema.parse(step.data);
  const readable = observation.page.availability === "readable";
  if (observation.resourceKind !== arguments_.resourceKind
      || observation.collectionKind !== arguments_.collectionKind
      || step.ok !== readable
      || step.status !== (observation.page.httpStatus ?? 409)
      || result.ok !== readable) {
    throw new Error("EBAY_CASE_DISPUTE_GATEWAY_RESULT_BINDING_INVALID");
  }
  const expected = expectedPaginationArguments(
    arguments_,
    nextCollectionArguments(arguments_, observation),
  );
  if (!expected) {
    if (result.continuation !== undefined) {
      throw new Error("EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_UNEXPECTED");
    }
  } else {
    if (result.continuation?.reason !== "page_cap_reached") {
      throw new Error("EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_REQUIRED");
    }
    const actual = safeCollectionArguments(result.continuation.arguments);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_MISMATCH");
    }
  }
  return observation;
}

function gatewayPageStep(data: z.infer<typeof gatewayPageEnvelopeSchema>): ChannelOperationStep {
  const verified = gatewayPageEnvelopeSchema.parse(data);
  const readable = verified.page.availability === "readable";
  return {
    name: "ebay-case-dispute-history-page",
    ok: readable,
    status: verified.page.httpStatus ?? 409,
    data: verified,
  };
}

export async function executeEbayCaseDisputeGatewayPage(input: {
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
}): Promise<EbayCaseDisputeGatewayExecution> {
  const arguments_ = safeCollectionArguments(input.arguments);
  const offset = (arguments_.pageNumber - 1) * arguments_.pageSize;
  const page = arguments_.resourceKind === "payment_dispute"
    ? await readEbayPaymentDisputesPage({
      payload: input.payload,
      environment: input.environment,
      offset,
      limit: arguments_.pageSize,
    })
    : await readEbayResolutionCasesPage({
      payload: input.payload,
      environment: input.environment,
      startTime: arguments_.startTime!,
      endTime: arguments_.endTime!,
      offset,
      limit: arguments_.pageSize,
      verifiedSellerIdentifiers: ebayVerifiedMessageAccountIdentifiers(input.payload),
    });
  const steps = [gatewayPageStep({
    contract: "sellerpilot-ebay-case-dispute-gateway-page/1",
    resourceKind: arguments_.resourceKind,
    collectionKind: arguments_.collectionKind,
    page,
  } as z.infer<typeof gatewayPageEnvelopeSchema>)];
  if (page.availability !== "readable") return { steps };
  if (page.nextOffset !== null) {
    if (page.nextOffset !== offset + arguments_.pageSize) {
      throw new Error("EBAY_CASE_DISPUTE_GATEWAY_CURSOR_INVALID");
    }
    return {
      steps,
      continuationArguments: { ...arguments_, pageNumber: arguments_.pageNumber + 1 },
    };
  }
  if (arguments_.resourceKind === "resolution_case" && arguments_.windowQueue.length) {
    const [nextWindow, ...windowQueue] = arguments_.windowQueue;
    return {
      steps,
      continuationArguments: {
        ...arguments_,
        startTime: nextWindow.startTime,
        endTime: nextWindow.endTime,
        windowQueue,
        pageNumber: 1,
      },
    };
  }
  return { steps };
}

export async function recordEbayCaseDisputeGatewayObservation(input: {
  jobId: string;
  claimToken: string;
  tokenHash: string;
  arguments: Record<string, unknown>;
  result: EbayCaseDisputeGatewayResult;
  rpc: EbayCaseDisputeGatewayRpc;
}) {
  const observation = validateEbayCaseDisputeGatewayResult({
    arguments: input.arguments,
    result: input.result,
  });
  const response = await input.rpc(
    "sellerpilot_service_record_ebay_case_dispute_gateway_page_v2",
    {
      p_token_hash: input.tokenHash,
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_page: observation,
      p_continuation_arguments: input.result.continuation?.arguments ?? null,
    },
  );
  if (response.error || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new Error("EBAY_CASE_DISPUTE_GATEWAY_RECORD_FAILED");
  }
  const receipt = response.data as Record<string, unknown>;
  if (receipt.contract !== "sellerpilot-ebay-case-dispute-gateway-record/1"
      || receipt.jobId !== input.jobId
      || receipt.resourceKind !== observation.resourceKind
      || !["recorded", "authorization_blocked", "not_available_blocked", "deferred"].includes(String(receipt.status))
      || !Number.isInteger(receipt.observedCount)
      || !Number.isInteger(receipt.insertedCount)
      || Number(receipt.observedCount) < 0
      || Number(receipt.insertedCount) < 0
      || Number(receipt.insertedCount) > Number(receipt.observedCount)) {
    throw new Error("EBAY_CASE_DISPUTE_GATEWAY_RECEIPT_INVALID");
  }
  return receipt;
}

export async function enqueueEbayCaseDisputeGatewayPlan(input: {
  rpc: EbayCaseDisputeGatewayRpc;
  now?: Date;
}): Promise<EbayCaseDisputeCollectionEnqueueReceipt> {
  const plan = ebayCaseDisputeGatewayPlan(input.now);
  const response = await input.rpc("sellerpilot_service_enqueue_ebay_case_dispute_collection_v2", {
    p_plan: plan,
  });
  if (response.error || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new Error("EBAY_CASE_DISPUTE_GATEWAY_ENQUEUE_FAILED");
  }
  const receipt = response.data as Record<string, unknown>;
  if (receipt.contract !== "sellerpilot-ebay-case-dispute-collection-enqueue/1"
      || receipt.anchorAt !== plan.anchorAt
      || !Number.isInteger(receipt.attempted)
      || !Number.isInteger(receipt.queued)
      || !Number.isInteger(receipt.pending)
      || !Number.isInteger(receipt.scopeBlocked)
      || !Number.isInteger(receipt.deferred)
      || !["accepted", "not_connected"].includes(String(receipt.status))
      || [receipt.attempted, receipt.queued, receipt.pending, receipt.scopeBlocked, receipt.deferred]
        .some(value => Number(value) < 0)) {
    throw new Error("EBAY_CASE_DISPUTE_GATEWAY_ENQUEUE_RECEIPT_INVALID");
  }
  return receipt as EbayCaseDisputeCollectionEnqueueReceipt;
}

export function ebayCaseDisputeNativeIdDigest(
  sellerAccountKey: string,
  resourceKind: "resolution_case" | "payment_dispute",
  nativeId: string,
) {
  return createHash("sha256")
    .update(["sellerpilot-ebay-case-dispute-seen/1", sellerAccountKey, resourceKind, nativeId].join("\u001f"))
    .digest("hex");
}
