import { z } from "zod";
const delivery = z.object({
  jobId: z.string().uuid(), ticketId: z.string().uuid(), channel: z.string(), inboundKey: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "reconciliation_required"]),
  safeMessage: z.string().nullable(), reconciliationReason: z.string().nullable(),
  providerRequestId: z.string().nullable(), providerMessageId: z.string().nullable(),
  queuedAt: z.string(), startedAt: z.string().nullable(), completedAt: z.string().nullable(), updatedAt: z.string(),
}).passthrough();
export const csSnapshotSchema = z.object({
  contract: z.literal("sellerpilot-cs-snapshot/1"), generatedAt: z.string().datetime({ offset: true }),
  tickets: z.array(z.object({
    id: z.string().uuid(), externalTicketId: z.string(), channelKey: z.string(), channelCode: z.string(),
    customerName: z.string(), subject: z.string(), message: z.string(), translatedMessage: z.string().nullable(),
    replyDraft: z.string().nullable(), replyDeliveryStatus: z.enum(["never", "preparing", "sending", "succeeded", "failed", "reconciliation_required"]),
    replyDeliveryError: z.string().nullable(), replyOperationAttemptId: z.string().nullable(), replyGatewayJobId: z.string().nullable(),
    orderId: z.string().nullable(), externalOrderReference: z.string().nullable(),
    providerStatus: z.enum(["unknown", "waiting", "answered", "closed"]), providerContext: z.record(z.string(), z.unknown()),
    latestInboundKey: z.string().nullable(), ticketKind: z.enum(["conversation", "after_sales"]),
    latestMessageState: z.enum(["normal", "recalled", "conflict_review_required"]).optional(), replyAllowed: z.boolean().optional(),
    delivery: delivery.nullable().optional(), blockingDelivery: delivery.nullable().optional(),
    status: z.enum(["urgent", "waiting", "in_progress", "resolved"]), priority: z.number(),
    receivedAt: z.string(), updatedAt: z.string(), demo: z.boolean(),
  }).passthrough()),
  syncStatus: z.array(z.object({ channel_key: z.string(), data_type: z.literal("inquiries"),
    status: z.enum(["never", "queued", "running", "passed", "failed", "unsupported"]), imported_count: z.number(),
    last_started_at: z.string().nullable(), last_succeeded_at: z.string().nullable(), last_error: z.string().nullable(), updated_at: z.string() })),
  deliverySummary: z.record(z.string(), z.unknown()),
});
export type CsSnapshot = z.infer<typeof csSnapshotSchema>;
