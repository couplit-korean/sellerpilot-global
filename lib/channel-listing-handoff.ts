import { z } from "zod";

export const LISTING_HANDOFF_GET_RPC = "sellerpilot_get_listing_handoff";
export const LISTING_HANDOFF_PUT_RPC = "sellerpilot_put_listing_handoff";
export const LISTING_HANDOFF_CHANNEL = "ebay" as const;
export const LISTING_HANDOFF_ENVIRONMENTS = ["production", "sandbox"] as const;
export const LISTING_HANDOFF_FIELD_KEYS = [
  "marketplaceId",
  "fulfillmentPolicyId",
  "paymentPolicyId",
  "returnPolicyId",
  "merchantLocationKey",
] as const;

export type ListingHandoffEnvironment = (typeof LISTING_HANDOFF_ENVIRONMENTS)[number];
export type ListingHandoffFieldKey = (typeof LISTING_HANDOFF_FIELD_KEYS)[number];

const uuidSchema = z.string().uuid();
const marketSchema = z.string().regex(/^[A-Z]{2}$/);
const explicitHandoffValueSchema = z.string().trim().min(1).refine(
  (value) => value.toUpperCase() !== "SERVER_MANAGED",
  "SERVER_MANAGED is not an explicit operator handoff value",
);

export const listingHandoffQuerySchema = z.object({
  productId: uuidSchema,
  channel: z.literal(LISTING_HANDOFF_CHANNEL),
  environment: z.enum(LISTING_HANDOFF_ENVIRONMENTS),
  market: marketSchema,
}).strict();

export const listingHandoffFieldsSchema = z.object({
  marketplaceId: explicitHandoffValueSchema,
  fulfillmentPolicyId: explicitHandoffValueSchema,
  paymentPolicyId: explicitHandoffValueSchema,
  returnPolicyId: explicitHandoffValueSchema,
  merchantLocationKey: explicitHandoffValueSchema,
}).strict();

export const listingHandoffSaveSchema = listingHandoffQuerySchema.extend({
  marketplaceId: explicitHandoffValueSchema,
  fulfillmentPolicyId: explicitHandoffValueSchema,
  paymentPolicyId: explicitHandoffValueSchema,
  returnPolicyId: explicitHandoffValueSchema,
  merchantLocationKey: explicitHandoffValueSchema,
}).strict().superRefine((value, context) => {
  const expectedMarketplaceId = expectedEbayMarketplaceId(value.market);
  if (value.marketplaceId !== expectedMarketplaceId) {
    context.addIssue({
      code: "custom",
      path: ["marketplaceId"],
      message: "marketplaceId does not match the requested market",
    });
  }
});

export const listingHandoffStoredSchema = listingHandoffSaveSchema.extend({
  updatedAt: z.string().min(1).optional(),
}).strict();

export type ListingHandoffQuery = z.infer<typeof listingHandoffQuerySchema>;
export type ExplicitEbayListingHandoff = z.infer<typeof listingHandoffFieldsSchema> & {
  channel?: typeof LISTING_HANDOFF_CHANNEL;
  environment?: ListingHandoffEnvironment;
  market?: string;
};
export type StoredListingHandoff = z.infer<typeof listingHandoffStoredSchema>;
export type ListingHandoffPersistenceStatus = "saved" | "unsaved" | "error";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

export function expectedEbayMarketplaceId(market: string) {
  return `EBAY_${market.trim().toUpperCase()}`;
}

export function listingHandoffApiPath(query: ListingHandoffQuery) {
  const params = new URLSearchParams({
    productId: query.productId,
    channel: query.channel,
    environment: query.environment,
    market: query.market,
  });
  return `/api/admin/product-listing-handoff?${params.toString()}`;
}

export function parseListingHandoffQuery(value: unknown) {
  return listingHandoffQuerySchema.safeParse(value);
}

export function parseListingHandoffSave(value: unknown) {
  return listingHandoffSaveSchema.safeParse(value);
}

export function parseStoredListingHandoff(value: unknown) {
  if (value == null) return { success: true as const, data: null };
  const parsed = listingHandoffStoredSchema.safeParse(value);
  if (!parsed.success) return parsed;
  return { success: true as const, data: parsed.data };
}

export function listingHandoffRpcResult(value: unknown) {
  if (value == null) return null;
  const payload = typeof value === "string"
    ? JSON.parse(value) as unknown
    : value;
  const parsed = parseStoredListingHandoff(payload);
  if (!parsed.success) {
    throw new Error("LISTING_HANDOFF_RPC_SHAPE");
  }
  return parsed.data;
}

