import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const status = z.enum(["pending", "partial", "complete", "failed", "authorization_required"]);
const kind = z.enum(["product_review", "return_refund"]);
const reviewCheckpoint = z.object({
  kind: z.literal("product_review"),
  checkpointDigest: digest,
  cursorDigest: digest,
  paginationEpoch: count,
  paginationDepth: z.number().int().min(1).max(50),
}).strict();
const returnCheckpoint = z.object({
  kind: z.literal("return_refund"),
  checkpointDigest: digest,
  pageNo: z.number().int().min(1).max(1_000_000),
  pendingDetailCount: z.number().int().min(0).max(100),
  nextListPageNo: z.number().int().min(2).max(1_000_001).nullable(),
  paginationEpoch: count,
  paginationDepth: z.number().int().min(1).max(50),
}).strict().refine((checkpoint) =>
  checkpoint.pendingDetailCount > 0 || checkpoint.nextListPageNo !== null,
"empty return checkpoint");
const checkpoint = z.discriminatedUnion("kind", [reviewCheckpoint, returnCheckpoint]);

const counters = {
  remoteUniqueCount: count,
  normalizedUniqueCount: count,
  projectedEventUniqueCount: count,
  duplicateRemoteCount: count,
  isolatedUniqueCount: count,
  excludedUniqueCount: count,
  unprocessedUniqueCount: count,
  replayedEventCount: count,
};

const scopeSchema = z.object({
  scopeKey: z.string().min(1).max(200),
  shopId: z.string().regex(/^[1-9]\d{0,31}$/u),
  country: z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/u),
  kind,
  status,
  coverage: z.enum(["provider_cursor_corpus", "explicit_time_window"]),
  pageCount: count,
  ...counters,
  activeCheckpoint: checkpoint.nullable(),
  lastErrorCode: z.string().regex(/^[A-Z0-9:_-]{1,120}$/u).nullable(),
  range: z.object({
    from: z.number().int().positive().max(9_999_999_999),
    to: z.number().int().positive().max(9_999_999_999),
  }).strict().nullable(),
}).strict().superRefine((scope, context) => {
  if (scope.normalizedUniqueCount + scope.isolatedUniqueCount
      + scope.excludedUniqueCount + scope.unprocessedUniqueCount !== scope.remoteUniqueCount
      || scope.kind === "product_review" && (scope.coverage !== "provider_cursor_corpus" || scope.range !== null)
      || scope.kind === "return_refund" && (scope.coverage !== "explicit_time_window"
        || !scope.range || scope.range.from >= scope.range.to)
      || scope.activeCheckpoint && scope.activeCheckpoint.kind !== scope.kind
      || scope.status === "complete" && scope.activeCheckpoint !== null
      || scope.status === "pending" && (scope.pageCount !== 0 || scope.lastErrorCode !== null)) {
    context.addIssue({ code: "custom", message: "invalid Shopee history scope projection" });
  }
});

const shopKindSchema = z.object({
  shopId: z.string().regex(/^[1-9]\d{0,31}$/u),
  country: z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/u),
  kind,
  status,
  plannedScopeCount: z.number().int().positive(),
  completedScopeCount: count,
  failedScopeCount: count,
  authorizationRequiredScopeCount: count,
  remainingScopeKeys: z.array(z.string().min(1).max(200)).max(20_000),
  activeCheckpointDigests: z.array(digest).max(20_000),
  knownPendingDetailCount: count,
  providerRemainderUnknown: z.boolean(),
  ...counters,
}).strict().superRefine((group, context) => {
  if (group.completedScopeCount > group.plannedScopeCount
      || group.remainingScopeKeys.length !== group.plannedScopeCount - group.completedScopeCount
      || group.normalizedUniqueCount + group.isolatedUniqueCount
        + group.excludedUniqueCount + group.unprocessedUniqueCount !== group.remoteUniqueCount
      || group.status === "complete" && group.remainingScopeKeys.length !== 0) {
    context.addIssue({ code: "custom", message: "invalid Shopee shop-kind projection" });
  }
});

export const shopeeHistoryProgressSchema = z.object({
  contract: z.literal("sellerpilot-shopee-history-progress/1"),
  scopes: z.array(scopeSchema).max(20_000),
  shopKinds: z.array(shopKindSchema).max(16),
}).strict();

export type ShopeeHistoryProgressRead = z.infer<typeof shopeeHistoryProgressSchema>;
