import {
  ebayRequest,
  runWithProviderReadOnlyTransport,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

// eBay's listing.create path fails closed when the seller account has no
// business policies or no enabled inventory location. This module is the only
// place allowed to create those provider objects. It exists outside
// lib/product-registration/channels/ebay.ts so the listing executor keeps
// failing closed instead of silently provisioning seller account settings.
//
// Every call is GET-first: an existing usable policy or location is reused and
// nothing is created. Creation always requires explicit operator terms, so no
// business value (return window, shipping service, address) is invented here.

export const EBAY_BUSINESS_POLICY_TERMS_INVALID = "EBAY_BUSINESS_POLICY_TERMS_INVALID";
export const EBAY_BUSINESS_POLICY_GET_UNVERIFIED = "EBAY_BUSINESS_POLICY_GET_UNVERIFIED";
export const EBAY_BUSINESS_POLICY_SELECTION_REQUIRED = "EBAY_BUSINESS_POLICY_SELECTION_REQUIRED";
export const EBAY_BUSINESS_POLICY_EXPECTED_MISSING = "EBAY_BUSINESS_POLICY_EXPECTED_MISSING";
export const EBAY_BUSINESS_POLICY_CREATE_FAILED = "EBAY_BUSINESS_POLICY_CREATE_FAILED";
export const EBAY_BUSINESS_POLICY_CREATE_UNVERIFIED = "EBAY_BUSINESS_POLICY_CREATE_UNVERIFIED";
export const EBAY_INVENTORY_LOCATION_INPUT_INVALID = "EBAY_INVENTORY_LOCATION_INPUT_INVALID";
export const EBAY_INVENTORY_LOCATION_GET_UNVERIFIED = "EBAY_INVENTORY_LOCATION_GET_UNVERIFIED";
export const EBAY_INVENTORY_LOCATION_DISABLED = "EBAY_INVENTORY_LOCATION_DISABLED";
export const EBAY_INVENTORY_LOCATION_CREATE_FAILED = "EBAY_INVENTORY_LOCATION_CREATE_FAILED";

export type EbayAccountPolicyKind = "fulfillment" | "payment" | "return";

export type EbayAccountEnvironment = "sandbox" | "production";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  const normalized = text(value);
  return normalized ? normalized : undefined;
}

function providerErrorIds(data: UnknownRecord) {
  return Array.isArray(data.errors)
    ? data.errors
      .map((error) => record(error).errorId)
      .map((value) => (typeof value === "number" || typeof value === "string" ? String(value) : ""))
      .filter((value) => /^\d{1,8}$/u.test(value))
    : [];
}

function providerErrorsPresent(data: UnknownRecord) {
  if (!Object.hasOwn(data, "errors")) return false;
  return !Array.isArray(data.errors) || data.errors.length > 0;
}

function failureCode(base: string, parts: Array<string | number | undefined>) {
  const detail = parts
    .map((part) => (part === undefined ? "" : String(part).trim()))
    .filter(Boolean)
    .join(":");
  return detail ? `${base}:${detail}` : base;
}

