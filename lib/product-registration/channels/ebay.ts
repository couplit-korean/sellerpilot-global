import { ebayInventorySkuAbsent, ebayExactReconciliationOffer } from "../../channels/ebay-create-preflight";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import { objectValue, stringArgument, integerArgument, pathSegment } from "../../channels/operation-values";
import { ebayRequest, textValue, type RemoteResponse } from "../../channels/protocols";
import { ebayAsqMarketplaceId } from "../../channels/ebay-asq";
import { assertEbayListingCreateConfiguration } from "../../channels/ebay-listing-configuration";

import { mergeListingUpdatePatch, verifyListingUpdateReadback } from "../../channels/listing-update";
import { listingPublicationIntentFromArguments } from "../../channels/listing-publication-state";
import { listingPublicationReadbackExpectation, readEbayListingPublicationState } from "../../channels/listing-publication-readback";
import { type ExecuteInput, listingPublicationReadbackRequested, result, publicationStateVerificationStep, booleanArgument, inventoryQuantityVerificationStep } from "../execution-shared";

export async function ebayListingResultWithPublicationReadback(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId: string,
  offerId: string,
) {
  if (
    !listingPublicationReadbackRequested(input) ||
    steps.some((item) => !item.ok)
  ) {
    return result(input, steps, remoteId);
  }
  const expected = listingPublicationReadbackExpectation(input.arguments);
  if (!expected) {
    return result(
      input,
      [
        ...steps,
        publicationStateVerificationStep(
          input.channel,
          undefined,
          "EBAY_PUBLICATION_EXPECTATION_MISSING",
        ),
      ],
      remoteId,
    );
  }
  const readback = await readEbayListingPublicationState({
    operation: input.operation as
      | "listing.create"
      | "listing.update"
      | "listing.stop",
    intent: listingPublicationIntentFromArguments(input.arguments),
    remoteId,
    offerId,
    expectedSku:
      typeof input.arguments.sku === "string" ? input.arguments.sku : undefined,
    expectedMarketplaceId:
      typeof input.arguments.marketplaceId === "string"
        ? input.arguments.marketplaceId
        : undefined,
    expectedListingId:
      typeof input.arguments.listingId === "string"
        ? input.arguments.listingId
        : undefined,
    expected,
    readOffer: (readbackOfferId) =>
      ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: `/sell/inventory/v1/offer/${pathSegment(readbackOfferId)}`,
      }),
    readInventoryItem: (sku) =>
      ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: `/sell/inventory/v1/inventory_item/${pathSegment(sku)}`,
      }),
  });
  const readbackSteps: ChannelOperationStep[] = [
    step("offer-publication-readback", readback.offerReadback),
  ];
  if (readback.inventoryItemReadback) {
    readbackSteps.push(
      step(
        "inventory-item-publication-readback",
        readback.inventoryItemReadback,
      ),
    );
  }
  if (input.operation === "listing.update" && readback.inventoryItemReadback) {
    const mutableReadback = verifyListingUpdateReadback(
      "ebay",
      input.arguments,
      {
        offer: readback.offerReadback.data,
        inventoryItem: readback.inventoryItemReadback.data,
      },
    );
    const httpVerified =
      readback.offerReadback.response.ok &&
      readback.inventoryItemReadback.response.ok;
    readbackSteps.push({
      name: "listing-update-content-readback",
      ok: httpVerified && mutableReadback.ok,
      status: readback.offerReadback.response.ok
        ? readback.inventoryItemReadback.response.status
        : readback.offerReadback.response.status,
      data: {
        sellerpilotVerification:
          httpVerified && mutableReadback.ok
            ? "LISTING_MUTABLE_FIELDS_VERIFIED"
            : "LISTING_MUTABLE_FIELDS_MISMATCH",
        sellerpilotMismatchPaths: mutableReadback.mismatches.slice(0, 40),
      },
    });
  }
  readbackSteps.push(
    publicationStateVerificationStep(
      input.channel,
      readback.state,
      readback.failureCode,
    ),
  );
  return result(
    input,
    [...steps, ...readbackSteps],
    readback.resolvedRemoteId,
    undefined,
    readback.state,
  );
}

export function ebayProviderDescriptionWithoutImages(value: unknown) {
  return String(value ?? "")
    .replace(/<img\b[^>]*>/giu, "")
    .trim();
}

