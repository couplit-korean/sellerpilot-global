import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import {
  LISTING_HANDOFF_GET_RPC,
  LISTING_HANDOFF_PUT_RPC,
  expectedEbayMarketplaceId,
  listingHandoffRpcResult,
} from "../../../../lib/channel-listing-handoff";
import {
  ensureEbayBusinessPolicies,
  ensureEbayInventoryLocation,
} from "../../../../lib/channels/ebay-account-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };
const ACTIVE_CREDENTIAL_RPC = "sellerpilot_get_active_credential_secret";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function rpcFailureStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "22023" || code === "23514") return 400;
  return 503;
}

function rpcUnavailable(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST002";
}

const amountSchema = z.object({
  value: z.string().trim().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
}).strict();

const categoryTypesSchema = z.array(z.object({
  name: z.string().trim().min(1).max(60),
  default: z.boolean().optional(),
}).strict()).min(1);

const shipToLocationsSchema = z.object({
  regionIncluded: z.array(z.object({
    regionName: z.string().trim().min(1).max(60),
  }).strict()).min(1).optional(),
  regionExcluded: z.array(z.object({
    regionName: z.string().trim().min(1).max(60),
    regionType: z.string().trim().min(1).max(40).optional(),
  }).strict()).min(1).optional(),
}).strict().superRefine((value, context) => {
  if (!value.regionIncluded?.length && !value.regionExcluded?.length) {
    context.addIssue({ code: "custom", message: "shipToLocations requires a region list" });
  }
});

const shippingServiceSchema = z.object({
  sortOrder: z.number().int().min(0).optional(),
  shippingCarrierCode: z.string().trim().min(1).max(50),
  shippingServiceCode: z.string().trim().min(1).max(60),
  shippingCost: amountSchema.optional(),
  additionalShippingCost: amountSchema.optional(),
  freeShipping: z.boolean().optional(),
  shipToLocations: shipToLocationsSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.freeShipping !== true && value.shippingCost === undefined) {
    context.addIssue({
      code: "custom",
      path: ["shippingCost"],
      message: "a paid shipping service requires shippingCost",
    });
  }
});

const fulfillmentPolicySchema = z.object({
  // Policy names and every business value are operator input. This route never
  // fills in a default return window, shipping service or address.
  name: z.string().trim().min(1).max(65),
  description: z.string().trim().min(1).max(250).optional(),
  categoryTypes: categoryTypesSchema.optional(),
  handlingTime: z.object({
    value: z.number().int().min(0).max(30),
    unit: z.enum(["DAY", "BUSINESS_DAY"]),
  }).strict(),
  shippingOptions: z.array(z.object({
    optionType: z.string().trim().min(1).max(40),
    costType: z.string().trim().min(1).max(40),
    shippingServices: z.array(shippingServiceSchema).min(1),
  }).strict()).min(1),
  shipToLocations: shipToLocationsSchema.optional(),
  globalShipping: z.boolean().optional(),
  pickupDropOff: z.boolean().optional(),
  freightShipping: z.boolean().optional(),
  localPickup: z.boolean().optional(),
}).strict();

const paymentPolicySchema = z.object({
  name: z.string().trim().min(1).max(65),
  description: z.string().trim().min(1).max(250).optional(),
  categoryTypes: categoryTypesSchema.optional(),
  immediatePay: z.boolean().optional(),
  paymentMethods: z.array(z.object({
    paymentMethodType: z.string().trim().min(1).max(40),
    paymentInstrument: z.string().trim().min(1).max(40).optional(),
  }).strict()).min(1),
}).strict();

const returnTermsShape = {
  returnsAccepted: z.boolean(),
  returnPeriod: z.object({
    value: z.number().int().min(1).max(365),
    unit: z.enum(["DAY", "MONTH"]),
  }).strict().optional(),
  returnShippingCostPayer: z.string().trim().min(1).max(40).optional(),
  refundMethod: z.string().trim().min(1).max(40).optional(),
  returnMethod: z.string().trim().min(1).max(40).optional(),
};

const returnPolicySchema = z.object({
  name: z.string().trim().min(1).max(65),
  description: z.string().trim().min(1).max(250).optional(),
  categoryTypes: categoryTypesSchema.optional(),
  ...returnTermsShape,
  extendedHolidayReturnsOffered: z.boolean().optional(),
  restockingFeePercentage: z.string().trim().min(1).max(10).optional(),
  returnInstructions: z.string().trim().min(1).max(500).optional(),
  internationalOverride: z.object(returnTermsShape).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.returnsAccepted && (!value.returnPeriod || !value.returnShippingCostPayer)) {
    context.addIssue({
      code: "custom",
      path: ["returnPeriod"],
      message: "accepted returns require returnPeriod and returnShippingCostPayer",
    });
  }
});

