import {
  listingExpectedPublicationLocale,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import { verifyListingUpdateReadback } from "./listing-update";
import {
  shopeeMerchantRequest,
  shopeeRequest,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

type ListingMutationOperation = "listing.create" | "listing.update" | "listing.stop";
type UnknownRecord = Record<string, unknown>;

export type ShopeePublicationReadbackVerification = {
  remoteState?: VerifiedListingRemoteState;
  providerStatus: string;
  imageCount: number;
  checks: {
    identityVerified: boolean;
    statusVerified: boolean;
    localeVerified: boolean;
    fingerprintVerified: boolean;
    imageCountVerified: boolean;
    contentVerified: boolean;
  };
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function uniqueTexts(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(exactText).filter(Boolean))]
    : [];
}

function sameOrderedTexts(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function shopeeVisibility(providerStatus: string): VerifiedListingRemoteState["visibility"] | undefined {
  const status = providerStatus.trim().toUpperCase();
  if (status === "NORMAL") return "live";
  if (status === "UNLIST") return "non_public";
  if (["REVIEWING", "PENDING", "PENDING_REVIEW", "PROCESSING"].includes(status)) return "pending_review";
  if (["BANNED", "REJECTED", "FAILED_REVIEW"].includes(status)) return "rejected";
  if (["SELLER_DELETE", "SHOPEE_DELETE", "DELETED"].includes(status)) return "withdrawn";
  return undefined;
}

function shopeeMutationContentArguments(
  operation: ListingMutationOperation,
  remoteId: string,
  mutationArguments: UnknownRecord,
) {
  if (operation === "listing.stop") return mutationArguments;
  if (operation === "listing.update") return mutationArguments;
  const publish = recordValue(mutationArguments.publish);
  const publishedItem = recordValue(publish.item);
  const body = structuredClone(
    Object.keys(publishedItem).length ? publishedItem : recordValue(mutationArguments.body),
  );
  if (mutationArguments.globalProduct === true) {
    for (const key of Object.keys(body)) {
      if (key !== "item_name" && key !== "description" && key !== "image") delete body[key];
    }
  }
  const imageIds = uniqueTexts(recordValue(body.image).image_id_list);
  if (!imageIds.length) delete body.image;
  if (Array.isArray(body.attribute_list) && body.attribute_list.length === 0) {
    delete body.attribute_list;
  }
  return {
    ...mutationArguments,
    localItemId: remoteId,
    body,
  };
}

function shopeeReadbackItem(remoteData: UnknownRecord, remoteId: string) {
  const response = recordValue(remoteData.response);
  const items = Array.isArray(response.item_list)
    ? response.item_list.map(recordValue)
    : [];
  const matchingItems = items.filter((item) => exactText(item.item_id) === remoteId);
  return matchingItems.length === 1 ? matchingItems[0] : undefined;
}

function shopeeExtendedDescriptionImageIds(item: UnknownRecord) {
  const descriptionInfo = recordValue(item.description_info);
  const extendedDescription = recordValue(descriptionInfo.extended_description);
  const fields = Array.isArray(extendedDescription.field_list)
    ? extendedDescription.field_list.map(recordValue)
    : [];
  return uniqueTexts(fields
    .filter((field) => exactText(field.field_type).toLowerCase() === "image")
    .map((field) => exactText(recordValue(field.image_info).image_id)));
}

function shopeeApprovedDetailImageIds(item: UnknownRecord) {
  const extendedDescriptionIds = shopeeExtendedDescriptionImageIds(item);
  if (extendedDescriptionIds.length) return extendedDescriptionIds;
  const image = recordValue(item.image);
  const imageInfo = recordValue(item.image_info);
  const galleryIds = uniqueTexts(image.image_id_list ?? imageInfo.image_id_list ?? item.image_id_list);
  return galleryIds.length === 9 ? galleryIds.slice(1) : galleryIds;
}

function shopeeMarketFromArguments(argumentsValue: UnknownRecord) {
  const publish = recordValue(argumentsValue.publish);
  return exactText(argumentsValue.country || publish.shop_region).toUpperCase();
}

/** Forces the documented local item state in a global-product publish task. */
export function shopeeGlobalPublishArgumentsForIntent(
  publishValue: unknown,
  intent: ListingPublicationIntent,
) {
  const publish = structuredClone(recordValue(publishValue));
  const item = recordValue(publish.item);
  if (!Object.keys(publish).length || !Object.keys(item).length) {
    throw new Error("SHOPEE_VERIFIED_PUBLISH_ARGUMENTS_REQUIRED");
  }
  publish.item = {
    ...item,
    item_status: intent === "safe_test" ? "UNLIST" : "NORMAL",
  };
  return publish;
}

/**
 * Converts one authoritative `v2.product.get_item_base_info` response into the
 * immutable publication evidence contract. This pure boundary is reusable by
 * a later read-only pending-review verifier and never performs a provider write.
 */
export function normalizeShopeeListingPublicationReadback(input: {
  operation: ListingMutationOperation;
  remoteId: string;
  remoteData: UnknownRecord;
  mutationArguments: UnknownRecord;
  credentialShopId?: string;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
  verifiedAt?: string;
}): ShopeePublicationReadbackVerification {
  const remoteId = input.remoteId.trim();
  const item = shopeeReadbackItem(input.remoteData, remoteId);
  const providerStatus = exactText(item?.item_status).toUpperCase();
  const visibility = shopeeVisibility(providerStatus);
  const imageIds = item ? shopeeApprovedDetailImageIds(item) : [];
  const imageCount = imageIds.length;
  const preparedDetailImageIds = uniqueTexts(input.mutationArguments.sellerpilotProviderDetailImageIds);
  const preparedImagesVerified = preparedDetailImageIds.length === 0
    || (preparedDetailImageIds.length === 8 && sameOrderedTexts(preparedDetailImageIds, imageIds));
  const shopId = input.credentialShopId?.trim() ?? "";
  const publish = recordValue(input.mutationArguments.publish);
  const requestedShopId = exactText(publish.shop_id);
  const globalProduct = input.mutationArguments.globalProduct === true;
  const globalItemId = exactText(input.mutationArguments.globalItemId);
  const shopIdentityVerified = Boolean(
    shopId
    && (!requestedShopId || requestedShopId === shopId),
  );
  const identityVerified = Boolean(
    item
    && remoteId
    && exactText(item.item_id) === remoteId
    && shopIdentityVerified
    && (!globalProduct || Boolean(globalItemId)),
  );
  const statusVerified = Boolean(visibility);
  const market = shopeeMarketFromArguments(input.mutationArguments);
  const localeVerified = Boolean(
    market
    && listingExpectedPublicationLocale("shopee", market) === input.expectedLocale,
  );
  const imageCountVerified = input.operation === "listing.stop"
    ? input.expectedImageCount === 0
    : input.expectedImageCount === 8
      && imageCount === input.expectedImageCount
      && preparedImagesVerified;
  const contentVerification = input.operation === "listing.stop"
    ? { ok: true, mismatches: [] as string[] }
    : verifyListingUpdateReadback(
      "shopee",
      shopeeMutationContentArguments(input.operation, remoteId, input.mutationArguments),
      input.remoteData,
    );
  const contentVerified = contentVerification.ok;
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expectedFingerprint)
    && identityVerified
    && statusVerified
    && localeVerified
    && imageCountVerified
    && contentVerified;
  const checks = {
    identityVerified,
    statusVerified,
    localeVerified,
    fingerprintVerified,
    imageCountVerified,
    contentVerified,
  };
  if (!item || !visibility || !Object.values(checks).every(Boolean)) {
    return { providerStatus, imageCount, checks };
  }

  return {
    providerStatus,
    imageCount,
    checks,
    remoteState: {
      verified: true,
      visibility,
      providerStatus,
      verifiedAt: input.verifiedAt ?? new Date().toISOString(),
      evidence: {
        version: "shopee_get_item_base_info_v1",
        ...checks,
        mutableContentMismatchPaths: contentVerification.mismatches.slice(0, 40),
      },
      resources: {
        localItemId: remoteId,
        shopId,
        ...(globalItemId ? { globalItemId } : {}),
      },
      locale: input.expectedLocale,
      fingerprint: input.expectedFingerprint,
      imageCount,
    },
  };
}

/** Performs only Shopee's authoritative local-item GET and normalizes it. */
export async function readShopeeListingPublicationState(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  operation: ListingMutationOperation;
  remoteId: string;
  mutationArguments: UnknownRecord;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
}): Promise<ShopeePublicationReadbackVerification & { remote: RemoteResponse }> {
  const remote = await shopeeRequest({
    payload: input.payload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/product/get_item_base_info",
    query: new URLSearchParams({ item_id_list: input.remoteId }),
  });
  return {
    remote,
    ...normalizeShopeeListingPublicationReadback({
      operation: input.operation,
      remoteId: input.remoteId,
      remoteData: remote.data,
      mutationArguments: input.mutationArguments,
      credentialShopId: textValue(input.payload, "shop_id"),
      expectedLocale: input.expectedLocale,
      expectedFingerprint: input.expectedFingerprint,
      expectedImageCount: input.expectedImageCount,
    }),
  };
}

