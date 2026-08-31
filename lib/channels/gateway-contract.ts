import { z } from "zod";
import { channelOperationNames, writeChannelOperations, type ChannelOperationName } from "./operations";
import {
  listingOperationRequiresVerifiedRemoteState,
  listingOperationUsesPublicationIntent,
  listingPublicationLocaleSchema,
  listingPublicationIntentSchema,
  listingRemoteStateContractSchema,
  listingRemoteStateFulfillsOperation,
  listingRemoteStateMatchesOperation,
  listingRemoteStateVerifiedAtOrAfterJobBoundary,
  verifiedListingRemoteStateSchema,
} from "./listing-publication-state";

const gatewayChannelSchema = z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]);

const credentialPayloadSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 64_000,
  "credential payload too large",
);

const canonicalCredentialExpirySchema = z.string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .nullable();

export const gatewayClaimSchema = z.object({
  id: z.string().uuid(),
  claim_token: z.string().uuid(),
  credential_id: z.string().uuid(),
  channel: gatewayChannelSchema,
  operation: z.union([
    z.literal("oauth.exchange"),
    z.literal("shops.get"),
    z.literal("diagnostic.test"),
    z.literal("competitor.search"),
    z.literal("listing.lineage.verify"),
    z.enum(channelOperationNames),
  ]),
  environment: z.enum(["sandbox", "production"]),
  request: z.record(z.string(), z.unknown()),
  credential: credentialPayloadSchema,
  attempt_count: z.number().int().min(1).max(6),
}).superRefine((value, context) => {
  if (!listingOperationRequiresVerifiedRemoteState(value.operation)) return;
  const argumentsValue = value.request.arguments;
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) return;
  const listingArguments = argumentsValue as Record<string, unknown>;
  const remoteStateContract = listingArguments.publicationStateContract;
  if (remoteStateContract !== undefined && !listingRemoteStateContractSchema.safeParse(remoteStateContract).success) {
    context.addIssue({
      code: "custom",
      path: ["request", "arguments", "publicationStateContract"],
      message: "invalid listing remote-state contract",
    });
  }
  const publicationIntent = listingArguments.publicationIntent;
  // Existing queued jobs predate publication intent. They remain readable and
  // executable as legacy jobs, while every new admin request injects the
  // normalized default before it is enqueued.
  if (listingOperationUsesPublicationIntent(value.operation)
      && publicationIntent !== undefined
      && !listingPublicationIntentSchema.safeParse(publicationIntent).success) {
    context.addIssue({
      code: "custom",
      path: ["request", "arguments", "publicationIntent"],
      message: "invalid listing publication intent",
    });
  } else if (!listingOperationUsesPublicationIntent(value.operation) && publicationIntent !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["request", "arguments", "publicationIntent"],
      message: "listing operation does not use publication intent",
    });
  }
  if (remoteStateContract === "verified_remote_state_v1") {
    if (!listingPublicationLocaleSchema.safeParse(listingArguments.publicationExpectedLocale).success) {
      context.addIssue({
        code: "custom",
        path: ["request", "arguments", "publicationExpectedLocale"],
        message: "verified listing request requires its server-owned locale",
      });
    }
    if (!z.string().regex(/^[a-f0-9]{64}$/u).safeParse(listingArguments.publicationExpectedFingerprint).success) {
      context.addIssue({
        code: "custom",
        path: ["request", "arguments", "publicationExpectedFingerprint"],
        message: "verified listing request requires its request fingerprint",
      });
    }
    if (!z.number().int().min(0).max(64).safeParse(listingArguments.publicationExpectedImageCount).success) {
      context.addIssue({
        code: "custom",
        path: ["request", "arguments", "publicationExpectedImageCount"],
        message: "verified listing request requires its image-count floor",
      });
    }
  }
});

const paginationContinuationSchema = z.object({
  reason: z.literal("page_cap_reached"),
  arguments: z.record(z.string(), z.unknown()).superRefine((value, context) => {
    if (JSON.stringify(value).length > 64_000) {
      context.addIssue({ code: "custom", message: "pagination continuation too large" });
    }
    const depth = value.sellerpilotPaginationDepth;
    if (!Number.isInteger(depth) || Number(depth) < 1 || Number(depth) > 50) {
      context.addIssue({ code: "custom", message: "invalid pagination continuation depth" });
    }
  }),
}).strict();