export function assertEbayBootstrapMarketplaceId(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (!/^EBAY_[A-Z]{2}$/u.test(normalized)) {
    throw new Error("EBAY_MARKETPLACE_ID_INVALID");
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Business policies
// ---------------------------------------------------------------------------

const policyResources: Record<EbayAccountPolicyKind, {
  path: string;
  listKey: string;
  idKey: string;
}> = {
  fulfillment: {
    path: "/sell/account/v1/fulfillment_policy",
    listKey: "fulfillmentPolicies",
    idKey: "fulfillmentPolicyId",
  },
  payment: {
    path: "/sell/account/v1/payment_policy",
    listKey: "paymentPolicies",
    idKey: "paymentPolicyId",
  },
  return: {
    path: "/sell/account/v1/return_policy",
    listKey: "returnPolicies",
    idKey: "returnPolicyId",
  },
};

export type EbayPolicyCategoryType = {
  name: string;
  default?: boolean;
};

export type EbayShipToLocations = {
  regionIncluded?: Array<{ regionName: string }>;
  regionExcluded?: Array<{ regionName: string; regionType?: string }>;
};

export type EbayShippingServiceTerms = {
  sortOrder?: number;
  shippingCarrierCode: string;
  shippingServiceCode: string;
  shippingCost?: { value: string; currency: string };
  additionalShippingCost?: { value: string; currency: string };
  freeShipping?: boolean;
  shipToLocations?: EbayShipToLocations;
};

export type EbayShippingOptionTerms = {
  optionType: string;
  costType: string;
  shippingServices: EbayShippingServiceTerms[];
};

export type EbayFulfillmentPolicyTerms = {
  name: string;
  description?: string;
  categoryTypes?: EbayPolicyCategoryType[];
  handlingTime: { value: number; unit: string };
  shippingOptions: EbayShippingOptionTerms[];
  shipToLocations?: EbayShipToLocations;
  globalShipping?: boolean;
  pickupDropOff?: boolean;
  freightShipping?: boolean;
  localPickup?: boolean;
};

export type EbayPaymentPolicyTerms = {
  name: string;
  description?: string;
  categoryTypes?: EbayPolicyCategoryType[];
  immediatePay?: boolean;
  paymentMethods: Array<{ paymentMethodType: string; paymentInstrument?: string }>;
};

export type EbayReturnPolicyTerms = {
  name: string;
  description?: string;
  categoryTypes?: EbayPolicyCategoryType[];
  returnsAccepted: boolean;
  returnPeriod?: { value: number; unit: string };
  returnShippingCostPayer?: string;
  refundMethod?: string;
  returnMethod?: string;
  extendedHolidayReturnsOffered?: boolean;
  restockingFeePercentage?: string;
  returnInstructions?: string;
  internationalOverride?: {
    returnsAccepted: boolean;
    returnPeriod?: { value: number; unit: string };
    returnShippingCostPayer?: string;
    refundMethod?: string;
    returnMethod?: string;
  };
};

export type EbayBusinessPolicyTerms = {
  fulfillment: EbayFulfillmentPolicyTerms;
  payment: EbayPaymentPolicyTerms;
  return: EbayReturnPolicyTerms;
};

type ExistingEbayPolicy = {
  id: string;
  name: string;
  marketplaceId: string;
  categoryTypes: string[];
};

export type EbayBusinessPolicyResolution = {
  marketplaceId: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  created: Record<EbayAccountPolicyKind, boolean>;
  reusedPolicyIds: Record<EbayAccountPolicyKind, string>;
  providerWrites: number;
};

function requiredText(value: unknown, code: string) {
  const normalized = text(value);
  if (!normalized) throw new Error(code);
  return normalized;
}

function requiredInteger(value: unknown, code: string, minimum: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(code);
  }
  return value;
}

function sanitizedCategoryTypes(value: unknown): EbayPolicyCategoryType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:categoryTypes`);
  }
  return value.map((entry) => {
    const row = record(entry);
    const name = requiredText(row.name, `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:categoryTypes.name`);
    return {
      name,
      ...(typeof row.default === "boolean" ? { default: row.default } : {}),
    };
  });
}

function sanitizedAmount(value: unknown, code: string) {
  const row = record(value);
  const amount = requiredText(row.value, `${code}:value`);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(amount)) throw new Error(`${code}:value`);
  const currency = requiredText(row.currency, `${code}:currency`).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error(`${code}:currency`);
  return { value: amount, currency };
}

function sanitizedShipToLocations(value: unknown, code: string): EbayShipToLocations | undefined {
  if (value === undefined) return undefined;
  const row = record(value);
  const included = row.regionIncluded === undefined
    ? undefined
    : (Array.isArray(row.regionIncluded) ? row.regionIncluded.map((entry) => ({
      regionName: requiredText(record(entry).regionName, `${code}:regionName`),
    })) : (() => {
      throw new Error(`${code}:regionIncluded`);
    })());
  const excluded = row.regionExcluded === undefined
    ? undefined
    : (Array.isArray(row.regionExcluded) ? row.regionExcluded.map((entry) => {
      const region = record(entry);
      return {
        regionName: requiredText(region.regionName, `${code}:regionName`),
        ...(optionalText(region.regionType) ? { regionType: text(region.regionType) } : {}),
      };
    }) : (() => {
      throw new Error(`${code}:regionExcluded`);
    })());
  if (!included?.length && !excluded?.length) throw new Error(`${code}:empty`);
  return {
    ...(included?.length ? { regionIncluded: included } : {}),
    ...(excluded?.length ? { regionExcluded: excluded } : {}),
  };
}

function fulfillmentPolicyBody(
  terms: EbayFulfillmentPolicyTerms,
  marketplaceId: string,
): UnknownRecord {
  const name = requiredText(terms.name, `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.name`);
  const handlingTime = record(terms.handlingTime);
  const handlingValue = requiredInteger(
    handlingTime.value,
    `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.handlingTime.value`,
    0,
  );
  const handlingUnit = requiredText(
    handlingTime.unit,
    `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.handlingTime.unit`,
  ).toUpperCase();
  if (!["DAY", "BUSINESS_DAY"].includes(handlingUnit)) {
    throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.handlingTime.unit`);
  }
  if (!Array.isArray(terms.shippingOptions) || !terms.shippingOptions.length) {
    throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingOptions`);
  }
  const shippingOptions = terms.shippingOptions.map((option) => {
    const optionType = requiredText(
      option.optionType,
      `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingOptions.optionType`,
    ).toUpperCase();
    const costType = requiredText(
      option.costType,
      `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingOptions.costType`,
    ).toUpperCase();
    if (!Array.isArray(option.shippingServices) || !option.shippingServices.length) {
      throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingServices`);
    }
    const shippingServices = option.shippingServices.map((service) => {
      const shippingCarrierCode = requiredText(
        service.shippingCarrierCode,
        `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingCarrierCode`,
      );
      const shippingServiceCode = requiredText(
        service.shippingServiceCode,
        `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingServiceCode`,
      );
      if (service.freeShipping !== true && service.shippingCost === undefined) {
        // eBay rejects a paid service without a cost, and a free service
        // without the freeShipping flag. Require one of them explicitly.
        throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingCost`);
      }
      return {
        ...(typeof service.sortOrder === "number" && Number.isSafeInteger(service.sortOrder)
          ? { sortOrder: service.sortOrder }
          : {}),
        shippingCarrierCode,
        shippingServiceCode,
        ...(service.freeShipping === undefined ? {} : { freeShipping: service.freeShipping }),
        ...(service.shippingCost === undefined
          ? {}
          : {
            shippingCost: sanitizedAmount(
              service.shippingCost,
              `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shippingCost`,
            ),
          }),
        ...(service.additionalShippingCost === undefined
          ? {}
          : {
            additionalShippingCost: sanitizedAmount(
              service.additionalShippingCost,
              `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.additionalShippingCost`,
            ),
          }),
        ...(service.shipToLocations === undefined
          ? {}
          : {
            shipToLocations: sanitizedShipToLocations(
              service.shipToLocations,
              `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.serviceShipToLocations`,
            ),
          }),
      };
    });
    return { optionType, costType, shippingServices };
  });
  const categoryTypes = sanitizedCategoryTypes(terms.categoryTypes);
  const shipToLocations = terms.shipToLocations === undefined
    ? undefined
    : sanitizedShipToLocations(
      terms.shipToLocations,
      `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:fulfillment.shipToLocations`,
    );
  return {
    name,
    marketplaceId,
    handlingTime: { value: handlingValue, unit: handlingUnit },
    shippingOptions,
    ...(optionalText(terms.description) ? { description: text(terms.description) } : {}),
    ...(categoryTypes ? { categoryTypes } : {}),
    ...(shipToLocations ? { shipToLocations } : {}),
    ...(terms.globalShipping === undefined ? {} : { globalShipping: terms.globalShipping }),
    ...(terms.pickupDropOff === undefined ? {} : { pickupDropOff: terms.pickupDropOff }),
    ...(terms.freightShipping === undefined ? {} : { freightShipping: terms.freightShipping }),
    ...(terms.localPickup === undefined ? {} : { localPickup: terms.localPickup }),
  };
}

function paymentPolicyBody(
  terms: EbayPaymentPolicyTerms,
  marketplaceId: string,
): UnknownRecord {
  const name = requiredText(terms.name, `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:payment.name`);
  if (!Array.isArray(terms.paymentMethods) || !terms.paymentMethods.length) {
    throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:payment.paymentMethods`);
  }
  const paymentMethods = terms.paymentMethods.map((method) => {
    const paymentMethodType = requiredText(
      method.paymentMethodType,
      `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:payment.paymentMethodType`,
    ).toUpperCase();
    return {
      paymentMethodType,
      ...(optionalText(method.paymentInstrument)
        ? { paymentInstrument: text(method.paymentInstrument).toUpperCase() }
        : {}),
    };
  });
  const categoryTypes = sanitizedCategoryTypes(terms.categoryTypes);
  return {
    name,
    marketplaceId,
    paymentMethods,
    ...(optionalText(terms.description) ? { description: text(terms.description) } : {}),
    ...(categoryTypes ? { categoryTypes } : {}),
    ...(terms.immediatePay === undefined ? {} : { immediatePay: terms.immediatePay }),
  };
}

