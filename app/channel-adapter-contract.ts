import { z } from "zod";

export const primaryChannelSchema = z.enum(["qoo10", "lazada"]);
export type PrimaryChannel = z.infer<typeof primaryChannelSchema>;

export const channelContextSchema = z.object({
  organizationId: z.string().uuid(),
  channelAccountId: z.string().uuid(),
  countryCode: z.string().length(2),
  currencyCode: z.string().length(3),
  traceId: z.string().min(8),
  idempotencyKey: z.string().min(12),
});
export type ChannelContext = z.infer<typeof channelContextSchema>;

export const normalizedChannelErrorSchema = z.object({
  code: z.enum([
    "AUTH_EXPIRED",
    "AUTH_REJECTED",
    "RATE_LIMITED",
    "VALIDATION_FAILED",
    "CATEGORY_CHANGED",
    "NOT_FOUND",
    "CONFLICT",
    "REMOTE_UNAVAILABLE",
    "TIMEOUT",
    "UNKNOWN",
  ]),
  retryable: z.boolean(),
  retryAfterMs: z.number().int().positive().optional(),
  fieldErrors: z.record(z.string(), z.string()).default({}),
  remoteCode: z.string().optional(),
  safeMessage: z.string(),
});
export type NormalizedChannelError = z.infer<typeof normalizedChannelErrorSchema>;

export type AdapterResult<T> =
  | { ok: true; value: T; remoteRequestId?: string; receivedAt: string }
  | { ok: false; error: NormalizedChannelError; remoteRequestId?: string; receivedAt: string };

export const channelCategorySchema = z.object({
  externalId: z.string(),
  parentExternalId: z.string().nullable(),
  name: z.string(),
  leaf: z.boolean(),
  active: z.boolean(),
  requiredAttributes: z.array(z.object({
    externalId: z.string(),
    name: z.string(),
    valueType: z.enum(["text", "number", "boolean", "enum", "date"]),
    required: z.boolean(),
    allowedValues: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  })),
});

export const listingDraftSchema = z.object({
  internalProductId: z.string().uuid(),
  internalVariantIds: z.array(z.string().uuid()).min(1),
  externalCategoryId: z.string(),
  brandExternalId: z.string().optional(),
  locale: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  bullets: z.array(z.string()),
  attributes: z.record(z.string(), z.unknown()),
  images: z.array(z.object({ assetId: z.string().uuid(), publicUrl: z.string().url(), sha256: z.string().length(64) })).min(1),
  variants: z.array(z.object({
    internalVariantId: z.string().uuid(),
    sellerSku: z.string(),
    optionValues: z.record(z.string(), z.string()),
    price: z.number().nonnegative(),
    stock: z.number().int().nonnegative(),
  })).min(1),
  shipping: z.record(z.string(), z.unknown()),
  complianceDecisionId: z.string().uuid(),
  contentVersionId: z.string().uuid(),
  priceCalculationId: z.string().uuid(),
});
export type ListingDraft = z.infer<typeof listingDraftSchema>;

export const normalizedOrderSchema = z.object({
  externalOrderId: z.string(),
  state: z.enum(["pending", "paid", "packing", "shipped", "delivered", "cancelled", "returned"]),
  orderedAt: z.string().datetime(),
  currencyCode: z.string().length(3),
  totalAmount: z.number().nonnegative(),
  buyerEncrypted: z.record(z.string(), z.unknown()),
  shippingEncrypted: z.record(z.string(), z.unknown()),
  shippingDeadlineAt: z.string().datetime().optional(),
  lines: z.array(z.object({
    externalLineId: z.string(),
    externalProductId: z.string(),
    externalVariantId: z.string().optional(),
    sellerSku: z.string().optional(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
  rawPayload: z.record(z.string(), z.unknown()),
});
export type NormalizedOrder = z.infer<typeof normalizedOrderSchema>;

export type ListingResult = {
  externalProductId: string;
  externalVariantIds: Record<string, string>;
  state: "draft" | "review" | "active";
};

export type PullOrdersResult = {
  orders: NormalizedOrder[];
  nextCursor?: string;
  checkpoint: string;
};

/**
 * Every live channel implementation must satisfy this contract. Callers own
 * retries and job state; adapters normalize remote responses and never hide a
 * partial failure. Credentials are resolved server-side from a secret reference.
 */
export interface ChannelAdapter {
  readonly channel: PrimaryChannel;
  checkConnection(context: ChannelContext): Promise<AdapterResult<{ sellerId: string; expiresAt?: string }>>;
  refreshCredentials(context: ChannelContext): Promise<AdapterResult<{ expiresAt?: string }>>;
  syncCategories(context: ChannelContext, cursor?: string): Promise<AdapterResult<{ categories: z.infer<typeof channelCategorySchema>[]; nextCursor?: string }>>;
  uploadImage(context: ChannelContext, input: { assetId: string; bytes: Uint8Array; mediaType: string; sha256: string }): Promise<AdapterResult<{ externalUrl: string }>>;
  createListing(context: ChannelContext, draft: ListingDraft): Promise<AdapterResult<ListingResult>>;
  updateListing(context: ChannelContext, externalProductId: string, draft: ListingDraft): Promise<AdapterResult<ListingResult>>;
  updatePrice(context: ChannelContext, input: { externalProductId: string; externalVariantId?: string; price: number; currencyCode: string }): Promise<AdapterResult<{ acceptedPrice: number }>>;
  updateInventory(context: ChannelContext, input: { externalProductId: string; externalVariantId?: string; available: number }): Promise<AdapterResult<{ acceptedAvailable: number }>>;
  stopListing(context: ChannelContext, externalProductId: string, reason: string): Promise<AdapterResult<{ stopped: boolean }>>;
  pullOrders(context: ChannelContext, input: { cursor?: string; changedAfter?: string }): Promise<AdapterResult<PullOrdersResult>>;
  acknowledgeShipment(context: ChannelContext, input: { externalOrderId: string; carrierCode: string; trackingNumber: string; shippedAt: string }): Promise<AdapterResult<{ accepted: boolean }>>;
  verifyWebhook(input: { rawBody: Uint8Array; headers: Headers; receivedAt: Date }): Promise<AdapterResult<{ externalEventId: string; eventType: string; occurredAt?: string }>>;
}
