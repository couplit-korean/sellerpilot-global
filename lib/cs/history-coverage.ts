import { z } from "zod";
import { activeChannelKeys } from "../channels/catalog";

const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().min(0);

export const csHistoryCoverageSchema = z.object({
  contract: z.literal("cs_history_coverage_read_v1"),
  checkedAt: timestamp,
  scans: z.array(z.object({
    scanId: z.string().uuid(),
    channel: z.enum(activeChannelKeys),
    environment: z.enum(["sandbox", "production"]),
    scopeKey: z.string().min(1).max(200),
    ticketKind: z.string().regex(/^[a-z0-9:_-]{1,80}$/),
    status: z.enum(["running", "completed", "reconciliation_required", "failed"]),
    rangeStartAt: timestamp.nullable(),
    rangeEndAt: timestamp.nullable(),
    timezone: z.enum(["Asia/Seoul", "UTC"]),
    pageCount: count,
    providerRowCount: count,
    projectedEventCount: count,
    observedUniqueCount: count,
    repeatedObservationCount: count,
    excludedCount: count,
    unprocessedCount: count.nullable(),
    missingRanges: z.array(z.record(z.string(), z.unknown())).max(100),
    startedAt: timestamp,
    scanCompletedAt: timestamp.nullable(),
    reconciledAt: timestamp.nullable(),
    updatedAt: timestamp,
  }).strict()).max(100),
  gaps: z.array(z.object({
    jobId: z.string().uuid(),
    channel: z.enum(activeChannelKeys),
    environment: z.enum(["sandbox", "production"]),
    scopeKey: z.string().min(1).max(200),
    terminalStatus: z.enum(["failed", "cancelled", "reconciliation_required"]),
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    resolvedAt: timestamp.nullable(),
  }).strict()).max(100),
}).strict().superRefine((coverage, context) => {
  for (const [index, scan] of coverage.scans.entries()) {
    if ((scan.rangeStartAt === null) !== (scan.rangeEndAt === null)
        || scan.rangeStartAt && scan.rangeEndAt && scan.rangeEndAt < scan.rangeStartAt
        || scan.status === "running" && (scan.scanCompletedAt !== null || scan.reconciledAt !== null)
        || scan.status === "completed" && (!scan.scanCompletedAt || !scan.reconciledAt)
        || scan.observedUniqueCount > scan.projectedEventCount) {
      context.addIssue({ code: "custom", path: ["scans", index], message: "Invalid history coverage scan" });
    }
  }
  for (const [index, gap] of coverage.gaps.entries()) {
    if (gap.lastObservedAt < gap.firstObservedAt
        || gap.resolvedAt && gap.resolvedAt < gap.firstObservedAt) {
      context.addIssue({ code: "custom", path: ["gaps", index], message: "Invalid history coverage gap" });
    }
  }
});

export type CsHistoryCoverage = z.infer<typeof csHistoryCoverageSchema>;