export type ShopeeGlobalPublicationReadback = ShopeePublicationReadbackVerification & {
  globalItemRemote: RemoteResponse;
  publishedLinkRemote: RemoteResponse;
  localItemRemote: RemoteResponse;
  globalIdentityVerified: boolean;
  publishedLinkageVerified: boolean;
};

function numericShopeeIdentity(value: string) {
  return /^[1-9][0-9]{0,31}$/u.test(value);
}

/**
 * Re-verifies a CBSC/global publication with Shopee's three authoritative GETs:
 * merchant-scoped global item, merchant-scoped global-to-shop publication map,
 * and shop-scoped local item. No identity is inferred from the verifier request.
 */
export async function readShopeeGlobalListingPublicationState(input: {
  merchantPayload: SecretPayload;
  shopPayload: SecretPayload;
  environment: "sandbox" | "production";
  operation: "listing.create" | "listing.update";
  globalItemId: string;
  localItemId: string;
  shopId: string;
  mutationArguments: UnknownRecord;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
}): Promise<ShopeeGlobalPublicationReadback> {
  const globalItemId = input.globalItemId.trim();
  const localItemId = input.localItemId.trim();
  const shopId = input.shopId.trim();
  if (!numericShopeeIdentity(globalItemId)
      || !numericShopeeIdentity(localItemId)
      || !numericShopeeIdentity(shopId)
      || textValue(input.shopPayload, "shop_id") !== shopId
      || !numericShopeeIdentity(textValue(input.merchantPayload, "merchant_id"))) {
    throw new Error("SHOPEE_PUBLICATION_VERIFY_IMMUTABLE_IDENTITY_INVALID");
  }

  const globalItemRemote = await shopeeMerchantRequest({
    payload: input.merchantPayload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/global_product/get_global_item_info",
    query: new URLSearchParams({ global_item_id_list: globalItemId }),
  });
  const globalResponse = recordValue(globalItemRemote.data.response);
  const globalItems = Array.isArray(globalResponse.global_item_list)
    ? globalResponse.global_item_list.map(recordValue)
    : [];
  const globalIdentityVerified = globalItemRemote.response.ok
    && !exactText(globalItemRemote.data.error)
    && globalItems.length === 1
    && exactText(globalItems[0].global_item_id) === globalItemId;

  const publishedLinkRemote = await shopeeMerchantRequest({
    payload: input.merchantPayload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/global_product/get_published_list",
    query: new URLSearchParams({ global_item_id: globalItemId }),
  });
  const publishedResponse = recordValue(publishedLinkRemote.data.response);
  const publishedItems = Array.isArray(publishedResponse.published_item)
    ? publishedResponse.published_item.map(recordValue)
    : [];
  const targetShopLinks = publishedItems.filter((item) => exactText(item.shop_id) === shopId);
  const publishedLinkageVerified = publishedLinkRemote.response.ok
    && !exactText(publishedLinkRemote.data.error)
    && targetShopLinks.length === 1
    && exactText(targetShopLinks[0].item_id) === localItemId;

  const localItemRemote = await shopeeRequest({
    payload: input.shopPayload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/product/get_item_base_info",
    query: new URLSearchParams({ item_id_list: localItemId }),
  });
  const normalized = normalizeShopeeListingPublicationReadback({
    operation: input.operation,
    remoteId: localItemId,
    remoteData: localItemRemote.data,
    mutationArguments: {
      ...input.mutationArguments,
      globalProduct: true,
      globalItemId,
    },
    credentialShopId: shopId,
    expectedLocale: input.expectedLocale,
    expectedFingerprint: input.expectedFingerprint,
    expectedImageCount: input.expectedImageCount,
  });
  const remoteState = globalIdentityVerified
    && publishedLinkageVerified
    && normalized.remoteState
    ? {
        ...normalized.remoteState,
        evidence: {
          ...normalized.remoteState.evidence,
          globalIdentityVerified: true,
          publishedLinkageVerified: true,
          globalReadbackMethod: "v2.global_product.get_global_item_info",
          linkageReadbackMethod: "v2.global_product.get_published_list",
          localReadbackMethod: "v2.product.get_item_base_info",
        },
      }
    : undefined;
  return {
    ...normalized,
    ...(remoteState ? { remoteState } : { remoteState: undefined }),
    globalItemRemote,
    publishedLinkRemote,
    localItemRemote,
    globalIdentityVerified,
    publishedLinkageVerified,
  };
}