const inventoryLocationSchema = z.object({
  merchantLocationKey: z.string().trim().regex(/^[A-Za-z0-9_-]{1,50}$/),
  name: z.string().trim().min(1).max(60),
  address: z.object({
    addressLine1: z.string().trim().min(1).max(180),
    addressLine2: z.string().trim().min(1).max(180).optional(),
    city: z.string().trim().min(1).max(60),
    stateOrProvince: z.string().trim().min(1).max(64),
    postalCode: z.string().trim().min(1).max(32),
    country: z.string().trim().regex(/^[A-Z]{2}$/),
  }).strict(),
  phone: z.string().trim().min(1).max(40).optional(),
  locationTypes: z.array(z.string().trim().min(1).max(40)).min(1).optional(),
  merchantLocationStatus: z.enum(["ENABLED", "DISABLED"]).optional(),
}).strict();

const bootstrapSchema = z.object({
  productId: z.string().uuid(),
  channel: z.literal("ebay"),
  environment: z.enum(["production", "sandbox"]),
  market: z.string().trim().regex(/^[A-Z]{2}$/),
  policies: z.object({
    fulfillment: fulfillmentPolicySchema,
    payment: paymentPolicySchema,
    return: returnPolicySchema,
  }).strict(),
  // Operator selection for an account that already has several usable policies.
  expectedPolicyIds: z.object({
    fulfillment: z.string().trim().min(1).max(120).optional(),
    payment: z.string().trim().min(1).max(120).optional(),
    return: z.string().trim().min(1).max(120).optional(),
  }).strict().optional(),
  location: inventoryLocationSchema,
}).strict();

type BootstrapInput = z.infer<typeof bootstrapSchema>;

type BootstrapAttemptResult =
  | {
    ok: true;
    result: {
      policies: Awaited<ReturnType<typeof ensureEbayBusinessPolicies>>;
      location: Awaited<ReturnType<typeof ensureEbayInventoryLocation>>;
    };
  }
  | { ok: false; code: string };

function bootstrapFailureStatus(code: string) {
  if (code.startsWith("EBAY_ACCESS_TOKEN_MISSING")
      || code.startsWith("EBAY_MARKETPLACE_MISMATCH")) return 409;
  if (code.includes("_TERMS_INVALID")
      || code.startsWith("EBAY_MARKETPLACE_ID_INVALID")
      || code.startsWith("EBAY_INVENTORY_LOCATION_INPUT_INVALID")) return 400;
  if (code.includes("_SELECTION_REQUIRED")
      || code.includes("_EXPECTED_MISSING")
      || code.startsWith("EBAY_INVENTORY_LOCATION_DISABLED")) return 409;
  if (code.startsWith("EBAY_BUSINESS_POLICY_CREATE_FAILED")
      || code.startsWith("EBAY_INVENTORY_LOCATION_CREATE_FAILED")) return 409;
  return 502;
}

function bootstrapFailure(code: string) {
  return {
    code,
    message: code.includes("_CREATE_FAILED")
      ? "eBay가 정책 또는 위치 생성을 거부했습니다. 입력값을 확인해 주세요."
      : "eBay 판매 정책과 위치를 확정하지 못했습니다. 아무 값도 저장하지 않았습니다.",
  };
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/^[A-Z0-9_]{1,160}(?::[A-Z0-9_]{1,40})*$/u);
  return match ? match[0] : "EBAY_ACCOUNT_BOOTSTRAP_FAILED";
}

