import type { ActiveChannelKey } from "./catalog";

export type ListingUpdateReference = {
  remoteId: string | null;
  status: string;
  publishedAt?: string | null;
};

export function listingWriteOperation(listing: ListingUpdateReference | null | undefined): "listing.create" | "listing.update" {
  const hasPublishedIdentity = Boolean(listing?.remoteId?.trim())
    && (listing?.status === "published" || Boolean(listing?.publishedAt));
  return hasPublishedIdentity ? "listing.update" : "listing.create";
}

export type ListingCoreContent = {
  title: string;
  shortDescription: string;
  description: string;
};

export function listingCoreContentForOperation(input: {
  operation: "listing.create" | "listing.update";
  central: { title: string; description: string };
  localized?: Partial<ListingCoreContent>;
}): ListingCoreContent {
  const centralTitle = input.central.title.trim();
  const centralDescription = input.central.description.trim();
  if (input.operation === "listing.update") {
    return {
      title: centralTitle,
      shortDescription: centralDescription.slice(0, 500),
      description: centralDescription,
    };
  }
  const description = input.localized?.description?.trim() || centralDescription;
  return {
    title: input.localized?.title?.trim() || centralTitle,
    shortDescription: input.localized?.shortDescription?.trim() || description.slice(0, 500),
    description,
  };
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identityValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function listingUpdateRemoteIdentity(channel: ActiveChannelKey, argumentsValue: Record<string, unknown>) {
  const params = recordValue(argumentsValue.params);
  const body = recordValue(argumentsValue.body);
  const candidates = channel === "qoo10"
    ? [params.ItemCode]
    : channel === "shopee"
      ? [argumentsValue.itemId, body.item_id]
      : channel === "lazada"
        ? [argumentsValue.itemId]
        : channel === "coupang"
          ? [body.sellerProductId]
          : channel === "smartstore"
            ? [argumentsValue.originProductNo]
            : [];
  const identities = [...new Set(candidates.map(identityValue).filter(Boolean))];
  if (identities.length !== 1) {
    throw new Error(identities.length ? "LISTING_UPDATE_IDENTITY_MISMATCH" : "LISTING_UPDATE_IDENTITY_REQUIRED");
  }
  return identities[0];
}

function remoteNumberOrText(remoteId: string) {
  return /^\d+$/.test(remoteId) ? Number(remoteId) : remoteId;
}

/**
 * Converts the already validated create draft into the documented update shape.
 * This function does not execute a remote write. The caller must still gate the
 * operation with `channelOperationAvailable` and obtain an explicit write
 * confirmation before sending the result to the channel operation route.
 */
export function prepareListingUpdateArguments(
  channel: ActiveChannelKey,
  createArguments: Record<string, unknown>,
  listing: ListingUpdateReference,
) {
  const remoteId = listing.remoteId?.trim() ?? "";
  if (listingWriteOperation(listing) !== "listing.update" || !remoteId) {
    throw new Error("PUBLISHED_REMOTE_LISTING_REQUIRED");
  }

  if (channel === "qoo10") {
    return {
      ...createArguments,
      params: { ...recordValue(createArguments.params), ItemCode: remoteId },
    };
  }

  if (channel === "shopee") {
    const publish = recordValue(createArguments.publish);
    const publishedItem = recordValue(publish.item);
    const createBody = recordValue(createArguments.body);
    const body = Object.keys(publishedItem).length ? publishedItem : createBody;
    return {
      sellerpilotAssets: createArguments.sellerpilotAssets,
      shopId: createArguments.shopId,
      itemId: remoteId,
      body: { ...body, item_id: remoteNumberOrText(remoteId) },
    };
  }

  if (channel === "lazada") {
    return { ...createArguments, itemId: remoteId };
  }

  if (channel === "coupang") {
    return {
      ...createArguments,
      body: {
        ...recordValue(createArguments.body),
        sellerProductId: remoteNumberOrText(remoteId),
      },
    };
  }

  if (channel === "smartstore") {
    return { ...createArguments, originProductNo: remoteId };
  }

  throw new Error(`LISTING_UPDATE_NOT_RELEASED:${channel}`);
}
