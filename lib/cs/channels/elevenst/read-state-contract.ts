import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });

const surfaceBase = z.object({
  contractVersion: z.literal("sellerpilot-elevenst-readonly-web-projection/1"),
  surface: z.enum(["product_qna", "urgent_alimi"]),
  storedCount: z.number().int().nonnegative(),
  checkedAt: timestamp,
  latestStoredReceivedAt: timestamp.nullable(),
  message: z.string().min(1).max(1_000),
  replyEnabled: z.literal(false),
}).strict();

const readySurface = surfaceBase.extend({
  providerState: z.literal("ready"),
  remoteCount: z.number().int().positive(),
  storedHistoryState: z.literal("current"),
  emptyConfirmed: z.literal(false),
});

const emptySurface = surfaceBase.extend({
  providerState: z.literal("empty"),
  remoteCount: z.literal(0),
  storedHistoryState: z.literal("current"),
  emptyConfirmed: z.literal(true),
});

const failedSurface = surfaceBase.extend({
  providerState: z.enum([
    "business_error",
    "authorization_error",
    "provider_unavailable",
    "unverified_failure",
  ]),
  remoteCount: z.null(),
  storedHistoryState: z.literal("preserved_unverified"),
  emptyConfirmed: z.literal(false),
});

export const elevenstReadSurfaceSchema = z.union([
  readySurface,
  emptySurface,
  failedSurface,
]);

const limitedSurfaceBase = z.object({
  contractVersion: z.literal("sellerpilot-elevenst-limited-access-projection/2"),
  automaticReadAvailable: z.literal(false),
  automaticReplyAvailable: z.literal(false),
  remoteCount: z.null(),
  storedCount: z.null(),
  message: z.string().min(1).max(1_000),
}).strict();

const sellerTalkSurface = limitedSurfaceBase.extend({
  surface: z.literal("seller_talk"),
  accessMode: z.literal("seller_office_session_only"),
  retention: z.object({
    maximum: z.literal(3),
    unit: z.literal("month"),
    exactDays: z.null(),
  }).strict(),
  reviewedImportCandidate: z.literal("reviewed_browser_capture"),
});

const reviewSurface = limitedSurfaceBase.extend({
  surface: z.literal("review"),
  accessMode: z.literal("seller_office_export_only"),
  retention: z.null(),
  reviewedImportCandidate: z.literal("seller_office_xls_preview"),
});

export const elevenstLimitedAccessSurfaceSchema = z.union([
  sellerTalkSurface,
  reviewSurface,
]);

export const elevenstReadStateSchema = z.object({
  contractVersion: z.literal("sellerpilot-elevenst-authenticated-read-state/3"),
  sellerId: z.literal("couplit"),
  sellerName: z.literal("커플릿"),
  productQna: elevenstReadSurfaceSchema.refine(
    (value) => value.surface === "product_qna",
    "Product Q&A surface mismatch",
  ),
  urgentAlimi: elevenstReadSurfaceSchema.refine(
    (value) => value.surface === "urgent_alimi",
    "Urgent Alimi surface mismatch",
  ),
  sellerTalk: sellerTalkSurface,
  review: reviewSurface,
  readOnly: z.literal(true),
}).strict();

export type ElevenstReadSurface = z.infer<typeof elevenstReadSurfaceSchema>;
export type ElevenstLimitedAccessSurface = z.infer<typeof elevenstLimitedAccessSurfaceSchema>;
export type ElevenstReadState = z.infer<typeof elevenstReadStateSchema>;
