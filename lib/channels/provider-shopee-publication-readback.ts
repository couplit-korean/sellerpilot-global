import {
  listingExpectedPublicationLocale,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import { verifyListingUpdateReadback } from "./listing-update";
import {
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
  return {
    ...mutationArguments,
    localItemId: remoteId,
    body: Object.keys(publishedItem).length ? publishedItem : recordValue(mutationArguments.body),
  };
}

function shopeeReadbackItem(remoteData: UnknownRecord, remoteId: string) {
  const response = recordValue(remoteData.response);
  const items = Array.isArray(response.item_list)
    ? response.item_list.map(recordValue)
    : [];
  return items.find((item) => exactText(item.item_id) === remoteId);
}

function shopeeImageIds(item: UnknownRecord) {
  const image = recordValue(item.image);
  const imageInfo = recordValue(item.image_info);
  return uniqueTexts(image.image_id_list ?? imageInfo.image_id_list ?? item.image_id_list);
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
  const imageIds = item ? shopeeImageIds(item) : [];
  const imageCount = imageIds.length;
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
    : input.expectedImageCount === 8 && imageCount === input.expectedImageCount;
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
