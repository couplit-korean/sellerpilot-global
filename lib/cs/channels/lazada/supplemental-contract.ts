import { z } from "zod";

export const lazadaSupplementalSurfaceSchema = z.enum([
  "product_review",
  "reverse_order_after_sales",
]);

export const lazadaSupplementalSourcePathSchema = z.enum([
  "/review/seller/list",
  "/reverse/getreverseordersforseller",
  "/order/reverse/return/detail/list",
  "/order/reverse/return/history/list",
]);

export const lazadaSupplementalStoredEventSchema = z.object({
  credentialId: z.string().uuid(),
  country: z.string().regex(/^[A-Z]{2}$/u),
  surface: lazadaSupplementalSurfaceSchema,
  sourcePath: lazadaSupplementalSourcePathSchema,
  resourceKey: z.string().min(1).max(240),
  eventKey: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  body: z.string().max(5_000).nullable(),
  externalOrderId: z.string().min(1).max(240).nullable(),
  externalItemId: z.string().min(1).max(240).nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
  providerContext: z.record(z.string(), z.string()),
}).strict();

export const lazadaSupplementalCapabilitySchema = z.object({
  surface: lazadaSupplementalSurfaceSchema,
  state: z.enum(["conditional", "permission_pending"]),
  adapterReady: z.literal(true),
  livePermissionObserved: z.literal(false),
  automaticReadEnabled: z.literal(false),
  replyEnabled: z.literal(false),
  mutationsEnabled: z.literal(false),
  message: z.string().min(1).max(1_000),
}).strict();

export const lazadaSupplementalReadResponseSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-read-ui/1"),
  readOnly: z.literal(true),
  liveProviderRead: z.literal(false),
  capabilities: z.array(lazadaSupplementalCapabilitySchema).length(2),
  events: z.array(lazadaSupplementalStoredEventSchema).max(100),
  nextCursor: z.object({
    occurredAt: z.string().datetime({ offset: true }),
    eventKey: z.string().regex(/^[a-f0-9]{64}$/u),
    credentialId: z.string().uuid(),
    country: z.string().regex(/^[A-Z]{2}$/u),
  }).strict().nullable(),
}).strict();

export type LazadaSupplementalSurface = z.infer<typeof lazadaSupplementalSurfaceSchema>;
export type LazadaSupplementalSourcePath = z.infer<typeof lazadaSupplementalSourcePathSchema>;
export type LazadaSupplementalStoredEvent = z.infer<typeof lazadaSupplementalStoredEventSchema>;
export type LazadaSupplementalReadResponse = z.infer<typeof lazadaSupplementalReadResponseSchema>;

export function parseLazadaSupplementalReadResponse(value: unknown) {
  return lazadaSupplementalReadResponseSchema.parse(value);
}
