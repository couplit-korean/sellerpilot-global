import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

export const lazadaRawInboxCursorSchema = z.object({
  beforeTime: timestamp,
  beforeId: uuid,
  asOf: timestamp,
}).strict();

export const lazadaRawInboxPageSchema = z.object({
  contract: z.literal("lazada_im_raw_read_v1"),
  asOf: timestamp,
  events: z.array(z.object({
    id: uuid,
    sourceKind: z.enum(["webhook", "history_page"]),
    rawBody: z.string().min(2).max(256_000),
    processingStatus: z.enum(["pending", "normalized", "unsupported", "failed"]),
    observedAt: timestamp,
    processedAt: timestamp.nullable(),
    expiresAt: timestamp,
  }).strict()).max(25),
  nextCursor: lazadaRawInboxCursorSchema.nullable(),
}).strict().superRefine((page, context) => {
  if (new Set(page.events.map((event) => event.id)).size !== page.events.length) {
    context.addIssue({ code: "custom", message: "Duplicate raw inbox events" });
  }
  if (page.events.some((event) => event.observedAt > page.asOf || event.expiresAt <= event.observedAt)) {
    context.addIssue({ code: "custom", message: "Invalid raw inbox event time" });
  }
});

export type LazadaRawInboxPage = z.infer<typeof lazadaRawInboxPageSchema>;

export const lazadaRawInboxHealthSchema = z.object({
  contract: z.literal("lazada_im_raw_health_v1"),
  capacity: z.literal(5000),
  capacityScope: z.literal("owner"),
  maximumRawBodyBytes: z.literal(256000),
  retained: z.number().int().min(0),
  retainedBytes: z.number().int().min(0),
  ownerCount: z.number().int().min(0),
  maximumOwnerRetained: z.number().int().min(0).max(5000),
  maximumOwnerRetainedBytes: z.number().int().min(0),
  pending: z.number().int().min(0),
  failed: z.number().int().min(0),
  expiringWithin24Hours: z.number().int().min(0),
  oldestPendingAt: timestamp.nullable(),
  checkedAt: timestamp,
}).strict().superRefine((health, context) => {
  if (health.pending > health.retained
      || health.failed > health.retained
      || health.expiringWithin24Hours > health.retained
      || health.pending + health.failed > health.retained
      || health.maximumOwnerRetained > health.retained
      || health.maximumOwnerRetainedBytes > health.retainedBytes
      || (health.ownerCount === 0) !== (health.retained === 0)
      || health.oldestPendingAt && health.oldestPendingAt > health.checkedAt) {
    context.addIssue({ code: "custom", message: "Invalid raw inbox health counts" });
  }
});

export type LazadaRawInboxHealth = z.infer<typeof lazadaRawInboxHealthSchema>;
