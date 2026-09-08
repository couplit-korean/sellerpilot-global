import { z } from "zod";

export const csImportStatusSchema = z.enum([
  "staging",
  "preview_ready",
  "committing",
  "committed",
  "cancelled",
]);

export const csImportPreviewRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  validation: z.literal("valid"),
  outcome: z.enum(["new_ticket", "new_message", "duplicate_message"]),
  customerName: z.string().min(1).max(240),
  subject: z.string().min(1).max(500),
  messagePreview: z.string().max(500),
  status: z.enum(["waiting", "resolved"]),
  receivedAt: z.string().datetime({ offset: true }),
  externalOrderReference: z.string().max(240).nullable(),
  providerRecordId: z.string().max(240).nullable(),
}).strict();

export const csImportPreviewSchema = z.object({
  contract: z.literal("sellerpilot-cs-import-preview/1"),
  batchId: z.string().uuid(),
  status: csImportStatusSchema,
  stagedRowCount: z.number().int().nonnegative(),
  declaredRowCount: z.number().int().positive(),
  rows: z.array(csImportPreviewRowSchema).max(100),
  nextAfterRowNumber: z.number().int().positive().nullable(),
}).strict().superRefine((page, context) => {
  if (page.stagedRowCount > page.declaredRowCount) {
    context.addIssue({ code: "custom", path: ["stagedRowCount"], message: "staged row count exceeds declaration" });
  }
  if (page.nextAfterRowNumber !== null && page.rows.at(-1)?.rowNumber !== page.nextAfterRowNumber) {
    context.addIssue({ code: "custom", path: ["nextAfterRowNumber"], message: "preview cursor mismatch" });
  }
});

export type CsImportPreview = z.infer<typeof csImportPreviewSchema>;
