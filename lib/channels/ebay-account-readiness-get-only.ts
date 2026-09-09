import {
  ebayRequest,
  runWithProviderReadOnlyTransport,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function providerErrorsPresent(data: Record<string, unknown>) {
  if (!Object.hasOwn(data, "errors")) return false;
  return !Array.isArray(data.errors) || data.errors.length > 0;
}

function marketplaceId(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (!/^EBAY_[A-Z]{2}$/u.test(normalized)) {
    throw new Error("EBAY_MARKETPLACE_ID_INVALID");
  }
  return normalized;
}

export type EbaySellerPrivilegeEvidence = {
  httpStatus: number;
  sellerRegistrationCompleted: boolean | null;
  sellingLimit: {
    amount: string | null;
    currency: string | null;
    quantity: number | null;
  };
  verified: boolean;
  code: string;
};

export type EbayInventoryLocationSummary = {
  merchantLocationKey: string;
  name: string | null;
  status: string | null;
  country: string | null;
};

export type EbayInventoryLocationsEvidence = {
  httpStatus: number;
  complete: boolean;
  total: number | null;
  locations: EbayInventoryLocationSummary[];
  enabledLocationKeys: string[];
  exactEnabledLocationKey: string | null;
  code: string;
};

export type EbayAccountReadinessGetOnlyResult = {
  marketplaceId: string;
  privilege: EbaySellerPrivilegeEvidence;
  inventoryLocations: EbayInventoryLocationsEvidence;
};

type EbayAmountSummary = {
  value: string | null;
  currency: string | null;
};

export type EbaySelectedPolicyDetails = {
  fulfillment: {
    httpStatus: number;
    verified: boolean;
    id: string | null;
    name: string | null;
    marketplaceId: string | null;
    handlingTime: { value: number | null; unit: string | null } | null;
    shipToIncluded: string[];
    shipToExcluded: string[];
    shippingOptions: Array<{
      optionType: string | null;
      costType: string | null;
      services: Array<{
        shippingCarrierCode: string | null;
        shippingServiceCode: string | null;
        freeShipping: boolean | null;
        shippingCost: EbayAmountSummary | null;
        additionalShippingCost: EbayAmountSummary | null;
        shipToIncluded: string[];
      }>;
    }>;
  };
  payment: {
    httpStatus: number;
    verified: boolean;
    id: string | null;
    name: string | null;
    marketplaceId: string | null;
    immediatePay: boolean | null;
    categoryTypes: string[];
    paymentMethods: string[];
  };
};

export function ebaySellerPrivilegeEvidence(
  remote: RemoteResponse,
): EbaySellerPrivilegeEvidence {
  const providerErrors = providerErrorsPresent(remote.data);
  const limit = record(remote.data.sellingLimit);
  const amount = record(limit.amount);
  const amountValue = text(amount.value);
  const currency = text(amount.currency).toUpperCase();
  const quantity = typeof limit.quantity === "number"
      && Number.isSafeInteger(limit.quantity)
      && limit.quantity >= 0
    ? limit.quantity
    : null;
  const registration = typeof remote.data.sellerRegistrationCompleted === "boolean"
    ? remote.data.sellerRegistrationCompleted
    : null;
  const limitVerified = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(amountValue)
    && /^[A-Z]{3}$/u.test(currency)
    && quantity !== null;
  const verified = remote.response.status === 200
    && !providerErrors
    && registration === true
    && limitVerified;
  return {
    httpStatus: remote.response.status,
    sellerRegistrationCompleted: registration,
    sellingLimit: {
      amount: amountValue || null,
      currency: currency || null,
      quantity,
    },
    verified,
    code: remote.response.status !== 200
      ? `EBAY_SELLER_PRIVILEGE_UNVERIFIED:HTTP_${remote.response.status}`
      : providerErrors
        ? "EBAY_SELLER_PRIVILEGE_PROVIDER_ERRORS"
        : registration !== true
        ? "EBAY_SELLER_REGISTRATION_INCOMPLETE"
        : !limitVerified
          ? "EBAY_SELLING_LIMIT_MALFORMED"
          : "EBAY_SELLER_PRIVILEGE_VERIFIED",
  };
}

export function ebayInventoryLocationsEvidence(
  remote: RemoteResponse,
): EbayInventoryLocationsEvidence {
  const providerErrors = providerErrorsPresent(remote.data);
  const rawLocations = remote.data.locations;
  const total = typeof remote.data.total === "number"
      && Number.isSafeInteger(remote.data.total)
      && remote.data.total >= 0
    ? remote.data.total
    : null;
  const parsed = Array.isArray(rawLocations)
    ? rawLocations.map((value): EbayInventoryLocationSummary | null => {
        const location = record(value);
        const key = text(location.merchantLocationKey);
        if (!key || key.length > 80) return null;
        const physical = record(location.location ?? location.physicalLocation);
        const address = record(physical.address);
        const status = text(location.merchantLocationStatus).toUpperCase();
        const country = text(address.country).toUpperCase();
        if (status && !["ENABLED", "DISABLED"].includes(status)) return null;
        if (country && !/^[A-Z]{2}$/u.test(country)) return null;
        return {
          merchantLocationKey: key,
          name: text(location.name) || null,
          status: status || null,
          country: country || null,
        };
      })
    : [];
  const locations = parsed.filter(
    (value): value is EbayInventoryLocationSummary => value !== null,
  );
  const keys = locations.map((location) => location.merchantLocationKey);
  const complete = remote.response.status === 200
    && !providerErrors
    && Array.isArray(rawLocations)
    && parsed.every(Boolean)
    && total === locations.length
    && !remote.data.next
    && keys.length === new Set(keys).size;
  const enabledLocationKeys = complete
    ? locations
      .filter((location) => location.status === "ENABLED" && Boolean(location.country))
      .map((location) => location.merchantLocationKey)
    : [];
  return {
    httpStatus: remote.response.status,
    complete,
    total,
    locations: complete ? locations : [],
    enabledLocationKeys,
    exactEnabledLocationKey: enabledLocationKeys.length === 1
      ? enabledLocationKeys[0]
      : null,
    code: remote.response.status !== 200
      ? `EBAY_INVENTORY_LOCATIONS_UNVERIFIED:HTTP_${remote.response.status}`
      : providerErrors
        ? "EBAY_INVENTORY_LOCATIONS_PROVIDER_ERRORS"
        : !complete
        ? "EBAY_INVENTORY_LOCATIONS_RESPONSE_MALFORMED"
        : enabledLocationKeys.length === 0
          ? "EBAY_INVENTORY_LOCATION_NONE_ENABLED"
          : enabledLocationKeys.length > 1
            ? "EBAY_INVENTORY_LOCATION_SELECTION_REQUIRED"
            : "EBAY_INVENTORY_LOCATION_VERIFIED",
  };
}

function amountSummary(value: unknown): EbayAmountSummary | null {
  const amount = record(value);
  if (!Object.keys(amount).length) return null;
  return {
    value: text(amount.value) || null,
    currency: text(amount.currency).toUpperCase() || null,
  };
}

function regionNames(value: unknown) {
  const regions = record(value);
  return Array.isArray(regions.regionIncluded)
    ? regions.regionIncluded.map(record).map((region) => text(region.regionName)).filter(Boolean)
    : [];
}

function excludedRegionNames(value: unknown) {
  const regions = record(value);
  return Array.isArray(regions.regionExcluded)
    ? regions.regionExcluded.map(record).map((region) => text(region.regionName)).filter(Boolean)
    : [];
}

function policyId(value: string, field: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(normalized)) {
    throw new Error(`EBAY_${field}_POLICY_ID_INVALID`);
  }
  return normalized;
}