function returnPeriodFrom(value: unknown, field: string) {
  const period = record(value);
  const amount = requiredInteger(
    period.value,
    `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:${field}.returnPeriod.value`,
    1,
  );
  const unit = requiredText(
    period.unit,
    `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:${field}.returnPeriod.unit`,
  ).toUpperCase();
  if (!["DAY", "MONTH"].includes(unit)) {
    throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:${field}.returnPeriod.unit`);
  }
  return { value: amount, unit };
}

function returnPolicyBody(
  terms: EbayReturnPolicyTerms,
  marketplaceId: string,
): UnknownRecord {
  const name = requiredText(terms.name, `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:return.name`);
  if (typeof terms.returnsAccepted !== "boolean") {
    throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:return.returnsAccepted`);
  }
  const returnPeriod = terms.returnPeriod === undefined
    ? undefined
    : returnPeriodFrom(terms.returnPeriod, "return");
  const returnShippingCostPayer = optionalText(terms.returnShippingCostPayer)?.toUpperCase();
  if (terms.returnsAccepted && (!returnPeriod || !returnShippingCostPayer)) {
    // eBay requires the return window and the shipping cost payer whenever
    // returns are accepted. Never guess either value.
    throw new Error(`${EBAY_BUSINESS_POLICY_TERMS_INVALID}:return.acceptedTerms`);
  }
  const categoryTypes = sanitizedCategoryTypes(terms.categoryTypes);
  let internationalOverride: UnknownRecord | undefined;
  if (terms.internationalOverride !== undefined) {
    const override = terms.internationalOverride;
    if (typeof override.returnsAccepted !== "boolean") {
      throw new Error(
        `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:return.internationalOverride.returnsAccepted`,
      );
    }
    const overridePeriod = override.returnPeriod === undefined
      ? undefined
      : returnPeriodFrom(override.returnPeriod, "return.internationalOverride");
    const overridePayer = optionalText(override.returnShippingCostPayer)?.toUpperCase();
    if (override.returnsAccepted && (!overridePeriod || !overridePayer)) {
      throw new Error(
        `${EBAY_BUSINESS_POLICY_TERMS_INVALID}:return.internationalOverride.returnPeriod`,
      );
    }
    internationalOverride = {
      returnsAccepted: override.returnsAccepted,
      ...(overridePeriod ? { returnPeriod: overridePeriod } : {}),
      ...(overridePayer ? { returnShippingCostPayer: overridePayer } : {}),
      ...(optionalText(override.refundMethod)
        ? { refundMethod: text(override.refundMethod).toUpperCase() }
        : {}),
      ...(optionalText(override.returnMethod)
        ? { returnMethod: text(override.returnMethod).toUpperCase() }
        : {}),
    };
  }
  return {
    name,
    marketplaceId,
    returnsAccepted: terms.returnsAccepted,
    ...(optionalText(terms.description) ? { description: text(terms.description) } : {}),
    ...(categoryTypes ? { categoryTypes } : {}),
    ...(returnPeriod ? { returnPeriod } : {}),
    ...(returnShippingCostPayer ? { returnShippingCostPayer } : {}),
    ...(optionalText(terms.refundMethod)
      ? { refundMethod: text(terms.refundMethod).toUpperCase() }
      : {}),
    ...(optionalText(terms.returnMethod)
      ? { returnMethod: text(terms.returnMethod).toUpperCase() }
      : {}),
    ...(terms.extendedHolidayReturnsOffered === undefined
      ? {}
      : { extendedHolidayReturnsOffered: terms.extendedHolidayReturnsOffered }),
    ...(optionalText(terms.restockingFeePercentage)
      ? { restockingFeePercentage: text(terms.restockingFeePercentage) }
      : {}),
    ...(optionalText(terms.returnInstructions)
      ? { returnInstructions: text(terms.returnInstructions) }
      : {}),
    ...(internationalOverride ? { internationalOverride } : {}),
  };
}