const operationResultSchema = z.object({
  ok: z.boolean(),
  channel: gatewayChannelSchema,
  operation: z.enum(channelOperationNames),
  steps: z.array(z.object({
    name: z.string().min(1).max(160),
    ok: z.boolean(),
    status: z.number().int().min(0).max(999),
    requestId: z.string().max(160).optional(),
    data: z.record(z.string(), z.unknown()),
  })).min(1).max(128),
  remoteId: z.string().max(240).optional(),
  publicUrl: z.string().url().max(1_000).optional(),
  publicationIntent: listingPublicationIntentSchema.optional(),
  publicationStateContract: listingRemoteStateContractSchema.optional(),
  remoteState: verifiedListingRemoteStateSchema.optional(),
  publicationFulfilled: z.boolean().optional(),
  continuation: paginationContinuationSchema.optional(),
  safeMessage: z.string().min(1).max(1_000),
}).superRefine((value, context) => {
  if (listingOperationRequiresVerifiedRemoteState(value.operation)
      && !value.publicationStateContract
      && (value.publicationIntent !== undefined
        || value.remoteState !== undefined
        || value.publicationFulfilled !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["publicationStateContract"],
      message: "listing publication fields require the verified remote-state contract",
    });
  }
  if (value.publicationStateContract && !listingOperationRequiresVerifiedRemoteState(value.operation)) {
    context.addIssue({
      code: "custom",
      path: ["publicationStateContract"],
      message: "remote-state contract is only valid for verified listing operations",
    });
  }
  if (value.ok && listingOperationRequiresVerifiedRemoteState(value.operation)) {
    if (!value.publicationStateContract) {
      context.addIssue({
        code: "custom",
        path: ["publicationStateContract"],
        message: "successful listing operation requires the verified remote-state contract",
      });
    } else if (!value.remoteState) {
      context.addIssue({
        code: "custom",
        path: ["remoteState"],
        message: "successful listing operation requires verified remote state",
      });
    } else if (listingOperationUsesPublicationIntent(value.operation) && !value.publicationIntent) {
      context.addIssue({
        code: "custom",
        path: ["publicationIntent"],
        message: "listing operation requires its bound publication intent",
      });
    } else if (!listingOperationUsesPublicationIntent(value.operation) && value.publicationIntent) {
      context.addIssue({
        code: "custom",
        path: ["publicationIntent"],
        message: "listing stop cannot change publication intent",
      });
    } else if (!listingRemoteStateMatchesOperation(value.operation, value.remoteState, value.publicationIntent)) {
      context.addIssue({
        code: "custom",
        path: ["remoteState", "visibility"],
        message: "verified remote visibility does not match publication intent",
      });
    } else if (value.publicationFulfilled === undefined) {
      context.addIssue({
        code: "custom",
        path: ["publicationFulfilled"],
        message: "successful listing mutation requires a publication fulfillment decision",
      });
    } else if (value.publicationFulfilled !== listingRemoteStateFulfillsOperation(value.operation, value.remoteState, value.publicationIntent)) {
      context.addIssue({
        code: "custom",
        path: ["publicationFulfilled"],
        message: "publication fulfillment does not match verified remote visibility",
      });
    }
  }
  if (value.remoteState && value.remoteState.visibility !== "live" && value.publicUrl) {
    context.addIssue({
      code: "custom",
      path: ["publicUrl"],
      message: "non-public listing state cannot expose a public URL",
    });
  }

  if (value.continuation) {
    if (value.ok !== true || (value.operation !== "orders.list" && value.operation !== "inquiries.list")) {
      context.addIssue({ code: "custom", message: "pagination continuation requires a successful sync page" });
      return;
    }
    const next = value.continuation.arguments;
    const query = next.query && typeof next.query === "object" && !Array.isArray(next.query)
      ? next.query as Record<string, unknown>
      : {};
    const queryParams = next.queryParams && typeof next.queryParams === "object" && !Array.isArray(next.queryParams)
      ? next.queryParams as Record<string, unknown>
      : {};
    const positiveInteger = (item: unknown) => Number.isInteger(Number(item)) && Number(item) >= 1;
    const nonNegativeInteger = (item: unknown) => Number.isInteger(Number(item)) && Number(item) >= 0;
    const nonEmpty = (item: unknown) => typeof item === "string" && item.trim().length > 0;
    const valid = value.channel === "shopee" && value.operation === "orders.list"
      ? nonEmpty(query.cursor)
      : value.channel === "lazada" && value.operation === "orders.list"
        ? nonNegativeInteger(queryParams.offset)
        : value.channel === "coupang" && value.operation === "orders.list"
          ? nonEmpty(query.nextToken)
          : value.channel === "coupang" && value.operation === "inquiries.list"
            ? positiveInteger(query.pageNum)
            : value.channel === "smartstore" && value.operation === "orders.list"
              ? nonEmpty(query.lastChangedFrom) && nonEmpty(query.moreSequence)
              : value.channel === "smartstore" && value.operation === "inquiries.list"
                ? positiveInteger(query.page)
                : value.channel === "ebay" && value.operation === "orders.list"
                  ? nonNegativeInteger(query.offset)
                  : value.channel === "ebay" && value.operation === "inquiries.list"
                    ? positiveInteger(next.pageNumber)
                    : value.channel === "temu" && value.operation === "orders.list"
                      ? positiveInteger(next.pageNumber)
                      : value.channel === "temu" && value.operation === "inquiries.list"
                        ? positiveInteger(next.pageNo)
                        : false;
    if (!valid) context.addIssue({ code: "custom", message: "invalid provider pagination continuation" });
  }
});

