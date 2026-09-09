import type { RemoteResponse } from "./protocols";
import {
  ebayInventoryConditionId,
  type EbayTaxonomyPolicyGetOnlyResult,
} from "./ebay-taxonomy-policy-get-only";
import { listingPublicationReadbackExpectation } from "./listing-publication-readback";
import {
  listingExpectedPublicationLocale,
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
} from "./listing-publication-state";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Inventory API absence only. Trading/manual listings require separate adoption. */
export function ebayInventorySkuAbsent(remote: RemoteResponse) {
  const errors = remote.data.errors;
  return [400, 404].includes(remote.response.status) && Array.isArray(errors) && errors.length > 0
    && errors.every(value => {
      const error = record(value);
      return error.domain === "API_INVENTORY" && [25702, 25710, "25702", "25710"].includes(error.errorId as number | string);
    });
}

/** Exact getOffers absence observed from the Inventory API. Other 404s fail closed. */
export function ebayOffersAbsent(remote: RemoteResponse) {
  const errors = remote.data.errors;
  return remote.response.status === 404
    && Array.isArray(errors)
    && errors.length > 0
    && errors.every((value) => {
      const error = record(value);
      return error.domain === "API_INVENTORY" && (error.errorId === 25713 || error.errorId === "25713");
    });
}

export function ebayExactReconciliationOffer(remote: RemoteResponse, sku: string, marketplaceId: string, format: string) {
  const data = remote.data;
  if (!remote.response.ok || data.errors || !Array.isArray(data.offers)
      || !Number.isSafeInteger(data.total) || data.total !== data.offers.length
      || data.next || data.offers.length > 25) return null;
  const matches = data.offers.map(record).filter(offer => offer.sku === sku
    && offer.marketplaceId === marketplaceId && offer.format === format);
  if (matches.length !== 1 || typeof matches[0].offerId !== "string" || !matches[0].offerId.trim()) return null;
  return matches[0];
}

export type EbayCreateLineageDecision = {
  action: "create_inventory" | "create_offer" | "resume_offer" | "blocked";
  code: string;
  inventoryPresent: boolean;
  offerId: string | null;
};

/**
 * Decides the only safe create/retry branch from complete official GET results.
 * It never treats an arbitrary HTTP 404 or a partial offer page as absence.
 */
export function ebayCreateLineageDecision(input: {
  inventory: RemoteResponse;
  offers: RemoteResponse;
  sku: string;
  marketplaceId: string;
  format: string;
}): EbayCreateLineageDecision {
  const inventoryAbsent = ebayInventorySkuAbsent(input.inventory);
  const inventorySku = typeof input.inventory.data.sku === "string"
    ? input.inventory.data.sku.trim()
    : "";
  const inventoryPresent = input.inventory.response.ok
    && (!inventorySku || inventorySku === input.sku);
  if (!inventoryAbsent && !inventoryPresent) {
    return {
      action: "blocked",
      code: input.inventory.response.ok
        ? "EBAY_INVENTORY_SKU_MISMATCH"
        : "EBAY_INVENTORY_ABSENCE_UNVERIFIED",
      inventoryPresent: false,
      offerId: null,
    };
  }

  const offersAbsent = ebayOffersAbsent(input.offers);
  const data = offersAbsent
    ? { total: 0, offers: [] }
    : input.offers.data;
  if ((!input.offers.response.ok && !offersAbsent)
      || data.errors
      || !Array.isArray(data.offers)
      || !Number.isSafeInteger(data.total)
      || data.total !== data.offers.length
      || data.next
      || data.offers.length > 200) {
    return {
      action: "blocked",
      code: "EBAY_OFFER_LINEAGE_UNVERIFIED",
      inventoryPresent,
      offerId: null,
    };
  }
  const matches = data.offers.map(record).filter((offer) =>
    offer.sku === input.sku
      && offer.marketplaceId === input.marketplaceId
      && offer.format === input.format);
  if (matches.length !== data.offers.length) {
    return {
      action: "blocked",
      code: "EBAY_OFFER_TARGET_MISMATCH",
      inventoryPresent,
      offerId: null,
    };
  }
  if (matches.length > 1) {
    return {
      action: "blocked",
      code: "EBAY_OFFER_NOT_UNIQUE",
      inventoryPresent,
      offerId: null,
    };
  }
  if (matches.length === 1) {
    const offerId = typeof matches[0].offerId === "string"
      ? matches[0].offerId.trim()
      : "";
    if (!inventoryPresent || !offerId) {
      return {
        action: "blocked",
        code: inventoryPresent
          ? "EBAY_OFFER_ID_MISSING"
          : "EBAY_OFFER_WITHOUT_INVENTORY",
        inventoryPresent,
        offerId: null,
      };
    }
    return {
      action: "resume_offer",
      code: "EBAY_EXACT_OFFER_PRESENT",
      inventoryPresent: true,
      offerId,
    };
  }
  return inventoryPresent
    ? {
        action: "create_offer",
        code: "EBAY_INVENTORY_PRESENT_OFFER_ABSENT",
        inventoryPresent: true,
        offerId: null,
      }
    : {
        action: "create_inventory",
        code: "EBAY_INVENTORY_AND_OFFER_ABSENT",
        inventoryPresent: false,
        offerId: null,
      };
}