function policyBody(
  kind: EbayAccountPolicyKind,
  terms: EbayBusinessPolicyTerms,
  marketplaceId: string,
): UnknownRecord {
  if (kind === "fulfillment") return fulfillmentPolicyBody(terms.fulfillment, marketplaceId);
  if (kind === "payment") return paymentPolicyBody(terms.payment, marketplaceId);
  return returnPolicyBody(terms.return, marketplaceId);
}

export function ebayBusinessPolicyList(remote: RemoteResponse, kind: EbayAccountPolicyKind) {
  const { listKey, idKey } = policyResources[kind];
  if (remote.response.status !== 200 || providerErrorsPresent(remote.data)) {
    throw new Error(failureCode(
      EBAY_BUSINESS_POLICY_GET_UNVERIFIED,
      [kind.toUpperCase(), `HTTP_${remote.response.status}`],
    ));
  }
  const raw = remote.data[listKey];
  if (!Array.isArray(raw)) {
    throw new Error(failureCode(
      EBAY_BUSINESS_POLICY_GET_UNVERIFIED,
      [kind.toUpperCase(), "RESPONSE_MALFORMED"],
    ));
  }
  const policies: ExistingEbayPolicy[] = raw.map((entry) => {
    const row = record(entry);
    const id = requiredText(row[idKey], failureCode(
      EBAY_BUSINESS_POLICY_GET_UNVERIFIED,
      [kind.toUpperCase(), "POLICY_ID_MISSING"],
    ));
    const categoryTypes = Array.isArray(row.categoryTypes)
      ? row.categoryTypes.map((category) => text(record(category).name).toUpperCase()).filter(Boolean)
      : [];
    return {
      id,
      name: text(row.name) || id,
      marketplaceId: text(row.marketplaceId).toUpperCase(),
      categoryTypes,
    };
  });
  const total = typeof remote.data.total === "number" && Number.isSafeInteger(remote.data.total)
    ? remote.data.total
    : policies.length;
  if (total > policies.length || remote.data.next) {
    // A truncated page cannot prove that no usable policy exists.
    throw new Error(failureCode(
      EBAY_BUSINESS_POLICY_GET_UNVERIFIED,
      [kind.toUpperCase(), "PAGE_INCOMPLETE"],
    ));
  }
  if (policies.length !== new Set(policies.map((policy) => policy.id)).size) {
    throw new Error(failureCode(
      EBAY_BUSINESS_POLICY_GET_UNVERIFIED,
      [kind.toUpperCase(), "POLICY_ID_DUPLICATED"],
    ));
  }
  return policies;
}