export async function readEbaySelectedPoliciesGetOnly(input: {
  payload: SecretPayload;
  marketplaceId?: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  environment?: "sandbox" | "production";
}): Promise<EbaySelectedPolicyDetails> {
  const selectedMarketplaceId = marketplaceId(
    input.marketplaceId ?? input.payload.marketplace_id,
  );
  const fulfillmentPolicyId = policyId(input.fulfillmentPolicyId, "FULFILLMENT");
  const paymentPolicyId = policyId(input.paymentPolicyId, "PAYMENT");
  const environment = input.environment ?? "production";
  return runWithProviderReadOnlyTransport(async () => {
    const [fulfillmentRemote, paymentRemote] = await Promise.all([
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: `/sell/account/v1/fulfillment_policy/${fulfillmentPolicyId}`,
      }),
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: `/sell/account/v1/payment_policy/${paymentPolicyId}`,
      }),
    ]);
    const fulfillment = fulfillmentRemote.data;
    const fulfillmentProviderErrors = providerErrorsPresent(fulfillment);
    const fulfillmentMarketplace = text(fulfillment.marketplaceId).toUpperCase();
    const fulfillmentId = text(fulfillment.fulfillmentPolicyId);
    const handlingTime = record(fulfillment.handlingTime);
    const shippingOptions = Array.isArray(fulfillment.shippingOptions)
      ? fulfillment.shippingOptions.map(record).map((option) => ({
          optionType: text(option.optionType).toUpperCase() || null,
          costType: text(option.costType).toUpperCase() || null,
          services: Array.isArray(option.shippingServices)
            ? option.shippingServices.map(record).map((service) => ({
                shippingCarrierCode: text(service.shippingCarrierCode) || null,
                shippingServiceCode: text(service.shippingServiceCode) || null,
                freeShipping: typeof service.freeShipping === "boolean"
                  ? service.freeShipping
                  : null,
                shippingCost: amountSummary(service.shippingCost),
                additionalShippingCost: amountSummary(service.additionalShippingCost),
                shipToIncluded: regionNames(service.shipToLocations),
              }))
            : [],
        }))
      : [];

    const payment = paymentRemote.data;
    const paymentProviderErrors = providerErrorsPresent(payment);
    const paymentMarketplace = text(payment.marketplaceId).toUpperCase();
    const paymentId = text(payment.paymentPolicyId);
    const categoryTypes = Array.isArray(payment.categoryTypes)
      ? payment.categoryTypes.map(record).map((category) => text(category.name).toUpperCase()).filter(Boolean)
      : [];
    const paymentMethods = Array.isArray(payment.paymentMethods)
      ? payment.paymentMethods.map(record).map((method) =>
          text(method.paymentMethodType).toUpperCase()).filter(Boolean)
      : [];

    return {
      fulfillment: {
        httpStatus: fulfillmentRemote.response.status,
        verified: fulfillmentRemote.response.status === 200
          && !fulfillmentProviderErrors
          && fulfillmentId === fulfillmentPolicyId
          && fulfillmentMarketplace === selectedMarketplaceId,
        id: fulfillmentId || null,
        name: text(fulfillment.name) || null,
        marketplaceId: fulfillmentMarketplace || null,
        handlingTime: Object.keys(handlingTime).length
          ? {
              value: typeof handlingTime.value === "number"
                  && Number.isSafeInteger(handlingTime.value)
                  && handlingTime.value >= 0
                ? handlingTime.value
                : null,
              unit: text(handlingTime.unit).toUpperCase() || null,
            }
          : null,
        shipToIncluded: regionNames(fulfillment.shipToLocations),
        shipToExcluded: excludedRegionNames(fulfillment.shipToLocations),
        shippingOptions,
      },
      payment: {
        httpStatus: paymentRemote.response.status,
        verified: paymentRemote.response.status === 200
          && !paymentProviderErrors
          && paymentId === paymentPolicyId
          && paymentMarketplace === selectedMarketplaceId,
        id: paymentId || null,
        name: text(payment.name) || null,
        marketplaceId: paymentMarketplace || null,
        immediatePay: typeof payment.immediatePay === "boolean"
          ? payment.immediatePay
          : null,
        categoryTypes,
        paymentMethods,
      },
    };
  });
}

export async function readEbayAccountReadinessGetOnly(input: {
  payload: SecretPayload;
  marketplaceId?: string;
  environment?: "sandbox" | "production";
}): Promise<EbayAccountReadinessGetOnlyResult> {
  const selectedMarketplaceId = marketplaceId(
    input.marketplaceId ?? input.payload.marketplace_id,
  );
  const environment = input.environment ?? "production";
  return runWithProviderReadOnlyTransport(async () => {
    const [privilegeRemote, locationsRemote] = await Promise.all([
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: "/sell/account/v1/privilege/",
      }),
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: "/sell/inventory/v1/location",
        query: new URLSearchParams({ limit: "200", offset: "0" }),
      }),
    ]);
    return {
      marketplaceId: selectedMarketplaceId,
      privilege: ebaySellerPrivilegeEvidence(privilegeRemote),
      inventoryLocations: ebayInventoryLocationsEvidence(locationsRemote),
    };
  });
}