export type EbayInventoryLocationEvidence = {
  ok: boolean;
  code: string;
  merchantLocationKey: string;
  status: string | null;
  country: string | null;
};

export function ebayInventoryLocationEvidence(
  remote: RemoteResponse,
  merchantLocationKey: string,
): EbayInventoryLocationEvidence {
  const locations = Array.isArray(remote.data.locations)
    ? remote.data.locations.map(record)
    : [];
  const total = remote.data.total;
  const complete = remote.response.ok
    && Number.isSafeInteger(total)
    && total === locations.length
    && !remote.data.next;
  const matches = locations.filter((row) => row.merchantLocationKey === merchantLocationKey);
  if (!complete || matches.length !== 1) {
    return {
      ok: false,
      code: complete ? "EBAY_INVENTORY_LOCATION_NOT_UNIQUE" : "EBAY_INVENTORY_LOCATION_UNVERIFIED",
      merchantLocationKey,
      status: null,
      country: null,
    };
  }
  const location = matches[0];
  const physical = record(location.location ?? location.physicalLocation);
  const address = record(physical.address);
  const status = typeof location.merchantLocationStatus === "string"
    ? location.merchantLocationStatus.trim().toUpperCase()
    : "";
  const country = typeof address.country === "string"
    ? address.country.trim().toUpperCase()
    : "";
  return {
    ok: status === "ENABLED" && /^[A-Z]{2}$/u.test(country),
    code: status !== "ENABLED"
      ? "EBAY_INVENTORY_LOCATION_NOT_ENABLED"
      : !/^[A-Z]{2}$/u.test(country)
        ? "EBAY_INVENTORY_LOCATION_COUNTRY_UNVERIFIED"
        : "EBAY_INVENTORY_LOCATION_VERIFIED",
    merchantLocationKey,
    status: status || null,
    country: country || null,
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function assertEbayCreateRequiredFields(
  arguments_: Record<string, unknown>,
) {
  const inventoryItem = record(arguments_.inventoryItem);
  const product = record(inventoryItem.product);
  const availability = record(inventoryItem.availability);
  const shipAvailability = record(availability.shipToLocationAvailability);
  const offer = record(arguments_.offer);
  const pricing = record(record(offer.pricingSummary).price);
  const marketplaceId = text(offer.marketplaceId).toUpperCase();
  const currency = text(pricing.currency).toUpperCase();
  const price = text(pricing.value);
  const inventoryQuantity = shipAvailability.quantity;
  const offerQuantity = offer.availableQuantity;
  const images = Array.isArray(product.imageUrls)
    ? product.imageUrls
    : [];
  const imagesValid = images.length > 0
    && images.every((value): value is string =>
      typeof value === "string" && Boolean(value.trim()) && value === value.trim())
    && images.length === new Set(images).size;
  const rawAspects = product.aspects;
  const aspectsValid = rawAspects === undefined || (
    Boolean(rawAspects)
    && typeof rawAspects === "object"
    && !Array.isArray(rawAspects)
    && Object.entries(rawAspects as Record<string, unknown>).every(([name, values]) =>
      Boolean(name.trim())
      && name === name.trim()
      && Array.isArray(values)
      && values.length > 0
      && values.every((value): value is string =>
        typeof value === "string" && Boolean(value.trim()) && value === value.trim())
      && values.length === new Set(values).size)
  );
  const invalid = ([
    ["sku", Boolean(text(arguments_.sku))],
    ["offer.marketplaceId", /^EBAY_[A-Z]{2}$/u.test(marketplaceId)],
    ["offer.categoryId", /^[1-9]\d{0,9}$/u.test(text(offer.categoryId))],
    ["inventoryItem.condition", Boolean(text(inventoryItem.condition))],
    ["inventoryItem.product.title", Boolean(text(product.title))],
    ["inventoryItem.product.description", Boolean(text(product.description))],
    ["inventoryItem.product.imageUrls", imagesValid],
    ["inventoryItem.product.aspects", aspectsValid],
    ["inventoryItem.availability.shipToLocationAvailability.quantity",
      Number.isSafeInteger(inventoryQuantity) && Number(inventoryQuantity) > 0],
    ["offer.availableQuantity",
      Number.isSafeInteger(offerQuantity)
        && Number(offerQuantity) > 0
        && offerQuantity === inventoryQuantity],
    ["offer.listingDescription", Boolean(text(offer.listingDescription))],
    ["offer.pricingSummary.price.value",
      /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(price) && Number(price) > 0],
    ["offer.pricingSummary.price.currency",
      /^[A-Z]{3}$/u.test(currency) && (marketplaceId !== "EBAY_US" || currency === "USD")],
  ] satisfies Array<[string, boolean]>).flatMap(([path, ok]) => ok ? [] : [path]);
  if (invalid.length) {
    throw new Error(`EBAY_CREATE_REQUIRED_FIELDS_INVALID:${invalid.join(",")}`);
  }
}

export function assertEbayCreatePublicationContract(
  arguments_: Record<string, unknown>,
) {
  const offer = record(arguments_.offer);
  const marketplaceId = text(offer.marketplaceId).toUpperCase();
  const marketplace = marketplaceId.startsWith("EBAY_")
    ? marketplaceId.slice("EBAY_".length)
    : "";
  const expectation = listingPublicationReadbackExpectation(arguments_);
  const expectedLocale = listingExpectedPublicationLocale("ebay", marketplace);
  const invalid = [
    arguments_.publicationStateContract !== listingRemoteStateContractVersion
      ? "publicationStateContract"
      : null,
    !listingPublicationIntentFromArguments(arguments_)
      ? "publicationIntent"
      : null,
    !expectation
      ? "publicationExpectation"
      : null,
    expectation && (!expectedLocale || expectation.locale !== expectedLocale)
      ? "publicationExpectedLocale"
      : null,
  ].filter((value): value is string => Boolean(value));
  if (invalid.length) {
    throw new Error(`EBAY_CREATE_PUBLICATION_CONTRACT_INVALID:${invalid.join(",")}`);
  }
}

function aspectValues(arguments_: Record<string, unknown>) {
  const inventoryItem = record(arguments_.inventoryItem);
  const product = record(inventoryItem.product);
  const aspects = record(product.aspects);
  return Object.fromEntries(
    Object.entries(aspects).map(([name, values]) => [
      name,
      Array.isArray(values) ? values.map(text).filter(Boolean) : [],
    ]),
  ) as Record<string, string[]>;
}

export type EbayCreateConfigurationEvidence = {
  ok: boolean;
  code: string;
  marketplaceId: string;
  categoryTreeId: string | null;
  categoryId: string;
  currency: string;
  price: string;
  condition: string;
  conditionId: string | null;
  requiredAspectNames: string[];
  upcomingRequiredAspectNames: string[];
  missingAspectNames: string[];
  invalidSelectionAspectNames: string[];
  invalidCardinalityAspectNames: string[];
  invalidConditionalAspectValues: string[];
  fulfillmentPolicyName: string | null;
  paymentPolicyName: string | null;
  returnPolicyName: string | null;
  returnTerms: Record<string, unknown> | null;
  location: EbayInventoryLocationEvidence;
};

/** Validates only provider-read facts; it never chooses policy/aspect values. */
export function ebayCreateConfigurationEvidence(input: {
  arguments: Record<string, unknown>;
  taxonomy: EbayTaxonomyPolicyGetOnlyResult;
  locationRemote: RemoteResponse;
}): EbayCreateConfigurationEvidence {
  const offer = record(input.arguments.offer);
  const price = record(record(offer.pricingSummary).price);
  const policies = record(offer.listingPolicies);
  const marketplaceId = text(offer.marketplaceId).toUpperCase();
  const categoryId = text(offer.categoryId);
  const currency = text(price.currency).toUpperCase();
  const priceValue = text(price.value);
  const inventoryItem = record(input.arguments.inventoryItem);
  const condition = text(inventoryItem.condition).toUpperCase();
  const conditionId = ebayInventoryConditionId(condition);
  const aspects = aspectValues(input.arguments);
  const missingAspectNames = input.taxonomy.requiredAspectNames.filter((name) =>
    !aspects[name]?.length);
  const aspectMetadata = new Map(input.taxonomy.aspects.map((item) => [item.name, item]));
  const invalidSelectionAspectNames = Object.entries(aspects).flatMap(([name, values]) => {
    const summary = aspectMetadata.get(name);
    return summary?.mode === "SELECTION_ONLY"
      && values.some((value) => !(input.taxonomy.aspectProbeHits[name] ?? []).includes(value))
      ? [name]
      : [];
  });
  const invalidCardinalityAspectNames = Object.entries(aspects).flatMap(([name, values]) =>
    aspectMetadata.get(name)?.cardinality === "SINGLE" && values.length > 1
      ? [name]
      : []);
  const invalidConditionalAspectValues = Object.entries(aspects).flatMap(([name, values]) => {
    const summary = aspectMetadata.get(name);
    if (!summary) return [];
    return values.flatMap((value) => {
      const exactValue = summary.values.find((candidate) => candidate.value === value);
      if (!exactValue?.constraints.length) return [];
      const applicable = exactValue.constraints.every((constraint) =>
        (aspects[constraint.aspectName] ?? []).some((parentValue) =>
          constraint.aspectValues.includes(parentValue)));
      return applicable ? [] : [`${name}=${value}`];
    });
  });
  const selectedPolicy = (kind: "fulfillment" | "payment" | "return") => {
    const id = text(policies[`${kind}PolicyId`]);
    const summary = input.taxonomy[`${kind}Policy`];
    const indexes = summary.ids.flatMap((candidate, index) =>
      candidate === id ? [index] : []);
    return indexes.length === 1
      ? { id, name: summary.names[indexes[0]] ?? null }
      : null;
  };
  const fulfillment = selectedPolicy("fulfillment");
  const payment = selectedPolicy("payment");
  const returnPolicy = selectedPolicy("return");
  const returnDetails = input.taxonomy.returnPolicyDetails.filter((item) =>
    item.id === returnPolicy?.id);
  const returnTermsComplete = returnDetails.length === 1
    && typeof returnDetails[0].returnsAccepted === "boolean"
    && (returnDetails[0].returnsAccepted === false
      || (returnDetails[0].returnPeriod?.value !== null
        && Boolean(returnDetails[0].returnPeriod?.unit)
        && Boolean(returnDetails[0].returnShippingCostPayer)));
  const merchantLocationKey = text(offer.merchantLocationKey);
  const location = ebayInventoryLocationEvidence(
    input.locationRemote,
    merchantLocationKey,
  );
  const validUsd = marketplaceId !== "EBAY_US"
    || (currency === "USD"
      && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(priceValue)
      && Number(priceValue) > 0);
  const checks: Array<[boolean, string]> = [
    [input.taxonomy.treeHttpStatus === 200
        && input.taxonomy.aspectsHttpStatus === 200
        && input.taxonomy.aspectsShapeVerified === true,
      "EBAY_CATEGORY_ASPECTS_UNVERIFIED"],
    [input.taxonomy.marketplaceId === marketplaceId && input.taxonomy.categoryId === categoryId,
      "EBAY_CATEGORY_TARGET_MISMATCH"],
    [input.taxonomy.conditionPolicyHttpStatus === 200
        && input.taxonomy.conditionPolicyCategoryTreeId === input.taxonomy.categoryTreeId
        && Boolean(conditionId)
        && input.taxonomy.conditionIds.includes(conditionId ?? ""),
      "EBAY_CATEGORY_CONDITION_UNVERIFIED"],
    [validUsd, "EBAY_USD_PRICE_REQUIRED"],
    [missingAspectNames.length === 0, "EBAY_REQUIRED_ASPECT_MISSING"],
    [invalidSelectionAspectNames.length === 0, "EBAY_ASPECT_SELECTION_UNVERIFIED"],
    [invalidCardinalityAspectNames.length === 0, "EBAY_ASPECT_CARDINALITY_INVALID"],
    [invalidConditionalAspectValues.length === 0, "EBAY_ASPECT_CONDITION_UNSATISFIED"],
    [Boolean(fulfillment), "EBAY_FULFILLMENT_POLICY_UNVERIFIED"],
    [Boolean(payment), "EBAY_PAYMENT_POLICY_UNVERIFIED"],
    [Boolean(returnPolicy), "EBAY_RETURN_POLICY_UNVERIFIED"],
    [returnTermsComplete, "EBAY_RETURN_POLICY_TERMS_UNVERIFIED"],
    [location.ok, location.code],
  ];
  const failed = checks.find(([ok]) => !ok);
  const selectedReturnTerms = returnDetails.length === 1
    ? {
        returnsAccepted: returnDetails[0].returnsAccepted,
        returnPeriod: returnDetails[0].returnPeriod,
        returnShippingCostPayer: returnDetails[0].returnShippingCostPayer,
        refundMethod: returnDetails[0].refundMethod,
        returnMethod: returnDetails[0].returnMethod,
        internationalOverride: returnDetails[0].internationalOverride,
      }
    : null;
  return {
    ok: !failed,
    code: failed?.[1] ?? "EBAY_CREATE_CONFIGURATION_VERIFIED",
    marketplaceId,
    categoryTreeId: input.taxonomy.categoryTreeId,
    categoryId,
    currency,
    price: priceValue,
    condition,
    conditionId,
    requiredAspectNames: input.taxonomy.requiredAspectNames,
    upcomingRequiredAspectNames: input.taxonomy.upcomingRequiredAspectNames,
    missingAspectNames,
    invalidSelectionAspectNames,
    invalidCardinalityAspectNames,
    invalidConditionalAspectValues,
    fulfillmentPolicyName: fulfillment?.name ?? null,
    paymentPolicyName: payment?.name ?? null,
    returnPolicyName: returnPolicy?.name ?? null,
    returnTerms: selectedReturnTerms,
    location,
  };
}
