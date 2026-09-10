import { createHash } from "node:crypto";
import { externalDetailCanonical } from "../external-detail-canonical";
import type { RemoteResponse } from "./protocols";
import {
  ebayInventoryConditionId,
  type EbayTaxonomyPolicyGetOnlyResult,
} from "./ebay-taxonomy-policy-get-only";
import { parseListingPublicationAssetBinding } from "./listing-publication-content";
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

export type EbayCreatePrewriteEvidence = {
  action: EbayCreateLineageDecision["action"];
  offerId: string | null;
  receiptSha256: string;
  providerAccountSubjectSha256: string | null;
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

const ebayCreateApprovalContract = "sellerpilot_ebay_create_approval_v1" as const;

export type EbayCreateApproval = {
  contract: typeof ebayCreateApprovalContract;
  approvalRevision: number;
  contentSha256: string;
  publicationExpectedFingerprint: string;
  inventoryQuantity: number;
  priceUsd: string;
  currency: "USD";
  categoryAssignmentRevisionSha256: string;
  categoryAssignment: {
    id: string;
    confirmedAt: string;
    updatedAt: string;
  };
  ledgerSnapshot: {
    productUpdatedAt: string;
    productSku: string;
    availableQuantity: number;
    priceUsd: string;
    draftId: string;
    draftVersion: number;
    draftUpdatedAt: string;
    draftDataSha256: string;
  };
  providerRequestBodiesSha256: {
    inventory: string;
    offer: string;
    publish: string;
  };
  revisionSha256: string;
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function canonicalSha256(value: unknown) {
  return createHash("sha256")
    .update(externalDetailCanonical(value), "utf8")
    .digest("hex");
}

/** Exact UTF-8 strings handed to fetch. Publish is deliberately bodyless. */
export function ebayCreateProviderRequestBodies(
  arguments_: Record<string, unknown>,
) {
  const sealed = record(arguments_.sellerpilotEbayProviderRequestBodies);
  const inventoryItem = record(arguments_.inventoryItem);
  const offer = { ...record(arguments_.offer), sku: text(arguments_.sku) };
  if (typeof sealed.inventory === "string"
      && typeof sealed.offer === "string"
      && sealed.publish === ""
      && sealed.inventory.length > 0
      && sealed.offer.length > 0) {
    let sealedInventory: unknown;
    let sealedOffer: unknown;
    try {
      sealedInventory = JSON.parse(sealed.inventory);
      sealedOffer = JSON.parse(sealed.offer);
    } catch {
      throw new Error("EBAY_CREATE_TRANSPORT_BODY_SEMANTICS_MISMATCH");
    }
    if (externalDetailCanonical(sealedInventory) !== externalDetailCanonical(inventoryItem)
        || externalDetailCanonical(sealedOffer) !== externalDetailCanonical(offer)) {
      throw new Error("EBAY_CREATE_TRANSPORT_BODY_SEMANTICS_MISMATCH");
    }
    return {
      inventory: sealed.inventory,
      offer: sealed.offer,
      publish: "",
    };
  }
  return {
    inventory: JSON.stringify(inventoryItem),
    offer: JSON.stringify(offer),
    publish: "",
  };
}

/** SHA-256 of the exact strings returned by ebayCreateProviderRequestBodies. */
export function ebayCreateProviderRequestBodiesSha256(
  arguments_: Record<string, unknown>,
) {
  const bodies = ebayCreateProviderRequestBodies(arguments_);
  return {
    inventory: createHash("sha256").update(bodies.inventory, "utf8").digest("hex"),
    offer: createHash("sha256").update(bodies.offer, "utf8").digest("hex"),
    publish: createHash("sha256").update(bodies.publish, "utf8").digest("hex"),
  };
}

function exactStrings(value: unknown) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item): item is string => typeof item === "string" && Boolean(item.trim()) && item === item.trim())
    && new Set(value).size === value.length
    ? value
    : null;
}

function ebayDescriptionImageUrls(value: unknown) {
  const html = typeof value === "string" ? value : "";
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/giu)]
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter(Boolean);
}