const credentialRefreshSchema = z.object({
  payload: credentialPayloadSchema,
  expiresAt: canonicalCredentialExpirySchema,
  recoveryOnly: z.boolean().optional(),
  oauthComplete: z.boolean().optional(),
});

export const gatewayCredentialRefreshStageSchema = z.object({
  action: z.literal("stage"),
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  credentialRefresh: credentialRefreshSchema,
});

export const gatewayCredentialRefreshLifecycleSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("begin"),
    jobId: z.string().uuid(),
    claimToken: z.string().uuid(),
  }),
  gatewayCredentialRefreshStageSchema,
]);

const diagnosticResultSchema = z.object({
  ok: z.boolean(),
  channel: gatewayChannelSchema,
  operation: z.literal("diagnostic.test"),
  diagnostic: z.object({
    status: z.enum(["passed", "failed", "manual"]),
    message: z.string().min(1).max(1_000),
    remoteRequestId: z.string().max(160).optional(),
  }),
  safeMessage: z.string().min(1).max(1_000),
});

const competitorSearchResultSchema = z.object({
  ok: z.literal(true),
  channel: z.literal("elevenst"),
  operation: z.literal("competitor.search"),
  items: z.array(z.object({
    provider: z.literal("elevenst_product_search"),
    externalId: z.string().min(1).max(500),
    title: z.string().min(1).max(1_000),
    url: z.string().url().max(4_000),
    imageUrl: z.string().url().max(4_000).or(z.literal("")),
    mallName: z.string().max(240),
    marketplace: z.literal("elevenst"),
    price: z.number().nonnegative().max(999_999_999),
    currency: z.literal("KRW"),
  })).max(1_000),
  safeMessage: z.string().min(1).max(1_000),
});

const listingLineageEvidenceBaseSchema = z.object({
  expectedRemoteId: z.string().min(1).max(240),
  market: z.string().max(40),
  targetId: z.string().max(160),
  evidenceVersion: z.literal("provider_listing_readback_rebind_v1"),
  marketplaceSku: z.string().min(1).max(160).optional(),
  providerResourceId: z.string().min(1).max(240).optional(),
});

const listingLineageStepDataSchema = z.object({
  sellerpilotVerification: z.enum([
    "QOO10_ITEM_CODE_VERIFIED",
    "SHOPEE_SHOP_ID_VERIFIED",
    "SHOPEE_ITEM_ID_VERIFIED",
    "LAZADA_COUNTRY_ITEM_ID_VERIFIED",
    "EBAY_LISTING_ID_SKU_VERIFIED",
    "EBAY_LISTING_ID_SKU_UNVERIFIED",
    "EBAY_SKU_OFFER_VERIFIED",
    "EBAY_OFFER_LISTING_ID_VERIFIED",
    "EBAY_INVENTORY_SKU_VERIFIED",
    "EBAY_EXACT_OFFER_NOT_UNIQUE",
  ]),
  targetId: z.string().max(160).optional(),
  verifiedRemoteId: z.string().min(1).max(240).optional(),
  market: z.string().min(1).max(40).optional(),
  marketplaceSku: z.string().min(1).max(160).optional(),
  providerResourceId: z.string().min(1).max(240).optional(),
  listingId: z.string().min(1).max(240).optional(),
  marketplaceId: z.string().min(1).max(160).optional(),
  marketplaceSkuPresent: z.boolean().optional(),
  exactOfferUnique: z.boolean().optional(),
}).strict();

