import { z } from "zod";
import { shopeeHistoryProgressSchema } from "./history-progress";
import { shopeeTransportAcceptanceSchema } from "./transport-acceptance";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const shopId = z.string().regex(/^[1-9]\d{0,31}$/u);
const country = z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/u);
const kind = z.enum(["product_review", "return_refund"]);
const eventBase = {
  eventKey: z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/u),
  sequence: z.number().int().positive(),
  scopeKey: z.string().min(1).max(200),
  shopId,
  kind,
};
const reviewCheckpoint = z.object({
  kind: z.literal("product_review"), checkpointDigest: digest, cursorDigest: digest,
  paginationEpoch: count, paginationDepth: z.number().int().min(1).max(50),
}).strict();
const returnCheckpoint = z.object({
  kind: z.literal("return_refund"), checkpointDigest: digest,
  pageNo: z.number().int().min(1).max(1_000_000), pendingDetailCount: z.number().int().min(0).max(100),
  nextListPageNo: z.number().int().min(2).max(1_000_001).nullable(),
  paginationEpoch: count, paginationDepth: z.number().int().min(1).max(50),
}).strict().refine((value) => value.pendingDetailCount > 0 || value.nextListPageNo !== null,
  "empty return checkpoint");
const checkpoint = z.discriminatedUnion("kind", [reviewCheckpoint, returnCheckpoint]);
const pageEvent = z.object({
  type: z.literal("page"), ...eventBase,
  inputCheckpointDigest: digest.nullable(), pageDigest: digest,
  remoteRecordDigests: z.array(digest).max(5_000),
  normalizedRecordDigests: z.array(digest).max(5_000),
  isolatedRecordDigests: z.array(digest).max(5_000),
  excludedRecordDigests: z.array(digest).max(5_000),
  projectedEventDigests: z.array(digest).max(5_000),
  nextCheckpoint: checkpoint.nullable(),
}).strict();
const interruptionEvent = z.object({
  type: z.literal("interruption"), ...eventBase,
  checkpointDigest: digest.nullable(),
  reason: z.enum(["failed", "authorization_required"]),
  errorCode: z.string().regex(/^[A-Z0-9:_-]{1,120}$/u),
}).strict();

const reviewScope = z.object({
  scopeKey: z.string().min(1).max(200), kind: z.literal("product_review"), shopId, country,
  coverage: z.literal("provider_cursor_corpus"),
  arguments: z.object({
    kind: z.literal("product_review"), cursor: z.literal(""), pageSize: z.literal(100), shopId,
  }).strict(),
}).strict();
const returnScope = z.object({
  scopeKey: z.string().min(1).max(200), kind: z.literal("return_refund"), shopId, country,
  coverage: z.literal("explicit_time_window"),
  arguments: z.object({
    kind: z.literal("return_refund"), createTimeFrom: z.number().int().positive().max(9_999_999_999),
    createTimeTo: z.number().int().positive().max(9_999_999_999), pageNo: z.literal(1),
    pageSize: z.literal(100), shopId,
  }).strict(),
}).strict();

export const shopeeHistoryEvidenceReadSchema = z.object({
  contract: z.literal("sellerpilot-shopee-history-events-read/1"),
  checkedAt: z.string().datetime({ offset: true }),
  historyRunId: z.string().regex(/^[a-zA-Z0-9:_-]{1,120}$/u).nullable(),
  plannedScopes: z.array(z.discriminatedUnion("kind", [reviewScope, returnScope])).max(20_000),
  observedEvents: z.array(z.discriminatedUnion("type", [pageEvent, interruptionEvent])).max(100_000),
}).strict().superRefine((value, context) => {
  if ((value.historyRunId === null) !== (value.plannedScopes.length === 0)
      || value.historyRunId === null && value.observedEvents.length !== 0) {
    context.addIssue({ code: "custom", message: "invalid empty Shopee history evidence" });
  }
});

export const shopeeHistoryReadSchema = z.object({
  contract: z.literal("sellerpilot-shopee-history-read/2"),
  checkedAt: z.string().datetime({ offset: true }),
  historyRunId: z.string().regex(/^[a-zA-Z0-9:_-]{1,120}$/u).nullable(),
  progress: shopeeHistoryProgressSchema,
  transport: shopeeTransportAcceptanceSchema,
}).strict();

export const shopeeHistoryStartSchema = z.object({
  contract: z.literal("sellerpilot-shopee-history-start/1"),
  status: z.enum(["queued", "reused", "reconnect_required"]),
  historyRunId: z.string().regex(/^[a-zA-Z0-9:_-]{1,120}$/u),
  shopCount: z.number().int().min(0).max(8),
  reviewScopeCount: count.max(8),
  returnScopeCount: count.max(20_000),
  queuedJobCount: count.max(20_000),
  reusedScopeCount: count.max(20_000),
}).strict().superRefine((value, context) => {
  if (value.queuedJobCount !== value.reviewScopeCount + value.returnScopeCount
      || value.status === "reconnect_required" && (value.shopCount !== 0 || value.queuedJobCount !== 0)) {
    context.addIssue({ code: "custom", message: "invalid Shopee history start counts" });
  }
});

export type ShopeeHistoryEvidenceRead = z.infer<typeof shopeeHistoryEvidenceReadSchema>;
export type ShopeeHistoryRead = z.infer<typeof shopeeHistoryReadSchema>;
export type ShopeeHistoryStart = z.infer<typeof shopeeHistoryStartSchema>;