function englishApprovedText(value: string) {
  return /\p{Script=Latin}/u.test(value)
    && !/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function ebayCreateApprovalProjection(arguments_: Record<string, unknown>) {
  const external = record(arguments_.sellerpilotExternalDetail);
  const publicationAssets = parseListingPublicationAssetBinding(
    arguments_.sellerpilotPublicationAssetBinding,
  );
  const inventoryItem = record(arguments_.inventoryItem);
  const product = record(inventoryItem.product);
  const offer = record(arguments_.offer);
  const categoryAssignment = record(arguments_.sellerpilotEbayCategoryAssignment);
  const ledgerSnapshot = record(arguments_.sellerpilotEbayCreateLedgerSnapshot);
  const policies = record(offer.listingPolicies);
  const price = record(record(offer.pricingSummary).price);
  const approvalRevision = external.approvalRevision;
  const contentSha256 = text(external.contentSha256).toLowerCase();
  const fingerprint = text(arguments_.publicationExpectedFingerprint).toLowerCase();
  const inventoryImageUrls = exactStrings(product.imageUrls);
  const approvedImages = publicationAssets?.approvedDetailImages ?? [];
  const transportImages = publicationAssets?.providerTransportImages ?? [];
  const approvedSourceSha256s = approvedImages.map((image) => text(image.approvedSourceSha256).toLowerCase());
  const transportImageUrls = transportImages.map((image) => text(image.publicUrl));
  const transportContentSha256s = transportImages.map((image) => text(image.contentSha256).toLowerCase());
  const externalImageSha256s = exactStrings(external.imageSha256s)?.map((value) => value.toLowerCase()) ?? [];
  const descriptionImageUrls = ebayDescriptionImageUrls(offer.listingDescription);
  const title = typeof product.title === "string" ? product.title : "";
  const description = typeof product.description === "string" ? product.description : "";
  const listingDescription = typeof offer.listingDescription === "string" ? offer.listingDescription : "";
  const marketplaceId = text(offer.marketplaceId).toUpperCase();
  const marketplace = marketplaceId.startsWith("EBAY_") ? marketplaceId.slice(5) : "";
  const currency = text(price.currency).toUpperCase();
  const priceValue = text(price.value);
  const fulfillmentPolicyId = text(policies.fulfillmentPolicyId);
  const paymentPolicyId = text(policies.paymentPolicyId);
  const returnPolicyId = text(policies.returnPolicyId);
  const merchantLocationKey = text(offer.merchantLocationKey);
  const inventoryQuantity = record(record(inventoryItem.availability).shipToLocationAvailability).quantity;
  const offerQuantity = offer.availableQuantity;
  const categoryAssignmentId = text(categoryAssignment.id).toLowerCase();
  const categoryConfirmedAt = text(categoryAssignment.confirmedAt);
  const categoryUpdatedAt = text(categoryAssignment.updatedAt);
  const productUpdatedAt = text(ledgerSnapshot.productUpdatedAt);
  const productSku = text(ledgerSnapshot.productSku);
  const availableQuantity = ledgerSnapshot.availableQuantity;
  const ledgerPriceUsd = text(ledgerSnapshot.priceUsd);
  const draftId = text(ledgerSnapshot.draftId).toLowerCase();
  const draftVersion = ledgerSnapshot.draftVersion;
  const draftUpdatedAt = text(ledgerSnapshot.draftUpdatedAt);
  const draftDataSha256 = text(ledgerSnapshot.draftDataSha256).toLowerCase();
  const categoryBindingValid = categoryAssignment.contract === "sellerpilot_ebay_category_assignment_v1"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(categoryAssignmentId)
    && categoryAssignment.categoryId === text(offer.categoryId)
    && categoryAssignment.market === "US"
    && categoryAssignment.environment === "production"
    && Boolean(categoryConfirmedAt)
    && Boolean(categoryUpdatedAt)
    && Number.isFinite(Date.parse(categoryConfirmedAt))
    && Number.isFinite(Date.parse(categoryUpdatedAt));
  const categoryAssignmentRevisionSha256 = canonicalSha256(categoryAssignment);
  const providerRequestBodiesSha256 = ebayCreateProviderRequestBodiesSha256(arguments_);
  const sourceRequestSha256 = text(external.requestSha256).toLowerCase();
  const sourceDocumentSha256 = text(external.documentSha256).toLowerCase();
  const sourceProductId = text(external.productId);
  const sourceImportId = text(external.importId);
  const approvedDetailPageVersion = publicationAssets?.approvedDetailPageVersion;
  const externalVersion = external.version;
  const sourceValid = external.contract === "sellerpilot_external_detail_channel_v1"
    && external.channel === "ebay"
    && external.market === "US"
    && external.locale === "en-US"
    && external.language === "en"
    && Number.isSafeInteger(approvalRevision)
    && Number(approvalRevision) > 0
    && /^[a-f0-9]{64}$/u.test(contentSha256)
    && /^[a-f0-9]{64}$/u.test(fingerprint)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sourceProductId)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sourceImportId)
    && /^[a-f0-9]{64}$/u.test(sourceRequestSha256)
    && /^[a-f0-9]{64}$/u.test(sourceDocumentSha256)
    && typeof external.title === "string"
    && external.title === title
    && englishApprovedText(title)
    && typeof external.html === "string"
    && external.html === description
    && description === listingDescription
    && englishApprovedText(description)
    && externalImageSha256s.length === 8
    && externalImageSha256s.every((digest) => /^[a-f0-9]{64}$/u.test(digest));
  const imageValid = publicationAssets?.providerImageSurface === "detail_content"
    && Number.isSafeInteger(approvedDetailPageVersion)
    && Number(approvedDetailPageVersion) > 0
    && approvedDetailPageVersion === externalVersion
    && /^[a-f0-9]{64}$/u.test(publicationAssets.approvedManifestDigest)
    && approvedImages.length === 8
    && transportImages.length === 8
    && approvedSourceSha256s.every((digest) => /^[a-f0-9]{64}$/u.test(digest))
    && transportContentSha256s.every((digest) => /^[a-f0-9]{64}$/u.test(digest))
    && new Set(approvedSourceSha256s).size === 8
    && new Set(transportContentSha256s).size === 8
    && approvedSourceSha256s.every((digest, index) => digest === externalImageSha256s[index])
    && transportImageUrls.every((url) => Boolean(url) && inventoryImageUrls?.includes(url))
    && transportImageUrls.every((url, index) => url === descriptionImageUrls[index])
    && descriptionImageUrls.length === 8
    && arguments_.publicationExpectedImageCount === 8;
  const commercialValid = text(arguments_.sku) !== ""
    && marketplaceId === "EBAY_US"
    && marketplace === "US"
    && currency === "USD"
    && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(priceValue)
    && Number(priceValue) > 0
    && Boolean(fulfillmentPolicyId)
    && fulfillmentPolicyId !== "SERVER_MANAGED"
    && Boolean(paymentPolicyId)
    && paymentPolicyId !== "SERVER_MANAGED"
    && Boolean(returnPolicyId)
    && returnPolicyId !== "SERVER_MANAGED"
    && Boolean(merchantLocationKey)
    && merchantLocationKey !== "SERVER_MANAGED"
    && Number.isSafeInteger(inventoryQuantity)
    && Number(inventoryQuantity) > 0
    && offerQuantity === inventoryQuantity;
  const ledgerValid = productSku === text(arguments_.sku)
    && Number.isFinite(Date.parse(productUpdatedAt))
    && Number.isSafeInteger(availableQuantity)
    && availableQuantity === inventoryQuantity
    && ledgerPriceUsd === priceValue
    && draftId === sourceProductId.toLowerCase()
    && Number.isSafeInteger(draftVersion)
    && Number(draftVersion) > 0
    && Number.isFinite(Date.parse(draftUpdatedAt))
    && /^[a-f0-9]{64}$/u.test(draftDataSha256);
  if (!sourceValid || !imageValid || !commercialValid || !categoryBindingValid || !ledgerValid || !inventoryImageUrls) return null;
  const projection = {
    source: {
      productId: sourceProductId,
      importId: sourceImportId,
      approvalRevision: Number(approvalRevision),
      contentSha256,
      requestSha256: sourceRequestSha256,
      documentSha256: sourceDocumentSha256,
      imageSha256s: externalImageSha256s,
    },
    publication: {
      fingerprint,
      locale: "en-US",
      expectedDetailImageCount: 8,
    },
    inventory: {
      sku: text(arguments_.sku),
      condition: text(inventoryItem.condition),
      title,
      descriptionSha256: sha256(description),
      imageUrls: inventoryImageUrls,
      quantity: Number(inventoryQuantity),
      aspectsSha256: sha256(record(product.aspects)),
    },
    offer: {
      marketplaceId,
      categoryId: text(offer.categoryId),
      format: text(offer.format),
      price: priceValue,
      currency,
      fulfillmentPolicyId,
      paymentPolicyId,
      returnPolicyId,
      merchantLocationKey,
      quantity: Number(offerQuantity),
      detailImageUrls: transportImageUrls,
      detailImageContentSha256s: transportContentSha256s,
    },
    categoryAssignmentRevisionSha256,
    categoryAssignment: {
      id: categoryAssignmentId,
      confirmedAt: new Date(categoryConfirmedAt).toISOString(),
      updatedAt: new Date(categoryUpdatedAt).toISOString(),
    },
    ledgerSnapshot: {
      productUpdatedAt: new Date(productUpdatedAt).toISOString(),
      productSku,
      availableQuantity: Number(availableQuantity),
      priceUsd: ledgerPriceUsd,
      draftId,
      draftVersion: Number(draftVersion),
      draftUpdatedAt: new Date(draftUpdatedAt).toISOString(),
      draftDataSha256,
    },
    providerRequestBodiesSha256,
  };
  return {
    approvalRevision: Number(approvalRevision),
    contentSha256,
    publicationExpectedFingerprint: fingerprint,
    inventoryQuantity: Number(inventoryQuantity),
    priceUsd: priceValue,
    currency: "USD" as const,
    categoryAssignmentRevisionSha256,
    categoryAssignment: {
      id: categoryAssignmentId,
      confirmedAt: new Date(categoryConfirmedAt).toISOString(),
      updatedAt: new Date(categoryUpdatedAt).toISOString(),
    },
    ledgerSnapshot: projection.ledgerSnapshot,
    providerRequestBodiesSha256,
    revisionSha256: sha256(projection),
  };
}

/**
 * Creates the eBay-only receipt after server-owned copy/image preparation and
 * publication fingerprinting. Callers must persist/pass this exact value; the
 * provider boundary rejects a missing or stale receipt for revision-backed copy.
 */
export function buildEbayCreateApproval(
  arguments_: Record<string, unknown>,
): EbayCreateApproval | null {
  const projection = ebayCreateApprovalProjection(arguments_);
  return projection ? { contract: ebayCreateApprovalContract, ...projection } : null;
}

export function assertEbayCreateApproval(arguments_: Record<string, unknown>) {
  if (arguments_.sellerpilotExternalDetail === undefined) return;
  const expected = buildEbayCreateApproval(arguments_);
  const actual = record(arguments_.sellerpilotEbayCreateApproval);
  if (!expected
      || !Object.hasOwn(arguments_, "sellerpilotEbayCreateApproval")
      || externalDetailCanonical(actual) !== externalDetailCanonical(expected)) {
    throw new Error("EBAY_CREATE_APPROVAL_REVISION_INVALID");
  }
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
    ["offer.listingDescription",
      typeof offer.listingDescription === "string"
        && offer.listingDescription.length > 0
        && offer.listingDescription === product.description],
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
  assertEbayCreateApproval(arguments_);
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