const listingLineageVerificationResultSchema = z.discriminatedUnion("verificationStatus", [
  z.object({
    ok: z.literal(true),
    channel: z.enum(["qoo10", "shopee", "lazada", "ebay"]),
    operation: z.literal("listing.lineage.verify"),
    verificationStatus: z.literal("verified"),
    evidence: listingLineageEvidenceBaseSchema.extend({
      verifiedRemoteId: z.string().min(1).max(240),
    }),
    steps: z.array(z.object({
      name: z.string().min(1).max(160),
      ok: z.literal(true),
      status: z.number().int().min(100).max(599),
      data: listingLineageStepDataSchema,
    })).min(1).max(4),
  }),
  z.object({
    ok: z.literal(true),
    channel: z.literal("ebay"),
    operation: z.literal("listing.lineage.verify"),
    verificationStatus: z.literal("manual_required"),
    evidence: listingLineageEvidenceBaseSchema.extend({
      verifiedRemoteId: z.null(),
      reasonCode: z.enum(["EBAY_MARKETPLACE_SKU_MISSING", "EBAY_OFFER_AMBIGUOUS"]),
    }),
    steps: z.array(z.object({
      name: z.string().min(1).max(160),
      ok: z.boolean(),
      status: z.number().int().min(100).max(599),
      data: listingLineageStepDataSchema,
    })).max(2),
  }),
]).superRefine((value, context) => {
  const market = value.evidence.market.trim().toUpperCase();
  if (value.channel === "qoo10") {
    if (market && market !== "JP") {
      context.addIssue({ code: "custom", message: "verified qoo10 lineage has an invalid market snapshot" });
    }
  } else if (!market) {
    context.addIssue({ code: "custom", message: "verified provider lineage requires a market" });
  }
  if (value.verificationStatus !== "verified") return;
  if (value.evidence.expectedRemoteId !== value.evidence.verifiedRemoteId) {
    context.addIssue({ code: "custom", message: "lineage remote identity mismatch" });
  }
  const hasEbayResource = Boolean(value.evidence.marketplaceSku && value.evidence.providerResourceId);
  if (value.channel === "ebay" && !hasEbayResource) {
    context.addIssue({ code: "custom", message: "verified ebay lineage requires SKU and offer id" });
  }
  if (value.channel !== "ebay" && (value.evidence.marketplaceSku || value.evidence.providerResourceId)) {
    context.addIssue({ code: "custom", message: "non-ebay lineage cannot carry ebay resource evidence" });
  }
  if (value.channel === "shopee" && !/^\d+$/.test(value.evidence.targetId)) {
    context.addIssue({ code: "custom", message: "verified shopee lineage requires a numeric shop id" });
  }
});

export const gatewayWorkerCompletionSchema = z.discriminatedUnion("status", [
  z.object({
    jobId: z.string().uuid(),
    claimToken: z.string().uuid(),
    status: z.literal("succeeded"),
    result: z.union([
      operationResultSchema,
      diagnosticResultSchema,
      competitorSearchResultSchema,
      listingLineageVerificationResultSchema,
      z.object({
        ok: z.literal(true),
        channel: z.enum(["shopee", "lazada", "ebay"]),
        operation: z.literal("oauth.exchange"),
        expiresAt: canonicalCredentialExpirySchema,
        safeMessage: z.string().min(1).max(1_000),
      }).strict(),
      z.object({
        ok: z.boolean(),
        channel: z.enum(["shopee", "lazada"]),
        operation: z.literal("shops.get"),
        steps: z.array(z.object({
          name: z.string().min(1).max(160),
          ok: z.boolean(),
          status: z.number().int().min(0).max(999),
          data: z.record(z.string(), z.unknown()),
        })).length(1),
        safeMessage: z.string().min(1).max(1_000),
      }),
    ]),
    credentialRefresh: credentialRefreshSchema.optional(),
  }),
  z.object({
    jobId: z.string().uuid(),
    claimToken: z.string().uuid(),
    status: z.literal("failed"),
    error: z.string().min(1).max(500),
    credentialRefresh: credentialRefreshSchema.optional(),
  }),
  z.object({
    jobId: z.string().uuid(),
    claimToken: z.string().uuid(),
    status: z.literal("reconciliation_required"),
    error: z.string().min(1).max(500),
    result: operationResultSchema.optional(),
    credentialRefresh: credentialRefreshSchema.optional(),
  }),
]).superRefine((value, context) => {
  if (value.status !== "succeeded" || value.result.operation !== "oauth.exchange") return;
  if (!value.credentialRefresh || value.credentialRefresh.oauthComplete !== true) {
    context.addIssue({
      code: "custom",
      path: ["credentialRefresh"],
      message: "successful OAuth exchange requires a staged terminal credential refresh",
    });
  }
});