export function selectUsableEbayPolicy(input: {
  kind: EbayAccountPolicyKind;
  policies: ExistingEbayPolicy[];
  marketplaceId: string;
  categoryTypes?: EbayPolicyCategoryType[];
  expectedPolicyId?: string;
}) {
  const { kind, policies, marketplaceId, expectedPolicyId } = input;
  const expected = text(expectedPolicyId);
  if (expected) {
    const match = policies.find((policy) => policy.id === expected);
    if (!match) {
      throw new Error(failureCode(EBAY_BUSINESS_POLICY_EXPECTED_MISSING, [kind.toUpperCase()]));
    }
    if (match.marketplaceId && match.marketplaceId !== marketplaceId) {
      throw new Error(failureCode(EBAY_BUSINESS_POLICY_EXPECTED_MISSING, [
        kind.toUpperCase(),
        "MARKETPLACE_MISMATCH",
      ]));
    }
    return { policy: match, reusable: true as const };
  }
  // A policy without a provider-confirmed marketplaceId cannot be proven
  // usable for this marketplace, so it is never auto-selected.
  const scoped = policies.filter((policy) => policy.marketplaceId === marketplaceId);
  const requestedCategoryTypes = (input.categoryTypes ?? [])
    .map((category) => text(category.name).toUpperCase())
    .filter(Boolean);
  const candidates = requestedCategoryTypes.length
    ? scoped.filter((policy) =>
      policy.categoryTypes.some((category) => requestedCategoryTypes.includes(category)))
    : scoped;
  if (candidates.length > 1) {
    // The operator must pick one, so the ids are part of the failure detail.
    throw new Error(failureCode(EBAY_BUSINESS_POLICY_SELECTION_REQUIRED, [
      kind.toUpperCase(),
      String(candidates.length),
      ...candidates.slice(0, 5).map((policy) => policy.id),
    ]));
  }
  return candidates.length === 1
    ? { policy: candidates[0], reusable: true as const }
    : { policy: null, reusable: false as const };
}

