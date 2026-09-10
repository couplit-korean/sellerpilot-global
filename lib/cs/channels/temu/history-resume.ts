import { z } from "zod";
import { csHistoryCoverageSchema } from "../../history-coverage";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const temuHistoryAccountsSchema = z.object({
  contract: z.literal("sellerpilot-temu-cs-accounts/1"),
  checkedAt: z.string().datetime({ offset: true }),
  accounts: z.array(z.object({
    credentialId: uuid,
    label: z.string().min(1).max(120),
    environment: z.literal("production"),
    credentialFingerprint: z.string().min(1).max(200),
    sellerAccountKeyHash: digest,
  }).strict()).max(100),
}).strict();

export type TemuHistoryAccounts = z.infer<typeof temuHistoryAccountsSchema>;

export const temuHistoryCoverageReadSchema = z.object({
  contract: z.literal("cs_history_coverage_read_v2"),
  checkedAt: z.string().datetime({ offset: true }),
  credentialId: uuid,
  sellerAccountKeyHash: digest,
  coverage: csHistoryCoverageSchema,
  bindingSummary: z.object({
    exactSellerRows: z.number().int().nonnegative(),
    legacyCredentialRows: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const temuDetailRetryReadSchema = z.object({
  contract: z.literal("sellerpilot-temu-detail-retry-read/1"),
  checkedAt: z.string().datetime({ offset: true }),
  credentialId: uuid,
  sellerAccountKeyHash: digest,
  retries: z.array(z.object({
    jobId: uuid,
    retryCount: z.number().int().min(1).max(3),
    deferredCount: z.number().int().min(1).max(200),
    replayCount: z.number().int().min(0).max(200),
    providerStatus: z.number().int(),
    failureCode: z.literal("TEMU_AFTER_SALES_DETAIL_READ_FAILED"),
    observedAt: z.string().datetime({ offset: true }),
    nextAttemptAt: z.string().datetime({ offset: true }),
    outcome: z.enum(["scheduled", "retry_failed", "succeeded", "terminal_failed", "retry_exhausted"]),
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    accountBinding: z.enum(["credential_seller_exact", "legacy_credential_owner"]),
  }).strict()).max(100),
}).strict();

export const temuHistoryAccountStateSchema = z.object({
  contract: z.literal("sellerpilot-temu-history-account-state/1"),
  account: temuHistoryAccountsSchema.shape.accounts.element,
  coverage: temuHistoryCoverageReadSchema,
  retry: temuDetailRetryReadSchema,
}).strict();

export type TemuHistoryAccountState = z.infer<typeof temuHistoryAccountStateSchema>;

export const temuHistoryCursorSchema = z.object({
  date: day,
  statusGroup: z.number().int().min(1).max(7),
  pageNo: z.number().int().min(1).max(1_000_000),
}).strict();

export type TemuHistoryCursor = z.infer<typeof temuHistoryCursorSchema>;

export function temuHistoryProviderArguments(cursor: TemuHistoryCursor) {
  const start = Date.parse(`${cursor.date}T00:00:00+09:00`);
  if (!Number.isFinite(start)) throw new Error("TEMU_HISTORY_CURSOR_DATE_INVALID");
  return {
    kind: "after_sales" as const,
    includeDetails: true as const,
    pageNo: cursor.pageNo,
    pageSize: 200 as const,
    afterSalesStatusGroup: cursor.statusGroup,
    updateAtStart: Math.floor(start / 1_000),
    updateAtEnd: Math.floor((start + 86_400_000 - 1_000) / 1_000),
  };
}

const providerArgumentsSchema = z.object({
  kind: z.literal("after_sales"),
  includeDetails: z.literal(true),
  pageNo: z.number().int().min(1).max(1_000_000),
  pageSize: z.literal(200),
  afterSalesStatusGroup: z.number().int().min(1).max(7),
  updateAtStart: z.number().int().min(1_000_000_000).max(9_999_999_999),
  updateAtEnd: z.number().int().min(1_000_000_000).max(9_999_999_999),
}).strict();

export const temuHistoryCheckpointSchema = z.object({
  contract: z.literal("sellerpilot-temu-history-checkpoint/1"),
  checkedAt: z.string().datetime({ offset: true }),
  runId: uuid.nullable(),
  status: z.enum(["idle", "running", "failed", "complete", "retry_exhausted"]),
  credentialId: uuid,
  sellerAccountKeyHash: digest,
  fromDate: day,
  toDate: day,
  activeCursor: temuHistoryCursorSchema.nullable(),
  providerArguments: providerArgumentsSchema.nullable(),
  completedPageCount: z.number().int().nonnegative(),
  pendingJobCount: z.number().int().nonnegative(),
  retryCount: z.number().int().min(0).max(3),
  retryCap: z.literal(3),
  canResume: z.boolean(),
  completedPagesPreserved: z.literal(true),
  providerRetention: z.object({
    status: z.literal("unverified"),
    earliestSupportedDate: z.null(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const terminal = value.status === "complete";
  const active = value.activeCursor;
  if (value.fromDate > value.toDate
      || (terminal !== (active === null))
      || (terminal !== (value.providerArguments === null))
      || value.status === "running" && value.pendingJobCount < 1
      || value.status !== "running" && value.pendingJobCount !== 0
      || value.status === "failed" && (value.retryCount >= value.retryCap || !value.canResume)
      || value.status === "retry_exhausted" && (value.retryCount !== value.retryCap || value.canResume)
      || value.status === "complete" && value.canResume
      || value.status === "running" && value.canResume
      || value.status === "idle" && (!value.canResume || value.runId !== null || value.retryCount !== 0)) {
    context.addIssue({ code: "custom", message: "inconsistent Temu history checkpoint" });
    return;
  }
  if (active) {
    const expected = temuHistoryProviderArguments(active);
    if (active.date < value.fromDate || active.date > value.toDate
        || JSON.stringify(value.providerArguments) !== JSON.stringify(expected)) {
      context.addIssue({ code: "custom", message: "Temu history cursor and provider arguments differ" });
    }
  }
});

export type TemuHistoryCheckpoint = z.infer<typeof temuHistoryCheckpointSchema>;

const startRequest = z.object({
  action: z.literal("start"),
  requestKey: uuid,
  fromDate: day,
  toDate: day,
}).strict().superRefine((value, context) => {
  const days = (Date.parse(`${value.toDate}T00:00:00Z`) - Date.parse(`${value.fromDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (days < 1 || days > 366) context.addIssue({ code: "custom", message: "invalid Temu history range" });
});

const resumeRequest = z.object({
  action: z.literal("resume"),
  runId: uuid,
  expectedCursor: temuHistoryCursorSchema,
  expectedRetryCount: z.number().int().min(0).max(2),
}).strict();

export const temuHistoryResumeRequestSchema = z.discriminatedUnion("action", [startRequest, resumeRequest]);
export type TemuHistoryResumeRequest = z.infer<typeof temuHistoryResumeRequestSchema>;

export function temuHistoryCheckpointMatchesRequest(
  checkpoint: TemuHistoryCheckpoint,
  credentialId: string,
  request: TemuHistoryResumeRequest,
) {
  if (checkpoint.credentialId !== credentialId) return false;
  if (request.action === "start") {
    return checkpoint.fromDate === request.fromDate
      && checkpoint.toDate === request.toDate
      && checkpoint.runId !== null;
  }
  const activeCursor = checkpoint.activeCursor;
  return checkpoint.runId === request.runId
    && activeCursor !== null
    && activeCursor.date === request.expectedCursor.date
    && activeCursor.statusGroup === request.expectedCursor.statusGroup
    && activeCursor.pageNo === request.expectedCursor.pageNo
    && checkpoint.retryCount === request.expectedRetryCount + 1;
}