export type GatewayClaim = z.infer<typeof gatewayClaimSchema>;
export type GatewayWorkerCompletion = z.infer<typeof gatewayWorkerCompletionSchema>;

const trustedMutationSteps: Readonly<Record<string, ReadonlySet<string>>> = {
  "listing.create": new Set([
    "product-create", "product-create-accepted", "product-create-reconcile",
    "global-item-create", "global-item-readback", "publish-task-create",
    "published-item-readback", "listing.create", "/product/create", "listing.resume",
    "product-reconcile", "goods-v3-add", "goods-reconcile", "setnewgoods",
    "offer", "offer-reconcile", "publish", "listing-image-upload",
  ]),
  "listing.update": new Set([
    "updategoods", "editgoodscontents", "listing.update", "/product/update",
    "product-update", "offer-update", "inventory-item-update", "listing-image-upload",
    "qoo10-rollback-recovery-activate",
  ]),
  "listing.stop": new Set([
    "stop-display", "editgoodsstatus", "listing.stop", "/product/deactivate",
    "sales-stop", "status-stop", "goods-off-shelf", "offer-withdraw",
  ]),
  "listing.activate": new Set(["qoo10-s1-activation"]),
  "price.update": new Set([
    "setgoodspriceqty", "price.update", "/product/price_quantity/update",
    "price", "bulk-price", "offer-price",
  ]),
  "inventory.update": new Set([
    "setgoodspriceqty", "inventory.update", "/product/price_quantity/update",
    "quantity", "origin-product-stock", "option-stock", "goods-stock", "bulk-inventory",
  ]),
  "inquiries.reply": new Set([
    "inquiry-reply", "setinquirymessage", "cscenter.setinquirymessage",
  ]),
  "shipment.acknowledge": new Set(["seller-check", "pack", "acknowledgement", "confirm"]),
  "shipment.confirm": new Set([
    "setsendinginfo", "shipment.confirm", "pack", "ready-to-ship", "invoice",
    "dispatch", "shipment-confirm", "shipping-fulfillment",
  ]),
};

export function gatewayResultHasObservedMutation(
  operation: string,
  ok: boolean,
  steps: ReadonlyArray<{ name: string; ok: boolean; status?: number; data?: Record<string, unknown> }>,
): boolean {
  if (ok || !writeChannelOperations.has(operation as ChannelOperationName)) return false;
  const trusted = trustedMutationSteps[operation];
  if (!trusted) return false;
  return steps.some((step) => {
    const providerOutcomeUncertain = step.ok
      || step.data?.sellerpilotMutation === "accepted"
      || step.status === 408
      || (typeof step.status === "number" && step.status >= 500 && step.status <= 599);
    if (!providerOutcomeUncertain) return false;
    const name = step.name.trim().toLowerCase();
    return trusted.has(name)
      || (operation === "listing.create" && name.startsWith("published-item-readback-"));
  });
}

export function gatewayJobCompletionStatus(
  operation: string,
  ok: boolean,
  steps: ReadonlyArray<{ name: string; ok: boolean; status?: number; data?: Record<string, unknown> }> = [],
): "succeeded" | "failed" | "reconciliation_required" {
  if (!ok && steps.some((step) => step.data?.sellerpilotReconciliationRequired === true)) {
    return "reconciliation_required";
  }
  if (gatewayResultHasObservedMutation(operation, ok, steps)) return "reconciliation_required";
  if (!ok && (operation === "orders.list" || operation === "inquiries.list")) return "failed";
  return "succeeded";
}

export function gatewayJobCompletionStatusAtJobBoundary(
  status: "succeeded" | "failed" | "reconciliation_required",
  result: {
    ok?: unknown;
    operation?: unknown;
    remoteState?: unknown;
  } | null | undefined,
  jobBoundary: unknown,
): "succeeded" | "failed" | "reconciliation_required" {
  if (status !== "succeeded"
      || result?.ok !== true
      || typeof result.operation !== "string"
      || !listingOperationRequiresVerifiedRemoteState(result.operation)) {
    return status;
  }
  return listingRemoteStateVerifiedAtOrAfterJobBoundary(result.remoteState, jobBoundary)
    ? status
    : "reconciliation_required";
}