function createdPolicyId(
  kind: EbayAccountPolicyKind,
  remote: RemoteResponse,
  marketplaceId: string,
) {
  const { idKey } = policyResources[kind];
  const errorIds = providerErrorIds(remote.data);
  if (remote.response.status < 200 || remote.response.status >= 300) {
    throw new Error(failureCode(EBAY_BUSINESS_POLICY_CREATE_FAILED, [
      kind.toUpperCase(),
      `HTTP_${remote.response.status}`,
      errorIds.length ? `ERROR_${errorIds.join("_")}` : undefined,
    ]));
  }
  const id = text(remote.data[idKey]);
  const returnedMarketplaceId = text(remote.data.marketplaceId).toUpperCase();
  if (!id || (returnedMarketplaceId && returnedMarketplaceId !== marketplaceId)) {
    // The create response is the only evidence that the policy exists with a
    // known id. Without it the caller must not persist anything.
    throw new Error(failureCode(EBAY_BUSINESS_POLICY_CREATE_UNVERIFIED, [kind.toUpperCase()]));
  }
  return id;
}

export async function ensureEbayBusinessPolicies(input: {
  payload: SecretPayload;
  marketplaceId: string;
  terms: EbayBusinessPolicyTerms;
  environment?: EbayAccountEnvironment;
  expectedPolicyIds?: Partial<Record<EbayAccountPolicyKind, string>>;
}): Promise<EbayBusinessPolicyResolution> {
  const marketplaceId = assertEbayBootstrapMarketplaceId(input.marketplaceId);
  const environment = input.environment ?? "production";
  const kinds: EbayAccountPolicyKind[] = ["fulfillment", "payment", "return"];
  // The create body is validated before any provider write, so a malformed
  // operator term never leaves a partially created policy set behind.
  const bodies = Object.fromEntries(kinds.map((kind) => [
    kind,
    policyBody(kind, input.terms, marketplaceId),
  ])) as Record<EbayAccountPolicyKind, UnknownRecord>;

  const listed = await runWithProviderReadOnlyTransport(async () => {
    const remotes = await Promise.all(kinds.map((kind) => ebayRequest({
      payload: input.payload,
      environment,
      method: "GET",
      path: policyResources[kind].path,
      query: new URLSearchParams({ marketplace_id: marketplaceId }),
    })));
    return kinds.map((kind, index) => ({
      kind,
      policies: ebayBusinessPolicyList(remotes[index], kind),
    }));
  });

  const created: Record<EbayAccountPolicyKind, boolean> = {
    fulfillment: false,
    payment: false,
    return: false,
  };
  const resolved: Partial<Record<EbayAccountPolicyKind, string>> = {};
  let providerWrites = 0;
  for (const entry of listed) {
    const selection = selectUsableEbayPolicy({
      kind: entry.kind,
      policies: entry.policies,
      marketplaceId,
      categoryTypes: input.terms[entry.kind].categoryTypes,
      expectedPolicyId: input.expectedPolicyIds?.[entry.kind],
    });
    if (selection.policy) {
      resolved[entry.kind] = selection.policy.id;
      continue;
    }
    const remote = await ebayRequest({
      payload: input.payload,
      environment,
      method: "POST",
      path: policyResources[entry.kind].path,
      body: bodies[entry.kind],
    });
    providerWrites += 1;
    resolved[entry.kind] = createdPolicyId(entry.kind, remote, marketplaceId);
    created[entry.kind] = true;
  }

  const fulfillmentPolicyId = resolved.fulfillment;
  const paymentPolicyId = resolved.payment;
  const returnPolicyId = resolved.return;
  if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
    throw new Error(EBAY_BUSINESS_POLICY_CREATE_UNVERIFIED);
  }
  return {
    marketplaceId,
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    created,
    reusedPolicyIds: {
      fulfillment: created.fulfillment ? "" : fulfillmentPolicyId,
      payment: created.payment ? "" : paymentPolicyId,
      return: created.return ? "" : returnPolicyId,
    },
    providerWrites,
  };
}