export function currentMarketListingHandoff(
  handoff: ExplicitEbayListingHandoff | StoredListingHandoff | null | undefined,
  input: {
    channel: string;
    market: string;
    marketplaceId?: string;
  },
): ExplicitEbayListingHandoff | null {
  if (!handoff) return null;
  const market = input.market.trim().toUpperCase();
  const marketplaceId = (input.marketplaceId ?? expectedEbayMarketplaceId(market)).trim();
  if (input.channel !== LISTING_HANDOFF_CHANNEL) return null;
  if (handoff.channel && handoff.channel !== LISTING_HANDOFF_CHANNEL) return null;
  if (handoff.market && handoff.market !== market) return null;
  if (handoff.marketplaceId !== marketplaceId) return null;
  const parsed = listingHandoffFieldsSchema.safeParse({
    marketplaceId: handoff.marketplaceId,
    fulfillmentPolicyId: handoff.fulfillmentPolicyId,
    paymentPolicyId: handoff.paymentPolicyId,
    returnPolicyId: handoff.returnPolicyId,
    merchantLocationKey: handoff.merchantLocationKey,
  });
  return parsed.success ? parsed.data : null;
}

export function listingHandoffFieldsEqual(
  left: ExplicitEbayListingHandoff | null | undefined,
  right: ExplicitEbayListingHandoff | null | undefined,
) {
  if (!left || !right) return false;
  return LISTING_HANDOFF_FIELD_KEYS.every((key) => left[key] === right[key]);
}

export function listingHandoffPersistenceStatus(
  draft: ExplicitEbayListingHandoff | null,
  stored: ExplicitEbayListingHandoff | StoredListingHandoff | null,
  error?: string | null,
): ListingHandoffPersistenceStatus {
  if (error) return "error";
  if (draft && stored && listingHandoffFieldsEqual(draft, stored)) return "saved";
  return "unsaved";
}

export function listingHandoffStatusLabel(status: ListingHandoffPersistenceStatus) {
  if (status === "saved") return "저장됨";
  if (status === "error") return "오류";
  return "미저장";
}

export function ebayListingHandoffFromDraft(
  draft: unknown,
  input: { market: string; marketplaceId?: string },
): ExplicitEbayListingHandoff | null {
  const offer = record(record(draft).offer);
  const policies = record(offer.listingPolicies);
  return currentMarketListingHandoff({
    marketplaceId: typeof offer.marketplaceId === "string"
      ? offer.marketplaceId
      : (input.marketplaceId ?? expectedEbayMarketplaceId(input.market)),
    fulfillmentPolicyId: typeof policies.fulfillmentPolicyId === "string" ? policies.fulfillmentPolicyId : "",
    paymentPolicyId: typeof policies.paymentPolicyId === "string" ? policies.paymentPolicyId : "",
    returnPolicyId: typeof policies.returnPolicyId === "string" ? policies.returnPolicyId : "",
    merchantLocationKey: typeof offer.merchantLocationKey === "string" ? offer.merchantLocationKey : "",
    channel: LISTING_HANDOFF_CHANNEL,
    market: input.market,
  }, {
    channel: LISTING_HANDOFF_CHANNEL,
    market: input.market,
    marketplaceId: input.marketplaceId ?? expectedEbayMarketplaceId(input.market),
  });
}

export function applyEbayListingHandoff(
  arguments_: UnknownRecord,
  handoff: ExplicitEbayListingHandoff,
): UnknownRecord {
  const offer = record(arguments_.offer);
  const policies = record(offer.listingPolicies);
  return {
    ...arguments_,
    offer: {
      ...offer,
      marketplaceId: handoff.marketplaceId,
      listingPolicies: {
        ...policies,
        fulfillmentPolicyId: handoff.fulfillmentPolicyId,
        paymentPolicyId: handoff.paymentPolicyId,
        returnPolicyId: handoff.returnPolicyId,
      },
      merchantLocationKey: handoff.merchantLocationKey,
    },
  };
}

export async function fetchStoredListingHandoff(
  query: ListingHandoffQuery,
  accessToken: string,
  signal?: AbortSignal,
): Promise<StoredListingHandoff | null> {
  const response = await fetch(listingHandoffApiPath(query), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => ({
    message: "판매 정책 저장값을 읽지 못했습니다.",
  })) as { handoff?: unknown; message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "판매 정책 저장값을 불러오지 못했습니다.");
  }
  const parsed = parseStoredListingHandoff(payload.handoff ?? null);
  if (!parsed.success) {
    throw new Error("저장된 판매 정책 형식이 올바르지 않습니다.");
  }
  if (parsed.data && (
    parsed.data.productId !== query.productId
    || parsed.data.channel !== query.channel
    || parsed.data.environment !== query.environment
    || parsed.data.market !== query.market
  )) {
    throw new Error("저장된 판매 정책의 상품·마켓이 일치하지 않습니다.");
  }
  return parsed.data;
}

export async function saveStoredListingHandoff(
  body: z.infer<typeof listingHandoffSaveSchema>,
  accessToken: string,
  signal?: AbortSignal,
): Promise<StoredListingHandoff> {
  const response = await fetch("/api/admin/product-listing-handoff", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({
    message: "판매 정책 저장 응답을 읽지 못했습니다.",
  })) as { handoff?: unknown; message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "판매 정책을 저장하지 못했습니다.");
  }
  const parsed = parseStoredListingHandoff(payload.handoff);
  if (!parsed.success || !parsed.data) {
    throw new Error("저장된 판매 정책 형식이 올바르지 않습니다.");
  }
  return parsed.data;
}