export function ebayCompactInventoryDescription(...providerValues: unknown[]) {
  for (const providerValue of providerValues) {
    const compact = ebayProviderDescriptionWithoutImages(providerValue)
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]*>/gu, " ")
      .replace(/&nbsp;|&#160;/giu, " ")
      .replace(/&amp;/giu, "&")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&quot;|&#34;/giu, '"')
      .replace(/&#39;|&apos;/giu, "'")
      .replace(/\s+/gu, " ")
      .trim();
    if (!compact) continue;
    if (compact.length <= 1_000) return compact;
    const bounded = compact.slice(0, 1_000);
    const lastSpace = bounded.lastIndexOf(" ");
    return (lastSpace >= 800 ? bounded.slice(0, lastSpace) : bounded).trim();
  }
  throw new Error("EBAY_EXACT_EXISTING_QA_PROVIDER_DESCRIPTION_REQUIRED");
}

export async function executeEbay(input: ExecuteInput) {
  if (input.channel !== "ebay")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:ebay");
  if (input.operation === "categories.list") {
    const categoryTreeId = pathSegment(
      stringArgument(input.arguments, "categoryTreeId"),
    );
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}`,
    });
    return result(input, [step("taxonomy", remote)], categoryTreeId);
  }
  if (input.operation === "categories.suggest") {
    let categoryTreeId = stringArgument(
      input.arguments,
      "categoryTreeId",
      false,
    );
    const marketplaceId =
      stringArgument(input.arguments, "marketplaceId", false) ||
      textValue(input.payload, "marketplace_id") ||
      "EBAY_US";
    const steps: ChannelOperationStep[] = [];
    if (!categoryTreeId) {
      const tree = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/commerce/taxonomy/v1/get_default_category_tree_id",
        query: new URLSearchParams({ marketplace_id: marketplaceId }),
      });
      steps.push(step("default-category-tree", tree));
      if (!tree.response.ok) return result(input, steps);
      categoryTreeId = String(tree.data.categoryTreeId ?? "");
    }
    if (!categoryTreeId)
      throw new Error("CHANNEL_ARGUMENT_REQUIRED:categoryTreeId");
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/commerce/taxonomy/v1/category_tree/${pathSegment(categoryTreeId)}/get_category_suggestions`,
      query: new URLSearchParams({
        q: stringArgument(input.arguments, "query"),
      }),
    });
    steps.push(step("category-suggestions", remote));
    return result(input, steps, categoryTreeId);
  }
  if (
    input.operation === "categories.attributes" ||
    input.operation === "categories.validate"
  ) {
    const categoryTreeId = pathSegment(
      stringArgument(input.arguments, "categoryTreeId"),
    );
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_aspects_for_category`,
      query: new URLSearchParams({ category_id: categoryId }),
    });
    return result(input, [step("category-aspects", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    assertEbayListingCreateConfiguration(input.arguments);
    const rawSku = stringArgument(input.arguments, "sku");
    const sku = pathSegment(rawSku);
    const inventoryItem = objectValue(input.arguments, "inventoryItem");
    const offer = structuredClone(objectValue(input.arguments, "offer"));
    const marketplaceId = String(offer.marketplaceId ?? "").trim();
    if (!marketplaceId)
      throw new Error("CHANNEL_ARGUMENT_REQUIRED:offer.marketplaceId");
    const shouldPublish = listingPublicationReadbackRequested(input)
      ? listingPublicationIntentFromArguments(input.arguments) === "live"
      : booleanArgument(input.arguments, "publish");
    // eBay rejects an offer when its SKU differs from the Inventory Item URL
    // even if both values are otherwise valid. Enforce this invariant at the
    // channel boundary as a final guard for manually edited or legacy drafts.
    offer.sku = rawSku;
    const steps: ChannelOperationStep[] = [];
    const inventoryProduct =
      inventoryItem.product &&
        typeof inventoryItem.product === "object" &&
        !Array.isArray(inventoryItem.product)
        ? (inventoryItem.product as Record<string, unknown>)
        : {};
    const expectedImageUrls = Array.isArray(inventoryProduct.imageUrls)
      ? [
        ...new Set(
          inventoryProduct.imageUrls
            .map(String)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
      : [];
    if (!expectedImageUrls.length) throw new Error("EBAY_IMAGE_REQUIRED");
    const expectedDescriptionImages = (
      String(offer.listingDescription ?? "").match(/<img\b/gi) ?? []
    ).length;
    const verifiedReadbackStep = (
      name: string,
      remote: RemoteResponse,
      expectedImageCount: number,
      actualImageCount: number,
    ): ChannelOperationStep => {
      const remoteStep = step(name, remote);
      const verified = remoteStep.ok && actualImageCount >= expectedImageCount;
      return {
        ...remoteStep,
        ok: verified,
        data: {
          ...remoteStep.data,
          expectedImageCount,
          actualImageCount,
          sellerpilotVerification: verified
            ? "IMAGES_VERIFIED"
            : "EBAY_IMAGE_READBACK_MISSING",
        },
      };
    };
    const existingInventory = await ebayRequest({
      payload: input.payload, environment: input.environment, method: "GET",
      path: `/sell/inventory/v1/inventory_item/${sku}`,
    });
    if (!ebayInventorySkuAbsent(existingInventory)) {
      return result(input, [{
        name: "inventory-duplicate-preflight", ok: false,
        status: existingInventory.response.ok ? 409 : existingInventory.response.status,
        data: { error: existingInventory.response.ok ? "EBAY_EXISTING_INVENTORY_REQUIRES_UPDATE" : "EBAY_INVENTORY_ABSENCE_UNVERIFIED" },
      }]);
    }
    const itemRemote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "PUT",
      path: `/sell/inventory/v1/inventory_item/${sku}`,
      body: inventoryItem,
    });
    steps.push(step("inventory-item", itemRemote));
    if (!itemRemote.response.ok) return result(input, steps, rawSku);
    const itemReadback = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/inventory_item/${sku}`,
    });
    const readbackProduct =
      itemReadback.data.product &&
        typeof itemReadback.data.product === "object" &&
        !Array.isArray(itemReadback.data.product)
        ? (itemReadback.data.product as Record<string, unknown>)
        : {};
    const actualImageCount = Array.isArray(readbackProduct.imageUrls)
      ? new Set(
        readbackProduct.imageUrls
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean),
      ).size
      : 0;
    const inventoryImageStep = verifiedReadbackStep(
      "inventory-image-readback",
      itemReadback,
      expectedImageUrls.length,
      actualImageCount,
    );
    steps.push(inventoryImageStep);
    if (!inventoryImageStep.ok) return result(input, steps, rawSku);
    let offerRemote: RemoteResponse;
    try {
      offerRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/sell/inventory/v1/offer",
        body: offer,
      });
    } catch {
      // A dropped response may still have created an offer. Read once by exact
      // identity; never repeat the offer POST or overwrite another offer.
      offerRemote = {
        response: new Response(null, { status: 503 }), text: "",
        data: { error: "EBAY_OFFER_CREATE_OUTCOME_UNCERTAIN" }
      };
    }
    let offerId =
      offerRemote.data.offerId === undefined
        ? undefined
        : String(offerRemote.data.offerId);
    const offerStep = step("offer", offerRemote);
    if (offerStep.ok) steps.push(offerStep);
    if (offerStep.ok && offerId) {
      // The accepted provider step was recorded above together with its durable
      // offer identity.
    } else {
      // A timed-out create call may still have persisted the offer remotely. eBay
      // also rejects a second offer for the same SKU, so reconcile by SKU before
      // deciding that the retry failed.
      const reconcileRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/sell/inventory/v1/offer",
        query: new URLSearchParams({
          sku: decodeURIComponent(sku),
          limit: "25",
        }),
      });
      const existing = ebayExactReconciliationOffer(reconcileRemote, rawSku, marketplaceId, String(offer.format ?? "FIXED_PRICE"));
      offerId =
        existing?.offerId === undefined ? undefined : String(existing.offerId);
      const reconcileStep = step("offer-reconcile", reconcileRemote);
      reconcileStep.ok = reconcileStep.ok && Boolean(offerId);
      reconcileStep.data = {
        ...reconcileStep.data,
        recoveredOfferId: offerId,
        createStatus: offerRemote.response.status,
        sellerpilotVerification: offerId
          ? "EXISTING_OFFER_RECOVERED"
          : "EBAY_OFFER_RECONCILE_MISSING",
      };
      steps.push(reconcileStep);
      if (!reconcileStep.ok || !offerId) {
        // A locally known SKU is not an eBay offer/listing identity. In the
        // accepted-without-offerId case, leave remoteId empty so completion
        // records an unresolved external action rather than a false identity.
        return result(input, steps, offerStep.ok ? undefined : rawSku);
      }
    }
    let publishedListingId = "";
    if (offerId) {
      const offerReadback = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: `/sell/inventory/v1/offer/${pathSegment(offerId)}`,
      });
      const actualDescriptionImages = (
        String(offerReadback.data.listingDescription ?? "").match(/<img\b/gi) ??
        []
      ).length;
      const offerReadbackStep =
        expectedDescriptionImages > 0
          ? verifiedReadbackStep(
            "offer-detail-image-readback",
            offerReadback,
            expectedDescriptionImages,
            actualDescriptionImages,
          )
          : step("offer-readback", offerReadback);
      const identityMatches = offerReadback.data.offerId === offerId
        && offerReadback.data.sku === rawSku
        && offerReadback.data.marketplaceId === marketplaceId
        && offerReadback.data.format === String(offer.format ?? "FIXED_PRICE");
      const content = verifyListingUpdateReadback("ebay", { inventoryItem, offer }, {
        inventoryItem: itemReadback.data, offer: offerReadback.data,
      });
      offerReadbackStep.ok = offerReadbackStep.ok && identityMatches && content.ok;
      if (!offerReadbackStep.ok) Object.assign(offerReadbackStep.data, {
        error: "EBAY_CREATE_READBACK_MISMATCH",
        sellerpilotVerification: "EBAY_CREATE_READBACK_MISMATCH",
        sellerpilotMismatchPaths: content.mismatches.slice(0, 40),
      });
      steps.push(offerReadbackStep);
      if (!offerReadbackStep.ok) return result(input, steps, offerId);
      const listing =
        offerReadback.data.listing &&
          typeof offerReadback.data.listing === "object" &&
          !Array.isArray(offerReadback.data.listing)
          ? (offerReadback.data.listing as Record<string, unknown>)
          : {};
      if (
        String(offerReadback.data.status ?? "").toUpperCase() === "PUBLISHED"
      ) {
        publishedListingId = String(listing.listingId ?? "").trim();
      }
    }
    if (offerId && shouldPublish && !publishedListingId) {
      const publishRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: `/sell/inventory/v1/offer/${pathSegment(offerId)}/publish`,
      });
      const publishStep = step("publish", publishRemote);
      steps.push(publishStep);
      const listingId =
        publishRemote.data.listingId === undefined
          ? undefined
          : String(publishRemote.data.listingId);
      if (!publishStep.ok) return result(input, steps, listingId ?? offerId);
      return ebayListingResultWithPublicationReadback(
        input,
        steps,
        listingId ?? offerId,
        offerId,
      );
    }
    const finalRemoteId = publishedListingId || offerId || rawSku;
    return offerId
      ? ebayListingResultWithPublicationReadback(
        input,
        steps,
        finalRemoteId,
        offerId,
      )
      : result(input, steps, finalRemoteId);
  }
  if (input.operation === "listing.update") {


    const listingId = stringArgument(input.arguments, "listingId");
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const decodedSku = decodeURIComponent(sku);
    const marketplaceId = ebayAsqMarketplaceId(input.arguments.marketplaceId);
    const requestedOffer =
      input.arguments.offer === undefined
        ? {}
        : objectValue(input.arguments, "offer");
    const requestedInventoryItem =
      input.arguments.inventoryItem === undefined
        ? {}
        : objectValue(input.arguments, "inventoryItem");
    if (
      !Object.keys(requestedOffer).length &&
      !Object.keys(requestedInventoryItem).length
    ) {
      throw new Error("EBAY_LISTING_UPDATE_CONTENT_REQUIRED");
    }

    const steps: ChannelOperationStep[] = [];
    const decodedOfferId = stringArgument(input.arguments, "offerId");

    const offerId = pathSegment(decodedOfferId);

    const offerRead = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/offer/${offerId}`,
    });
    const inventoryRead = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/inventory_item/${sku}`,
    });
    const listing =
      offerRead.data.listing &&
        typeof offerRead.data.listing === "object" &&
        !Array.isArray(offerRead.data.listing)
        ? (offerRead.data.listing as Record<string, unknown>)
        : {};
    const identityVerified =
      offerRead.response.ok &&
      inventoryRead.response.ok &&
      String(offerRead.data.offerId ?? "").trim() === decodedOfferId &&
      String(offerRead.data.sku ?? "").trim() === decodedSku &&
      String(offerRead.data.marketplaceId ?? "")
        .trim()
        .toUpperCase() === marketplaceId &&
      String(offerRead.data.status ?? "")
        .trim()
        .toUpperCase() === "PUBLISHED" &&
      String(listing.listingId ?? "").trim() === listingId &&
      String(listing.listingStatus ?? "")
        .trim()
        .toUpperCase() === "ACTIVE";
    const offerPreflight = step("offer-update-preflight-readback", offerRead);
    offerPreflight.ok = offerPreflight.ok && identityVerified;
    offerPreflight.data = {
      ...offerPreflight.data,
      sellerpilotVerification: identityVerified
        ? "EBAY_IMMUTABLE_LISTING_IDENTITY_VERIFIED"
        : "EBAY_IMMUTABLE_LISTING_IDENTITY_MISMATCH",
    };
    const inventoryPreflight = step(
      "inventory-item-update-preflight-readback",
      inventoryRead,
    );
    inventoryPreflight.ok = inventoryPreflight.ok && identityVerified;
    steps.push(offerPreflight, inventoryPreflight);
    if (!identityVerified) return result(input, steps, listingId);

    const offerWritableFields = [
      "availableQuantity",
      "categoryId",
      "charity",
      "extendedProducerResponsibility",
      "format",
      "hideBuyerDetails",
      "includeCatalogProductDetails",
      "listingDescription",
      "listingDuration",
      "listingPolicies",
      "listingStartDate",
      "lotSize",
      "merchantLocationKey",
      "pricingSummary",
      "quantityLimitPerBuyer",
      "regulatory",
      "secondaryCategoryId",
      "sku",
      "storeCategoryNames",
      "tax",
    ] as const;
    const currentOffer = Object.fromEntries(
      offerWritableFields.flatMap((key) =>
        offerRead.data[key] === undefined
          ? []
          : [[key, structuredClone(offerRead.data[key])]],
      ),
    );
    const inventoryWritableFields = [
      "availability",
      "condition",
      "conditionDescription",
      "packageWeightAndSize",
      "product",
    ] as const;
    const currentInventoryItem = Object.fromEntries(
      inventoryWritableFields.flatMap((key) =>
        inventoryRead.data[key] === undefined
          ? []
          : [[key, structuredClone(inventoryRead.data[key])]],
      ),
    );

    const offerBody =
      (mergeListingUpdatePatch(currentOffer, requestedOffer) as Record<
        string,
        unknown
      >);
    offerBody.sku = decodedSku;
    offerBody.marketplaceId = marketplaceId;
    const inventoryBody =
      (mergeListingUpdatePatch(
        currentInventoryItem,
        requestedInventoryItem,
      ) as Record<string, unknown>);

    if (Object.keys(requestedOffer).length) {
      assertEbayListingCreateConfiguration({ offer: offerBody });
    }


    if (Object.keys(requestedInventoryItem).length) {
      const inventoryRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "PUT",
        path: `/sell/inventory/v1/inventory_item/${sku}`,
        body: inventoryBody,
      });
      const inventoryStep = step("inventory-item-update", inventoryRemote);
      steps.push(inventoryStep);
      if (!inventoryStep.ok) return result(input, steps, listingId);
    }
    if (Object.keys(requestedOffer).length) {
      const offerRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "PUT",
        path: `/sell/inventory/v1/offer/${offerId}`,
        body: offerBody,
      });
      const offerStep = step("offer-update", offerRemote);
      steps.push(offerStep);
      if (!offerStep.ok) return result(input, steps, listingId);
    }
    return ebayListingResultWithPublicationReadback(
      input,
      steps,
      listingId,
      decodedOfferId,
    );
  }
  if (input.operation === "listing.stop") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: `/sell/inventory/v1/offer/${offerId}/withdraw`,
    });
    return ebayListingResultWithPublicationReadback(
      input,
      [step("offer-withdraw", remote)],
      decodeURIComponent(offerId),
      decodeURIComponent(offerId),
    );
  }
  if (input.operation === "price.update") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "PUT",
      path: `/sell/inventory/v1/offer/${offerId}`,
      body: objectValue(input.arguments, "body"),
    });
    return result(input, [step("offer-price", remote)], offerId);
  }
  if (input.operation === "inventory.update") {
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const quantity = integerArgument(input.arguments, "quantity", {
      min: 0,
      max: 99_999_999,
    });
    const decodedSku = decodeURIComponent(sku);
    const bulkBody = input.arguments.body
      ? objectValue(input.arguments, "body")
      : {
        requests: [
          {
            sku: decodedSku,
            shipToLocationAvailability: { quantity },
          },
        ],
      };
    const writeRemote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/sell/inventory/v1/bulk_update_price_quantity",
      body: bulkBody,
    });
    const writeStep = step("bulk-inventory", writeRemote);
    if (!writeStep.ok) return result(input, [writeStep], decodedSku);
    const readback = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/inventory_item/${sku}`,
    });
    const availability = objectValue(readback.data, "availability", false);
    const shipToLocationAvailability = objectValue(
      availability,
      "shipToLocationAvailability",
      false,
    );
    return result(
      input,
      [
        writeStep,
        inventoryQuantityVerificationStep(
          "inventory-readback",
          readback,
          quantity,
          shipToLocationAvailability.quantity,
        ),
      ],
      decodedSku,
    );
  }

  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