// ---------------------------------------------------------------------------
// Inventory location
// ---------------------------------------------------------------------------

export type EbayInventoryLocationAddress = {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
};

export type EbayInventoryLocationTerms = {
  merchantLocationKey: string;
  name: string;
  address: EbayInventoryLocationAddress;
  phone?: string;
  locationTypes?: string[];
  merchantLocationStatus?: "ENABLED" | "DISABLED";
};

export type EbayInventoryLocationResolution = {
  merchantLocationKey: string;
  created: boolean;
  existingLocationKeys: string[];
  addressCountry: string;
};

function sanitizedMerchantLocationKey(value: unknown) {
  const key = requiredText(value, `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:merchantLocationKey`);
  // eBay documents 1-50 characters for createInventoryLocation.
  if (!/^[A-Za-z0-9_-]{1,50}$/u.test(key)) {
    throw new Error(`${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:merchantLocationKey`);
  }
  return key;
}

function sanitizedLocationAddress(value: unknown) {
  const address = record(value);
  const addressLine1 = requiredText(
    address.addressLine1,
    `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:address.addressLine1`,
  );
  const city = requiredText(address.city, `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:address.city`);
  const postalCode = requiredText(
    address.postalCode,
    `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:address.postalCode`,
  );
  const country = requiredText(
    address.country,
    `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:address.country`,
  ).toUpperCase();
  if (!/^[A-Z]{2}$/u.test(country)) {
    throw new Error(`${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:address.country`);
  }
  const stateOrProvince = requiredText(
    address.stateOrProvince,
    `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:address.stateOrProvince`,
  );
  return {
    addressLine1,
    city,
    stateOrProvince,
    postalCode,
    country,
    ...(optionalText(address.addressLine2)
      ? { addressLine2: text(address.addressLine2) }
      : {}),
  };
}

function locationBody(terms: EbayInventoryLocationTerms) {
  const name = requiredText(terms.name, `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:name`);
  const address = sanitizedLocationAddress(terms.address);
  const locationTypes = terms.locationTypes === undefined
    ? undefined
    : (Array.isArray(terms.locationTypes) && terms.locationTypes.length
      ? terms.locationTypes.map((type) =>
        requiredText(type, `${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:locationTypes`).toUpperCase())
      : (() => {
        throw new Error(`${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:locationTypes`);
      })());
  const status = terms.merchantLocationStatus === undefined
    ? undefined
    : (["ENABLED", "DISABLED"].includes(terms.merchantLocationStatus)
      ? terms.merchantLocationStatus
      : (() => {
        throw new Error(`${EBAY_INVENTORY_LOCATION_INPUT_INVALID}:merchantLocationStatus`);
      })());
  return {
    name,
    location: { address },
    ...(optionalText(terms.phone) ? { phone: text(terms.phone) } : {}),
    ...(locationTypes ? { locationTypes } : {}),
    ...(status ? { merchantLocationStatus: status } : {}),
  };
}