async function readStoredHandoff(
  serviceClient: SupabaseClient,
  input: BootstrapInput,
) {
  const { data, error } = await serviceClient.rpc(LISTING_HANDOFF_GET_RPC, {
    p_product_id: input.productId,
    p_channel: input.channel,
    p_environment: input.environment,
    p_market: input.market,
  });
  if (error) return { status: "error" as const, code: error.code };
  try {
    return { status: "ok" as const, handoff: listingHandoffRpcResult(data) };
  } catch {
    return { status: "malformed" as const };
  }
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = bootstrapSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({
      code: "EBAY_ACCOUNT_BOOTSTRAP_INPUT_INVALID",
      message: parsed.error.issues[0]?.message ?? "정책 조건과 위치 주소를 확인해 주세요.",
    }, 400);
  }
  const input = parsed.data;
  const marketplaceId = expectedEbayMarketplaceId(input.market);

  const credential = await admin.serviceClient.rpc(ACTIVE_CREDENTIAL_RPC, {
    p_channel: "ebay",
    p_environment: input.environment,
  });
  if (credential.error) {
    return json({
      code: "EBAY_CREDENTIAL_UNAVAILABLE",
      message: "eBay 연결 정보를 불러오지 못했습니다.",
    }, rpcUnavailable(credential.error.code)
      ? 503
      : rpcFailureStatus(credential.error.code));
  }
  const active = record(credential.data);
  const payload = record(active.secret_payload);
  if (!text(active.credential_id) || !Object.keys(payload).length) {
    return json({
      code: "EBAY_CREDENTIAL_UNAVAILABLE",
      message: "활성 eBay 연결 계정이 없습니다. OAuth 연결을 먼저 완료해 주세요.",
    }, 409);
  }
  if (!text(payload.access_token)) {
    return json({
      code: "EBAY_ACCESS_TOKEN_MISSING",
      message: "eBay 액세스 토큰이 없습니다. OAuth 연결을 다시 완료해 주세요.",
    }, 409);
  }
  const credentialMarketplaceId = text(payload.marketplace_id).toUpperCase();
  if (credentialMarketplaceId && credentialMarketplaceId !== marketplaceId) {
    // Creating a policy for another marketplace than the connected account is
    // how a wrong-market policy gets persisted, so refuse instead.
    return json({
      code: "EBAY_MARKETPLACE_MISMATCH",
      message: "연결된 eBay 계정의 마켓과 요청한 마켓이 일치하지 않습니다.",
    }, 409);
  }

  const stored = await readStoredHandoff(admin.serviceClient, input);
  if (stored.status === "malformed") {
    return json({
      code: "EBAY_LISTING_HANDOFF_MALFORMED",
      message: "저장된 판매 정책 형식이 올바르지 않습니다.",
    }, 503);
  }
  if (stored.status === "error") {
    return json({
      code: "EBAY_LISTING_HANDOFF_UNAVAILABLE",
      message: "저장된 판매 정책을 불러오지 못했습니다.",
    }, rpcUnavailable(stored.code) ? 503 : rpcFailureStatus(stored.code));
  }

  // The persisted handoff is a hint, not a hard constraint: an id that eBay no
  // longer returns must not dead-lock the operator out of recovering the account.
  const storedPolicyIds = stored.handoff
    ? {
      fulfillment: stored.handoff.fulfillmentPolicyId,
      payment: stored.handoff.paymentPolicyId,
      return: stored.handoff.returnPolicyId,
    }
    : undefined;
  const runBootstrap = async (useStoredPolicyIds: boolean) => {
    const policies = await ensureEbayBusinessPolicies({
      payload,
      environment: input.environment,
      marketplaceId,
      terms: {
        fulfillment: input.policies.fulfillment,
        payment: input.policies.payment,
        return: input.policies.return,
      },
      expectedPolicyIds: {
        ...(useStoredPolicyIds ? storedPolicyIds : undefined),
        ...input.expectedPolicyIds,
      },
    });
    const location = await ensureEbayInventoryLocation({
      payload,
      environment: input.environment,
      terms: input.location,
      expectedMerchantLocationKey: stored.handoff?.merchantLocationKey,
    });
    return { policies, location };
  };

  const attemptBootstrap = async (useStoredPolicyIds: boolean) => {
    try {
      return { ok: true as const, result: await runBootstrap(useStoredPolicyIds) };
    } catch (error) {
      return { ok: false as const, code: safeCode(error) };
    }
  };

  let attempt: BootstrapAttemptResult = await attemptBootstrap(Boolean(storedPolicyIds));
  let discardedStoredPolicyIds = false;
  if (!attempt.ok
      && storedPolicyIds
      && attempt.code.startsWith("EBAY_BUSINESS_POLICY_EXPECTED_MISSING")) {
    discardedStoredPolicyIds = true;
    attempt = await attemptBootstrap(false);
  }
  if (!attempt.ok) {
    console.error("eBay account bootstrap failed", {
      code: attempt.code,
      status: bootstrapFailureStatus(attempt.code),
    });
    return json(bootstrapFailure(attempt.code), bootstrapFailureStatus(attempt.code));
  }
  const { policies, location } = attempt.result;

  const { data, error } = await admin.serviceClient.rpc(LISTING_HANDOFF_PUT_RPC, {
    p_product_id: input.productId,
    p_channel: input.channel,
    p_environment: input.environment,
    p_market: input.market,
    p_handoff: {
      marketplaceId,
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
      merchantLocationKey: location.merchantLocationKey,
    },
  });
  if (error) {
    return json({
      code: "EBAY_LISTING_HANDOFF_SAVE_FAILED",
      message: "eBay 판매 정책을 저장하지 못했습니다.",
    }, rpcUnavailable(error.code) ? 503 : rpcFailureStatus(error.code));
  }
  try {
    const handoff = listingHandoffRpcResult(data);
    if (!handoff) {
      return json({
        code: "EBAY_LISTING_HANDOFF_PRODUCT_UNAVAILABLE",
        message: "판매 정책을 저장할 상품을 확인하지 못했습니다.",
      }, 409);
    }
    if (
      handoff.productId !== input.productId
      || handoff.channel !== input.channel
      || handoff.environment !== input.environment
      || handoff.market !== input.market
    ) {
      return json({
        code: "EBAY_LISTING_HANDOFF_MISMATCH",
        message: "저장된 판매 정책의 상품·마켓이 일치하지 않습니다.",
      }, 409);
    }
    return json({
      handoff,
      bootstrap: {
        policyCreated: policies.created,
        locationCreated: location.created,
        providerWrites: policies.providerWrites + (location.created ? 1 : 0),
        discardedStoredPolicyIds,
        marketplaceId,
      },
      message: "eBay 판매 정책과 위치를 확정해 저장했습니다.",
    });
  } catch {
    return json({
      code: "EBAY_LISTING_HANDOFF_MALFORMED",
      message: "저장된 판매 정책 형식이 올바르지 않습니다.",
    }, 503);
  }
}