export function ebayInventoryLocationList(remote: RemoteResponse) {
  if (remote.response.status !== 200 || providerErrorsPresent(remote.data)) {
    throw new Error(failureCode(
      EBAY_INVENTORY_LOCATION_GET_UNVERIFIED,
      [`HTTP_${remote.response.status}`],
    ));
  }
  const raw = remote.data.locations;
  if (!Array.isArray(raw)) {
    throw new Error(failureCode(EBAY_INVENTORY_LOCATION_GET_UNVERIFIED, ["RESPONSE_MALFORMED"]));
  }
  const locations = raw.map((entry) => {
    const row = record(entry);
    const key = text(row.merchantLocationKey);
    if (!key) throw new Error(failureCode(EBAY_INVENTORY_LOCATION_GET_UNVERIFIED, ["KEY_MISSING"]));
    return {
      merchantLocationKey: key,
      status: text(row.merchantLocationStatus).toUpperCase(),
      country: text(record(record(row.location ?? row.physicalLocation).address).country)
        .toUpperCase(),
    };
  });
  const total = typeof remote.data.total === "number" && Number.isSafeInteger(remote.data.total)
    ? remote.data.total
    : locations.length;
  if (total > locations.length || remote.data.next) {
    // Never create while the existing location set is unproven.
    throw new Error(failureCode(EBAY_INVENTORY_LOCATION_GET_UNVERIFIED, ["PAGE_INCOMPLETE"]));
  }
  return locations;
}

export function selectUsableEbayInventoryLocation(input: {
  locations: ReturnType<typeof ebayInventoryLocationList>;
  merchantLocationKey: string;
  expectedMerchantLocationKey?: string;
}) {
  const requested = input.merchantLocationKey;
  const expected = text(input.expectedMerchantLocationKey);
  const requestedMatch = input.locations.find(
    (location) => location.merchantLocationKey === requested,
  );
  if (requestedMatch && requestedMatch.status !== "DISABLED") {
    return { merchantLocationKey: requestedMatch.merchantLocationKey, reusable: true as const };
  }
  if (requestedMatch && requestedMatch.status === "DISABLED") {
    throw new Error(failureCode(EBAY_INVENTORY_LOCATION_DISABLED, [requested]));
  }
  if (expected && expected !== requested) {
    const expectedMatch = input.locations.find(
      (location) => location.merchantLocationKey === expected && location.status !== "DISABLED",
    );
    if (expectedMatch) {
      return { merchantLocationKey: expectedMatch.merchantLocationKey, reusable: true as const };
    }
  }
  return { merchantLocationKey: requested, reusable: false as const };
}

export async function ensureEbayInventoryLocation(input: {
  payload: SecretPayload;
  terms: EbayInventoryLocationTerms;
  environment?: EbayAccountEnvironment;
  expectedMerchantLocationKey?: string;
}): Promise<EbayInventoryLocationResolution> {
  const environment = input.environment ?? "production";
  const merchantLocationKey = sanitizedMerchantLocationKey(input.terms.merchantLocationKey);
  // Validated before any write so a bad address never reaches the provider.
  const body = locationBody({ ...input.terms, merchantLocationKey });

  const locations = await runWithProviderReadOnlyTransport(async () => {
    const remote = await ebayRequest({
      payload: input.payload,
      environment,
      method: "GET",
      path: "/sell/inventory/v1/location",
      query: new URLSearchParams({ limit: "200", offset: "0" }),
    });
    return ebayInventoryLocationList(remote);
  });

  const selection = selectUsableEbayInventoryLocation({
    locations,
    merchantLocationKey,
    expectedMerchantLocationKey: input.expectedMerchantLocationKey,
  });
  const existing = locations.filter((location) => location.status !== "DISABLED")
    .map((location) => location.merchantLocationKey);
  if (selection.reusable) {
    const matched = locations.find(
      (location) => location.merchantLocationKey === selection.merchantLocationKey,
    );
    return {
      merchantLocationKey: selection.merchantLocationKey,
      created: false,
      existingLocationKeys: existing,
      addressCountry: matched?.country ?? "",
    };
  }

  const remote = await ebayRequest({
    payload: input.payload,
    environment,
    method: "POST",
    path: `/sell/inventory/v1/location/${encodeURIComponent(selection.merchantLocationKey)}`,
    body,
  });
  const errorIds = providerErrorIds(remote.data);
  // createInventoryLocation answers 204 No Content without a payload.
  if (![200, 201, 204].includes(remote.response.status)) {
    throw new Error(failureCode(EBAY_INVENTORY_LOCATION_CREATE_FAILED, [
      `HTTP_${remote.response.status}`,
      errorIds.length ? `ERROR_${errorIds.join("_")}` : undefined,
    ]));
  }
  return {
    merchantLocationKey: selection.merchantLocationKey,
    created: true,
    existingLocationKeys: existing,
    addressCountry: text(body.location.address.country).toUpperCase(),
  };
}
